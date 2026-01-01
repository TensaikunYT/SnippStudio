// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLEAN_FRAME, framePower, noiseProfile, pcm16, VoiceCleaner, wavHeader } from '../renderer/src/audio/clean'

const SR = 48000
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296 - 0.5
}
const rms = (x: Float32Array, a: number, b: number): number => {
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}
/** Cleans in uneven pieces, as the decoder hands them over. */
function run(x: Float32Array, noise: Float64Array, opts: { noise: number; ess: number }): Float32Array {
  const c = new VoiceCleaner(SR, noise, opts)
  const out = new Float32Array(x.length)
  let n = 0
  let given = 0
  for (let pos = 0; pos < x.length; ) {
    const len = Math.min(x.length - pos, 3000 + ((pos * 7) % 5000))
    const got = c.push(x.subarray(pos, pos + len))
    out.set(got, n)
    n += got.length
    given += got.length
    pos += len
  }
  out.set(c.flush(x.length, given), n)
  return out
}
const profileOf = (x: Float32Array): Float64Array => {
  const frames: Float64Array[] = []
  for (let i = 0; i + CLEAN_FRAME <= x.length; i += CLEAN_FRAME * 2) frames.push(framePower(x.subarray(i, i + CLEAN_FRAME)))
  return noiseProfile(frames)
}

test('set to nothing, the cleaner gives back exactly what came in, in step', () => {
  const r = rng(1)
  const x = Float32Array.from({ length: SR }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 330 * i) / SR) + 0.05 * r())
  const y = run(x, new Float64Array(CLEAN_FRAME / 2 + 1), { noise: 0, ess: 0 })
  assert.equal(y.length, x.length)
  let err = 0
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i] - y[i]))
  assert.ok(err < 1e-5, `${err}`)
})

test('the noise under a voice goes; the voice stays', () => {
  const r = rng(7)
  // One second of hiss alone, then a second with a tone over it.
  const x = Float32Array.from({ length: 2 * SR }, (_, i) => 0.03 * r() + (i >= SR ? 0.25 * Math.sin((2 * Math.PI * 220 * i) / SR) : 0))
  const y = run(x, profileOf(x), { noise: 0.8, ess: 0 })
  const before = rms(x, 2000, SR - 2000)
  const after = rms(y, 2000, SR - 2000)
  assert.ok(20 * Math.log10(after / before) < -12, `noise only ${(20 * Math.log10(after / before)).toFixed(1)} dB`)
  const tone = 20 * Math.log10(rms(y, SR + 4000, 2 * SR - 4000) / rms(x, SR + 4000, 2 * SR - 4000))
  assert.ok(Math.abs(tone) < 1.5, `tone ${tone.toFixed(2)} dB`)
})

test('esses are softened, the rest of the voice is not', () => {
  const r = rng(3)
  // A low voice-like tone with bursts of bright 7 kHz hiss in it.
  // Hiss around 7 kHz: slow noise riding a 7 kHz carrier.
  let lp = 0
  const x = Float32Array.from({ length: 2 * SR }, (_, i) => {
    lp += 0.15 * (r() - lp)
    const burst = Math.floor(i / (SR / 4)) % 2 === 1
    return 0.2 * Math.sin((2 * Math.PI * 180 * i) / SR) + (burst ? 3 * lp * Math.sin((2 * Math.PI * 7000 * i) / SR) : 0)
  })
  const y = run(x, new Float64Array(CLEAN_FRAME / 2 + 1), { noise: 0, ess: 1 })
  const hi = (z: Float32Array, a: number, b: number): number => {
    let s = 0
    for (let i = a + 1; i < b; i++) s += (z[i] - z[i - 1]) ** 2
    return Math.sqrt(s / (b - a))
  }
  const a = SR / 4 + 3000
  const b = SR / 2 - 3000
  assert.ok(20 * Math.log10(hi(y, a, b) / hi(x, a, b)) < -4, 'the burst is softer')
  // Between bursts the low tone is untouched.
  const tone = 20 * Math.log10(rms(y, 3000, SR / 4 - 3000) / rms(x, 3000, SR / 4 - 3000))
  assert.ok(Math.abs(tone) < 0.5, `${tone}`)
})

test('a WAV file: its header and its samples', () => {
  const h = wavHeader(48000, 1, 200)
  const v = new DataView(h.buffer)
  assert.equal(String.fromCharCode(...h.slice(0, 4)), 'RIFF')
  assert.equal(v.getUint32(24, true), 48000)
  assert.equal(v.getUint32(40, true), 200)
  const p = pcm16(Float32Array.from([0, 1, -1, 2]))
  const d = new DataView(p.buffer)
  assert.deepEqual([d.getInt16(0, true), d.getInt16(2, true), d.getInt16(4, true), d.getInt16(6, true)], [0, 32767, -32768, 32767])
})
