// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { phrasesFromDb } from '../renderer/src/audio/voice-beats'

const W = 0.02

/** Syllables every 0.2 s for `sec` seconds, every fourth one stressed. */
function syllables(dbs: number[], sec: number): number[] {
  const t0 = dbs.length * W
  const stressed: number[] = []
  const n = Math.round(sec / W)
  for (let i = 0; i < n; i++) {
    const t = i * W
    const s = Math.floor(t / 0.2)
    const ph = (t % 0.2) / 0.2
    const peak = s % 4 === 0 ? -12 : -22
    if (s % 4 === 0 && i % 10 === 0) stressed.push(t0 + s * 0.2 + 0.0714)
    dbs.push(-34 + (peak + 34) * Math.sin(Math.PI * Math.min(1, ph * 1.4)) ** 2)
  }
  return stressed
}
const quiet = (dbs: number[], sec: number): void => {
  for (let i = 0; i < Math.round(sec / W); i++) dbs.push(-60)
}

test('voice: phrases and their stressed beats come from the loudness alone', () => {
  const dbs: number[] = []
  quiet(dbs, 1)
  const stressed = syllables(dbs, 1.2)
  quiet(dbs, 0.2) // a breath: the same phrase
  stressed.push(...syllables(dbs, 1.2))
  quiet(dbs, 1.5) // a real pause: a new phrase
  stressed.push(...syllables(dbs, 1.6))
  quiet(dbs, 1)
  const out = phrasesFromDb(dbs, W, 10)
  assert.equal(out.length, 2)
  assert.ok(Math.abs(out[0].start - 11) < 0.05, `starts at ${out[0].start}`)
  for (const ph of out) {
    assert.ok(ph.beats.length >= 2)
    for (let i = 1; i < ph.beats.length; i++) assert.ok(ph.beats[i].t - ph.beats[i - 1].t >= 0.45 - 1e-9)
    // Every beat is on a stressed syllable, and a strong one.
    for (const b of ph.beats) {
      assert.ok(stressed.some((t) => Math.abs(t + 10 - b.t) < 0.08), `beat at ${b.t.toFixed(2)}`)
      assert.ok(b.k > 0.5, `strength ${b.k}`)
    }
  }
})
