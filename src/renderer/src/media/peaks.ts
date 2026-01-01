// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Asset } from '../types'
import { audioPresentationOffset, getAudioSink } from './sources'

/**
 * Multi-resolution peak data — the structure every professional editor uses to
 * draw a waveform (Audacity, Reaper, DaVinci, CapCut all do a variant of this).
 *
 * Each level holds, per bucket, the true `min`/`max` sample (the peak envelope)
 * and the `rms` (perceived level). Level 0 is the finest; each further level
 * halves the resolution. At draw time the level whose bucket is closest to ONE
 * SCREEN PIXEL is picked, so every zoom gets accurate per-pixel data without
 * re-reading the file and without averaging away transients.
 *
 * The previous implementation stored a single RMS series at ~60 buckets/second
 * and sub-sampled the audio to 8 kHz — that is why it looked coarse and
 * "estimated": real peaks fell between the samples it looked at.
 */
export interface PeakLevel {
  /** Seconds of audio per bucket. */
  bucketDur: number
  min: Float32Array
  max: Float32Array
  rms: Float32Array
}

export interface PeakPyramid {
  duration: number
  /** levels[0] is the finest. */
  levels: PeakLevel[]
  /** Loudest absolute sample in the WHOLE asset — the one stable normalisation
   *  reference. Never derive scale from a clip, viewport or zoom: that made a
   *  cut clip's waveform suddenly change size. */
  peak: number
}

/** Samples per bucket at level 0 (power of two so bucketing is a bit shift). */
const BASE_SAMPLES = 256
const BASE_SHIFT = 8

/** Bumped whenever the on-disk layout changes, so old files are ignored. */
const CACHE_MAGIC = 0x534e5032 // "SNP2" — stereo-safe peaks, invalidate old downmix cache

/**
 * Level 0 is everything needed to rebuild the pyramid, so only that is stored:
 * magic, sampleRate, duration, bucket count, then min/max/rms as Float32.
 */
export function serializePyramid(p: PeakPyramid): Uint8Array {
  const base = p.levels[0]
  const n = base.min.length
  const header = new Float64Array([CACHE_MAGIC, BASE_SAMPLES / base.bucketDur, p.duration, n])
  const out = new Uint8Array(header.byteLength + n * 3 * 4)
  out.set(new Uint8Array(header.buffer), 0)
  let off = header.byteLength
  for (const arr of [base.min, base.max, base.rms]) {
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), off)
    off += arr.byteLength
  }
  return out
}

export function deserializePyramid(bytes: Uint8Array): PeakPyramid | null {
  try {
    // The Float32 views below need aligned, exclusively-owned memory.
    const buf = bytes.slice().buffer
    const header = new Float64Array(buf, 0, 4)
    if (header[0] !== CACHE_MAGIC) return null
    const sampleRate = header[1]
    const duration = header[2]
    const n = header[3]
    if (!(sampleRate > 0) || !(n > 0)) return null
    let off = 32
    const read = (): Float32Array => {
      const a = new Float32Array(buf, off, n)
      off += n * 4
      return a
    }
    const min = read()
    const max = read()
    const rms = read()
    const levels: PeakLevel[] = [{ bucketDur: BASE_SAMPLES / sampleRate, min, max, rms }]
    let peak = 0
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(min[i]), Math.abs(max[i]))
      if (a > peak) peak = a
    }
    while (levels[levels.length - 1].min.length > 4 && levels[levels.length - 1].bucketDur < 2) {
      levels.push(halve(levels[levels.length - 1]))
    }
    return { duration, levels, peak: Math.max(0.02, peak) }
  } catch {
    return null
  }
}

/** Coarsens a level by combining adjacent bucket pairs. */
function halve(level: PeakLevel): PeakLevel {
  const src = level.min.length
  // Round UP: truncating dropped the odd trailing bucket at every level, and
  // that loss doubles each time — by the coarsest level several seconds of the
  // clip's tail would have had no waveform at all when zoomed right out.
  const n = Math.ceil(src / 2)
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  const rms = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = i << 1
    const b = Math.min(a + 1, src - 1)
    min[i] = Math.min(level.min[a], level.min[b])
    max[i] = Math.max(level.max[a], level.max[b])
    // RMS combines in the power domain, not linearly.
    rms[i] = Math.sqrt((level.rms[a] * level.rms[a] + level.rms[b] * level.rms[b]) / 2)
  }
  return { bucketDur: level.bucketDur * 2, min, max, rms }
}

/**
 * Scans the asset's audio ONCE, reading every sample, and returns the pyramid.
 * Decoding is async chunk by chunk, so the per-sample work happens in small
 * slices and never blocks the UI for long.
 */
export async function computePeakPyramid(
  asset: Asset,
  /** Called a few times a second with everything decoded SO FAR, so the
   *  waveform fills in left-to-right instead of the clip staying blank until
   *  the whole file has been read. */
  onPartial?: (partial: PeakPyramid, fraction: number) => void
): Promise<PeakPyramid | null> {
  const sink = await getAudioSink(asset, true)
  if (!sink || asset.duration <= 0) return null
  // Line the buckets up with PRESENTATION time — the timeline the player uses —
  // rather than with the container's raw packet timestamps. Without this the
  // drawing sits a priming-delay ahead of what you hear on any format that has
  // one (AAC and friends); it is zero for formats that don't, like WAV.
  const originShift = await audioPresentationOffset(asset)

  let sampleRate = 0
  let min: Float32Array | null = null
  let max: Float32Array | null = null
  let sumSq: Float64Array | null = null
  let counts: Float32Array | null = null
  let nBuckets = 0
  let lastPartial = performance.now()

  for await (const wrapped of sink.buffers(0, asset.duration)) {
    const buf = wrapped.buffer
    if (!min) {
      sampleRate = buf.sampleRate
      nBuckets = Math.max(1, Math.ceil((asset.duration * sampleRate) / BASE_SAMPLES) + 2)
      min = new Float32Array(nBuckets)
      max = new Float32Array(nBuckets)
      sumSq = new Float64Array(nBuckets)
      counts = new Float32Array(nBuckets)
    }
    // Locals let the hot loop skip the nullable checks entirely.
    const mn = min
    const mx = max!
    const sq = sumSq!
    const ct = counts!
    const channels = Array.from({ length: buf.numberOfChannels }, (_, index) => buf.getChannelData(index))
    if (channels.length === 0) continue
    const startSample = Math.round((wrapped.timestamp + originShift) * sampleRate)
    for (let i = 0; i < channels[0].length; i++) {
      const idx = (startSample + i) >> BASE_SHIFT
      if (idx < 0) continue
      if (idx >= nBuckets) break
      // Draw the envelope of ALL channels. Averaging L+R cancelled inverted
      // stereo material, showing a fake silent gap while playback was audible.
      let low = Infinity
      let high = -Infinity
      let power = 0
      for (const channel of channels) {
        const value = channel[i]
        low = Math.min(low, value)
        high = Math.max(high, value)
        power += value * value
      }
      if (ct[idx] === 0) {
        mn[idx] = low
        mx[idx] = high
      } else {
        if (low < mn[idx]) mn[idx] = low
        if (high > mx[idx]) mx[idx] = high
      }
      sq[idx] += power / channels.length
      ct[idx]++
    }

    // Publish what's decoded so far a few times a second. Building the whole
    // pyramid before showing anything is what left a freshly imported clip with
    // a blank waveform for many seconds.
    if (onPartial && performance.now() - lastPartial > 400) {
      lastPartial = performance.now()
      const soFar = finalise(min, max!, sumSq!, counts!, nBuckets, sampleRate, asset.duration)
      if (soFar) onPartial(soFar, Math.min(1, (wrapped.timestamp + wrapped.buffer.duration) / asset.duration))
    }
  }

  if (!min || !max || !sumSq || !counts) return null

  return finalise(min, max, sumSq, counts, nBuckets, sampleRate, asset.duration)
}

/** Builds the pyramid from the accumulators — shared by the partial updates
 *  during decoding and the final result. */
function finalise(
  min: Float32Array,
  max: Float32Array,
  sumSq: Float64Array,
  counts: Float32Array,
  nBuckets: number,
  sampleRate: number,
  duration: number
): PeakPyramid | null {
  if (sampleRate <= 0) return null
  const rms = new Float32Array(nBuckets)
  const mn = new Float32Array(min)
  const mx = new Float32Array(max)
  let peak = 0
  for (let i = 0; i < nBuckets; i++) {
    if (counts[i] > 0) {
      rms[i] = Math.sqrt(sumSq[i] / counts[i])
      const a = Math.max(Math.abs(mn[i]), Math.abs(mx[i]))
      if (a > peak) peak = a
    } else {
      mn[i] = 0
      mx[i] = 0
    }
  }
  const base: PeakLevel = { bucketDur: BASE_SAMPLES / sampleRate, min: mn, max: mx, rms }
  const levels: PeakLevel[] = [base]
  while (levels[levels.length - 1].min.length > 4 && levels[levels.length - 1].bucketDur < 2) {
    levels.push(halve(levels[levels.length - 1]))
  }
  return { duration, levels, peak: Math.max(0.02, peak) }
}


/**
 * Picks the level whose buckets are closest to (but not finer than) one screen
 * pixel — the finest data that doesn't waste work aggregating dozens of buckets
 * per column.
 */
export function levelForScale(pyramid: PeakPyramid, secondsPerPixel: number): PeakLevel {
  let chosen = pyramid.levels[0]
  for (const level of pyramid.levels) {
    if (level.bucketDur <= secondsPerPixel) chosen = level
    else break
  }
  return chosen
}
