// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A windowed-sinc sample-rate converter (phase Ç3b, decision 3; report R11).
//
// The export mixes at 48 kHz. A 44.1 kHz recording (most music, many phone
// and screen recordings) used to reach the mix through Web Audio's own
// conversion, a straight line between two samples: on a 44.1 kHz sweep its
// images stood 6 dB under the tone (FAZC3B-PLAN.md). Every decoded piece of
// a recording that is not at 48 kHz is converted here instead, once, before
// it is scheduled: a Kaiser-windowed sinc, its coefficients worked out once
// per pair of rates (a polyphase table: the ratio is rational for every
// real rate), its stopband about 85 dB down.
//
// Pure: arrays in, arrays out. A piece is converted whole; the caller keeps
// a margin at each end (the filter reaches 48 input samples either way and
// treats what lies beyond the piece as silence).

/** Taps either side of the centre at the input rate (upsampling). */
const HALF = 48
/** The Kaiser window's beta: about 85 dB of stopband. */
const BETA = 8.6
/** At most this many phases are tabled exactly; beyond it (a ratio of odd
 *  rates) the nearest of this many is used. */
const MAX_PHASES = 4096

function bessel0(x: number): number {
  let sum = 1
  let term = 1
  const q = (x * x) / 4
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k)
    sum += term
    if (term < 1e-12 * sum) break
  }
  return sum
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

interface Table {
  /** Output samples per `down` input samples (the reduced ratio). */
  up: number
  down: number
  /** Phases tabled (up, or MAX_PHASES when up is larger). */
  phases: number
  /** Taps per phase. */
  taps: number
  /** Offset of the first tap from the integer input position. */
  first: number
  coef: Float32Array
}

const tables = new Map<string, Table>()

function tableFor(srIn: number, srOut: number, fine = false): Table {
  const key = `${srIn}>${srOut}${fine ? ':fine' : ''}`
  const hit = tables.get(key)
  if (hit) return hit
  const g = gcd(Math.round(srIn), Math.round(srOut))
  const up = Math.round(srOut) / g
  const down = Math.round(srIn) / g
  const ratio = srOut / srIn
  // The cutoff (cycles per input sample): the lower Nyquist, a little under
  // it when the rate goes down (what lies above the output's Nyquist must be
  // gone before it folds back).
  const fc = ratio >= 1 ? 0.5 : 0.5 * ratio * 0.97
  const half = Math.ceil(HALF / Math.min(1, ratio))
  const taps = 2 * half
  const first = -half + 1
  // (Fine: FINE_PHASES + 1 rows, the last one a whole sample on, for
  // reading between two rows at any position.)
  const phases = fine ? FINE_PHASES + 1 : Math.min(up, MAX_PHASES)
  const coef = new Float32Array(phases * taps)
  const i0 = bessel0(BETA)
  for (let p = 0; p < phases; p++) {
    // This phase's output lies `frac` of an input sample past its integer
    // position; tap j reads input sample position + first + j.
    const frac = fine ? p / FINE_PHASES : p / phases
    let sum = 0
    for (let j = 0; j < taps; j++) {
      const t = first + j - frac
      const x = 2 * fc * t
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const r = t / (half + 1)
      const w = Math.abs(r) >= 1 ? 0 : bessel0(BETA * Math.sqrt(1 - r * r)) / i0
      const v = 2 * fc * sinc * w
      coef[p * taps + j] = v
      sum += v
    }
    // Each phase passes a constant exactly (no ripple at DC between phases).
    for (let j = 0; j < taps; j++) coef[p * taps + j] /= sum
  }
  const t: Table = { up, down, phases, taps, first, coef }
  if (tables.size > 16) tables.clear()
  tables.set(key, t)
  return t
}

/** Phases of the table for positions that are not on the ratio's grid
 *  (resampleAt), read straight between two neighbours. */
const FINE_PHASES = 1024

/**
 * `n` samples at `srOut` read from `x` (at `srIn`) at the input positions
 * p0, p0 + srIn / srOut, … — any start, a fraction of a sample included (the
 * export puts a recording's samples straight onto its own 48 kHz grid:
 * export/audio.ts). The same filter as resample(); at the same rate it is a
 * plain copy when p0 is whole.
 */
export function resampleAt(x: Float32Array, srIn: number, srOut: number, p0: number, n: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(0, n))
  const len = x.length
  if (srIn === srOut && Number.isInteger(p0)) {
    for (let j = 0; j < n; j++) {
      const i = p0 + j
      out[j] = i >= 0 && i < len ? x[i] : 0
    }
    return out
  }
  const T = tableFor(srIn, srOut, true)
  const { taps, first, coef } = T
  const step = srIn / srOut
  for (let j = 0; j < n; j++) {
    const at = p0 + j * step
    const pos = Math.floor(at)
    const f = (at - pos) * FINE_PHASES
    const p = Math.min(FINE_PHASES - 1, Math.floor(f))
    const w = f - p
    const r0 = p * taps
    const r1 = r0 + taps
    const start = pos + first
    let acc = 0
    for (let k = 0; k < taps; k++) {
      const i = start + k
      if (i >= 0 && i < len) acc += x[i] * (coef[r0 + k] + (coef[r1 + k] - coef[r0 + k]) * w)
    }
    out[j] = acc
  }
  return out
}

/** The number of output samples `n` input samples make. */
export function resampledLength(n: number, srIn: number, srOut: number): number {
  return Math.max(0, Math.round((n * srOut) / srIn))
}

/**
 * One channel from `srIn` to `srOut`: output sample j lies at input
 * position j · srIn / srOut (the first samples line up). Outside the input
 * counts as silence.
 */
export function resample(x: Float32Array, srIn: number, srOut: number): Float32Array<ArrayBuffer> {
  const n = resampledLength(x.length, srIn, srOut)
  const out = new Float32Array(n)
  if (srIn === srOut) {
    out.set(x.subarray(0, n))
    return out
  }
  const T = tableFor(srIn, srOut)
  const { up, down, phases, taps, first, coef } = T
  const exact = phases === up
  const len = x.length
  for (let j = 0; j < n; j++) {
    // Position j · down / up, as an integer part and a phase (exact for a
    // tabled ratio: integer arithmetic, no drift over an hour).
    const num = j * down
    const pos = Math.floor(num / up)
    const p = exact ? num - pos * up : Math.min(phases - 1, Math.round(((num - pos * up) / up) * phases))
    const row = p * taps
    const start = pos + first
    let acc = 0
    if (start >= 0 && start + taps <= len) {
      for (let k = 0; k < taps; k++) acc += x[start + k] * coef[row + k]
    } else {
      for (let k = 0; k < taps; k++) {
        const i = start + k
        if (i >= 0 && i < len) acc += x[i] * coef[row + k]
      }
    }
    out[j] = acc
  }
  return out
}
