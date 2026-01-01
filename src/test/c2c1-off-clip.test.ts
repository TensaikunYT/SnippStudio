// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decision 7 (report K26): a key off the clip (kept by a trim or
// a cut) is not drawn as a diamond and cannot be taken; the clip's edge shows
// one mark saying keys lie beyond it. A ripple drag of the diamonds leaves
// the keys off the clip where they are.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { keyframeGroups, keysOffClip } from '../renderer/src/components/timeline/shared'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip } from '../renderer/src/types'

const keyed = (): Clip =>
  ({
    id: 'c',
    assetId: 'vid',
    trackId: 'V1',
    start: 0,
    inPoint: 10,
    duration: 6,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    volume: 1,
    channels: {
      x: [{ id: 'x0', time: -2, value: 0 }, { id: 'x1', time: 1, value: 1 }, { id: 'x2', time: 6, value: 2 }, { id: 'x3', time: 9, value: 3 }],
      scale: [{ id: 's1', time: 1, value: 1 }, { id: 's2', time: 7.5, value: 2 }]
    },
    volumeKeyframes: [{ id: 'v1', time: -1, value: 0.5 }, { id: 'v2', time: 3, value: 1 }],
    mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 1, h: 1, keyframes: [{ id: 'm', time: 12, cx: 0, cy: 0, w: 1, h: 1 }] }
  }) as Clip

test('K26: only keys on the clip are diamonds; the rest are counted for the mark at each edge', () => {
  const c = keyed()
  assert.deepEqual(keyframeGroups(c).map((g) => [g.time, g.channels.join('+')]), [[1, 'x+scale'], [6, 'x']])
  assert.deepEqual(keysOffClip(c), { before: 2, after: 3 })
  assert.deepEqual(keysOffClip({ ...c, duration: 20 } as Clip), { before: 2, after: 0 })
})

test('decision 1: a ripple drag of the diamonds leaves the keys off the clip where they are', () => {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['c'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: false } as never]
  p.clips.c = keyed()
  p.captions = []
  useStore.getState().loadProject(p)
  // (Phase Ç2c.2, decision 2: the delta is held so the last key on the clip
  // stays on it — the key at 6 is at the end, so a ripple later moves
  // nothing; one earlier moves every key on the clip from 1 on.)
  useStore.getState().rippleKeyframes('c', 1, 2)
  assert.deepEqual(useStore.getState().project.clips.c.channels!.x!.map((k) => k.time), [-2, 1, 6, 9], 'nothing moves past the end')
  useStore.getState().rippleKeyframes('c', 1, -0.5)
  const x = useStore.getState().project.clips.c.channels!.x!.map((k) => k.time)
  assert.deepEqual(x, [-2, 0.5, 5.5, 9], 'the keys on the clip from 1 on moved by -0.5; -2 and 9 (off the clip) kept')
  assert.deepEqual(useStore.getState().project.clips.c.channels!.scale!.map((k) => k.time), [0.5, 7.5])
})
