// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cleaning a voice, here on the machine: the steady noise under it (a fan,
// hiss, room tone) taken out frame by frame in the spectrum, and the sharp
// esses softened — streaming, so an hour of narration needs no more memory
// than a few frames. Pure: samples in, samples out.

/** In-place radix-2 FFT of (re, im); `inv` for the inverse (unscaled). */
export function fft(re: Float64Array, im: Float64Array, inv = false): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

export interface CleanSettings {
  /** How much of the noise to take out, 0..1. */
  noise: number
  /** How much to soften the esses, 0..1. */
  ess: number
}

const N = 1024
const HOP = 256
const BINS = N / 2 + 1

/** sqrt-Hann, for analysis and synthesis both (their product sums flat). */
const WIN = (() => {
  const w = new Float64Array(N)
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  return w
})()
/** What overlapping windows add up to, divided out. */
const NORM = (() => {
  let s = 0
  for (let k = 0; k < N; k += HOP) s += WIN[k] * WIN[k]
  return s
})()

/** One frame's power spectrum (for the noise estimate). */
export function framePower(frame: Float32Array | Float64Array): Float64Array {
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < N; i++) re[i] = (frame[i] ?? 0) * WIN[i]
  fft(re, im)
  const p = new Float64Array(BINS)
  for (let k = 0; k < BINS; k++) p[k] = re[k] * re[k] + im[k] * im[k]
  return p
}

/**
 * The noise under a recording: from frames sampled through it, the quietest
 * ones (where no one speaks) averaged, bin by bin.
 */
export function noiseProfile(frames: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(BINS)
  if (!frames.length) return out
  const energy = frames.map((f, i) => [f.reduce((s, v) => s + v, 0), i] as const).sort((a, b) => a[0] - b[0])
  const take = Math.max(1, Math.floor(frames.length * 0.15))
  for (let j = 0; j < take; j++) {
    const f = frames[energy[j][1]]
    for (let k = 0; k < BINS; k++) out[k] += f[k] / take
  }
  return out
}

/**
 * The cleaner itself, streaming: push samples in, get the cleaned samples
 * out (the same count overall, in step with the input — `flush` gives the
 * last of them).
 */
export class VoiceCleaner {
  private readonly inBuf = new Float64Array(N)
  private readonly outBuf = new Float64Array(N)
  private fill = N - HOP
  private readonly gains = new Float64Array(BINS).fill(1)
  private essGain = 1
  private readonly re = new Float64Array(N)
  private readonly im = new Float64Array(N)
  private readonly essFrom: number
  private readonly essBand: [number, number]
  /** Samples still owed to the caller at the very start (the frame delay). */
  private skip = N - HOP
  private readonly over: number
  private readonly floor: number

  constructor(
    sr: number,
    private readonly noise: Float64Array,
    private readonly opts: CleanSettings
  ) {
    const bin = (hz: number): number => Math.min(BINS - 1, Math.round((hz / sr) * N))
    this.essFrom = bin(4000)
    this.essBand = [bin(4500), bin(12000)]
    this.over = 1 + 2.5 * Math.max(0, Math.min(1, opts.noise))
    this.floor = 10 ** (-(6 + 18 * Math.max(0, Math.min(1, opts.noise))) / 20)
  }

  /** Cleans one frame (inBuf) and adds it into outBuf. */
  private frame(): void {
    const { re, im, gains } = this
    for (let i = 0; i < N; i++) {
      re[i] = this.inBuf[i] * WIN[i]
      im[i] = 0
    }
    fft(re, im)
    // The noise taken out: a gain per bin, over-subtracted, never below the
    // floor, opening at once and closing slowly (no warbling).
    if (this.opts.noise > 0) {
      for (let k = 0; k < BINS; k++) {
        const p = re[k] * re[k] + im[k] * im[k] + 1e-20
        const g = Math.max(this.floor, 1 - (this.over * this.noise[k]) / p)
        gains[k] = g > gains[k] ? g : gains[k] * 0.75 + g * 0.25
      }
    } else gains.fill(1)
    // The esses: when the band from 4.5 to 12 kHz carries much of the energy,
    // turn everything above 4 kHz down by as much — quick down, slower back.
    if (this.opts.ess > 0) {
      let band = 0
      let all = 0
      for (let k = 1; k < BINS; k++) {
        const p = re[k] * re[k] + im[k] * im[k]
        all += p
        if (k >= this.essBand[0] && k <= this.essBand[1]) band += p
      }
      const ratio = all > 1e-12 ? band / all : 0
      const loud = all / N > 1e-6
      // More softening means a lower bar for what counts as an ess.
      const th = 0.45 - 0.3 * this.opts.ess
      const want = loud && ratio > th ? Math.max(0.25, Math.pow(th / ratio, 1.6)) : 1
      this.essGain = want < this.essGain ? want : this.essGain + (want - this.essGain) * 0.25
    } else this.essGain = 1
    for (let k = 0; k < BINS; k++) {
      // A gentle slope into the de-essed band.
      const ess = k >= this.essFrom ? this.essGain : 1
      const g = (k > 0 && k < BINS - 1 ? (gains[k - 1] + 2 * gains[k] + gains[k + 1]) / 4 : gains[k]) * ess
      re[k] *= g
      im[k] *= g
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k]
        im[N - k] = -im[k]
      }
    }
    fft(re, im, true)
    for (let i = 0; i < N; i++) this.outBuf[i] += ((re[i] / N) * WIN[i]) / NORM
  }

  /** Cleans `input`; returns as many cleaned samples as are ready. */
  push(input: Float32Array): Float32Array {
    const out = new Float32Array(input.length + HOP)
    let n = 0
    let pos = 0
    while (pos < input.length) {
      const take = Math.min(N - this.fill, input.length - pos)
      for (let i = 0; i < take; i++) this.inBuf[this.fill + i] = input[pos + i]
      this.fill += take
      pos += take
      if (this.fill < N) break
      this.frame()
      // The first HOP samples of the output are complete.
      for (let i = 0; i < HOP; i++) {
        if (this.skip > 0) this.skip--
        else out[n++] = this.outBuf[i]
      }
      this.outBuf.copyWithin(0, HOP)
      this.outBuf.fill(0, N - HOP)
      this.inBuf.copyWithin(0, HOP)
      this.fill = N - HOP
    }
    return out.slice(0, n)
  }

  /** The rest, once the input has ended. */
  flush(total: number, given: number): Float32Array {
    const owed = Math.max(0, total - given)
    const out = new Float32Array(owed)
    let n = 0
    const zeros = new Float32Array(HOP)
    while (n < owed) {
      const got = this.push(zeros)
      const take = Math.min(got.length, owed - n)
      out.set(got.subarray(0, take), n)
      n += take
    }
    return out
  }
}

export const CLEAN_FRAME = N

/** A 16-bit PCM WAV header (the sizes patched at the end if unknown). */
export function wavHeader(sr: number, channels: number, dataBytes: number): Uint8Array {
  const b = new ArrayBuffer(44)
  const v = new DataView(b)
  const s = (o: number, t: string): void => {
    for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i))
  }
  s(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  s(8, 'WAVE')
  s(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, sr, true)
  v.setUint32(28, sr * channels * 2, true)
  v.setUint16(32, channels * 2, true)
  v.setUint16(34, 16, true)
  s(36, 'data')
  v.setUint32(40, dataBytes, true)
  return new Uint8Array(b)
}

/** Samples as 16-bit PCM bytes. */
export function pcm16(x: Float32Array): Uint8Array {
  const out = new Uint8Array(x.length * 2)
  const v = new DataView(out.buffer)
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]))
    v.setInt16(i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true)
  }
  return out
}

/** Voice sounds, one click each: the EQ, filters and compression they set. */
export const VOICE_PRESETS: Record<string, { label: string; hint: string; fx: { eqLow: number; eqMid: number; eqHigh: number; highpass: number; lowpass: number; comp: { enabled: boolean; threshold: number; ratio: number } } }> = {
  clear: { label: 'Clear', hint: 'Rumble cut, a little presence and air, gently held together', fx: { eqLow: -2, eqMid: 1.5, eqHigh: 3, highpass: 85, lowpass: 0, comp: { enabled: true, threshold: -20, ratio: 3 } } },
  warm: { label: 'Warm radio', hint: 'Fuller lows, softer top, held firmly — close and intimate', fx: { eqLow: 3, eqMid: -1, eqHigh: 1.5, highpass: 70, lowpass: 0, comp: { enabled: true, threshold: -18, ratio: 4 } } },
  podcast: { label: 'Podcast', hint: 'Even and forward: the lows tidied, the words lifted, steady level', fx: { eqLow: -1, eqMid: 2.5, eqHigh: 2, highpass: 90, lowpass: 14000, comp: { enabled: true, threshold: -22, ratio: 3.5 } } }
}
