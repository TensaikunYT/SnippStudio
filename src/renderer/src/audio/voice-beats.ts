// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the voice leans: the phrases a narrator speaks and, inside them, the
// stressed syllables — the moments a speaker's hands naturally beat on. Read
// from speech-band loudness (the same analysis the silence cutter uses), so it
// works on any recording, in any language, without a speech model.

import type { Project } from '../types'
import { autoThresholdDb, carriesAudio, clipLoudnessDb } from './silence'

export interface VoicePhrase {
  /** Project seconds. */
  start: number
  end: number
  /** The stressed beats: when (project seconds) and how strong (0..1). */
  beats: { t: number; k: number }[]
}

export const VOICE_WINDOW = 0.02

function movingAverage(v: readonly number[], half: number): number[] {
  const out = new Array<number>(v.length)
  let sum = 0
  let n = 0
  let lo = 0
  let hi = -1
  for (let i = 0; i < v.length; i++) {
    while (hi < Math.min(v.length - 1, i + half)) sum += v[++hi], n++
    while (lo < i - half) sum -= v[lo++], n--
    out[i] = sum / Math.max(1, n)
  }
  return out
}

/**
 * Phrases and beats from loudness windows (`window` seconds each, the first
 * at project time `offset`). A phrase is voiced sound with pauses shorter
 * than a breath bridged; a beat is a syllable that stands out — a clear rise
 * to a peak well above its surroundings — kept at least `gap` seconds from
 * the next, the stronger winning.
 */
export function phrasesFromDb(
  dbs: readonly number[],
  window: number,
  offset: number,
  opts: { gap?: number; bridge?: number; minPhrase?: number } = {}
): VoicePhrase[] {
  const gap = opts.gap ?? 0.45
  const bridge = opts.bridge ?? 0.35
  const minPhrase = opts.minPhrase ?? 0.6
  if (dbs.length < 3) return []
  const thr = autoThresholdDb([...dbs], 'balanced')
  const sorted = [...dbs].sort((a, b) => a - b)
  const loud = sorted[Math.floor(sorted.length * 0.95)] ?? thr + 20
  // Voiced runs, pauses shorter than a breath bridged.
  const runs: [number, number][] = []
  let s = -1
  for (let i = 0; i <= dbs.length; i++) {
    const on = i < dbs.length && dbs[i] > thr
    if (on && s < 0) s = i
    if (!on && s >= 0) {
      const prev = runs[runs.length - 1]
      if (prev && (s - prev[1]) * window < bridge) prev[1] = i
      else runs.push([s, i])
      s = -1
    }
  }
  const env = movingAverage(dbs, 1)
  // The level round a syllable, from voiced sound only: the silence after a
  // phrase must not make its last, unstressed syllable look like a peak.
  const half = Math.round(0.2 / window)
  const base = dbs.map((_, i) => {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(dbs.length - 1, i + half); j++) {
      if (dbs[j] > thr) {
        sum += dbs[j]
        n++
      }
    }
    return n ? sum / n : dbs[i]
  })
  const out: VoicePhrase[] = []
  for (const [a, b] of runs) {
    if ((b - a) * window < minPhrase) continue
    // Every syllable's peak; a stressed one stands clear of the phrase's
    // typical syllable (its median peak), not just of its own trough.
    const peaks: { i: number; rise: number }[] = []
    const back = Math.max(1, Math.round(0.12 / window))
    for (let i = a + 1; i < b - 1; i++) {
      if (!(env[i] >= env[i - 1] && env[i] > env[i + 1])) continue
      const rise = env[i] - Math.min(...env.slice(Math.max(a, i - back), i))
      if (rise >= 3 && env[i] >= thr + 6) peaks.push({ i, rise })
    }
    const levels = peaks.map((q) => env[q.i]).sort((x, y) => x - y)
    const typical = levels.length ? levels[Math.floor(levels.length / 2)] : thr
    const cands: { i: number; v: number }[] = []
    for (const q of peaks) {
      if (env[q.i] - typical < 2.5 || env[q.i] - base[q.i] < 1) continue
      cands.push({ i: q.i, v: env[q.i] - typical + q.rise * 0.3 })
    }
    // A flat phrase still gets one beat where it is loudest.
    if (!cands.length && peaks.length && (b - a) * window >= 1.2) {
      const top = peaks.reduce((x, y) => (env[y.i] > env[x.i] ? y : x))
      cands.push({ i: top.i, v: 0 })
    }
    cands.sort((p, q) => q.v - p.v)
    const picked: number[] = []
    for (const c of cands) if (picked.every((j) => Math.abs(j - c.i) * window >= gap)) picked.push(c.i)
    picked.sort((p, q) => p - q)
    out.push({
      start: offset + a * window,
      end: offset + b * window,
      // Strength: how far above the typical syllable, and how loud overall.
      beats: picked.map((i) => ({
        t: offset + i * window,
        k: Math.min(1, Math.max(0.2, 0.5 * ((env[i] - typical) / 8) + 0.5 * ((dbs[i] - thr) / Math.max(3, loud - thr))))
      }))
    })
  }
  return out
}

/** Every audible audio clip's phrases and beats, in project time. */
export async function analyzeVoice(project: Project, clipIds?: readonly string[]): Promise<VoicePhrase[]> {
  const out: VoicePhrase[] = []
  for (const track of project.tracks) {
    for (const id of track.clipIds) {
      if (clipIds && !clipIds.includes(id)) continue
      const clip = project.clips[id]
      // Whatever you hear: a voice track, or a video's own sound.
      if (!clip || !carriesAudio(project, clip)) continue
      const dbs = await clipLoudnessDb(project, clip, VOICE_WINDOW).catch(() => null)
      if (!dbs) continue
      out.push(...phrasesFromDb(dbs, VOICE_WINDOW, clip.start))
    }
  }
  return out.sort((a, b) => a.start - b.start)
}
