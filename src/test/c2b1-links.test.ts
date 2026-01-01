// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.1, decisions 2 and 3 (report L2, L6, L7, P11): linked picture and
// sound are one unit by default — moved, trimmed, cut, deleted, retimed,
// slipped and copied together; a clip pushed along its track takes its
// partner with it; a lock is a rule of the edit (a partner on a locked track
// refuses the edit, a locked track's clips leave the selection, a hidden
// track is no target of Ctrl+B / Q / W).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'
import { targetClipAt } from '../renderer/src/commands/ops/split'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

/** V1: a talk picture p1 [0,10] linked to its sound s1 [0,10] on A1, then
 *  p2 [10,20] linked to s2; A1 also has a lone sound n1 [24,28]. */
function pairs(opts: { lockA1?: boolean } = {}): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [], ...(opts.lockA1 ? { locked: true } : {}) }
  ]
  const a = (id: string, kind: 'video' | 'audio') => ({ id, kind, name: `${id}.mp4`, url: `media://${id}`, size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('vid', 'video'), a('vid2', 'video'), a('snd', 'audio')]
  const put = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('p1', 'vid', 'V1', 0, 20, 10, { linkId: 'L1', audioExtracted: true })
  put('p2', 'vid2', 'V1', 10, 5, 10, { linkId: 'L2', audioExtracted: true })
  put('s1', 'vid', 'A1', 0, 20, 10, { linkId: 'L1' })
  put('s2', 'vid2', 'A1', 10, 5, 10, { linkId: 'L2' })
  put('n1', 'snd', 'A1', 24, 0, 4)
  p.captions = []
  return p
}

const open = (p: Project, extra: Record<string, unknown> = {}): void => {
  S().loadProject(p)
  useStore.setState({ linkAV: true, selectedClipIds: [], ...extra })
}
const shape = (c: Clip): [number, number, number] => [c.start, c.inPoint, c.duration]

test('the link is on in a new editor (decision 2)', () => {
  // (dom-stub's localStorage has nothing stored.)
  const { useStore: fresh } = require('../renderer/src/state/store') as typeof import('../renderer/src/state/store')
  assert.equal(typeof fresh.getState().linkAV, 'boolean')
  assert.equal(localStorage.getItem('autocut-link-av'), null)
  // The store module reads it once: the default for a profile that never
  // turned it off is ON.
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'renderer', 'src', 'state', 'store.ts'), 'utf8') as string
  assert.match(src, /linkAV: localStorage\.getItem\('autocut-link-av'\) !== 'off'/)
})

test('a head and a tail trim of the picture trim its sound alike; Alt trims the picture alone', () => {
  open(pairs())
  S().setClipHead('p1', 2, { start: 0, inPoint: 20, duration: 10 })
  let p = S().project
  assert.deepEqual(shape(p.clips.s1), shape(p.clips.p1))
  assert.deepEqual(shape(p.clips.p1), [2, 22, 8])
  S().trimClipEnd('p1', -3)
  p = S().project
  assert.deepEqual(shape(p.clips.s1), shape(p.clips.p1))
  assert.deepEqual(shape(p.clips.p1), [2, 22, 5])
  S().trimClipEnd('p1', -1, true)
  p = S().project
  assert.equal(p.clips.p1.duration, 4)
  assert.equal(p.clips.s1.duration, 5)
})

test('a joint trim stops where either clip has to stop (the sound\'s neighbour holds the picture too)', () => {
  const p0 = pairs()
  // s2 grows into n1 at 24: with p2 alone it could reach 25.
  p0.clips.p2.duration = 15
  p0.clips.s2.duration = 13
  open(p0)
  S().trimClipEnd('p2', 0.5)
  const p = S().project
  assert.equal(p.clips.s2.start + p.clips.s2.duration, 23.5)
  S().trimClipEnd('p2', 5)
  const q = S().project
  assert.equal(q.clips.s2.start + q.clips.s2.duration, 24, 'the sound stops at n1')
  assert.equal(q.clips.p2.duration, p.clips.p2.duration + 0.5, 'and the picture with it')
})

test('deleting the picture deletes its sound; a split cuts both; a speed change retimes both', () => {
  open(pairs())
  S().deleteClips(['p1'], false)
  assert.equal(S().project.clips.s1, undefined)
  open(pairs())
  useStore.setState({ currentTime: 5, selectedClipIds: ['p1'] })
  S().splitAtPlayhead()
  assert.equal(Object.values(S().project.clips).filter((c) => c.trackId === 'A1').length, 4)
  open(pairs())
  S().setClipSpeed('p1', 2)
  assert.equal(S().project.clips.s1.duration, 5)
})

test('a drop that pushes a clip along its track takes that clip’s sound along (P11)', () => {
  const p = pairs()
  // A lone picture b [30,34] dropped at 12 lands inside p2: p2 is pushed
  // to 16, and p2's sound s2 the same distance (it stayed, before).
  p.clips.b = { ...p.clips.p2, id: 'b', start: 30, duration: 4, linkId: undefined, audioExtracted: undefined }
  p.tracks[0].clipIds.push('b')
  const plan = planTimelinePlacement(p, 'b', ['b'], 12 - 30, null, null, true)!
  assert.ok(plan)
  assert.equal(plan.positions.p2.start, 16)
  assert.equal(plan.positions.s2.start, 16)
  // n1, after s2 on A1, is pushed on in its turn: nothing overlaps.
  const a1 = plan.trackClipIds.A1.map((id) => [plan.positions[id]?.start ?? p.clips[id].start, p.clips[id].duration])
  for (let i = 1; i < a1.length; i++) assert.ok(a1[i][0] >= a1[i - 1][0] + a1[i - 1][1] - 1e-6)
})

test('a speed change that pushes the next clip pushes that clip\'s sound too (P11)', () => {
  const p0 = pairs()
  // p1 alone (no sound of its own), p2's sound s2 under it.
  delete p0.clips.p1.linkId
  p0.tracks[1].clipIds = ['s2', 'n1']
  delete p0.clips.s1
  open(p0)
  S().setClipSpeed('p1', 0.5)
  const p = S().project
  assert.equal(p.clips.p2.start, 20)
  assert.equal(p.clips.s2.start, 20)
})

test('a partner on a locked track refuses a trim, a move, a split, a delete, a speed change and a freeze frame; the user is told (decision 3)', () => {
  const before = JSON.stringify(pairs({ lockA1: true }).clips)
  const told = (): number => currentToasts().filter((x) => /locked/.test(x.text)).length
  clearToasts()
  const edits: [string, () => void][] = [
    ['head trim', () => S().setClipHead('p1', 2, { start: 0, inPoint: 20, duration: 10 })],
    ['tail trim', () => S().trimClipEnd('p1', -2)],
    ['move', () => S().moveClip('p1', 30)],
    ['split', () => { useStore.setState({ currentTime: 5, selectedClipIds: ['p1'] }); S().splitAtPlayhead() }],
    ['delete', () => S().deleteClips(['p1'], false)],
    ['speed', () => S().setClipSpeed('p1', 2)],
    ['freeze', () => { useStore.setState({ currentTime: 5, selectedClipIds: ['p1'] }); S().insertFreezeFrame(1) }]
  ]
  for (const [name, run] of edits) {
    open(pairs({ lockA1: true }))
    clearToasts()
    const n = told()
    run()
    assert.equal(JSON.stringify(S().project.clips), before, `${name}: nothing changed`)
    if (name !== 'speed') assert.ok(told() > n, `${name}: the user was told`)
  }
  // Alt (the picture alone) is not held by the sound's lock.
  open(pairs({ lockA1: true }))
  S().trimClipEnd('p1', -2, true)
  assert.equal(S().project.clips.p1.duration, 8)
})

test('locking a track lets go of its selected clips; a locked clip is not duplicated or retimed; a hidden track is no Ctrl+B target (L7)', () => {
  open(pairs(), { selectedClipIds: ['p1', 's1', 'n1'] })
  S().setTrackFlags('A1', { locked: true })
  assert.deepEqual(S().selectedClipIds, ['p1'])
  open(pairs({ lockA1: true }), { selectedClipIds: ['n1'] })
  S().duplicateSelection()
  assert.equal(Object.keys(S().project.clips).length, 5)
  S().setClipSpeed('n1', 2)
  assert.equal(S().project.clips.n1.duration, 4)
  const p = pairs()
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['top'], hidden: true })
  p.clips.top = { ...p.clips.p1, id: 'top', trackId: 'V2', linkId: undefined }
  assert.equal(targetClipAt(p, [], 5)?.id, 'p1')
})

test('Ctrl+D and copy-paste copy the pair and link the copies to each other; Unlink lets them go their own ways', () => {
  const room = pairs()
  room.clips.n1.start = 40
  open(room, { selectedClipIds: ['p2'] })
  S().duplicateSelection()
  let p = S().project
  const copies = Object.values(p.clips).filter((c) => !['p1', 'p2', 's1', 's2', 'n1'].includes(c.id))
  assert.equal(copies.length, 2)
  assert.ok(copies[0].linkId && copies[0].linkId === copies[1].linkId && copies[0].linkId !== 'L2')
  assert.equal(copies[0].start, copies[1].start)
  // With no room for the sound beside its picture, the copies land apart
  // and are not linked (a pair is linked only where it plays together).
  open(pairs(), { selectedClipIds: ['p2'] })
  S().duplicateSelection()
  assert.ok(Object.values(S().project.clips).filter((c) => !['p1', 'p2', 's1', 's2', 'n1'].includes(c.id)).every((c) => !c.linkId))
  open(pairs(), { selectedClipIds: ['p1'] })
  S().unlinkClips(['p1'])
  p = S().project
  assert.equal(p.clips.p1.linkId, undefined)
  assert.equal(p.clips.s1.linkId, undefined)
  S().deleteClips(['p1'], false)
  assert.ok(S().project.clips.s1, 'unlinked, the sound stays')
})
