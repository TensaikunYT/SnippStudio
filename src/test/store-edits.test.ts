// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { clipTransformAt } from '../renderer/src/playback/pose'

/** Two butt-joined clips A (0..10) and B (10..20) on V1, A with a slide into
 *  B, fades at its ends, a Cinematize push and a scale key at 8 s. */
function twoClips(): Project {
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  for (const id of ['a', 'b']) {
    p.assets.push({ id: `asset-${id}`, kind: 'video', name: `${id}.mp4`, url: '', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true })
  }
  const clip = (id: string, start: number): Clip => ({
    id, assetId: `asset-${id}`, trackId: v1.id, start, duration: 10, inPoint: 5, volume: 1,
    transform: { x: 960, y: 540, scale: 1, rotation: 0 }
  })
  const a = clip('a', 0)
  a.transitionOut = { type: 'slide', duration: 1 }
  a.fadeIn = 0.5
  a.fadeOut = 0.5
  a.anim = { in: 'fade', out: 'fade' } as unknown as Clip['anim']
  a.motionFx = { zoomFrom: 1, zoomTo: 1.2, ease: 'smooth', seed: 3 } as unknown as Clip['motionFx']
  a.channels = { scale: [{ id: 'k1', time: 0, value: 1 }, { id: 'k2', time: 8, value: 1.4 }] }
  p.clips.a = a
  p.clips.b = clip('b', 10)
  v1.clipIds = ['a', 'b']
  return p
}

test('a split leaves the transition, the fade-out and the way out on the piece that ends where the clip did', () => {
  useStore.getState().loadProject(twoClips())
  useStore.setState({ currentTime: 4, selectedClipIds: ['a'] })
  useStore.getState().splitAtPlayhead()
  const p = useStore.getState().project
  const left = p.clips.a
  const right = Object.values(p.clips).find((c) => c.id !== 'a' && c.id !== 'b')!
  assert.equal(left.duration, 4)
  assert.equal(left.transitionOut, undefined)
  assert.deepEqual(right.transitionOut, { type: 'slide', duration: 1, to: 'b' })
  assert.equal(left.fadeOut, undefined)
  assert.equal(left.fadeIn, 0.5)
  assert.equal(right.fadeIn, undefined)
  assert.equal(right.fadeOut, 0.5)
  assert.equal(left.anim?.out, undefined)
  assert.equal(right.anim?.in, undefined)
  // The push goes on across the cut: where the left piece ends, the right begins.
  const lf = left.motionFx!
  const rf = right.motionFx!
  assert.ok(Math.abs(lf.zoomTo - rf.zoomFrom) < 1e-9)
  assert.ok(lf.zoomFrom === 1 && Math.abs(rf.zoomTo - 1.2) < 1e-9)
})

test('undo marks the project unsaved, and every edit counts', () => {
  useStore.getState().loadProject(twoClips())
  const seq0 = useStore.getState().editSeq
  useStore.setState({ currentTime: 4, selectedClipIds: ['a'] })
  useStore.getState().splitAtPlayhead()
  assert.ok(useStore.getState().editSeq > seq0)
  useStore.getState().setDirty(false)
  useStore.getState().undo()
  assert.equal(useStore.getState().dirty, true)
  assert.equal(Object.keys(useStore.getState().project.clips).length, 2)
})

test('a ripple cut out of the middle shows at each new edge the value drawn there, and the transition on the right piece', () => {
  useStore.getState().loadProject(twoClips())
  useStore.getState().rippleDelete(2, 6)
  const p = useStore.getState().project
  const left = p.clips.a
  const right = Object.values(p.clips).find((c) => c.id !== 'a' && c.id !== 'b' && c.trackId === left.trackId)!
  assert.equal(left.transitionOut, undefined)
  assert.equal(right.transitionOut?.type, 'slide')
  // Left shows 0..2 of the eased 0→8 s scale ramp, right starts at its 6 s:
  // the values the render drew there (smoothstep: 1.0625 and 1.3375). Both
  // keep the whole ramp (phase Ç2c.1, decision 1: no key dropped, none made).
  assert.deepEqual(left.channels!.scale!.map((k) => k.time), [0, 8])
  assert.deepEqual(right.channels!.scale!.map((k) => k.time), [-6, 2])
  assert.ok(Math.abs(clipTransformAt(left, 2).scale - 1.0625) < 1e-9)
  assert.ok(Math.abs(clipTransformAt(right, 0).scale - 1.3375) < 1e-9)
})

/** V2 over V1 and an audio track: a video on V1 with its sound extracted
 *  (linked) on A1, and a title picture on V2 across 10 s. */
function layered(): Project {
  const p = defaultProject()
  const vids = p.tracks.filter((t) => t.kind === 'video')
  if (vids.length < 2) p.tracks.unshift({ ...structuredClone(vids[0]), id: 'v2', name: 'V2', clipIds: [] })
  const v1 = p.tracks.filter((t) => t.kind === 'video').at(-1)!
  const v2 = p.tracks.filter((t) => t.kind === 'video')[0]
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push(
    { id: 'vid', kind: 'video', name: 'v.mp4', url: '', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true },
    { id: 'pic', kind: 'image', name: 'p.png', url: '', size: 1, duration: 0, width: 800, height: 600, hasAudio: false }
  )
  const base = { inPoint: 0, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 } }
  p.clips.v = { id: 'v', assetId: 'vid', trackId: v1.id, start: 0, duration: 20, ...base, linkId: 'L', audioExtracted: true }
  p.clips.s = { id: 's', assetId: 'vid', trackId: a1.id, start: 0, duration: 20, ...base, linkId: 'L' }
  p.clips.t = { id: 't', assetId: 'pic', trackId: v2.id, start: 5, duration: 10, ...base }
  v1.clipIds = ['v']
  a1.clipIds = ['s']
  v2.clipIds = ['t']
  return p
}

test('a freeze frame puts the hold into the linked voice and the layers above too', () => {
  useStore.getState().loadProject(layered())
  useStore.setState({ currentTime: 8, selectedClipIds: ['v'], linkAV: true })
  useStore.getState().insertFreezeFrame(2)
  const p = useStore.getState().project
  const voice = Object.values(p.clips).filter((c) => c.trackId === p.clips.s.trackId).sort((a, b) => a.start - b.start)
  assert.equal(voice.length, 2)
  assert.equal(voice[0].duration, 8)
  assert.equal(voice[1].start, 10)
  // The title across the hold stays on screen through it.
  assert.equal(p.clips.t.start, 5)
  assert.equal(p.clips.t.duration, 12)
})

test('extracted audio goes to a free audio track, never pushed after the voice-over', () => {
  const p0 = layered()
  delete p0.clips.v.audioExtracted
  delete p0.clips.v.linkId
  p0.clips.s.linkId = undefined
  useStore.getState().loadProject(p0)
  useStore.getState().extractAudio('v')
  const p = useStore.getState().project
  const extracted = Object.values(p.clips).find((c) => c.linkId && c.id !== 'v')!
  assert.equal(extracted.start, 0)
  assert.notEqual(extracted.trackId, p.clips.s.trackId)
  assert.equal(p.clips.s.start, 0)
})

test('a slower clip butt-joined to the next one pushes it along instead of running over it', () => {
  useStore.getState().loadProject(twoClips())
  useStore.getState().setClipSpeed('a', 0.5)
  const p = useStore.getState().project
  assert.equal(p.clips.a.duration, 20)
  assert.equal(p.clips.b.start, 20)
})

test('deleting a clip takes the transition into it along', () => {
  useStore.getState().loadProject(twoClips())
  useStore.getState().deleteClips(['b'], true)
  assert.equal(useStore.getState().project.clips.a.transitionOut, undefined)
})

test('compound then uncompound gives the layers back on their own rows', () => {
  useStore.getState().loadProject(layered())
  useStore.setState({ selectedClipIds: ['v', 't'] })
  useStore.getState().compoundSelection()
  const id = useStore.getState().selectedClipIds[0]
  useStore.getState().uncompoundClip(id)
  const p = useStore.getState().project
  const back = useStore.getState().selectedClipIds.map((i) => p.clips[i])
  assert.equal(back.length, 2)
  assert.notEqual(back[0].trackId, back[1].trackId)
  assert.deepEqual(back.map((c) => c.start).sort((a, b) => a - b), [0, 5])
})

test('a cut between C marks on the subtitle lane moves the words with their lines', () => {
  const p0 = twoClips()
  p0.captions.push({ id: 'c', start: 12, end: 13, text: 'hello there', words: [{ text: 'hello', start: 12, end: 12.5 }, { text: 'there', start: 12.5, end: 13 }] })
  useStore.getState().loadProject(p0)
  useStore.setState({ cutMarks: [2, 6], cutTrackId: 'captions' })
  useStore.getState().deleteBetweenCuts()
  const c = useStore.getState().project.captions.find((x) => x.id === 'c')!
  assert.equal(c.start, 8)
  assert.deepEqual(c.words!.map((w) => w.start), [8, 8.5])
})
