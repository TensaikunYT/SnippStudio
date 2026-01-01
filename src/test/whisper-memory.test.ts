// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { whisperTokenCap } from '../renderer/src/subtitles/decode'
import { planWhisperMemory, TIGHT_MEMORY_NOTE, whisperCpuPeak } from '../renderer/src/subtitles/models'
import { mergeSliceWords, type SliceWord } from '../renderer/src/subtitles/slices'

const GB = 1e9
const multilingualCpu = [313_154_567, 672_561_526]

test('the model loads with room for it, on one thread with less, and not at all with less still', () => {
  // The q8 pair as measured: 2.2 GB at its peak (the thresholds English had
  // for this same pair, phase 9a).
  const peak = whisperCpuPeak(multilingualCpu)
  assert.ok(peak > 2.2 * GB && peak < 2.4 * GB)
  assert.deepEqual(planWhisperMemory({ free: 12 * GB, set: multilingualCpu }), { use: 'load' })
  assert.deepEqual(planWhisperMemory({ free: 3.5 * GB, set: multilingualCpu }), { use: 'load' })
  assert.deepEqual(planWhisperMemory({ free: 3 * GB, set: multilingualCpu }), { use: 'load', note: TIGHT_MEMORY_NOTE, safe: 2 })
  const none = planWhisperMemory({ free: 2.1 * GB, set: multilingualCpu })
  assert.equal(none.use, 'none')
  assert.match(none.use === 'none' ? none.error : '', /2\.1 GB free, about 2\.9 GB needed/)
  // Unknown memory, or no set on disk: nothing is checked.
  assert.deepEqual(planWhisperMemory({ free: null, set: multilingualCpu }), { use: 'load' })
  assert.deepEqual(planWhisperMemory({ free: 1 * GB, set: null }), { use: 'load' })
})

test('the token cap leaves real speech alone and stops a runaway window', () => {
  assert.equal(whisperTokenCap(25, 'english'), 233)
  assert.equal(whisperTokenCap(25, 'turkish'), 408)
  assert.equal(whisperTokenCap(30, 'turkish', true), 440)
  assert.equal(whisperTokenCap(1, 'english'), 17)
  assert.equal(whisperTokenCap(0, 'english'), 16)
  assert.equal(whisperTokenCap(Number.NaN, 'english'), 16)
})

const w = (text: string, a: number, b: number): SliceWord => ({ text, timestamp: [a, b] })

test('an overlapping cut keeps each word once, joined by its text', () => {
  const merged: SliceWord[] = []
  // Slice 0 covers 0..25 and keeps words before 23.5.
  mergeSliceWords(merged, [w('one', 22.6, 22.9), w('two', 23.2, 23.6), w('three', 23.7, 24.0)], { from: 0, to: 25, keepFrom: -Infinity, keepTo: 23.5 })
  assert.deepEqual(merged.map((x) => x.text), ['one', 'two'])
  // Slice 1 starts at 22 and hears "two" a little later (23.45 instead of 23.2).
  mergeSliceWords(merged, [w('one', 0.62, 0.9), w('two', 1.45, 1.7), w('three', 1.75, 2.0), w('four', 2.1, 2.4)], { from: 22, to: 47, keepFrom: 23.5, keepTo: Infinity })
  assert.deepEqual(merged.map((x) => x.text), ['one', 'two', 'three', 'four'])
  assert.equal(merged[2].timestamp[0], 23.75)
})

test('an overlapping cut whose word was heard differently joins by time', () => {
  const merged: SliceWord[] = [w('alpha', 23.0, 23.6)]
  mergeSliceWords(merged, [w('alfa', 1.05, 1.6), w('beta', 1.7, 2.0)], { from: 22, to: 47, keepFrom: 23.5, keepTo: Infinity })
  assert.deepEqual(merged.map((x) => x.text), ['alpha', 'beta'])
})

test('a pause cut simply keeps its own window', () => {
  const merged: SliceWord[] = [w('end', 9.0, 9.4)]
  mergeSliceWords(merged, [w('next', 0.5, 0.8)], { from: 10, to: 30, keepFrom: 10, keepTo: Infinity })
  assert.deepEqual(merged.map((x) => [x.text, x.timestamp[0]]), [['end', 9.0], ['next', 10.5]])
})
