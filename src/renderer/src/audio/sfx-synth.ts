// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's sounds themselves (transitions, templates, build-ups), made
// from nothing: every one synthesised from sine waves and filtered noise (no
// sample files, nothing downloaded), and how loud each kind sits. Pure and
// free of the DOM, so node can test them (timeline-sfx.ts mixes and plays them).

/** The basic sounds: taps, knocks, swishes, clicks, booms. */
export type BasicSfx = 'knock' | 'tick' | 'swish' | 'whoosh' | 'drop' | 'slide' | 'crack' | 'thock'
import { addScaled, bandpass, bell, lowpass, noise, rng, tone } from './sfx-dsp'

/** A long sound's placing along it: samples every `dt` s from its start. */
export interface SoundCurve {
  dt: number
  pan: number[]
  g: number[]
  fc: number[]
}

/** A low-pass that lets everything through. */
export const OPEN_FC = 20000

/** One sound on the timeline: when, what, where (−1 left … 1 right), how
 *  loud, and — for a sound that sweeps across (a hand past the lens) — where
 *  it ends up. */
export interface SfxEvent {
  t: number
  kind: BasicSfx | 'air' | 'airlight' | 'riser'
  pan: number
  panTo?: number
  gain: number
  dur?: number
  seed: number
  /** Kept under the voice when mixed: never louder
   *  than the narration around it, less 8 dB. */
  guard?: boolean
  /** Heard in bullet time: how fast the things' time ran (0..1): pitched
   *  down and darkened. */
  slow?: number
  /** A piece of a long bed (rain, a fire, a wake): faded in and out over
   *  its first and last second, overlapping the next; the preview starts it
   *  part way when the playhead jumps into it. */
  bed?: boolean
  /** Heard from afar (round 9): darkened by a low-pass at this cutoff (Hz),
   *  and quieter by `near` (applied after the voice's guard, so a far sound
   *  stays quieter than a near one under any voice). */
  fc?: number
  near?: number
  /** A long placed sound (round 9): its pan, gain and cutoff along it,
   *  sampled every `dt` s from its start (an orbit carries it round). */
  curve?: SoundCurve
  /** A ramp's rush or a flight's whoosh: the camera's speed (0..1 every 1/20 s). */
  shape?: number[]
  /** The variety pass (sfx-variety.ts, the craft run's round 6): which of
   *  its five variants plays, and how many semitones higher (or lower), so
   *  the same sound never plays twice alike in a row. */
  variant?: number
  pitch?: number
  /** A film's own sound (kind 'local', its sounds.js): its name. */
  name?: string
}

/** The beds: pieces faded in and out with equal power over half a second
 *  at each end (they overlap the next piece by that), and levelled by
 *  their loudness (not their peak), so every piece of a bed sits alike. */
export const BED = new Set<string>([])
// (The bed sounds themselves, rain, wind, a fire…, were recipes nothing in the
// product asks for: they went in SnippStudio phase 2B, with the other dead
// ones. The mix still honours a bed piece if one is ever made again.)

/** Sounds whose length follows their event's `dur`. */
export const LONG = new Set<string>(['slide', 'air', 'airlight', 'riser'])

// -- dsp (sfx-dsp.ts) ----------------------------------------------------------

export { lowpass }

/** The sound itself, mono, at unit loudness. A speed ramp's rush and a
 *  flight's whoosh can be given the camera's speed (`shape`, 0..1 every
 *  1/20 s): their level, pitch and punch follow it (round 9). */
export function synthSfx(kind: SfxEvent['kind'], sr: number, seed: number, dur = 0, shape?: ArrayLike<number>): Float32Array {
  const r = rng(seed * 7919 + 17)
  const vary = 1 + (r() - 0.5) * 0.1
  const len = (s: number): Float32Array => new Float32Array(Math.max(1, Math.round(s * sr)))
  let out: Float32Array
  switch (kind) {
    case 'knock': {
      // A fingertip on a wooden table: a round body and a dry top.
      out = len(0.16)
      tone(out, sr, 180 * vary, 240 * vary, 0.01, 0.032, 0.9)
      tone(out, sr, 470 * vary, 500 * vary, 0.01, 0.016, 0.42)
      tone(out, sr, 1080 * vary, 1100 * vary, 0.01, 0.007, 0.16)
      addScaled(out, lowpass(noise(out.length, r), sr, 1800), (t) => Math.exp(-t / 0.004), sr, 0.5)
      break
    }
    case 'tick': {
      // One more finger up: a soft wooden tock, quieter than a tap.
      out = len(0.08)
      tone(out, sr, 760 * vary, 900 * vary, 0.006, 0.011, 0.5)
      tone(out, sr, 190 * vary, 260 * vary, 0.008, 0.018, 0.55)
      break
    }
    case 'crack': {
      // A knuckle cracking: a few dry little pops close together, the first
      // the loudest, with a hollow knock under them.
      out = len(0.14)
      const n = 2 + Math.floor(r() * 2)
      let at = 0
      for (let k = 0; k < n; k++) {
        const d0 = Math.round(at * sr)
        const burst = bandpass(noise(out.length, r), sr, () => (1500 + r() * 900) * vary, 2.2)
        const amp = 2.4 * (1 - 0.3 * k)
        for (let i = d0; i < out.length; i++) out[i] += amp * Math.exp(-(i - d0) / sr / 0.0026) * burst[i - d0]
        at += 0.012 + r() * 0.02
      }
      tone(out, sr, 260 * vary, 420 * vary, 0.006, 0.012, 0.35)
      break
    }
    case 'thock': {
      // A solid, deep click — a big word landing: a low round knock with a
      // short dry top, nothing ringing.
      out = len(0.12)
      tone(out, sr, 120 * vary, 210 * vary, 0.008, 0.026, 1)
      tone(out, sr, 640 * vary, 760 * vary, 0.004, 0.006, 0.3)
      addScaled(out, lowpass(noise(out.length, r), sr, 2600), (t) => Math.exp(-t / 0.0018), sr, 0.4)
      break
    }
    case 'drop': {
      // Setting it down: deeper and longer than the grab.
      out = len(0.24)
      tone(out, sr, 52 * vary, 95 * vary, 0.05, 0.08, 1)
      addScaled(out, lowpass(noise(out.length, r), sr, 700), (t) => Math.exp(-t / 0.02), sr, 0.3)
      break
    }
    case 'air':
    case 'airlight': {
      // A dissolve's breath: low air swelling and settling over the whole
      // transition — felt more than heard. The light one (a light sweep, a
      // leak) has a soft, warm top.
      const D = Math.min(4, Math.max(0.25, dur))
      out = len(D)
      const lo = lowpass(lowpass(noise(out.length, r), sr, 380), sr, 380)
      addScaled(out, lo, (t) => bell(t / D, 1.4), sr, 4)
      if (kind === 'airlight') {
        const hi = lowpass(bandpass(noise(out.length, r), sr, (i) => 900 + 500 * Math.sin((Math.PI * i) / out.length), 0.6), sr, 2400)
        addScaled(out, hi, (t) => bell(t / D, 1.8), sr, 0.9)
      }
      break
    }
    case 'swish': {
      // A quick swipe of air.
      const D = 0.3
      out = len(D)
      const n = bandpass(noise(out.length, r), sr, (i) => 340 * Math.pow(3, i / out.length), 1.1)
      const lo = lowpass(lowpass(noise(out.length, r), sr, 260), sr, 260)
      addScaled(out, n, (t) => bell(t / D, 1.2), sr, 1.4)
      addScaled(out, lo, (t) => bell(t / D, 1.5), sr, 3)
      break
    }
    case 'whoosh': {
      // Something big moving past, close: a deep swell of air and a rumble.
      const D = 0.45
      out = len(D)
      const n = noise(out.length, r)
      const hi = bandpass(n, sr, (i) => {
        const u = i / out.length
        return 150 * Math.pow(4, Math.sin(Math.PI * Math.min(1, u * 1.1)))
      }, 0.8)
      const lo = lowpass(lowpass(noise(out.length, r), sr, 140), sr, 140)
      addScaled(out, hi, (t) => bell(t / D, 1.6), sr, 1.3)
      addScaled(out, lo, (t) => bell(t / D, 2), sr, 5)
      break
    }
    case 'riser': {
      // A build-up into a big moment: filtered air rising in pitch and
      // swelling, a soft tone climbing under it — and it stops dead on the
      // moment (no tail into the voice).
      const D = Math.min(4, Math.max(0.4, dur))
      out = len(D)
      const nz = bandpass(noise(out.length, r), sr, (i) => 350 * Math.pow(10, i / out.length), 1.2)
      let ph = 0
      for (let i = 0; i < out.length; i++) {
        const u = i / out.length
        const env = Math.pow(u, 2.2) * Math.min(1, (1 - u) / 0.03)
        ph += (2 * Math.PI * 90 * Math.pow(2, 2 * u)) / sr
        out[i] += env * (nz[i] * 1.3 + 0.32 * Math.sin(ph))
      }
      break
    }
    case 'slide': {
      // A finger dragged on glass, for as long as it goes.
      const D = Math.min(12, Math.max(0.2, dur))
      out = len(D)
      const n = bandpass(noise(out.length, r), sr, () => 650, 1)
      addScaled(out, n, (t) => Math.min(1, t / 0.04, (D - t) / 0.08) * 0.8, sr, 0.45)
      break
    }
  }
  return levelled(out)
}


/** Level: each kind to the same peak; its event gain does the rest. */
function levelled(out: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  const norm = peak > 0 ? 0.8 / peak : 0
  for (let i = 0; i < out.length; i++) out[i] *= norm
  return out
}

/** How loud each kind sits against the others (the gain an event carries
 *  multiplies this). Under a voice, not over it: they are there to be felt. */
export const MASTER = 1.35
/** How loud a kind is mixed (its level × the master) before its gain. */
export const levelOf = (kind: SfxEvent['kind']): number => (LEVEL[kind] ?? 0) * MASTER
export const LEVEL: Record<SfxEvent['kind'], number> = {
  crack: 0.5,
  thock: 0.55,
  riser: 0.34,
  knock: 0.42,
  tick: 0.34,
  drop: 0.45,
  swish: 0.3,
  whoosh: 0.42,
  air: 0.3,
  airlight: 0.24,
  slide: 0.16
}

/** A sound heard in bullet time: played slower (lower, longer) and darker,
 *  the slower the things' time ran (rate 0..1). */
export function slowed(x: Float32Array, sr: number, rate: number): Float32Array {
  const p = 0.55 + 0.45 * Math.max(0, Math.min(1, rate))
  const n = Math.max(1, Math.round(x.length / p))
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = i * p
    const k = Math.floor(f)
    const a = x[k] ?? 0
    const b = x[k + 1] ?? 0
    y[i] = a + (b - a) * (f - k)
  }
  return lowpass(y, sr, 500 + 3500 * rate)
}

/** Equal-power pan gains, left and right. */
export function panGains(p: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4
  return [Math.cos(a), Math.sin(a)]
}

