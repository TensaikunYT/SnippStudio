// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e + 5f audit patch (tarifler\FAZ5-YAMA-EF.md): code_clip create
// with the main process stood in for (api-stub). A2: create's seconds are of
// the version the agent last read (4A.8's one rule); A1: the range asked is
// kept at accept or the op drops with its reason; A4: a refused create makes
// nothing; A3: a film only a rejected / undone create used leaves the project.
import './api-stub'
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { stubApi } from './api-stub'
import { useStore } from '../renderer/src/state/store'
import { acceptDraft, currentDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import * as CC from '../renderer/src/agent/code-clip'
import { prepareCreate } from '../renderer/src/agent/code-clip'
import { ctxOf, open, read, talk } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

const made: string[] = []
stubApi({
  codeFilm: {
    makeAnim: async (_project: string, name: string) => {
      made.push(name)
      return { ok: true, folder: `C:\\proj\\anim\\${name}`, existed: false }
    },
    register: async (folder: string) => ({ name: folder.split('\\').pop(), root: folder, url: `snippfilm://${folder.split('\\').pop()}/`, meta: {} })
  } as never
})

const PROJECT = 'C:\\proj\\talk.snipp'
/** What code_clip create does in host.ts: the folder and film, then the edit. */
async function create(args: Record<string, unknown>, client = 'test'): Promise<{ text: string; clip?: string }> {
  // (Called as host.ts calls it; cast so the test compiles on the tree before A2 too.)
  const p = await (prepareCreate as (...a: unknown[]) => ReturnType<typeof prepareCreate>)(args, PROJECT, client, 's1')
  let out: string
  try {
    out = await editTool(p.place as unknown as Record<string, unknown>, ctxOf({ client }))
  } finally {
    // (As host.ts does; absent on the tree before A3.)
    ;(CC as { createDone?: (id: string) => void }).createDone?.(p.assetId)
  }
  const clip = /clip=([A-Za-z0-9_-]+)/.exec(out)?.[1] ?? Object.keys(currentDraft()?.project.clips ?? {}).find((id) => currentDraft()!.project.clips[id].assetId === p.assetId)
  return { text: `${p.head}\n${out}`, ...(clip ? { clip } : {}) }
}

test('A2: the user cuts 0–2 s after the agent read: create {5,7} does not land silently on the second the agent did not mean', async () => {
  open(talk(20))
  read()
  S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[0, 2]] } }])
  const r = await create({ name: 'stale', start: 5, end: 7 })
  const d = currentDraft()
  const placed = d && r.clip ? d.project.clips[r.clip] : undefined
  // The edit tool with that read's base drops the same placement: so must create.
  assert.equal(placed, undefined, `placed at ${placed?.start} (the read's second 5 is at 3 now): ${r.text}`)
  assert.match(r.text, /footage under where it puts a clip is not the footage/)
  rejectDraft()
})

test('A2: a cut after the range (the footage under it unchanged): create lands where asked', async () => {
  open(talk(20))
  read()
  S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[15, 17]] } }])
  const r = await create({ name: 'later', start: 5, end: 7 })
  const c = r.clip ? currentDraft()?.project.clips[r.clip] : undefined
  assert.ok(c && c.start === 5 && c.duration === 2, r.text)
  rejectDraft()
})

test('A2: with no change since the read, three creates after one read all land where asked', async () => {
  open(talk(20))
  read()
  const clips: string[] = []
  for (const [n, a, b] of [['u1', 1, 3], ['u2', 4, 6], ['u3', 7, 9]] as const) {
    const r = await create({ name: n, start: a, end: b })
    assert.ok(r.clip, r.text)
    clips.push(r.clip!)
  }
  const d = currentDraft()!
  assert.deepEqual(clips.map((id) => [d.project.clips[id].start, d.project.clips[id].duration]), [[1, 2], [4, 2], [7, 2]])
  const acc = acceptDraft(undefined, 'now')
  assert.equal(acc.dropped.length, 0, JSON.stringify(acc.dropped))
  assert.deepEqual(clips.map((id) => [S().project.clips[id]?.start, S().project.clips[id]?.duration]), [[1, 2], [4, 2], [7, 2]])
})

test('A2: an agent that never read: create is placed on the project as it is', async () => {
  open(talk(20))
  const r = await create({ name: 'noread', start: 2, end: 4 }, 'never-read')
  assert.ok(r.clip && currentDraft()!.project.clips[r.clip].start === 2, r.text)
  rejectDraft()
})

// ---- A1: the range asked is the clip's at accept ------------------------------------

/** create {start,end}; the film then says `learnt` s; accept: the live clip. */
async function learnAndAccept(start: number, end: number, learnt: number, name: string): Promise<{ clip?: { start: number; duration: number }; dropped: string[] }> {
  open(talk(20))
  read()
  const r = await create({ name, start, end })
  const asset = currentDraft()!.project.clips[r.clip!].assetId
  // (What media/codefilm.ts does when the page runs and says its length.)
  S().setAssetDerived(asset, { duration: learnt })
  const acc = acceptDraft(undefined, 'now')
  const c = S().project.clips[r.clip!]
  return { ...(c ? { clip: { start: c.start, duration: c.duration } } : {}), dropped: acc.dropped.map((x) => x.reason) }
}

test('A1: the film learns 10 s after create {1,3}: the accepted clip is 1–3, not 1–11', async () => {
  const r = await learnAndAccept(1, 3, 10, 'learn10')
  assert.deepEqual(r.clip, { start: 1, duration: 2 }, JSON.stringify(r))
})

test('A1: the film learns 1 s after create {4,6}: the accepted clip is still 4–6', async () => {
  const r = await learnAndAccept(4, 6, 1, 'learn1')
  assert.deepEqual(r.clip, { start: 4, duration: 2 }, JSON.stringify(r))
})

test('A1: the user puts another folder (9 s) in the film while the draft waits: 4–6 stays 4–6', async () => {
  open(talk(20))
  read()
  const r = await create({ name: 'swap', start: 4, end: 6 })
  const asset = currentDraft()!.project.clips[r.clip!].assetId
  S().setAssetDerived(asset, { path: 'C:\\other', duration: 9, width: 800, height: 800 })
  const acc = acceptDraft(undefined, 'now')
  const c = S().project.clips[r.clip!]
  assert.deepEqual(c && { start: c.start, duration: c.duration }, { start: 4, duration: 2 }, JSON.stringify(acc.dropped))
})

// ---- A5: frames context:true gives a code clip's own seconds ----------------------

test('A5: over a code clip at 4–9 s, speed 2, in point 1: a line said at timeline 5.5 is its film second 4', async () => {
  const { rangeContext } = await import('../renderer/src/agent/format')
  const p = talk(20)
  p.captions = [{ id: 'l1', start: 5.5, end: 7, text: 'said at 5.5' } as never]
  p.assets.push({ id: 'cf', kind: 'code', name: 'cf', url: 'snippfilm://cf/', size: 0, duration: 20, width: 1920, height: 1080, hasAudio: false, code: { fps: 30 } } as never)
  const v2 = { id: 'V2', kind: 'video', name: 'V2', clipIds: ['k'] } as never
  p.tracks = [v2, ...p.tracks]
  p.clips.k = { id: 'k', assetId: 'cf', trackId: 'V2', start: 4, inPoint: 1, duration: 5, speed: 2, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as never
  const out = rangeContext(p, [5, 6])
  assert.match(out, /^4\.00–7\.00 "said at 5\.5"$/m, out)
  // With no code clip there: seconds from the first time asked, as before.
  delete p.clips.k
  assert.match(rangeContext(p, [5, 6]), /^0\.50–2\.00 "said at 5\.5"$/m)
})

// ---- A4: a create that is refused makes nothing ----------------------------------

test('A4: a track that is not there, a name Windows keeps: refused before any folder or film is made', async () => {
  open(talk(20))
  read()
  const before = { made: made.length, assets: S().project.assets.length }
  await assert.rejects(create({ name: 'notrack', start: 1, end: 2, track: 'zzz' }), /track/)
  for (const n of ['CON', 'nul', 'aux', 'COM1', 'LPT9', 'Prn']) await assert.rejects(create({ name: n, start: 1, end: 2 }), /Windows/, n)
  assert.equal(made.length, before.made, `no folder asked of the main process: ${made.slice(before.made).join(', ')}`)
  assert.equal(S().project.assets.length, before.assets, 'no film came in')
  assert.equal(currentDraft(), null)
})

// ---- A3: films no clip uses leave the project ------------------------------------

const codeFilmsNow = (): string[] => S().project.assets.filter((a) => a.kind === 'code').map((a) => a.id)
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

test('A3: a rejected draft leaves no film of its creates in the project; an accepted one undone neither; redo brings all back', async () => {
  open(talk(20))
  read()
  const before = S().past.length
  for (const [n, a, b] of [['r1', 1, 3], ['r2', 4, 6]] as const) await create({ name: n, start: a, end: b })
  assert.equal(codeFilmsNow().length, 2)
  rejectDraft()
  await settle()
  assert.deepEqual(codeFilmsNow(), [], 'no film left after the reject')
  // Accepted, then undone with one Ctrl+Z: the films go with their clips.
  read()
  for (const [n, a, b] of [['u1', 1, 3], ['u2', 4, 6]] as const) await create({ name: n, start: a, end: b })
  acceptDraft(undefined, 'now')
  await settle()
  assert.equal(codeFilmsNow().length, 2, 'accepted: the films stay')
  S().undo()
  await settle()
  assert.deepEqual(codeFilmsNow(), [], 'undone: no film left')
  S().redo()
  await settle()
  assert.equal(codeFilmsNow().length, 2, 'redone: the films are back with their clips')
  assert.equal(Object.values(S().project.clips).filter((c) => codeFilmsNow().includes(c.assetId)).length, 2)
  assert.ok(S().past.length >= before)
})
