// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's master limiter (phase Ç3b, decision 2; report R10): a
// look-ahead true-peak limiter at −1 dBTP, always on, after the loudness
// normalizing. A mix whose voice, music and sounds add up past full scale
// used to reach the encoder as it was and be cut off flat there (two tones
// at full scale: +0.3 dBTP, 103 406 samples at full scale; FAZC3B-PLAN.md).
//
// How it works, sample by sample (and across the pieces it is handed, so a
// whole film streams through one limiter):
// - the true peak of every sample: the sample and the points between it
//   and the next, read through an interpolating filter (ITU-R BS.1770
//   Annex 2's way of finding the peaks a converter will draw; below);
// - the gain each sample needs to stay under the ceiling;
// - the least of those over [i − T, i + A + T] (A = the look-ahead, T the
//   reading's reach), then its average over the last A: the gain is down by
//   the time a peak and every sample its reading reaches arrive, and moves
//   in a smooth ramp, never a step (each of the A values averaged is no more
//   than what the peak needs);
// - back up slowly (a release of 80 ms), never faster than that.
// The output is the input delayed by A + 2T samples, given back in step: the
// first call gives back that many samples fewer, `flush` the rest.
//
// The preview has no limiter (a known difference: FAZC3B-PLAN.md).

// Phase Ç3 patch (S-2; haritalar/_fazc3-denetim-ses.md): the 4× reader of
// 32 taps missed what a converter draws on broadband loud sound (noise-like
// music −0.74 dBTP, a 2.9 kHz square −0.71, a 22 kHz tone −0.21, read by a
// long reader). Now each sample is first read by that short 4× filter; where
// it comes within 2 dB of the ceiling, by an 8× filter of 128 taps. The need
// a peak sets holds over every sample the reading reached (T either side),
// so its neighbours are no louder than it allows; and the ceiling is held
// MARGIN_DB under the one asked for what a longer reader still finds.

/** Half the long interpolating filter's length (taps either side): how far
 *  a peak's reading reaches. */
const T = 64
/** The short first reading's half length. */
const T_SHORT = 16
/** Within this of the ceiling (as a gain) the short reading is read again
 *  by the long filter. */
const GATE = Math.pow(10, -2 / 20)
/** Held under the ceiling asked (dB). */
export const MARGIN_DB = 0.1

/** A Kaiser-windowed sinc interpolator's in-between phases (1/n … (n−1)/n),
 *  2 × half taps each. */
function phases(half: number, oversample: number, beta: number): Float32Array[] {
  const bessel0 = (x: number): number => {
    let s = 1
    let t = 1
    for (let k = 1; k < 60; k++) {
      t *= (x * x) / 4 / (k * k)
      s += t
    }
    return s
  }
  const out: Float32Array[] = []
  for (let p = 1; p < oversample; p++) {
    const frac = p / oversample
    const c = new Float32Array(2 * half)
    let sum = 0
    for (let j = 0; j < 2 * half; j++) {
      const t = j - half + 1 - frac
      const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const r = t / (half + 0.5)
      c[j] = s * (Math.abs(r) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - r * r)) / bessel0(beta))
      sum += c[j]
    }
    for (let j = 0; j < 2 * half; j++) c[j] /= sum
    out.push(c)
  }
  return out
}
const SHORT = phases(T_SHORT, 4, 6)
const LONG = phases(T, 8, 9)
/** The most an in-between point can be, for samples no larger than 1 (the
 *  long phases' summed sizes): a stretch whose samples are all under
 *  ceiling / REACH cannot have a peak over the ceiling, and is not read
 *  through the filter. */
const REACH = Math.max(...LONG.map((c) => c.reduce((a, v) => a + Math.abs(v), 0)), ...SHORT.map((c) => c.reduce((a, v) => a + Math.abs(v), 0)))

export interface LimiterOptions {
  /** The ceiling (dBTP). */
  ceilingDb?: number
  /** Look-ahead (ms): how early the gain starts down for a peak. */
  lookaheadMs?: number
  /** How slowly the gain comes back up (ms, a time constant). */
  releaseMs?: number
}

export interface LimiterStats {
  /** Samples whose gain was below 1 (lowered by more than 0.01 dB). */
  samples: number
  /** The most it lowered anything (dB, positive). */
  maxDb: number
  /** Where that was (seconds from the stream's start). */
  maxAt: number
}

export class TruePeakLimiter {
  readonly delay: number
  private readonly ch: number
  private readonly sr: number
  private readonly ceil: number
  private readonly A: number
  private readonly rel: number
  /** Input from `xBase` on, per channel (what is not given back yet, and
   *  the filter's context before it). */
  private x: Float32Array[]
  private xBase = 0
  private received = 0
  /** Needs (the gain each sample needs) from `needBase` on. */
  private need = new Float32Array(0)
  private needBase = 0
  private needNext = 0
  /** The sliding minimum's queue (indices into need, absolute). */
  private dq: number[] = []
  private dqHead = 0
  /** The last A + 1 minima (a ring) and their sum, for the average. */
  private ring: Float64Array
  private ringSum: number
  private hNext = 0
  private g = 1
  private outNext = 0
  private flushed = false
  /** The loudest sample over [i − T + 1, i + T] (all channels): a sliding
   *  maximum (indices and their values), pushed up to `loudNext`. */
  private mq: number[] = []
  private mv: number[] = []
  private mHead = 0
  private loudNext = 0
  readonly stats: LimiterStats = { samples: 0, maxDb: 0, maxAt: 0 }

  constructor(sampleRate: number, channels: number, opts: LimiterOptions = {}) {
    this.sr = sampleRate
    this.ch = channels
    this.ceil = Math.pow(10, ((opts.ceilingDb ?? -1) - MARGIN_DB) / 20)
    this.A = Math.max(1, Math.round(((opts.lookaheadMs ?? 5) / 1000) * sampleRate))
    this.rel = 1 - Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * sampleRate))
    // (The need reaches T either side of its peak, the reading T ahead.)
    this.delay = this.A + 2 * T
    this.x = Array.from({ length: channels }, () => new Float32Array(0))
    this.ring = new Float64Array(this.A + 1).fill(1)
    this.ringSum = this.A + 1
  }

  /** The loudest sample (all channels) the readings of index i reach. */
  private loudAround(i: number): number {
    for (; this.loudNext <= i + T; this.loudNext++) {
      const off = this.loudNext - this.xBase
      let v = 0
      for (const xs of this.x) {
        const a = Math.abs(xs[off] ?? 0)
        if (a > v) v = a
      }
      while (this.mq.length > this.mHead && this.mv[this.mv.length - 1] <= v) {
        this.mq.pop()
        this.mv.pop()
      }
      this.mq.push(this.loudNext)
      this.mv.push(v)
    }
    while (this.mq[this.mHead] < i - T + 1) this.mHead++
    if (this.mHead > 4096) {
      this.mq = this.mq.slice(this.mHead)
      this.mv = this.mv.slice(this.mHead)
      this.mHead = 0
    }
    return this.mv[this.mHead]
  }

  /** One channel read between i and i + 1 through `set` (half length `half`). */
  private read(xs: Float32Array, off: number, set: Float32Array[], half: number, m: number): number {
    const start = off - half + 1
    // Before the stream's first sample: silence.
    const j0 = Math.max(0, -this.xBase - start)
    const j1 = Math.min(2 * half, xs.length - start)
    for (const c of set) {
      let acc = 0
      for (let j = j0; j < j1; j++) acc += xs[start + j] * c[j]
      const a = Math.abs(acc)
      if (a > m) m = a
    }
    return m
  }

  /** The true peak at absolute input index i (|x| at i and the points
   *  between i and i + 1, the loudest channel). */
  private peakAt(i: number): number {
    let m = 0
    const off = i - this.xBase
    for (const xs of this.x) {
      const v = Math.abs(xs[off] ?? 0)
      if (v > m) m = v
    }
    // Every sample the readings reach under ceiling / REACH: no peak there.
    if (this.loudAround(i) * REACH <= this.ceil) return m
    for (const xs of this.x) m = this.read(xs, off, SHORT, T_SHORT, m)
    // Near the ceiling: read again by the long filter.
    if (m >= this.ceil * GATE) for (const xs of this.x) m = this.read(xs, off, LONG, T, m)
    return m
  }

  /** Takes the next piece (one array per channel, all of one length) and
   *  gives back what is ready: the input A + 2T samples ago, limited. */
  process(chans: Float32Array[]): Float32Array[] {
    if (this.flushed) throw new Error('limiter already flushed')
    const n = chans[0]?.length ?? 0
    for (let c = 0; c < this.ch; c++) {
      const src = chans[Math.min(c, chans.length - 1)]
      const old = this.x[c]
      const joined = new Float32Array(old.length + n)
      joined.set(old)
      joined.set(src.subarray(0, n), old.length)
      this.x[c] = joined
    }
    this.received += n
    return this.run(this.received)
  }

  /** The rest (the last A + 2T samples), the stream at its end. */
  flush(): Float32Array[] {
    if (this.flushed) return this.x.map(() => new Float32Array(0))
    const end = this.received
    const pad = this.x.map(() => new Float32Array(this.delay + 1))
    for (let c = 0; c < this.ch; c++) {
      const joined = new Float32Array(this.x[c].length + pad[c].length)
      joined.set(this.x[c])
      this.x[c] = joined
    }
    this.received += this.delay + 1
    const out = this.run(end)
    this.flushed = true
    return out
  }

  private run(outLimit: number): Float32Array[] {
    const A = this.A
    // Needs, as far as the filter can see (T ahead).
    const needEnd = this.received - T
    if (needEnd > this.needNext) {
      const keepFrom = Math.min(this.hNext - T, this.dq.length > this.dqHead ? this.dq[this.dqHead] : this.hNext)
      const drop = Math.max(0, keepFrom - this.needBase)
      const fresh = new Float32Array(this.need.length - drop + (needEnd - this.needNext))
      fresh.set(this.need.subarray(drop))
      this.need = fresh
      this.needBase += drop
      for (let i = this.needNext; i < needEnd; i++) {
        const p = this.peakAt(i)
        this.need[i - this.needBase] = p > this.ceil ? this.ceil / p : 1
      }
      this.needNext = needEnd
    }
    // Minima over [i, i + A] and the gain, as far as the needs reach.
    const hEnd = Math.min(this.needNext - A - T, outLimit)
    const count = Math.max(0, hEnd - this.outNext)
    const out = this.x.map(() => new Float32Array(count))
    let pushed = this.dq.length > this.dqHead ? this.dq[this.dq.length - 1] + 1 : this.hNext
    for (let i = this.hNext; i < hEnd; i++) {
      for (; pushed <= i + A + T; pushed++) {
        const v = this.need[pushed - this.needBase]
        while (this.dq.length > this.dqHead && this.need[this.dq[this.dq.length - 1] - this.needBase] >= v) this.dq.pop()
        this.dq.push(pushed)
      }
      while (this.dq[this.dqHead] < i - T) this.dqHead++
      const h = this.need[this.dq[this.dqHead] - this.needBase]
      if (i === 0) {
        // The stream's first sample: as if what came before needed what it
        // does (no ramp from before the start to miss a peak in its first
        // A samples).
        this.ring.fill(h)
        this.ringSum = h * (A + 1)
        this.g = h
      }
      const slot = i % (A + 1)
      this.ringSum += h - this.ring[slot]
      this.ring[slot] = h
      const avg = Math.min(1, this.ringSum / (A + 1))
      // Down at once (avg is already a smooth ramp), up no faster than the
      // release.
      this.g = avg < this.g ? avg : this.g + (avg - this.g) * this.rel
      if (this.g < 0.99885) {
        this.stats.samples++
        const db = -20 * Math.log10(this.g)
        if (db > this.stats.maxDb) {
          this.stats.maxDb = db
          this.stats.maxAt = i / this.sr
        }
      }
      const k = i - this.outNext
      const off = i - this.xBase
      for (let c = 0; c < this.ch; c++) out[c][k] = this.x[c][off] * this.g
    }
    if (this.dqHead > 4096) {
      this.dq = this.dq.slice(this.dqHead)
      this.dqHead = 0
    }
    // (Re-summed now and then: a running sum drifts.)
    if (hEnd > this.hNext && Math.floor(hEnd / 65536) !== Math.floor(this.hNext / 65536)) this.ringSum = this.ring.reduce((a, b) => a + b, 0)
    this.hNext = Math.max(this.hNext, hEnd)
    this.outNext += count
    // Keep the input the filter and the output still need.
    const keep = Math.min(this.outNext, this.needNext - T + 1)
    if (keep > this.xBase) {
      const drop = keep - this.xBase
      this.x = this.x.map((xs) => xs.slice(drop))
      this.xBase = keep
    }
    return out
  }
}

/** A whole buffer through a fresh limiter (the tests; a short sound). */
export function limitAll(chans: Float32Array[], sampleRate: number, opts?: LimiterOptions): { out: Float32Array[]; stats: LimiterStats } {
  const lim = new TruePeakLimiter(sampleRate, chans.length, opts)
  const a = lim.process(chans)
  const b = lim.flush()
  return { out: a.map((x, c) => { const o = new Float32Array(x.length + b[c].length); o.set(x); o.set(b[c], x.length); return o }), stats: lim.stats }
}
