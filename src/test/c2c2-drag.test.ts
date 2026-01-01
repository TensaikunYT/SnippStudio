// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 2 (report K3, K24, D5): keys are moved by id. A drag
// moves the keys it took at the press and nothing else; a key dropped on
// another key of its channel takes its place; a ripple drag stops when the
// last key reaches the clip's end; two keys of a channel never share an
// instant; "Keyframe all" gives its keys one set id; an Alt-drag's copy is
// made inside the drag (one undo step) and keeps its easing.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { keyframeGroups } from '../renderer/src/components/timeline/shared'
import { defaultProject, KF_CHANNELS, type Clip, type ClipChannels } from '../renderer/src/types'
import { dragKeys, type KeyDrag } from '../renderer/src/timeline/key-drag'

const s = useStore.getState

function load(channels?: ClipChannels, duration = 6): void {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['c'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: false } as never]
  p.clips.c = { id: 'c', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 0, duration, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...(channels ? { channels } : {}) } as Clip
  p.captions = []
  s().loadProject(p)
}
const clip = (): Clip => s().project.clips.c

/** No channel holds two keys on one frame. */
function noTwinKeys(where: string): void {
  for (const ch of KF_CHANNELS) {
    const ts = (clip().channels?.[ch] ?? []).map((k) => k.time).sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] > 1e-6, `${where}: two ${ch} keys at ${ts[i]}`)
  }
}
const times = (ch: 'x' | 'scale' = 'x'): number[] => (clip().channels?.[ch] ?? []).map((k) => +k.time.toFixed(6))

/** Keys at 1 and 2 s, "Keyframe all" twice. */
function twoSets(): void {
  load()
  s().setTime(1)
  s().addClipKeyframe('c')
  s().setTime(2)
  s().setPropValue('c', 'x', 500)
  s().addClipKeyframe('c')
}

test('K3 (old store action): moving the 1 s set to 2 then to 2.5 never leaves two keys at one instant', () => {
  twoSets()
  s().moveKeyframeGroup('c', 1, 2)
  noTwinKeys('after 1 → 2')
  s().moveKeyframeGroup('c', 2, 2.5)
  noTwinKeys('after 2 → 2.5')
  // The 1 s set dropped on the 2 s set took its place; it is the one at 2.5.
  assert.deepEqual(times(), [2.5])
})

test('K3 (the drag): the keys taken at the press move 1 → 2 → 2.5; the 2 s keys are back when the drag passes them', () => {
  twoSets()
  const g = keyframeGroups(clip())[0]
  assert.equal(g.time, 1)
  const drag: KeyDrag = { base: structuredClone(clip().channels!), keys: g.keys, from: g.time }
  s().beginGesture()
  s().dragKeyframes('c', drag, 2)
  noTwinKeys('over the 2 s keys')
  assert.deepEqual(times(), [2], 'dropped there, the dragged key takes the place of the other')
  assert.deepEqual(clip().channels!.x!.map((k) => k.id), [g.keys.find((r) => r.ch === 'x')!.id], 'it is the dragged one')
  s().dragKeyframes('c', drag, 2.5)
  noTwinKeys('past them')
  assert.deepEqual(times(), [2, 2.5], 'the 2 s keys are where they were; only the dragged ones moved')
  s().endGesture()
  s().undo()
  assert.deepEqual(times(), [1, 2], 'one undo step takes the drag back')
})

test('K3: a drag snaps its keys to the frame grid and keeps them on the clip', () => {
  twoSets()
  const g = keyframeGroups(clip())[0]
  s().dragKeyframes('c', { base: structuredClone(clip().channels!), keys: g.keys, from: g.time }, 1.51)
  assert.deepEqual(times(), [1.5, 2], 'frame 45')
  s().dragKeyframes('c', { base: structuredClone(clip().channels!), keys: g.keys, from: 1.5 }, 9)
  assert.deepEqual(times(), [2, 6], 'not past the end')
})

test('K3: a ripple drag stops when the last key reaches the clip end (no key is pushed onto the end)', () => {
  load({ x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 2, value: 1 }, { id: 'c', time: 5, value: 2 }] })
  const g = keyframeGroups(clip()).find((x) => x.time === 2)!
  s().dragKeyframes('c', { base: structuredClone(clip().channels!), keys: g.keys, from: 2, ripple: true }, 5)
  assert.deepEqual(times(), [1, 3, 6], 'the delta held at +1: 5 → 6 at the end, 2 → 3')
  // The old action does the same.
  load({ x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 2, value: 1 }, { id: 'c', time: 5, value: 2 }] })
  s().rippleKeyframes('c', 2, 3)
  assert.deepEqual(times(), [1, 3, 6])
  noTwinKeys('ripple')
})

test('K3 / D5: "Keyframe all" gives its keys one set id; a diamond holds the keys of its instant by id', () => {
  twoSets()
  const sets = new Set(KF_CHANNELS.map((ch) => clip().channels![ch]![0].group))
  assert.equal(sets.size, 1, 'one set id for the five keys of the 1 s set')
  assert.ok([...sets][0])
  const gs = keyframeGroups(clip())
  assert.equal(gs.length, 2)
  assert.equal(gs[0].keys.length, 5)
  assert.notEqual(gs[0].id, gs[1].id)
  assert.equal(gs[0].id, [...sets][0], 'the diamond is known by its set')
})

test('K24: an Alt-drag copy is one undo step and keeps the easing', () => {
  load({ x: [{ id: 'a', time: 1, value: 10, easing: 'linear' }, { id: 'b', time: 4, value: 50, easing: 'hold' }] })
  const before = s().past.length
  const g = keyframeGroups(clip())[0]
  const drag: KeyDrag = { base: structuredClone(clip().channels!), keys: g.keys, from: g.time, copies: { ids: { a: 'a2' }, group: 'g2' } }
  s().beginGesture()
  s().dragKeyframes('c', drag, 2)
  s().dragKeyframes('c', drag, 2.5)
  s().endGesture()
  assert.deepEqual(clip().channels!.x!.map((k) => [k.id, +k.time.toFixed(6), k.value, k.easing]), [['a', 1, 10, 'linear'], ['a2', 2.5, 10, 'linear'], ['b', 4, 50, 'hold']])
  assert.equal(s().past.length, before + 1, 'one step')
  s().undo()
  assert.deepEqual(times(), [1, 4], 'one undo takes the copy back')
})

test('dragKeys is pure: the base it is given is not changed', () => {
  const base: ClipChannels = { x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 2, value: 1 }] }
  const copy = structuredClone(base)
  const out = dragKeys({ base, keys: [{ ch: 'x', id: 'a' }], from: 1 }, 2, { start: 0, duration: 6 }, 30)
  assert.deepEqual(base, copy)
  assert.deepEqual(out.x!.map((k) => [k.id, k.time]), [['a', 2]])
})
