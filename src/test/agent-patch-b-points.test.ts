// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.11, Bölüm B (tarifler/FAZ4A-YAMA.md P1–P3): the
// round-2 reviewers' restore point probes RP1–RP8 as tests, each with its
// new behaviour, on real files in a throw-away profile (main/agent-restore.ts
// behind the page's restore.ts, as the app wires them). Each rule's test
// fails when the rule is taken back (scripts/mutate.mjs, B-mutations).
import './dom-stub'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { demoteRestorePoint, listRestorePoints, noteRestoreSave, openedRestoreFile, pruneList, readRestorePoint, rekeyRestorePoints, writeRestorePoint } from '../main/agent-restore'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, newProjectUid, type Asset, type Clip, type Project } from '../renderer/src/types'
import { editTool, type EditContext } from '../renderer/src/agent/edit'
import { rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { useAgentStore } from '../renderer/src/agent/store'
import { ensureRestorePoint, movePointsWithFile, pointsSettled, projectKey, restorePoints, restoreTo, setRestoreIo, type RestoreIo } from '../renderer/src/agent/restore'
import { getLastProjectPath, moveProjectPath, newSaveId, noteOpenedFile, projectWritten, readProjectToOpen, recoveryText, serializeProject, setLastProjectPath, setRecoveredProjectPath } from '../renderer/src/media/projectio'
import { read } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})
const ROOT = path.join(process.cwd(), 'out-test', 'b-points')
let n = 0
async function profileDir(): Promise<{ io: RestoreIo; dir: string; userData: string }> {
  const userData = path.join(ROOT, `p${process.pid}-${Date.now()}-${++n}`)
  await fs.mkdir(userData, { recursive: true })
  const io: RestoreIo = {
    write: async (json, label) => {
      await new Promise((r) => setTimeout(r, 2))
      const w = await writeRestorePoint(userData, json, label)
      return w ? { name: w.name, ...(w.over ? { over: w.over } : {}) } : null
    },
    read: (name) => readRestorePoint(userData, name),
    list: () => listRestorePoints(userData),
    rekey: (from, to, copy) => rekeyRestorePoints(userData, from, to, copy),
    demote: (name) => demoteRestorePoint(userData, name),
    saved: (key, id) => noteRestoreSave(userData, key, id),
    opened: (key, id) => openedRestoreFile(userData, key, id)
  }
  return { io, dir: path.join(userData, 'agent-restore'), userData }
}
const files = async (dir: string): Promise<string[]> => (await fs.readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.snipp')).sort()
function small(name: string, uid = newProjectUid(), length = 20): Project {
  const p = defaultProject()
  p.name = name
  p.uid = uid
  const a: Asset = { id: 'a1', kind: 'video', name: 'talk.mp4', url: 'media://x', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true }
  p.assets = [a]
  const v1 = p.tracks[0]
  p.clips = { c1: { id: 'c1', assetId: 'a1', trackId: v1.id, start: 0, inPoint: 0, duration: length, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  return p
}
const ctx = (session: string): EditContext => ({ session, client: 'test', results: new Map(), beforeFirstEdit: async () => void (await ensureRestorePoint(session)), told: () => undefined })
const cut = (session: string, a: number, b: number) => editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[a, b]] }], base: read() }, ctx(session))
/** Opens a project file's text as the app does (projectio.ts openProjectByPath). */
function openText(text: string, file: string | null): void {
  rejectDraft()
  const { project, saveId } = readProjectToOpen(text)
  setLastProjectPath(file)
  if (file) noteOpenedFile(file, saveId)
  S().loadProject(project)
  useAgentStore.getState().setMode('direct')
}
/** A file's text as the app wrote it last (no save: a file never saved by this app). */
const fileOf = (p: Project, saveId?: string): string => serializeProject(p, saveId ? { saveId } : undefined)
/** The app saves the open project to its file (Ctrl+S, the autosave): the text written. */
function save(file: string, how: 'quick' | 'saveAs' = 'quick'): string {
  const id = newSaveId()
  const text = serializeProject(S().project, { saveId: id })
  projectWritten(file, id, how)
  return text
}
const len = (p: Project = S().project): number => Object.values(p.clips).reduce((m, c) => Math.max(m, c.start + c.duration), 0)
const tryRestore = async (): Promise<string> => restoreTo().then(() => `${S().project.name} ${len().toFixed(2)}`, (e: Error) => `error: ${e.message}`)
/** Every point before the agent on disk, as "name length". */
async function pres(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const f of await files(dir)) {
    if (!/^\d{13}-pre-/.test(f)) continue
    const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Project
    out.push(`${p.name} ${len(p).toFixed(2)}`)
  }
  return out
}
/** A new window: what was in memory is forgotten. */
function restart(io: RestoreIo, undo: () => void): () => void {
  undo()
  return setRestoreIo(io)
}

test('RP1 crash recovery of a saved project keeps its file for the restore points (P1): "before the agent" is found, and no later state takes that name', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\rp1.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    await pointsSettled()
    assert.deepEqual(await pres(dir), ['A 20.00'])
    // The crash snapshot names the file; the recovered project is saved
    // nowhere (Save asks for a name) but keeps that file's points.
    const snapshot = recoveryText(S().project)
    undo = restart(io, undo)
    const rec = readProjectToOpen(snapshot)
    assert.equal(rec.recoveredPath, A)
    assert.equal((rec.project as unknown as Record<string, unknown>).recoveredFromFile, undefined, 'the field stays in the snapshot')
    setRecoveredProjectPath(rec.recoveredPath ?? null)
    S().loadProject(rec.project)
    assert.equal(getLastProjectPath(), null)
    // The agent goes on: no new point before the agent is written (the
    // file's is found); the user saves over the file; after a restart the
    // file's point is still the one before the agent.
    await cut('s2', 1, 2)
    await pointsSettled()
    assert.deepEqual(await pres(dir), ['A 20.00'])
    const text = save(A, 'saveAs')
    await pointsSettled()
    assert.deepEqual(await pres(dir), ['A 20.00'])
    assert.equal(restorePoints()[0].kind, 'pre')
    undo = restart(io, undo)
    openText(text, A)
    assert.equal(await tryRestore(), 'A 20.00')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP1 the point before the agent is found right after the recovery (P1)', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\Videos\rp1a.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const snapshot = recoveryText(S().project)
    undo = restart(io, undo)
    const rec = readProjectToOpen(snapshot)
    setRecoveredProjectPath(rec.recoveredPath ?? null)
    S().loadProject(rec.project)
    assert.equal(await tryRestore(), 'A 20.00')
    // A snapshot of an unsaved project names no file.
    setLastProjectPath(null)
    assert.equal(readProjectToOpen(recoveryText(S().project)).recoveredPath, undefined)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP1 / P1: a project moved onto its file, which holds an OLDER point before the agent of the same project: that one stays, the newer becomes a session point', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\rp1b.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const after = S().project
    // A snapshot of an older version (no file named in it): the project is
    // unsaved, the agent's next change writes a point before it — of a
    // state after the agent's first cut.
    undo = restart(io, undo)
    openText(fileOf(after), null)
    await cut('s2', 1, 2)
    await pointsSettled()
    assert.deepEqual((await pres(dir)).sort(), ['A 16.00', 'A 20.00'])
    // Saved over its file: the file's older point stays "before the agent".
    save(A, 'saveAs')
    await pointsSettled()
    assert.deepEqual(await pres(dir), ['A 20.00'])
    assert.equal((await files(dir)).length, 2, 'the newer one is kept as a session point')
    assert.equal(await tryRestore(), 'A 20.00')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP2 another file with the same identity put at the path (outside the app): its old point before the agent is not offered (P3)', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const uid = newProjectUid()
    const EP1 = 'C:\\Videos\\ep1.snipp'
    const ep1 = fileOf(small('Episode 1', uid))
    openText(ep1, EP1)
    await cut('s1', 2, 6)
    await pointsSettled()
    // The same file opened again, unchanged: its point stays.
    undo = restart(io, undo)
    openText(ep1, EP1)
    assert.equal(await tryRestore(), 'Episode 1 20.00')
    undo = restart(io, undo)
    openText(ep1, EP1)
    await cut('s1b', 2, 6)
    await pointsSettled()
    // Episode 2 (the same template, saved by the app elsewhere) copied over
    // ep1.snipp in Explorer, then opened.
    undo = restart(io, undo)
    openText(fileOf(small('Episode 2', uid, 33), newSaveId()), EP1)
    assert.match(await tryRestore(), /^error: There is no point before the agent/)
    await pointsSettled()
    assert.deepEqual(await pres(dir), [], 'a session point now')
    assert.equal((await files(dir)).length, 2, 'kept, not deleted')
    await cut('s2', 1, 2)
    assert.equal(await tryRestore(), 'Episode 2 33.00')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP2 / P3: what the app itself saves keeps the point; another program writing the file does not', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\rp2b.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const text = save(A)
    await pointsSettled()
    undo = restart(io, undo)
    openText(text, A)
    assert.equal(await tryRestore(), 'A 20.00')
    // Written by another program (the same project, its save id gone).
    undo = restart(io, undo)
    openText(text, A)
    await cut('s2', 2, 6)
    const mine = save(A)
    await pointsSettled()
    undo = restart(io, undo)
    const theirs = JSON.parse(mine) as Record<string, unknown>
    delete theirs.saveId
    theirs.name = 'A, by a film tool'
    openText(JSON.stringify(theirs), A)
    await pointsSettled()
    assert.deepEqual(await pres(dir), [])
    assert.match(await tryRestore(), /^error: There is no point before the agent/)
    // The window that had it open in memory is told the same on its next open.
    undo = restart(io, undo)
    openText(mine, A)
    await cut('s3', 1, 2)
    await pointsSettled()
    assert.equal(restorePoints()[0].kind, 'pre')
    openText(JSON.stringify({ ...theirs, saveId: newSaveId() }), A)
    await pointsSettled()
    assert.ok(restorePoints().every((p) => p.kind === 'pt'), JSON.stringify(restorePoints().map((p) => [p.name, p.kind])))
    assert.match(await tryRestore(), /^error: There is no point before the agent/)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP3 Save As a copy: the ORIGINAL file keeps its point before the agent, and the copy has one too (P2)', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\rp3.snipp'
    const COPY = 'C:\\Videos\\rp3-backup.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const onA = save(A) // the autosave writes the agent's cut
    const onCopy = save(COPY, 'saveAs') // Save As a backup copy
    await pointsSettled()
    assert.deepEqual(await pres(dir), ['A 20.00', 'A 20.00'])
    undo = restart(io, undo)
    openText(onA, A) // next day: the original file
    assert.equal(await tryRestore(), 'A 20.00')
    await cut('s2', 1, 2)
    assert.equal(await tryRestore(), 'A 20.00')
    undo = restart(io, undo)
    openText(onCopy, COPY)
    assert.equal(await tryRestore(), 'A 20.00')
    // A rename moves them (the old path keeps none).
    undo = restart(io, undo)
    openText(onCopy, COPY)
    moveProjectPath('C:\\Videos\\rp3-renamed.snipp')
    await pointsSettled()
    assert.equal((await files(dir)).filter((f) => f.includes(`-${projectKey(COPY)}.`)).length, 0)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP4 the cap with many projects: no point before the agent is pruned to make room (held)', () => {
  const names: string[] = []
  for (let p = 0; p < 50; p++) {
    names.push(`17000000${String(p).padStart(3, '0')}00-pre-f${String(p).padStart(8, '0')}.aaaaaaaa-s1-abcdef.snipp`)
    names.push(`17000000${String(p).padStart(3, '0')}01-pt-f${String(p).padStart(8, '0')}.aaaaaaaa-s1-abcdef.snipp`)
  }
  const gone = pruneList(names, 'f00000049')
  assert.equal(gone.length, 50)
  assert.equal(gone.filter((g) => g.includes('-pre-')).length, 0)
})

test('RP5 names, keys, labels and save ids from the page cannot reach outside the folder (held, and the new calls)', async () => {
  const { userData, dir } = await profileDir()
  const outside = path.join(userData, 'victim.snipp')
  await fs.writeFile(outside, 'VICTIM')
  await fs.mkdir(dir, { recursive: true })
  assert.equal(await readRestorePoint(userData, '..\\victim.snipp'), null)
  assert.equal(await readRestorePoint(userData, '1700000000000-..\\..\\victim.snipp'), null)
  assert.equal(await demoteRestorePoint(userData, '1700000000000-pre-..\\victim.x-s-abcdef.snipp'), null)
  assert.deepEqual(await rekeyRestorePoints(userData, '..', 'x'), {})
  assert.deepEqual(await rekeyRestorePoints(userData, 'x', '..\\..', true), {})
  assert.equal(await noteRestoreSave(userData, '..\\victim', 'x'), false)
  assert.equal(await noteRestoreSave(userData, 'fabc', '../../x'), false)
  assert.deepEqual(await openedRestoreFile(userData, '..', 'x'), {})
  assert.deepEqual(await openedRestoreFile(userData, 'fabc', 'a/b'), {})
  const w1 = await writeRestorePoint(userData, '{}', 'pre-../../victim-x')
  const w2 = await writeRestorePoint(userData, '{}', '../../../victim')
  assert.ok(w1 && w2 && path.dirname(w1.path) === dir && path.dirname(w2.path) === dir)
  assert.equal(await fs.readFile(outside, 'utf8'), 'VICTIM')
  assert.deepEqual((await fs.readdir(userData)).sort(), ['agent-restore', 'victim.snipp'])
  // The save ids file is no point: never listed, never pruned.
  assert.equal(await noteRestoreSave(userData, 'fabc', 'sOk1'), true)
  assert.ok((await listRestorePoints(userData)).every((p) => p.name !== 'saves.json'))
  assert.ok(!pruneList(await fs.readdir(dir), undefined, 0).includes('saves.json'))
})

test('RP6 a closed project renamed, restart, the renamed file opened: its point (held; its save id goes along)', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\rp6.snipp'
    const B = 'C:\\Videos\\rp6-renamed.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const text = save(A)
    openText(fileOf(small('Other')), 'C:\\Videos\\rp6-other.snipp')
    await movePointsWithFile(A, B)
    undo = restart(io, undo)
    openText(text, B)
    assert.equal(await tryRestore(), 'A 20.00')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP6 / P3: the renamed file changed outside the app is told by the save id the rename took along', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\Videos\rp6b.snipp'
    const B = 'C:\Videos\rp6b-renamed.snipp'
    openText(fileOf(small('A')), A)
    await cut('s1', 2, 6)
    const text = save(A)
    openText(fileOf(small('Other')), 'C:\Videos\rp6b-other.snipp')
    await movePointsWithFile(A, B)
    undo = restart(io, undo)
    const theirs = JSON.parse(text) as Record<string, unknown>
    delete theirs.saveId
    theirs.name = 'A, by a film tool'
    openText(JSON.stringify(theirs), B)
    assert.match(await tryRestore(), /^error: There is no point before the agent/)
    assert.deepEqual(await pres(dir), [])
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP7 two copies (one identity) at two paths, the agent on both: each gets its own (held)', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const uid = newProjectUid()
    const X = 'C:\\Videos\\rp7-x.snipp'
    const Y = 'C:\\Videos\\rp7-y.snipp'
    openText(fileOf(small('X', uid)), X)
    await cut('s1', 2, 6)
    const xAfter = save(X)
    openText(fileOf(small('Y', uid, 30)), Y)
    await cut('s2', 2, 6)
    const yAfter = save(Y)
    undo = restart(io, undo)
    openText(xAfter, X)
    assert.equal(await tryRestore(), 'X 20.00')
    undo = restart(io, undo)
    openText(yAfter, Y)
    assert.equal(await tryRestore(), 'Y 30.00')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('RP8 an old file without an identity: saved by the app after the agent, its point; never saved, none (held)', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const O = 'C:\\Videos\\rp8-old.snipp'
    const old = small('Old')
    delete old.uid
    const onDisk = fileOf(old)
    openText(onDisk, O)
    await cut('s1', 2, 6)
    const after = save(O) // the autosave writes the agent's cut, with the identity
    undo = restart(io, undo)
    openText(after, O)
    assert.equal(await tryRestore(), 'Old 20.00')
    // Never written (autosave off): the old text has no identity, it gets
    // another one when opened, and no point is of it.
    undo = restart(io, undo)
    openText(onDisk, O)
    assert.match(await tryRestore(), /^error: There is no point before the agent/)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})
