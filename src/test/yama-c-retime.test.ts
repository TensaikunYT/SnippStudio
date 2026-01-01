// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), found by the oracle's wild kind (seeds 201, 282, 547,
// 582): retiming a clip pushes the clips after it when they join it; "after"
// was any clip starting within 0.06 s of its old end, so a clip shorter than
// that (two pieces at 100x) counted the clip BEFORE it too and pushed it over
// its neighbours (track-overlap).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState
const T = { x: 960, y: 540, scale: 1, rotation: 0 }

function base(): Project {
  const p = defaultProject()
  // (60 fps: the one-frame floor, 0.017 s, lets two pieces at 100x fit in 0.06 s.)
  p.settings.fps = 60
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 120, width: 1920, height: 1080, hasAudio: false } as never]
  p.clips.a = { id: 'a', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 0, duration: 3.4, transform: T, volume: 1 } as Clip
  p.clips.b = { id: 'b', assetId: 'vid', trackId: 'V1', start: 3.4, inPoint: 10, duration: 2.1, transform: T, volume: 1 } as Clip
  p.clips.c = { id: 'c', assetId: 'vid', trackId: 'V1', start: 5.5, inPoint: 30, duration: 4, transform: T, volume: 1 } as Clip
  return p
}

test('retiming a clip shorter than the join allowance pushes only the clips after it', () => {
  for (const slow of [
    (): void => S().setClipSpeedCurve('b', { points: [{ u: 0, v: 4 }, { u: 0.65, v: 0.5 }, { u: 1, v: 0.5 }] }),
    (): void => S().setClipSpeed('b', 0.5)
  ]) {
    S().loadProject(base())
    S().setClipSpeed('a', 100)
    S().setClipSpeed('b', 100)
    const p = S().project
    assert.ok(p.clips.b.start + p.clips.b.duration < 0.06, `b ends at ${p.clips.b.start + p.clips.b.duration}`)
    slow()
    const q = S().project
    assert.equal(q.clips.a.start, 0, 'the clip before stays')
    const order = ['a', 'b', 'c'].map((id) => q.clips[id])
    for (let i = 1; i < order.length; i++) assert.ok(order[i].start >= order[i - 1].start + order[i - 1].duration - 1e-9, `${order[i].id} at ${order[i].start} under ${order[i - 1].id}`)
  }
})
