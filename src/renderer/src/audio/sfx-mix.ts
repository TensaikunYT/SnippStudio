// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's sounds made into samples and mixed under the voice (apart
// from timeline-sfx.ts, so node can test it: timeline-sfx.ts needs the app's
// drawing). Pure: no DOM, no Web Audio (a mix is two Float32Arrays).
//
// - samplesOf / bakedOf: one event's samples (its kind, its variant, its
//   pitch, bullet time, distance, a long sound placed along its length).
// - mixEvents: the events into a mix, each guarded sound held under the voice
//   around it (the guard: at least 8 dB under the narration's loudest
//   twentieth of a second within 0.7 s, and under its loudness), a film's
//   own sounds the same as the library's.

import { pitched } from './sfx-dsp'
import { LEVEL, LONG, MASTER, lowpass, OPEN_FC, panGains, slowed, synthSfx, type SfxEvent, type SoundCurve } from './sfx-synth'

/** The loudest sample of a sound. */
export function peakOf(x: Float32Array): number {
  let p = 0
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i])
    if (v > p) p = v
  }
  return p
}

/** A sound's loudest twentieth of a second (RMS). */
export function rmsPeakOf(x: Float32Array, sr: number): number {
  const B = Math.max(1, Math.round(sr * 0.05))
  let best = 0
  for (let k = 0; k * B < x.length; k++) {
    let q = 0
    const end = Math.min(x.length, (k + 1) * B)
    for (let i = k * B; i < end; i++) q += x[i] * x[i]
    best = Math.max(best, Math.sqrt(q / Math.max(1, end - k * B)))
  }
  return best
}

/**
 * The narration as it is in the mix before the effects go in: how loud an
 * effect may be at a moment — 8 dB under the loudest of the voice around it
 * (half a second either side), and while it is quiet, well under the voice's
 * usual peak — so an explosion is felt and the words still carry.
 */
export type VoiceGuard = { allowed: (a: number, b: number) => { peak: number; rms: number }; usualRms: number }

export function voiceGuard(L: Float32Array, R: Float32Array | null, sr: number): VoiceGuard | null {
  const v = new VoiceBlocks(sr)
  v.push(L, R)
  return v.guard()
}

/**
 * The voice by twentieths of a second, read piece by piece (the export mixes
 * its sound in windows: phase Ç3b, decision 1): its peak and its loudness
 * (RMS) — a long low boom can match a word's peak and still sound as loud as
 * the word, so both are held under the voice. Every piece but the last is a
 * whole number of twentieths long; the blocks are the same as one long read.
 */
export class VoiceBlocks {
  private readonly B: number
  private pk: number[] = []
  private rm: number[] = []
  constructor(sr: number) {
    this.B = Math.max(1, Math.round(sr * 0.05))
  }
  push(L: Float32Array, R: Float32Array | null): void {
    const B = this.B
    const n = Math.ceil(L.length / B)
    for (let k = 0; k < n; k++) {
      let p = 0
      let q = 0
      let c = 0
      const end = Math.min(L.length, (k + 1) * B)
      for (let i = k * B; i < end; i += 2) {
        const v = Math.max(Math.abs(L[i]), R ? Math.abs(R[i]) : 0)
        if (v > p) p = v
        q += v * v
        c++
      }
      this.pk.push(p)
      this.rm.push(c ? Math.sqrt(q / c) : 0)
    }
  }
  guard(): VoiceGuard | null {
    return guardOf(Float32Array.from(this.pk), Float32Array.from(this.rm))
  }
}

/** A guard whose times are `shift` seconds later than the times asked
 *  (a mix that starts `shift` seconds into the voice the guard read). */
export function shiftedGuard(g: VoiceGuard, shift: number): VoiceGuard {
  return { usualRms: g.usualRms, allowed: (a, b) => g.allowed(a + shift, b + shift) }
}

function guardOf(pk: Float32Array, rm: Float32Array): VoiceGuard | null {
  const n = pk.length
  const usualOf = (a: Float32Array): number => {
    const sorted = Array.from(a).filter((v) => v > 1e-4).sort((x, y) => x - y)
    return sorted.length < 10 ? 0 : sorted[Math.floor(sorted.length * 0.95)]
  }
  const usualPk = usualOf(pk)
  const usualRm = usualOf(rm)
  if (!usualPk) return null
  const down = Math.pow(10, -8 / 20)
  return {
    usualRms: usualRm,
    allowed(a: number, b: number): { peak: number; rms: number } {
      // The voice around it (a little before and after), and in a pause a
      // floor well under its usual level, so a sound in a breath between
      // words still sits under the next word.
      const k0 = Math.max(0, Math.floor((a - 0.7) * 20))
      const k1 = Math.min(n - 1, Math.ceil((b + 0.7) * 20))
      let lp = 0
      let lr = 0
      for (let k = k0; k <= k1; k++) {
        if (pk[k] > lp) lp = pk[k]
        if (rm[k] > lr) lr = rm[k]
      }
      return { peak: Math.max(lp, usualPk * 0.3) * down, rms: Math.max(lr, usualRm * 0.3) * down }
    }
  }
}

const synthCache = new Map<string, Float32Array>()
/** A cutoff as one of a few steps (a third of an octave), so far sounds share their samples. */
const fcStep = (fc: number | undefined): number | null => (fc === undefined || fc >= OPEN_FC - 1 ? null : Math.round(Math.log2(Math.max(200, fc) / 1000) * 3))
/** The variant an event plays (the variety pass's, else from its seed). */
const variantOf = (e: SfxEvent, long: boolean): number => (e.variant !== undefined ? e.variant : long ? e.seed % 3 : e.seed % 5)
/** Its pitch in quarter semitones (so close pitches share their samples). */
const pitchOf = (e: SfxEvent): number => (e.pitch ? Math.round(e.pitch * 4) / 4 : 0)

/** The raw samples of an event's sound. */
function rawOf(e: SfxEvent, sr: number, shape?: ArrayLike<number>): Float32Array | null {
  const long = LONG.has(e.kind)
  return synthSfx(e.kind, sr, variantOf(e, long), e.dur ?? 0, shape)
}

/** The samples of one event (a few variations per kind are kept). Null: a
 *  film's own sound not made yet (the preview skips it; the export waits
 *  for every one first). */
export function samplesOf(e: SfxEvent, sr: number): Float32Array | null {
  const long = LONG.has(e.kind)
  const slow = e.slow !== undefined && e.slow < 0.92 ? Math.round(Math.max(0, e.slow) * 10) / 10 : null
  const far = fcStep(e.fc)
  const p = pitchOf(e)
  const key = `${e.kind}:${sr}:${long ? Math.round((e.dur ?? 0) * 20) + ':' : ''}${variantOf(e, long)}${p ? ':p' + p : ''}${slow !== null ? ':s' + slow : ''}${far !== null ? ':f' + far : ''}`
  let s = synthCache.get(key)
  if (!s) {
    const raw = rawOf(e, sr)
    if (!raw) return null
    s = p ? pitched(raw, p) : raw
    if (slow !== null) s = slowed(s, sr, slow)
    // Heard from afar: darker (two one-pole low-passes at the step's cutoff).
    if (far !== null) s = lowpass(lowpass(s, sr, 1000 * Math.pow(2, far / 3)), sr, 1000 * Math.pow(2, far / 3))
    if (synthCache.size > 240) synthCache.clear()
    synthCache.set(key, s)
  }
  return s
}

const bakedCache = new Map<string, [Float32Array, Float32Array]>()
/** A sound placed along its length (a curve) or shaped by the camera's
 *  speed, made once in stereo: its pan, gain and darkness drawn from the
 *  curve sample by sample (the preview plays it as it is, the export mixes
 *  it: both hear the same). Null: a plain sound (samplesOf), or a film's own
 *  sound not made yet. */
export function bakedOf(e: SfxEvent, sr: number): [Float32Array, Float32Array] | null {
  if (!e.curve && !e.shape) return null
  const cv: SoundCurve | undefined = e.curve
  const key = `${e.kind}:${e.name ?? ''}:${sr}:${e.seed}:${e.variant ?? ''}:${e.pitch ?? ''}:${e.t.toFixed(4)}:${e.dur ?? 0}:${e.slow ?? ''}:${cv ? cv.dt + ':' + cv.pan.length + ':' + cv.pan[0] + ':' + cv.g[cv.g.length - 1] : ''}:${e.shape?.length ?? 0}`
  const hit = bakedCache.get(key)
  if (hit) return hit
  let x = rawOf(e, sr, e.shape)
  if (!x) return null
  const p = pitchOf(e)
  if (p) x = pitched(x, p)
  const slow = e.slow !== undefined && e.slow < 0.92 ? Math.round(Math.max(0, e.slow) * 10) / 10 : null
  if (slow !== null) x = slowed(x, sr, slow)
  const L = new Float32Array(x.length)
  const R = new Float32Array(x.length)
  if (!cv) {
    const [gl, gr] = panGains(e.pan)
    for (let i = 0; i < x.length; i++) {
      L[i] = x[i] * gl
      R[i] = x[i] * gr
    }
  } else {
    // Its curve read every 64 samples and drawn straight between; the
    // darkness a two-pole low-pass whose cutoff moves with it.
    const at = (arr: number[], t: number): number => {
      const f = Math.max(0, Math.min(arr.length - 1, t / cv.dt))
      const k = Math.floor(f)
      const k2 = Math.min(arr.length - 1, k + 1)
      return arr[k] + (arr[k2] - arr[k]) * (f - k)
    }
    let y1 = 0
    let y2 = 0
    const B = 64
    for (let j = 0; j < x.length; j += B) {
      const t = (j + B / 2) / sr
      const fc = at(cv.fc, t)
      const k = fc >= OPEN_FC - 1 ? 1 : 1 - Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr)
      const g0 = at(cv.g, j / sr)
      const g1 = at(cv.g, Math.min(x.length, j + B) / sr)
      const p0 = at(cv.pan, j / sr)
      const p1 = at(cv.pan, Math.min(x.length, j + B) / sr)
      const e2 = Math.min(x.length, j + B)
      for (let i = j; i < e2; i++) {
        const u = (i - j) / B
        y1 += k * (x[i] - y1)
        y2 += k * (y1 - y2)
        const v = y2 * (g0 + (g1 - g0) * u)
        const [gl, gr] = panGains(p0 + (p1 - p0) * u)
        L[i] = v * gl
        R[i] = v * gr
      }
    }
  }
  const out: [Float32Array, Float32Array] = [L, R]
  if (bakedCache.size > 64) bakedCache.clear()
  bakedCache.set(key, out)
  return out
}

/** How loud an event plays before the guard: its gain × its kind's level ×
 *  the master. */
export const gainOf = (e: SfxEvent): number => e.gain * (LEVEL[e.kind] ?? 0) * MASTER

/**
 * The events into a mix (L, R; R null for mono): `offset` is the time of the
 * mix's first sample. Guarded sounds (`guard`) are held under the voice that
 * is in the mix already (`voice`: from voiceGuard, before the effects go in).
 */
export function mixEvents(events: SfxEvent[], L: Float32Array, R: Float32Array | null, sr: number, offset: number, voice: ReturnType<typeof voiceGuard>): void {
  // The guarded sounds go to a bus of their own first, held under the voice
  // moment by moment at the end (holdUnderVoice): each sound alone was held
  // under the voice round it, but sounds that land together still added up,
  // and a long one (an engine's roar over a whole scene) was held under the
  // loudest word anywhere in its length, so it stood near the voice in the
  // pauses between words (2026-10-12, the speed-of-light film: 1.5 dB under
  // the voice in a pause).
  const busL = voice ? new Float32Array(L.length) : null
  const busR = voice && R ? new Float32Array(R.length) : null
  for (const e of events) {
    const outL = e.guard && busL ? busL : L
    const outR = e.guard && busL ? busR : R
    const x = samplesOf(e, sr)
    if (!x) continue
    const baked = bakedOf(e, sr)
    const len = baked ? baked[0].length : x.length
    const start = Math.round((e.t - offset) * sr)
    if (start + len <= 0 || start >= L.length) continue
    let g = gainOf(e)
    if (e.guard && voice) {
      // Sounds that land together add up: each gets its share.
      let k = 0
      for (const o of events) if (o.guard && Math.abs(o.t - e.t) < 0.3) k++
      const share = 1 / Math.sqrt(Math.max(1, k))
      const lim = voice.allowed(e.t - offset, e.t - offset + len / sr)
      g = Math.min(g, (lim.peak * share) / Math.max(1e-6, peakOf(x)), (lim.rms * share) / Math.max(1e-6, rmsPeakOf(x, sr)))
    }
    // Its distance, after the guard: a far sound stays quieter than a near one.
    g *= e.near ?? 1
    if (baked) {
      const [bl, br] = baked
      for (let i = Math.max(0, -start); i < len && start + i < L.length; i++) {
        if (outR) {
          outL[start + i] += bl[i] * g
          outR[start + i] += br[i] * g
        } else outL[start + i] += (bl[i] + br[i]) * 0.5 * g
      }
      continue
    }
    const xs = x
    // A sound that keeps its place: its two gains once, not per sample.
    const still = e.panTo === undefined ? panGains(e.pan) : null
    for (let i = Math.max(0, -start); i < xs.length && start + i < L.length; i++) {
      const u = i / xs.length
      const [gl, gr] = still ?? panGains(e.pan + (e.panTo! - e.pan) * u)
      const v = xs[i] * g
      if (outR) {
        outL[start + i] += v * gl
        outR[start + i] += v * gr
      } else outL[start + i] += v * 0.7
    }
  }
  if (busL && voice) {
    holdUnderVoice(busL, busR, sr, voice)
    for (let i = 0; i < L.length; i++) L[i] += busL[i]
    if (R && busR) for (let i = 0; i < R.length; i++) R[i] += busR[i]
  }
}

/**
 * The guarded sounds together, held under the voice moment by moment: by
 * twentieths of a second, the bus's peak and loudness against what the voice
 * round that moment allows (voiceGuard), the gain the most any moment within
 * a twentieth either side needs, eased (down in 10 ms, back up over 0.3 s) so
 * nothing pumps or clicks. In place.
 */
export function holdUnderVoice(L: Float32Array, R: Float32Array | null, sr: number, voice: NonNullable<ReturnType<typeof voiceGuard>>): void {
  const B = Math.max(1, Math.round(sr * 0.05))
  const n = Math.ceil(L.length / B)
  const need = new Float32Array(n).fill(1)
  for (let k = 0; k < n; k++) {
    let p = 0
    let q = 0
    let c = 0
    const end = Math.min(L.length, (k + 1) * B)
    for (let i = k * B; i < end; i++) {
      const v = Math.max(Math.abs(L[i]), R ? Math.abs(R[i]) : 0)
      if (v > p) p = v
      q += v * v
      c++
    }
    if (p < 1e-5) continue
    const r = Math.sqrt(q / Math.max(1, c))
    const lim = voice.allowed(k / 20, (k + 1) / 20)
    need[k] = Math.min(1, lim.peak / p, lim.rms / Math.max(1e-6, r))
  }
  // Ahead and behind by a block: the ease never lets a block through too loud.
  const want = new Float32Array(n)
  for (let k = 0; k < n; k++) want[k] = Math.min(need[k], k > 0 ? need[k - 1] : 1, k + 1 < n ? need[k + 1] : 1)
  const down = 1 - Math.exp(-1 / (0.01 * sr))
  const up = 1 - Math.exp(-1 / (0.3 * sr))
  let g = want[0] ?? 1
  for (let i = 0; i < L.length; i++) {
    const w = want[Math.min(n - 1, Math.floor(i / B))]
    g += (w - g) * (w < g ? down : up)
    L[i] *= g
    if (R) R[i] *= g
  }
}
