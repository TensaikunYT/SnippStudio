// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 4: the report's remaining keyframe findings (K13,
// K14, K19, K20, K21, K22, K23, K27), each with the behaviour it asks for.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { CommandError } from '../renderer/src/commands/core'
import { keepRange, setClip, setOpacity, setTransform, trimHead } from '../renderer/src/commands/clips'
import { clipTransformAt } from '../renderer/src/playback/pose'
import { sampleMotionFx } from '../renderer/src/effects/cinematic'
import { produce } from '../renderer/src/state/cow'
import { turnFrom } from '../renderer/src/ui/handles'
import { volumeKeyMarks } from '../renderer/src/components/timeline/shared'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'

const s = useStore.getState
const env = { random: Math.random, now: () => new Date() }

function project(): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['b'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'c'] },
    { id: 'V3', kind: 'video', name: 'V3', clipIds: ['l'], locked: true }
  ]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: true } as never]
  const base = { assetId: 'vid', inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  p.clips.a = { ...base, id: 'a', trackId: 'V1', start: 0, duration: 10, channels: { rotation: [{ id: 'r0', time: 1, value: 0 }, { id: 'r1', time: 5, value: 1 }], x: [{ id: 'x0', time: 0, value: 10 }, { id: 'x1', time: 10, value: 20 }] } } as Clip
  p.clips.c = { ...base, id: 'c', trackId: 'V1', start: 12, duration: 3 } as Clip
  p.clips.b = { ...base, id: 'b', trackId: 'V2', start: 20, duration: 4 } as Clip
  p.clips.l = { ...base, id: 'l', trackId: 'V3', start: 0, duration: 30 } as Clip
  p.captions = []
  return p
}

test('K13: a static value set on a keyed channel by name is refused, and says why', () => {
  const p = project()
  assert.throws(() => setTransform.check!(p, { clipId: 'a', transform: { x: 100 } }), (e: unknown) => e instanceof CommandError && /x is keyframed/.test(e.message))
  assert.throws(() => produce(p, (d) => setTransform.apply(d, { clipId: 'a', transform: { x: 100 } }, env)), CommandError)
  assert.throws(() => setClip.check!(p, { clipId: 'a', transform: { rotation: 1 } }), /rotation is keyframed/)
  // A channel with no keys is set as before.
  const q = produce(p, (d) => setTransform.apply(d, { clipId: 'a', transform: { y: 7 } }, env))
  assert.equal(q.clips.a.transform.y, 7)
  const o = produce(p, (d) => {
    d.clips.a.channels!.opacity = [{ id: 'o', time: 0, value: 0.5 }]
  })
  assert.throws(() => setOpacity.check!(o, { clipId: 'a', opacity: 1 }), /opacity is keyframed/)
})

test('K13: Rotate 90 and paste attributes move the keys of a keyed channel (what you see turns)', () => {
  s().loadProject(project())
  const before = [0, 1, 3, 5, 8].map((u) => clipTransformAt(s().project.clips.a, u).rotation)
  s().rotate90('a')
  const after = [0, 1, 3, 5, 8].map((u) => clipTransformAt(s().project.clips.a, u).rotation)
  after.forEach((r, i) => assert.ok(Math.abs(r - before[i] - Math.PI / 2) < 1e-12, `at ${i}: ${r} vs ${before[i]}`))
  // Paste attributes from a clip turned by 0.5 and scaled 2: the keyed
  // rotation turns by the difference, the unkeyed scale is set.
  const p = project()
  p.clips.c.transform = { x: 0, y: 0, scale: 2, rotation: 0.5 }
  s().loadProject(p)
  useStore.setState({ selectedClipIds: ['c'] })
  s().copySelection()
  useStore.setState({ selectedClipIds: ['a'] })
  s().pasteAttributes()
  const a = s().project.clips.a
  assert.equal(a.transform.scale, 2)
  assert.deepEqual(a.channels!.rotation!.map((k) => k.value), [0.5, 1.5])
})

test('K14: a head trim and a kept range cut the slow push as a split does (the same zoom on the same frame)', () => {
  const p = project()
  p.clips.c = { ...p.clips.c, duration: 10, motionFx: { enabled: true, zoomFrom: 1, zoomTo: 1.2, panX: 40, panY: 0, shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 1, seed: 7, ease: 'linear' } }
  p.clips.b.start = 30
  const was = p.clips.c
  const at = (c: Clip, u: number) => sampleMotionFx(c.motionFx!, u / c.duration, u)
  const trimmed = produce(p, (d) => trimHead.apply(d, { clipId: 'c', edge: 14 }, env)).clips.c
  for (const u of [0, 3, 7.9]) {
    const x = at(trimmed, u)
    const y = at(was, u + 2)
    assert.ok(Math.abs(x.zoom - y.zoom) < 1e-12 && Math.abs(x.offsetX - y.offsetX) < 1e-9, `head trim, ${u}: ${x.zoom} vs ${y.zoom}`)
  }
  const kept = produce(p, (d) => keepRange.apply(d, { clipId: 'c', range: [15, 19] }, env)).clips.c
  for (const u of [0, 2, 4]) {
    const x = at(kept, u)
    const y = at(was, u + 3)
    assert.ok(Math.abs(x.zoom - y.zoom) < 1e-12, `kept range, ${u}: ${x.zoom} vs ${y.zoom}`)
  }
})

test('K19: no key is written with the playhead off the clip; keyframing a selection is one undo step and skips a locked track', () => {
  s().loadProject(project())
  s().setTime(11) // between a (0–10) and c (12–15)
  s().addClipKeyframe('c')
  assert.equal(s().project.clips.c.channels, undefined, 'the playhead is not on c')
  s().setPropValue('a', 'x', 99)
  assert.equal(s().project.clips.a.channels!.x!.length, 2, 'no key at the edge of a')
  s().setTime(13)
  const depth = s().past.length
  s().keyframeClips(['a', 'c', 'b', 'l'])
  assert.equal(s().past.length, depth + 1, 'one step')
  assert.ok(s().project.clips.c.channels?.x?.length === 1, 'c is under the playhead: keyed')
  assert.equal(s().project.clips.b.channels, undefined, 'b is not')
  assert.equal(s().project.clips.l.channels, undefined, 'l is on a locked track')
  assert.equal(s().project.clips.a.channels!.x!.length, 2, 'a is not under the playhead')
})

test('K20: paste all keyframes scaled to the length, and never onto a locked track', () => {
  const p = project()
  p.clips.c.channels = { scale: [{ id: 's0', time: 0, value: 1 }, { id: 's1', time: 1.5, value: 2 }, { id: 's2', time: 3, value: 1 }] }
  s().loadProject(p)
  s().copyClipAnimation('c')
  s().pasteClipAnimation(['b', 'l'], { scaled: true })
  assert.deepEqual(s().project.clips.b.channels!.scale!.map((k) => k.time), [0, 2, 4], 'a 3 s move on a 4 s clip')
  assert.equal(s().project.clips.l.channels, undefined, 'the locked clip is not changed')
  s().pasteClipAnimation(['b'])
  assert.deepEqual(s().project.clips.b.channels!.scale!.map((k) => k.time), [0, 1.5, 3], 'as it was without the option')
})

test('K21: uncompound keeps the compound\'s speed on the children\'s keys, and says when the compound\'s own animation goes', () => {
  const p = project()
  const child: Clip = { id: 'k', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 0, duration: 8, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, channels: { x: [{ id: 'q0', time: 1, value: 0 }, { id: 'q1', time: 7, value: 600 }] } }
  p.tracks[1].clipIds = ['cmp']
  delete p.clips.a
  delete p.clips.c
  p.clips.cmp = { id: 'cmp', assetId: '', trackId: 'V1', start: 2, inPoint: 0, duration: 4, speed: 2, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, nested: { clips: [child] }, channels: { scale: [{ id: 'z', time: 0, value: 1 }, { id: 'z2', time: 4, value: 2 }] } }
  s().loadProject(p)
  // What the child showed at outer instant T: its own clock is (T − 2) × 2.
  const childAt = (T: number) => clipTransformAt(child, (T - 2) * 2 - child.start).x
  clearToasts()
  s().uncompoundClip('cmp')
  const restored = Object.values(s().project.clips).find((c) => c.channels?.x)!
  for (const T of [2, 2.5, 3, 4, 5, 5.9]) {
    const x = clipTransformAt(restored, T - restored.start).x
    assert.ok(Math.abs(x - childAt(T)) < 1e-9, `at ${T}: ${x} vs ${childAt(T)}`)
  }
  assert.ok(currentToasts().some((x) => /animation/i.test(x.text)), 'the own animation of the compound going is told')
})

test('K22 (no fault): a keyed title dragged in the preview writes a key at the playhead (the store path the preview calls)', () => {
  const p = project()
  p.captions = [{ id: 't', start: 0, end: 10, text: 'T', layer: 1, manual: true, kfs: [{ id: 'k', time: 0, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }] }]
  s().loadProject(p)
  s().setTime(4)
  s().setCaptionMotion('t', { x: 50, y: 20 })
  const cap = s().project.captions[0]
  assert.deepEqual(cap.kfs!.map((k) => [k.time, k.x, k.y]), [[0, 0, 0], [4, 50, 20]])
  assert.equal(cap.style, undefined, 'its placement is not touched')
})

test('K23: a turn dragged past half a turn keeps going (200° in 10° steps is 200°)', () => {
  const acc = { sum: 0 }
  let angle = 0
  const deg = Math.PI / 180
  for (let a = 10; a <= 200; a += 10) angle = turnFrom([0, 0], [1, 0], [Math.cos(a * deg), Math.sin(a * deg)], 0, acc)
  assert.ok(Math.abs(angle - 200 * deg) < 1e-9, `${angle / deg}°`)
  // Back the other way past the start.
  for (let a = 190; a >= -100; a -= 10) angle = turnFrom([0, 0], [1, 0], [Math.cos(a * deg), Math.sin(a * deg)], 0, acc)
  assert.ok(Math.abs(angle + 100 * deg) < 1e-9, `${angle / deg}°`)
})

test('K27: a video\'s own volume keys are marked on the timeline; not once its sound is extracted', () => {
  const c = { id: 'v', start: 0, duration: 5, volumeKeyframes: [{ id: 'k', time: 1, value: 0.5 }, { id: 'off', time: 9, value: 1 }] } as Clip
  assert.deepEqual(volumeKeyMarks(c, { kind: 'video' }, { hasAudio: true }).map((k) => k.id), ['k'])
  assert.deepEqual(volumeKeyMarks({ ...c, audioExtracted: true }, { kind: 'video' }, { hasAudio: true }), [])
  assert.deepEqual(volumeKeyMarks(c, { kind: 'video' }, { hasAudio: false }), [])
  assert.deepEqual(volumeKeyMarks(c, { kind: 'audio' }, undefined).map((k) => k.id), ['k'])
})
