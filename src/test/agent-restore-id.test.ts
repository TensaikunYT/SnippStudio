// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.10, part II (FAZ4A-PLAN.md 9, E): the point before the
// agent belongs to the project's identity (kept in its file), not to a path;
// a project's point before the agent is never deleted to make room; the
// point moved to right before an accept is written, and waited for, before
// the accept. With the REAL main-process file functions on a folder (inside
// out-test), as the reviewers' probes did (haritalar\_faz4a9-dogrulama.md,
// safety#2, #3, #5, #8).
import './dom-stub'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { demoteRestorePoint, listRestorePoints, pruneList, readRestorePoint, rekeyRestorePoints, RESTORE_MAX_FILES, writeRestorePoint } from '../main/agent-restore'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, newProjectUid, type Asset, type Clip, type Project } from '../renderer/src/types'
import { editTool, type EditContext } from '../renderer/src/agent/edit'
import { rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { useAgentStore } from '../renderer/src/agent/store'
import { acceptSaved, ensureRestorePoint, identityOf, movePointsWithFile, pointsSettled, onRestoreNotice, projectKey, restorePoints, restoreTo, setRestoreIo, type RestoreIo, type RestoreNotice } from '../renderer/src/agent/restore'
import { moveProjectPath, readProjectToOpen, setLastProjectPath, serializeProject } from '../renderer/src/media/projectio'
import { read } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

const ROOT = path.join(process.cwd(), 'out-test', 'restore-folders')
let n = 0
/** A profile folder of its own, and the page's access to it through the
 *  real main-process functions. `failWrites` makes the next writes fail. */
async function profileDir(): Promise<{ io: RestoreIo; dir: string; failWrites: { on: boolean } }> {
  const userData = path.join(ROOT, `p${process.pid}-${Date.now()}-${++n}`)
  await fs.mkdir(userData, { recursive: true })
  const failWrites = { on: false }
  const io: RestoreIo = {
    write: async (json, label) => {
      if (failWrites.on) return null
      await new Promise((r) => setTimeout(r, 2)) // distinct milliseconds in the names
      const w = await writeRestorePoint(userData, json, label)
      return w ? { name: w.name, ...(w.over ? { over: w.over } : {}) } : null
    },
    read: (name) => readRestorePoint(userData, name),
    list: () => listRestorePoints(userData),
    rekey: (from, to) => rekeyRestorePoints(userData, from, to),
    demote: (name) => demoteRestorePoint(userData, name)
  }
  return { io, dir: path.join(userData, 'agent-restore'), failWrites }
}
const files = async (dir: string): Promise<string[]> => (await fs.readdir(dir).catch(() => [] as string[])).sort()
test.after(async () => void (await fs.rm(ROOT, { recursive: true, force: true })))

/** A project as the app makes one (New): with its identity. */
function small(name: string): Project {
  const p = defaultProject()
  p.name = name
  p.uid = newProjectUid()
  const a: Asset = { id: 'a1', kind: 'video', name: 'talk.mp4', url: 'media://x', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true }
  p.assets = [a]
  const v1 = p.tracks[0]
  p.clips = { c1: { id: 'c1', assetId: 'a1', trackId: v1.id, start: 0, inPoint: 0, duration: 20, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  return p
}
const ctx = (session: string): EditContext => ({ session, client: 'test', results: new Map(), beforeFirstEdit: async () => void (await ensureRestorePoint(session)), told: () => undefined })
const cut = (session: string, a: number, b: number) => editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[a, b]] }], base: read() }, ctx(session))
/** The renames on disk under way are through (not a guess at a time: under
 *  load 30 ms was not enough). */
const settle = (): Promise<void> => pointsSettled()
/** The project as its file holds it (what a restart opens). */
const saved = (): Project => JSON.parse(serializeProject(S().project)) as Project
function openFile(p: Project, file: string | null, mode: 'draft' | 'direct' = 'direct'): void {
  rejectDraft()
  setLastProjectPath(file)
  S().loadProject(p)
  useAgentStore.getState().setMode(mode)
}

test('E1 (safety#2): Save As over a file that has its own point before the agent — going back gives the MOVED project, in this run and after a restart; nothing of it is pruned', async () => {
  const { io, dir } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\e1-a.snipp'
    const B = 'C:\\Videos\\e1-b.snipp'
    openFile(small('A-original'), A)
    const aOriginal = serializeProject(S().project)
    await cut('s1', 2, 6) // Monday: A's point before the agent
    const aAfter = saved()
    undo(); undo = setRestoreIo(io)
    openFile(small('B-original'), B)
    const bId = identityOf(S().project)
    await cut('s2', 1, 3) // Tuesday: B's, newer
    undo(); undo = setRestoreIo(io)
    openFile(aAfter, A) // Wednesday: a.snipp again, the agent works, Save As b.snipp
    await cut('s3', 0.5, 1)
    moveProjectPath(B)
    await settle()
    // The overwritten file's point before the agent is a session point now.
    const bKey = projectKey(B)
    assert.deepEqual((await files(dir)).filter((f) => f.includes(`-pre-${bKey}.${bId}-`)), [], "B's point before the agent was turned into a session point")
    const bOld = (await files(dir)).filter((f) => f.includes(`-pt-${bKey}.${bId}-`))
    assert.equal(bOld.length, 1)
    // …and by its name it is still another project's: not put back here.
    await assert.rejects(restoreTo(bOld[0]), /belongs to another project/)
    // The user and the agent go on: a session point is written (and the folder pruned).
    S().runBatch([{ name: 'marker.add', params: { time: 9, note: 'user' } }])
    await cut('s4', 0.2, 0.4)
    await settle()
    // This run: the point listed first is A's before the agent, on disk.
    const first = restorePoints()[0]
    assert.equal(first.kind, 'pre')
    assert.equal((await io.read!(first.name))?.json, aOriginal, 'this run: A before the agent, still on disk')
    // After a restart, the file b.snipp (= the moved A) opened again.
    const now = saved()
    undo(); undo = setRestoreIo(io)
    openFile(now, B)
    await restoreTo()
    assert.equal(S().project.name, 'A-original')
    assert.equal(serializeProject(S().project), aOriginal, 'after a restart: the moved project\'s point, not the overwritten file\'s')
    assert.ok((await files(dir)).some((f) => /-pt-/.test(f)), 'the overwritten file\'s point is a session point now')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('E1 (safety#2, R3): a new project saved over a path whose old file had a point before the agent does not take that point', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const B = 'C:\\Videos\\e1-r3.snipp'
    openFile(small('B-old'), B)
    await cut('s1', 1, 3)
    undo(); undo = setRestoreIo(io)
    // A later run: a brand new project, saved as that path, then the agent.
    openFile(small('NEW'), null)
    const fresh = serializeProject(S().project)
    moveProjectPath(B)
    await settle()
    await cut('s2', 2, 4)
    await restoreTo()
    assert.equal(S().project.name, 'NEW')
    assert.equal(serializeProject(S().project), fresh)
    // The same through a restart: the file opened again, no point in memory.
    const now = saved()
    await cut('s3', 2, 4)
    undo(); undo = setRestoreIo(io)
    openFile(now, B)
    await restoreTo()
    assert.equal(S().project.name, 'NEW', 'never the old file\'s project')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('E1 (safety#3): restart → open → Save As before the agent\'s first call → the agent edits → back to before the agent = the original', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\e1-s3.snipp'
    const A2 = 'C:\\Videos\\e1-s3-copy.snipp'
    openFile(small('A-original'), A)
    const original = serializeProject(S().project)
    await cut('s1', 2, 6) // run 1: the agent's cut
    const afterAgent = saved()
    undo(); undo = setRestoreIo(io)
    openFile(afterAgent, A) // the app started again, the file opened
    moveProjectPath(A2) // Save As, before any agent call of this run
    await settle()
    await cut('s2', 0.5, 1) // the agent works on the copy
    await restoreTo()
    assert.equal(serializeProject(S().project), original, 'the point went with the file; not a state with the agent\'s run-1 cut')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('E1 (safety#3): a CLOSED project renamed from the Projects list takes its points along', async () => {
  const { io } = await profileDir()
  let undo = setRestoreIo(io)
  try {
    const A = 'C:\\Videos\\e1-closed.snipp'
    const A2 = 'C:\\Videos\\e1-closed-renamed.snipp'
    openFile(small('A-original'), A)
    const original = serializeProject(S().project)
    await cut('s1', 2, 6)
    const afterAgent = saved()
    openFile(small('Other'), 'C:\\Videos\\other.snipp') // A is closed
    await movePointsWithFile(A, A2)
    undo(); undo = setRestoreIo(io)
    openFile(afterAgent, A2)
    await restoreTo()
    assert.equal(serializeProject(S().project), original)
    // …and a new file at the old path does not find them.
    openFile(small('At the old path'), A)
    await assert.rejects(restoreTo(), /no point before the agent/)
  } finally {
    undo()
    setLastProjectPath(null)
  }
})

test('E2 (safety#5): past 40 files only session points are pruned — another project\'s point before the agent is never deleted; the overflow is told', async () => {
  // Pure: project X (a point before the agent and a session point, the
  // oldest) and seven projects with a point before the agent and five
  // session points each.
  const names = ['1700000000001-pre-fxxxxxxxx.aaaaaaaa-s1-abcdef.snipp', '1700000000002-pt-fxxxxxxxx.aaaaaaaa-s1-abcdef.snipp']
  for (let p = 0; p < 7; p++) {
    names.push(`17000000010${p}0-pre-f0000000${p}.bbbbbbb${p}-s1-abcdef.snipp`)
    for (let k = 1; k <= 5; k++) names.push(`17000000010${p}${k}-pt-f0000000${p}.bbbbbbb${p}-s1-abcdef.snipp`)
  }
  const gone = pruneList(names, 'f00000006')
  assert.equal(names.length - gone.length, RESTORE_MAX_FILES)
  assert.ok(!gone.some((g) => /-pre-/.test(g)), `no point before the agent pruned: ${gone.filter((g) => /-pre-/.test(g))}`)
  assert.ok(gone.includes(names[1]), 'the oldest session point went first')
  // Two points before the agent under one path, of two projects (a file
  // written over by another): neither is taken for the other, both kept.
  const two = ['1700000000001-pre-fabc.aaaaaaaa-s1-abcdef.snipp', '1700000000002-pre-fabc.bbbbbbbb-s1-abcdef.snipp', '1700000000003-pre-fabc.bbbbbbbb-s2-abcdef.snipp']
  assert.deepEqual(pruneList(two, 'fabc'), [two[1]], 'per project identity: only the older of the same project goes')
  // Only points before the agent past the cap: none deleted, the write says how far over.
  const { io } = await profileDir()
  const told: RestoreNotice[] = []
  const off = onRestoreNotice((x) => told.push(x))
  let undo = setRestoreIo(io)
  try {
    for (let i = 0; i <= RESTORE_MAX_FILES; i++) {
      undo(); undo = setRestoreIo(io)
      openFile(small(`P${i}`), `C:\\Videos\\many-${i}.snipp`)
      await cut('s1', 1, 2)
    }
    assert.equal(told.filter((x) => x.key === 'agent.restoreFull').length, 1, `told when it went over: ${JSON.stringify(told)}`)
    // More writes while the folder stays as far over (a session point, pruned
    // again at once): not told again at every write.
    for (let k = 0; k < 2; k++) {
      S().runBatch([{ name: 'marker.add', params: { time: 5 + k, note: 'user' } }])
      await cut(`s${k + 2}`, 3, 4)
    }
    assert.equal(told.filter((x) => x.key === 'agent.restoreFull').length, 1, `told once: ${JSON.stringify(told)}`)
  } finally {
    off()
    undo()
    setLastProjectPath(null)
  }
})

test('E2 (safety#8): the point moved to right before an accept is written and waited for; when it cannot be written, nothing is accepted and the user is told', async () => {
  const { io, failWrites } = await profileDir()
  const told: RestoreNotice[] = []
  const off = onRestoreNotice((x) => told.push(x))
  let undo = setRestoreIo(io)
  try {
    const P = 'C:\\Videos\\e2-accept.snipp'
    // Written: the user's work while the draft waited is in the point after a restart.
    openFile(small('Before'), P, 'draft')
    await cut('s1', 2, 6)
    S().runBatch([{ name: 'marker.add', params: { time: 15, note: 'USERWORK' } }])
    const beforeAccept = serializeProject(S().project)
    await acceptSaved(undefined, 'now')
    const now = saved()
    undo(); undo = setRestoreIo(io)
    openFile(now, P)
    await restoreTo()
    assert.equal(serializeProject(S().project), beforeAccept, 'after a restart: the project right before the accept')
    // Not written: refused, nothing accepted.
    undo(); undo = setRestoreIo(io)
    openFile(small('Again'), 'C:\\Videos\\e2-accept-2.snipp', 'draft')
    await cut('s1', 2, 6)
    S().runBatch([{ name: 'marker.add', params: { time: 15, note: 'USERWORK' } }])
    const version = S().projectVersion
    failWrites.on = true
    await assert.rejects(acceptSaved(undefined, 'now'), /Nothing was accepted/)
    assert.equal(S().projectVersion, version, 'the live project is untouched')
    assert.ok(told.some((x) => x.key === 'agent.restoreFailed'))
  } finally {
    failWrites.on = false
    off()
    undo()
    setLastProjectPath(null)
  }
})

test('E1: the identity is in the file and in the point\'s name; a file opened without one gets one', async () => {
  const p = small('X')
  delete p.uid
  const read1 = readProjectToOpen(serializeProject(p)).project
  assert.match(read1.uid ?? '', /.{8,}/)
  assert.notEqual(readProjectToOpen(serializeProject(p)).project.uid, read1.uid, 'each reading of an old file is a project of its own until it is saved')
  assert.equal(readProjectToOpen(serializeProject(read1)).project.uid, read1.uid, 'kept in the file')
  const { io, dir } = await profileDir()
  const undo = setRestoreIo(io)
  try {
    const P = 'C:\\Videos\\id.snipp'
    openFile(read1, P)
    await cut('s1', 1, 2)
    assert.ok((await files(dir)).some((f) => f.includes(`-pre-${projectKey(P)}.`)), 'the identity is in the point\'s name')
  } finally {
    undo()
    setLastProjectPath(null)
  }
})
