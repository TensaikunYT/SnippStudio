// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decision 5 (report K5): a freeze frame shows the pose that was
// on screen at the playhead. Its transform, opacity, mask and volume are
// fixed at the values the keys gave there before the keys are taken off the
// held frame (it showed the clip's static pose, so the picture jumped into
// and out of the hold). The pieces either side keep their motion.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { automationGainAt } from '../renderer/src/audio/envelope'
import { clipOpacityAt, clipTransformAt, maskGeomAt } from '../renderer/src/playback/pose'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

function project(): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true } as never]
  p.clips.x = {
    id: 'x',
    assetId: 'vid',
    trackId: 'V1',
    start: 2,
    inPoint: 10,
    duration: 8,
    transform: { x: 960, y: 540, scale: 1, rotation: 0 },
    opacity: 1,
    volume: 1,
    channels: {
      scale: [{ id: 's0', time: 0, value: 1 }, { id: 's4', time: 4, value: 2 }],
      x: [{ id: 'x0', time: 0, value: 100 }, { id: 'x6', time: 6, value: 700, easing: 'linear' }],
      opacity: [{ id: 'o0', time: 0, value: 0.2 }, { id: 'o5', time: 5, value: 1 }]
    },
    volumeKeyframes: [{ id: 'v0', time: 0, value: 0.1 }, { id: 'v8', time: 8, value: 1.5 }],
    mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 50, h: 50, keyframes: [{ id: 'm0', time: 0, cx: 0, cy: 0, w: 50, h: 50 }, { id: 'm4', time: 4, cx: 400, cy: 100, w: 150, h: 90, rot: 1 }] }
  } as Clip
  p.captions = []
  return p
}

test('K5: the held frame shows the pose, opacity, mask and volume of the frame it holds', () => {
  const p = project()
  const orig = structuredClone(p.clips.x)
  useStore.getState().loadProject(p)
  useStore.setState({ currentTime: 5, selectedClipIds: ['x'] })
  useStore.getState().insertFreezeFrame(2)
  const q = useStore.getState().project
  const hold = Object.values(q.clips).find((c) => c.freeze !== undefined)!
  assert.ok(hold, 'a held frame')
  const cut = 3
  const want = { t: clipTransformAt(orig, cut), o: clipOpacityAt(orig, cut), m: maskGeomAt(orig.mask!, cut), v: automationGainAt(orig, cut) }
  assert.ok(Math.abs(want.t.scale - 1.84375) < 1e-9, 'the keyed zoom is part way at the cut')
  for (const u of [0, 0.7, 1.3, 2]) {
    assert.deepEqual(clipTransformAt(hold, u), want.t, `transform at ${u}`)
    assert.equal(clipOpacityAt(hold, u), want.o)
    const m = maskGeomAt(hold.mask!, u)
    assert.deepEqual([m.cx, m.cy, m.w, m.h, m.rot], [want.m.cx, want.m.cy, want.m.w, want.m.h, want.m.rot])
    assert.equal(automationGainAt(hold, u), want.v)
  }
  // Either side of it the motion is the motion it was.
  const left = q.clips.x
  const right = Object.values(q.clips).find((c) => c.id !== 'x' && c.freeze === undefined)!
  for (const u of [0.5, 2.9]) assert.ok(Math.abs(clipTransformAt(left, u).scale - clipTransformAt(orig, u).scale) < 1e-9)
  for (const u of [0.1, 2, 4.9]) assert.ok(Math.abs(clipTransformAt(right, u).x - clipTransformAt(orig, cut + u).x) < 1e-9)
})
