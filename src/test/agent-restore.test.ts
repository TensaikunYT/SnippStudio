// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (FAZ4A-YENIDEN.md, part B: restore points): the
// point before the agent belongs to the FILE. It is there after the file is
// opened again and after the app is started again, an agent's next change
// does not delete it, it goes with the project to another path, and going
// back to it never jumps forward to a point that holds the agent's changes.
// A refused edit writes no point; a point that cannot be written refuses the
// edit. The profile here is a map in memory with the main process's own
// pruning rule (main/agent-restore.ts pruneList).
import './dom-stub'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { demoteRestorePoint, pruneList, pruneRestorePoints, rekeyRestorePoints, writeRestorePoint } from '../main/agent-restore'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import { editTool, type EditContext } from '../renderer/src/agent/edit'
import { acceptDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { useAgentStore } from '../renderer/src/agent/store'
import { ensureRestorePoint, pointsInMemory, projectKey, restorePoints, restoreTo, setRestoreIo, type RestoreIo } from '../renderer/src/agent/restore'
import { moveProjectPath, setLastProjectPath, serializeProject } from '../renderer/src/media/projectio'
import { read } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

function small(name = 'Small'): Project {
  const p = defaultProject()
  p.name = name
  const a: Asset = { id: 'a1', kind: 'video', name: 'talk.mp4', url: 'media://x', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true }
  p.assets = [a]
  const v1 = p.tracks[0]
  p.clips = { c1: { id: 'c1', assetId: 'a1', trackId: v1.id, start: 0, inPoint: 0, duration: 20, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  return p
}

/** The profile's agent-restore folder, in memory. */
function profile(): { io: RestoreIo; files: Map<string, string>; writes: string[]; fail: { write: boolean } } {
  const files = new Map<string, string>()
  const writes: string[] = []
  const fail = { write: false }
  let n = 0
  const io: RestoreIo = {
    write: async (json, label) => {
      if (fail.write) return null
      const name = `${1_700_000_000_000 + ++n}-${label}-${(n + 0xabcdef).toString(16).slice(-6)}.snipp`
      files.set(name, json)
      writes.push(name)
      for (const old of pruneList([...files.keys()], /^(?:pre|pt)-([a-z0-9]+)[.-]/.exec(label)?.[1])) if (old !== name) files.delete(old)
      return { name }
    },
    read: async (name) => (files.has(name) ? { json: files.get(name)! } : null),
    list: async () => [...files.keys()].map((name) => ({ name })),
    rekey: async (from, to) => {
      const out: Record<string, string> = {}
      // (As main does: the points `to` had become session points first.)
      for (const [name, json] of [...files]) {
        const m = /^(\d{13})-(pre|pt)-([a-z0-9]+)[.-]/.exec(name)
        if (!m || m[3] !== to || m[2] !== 'pre') continue
        files.delete(name)
        files.set(name.replace(`-pre-${to}`, `-pt-${to}`), json)
      }
      for (const [name, json] of [...files]) {
        const m = /^(\d{13})-(pre|pt)-([a-z0-9]+)[.-]/.exec(name)
        if (!m || m[3] !== from) continue
        const next = name.replace(`-${m[2]}-${from}`, `-${m[2]}-${to}`)
        files.delete(name)
        files.set(next, json)
        out[name] = next
      }
      return out
    },
    demote: async (name) => {
      if (!files.has(name) || !/^\d{13}-pre-/.test(name)) return null
      const next = name.replace('-pre-', '-pt-')
      files.set(next, files.get(name)!)
      files.delete(name)
      return next
    }
  }
  return { io, files, writes, fail }
}

const ctx = (session: string, extra: Partial<EditContext> = {}): EditContext => ({ session, client: 'test', results: new Map(), beforeFirstEdit: async () => void (await ensureRestorePoint(session)), told: () => undefined, ...extra })
const cut = (session: string, a: number, b: number) => editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[a, b]] }], base: read() }, ctx(session))
const pres = (files: Map<string, string>, key: string): string[] => [...files.keys()].filter((n) => n.includes(`-pre-${key}-`) || n.includes(`-pre-${key}.`))
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function openFile(p: Project, file: string | null, mode: 'draft' | 'direct' = 'direct'): void {
  rejectDraft()
  // (As the app opens a file: the path first, then the project.)
  setLastProjectPath(file)
  S().loadProject(p)
  useAgentStore.getState().setMode(mode)
}

test('V-restore-transcribe-1 / G1 / T9: the point before the agent survives opening the file again and starting the app again; the agent\'s next change does not delete it', async () => {
  const disk = profile()
  let undo = setRestoreIo(disk.io)
  try {
    const P = 'C:\\Videos\\talk.snipp'
    openFile(small(), P)
    const before = serializeProject(S().project)
    const key = projectKey()
    // Direct mode: the agent cuts the project to pieces; the autosave keeps it.
    await cut('s1', 2, 6)
    await cut('s1', 3, 9)
    const n1 = pres(disk.files, key)
    assert.equal(n1.length, 1, 'one point before the agent, in the profile')
    const wrecked = JSON.parse(JSON.stringify(S().project)) as Project
    // The user opens the file again (Open recent): the point is still listed
    // and is still what a plain "go back" goes to.
    openFile(wrecked, P)
    assert.equal(restorePoints()[0]?.name, n1[0], 'listed for the file opened again')
    // The agent sends an edit again (even a draft the user will reject):
    // the point before the agent is not written over, not deleted.
    await cut('s2', 1, 2)
    assert.deepEqual(pres(disk.files, key), n1, 'still THE point before the agent')
    await restoreTo()
    assert.equal(serializeProject(S().project), before, 'back to the project as it was before the agent')

    // The same across a start of the app: nothing in memory, the file in the profile.
    disk.files.clear()
    undo()
    undo = setRestoreIo(disk.io)
    openFile(small(), P)
    const before2 = serializeProject(S().project)
    await cut('s1', 2, 6)
    const n2 = pres(disk.files, key)
    assert.equal(n2.length, 1)
    const again = JSON.parse(JSON.stringify(S().project)) as Project
    undo()
    undo = setRestoreIo(disk.io) // the app started again
    openFile(again, P)
    assert.equal(pointsInMemory(), 0)
    await cut('s9', 1, 2)
    assert.deepEqual(pres(disk.files, key), n2, 'the new run\'s first agent change did not replace it')
    assert.ok([...disk.files.keys()].some((n) => n.includes(`-pt-${key}-`) || n.includes(`-pt-${key}.`)), 'the state before this run\'s agent session is a session point')
    await restoreTo()
    assert.equal(serializeProject(S().project), before2)
    // Gone back to: it is no longer a period's point before the agent in the
    // profile, and the agent's next change writes a new one.
    await settle()
    assert.deepEqual(pres(disk.files, key), [])
    await cut('s9', 1, 2)
    assert.equal(pres(disk.files, key).length, 1)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('V-restore-transcribe-5: after going back to before the agent, a plain "go back" does not jump forward to a point that holds the agent\'s changes', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    openFile(small(), 'C:\\Videos\\five.snipp')
    const before = serializeProject(S().project)
    await cut('s1', 2, 6) // pre X, then the agent's cut lands
    S().runBatch([{ name: 'marker.add', params: { time: 3, note: 'mine' } }])
    await cut('s2', 1, 2) // session 2: pt Y (the agent's cut + the user's marker)
    const [x, y] = restorePoints()
    assert.deepEqual([x.kind, y.kind], ['pre', 'pt'])
    await restoreTo()
    assert.equal(serializeProject(S().project), before)
    assert.equal(restorePoints()[0], x, 'the point before the agent is still first in the list')
    await restoreTo()
    assert.equal(serializeProject(S().project), before, 'again the point before the agent, not Y')
    // Y is still there by name.
    await restoreTo(y.name)
    assert.equal((S().project.markers ?? []).length, 1)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('V-restore-transcribe-7: Save As (a new path) takes the point before the agent with it — in this run and after the app is started again', async () => {
  const disk = profile()
  let undo = setRestoreIo(disk.io)
  try {
    openFile(small(), null) // a new, unsaved project
    const before = serializeProject(S().project)
    const unsaved = projectKey()
    assert.match(unsaved, /^u/)
    await cut('s1', 2, 6)
    assert.equal(pres(disk.files, unsaved).length, 1)
    // The user saves it as P.
    moveProjectPath('C:\\Videos\\saved.snipp')
    const key = projectKey()
    assert.match(key, /^f/)
    assert.equal(restorePoints().length, 1, 'still this project\'s point')
    await ensureRestorePoint('s1')
    await settle()
    assert.equal(pres(disk.files, unsaved).length, 0)
    assert.equal(pres(disk.files, key).length, 1, 'the file in the profile carries the new key')
    const saved = JSON.parse(JSON.stringify(S().project)) as Project
    // The app is started again; the file is opened.
    undo()
    undo = setRestoreIo(disk.io)
    openFile(saved, 'C:\\Videos\\saved.snipp')
    await restoreTo()
    assert.equal(serializeProject(S().project), before)
    // Another file's point is refused by its name's key.
    openFile(small(), 'C:\\Videos\\other.snipp')
    await assert.rejects(restoreTo([...disk.files.keys()][0]), /belongs to another project/)
    await assert.rejects(restoreTo(), /no point before the agent/)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('V-restore-transcribe-6 / V-limits-sessions-5: the points of projects that are no longer open are not kept in memory; the same file opened again has its own', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    for (let i = 0; i < 12; i++) {
      openFile(small(`P${i % 2}`), i % 2 ? 'C:\\Videos\\b.snipp' : 'C:\\Videos\\a.snipp')
      await cut(`s${i}`, 2, 3)
      assert.ok(pointsInMemory() <= 3, `${pointsInMemory()} points in memory at open ${i}`)
    }
    // An unsaved project's points go when another project is opened.
    openFile(small(), null)
    await cut('u1', 2, 3)
    assert.equal(restorePoints().length, 1)
    openFile(small(), 'C:\\Videos\\a.snipp')
    assert.ok(restorePoints().every((p) => p.key === projectKey()))
    assert.ok(pointsInMemory() <= 1)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('D9: a refused edit writes no point (another session\'s draft waits); G10: a point that cannot be written refuses the edit and nothing is applied', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    openFile(small(), 'C:\\Videos\\nine.snipp', 'draft')
    await cut('sA', 2, 6) // A's draft waits
    S().runBatch([{ name: 'marker.add', params: { time: 3, note: 'mine' } }])
    const n = disk.writes.length
    await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }], base: read('other') }, { ...ctx('sB'), client: 'other', alive: () => true }), /another agent session .* has a draft waiting/)
    assert.equal(disk.writes.length, n, 'nothing written for the refused edit')
    rejectDraft()

    // G10: the profile cannot be written: the edit is refused, not applied.
    openFile(small(), 'C:\\Videos\\ten.snipp', 'direct')
    const live = S().project
    disk.fail.write = true
    await assert.rejects(cut('s1', 2, 6), /could not write the restore point .* nothing was applied/)
    assert.equal(S().project, live, 'nothing was applied')
    disk.fail.write = false
    await cut('s1', 2, 6)
    assert.notEqual(S().project, live)
  } finally {
    disk.fail.write = false
    undo()
    setLastProjectPath(null)
  }
})

test('a draft that is rejected, in a period with no agent change: its point is let go, the next change gets one of the project as it is then', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    openFile(small(), 'C:\\Videos\\draft.snipp', 'draft')
    const key = projectKey()
    await cut('s1', 2, 6)
    assert.equal(pres(disk.files, key).length, 1)
    rejectDraft()
    await settle()
    assert.equal(pres(disk.files, key).length, 0, 'no agent change ever followed it: not a point before the agent any more')
    // The user works on; the agent's next change, accepted: the point is the
    // project right before that accept.
    S().runBatch([{ name: 'marker.add', params: { time: 3, note: 'mine' } }])
    await cut('s2', 1, 2)
    const beforeAccept = S().project
    acceptDraft(undefined, 'now')
    assert.equal(restorePoints()[0].kind, 'pre')
    await restoreTo()
    assert.equal(serializeProject(S().project), serializeProject(beforeAccept))
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('V-restore-transcribe-4: clearing old points is not writing the point — a file that cannot be deleted does not fail the write; rekey and demote on disk', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-restore-b-'))
  try {
    const t0 = 1_700_000_000_000
    const names: string[] = []
    for (let i = 0; i < 7; i++) names.push((await writeRestorePoint(dir, `{"n":${i}}`, `pt-fabc12345-s${i}`, t0 + i))!.name)
    const folder = path.join(dir, 'agent-restore')
    assert.equal(readdirSync(folder).length, 5)
    // The prune step alone, with a delete that fails (a scanner holds the file).
    await writeRestorePoint(dir, '{"n":7}', 'pt-fabc12345-s7', t0 + 7)
    let tried = 0
    const gone = await pruneRestorePoints(folder, 'x', 'fabc12345', async () => {
      tried++
      throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
    })
    assert.equal(gone, 0)
    assert.equal(tried, 0, 'nothing to prune right after a write: the write pruned')
    // …and inside a write: six files there, the oldest cannot be deleted —
    // the write still gives its name.
    const made = await writeRestorePoint(dir, '{"n":8}', 'pt-fabc12345-s8', t0 + 8)
    assert.ok(made, 'written')
    const failing = await pruneRestorePoints(folder, made!.name, 'fabc12345', async () => { throw new Error('EPERM') })
    assert.equal(failing, 0)
    assert.ok(readdirSync(folder).includes(made!.name))

    // Save As: every point of the old key gets the new one.
    const pre = (await writeRestorePoint(dir, '{"pre":1}', 'pre-u11112222-s1', t0 + 20))!.name
    const map = await rekeyRestorePoints(dir, 'u11112222', 'f99998888')
    assert.deepEqual(Object.keys(map), [pre])
    assert.match(map[pre], /^\d{13}-pre-f99998888-s1-[a-z0-9]{6}\.snipp$/)
    assert.ok(readdirSync(folder).includes(map[pre]) && !readdirSync(folder).includes(pre))
    assert.deepEqual(await rekeyRestorePoints(dir, '../x', 'f1'), {}, 'only keys')
    // Gone back to: a session point from now on.
    const next = await demoteRestorePoint(dir, map[pre])
    assert.match(next!, /^\d{13}-pt-f99998888-s1-/)
    assert.equal(await demoteRestorePoint(dir, next), null, 'only a point before the agent')
    assert.equal(await demoteRestorePoint(dir, '..\\..\\x.snipp'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('while another file is being opened (its path is set, this project still loaded) a point is this project\'s, not that file\'s', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    openFile(small('A'), 'C:\\Videos\\a.snipp')
    const keyA = projectKey()
    assert.equal(restorePoints().length, 0)
    // Open… B: the path names B already; A is still what the window holds.
    setLastProjectPath('C:\\Videos\\b.snipp')
    const keyB = projectKey()
    assert.notEqual(keyA, keyB)
    await cut('s1', 2, 6) // an edit of the agent's lands in that gap
    assert.equal(pres(disk.files, keyB).length, 0, 'nothing of A is written as a point of B')
    assert.equal(pres(disk.files, keyA).length, 1)
    // B loads: A's points are not B's.
    rejectDraft()
    S().loadProject(small('B'))
    assert.equal(restorePoints().length, 0)
    await assert.rejects(restoreTo(), /no point before the agent/)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('Ç2a.2 P4: going back to the point before the agent keeps a relink made since (the media is not moved back)', async () => {
  const disk = profile()
  const undo = setRestoreIo(disk.io)
  try {
    const p = small('Relinked')
    Object.assign(p.assets[0], { url: '', missing: true, path: 'C:\old\talk.mp4' })
    openFile(p, 'C:\Videos\relinked.snipp')
    await cut('s1', 2, 6)
    // The user points the missing file at its new place.
    S().updateAsset('a1', { url: 'media://new', path: 'C:\new\talk.mp4', missing: undefined, duration: 50 } as Partial<Asset>)
    await restoreTo()
    const a = S().project.assets.find((x) => x.id === 'a1')!
    assert.equal(Object.keys(S().project.clips).length, 1, 'back to before the cut')
    assert.ok(!a.missing, 'not missing again')
    assert.equal(a.path, 'C:\new\talk.mp4')
    assert.equal(a.url, 'media://new')
    assert.equal(a.duration, 50)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})
