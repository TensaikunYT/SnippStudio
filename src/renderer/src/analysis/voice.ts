// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which track the speech is on, by its sound (SnippStudio phase 4A.9, T3).
// The subtitles' own choice (subtitles/follow.ts voiceOf) goes by track kind
// and order: with a voice-over under a music bed, or a talking video over
// music, it names the music. The words tell it better: speech is loud while
// a word is said and quiet between the words; a music bed is the same in
// both. Pure.

export interface TrackSound {
  track: string
  /** Each clip's loudness windows (dB), the first at the clip's `start`. */
  clips: { start: number; dbs: readonly number[] }[]
}

const FLOOR = -80

/** Mean loudness while a word is said minus mean loudness between the words
 *  (at least 0.15 s from any word, inside the stretch the words span), in
 *  dB; null when there is too little of either to tell. */
export function speechContrast(clips: TrackSound['clips'], win: number, words: readonly { start: number; end: number }[]): number | null {
  const sorted = [...words].sort((a, b) => a.start - b.start)
  if (sorted.length < 2) return null
  const first = sorted[0].start
  const last = sorted.reduce((m, w) => Math.max(m, w.end), 0)
  let inSum = 0
  let inN = 0
  let gapSum = 0
  let gapN = 0
  for (const c of clips) {
    let k = 0
    for (let i = 0; i < c.dbs.length; i++) {
      const t = c.start + (i + 0.5) * win
      if (t < first || t > last) continue
      while (k < sorted.length && sorted[k].end + 0.15 < t) k++
      const db = Math.max(FLOOR, c.dbs[i])
      let said = false
      let near = false
      for (let j = k; j < sorted.length && sorted[j].start - 0.15 <= t; j++) {
        near = true
        if (t >= sorted[j].start && t <= sorted[j].end) said = true
      }
      if (said) {
        inSum += db
        inN++
      } else if (!near) {
        gapSum += db
        gapN++
      }
    }
  }
  if (inN < 10 || gapN < 10) return null
  return inSum / inN - gapSum / gapN
}

/**
 * The track whose sound goes with the words: the highest contrast, when it
 * is a clear one (`min` dB, and 3 dB over the next). Null when no track
 * stands out (one voice mixed into one file with its music, no pauses at
 * all): the caller keeps the subtitles' own choice then.
 */
export function speechTrack(tracks: readonly TrackSound[], win: number, words: readonly { start: number; end: number }[], min = 6): string | null {
  const scored = tracks
    .map((t) => ({ track: t.track, contrast: speechContrast(t.clips, win, words) }))
    .filter((x): x is { track: string; contrast: number } => x.contrast !== null)
    .sort((a, b) => b.contrast - a.contrast)
  if (!scored.length || scored[0].contrast < min) return null
  if (scored.length > 1 && scored[0].contrast - scored[1].contrast < 3) return null
  return scored[0].track
}
