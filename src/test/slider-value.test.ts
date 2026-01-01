// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { clampSliderEntry, sliderNumberFormat } from '../renderer/src/ui/slider-value'

test('editable slider boxes accept the visible percentage instead of the stored fraction', () => {
  const numeric = sliderNumberFormat(1, 0.05, (value) => `${Math.round(value * 100)}%`)
  assert.deepEqual(numeric, { scale: 100, suffix: '%', step: 5, digits: 2 })
  assert.equal(clampSliderEntry(55, 0, 1, numeric.scale), 0.55)
  assert.equal(clampSliderEntry(140, 0, 1, numeric.scale), 1)
})

test('time and special-state sliders keep their raw numeric units editable', () => {
  const seconds = sliderNumberFormat(2, 0.005, (value) => `${value.toFixed(2)}s`)
  assert.equal(seconds.scale, 1)
  assert.equal(seconds.suffix, 's')
  assert.equal(seconds.digits, 3)
  const off = sliderNumberFormat(300, 10, (value) => value === 0 ? 'off' : value.toFixed(0))
  assert.equal(off.scale, 1)
  assert.equal(off.suffix, '')
  assert.equal(clampSliderEntry(-10, 0, 300, off.scale), 0)
})
