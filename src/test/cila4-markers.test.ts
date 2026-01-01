// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// cila4, 6: a ruler marker dragged lands on what is near it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip } from '../renderer/src/types'
import { markerSnap } from '../renderer/src/components/marker-drag'

function project() {
  const p = defaultProject('16:9', 'en')
  p.clips = { A: { id: 'A', assetId: 'x', trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  p.captions = []
  p.markers = [
    { id: 'm1', time: 2, color: '#ffd83d', note: '' },
    { id: 'm2', time: 9, color: '#4fa8ff', note: '' }
  ]
  return p
}

test('a dragged marker snaps to a clip edge, the playhead, another marker; never to its own place', () => {
  const p = project()
  assert.deepEqual(markerSnap(p, 5.95, 'm1', 0, 0.1), { time: 6, guide: 6 })
  assert.deepEqual(markerSnap(p, 3.04, 'm1', 3, 0.1), { time: 3, guide: 3 })
  assert.deepEqual(markerSnap(p, 8.97, 'm1', 0, 0.1), { time: 9, guide: 9 })
  // Its own place is no target: a small move is a small move.
  assert.deepEqual(markerSnap(p, 2.05, 'm1', 0, 0.1), { time: 2.05, guide: null })
  // Nothing near: where the pointer is; never before the start.
  assert.deepEqual(markerSnap(p, 4.5, 'm1', 0, 0.1), { time: 4.5, guide: null })
  assert.deepEqual(markerSnap(p, -3, 'm1', 1, 0.1), { time: 0, guide: 0 })
  // The nearest of two targets.
  assert.deepEqual(markerSnap(p, 5.97, 'm1', 5.9, 0.1), { time: 6, guide: 6 })
})
