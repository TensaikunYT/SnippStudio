// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { frameLevels, planVoiceSlices } from '../renderer/src/subtitles/slices'

/** 10 ms levels: speech everywhere except the given pauses (seconds). */
function levels(duration: number, pauses: [number, number][]): Float32Array {
  const out = new Float32Array(Math.round(duration * 100)).fill(0.1)
  for (const [a, b] of pauses) for (let f = Math.round(a * 100); f < Math.round(b * 100); f++) out[f] = 0
  return out
}

test('the voice is cut in its pauses, never mid-word, each piece at most 25 s', () => {
  const lv = levels(70, [[12, 12.4], [21, 21.6], [24, 24.1], [40, 40.5], [47.2, 47.6], [57.8, 58.3]])
  const slices = planVoiceSlices(lv, 70)
  // The longest pause in the last 10 s of each piece (24–24.1 is too short to win over 21–21.6).
  assert.deepEqual(slices.map((s) => +s.to.toFixed(2)), [21.3, 40.25, 58.05, 70])
  for (const s of slices) assert.ok(s.to - s.from <= 25 + 1e-9)
  // Pieces meet exactly: every word is kept once.
  for (let i = 1; i < slices.length; i++) {
    assert.equal(slices[i].from, slices[i - 1].to)
    assert.equal(slices[i].keepFrom, slices[i - 1].keepTo)
  }
})

test('speech with no pause long enough falls back to the overlapping cut', () => {
  const slices = planVoiceSlices(levels(50, []), 50)
  assert.deepEqual(slices.map((s) => [s.from, s.to]), [[0, 25], [22, 47], [44, 50]])
  assert.equal(slices[0].keepTo, 23.5)
  assert.equal(slices[1].keepFrom, 23.5)
  // Short audio is one piece.
  assert.deepEqual(planVoiceSlices(levels(20, []), 20).map((s) => [s.from, s.to]), [[0, 20]])
})

test('frame levels are 10 ms RMS', () => {
  const audio = new Float32Array(16000).fill(0.5)
  const lv = frameLevels(audio, 16000)
  assert.equal(lv.length, 100)
  assert.ok(Math.abs(lv[0] - 0.5) < 1e-6)
})
