// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The beat of the music: where its pulses fall, found from the sound itself
// (nothing leaves the machine), and two things to do with them — cut the
// pictures on the beat, and move every transition onto the nearest one.

import { audioPresentationOffset, getAudioSink } from '../media/sources'
import type { Clip, Project } from '../types'
import { assetById } from '../types'
import { headRoom, localAtMedia, tailRoom, takePart } from '../timeline/media-time'
import { hasCurve } from '../timeline/speed-curve'

/** Seconds between two envelope values. */
export const BEAT_HOP = 0.01

/**
 * A clip's onset strength every BEAT_HOP seconds of timeline time: how much
 * louder it just got — the low end (a kick) weighted over the rest — or
 * null when its audio can't be read.
 */
export async function clipOnsets(project: Project, clip: Clip, signal?: { cancelled(): boolean }): Promise<Float32Array | null> {
  const asset = assetById(project, clip.assetId)
  if (!asset) return null
  const sink = await getAudioSink(asset, true)
  if (!sink) return null
  const shift = await audioPresentationOffset(asset)
  const n = Math.max(2, Math.ceil(clip.duration / BEAT_HOP))
  const low = new Float64Array(n)
  const all = new Float64Array(n)
  const count = new Float64Array(n)
  const spd = clip.speed ?? 1
  const from = clip.inPoint
  const to = Math.min(asset.duration, clip.inPoint + clip.duration * spd)
  // (Along a speed curve, the curve's inverse: core polish C.)
  const toLocal = hasCurve(clip) ? (m: number): number => localAtMedia(clip, m) : (m: number): number => (m - clip.inPoint) / spd
  let lp = 0
  for await (const wrapped of sink.buffers(from, to)) {
    // (An agent's analysis stops here: phase 4A.10, D5.)
    if (signal?.cancelled()) throw new Error('cancelled')
    const chans = Array.from({ length: wrapped.buffer.numberOfChannels }, (_, i) => wrapped.buffer.getChannelData(i))
    if (!chans.length) continue
    const sr = wrapped.buffer.sampleRate
    const step = Math.max(1, Math.floor(sr / 4000))
    // A one-pole low-pass near 150 Hz for the kick and bass.
    const a = 1 - Math.exp((-2 * Math.PI * 150 * step) / sr)
    for (let i = 0; i < chans[0].length; i += step) {
      let x = 0
      for (const c of chans) x += c[i]
      x /= chans.length
      lp += a * (x - lp)
      const t = toLocal(wrapped.timestamp + shift + i / sr)
      const k = Math.floor(t / BEAT_HOP)
      if (k < 0 || k >= n) continue
      low[k] += lp * lp
      all[k] += x * x
      count[k]++
    }
  }
  const env = new Float32Array(n)
  let pl = 0
  let pa = 0
  for (let k = 0; k < n; k++) {
    const c = Math.max(1, count[k])
    const l = Math.log(1e-9 + low[k] / c)
    const f = Math.log(1e-9 + all[k] / c)
    // Only rises count: a beat is where it gets louder.
    env[k] = k === 0 ? 0 : Math.max(0, l - pl) * 1.6 + Math.max(0, f - pa)
    pl = l
    pa = f
  }
  return env
}

/**
 * The beat from an onset envelope (hop seconds apart): its tempo from how
 * the envelope repeats (60–180 BPM, a gentle pull towards 120), the grid's
 * phase from where the pulses land, each beat then settled on the strongest
 * onset close by. Times are seconds from the envelope's start.
 */
export function beatsFromOnsets(env: ArrayLike<number>, hop = BEAT_HOP): { bpm: number; beats: number[] } {
  const n = env.length
  if (n < 50) return { bpm: 0, beats: [] }
  // Smoothed a touch, and with the slow drift of loudness taken out.
  const e = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
      s += env[j]
      c++
    }
    e[i] = s / c
  }
  const W = Math.round(1 / hop)
  const local = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let c = 0
    for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j += 4) {
      s += e[j]
      c++
    }
    local[i] = Math.max(0, e[i] - s / c)
  }
  // Tempo: the lag at which the envelope best matches itself.
  const minLag = Math.round(60 / 180 / hop)
  const maxLag = Math.round(60 / 60 / hop)
  let best = minLag
  let bestScore = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < n; i += 2) s += local[i] * local[i + lag]
    const bpm = 60 / (lag * hop)
    const pull = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    const score = (s / Math.max(1, n - lag)) * (0.6 + 0.4 * pull)
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  // Refine the period between whole hops by the neighbours' scores.
  const period = best
  // Phase: where on the period the pulses land most.
  let phase = 0
  let phaseScore = -1
  for (let p = 0; p < period; p++) {
    let s = 0
    for (let i = p; i < n; i += period) s += local[i]
    if (s > phaseScore) {
      phaseScore = s
      phase = p
    }
  }
  const beats: number[] = []
  const win = Math.max(1, Math.round(period * 0.12))
  for (let i = phase; i < n; i += period) {
    let at = i
    let v = -1
    for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) {
      if (local[j] > v) {
        v = local[j]
        at = j
      }
    }
    // Where it is silent the grid carries on as it was.
    beats.push((v > 0 ? at : i) * hop)
  }
  // The tempo finer than a whole hop: a straight line through the beats.
  let bpm = 60 / (period * hop)
  if (beats.length >= 4) {
    const k = beats.length
    const mk = (k - 1) / 2
    const mt = beats.reduce((s, b) => s + b, 0) / k
    let num = 0
    let den = 0
    beats.forEach((b, i) => {
      num += (i - mk) * (b - mt)
      den += (i - mk) ** 2
    })
    const P = num / den
    if (P > 0) bpm = 60 / P
  }
  return { bpm, beats }
}

/** The beats of a music clip on the timeline (project seconds). */
export async function analyzeBeats(project: Project, clipId: string, signal?: { cancelled(): boolean }): Promise<{ bpm: number; beats: number[] } | null> {
  const clip = project.clips[clipId]
  if (!clip) return null
  const env = await clipOnsets(project, clip, signal)
  if (!env) return null
  const r = beatsFromOnsets(env)
  return { bpm: r.bpm, beats: r.beats.map((t) => clip.start + t) }
}

/** The beat nearest to t. */
function nearest(beats: number[], t: number): number {
  let lo = 0
  let hi = beats.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (beats[mid] < t) lo = mid + 1
    else hi = mid
  }
  const a = beats[Math.max(0, lo - 1)]
  const b = beats[lo]
  return Math.abs(a - t) <= Math.abs(b - t) ? a : b
}

/**
 * The pictures of a track cut on the beat: from the first one (moved onto
 * the nearest beat), each lasts `every` beats; a video no longer than it has
 * — it ends on the last beat it can reach. The clips keep their order.
 * Returns how many were retimed.
 */
export function cutOnBeats(project: Project, trackId: string, beats: number[], every: number): number {
  const track = project.tracks.find((t) => t.id === trackId)
  if (!track || beats.length < 2) return 0
  const clips = track.clipIds.map((id) => project.clips[id]).filter((c): c is Clip => !!c).sort((a, b) => a.start - b.start)
  if (!clips.length) return 0
  let bi = beats.indexOf(nearest(beats, clips[0].start))
  let n = 0
  for (const c of clips) {
    if (bi >= beats.length - 1) break
    const asset = assetById(project, c.assetId)
    const maxDur = asset && asset.kind !== 'image' ? (asset.duration - c.inPoint) / (c.speed ?? 1) : Infinity
    let bj = Math.min(beats.length - 1, bi + Math.max(1, every))
    while (bj > bi + 1 && beats[bj] - beats[bi] > maxDur) bj--
    if (beats[bj] - beats[bi] > maxDur) break
    c.start = beats[bi]
    c.duration = beats[bj] - beats[bi]
    bi = bj
    n++
  }
  // Whatever did not fit on the beats follows on, in order, untouched.
  let end = clips[n - 1] ? clips[n - 1].start + clips[n - 1].duration : 0
  for (const c of clips.slice(n)) {
    c.start = Math.max(c.start, end)
    end = c.start + c.duration
  }
  return n
}

/**
 * Every transition moved onto the nearest beat (within half a beat): the cut
 * rolls — the clip before ends there and the one after starts there — as
 * far as their media allows. Returns how many moved.
 */
export function transitionsOnBeats(project: Project, beats: number[], trackId?: string): number {
  if (beats.length < 2) return 0
  const half = (beats[beats.length - 1] - beats[0]) / (beats.length - 1) / 2
  let moved = 0
  for (const track of project.tracks) {
    if (track.kind !== 'video' || (trackId && track.id !== trackId)) continue
    const clips = track.clipIds.map((id) => project.clips[id]).filter((c): c is Clip => !!c).sort((a, b) => a.start - b.start)
    for (let i = 0; i + 1 < clips.length; i++) {
      const a = clips[i]
      const b = clips[i + 1]
      if (!a.transitionOut) continue
      const cut = a.start + a.duration
      if (Math.abs(b.start - cut) > 0.05) continue
      const beat = nearest(beats, cut)
      let d = beat - cut
      if (Math.abs(d) > half || Math.abs(d) < 1e-3) continue
      const assetA = assetById(project, a.assetId)
      const assetB = assetById(project, b.assetId)
      const sa = a.speed ?? 1
      const sb = b.speed ?? 1
      // Media room: the clip before can't run past its file's end, the one
      // after can't start before its file's beginning.
      if (d > 0 && assetA && assetA.kind !== 'image') d = Math.min(d, a.speedCurve ? tailRoom(a, assetA.duration) : (assetA.duration - a.inPoint) / sa - a.duration)
      if (d < 0 && assetB && assetB.kind !== 'image') d = Math.max(d, b.speedCurve ? -headRoom(b, assetB.duration) : -b.inPoint / sb)
      if (a.duration + d < 0.2 || b.duration - d < 0.2 || Math.abs(d) < 1e-3) continue
      // (Along a speed curve each keeps its own average: core polish C.)
      if (a.speedCurve && assetA && assetA.kind !== 'image') takePart(a, a, 0, a.duration + d)
      a.duration += d
      b.start += d
      if (b.speedCurve && assetB && assetB.kind !== 'image') takePart(b, b, d, b.duration)
      else if (assetB && assetB.kind !== 'image') b.inPoint += d * sb
      b.duration -= d
      moved++
    }
  }
  return moved
}
