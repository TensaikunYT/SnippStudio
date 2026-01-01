// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { scaleClipFromCorner } from '../renderer/src/playback/clip-grip'

test('image corner resize holds the opposite corner and respects pointer grab offset', () => {
  const next = scaleClipFromCorner(
    { x: 100, y: 100, scale: 1, rotation: 0 }, 50, 30, 1, 1,
    { x: 153, y: 132 }, { x: 203, y: 162 }
  )
  assert.equal(next.scale, 1.5)
  assert.equal(next.x, 125)
  assert.equal(next.y, 115)
  assert.equal(next.x - 50 * next.scale, 50)
  assert.equal(next.y - 30 * next.scale, 70)
})

test('rotated image corner resize keeps its opposite rotated corner fixed', () => {
  const next = scaleClipFromCorner(
    { x: 100, y: 100, scale: 1, rotation: Math.PI / 2 }, 50, 30, 1, 1,
    { x: 70, y: 150 }, { x: 40, y: 200 }
  )
  assert.ok(Math.abs(next.scale - 1.5) < 1e-9)
  assert.ok(Math.abs(next.x - 85) < 1e-9)
  assert.ok(Math.abs(next.y - 125) < 1e-9)
})
