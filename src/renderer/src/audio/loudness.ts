// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * Integrated loudness measurement following ITU-R BS.1770-4 / EBU R128 — the
 * same metric YouTube, Spotify and broadcast use. Normalising to a target (
 * -14 LUFS for YouTube) is what stops one video being twice as loud as the next.
 *
 * The chain is: K-weighting (a high-shelf + a high-pass), mean square over
 * 400 ms blocks with 75 % overlap, then the two-stage gate (absolute -70 LUFS,
 * then relative -10 LU) before averaging what survives.
 */

/** Loudness target presets, in LUFS. */
export const LOUDNESS_TARGETS = [
  { id: 'youtube', label: 'YouTube / Spotify', lufs: -14 },
  { id: 'tiktok', label: 'TikTok / Reels', lufs: -14 },
  { id: 'podcast', label: 'Podcast', lufs: -16 },
  { id: 'broadcast', label: 'Broadcast (EBU R128)', lufs: -23 }
] as const

/** Direct-form biquad, applied in place. */
function biquad(
  x: Float32Array,
  b0: number,
  b1: number,
  b2: number,
  a1: number,
  a2: number
): void {
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    x[i] = y0
  }
}

/**
 * BS.1770 K-weighting. The published coefficients are specified at 48 kHz; they
 * are re-derived here for the actual rate so a 44.1 kHz or 16 kHz buffer isn't
 * measured with the wrong curve.
 */
function kWeight(x: Float32Array, sampleRate: number): void {
  // Stage 1: high-shelf, +4 dB above ~1.5 kHz.
  {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const Vh = Math.pow(10, G / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)
    const den = 1 + K / Q + K * K
    biquad(
      x,
      (Vh + (Vb * K) / Q + K * K) / den,
      (2 * (K * K - Vh)) / den,
      (Vh - (Vb * K) / Q + K * K) / den,
      (2 * (K * K - 1)) / den,
      (1 - K / Q + K * K) / den
    )
  }
  // Stage 2: high-pass at ~38 Hz (removes rumble that would skew the measure).
  {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const den = 1 + K / Q + K * K
    biquad(x, 1, -2, 1, (2 * (K * K - 1)) / den, (1 - K / Q + K * K) / den)
  }
}

/**
 * Integrated loudness of mono samples, in LUFS. Returns -Infinity for silence.
 * The caller passes a copy — the K-weighting filters in place.
 */
export function integratedLufs(samples: Float32Array, sampleRate: number): number {
  if (samples.length === 0) return -Infinity
  const x = samples.slice()
  kWeight(x, sampleRate)

  const blockLen = Math.max(1, Math.round(0.4 * sampleRate)) // 400 ms
  const hop = Math.max(1, Math.round(0.1 * sampleRate)) // 75 % overlap
  if (x.length < blockLen) return -Infinity

  const powers: number[] = []
  for (let start = 0; start + blockLen <= x.length; start += hop) {
    let sum = 0
    for (let i = start; i < start + blockLen; i++) sum += x[i] * x[i]
    powers.push(sum / blockLen)
  }
  if (powers.length === 0) return -Infinity

  const loudnessOf = (p: number): number => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity)

  // Absolute gate at -70 LUFS.
  const absKept = powers.filter((p) => loudnessOf(p) > -70)
  if (absKept.length === 0) return -Infinity
  const absMean = absKept.reduce((a, b) => a + b, 0) / absKept.length

  // Relative gate: 10 LU below the absolute-gated level.
  const relThreshold = loudnessOf(absMean) - 10
  const relKept = absKept.filter((p) => loudnessOf(p) > relThreshold)
  const kept = relKept.length > 0 ? relKept : absKept
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length
  return loudnessOf(mean)
}

/**
 * Integrated loudness of a MULTI-CHANNEL programme, in LUFS. BS.1770 sums the
 * K-weighted mean square of every channel per block (L and R weigh 1.0), which
 * is why a stereo mix cannot simply be averaged down to mono first.
 */
export function integratedLufsMulti(channels: Float32Array[], sampleRate: number): number {
  if (channels.length === 0 || channels[0].length === 0) return -Infinity
  const weighted = channels.map((c) => {
    const x = c.slice()
    kWeight(x, sampleRate)
    return x
  })
  const len = weighted[0].length
  const blockLen = Math.max(1, Math.round(0.4 * sampleRate))
  const hop = Math.max(1, Math.round(0.1 * sampleRate))
  if (len < blockLen) return -Infinity

  const powers: number[] = []
  for (let start = 0; start + blockLen <= len; start += hop) {
    let total = 0
    for (const x of weighted) {
      let sum = 0
      for (let i = start; i < start + blockLen; i++) sum += x[i] * x[i]
      total += sum / blockLen
    }
    powers.push(total)
  }
  if (powers.length === 0) return -Infinity

  const loudnessOf = (p: number): number => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity)
  const absKept = powers.filter((p) => loudnessOf(p) > -70)
  if (absKept.length === 0) return -Infinity
  const absMean = absKept.reduce((a, b) => a + b, 0) / absKept.length
  const relThreshold = loudnessOf(absMean) - 10
  const relKept = absKept.filter((p) => loudnessOf(p) > relThreshold)
  const kept = relKept.length > 0 ? relKept : absKept
  return loudnessOf(kept.reduce((a, b) => a + b, 0) / kept.length)
}

/** The two K-weighting stages' coefficients at a rate ([b0, b1, b2, a1, a2]). */
function kStages(sampleRate: number): [number, number, number, number, number][] {
  const out: [number, number, number, number, number][] = []
  {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const Vh = Math.pow(10, G / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)
    const den = 1 + K / Q + K * K
    out.push([(Vh + (Vb * K) / Q + K * K) / den, (2 * (K * K - Vh)) / den, (Vh - (Vb * K) / Q + K * K) / den, (2 * (K * K - 1)) / den, (1 - K / Q + K * K) / den])
  }
  {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const den = 1 + K / Q + K * K
    out.push([1, -2, 1, (2 * (K * K - 1)) / den, (1 - K / Q + K * K) / den])
  }
  return out
}

/**
 * integratedLufsMulti read piece by piece (the export's sound comes in
 * windows: phase Ç3b, decision 1): the K-weighting filters keep their state
 * from one piece to the next, the 400 ms blocks (every 100 ms) are summed
 * from 100 ms parts, and the gate is the same. Also the loudest sample.
 */
export class LoudnessMeter {
  private readonly stages: [number, number, number, number, number][]
  /** Per channel, per stage: x1, x2, y1, y2. */
  private readonly state: Float64Array[][]
  private readonly hop: number
  /** Energy of the current 100 ms part, per channel; samples in it. */
  private part: Float64Array
  private inPart = 0
  /** The finished parts' energies (per channel summed over a part). */
  private parts: Float64Array[] = []
  private powers: number[] = []
  peak = 0

  constructor(sampleRate: number, private readonly channels: number) {
    this.stages = kStages(sampleRate)
    this.state = Array.from({ length: channels }, () => this.stages.map(() => new Float64Array(4)))
    this.hop = Math.max(1, Math.round(0.1 * sampleRate))
    this.part = new Float64Array(channels)
  }

  push(chans: Float32Array[]): void {
    const n = chans[0]?.length ?? 0
    const w = new Float32Array(n)
    const energy: Float32Array[] = []
    for (let c = 0; c < this.channels; c++) {
      const src = chans[Math.min(c, chans.length - 1)]
      w.set(src.subarray(0, n))
      for (let i = 0; i < n; i++) {
        const v = Math.abs(src[i])
        if (v > this.peak) this.peak = v
      }
      for (let s = 0; s < this.stages.length; s++) {
        const [b0, b1, b2, a1, a2] = this.stages[s]
        const st = this.state[c][s]
        let x1 = st[0], x2 = st[1], y1 = st[2], y2 = st[3]
        for (let i = 0; i < n; i++) {
          const x0 = w[i]
          const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
          x2 = x1
          x1 = x0
          y2 = y1
          y1 = y0
          w[i] = y0
        }
        st[0] = x1
        st[1] = x2
        st[2] = y1
        st[3] = y2
      }
      energy.push(Float32Array.from(w))
    }
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channels; c++) this.part[c] += energy[c][i] * energy[c][i]
      if (++this.inPart === this.hop) {
        this.parts.push(this.part)
        this.part = new Float64Array(this.channels)
        this.inPart = 0
        if (this.parts.length >= 4) {
          const last = this.parts.slice(-4)
          let total = 0
          for (let c = 0; c < this.channels; c++) total += (last[0][c] + last[1][c] + last[2][c] + last[3][c]) / (4 * this.hop)
          this.powers.push(total)
          this.parts.shift()
        }
      }
    }
  }

  /** The integrated loudness so far (LUFS; -Infinity for silence). */
  integrated(): number {
    const loudnessOf = (p: number): number => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity)
    const absKept = this.powers.filter((p) => loudnessOf(p) > -70)
    if (absKept.length === 0) return -Infinity
    const absMean = absKept.reduce((a, b) => a + b, 0) / absKept.length
    const relThreshold = loudnessOf(absMean) - 10
    const relKept = absKept.filter((p) => loudnessOf(p) > relThreshold)
    const kept = relKept.length > 0 ? relKept : absKept
    return loudnessOf(kept.reduce((a, b) => a + b, 0) / kept.length)
  }
}

/** True peak-ish sample peak (dBFS) — used to warn about clipping. */
export function samplePeakDb(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

/** Linear gain that moves `currentLufs` onto `targetLufs`. */
export function gainForTarget(currentLufs: number, targetLufs: number): number {
  if (!isFinite(currentLufs)) return 1
  return Math.pow(10, (targetLufs - currentLufs) / 20)
}
