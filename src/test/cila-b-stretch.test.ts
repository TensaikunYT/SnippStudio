// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md, decision K6): the pitch-preserving
// time stretch of the export (audio/time-stretch.ts). A tone keeps its
// frequency and its level, the length is the input's ÷ speed, speed 1 is the
// input itself, and — what the windowed export mix needs — any stretch of
// the output is the same samples whoever asks for it and from wherever.
import assert from 'node:assert/strict'
import test from 'node:test'
import { stretch, stretchAll, stretchInputSpan, stretchPlan } from '../renderer/src/audio/time-stretch'

const SR = 48000
const plan = stretchPlan(SR)
const sine = (n: number, f: number, a = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR))

/** The level of frequency `f` in `x` (a Hann-windowed DFT bin; 1 = a full-scale sine). */
function level(x: Float32Array, f: number): number {
  let re = 0
  let im = 0
  let w = 0
  for (let i = 0; i < x.length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    re += x[i] * h * Math.cos((2 * Math.PI * f * i) / SR)
    im -= x[i] * h * Math.sin((2 * Math.PI * f * i) / SR)
    w += h
  }
  return (2 * Math.hypot(re, im)) / w
}
/** The loudest frequency of `x` between `lo` and `hi` Hz (1 Hz steps, over
 *  at most its first second). */
function peak(all: Float32Array, lo: number, hi: number): number {
  const x = all.subarray(0, Math.min(all.length, SR))
  let best = lo
  let top = -1
  for (let f = lo; f <= hi; f += 1) {
    const l = level(x, f)
    if (l > top) {
      top = l
      best = f
    }
  }
  return best
}
const rms = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
/** A voice-like signal: a 140 Hz buzz with moving formants and pauses (seeded). */
function voiceLike(n: number): Float32Array {
  let seed = 12345
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const f0 = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * t)
    phase += (2 * Math.PI * f0) / SR
    const env = Math.max(0, Math.sin(2 * Math.PI * 1.3 * t)) ** 0.5
    out[i] = env * (0.3 * Math.sin(phase) + 0.15 * Math.sin(2 * phase + 1) + 0.1 * Math.sin(5 * phase + 2) + 0.02 * (rnd() - 0.5))
  }
  return out
}

test('a 440 Hz tone at 2x and at 0.5x stays 440 Hz (within 1 %), at its level, and lasts its length / speed', () => {
  const x = sine(SR * 16, 440)
  for (const speed of [2, 0.5, 0.25, 1.5, 4, 8]) {
    const t0 = performance.now()
    const [y] = stretchAll([x], speed, plan)
    console.log(`  x${speed}: ${(y.length / SR).toFixed(1)} s of sound stretched in ${(performance.now() - t0).toFixed(0)} ms`)
    assert.equal(y.length, Math.round(x.length / speed), `x${speed}: length`)
    // (Away from the ends, where the input runs out under the last frames.)
    const mid = y.subarray(Math.round(y.length * 0.1), Math.round(y.length * 0.9))
    const f = peak(mid, 400, 480)
    assert.ok(Math.abs(f - 440) <= 4.4, `x${speed}: the tone is at ${f} Hz`)
    // An octave up or down (what a plain resample would give) holds nothing.
    assert.ok(level(mid, 440 * speed) < 0.05, `x${speed}: nothing at ${440 * speed} Hz (${level(mid, 440 * speed).toFixed(3)})`)
    const r = rms(mid) / rms(x)
    assert.ok(r > 0.85 && r < 1.1, `x${speed}: its level is kept (${r.toFixed(3)} of the input's)`)
  }
})

test('speed 1 gives the input back, sample for sample', () => {
  for (const x of [sine(SR, 480), sine(SR, 441.7), voiceLike(SR * 3)]) {
    const [y] = stretchAll([x], 1, plan)
    assert.equal(y.length, x.length)
    for (let i = 0; i < x.length; i++) if (y[i] !== x[i]) assert.fail(`sample ${i}: ${y[i]} is not ${x[i]}`)
  }
})

test('any stretch of the output is the same samples, asked for whole or in windows from anywhere', () => {
  const x = voiceLike(SR * 9)
  const right = Float32Array.from(x, (v, i) => v * 0.6 + 0.1 * Math.sin(i / 37))
  for (const speed of [0.5, 1.25, 2, 6.5]) {
    const whole = stretchAll([x, right], speed, plan)
    const n = whole[0].length
    // Windows that start anywhere (mid-frame, just before and after an anchor).
    const cuts = [...new Set([0, 1, 719, 720, 5000, plan.anchor * plan.hop - 1, plan.anchor * plan.hop, plan.anchor * plan.hop + 1, Math.round(n * 0.61), n].filter((c) => c <= n))].sort((a, b) => a - b)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const from = cuts[i]
      const count = cuts[i + 1] - from
      if (count <= 0) continue
      // The caller hands over only what stretchInputSpan asks for.
      const [a, b] = stretchInputSpan(speed, from, count, plan)
      const lo = Math.max(0, a)
      const hi = Math.min(x.length, b)
      const part = stretch([x.subarray(lo, hi), right.subarray(lo, hi)], lo, speed, from, count, plan)
      for (let c = 0; c < 2; c++) for (let k = 0; k < count; k++) if (part[c][k] !== whole[c][from + k]) assert.fail(`x${speed}, window from ${from}, channel ${c}, sample ${k}: ${part[c][k]} is not ${whole[c][from + k]}`)
    }
  }
})

test('a voice-like sound keeps its pitch and loses no level; both channels move together', () => {
  const x = voiceLike(SR * 6)
  const inv = Float32Array.from(x, (v) => -v * 0.5)
  for (const speed of [0.5, 2, 3]) {
    const [l, r] = stretchAll([x, inv], speed, plan)
    // The right channel is the left one's mirror at half level, sample for sample.
    for (let i = 0; i < l.length; i++) if (Math.abs(r[i] + l[i] * 0.5) > 1e-6) assert.fail(`x${speed}: channels apart at ${i}`)
    const ratio = rms(l) / rms(x)
    assert.ok(ratio > 0.8 && ratio < 1.15, `x${speed}: level ${ratio.toFixed(3)}`)
    // The buzz's first harmonic stays between 110 and 170 Hz (140 ± 30).
    const f = peak(l.subarray(0, Math.min(l.length, SR * 2)), 80, 400)
    assert.ok(f >= 105 && f <= 175, `x${speed}: the fundamental is at ${f} Hz`)
  }
})

test('silence stays silence, and what lies outside the input counts as silence', () => {
  const [y] = stretchAll([new Float32Array(SR)], 2, plan)
  assert.ok(y.every((v) => v === 0))
  // Asked for more than there is: no throw, zeros beyond.
  const out = stretch([sine(1000, 440)], 0, 2, 0, 5000, plan)[0]
  assert.equal(out.length, 5000)
  assert.ok(out.subarray(2000).every((v) => v === 0))
})

test('a speed that changes along the clip (part C will use it): the map is followed, windows still agree', () => {
  // From 1x to 3x over the clip: output sample m stands for input m + m² / (2 × n).
  const x = voiceLike(SR * 8)
  const n = SR * 3
  const at = (m: number): number => m + (m * m) / n
  const whole = stretch([x], 0, at, 0, n, plan)[0]
  assert.equal(whole.length, n)
  assert.ok(rms(whole) / rms(x) > 0.7, 'heard')
  // The same samples from the middle on, with only the input that asks for.
  const from = 70001
  const [a, b2] = stretchInputSpan(at, from, n - from, plan)
  const lo = Math.max(0, a)
  const hi = Math.min(x.length, b2)
  const part = stretch([x.subarray(lo, hi)], lo, at, from, n - from, plan)[0]
  for (let k = 0; k < part.length; k++) if (part[k] !== whole[from + k]) assert.fail(`sample ${k}: ${part[k]} is not ${whole[from + k]}`)
  // One speed written as a map is that speed.
  const lin = stretch([x], 0, (m) => m * 2, 0, 20000, plan)[0]
  const two = stretch([x], 0, 2, 0, 20000, plan)[0]
  for (let k = 0; k < lin.length; k++) if (lin[k] !== two[k]) assert.fail(`sample ${k}`)
})
