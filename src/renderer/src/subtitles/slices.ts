// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the voice is cut into the pieces Whisper hears (it listens 30 s at a
// time; Snipp gives it up to 25 s). Fixed cuts every 22 s with 3 s of overlap
// fall wherever they fall — often in the middle of a word — and a piece that
// begins with half a word gets that word wrong and badly timed: on a Turkish
// test, the piece starting at 200.0 s put its first word at 200.0 instead of
// 201.2. So the cuts go into pauses: each piece ends (and the next begins) in
// the longest quiet stretch in its last 10 s, where no word can be cut. Where
// the speech has no pause that long, the old overlapping cut is used for that
// one boundary, and mergeSliceWords joins the two slices' words there so no
// word is kept twice or lost. Both models, English and multilingual. Pure:
// the tests drive it.

export interface VoiceSlice {
  /** Seconds of the audio this slice covers. */
  from: number
  to: number
  /** Its words are kept from `keepFrom` to `keepTo` (the overlap's middle
   *  where two slices share some audio; the whole slice otherwise). */
  keepFrom: number
  keepTo: number
}

const FRAME = 0.01

/** 10 ms RMS levels of mono samples. */
export function frameLevels(audio: Float32Array, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(FRAME * sampleRate))
  const n = Math.floor(audio.length / size)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    for (let i = f * size; i < (f + 1) * size; i++) sum += audio[i] * audio[i]
    out[f] = Math.sqrt(sum / size)
  }
  return out
}

/**
 * The slices for `duration` seconds of speech whose 10 ms levels are
 * `levels`. `maxLen` is a slice's longest (25 s); a pause is looked for in
 * its last `search` seconds (10 s), and must be at least `minPause` long.
 */
export function planVoiceSlices(
  levels: ArrayLike<number>,
  duration: number,
  { maxLen = 25, search = 10, minPause = 0.15, step = 22, overlap = 3 } = {}
): VoiceSlice[] {
  if (duration <= maxLen) return [{ from: 0, to: duration, keepFrom: -Infinity, keepTo: Infinity }]
  // Quiet = well under the speech level (its 90th percentile).
  const sorted = Array.from(levels).sort((a, b) => a - b)
  const speech = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? 0
  const quiet = Math.max(0.00035, speech * 0.08)
  const isQuiet = (f: number): boolean => f >= 0 && f < levels.length && levels[f] < quiet
  const slices: VoiceSlice[] = []
  let from = 0
  let keepFrom = -Infinity
  for (;;) {
    if (duration - from <= maxLen) {
      slices.push({ from, to: duration, keepFrom, keepTo: Infinity })
      break
    }
    // The longest quiet run in [from + maxLen - search, from + maxLen].
    const a = Math.round((from + maxLen - search) / FRAME)
    const b = Math.round((from + maxLen) / FRAME)
    let best: [number, number] | null = null
    for (let f = a; f < b; ) {
      if (!isQuiet(f)) {
        f++
        continue
      }
      let g = f
      while (g < b && isQuiet(g)) g++
      // A tie goes to the later pause (a fuller slice).
      if (!best || g - f >= best[1] - best[0]) best = [f, g]
      f = g
    }
    if (best && (best[1] - best[0]) * FRAME >= minPause) {
      const cut = ((best[0] + best[1]) / 2) * FRAME
      slices.push({ from, to: cut, keepFrom, keepTo: cut })
      from = cut
      keepFrom = cut
    } else {
      // No pause: the old overlapping cut, its words split at the overlap's middle.
      const next = from + step
      const middle = next + overlap / 2
      slices.push({ from, to: from + maxLen, keepFrom, keepTo: middle })
      from = next
      keepFrom = middle
    }
  }
  return slices
}

/** A word as Whisper gives it: seconds from the start of what it heard. */
export interface SliceWord {
  text: string
  timestamp: [number, number | null]
  estimated?: boolean
}

/** How far the join may move from an overlapping cut (s). */
const NEAR_CUT = 0.5
/** Two hearings of one word start within this of each other (s). */
const SAME_WORD = 0.35
/** Two timings of one word's end differ by about this (s). */
const END_SLACK = 0.05

/** A word's text for telling two hearings of it apart: lower case, letters and digits only. */
export function wordKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Adds one slice's words to `merged` (in seconds of the whole audio), those
 * that start in its [keepFrom, keepTo). At a pause cut that is all: the two
 * slices share no audio. At an overlapping cut (speech with no pause) both
 * slices heard the words around the cut and timed them on their own, often
 * 50-200 ms apart, so a fixed cut keeps a word twice or drops it from both.
 * There the new slice is joined to the last word kept before it: by text
 * where the new slice heard that word too (its words after it are kept),
 * else by time (its words whose middle comes after that word's end). Either
 * way the join stays within half a second of the fixed cut.
 */
export function mergeSliceWords(merged: SliceWord[], words: readonly SliceWord[], slice: VoiceSlice): void {
  const { from, keepFrom, keepTo } = slice
  const start = (w: SliceWord): number => from + (w.timestamp[0] ?? 0)
  const push = (w: SliceWord): void => {
    const s0 = start(w)
    merged.push({ text: w.text, timestamp: [s0, w.timestamp[1] === null ? null : from + w.timestamp[1]], ...(w.estimated ? { estimated: true } : {}) })
  }
  const last = merged[merged.length - 1]
  if (!last || !Number.isFinite(keepFrom) || from >= keepFrom) {
    for (const w of words) {
      const s0 = start(w)
      if (s0 >= keepFrom && s0 < keepTo) push(w)
    }
    return
  }
  // The new slice's own hearing of the last kept word: the same text,
  // starting nearest to it.
  const lastStart = last.timestamp[0]
  const key = wordKey(last.text)
  let anchor = -1
  let nearest = SAME_WORD
  if (key) {
    words.forEach((w, i) => {
      const d = Math.abs(start(w) - lastStart)
      if (d < nearest && wordKey(w.text) === key) {
        nearest = d
        anchor = i
      }
    })
  }
  const lo = keepFrom - NEAR_CUT
  const hi = keepFrom + NEAR_CUT
  const joinAt = Math.min(hi, Math.max(lo, (last.timestamp[1] ?? lastStart) - END_SLACK))
  words.forEach((w, i) => {
    const s0 = start(w)
    if (s0 >= keepTo) return
    if (anchor >= 0) {
      if (i > anchor) push(w)
      return
    }
    const mid = w.timestamp[1] === null ? s0 : (s0 + from + w.timestamp[1]) / 2
    if (s0 >= hi || (s0 >= lo && mid >= joinAt)) push(w)
  })
}
