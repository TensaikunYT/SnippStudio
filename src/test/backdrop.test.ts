// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKDROPS, cleanBackdrop } from '../renderer/src/playback/backdrop'

test('a saved background is repaired: unknown styles and bad values dropped', () => {
  assert.deepEqual(cleanBackdrop({ style: 'aurora', tint: '#112233', motion: 0.3 }), { style: 'aurora', tint: '#112233', motion: 0.3 })
  assert.deepEqual(cleanBackdrop({ style: 'grid', tint: 'red', motion: 9 }), { style: 'grid', motion: 1 })
  assert.equal(cleanBackdrop({ style: 'lava' }), undefined)
  assert.equal(cleanBackdrop({ style: 'black' }), undefined, 'black is simply no background')
  assert.equal(cleanBackdrop(null), undefined)
})

test('every background has a name, a hint and an accent colour', () => {
  assert.ok(BACKDROPS.length >= 6)
  for (const b of BACKDROPS) assert.ok(b.label && b.hint && /^#[0-9a-f]{6}$/i.test(b.tint), b.id)
})
