// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b (FAZC3B-PLAN.md): the sound's pure parts — the resampler (R11),
// the true-peak limiter (R10), the declick (R9), the loudness read in pieces
// and the voice read in pieces (decision 1), the bar by measured cost (R29).
import assert from 'node:assert/strict'
import test from 'node:test'
import { resample, resampledLength } from '../renderer/src/audio/resample'
import { limitAll, TruePeakLimiter } from '../renderer/src/audio/limiter'
import { integratedLufsMulti, LoudnessMeter } from '../renderer/src/audio/loudness'
import { VoiceBlocks, voiceGuard } from '../renderer/src/audio/sfx-mix'
import { continuesInto, declickAt, declickEdges, DECLICK_SEC, levelAt, levelCurve } from '../renderer/src/export/audio-window'
import { WorkBar } from '../renderer/src/export/progress'
import type { Clip } from '../renderer/src/types'

const sine = (n: number, sr: number, f: number, a = 0.5, phase = 0): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr + phase))

/** The level (dB, against `ref`) of frequency `f` in `x` (a Hann-windowed DFT bin). */
function levelDb(x: Float32Array, sr: number, f: number, ref: number): number {
  let re = 0
  let im = 0
  let w = 0
  for (let i = 0; i < x.length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    re += x[i] * h * Math.cos((2 * Math.PI * f * i) / sr)
    im -= x[i] * h * Math.sin((2 * Math.PI * f * i) / sr)
    w += h
  }
  return 20 * Math.log10(Math.max(1e-12, (2 * Math.hypot(re, im)) / w) / ref)
}

/** The true peak of a signal: its samples and 15 points between each two,
 *  read through a long sinc (a finer look than the limiter's own). */
const TP = Array.from({ length: 15 }, (_, q) => Float64Array.from({ length: 64 }, (_, j) => {
  const t = j - 31 - (q + 1) / 16
  return (Math.sin(Math.PI * t) / (Math.PI * t)) * (0.5 + 0.5 * Math.cos((Math.PI * t) / 33))
}))
function truePeak(x: Float32Array): number {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  for (let i = 32; i < x.length - 32; i++) {
    for (const c of TP) {
      let acc = 0
      for (let j = 0; j < 64; j++) acc += x[i - 31 + j] * c[j]
      m = Math.max(m, Math.abs(acc))
    }
  }
  return m
}

test('R11: 44.1 kHz to 48 kHz keeps a tone at its level and leaves its image 60 dB down or more', () => {
  for (const f of [1000, 10000, 18000, 19500]) {
    const x = sine(44100, 44100, f)
    const y = resample(x, 44100, 48000)
    assert.equal(y.length, resampledLength(44100, 44100, 48000))
    assert.equal(y.length, 48000)
    const mid = y.subarray(4000, 44000)
    const tone = levelDb(mid, 48000, f, 0.5)
    assert.ok(Math.abs(tone) < 0.1, `${f} Hz kept at its level (${tone.toFixed(3)} dB)`)
    // The image of an upsampling (44.1 − f kHz), folded at 48 kHz's Nyquist.
    const img = 48000 - (44100 - f)
    const image = levelDb(mid, 48000, img, 0.5)
    assert.ok(image <= -60, `${f} Hz: its image at ${img} Hz is ${image.toFixed(1)} dB`)
  }
})

test('R11: the resampler lines the first samples up, keeps a constant exactly and goes down in rate too', () => {
  const dc = new Float32Array(2000).fill(0.25)
  const y = resample(dc, 44100, 48000)
  for (let i = 100; i < y.length - 100; i++) assert.ok(Math.abs(y[i] - 0.25) < 1e-6)
  // A tone's phase: output sample j at input position j · 44100 / 48000.
  const x = sine(44100, 44100, 440)
  const z = resample(x, 44100, 48000)
  for (const j of [1000, 20000, 40000]) assert.ok(Math.abs(z[j] - 0.5 * Math.sin((2 * Math.PI * 440 * j) / 48000)) < 1e-3)
  // 96 kHz → 48 kHz: a 30 kHz tone (over 48 kHz's Nyquist) is gone, not folded to 18 kHz.
  const hi = sine(96000, 96000, 30000)
  const d = resample(hi, 96000, 48000)
  assert.ok(levelDb(d.subarray(2000, 46000), 48000, 18000, 0.5) < -60)
  // The same rate: a copy.
  assert.deepEqual(Array.from(resample(x.subarray(0, 10), 48000, 48000)), Array.from(x.subarray(0, 10)))
})

test('R10: two full-scale tones summed come out of the limiter at −1 dBTP or under, in step with the input', () => {
  const sr = 48000
  const a = sine(sr * 2, sr, 997, 0.999)
  const b = sine(sr * 2, sr, 1503, 0.999)
  const sum = a.map((v, i) => v + b[i])
  const { out, stats } = limitAll([sum, sum], sr)
  assert.equal(out[0].length, sum.length, 'as long as the input')
  const tp = truePeak(out[0])
  assert.ok(20 * Math.log10(tp) <= -1.0 + 0.05, `true peak ${(20 * Math.log10(tp)).toFixed(2)} dBTP`)
  assert.ok(stats.samples > 0 && stats.maxDb > 6, `it acted (${stats.maxDb.toFixed(1)} dB)`)
  // A quiet signal goes through untouched, sample for sample, not delayed.
  const quiet = sine(sr, sr, 440, 0.3)
  const q = limitAll([quiet], sr)
  assert.equal(q.stats.samples, 0)
  for (let i = 0; i < quiet.length; i++) assert.equal(q.out[0][i], quiet[i])
})

test('R10: a film through the limiter in pieces is the same as in one go', () => {
  const sr = 48000
  const x = Float32Array.from({ length: sr * 3 }, (_, i) => 1.4 * Math.sin((2 * Math.PI * 220 * i) / sr) * (i % 30000 < 9000 ? 1 : 0.2))
  const whole = limitAll([x], sr).out[0]
  const lim = new TruePeakLimiter(sr, 1)
  const parts: Float32Array[] = []
  for (const [from, to] of [[0, 100], [100, 50000], [50000, 50001], [50001, x.length]]) parts.push(lim.process([x.subarray(from, to)])[0])
  parts.push(lim.flush()[0])
  const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    joined.set(p, at)
    at += p.length
  }
  assert.equal(joined.length, whole.length)
  for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(joined[i] - whole[i]) < 1e-6, `sample ${i}`)
  assert.ok(20 * Math.log10(truePeak(whole)) <= -0.95)
})

test('R9: the declick is a 4 ms raised cosine at a hard cut, none where a transition fades or the recording plays on', () => {
  const edges = { head: true, tail: true }
  assert.equal(declickAt(0, 2, edges), 0)
  assert.ok(Math.abs(declickAt(DECLICK_SEC / 2, 2, edges) - 0.5) < 1e-9)
  assert.equal(declickAt(DECLICK_SEC, 2, edges), 1)
  assert.equal(declickAt(1, 2, edges), 1)
  assert.ok(Math.abs(declickAt(2 - DECLICK_SEC / 2, 2, edges) - 0.5) < 1e-9)
  assert.equal(declickAt(2, 2, edges), 0)
  assert.equal(declickAt(0, 2, { head: false, tail: true }), 1)
  const clip = (id: string, start: number, duration: number, inPoint: number, extra: Partial<Clip> = {}): Clip =>
    ({ id, assetId: 'a', trackId: 'A1', start, duration, inPoint, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...extra }) as Clip
  const NONE = { duration: 0, pre: 0, post: 0 }
  const a = clip('a', 0, 2, 5)
  const b = clip('b', 2, 3, 7) // the recording plays on: a split
  const c = clip('c', 5, 1, 20) // a cut: elsewhere in the file
  assert.equal(continuesInto(a, b), true)
  assert.equal(continuesInto(b, c), false)
  assert.equal(continuesInto(a, clip('d', 2, 3, 7, { assetId: 'other' })), false)
  // At another speed the recording runs on only when the pitch follows the
  // speed (core polish B): with the pitch kept each piece is stretched on its
  // own grid, so the join is a cut and gets the declick.
  assert.equal(continuesInto(clip('s', 0, 2, 5, { speed: 2, keepPitch: false }), clip('t', 2, 1, 9, { speed: 2, keepPitch: false })), true)
  assert.equal(continuesInto(clip('s', 0, 2, 5, { speed: 2 }), clip('t', 2, 1, 9, { speed: 2 })), false)
  assert.deepEqual(declickEdges(a, [a, b, c], NONE, NONE), { head: true, tail: false })
  assert.deepEqual(declickEdges(b, [a, b, c], NONE, NONE), { head: false, tail: true })
  assert.deepEqual(declickEdges(c, [a, b, c], NONE, NONE), { head: true, tail: true })
  // A dissolve's crossfade covers its edges.
  assert.deepEqual(declickEdges(c, [a, b, c], { duration: 0.5, pre: 0.25, post: 0.25, type: 'mix' }, { duration: 0.5, pre: 0.25, post: 0.25, type: 'mix' }), { head: false, tail: false })
})

test('R9: the level is read every millisecond (far above 200 per second) and straight between', () => {
  const curve = levelCurve((t) => (t < 1 ? t : 1), 0, 2)
  assert.ok(curve.v.length >= 2000)
  assert.ok(Math.abs(levelAt(curve, 0.5) - 0.5) < 1e-6)
  assert.ok(Math.abs(levelAt(curve, 0.0125) - 0.0125) < 1e-6)
  assert.equal(levelAt(curve, 5), 1)
})

test('decision 1: the loudness read in pieces is the loudness of the whole', () => {
  const sr = 48000
  const L = Float32Array.from({ length: sr * 7 + 123 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr) * (i % sr < sr * 0.6 ? 1 : 0.05))
  const R = Float32Array.from(L, (v, i) => v * 0.7 + 0.01 * Math.sin(i))
  const whole = integratedLufsMulti([L, R], sr)
  const m = new LoudnessMeter(sr, 2)
  for (const [a, b] of [[0, 1000], [1000, sr * 3], [sr * 3, sr * 3 + 1], [sr * 3 + 1, L.length]]) m.push([L.subarray(a, b), R.subarray(a, b)])
  assert.ok(Math.abs(m.integrated() - whole) < 1e-6, `${m.integrated()} vs ${whole}`)
  let peak = 0
  for (const x of [L, R]) for (const v of x) peak = Math.max(peak, Math.abs(v))
  assert.ok(Math.abs(m.peak - peak) < 1e-7)
})

test('decision 1: the voice read window by window gives the guard the whole film gives', () => {
  const sr = 48000
  const L = Float32Array.from({ length: sr * 5 }, (_, i) => 0.4 * Math.sin(i / 7) * (Math.floor(i / 7000) % 3 === 0 ? 1 : 0.1))
  const R = Float32Array.from(L, (v) => v * 0.8)
  const whole = voiceGuard(L, R, sr)!
  const v = new VoiceBlocks(sr)
  const W = 2400 * 20
  for (let a = 0; a < L.length; a += W) v.push(L.subarray(a, a + W), R.subarray(a, a + W))
  const parts = v.guard()!
  assert.equal(parts.usualRms, whole.usualRms)
  for (const [a, b] of [[0, 0.1], [1.3, 1.4], [4.2, 4.9]]) assert.deepEqual(parts.allowed(a, b), whole.allowed(a, b))
})

test('R29: the bar counts the frames and the sound by their measured cost, and never goes back', () => {
  // 1000 frames and 10 windows; a frame costs 5 ms, a window 500 ms: the
  // sound is half the work.
  const bar = new WorkBar(1000, 10, 0, 1)
  for (let k = 0; k < 2; k++) bar.window(500)
  for (let i = 0; i < 100; i++) bar.frame(5)
  const f = bar.fraction()
  // 100 frames (500 ms) + 2 windows (1000 ms) of 10 000 ms.
  assert.ok(Math.abs(f - 0.15) < 1e-9, `${f}`)
  // After the first 100 frames a frame's share is fixed.
  for (let i = 0; i < 400; i++) bar.frame(50)
  assert.ok(Math.abs(bar.fraction() - (2500 + 1000) / 10000) < 1e-9)
  let last = 0
  for (let k = 0; k < 8; k++) {
    bar.window(500)
    assert.ok(bar.fraction() >= last)
    last = bar.fraction()
  }
  for (let i = 0; i < 500; i++) bar.frame(5)
  assert.equal(bar.fraction(), 1)
})
