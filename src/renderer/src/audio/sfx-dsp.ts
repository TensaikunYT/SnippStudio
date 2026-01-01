// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The small DSP kit every code-made sound is built from (sfx-synth.ts, the
// craft run's round 6 sounds in sfx-synth2.ts, and a film's own sounds.js
// through its kit): seeded noise, one-pole and band-pass filters, decaying
// tones, struck bars (modal partials), a pitch shift. Pure and free of the
// DOM, so node (the review, the tests) makes the same samples as the app.

/** A seeded generator in 0..1 (mulberry32): the same seed, the same numbers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A band-pass (RBJ) whose centre can move; coefficients per 32 samples. */
export function bandpass(x: Float32Array, sr: number, f: (i: number) => number, q: number): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  let b0 = 0
  let b2 = 0
  let a1 = 0
  let a2 = 0
  for (let i = 0; i < x.length; i++) {
    if (i % 32 === 0) {
      const w = (2 * Math.PI * Math.min(sr * 0.45, Math.max(20, f(i)))) / sr
      const alpha = Math.sin(w) / (2 * q)
      const a0 = 1 + alpha
      b0 = alpha / a0
      b2 = -alpha / a0
      a1 = (-2 * Math.cos(w)) / a0
      a2 = (1 - alpha) / a0
    }
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** One-pole low-pass. */
export function lowpass(x: Float32Array, sr: number, fc: number): Float32Array {
  const y = new Float32Array(x.length)
  const k = 1 - Math.exp((-2 * Math.PI * fc) / sr)
  let s = 0
  for (let i = 0; i < x.length; i++) {
    s += k * (x[i] - s)
    y[i] = s
  }
  return y
}

/** One-pole high-pass. */
export function highpass(x: Float32Array, sr: number, fc: number): Float32Array {
  const lp = lowpass(x, sr, fc)
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = x[i] - lp[i]
  return y
}

/** White noise in −1..1 from a generator. */
export function noise(n: number, r: () => number): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1
  return x
}

/** A decaying sine whose pitch falls from f0 towards f1 (a thump, a knock). */
export function tone(out: Float32Array, sr: number, f1: number, f0: number, fall: number, decay: number, amp: number, delay = 0): void {
  let ph = 0
  const d = Math.round(delay * sr)
  for (let i = d; i < out.length; i++) {
    const t = (i - d) / sr
    const f = f1 + (f0 - f1) * Math.exp(-t / fall)
    ph += (2 * Math.PI * f) / sr
    // A hair of attack, so no click at the very start.
    const att = Math.min(1, t / 0.0015)
    out[i] += amp * att * Math.exp(-t / decay) * Math.sin(ph)
  }
}

export function addScaled(out: Float32Array, x: Float32Array, env: (t: number) => number, sr: number, amp: number): void {
  for (let i = 0; i < out.length && i < x.length; i++) out[i] += amp * env(i / sr) * x[i]
}

/** A soft hump over 0..1 (0 outside it). */
export const bell = (u: number, p = 1.4): number => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** p)

/**
 * A struck bar or tine (a marimba's wood, a glass, a kalimba's tine): its
 * partials at `ratios` of f, each with its level and its decay (s), struck
 * at `delay` with a mallet as soft as `attack` (s: 0.001 hard … 0.008 felt).
 * The partials above about 9 kHz are left out (never a fizz on top).
 */
export function struck(out: Float32Array, sr: number, f: number, ratios: readonly number[], amps: readonly number[], decays: readonly number[], amp: number, delay = 0, attack = 0.003): void {
  const d = Math.round(delay * sr)
  for (let k = 0; k < ratios.length; k++) {
    const fk = f * ratios[k]
    if (fk > 9000 || fk < 20) continue
    const w = (2 * Math.PI * fk) / sr
    const a = amp * (amps[k] ?? 0)
    const tau = decays[k] ?? decays[decays.length - 1]
    // Each partial a little later than the one under it (a soft mallet
    // lingers on the bar): no click, a rounder start.
    const att = attack * (1 + 0.6 * k)
    for (let i = d; i < out.length; i++) {
      const t = (i - d) / sr
      const e = Math.exp(-t / tau)
      if (e < 1e-4) break
      out[i] += a * (1 - Math.exp(-t / att)) * e * Math.sin(w * (i - d))
    }
  }
}

/** A sound played higher (semis > 0) or lower: read faster or slower (its
 *  length changes with it, as a tape's would). */
export function pitched(x: Float32Array, semis: number): Float32Array {
  if (Math.abs(semis) < 1e-3) return x
  const p = Math.pow(2, semis / 12)
  const n = Math.max(1, Math.floor((x.length - 1) / p) + 1)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = i * p
    const k = Math.floor(f)
    const a = x[k] ?? 0
    const b = x[k + 1] ?? 0
    y[i] = a + (b - a) * (f - k)
  }
  return y
}
