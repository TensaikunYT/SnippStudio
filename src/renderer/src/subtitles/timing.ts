// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { CaptionWord } from '../types'
import type { WordChunk } from './captions'

/** Editor tiles stay joined even when Whisper's word-end timestamp falls
 * inside a pause. The separate end handle still represents that timestamp. */
export function linkedWordTileEnd(words: CaptionWord[], index: number, cueEnd: number): number {
  return words[index + 1]?.start ?? cueEnd
}

/** Move one karaoke onset without ripple-editing neighbouring words. The
 * highlight renderer changes words at their START times; a previous word's
 * Whisper end is not a boundary and must not pull this handle backward. */
export function moveCaptionWordStart(
  words: CaptionWord[], index: number, proposed: number, cueStart: number, cueEnd: number
): CaptionWord[] {
  if (!Number.isInteger(index) || index < 0 || index >= words.length ||
      !Number.isFinite(proposed) || !Number.isFinite(cueStart) || !Number.isFinite(cueEnd)) return words
  const step = 0.01
  const lower = index === 0 ? cueStart : Math.max(cueStart, words[index - 1].start + step)
  const upper = index === words.length - 1 ? cueEnd - step : Math.min(cueEnd - step, words[index + 1].start - step)
  if (upper < lower) return words
  const start = Math.min(upper, Math.max(lower, proposed))
  if (Math.abs(start - words[index].start) < 0.0005) return words
  return words.map((word, at) => at === index
    ? { ...word, start, end: Math.max(word.end, start + step), estimated: false }
    : word)
}

/** The right edge is independent of the next word's onset. Shortening a word
 * exposes a real silence gap without shifting the following karaoke anchor. */
export function moveCaptionWordEnd(
  words: CaptionWord[], index: number, proposed: number, cueStart: number, cueEnd: number
): CaptionWord[] {
  if (!Number.isInteger(index) || index < 0 || index >= words.length ||
      !Number.isFinite(proposed) || !Number.isFinite(cueStart) || !Number.isFinite(cueEnd)) return words
  const step = 0.01
  const word = words[index]
  const lower = Math.max(cueStart, word.start) + step
  const upper = Math.min(cueEnd, words[index + 1]?.start ?? cueEnd)
  if (upper < lower) return words
  const end = Math.min(upper, Math.max(lower, proposed))
  if (Math.abs(end - word.end) < 0.0005) return words
  return words.map((item, at) => at === index ? { ...item, end, estimated: false } : item)
}

/** Reject ONNX alignment failures before they become clips far off the audio
 * (or a stack of zero-duration words at one timestamp). Allow a little edge
 * tolerance for Whisper's 20 ms timestamp grid and chunk rounding. */
export function hasUsableWordTiming(words: WordChunk[], duration: number): boolean {
  if (words.length === 0 || !Number.isFinite(duration) || duration <= 0) return false
  let collapsed = 0
  for (const word of words) {
    const [start, end] = word.timestamp
    if (!Number.isFinite(start) || start < 0 || start > duration + 0.5 ||
        (end !== null && (!Number.isFinite(end) || end < start || end > duration + 0.5))) return false
    if (end !== null && end <= start + 0.001) collapsed++
  }
  return collapsed / words.length <= 0.6
}

/** Whisper may align the final word of a clipped inference into its padded
 * 30-second window, far beyond the supplied audio. Keep the reliable alignment and trim
 * only that endpoint; larger or interior corruption still needs a retry. */
export function normalizeWhisperWordTiming(words: WordChunk[], duration: number): WordChunk[] | null {
  if (words.length === 0 || !Number.isFinite(duration) || duration <= 0) return null
  const normalized: WordChunk[] = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    const [rawStart, rawEnd] = word.timestamp
    if (!Number.isFinite(rawStart) || rawStart < -0.05 || rawStart >= duration ||
        (rawEnd !== null && (!Number.isFinite(rawEnd) || rawEnd < rawStart - 0.02))) return null
    const start = Math.max(0, rawStart)
    let end = rawEnd
    if (end !== null && end > duration) {
      // The decoder aligns against a padded 30-second window: the very last
      // word of a 25-second slice can end near 30s despite starting at 24s.
      // Clamp only a word that actually starts in the final 1.5s, never an
      // interior word with a wildly incorrect endpoint.
      if (index < words.length - 2 || start < duration - 1.5) return null
      end = duration
    }
    normalized.push({ ...word, timestamp: [start, end],
      ...(end !== rawEnd ? { estimated: true } : {}) })
  }
  return hasUsableWordTiming(normalized, duration) ? normalized : null
}

/** When the local ONNX export cannot align individual tokens, Whisper's own
 * timestamp tokens can still anchor phrases. The intervals below are clearly
 * marked estimated: they are a fallback, not claimed to be word alignment. */
export function estimateWordsFromSegments(segments: WordChunk[], duration: number): WordChunk[] {
  const result: WordChunk[] = []
  for (const segment of segments) {
    const pieces = segment.text.trim().split(/\s+/u).filter(Boolean)
    if (pieces.length === 0) continue
    const [rawStart, rawEnd] = segment.timestamp
    if (!Number.isFinite(rawStart) || rawStart < -0.05 || rawStart >= duration) return []
    if (rawEnd !== null && (!Number.isFinite(rawEnd) || rawEnd < rawStart - 0.05)) return []
    const start = Math.max(0, rawStart)
    const end = Math.min(duration, rawEnd ?? start + Math.max(0.3, pieces.length * 0.35))
    if (end - start < 0.05) return []
    const weights = pieces.map((piece) => Math.max(1, [...piece].length))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    let cursor = start
    pieces.forEach((text, index) => {
      const next = index === pieces.length - 1 ? end : cursor + (end - start) * weights[index] / total
      result.push({ text, timestamp: [cursor, next], estimated: true })
      cursor = next
    })
  }
  return hasUsableWordTiming(result, duration) ? result : []
}

const FRAME_SEC = 0.01
const MIN_QUIET_SEC = 0.05
const MIN_SHIFT_SEC = 0.04
const MAX_SEARCH_SEC = 2

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))]
}

function frameRms(audio: Float32Array, from: number, to: number): number {
  let sum = 0
  for (let index = from; index < to; index++) sum += audio[index] * audio[index]
  return Math.sqrt(sum / Math.max(1, to - from))
}

/** Finds a clear speech onset inside a Whisper word interval. Whisper's word
 * timestamps sometimes assign the silence BEFORE a word to that word. Textual
 * splitting is then correct, but the right cue visibly starts in the gap. We
 * move only across a sustained, measurable quiet run followed by sustained
 * audio; ambiguous/noisy material is deliberately left untouched. */
export function refineWordStartFromAudio(
  start: number,
  end: number,
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || audio.length === 0) return start
  const localStart = Math.max(0, start - audioStart)
  const localEnd = Math.min(audio.length / sampleRate, end - audioStart, localStart + MAX_SEARCH_SEC)
  if (localEnd - localStart < MIN_QUIET_SEC + FRAME_SEC * 3) return start

  const frameSize = Math.max(1, Math.round(FRAME_SEC * sampleRate))
  const firstSample = Math.max(0, Math.floor(localStart * sampleRate))
  const lastSample = Math.min(audio.length, Math.ceil(localEnd * sampleRate))
  const levels: number[] = []
  for (let offset = firstSample; offset < lastSample; offset += frameSize) {
    levels.push(frameRms(audio, offset, Math.min(lastSample, offset + frameSize)))
  }
  if (levels.length < 8) return start

  // The upper envelope represents the word even when most of its assigned
  // interval is silence. Absolute floors avoid amplifying numerical noise.
  const speechLevel = percentile(levels, 0.9)
  if (speechLevel < 0.001) return start
  const quietLevel = Math.max(0.00035, speechLevel * 0.12)
  const activeLevel = Math.max(0.0008, speechLevel * 0.22)
  const quietFramesNeeded = Math.ceil(MIN_QUIET_SEC / FRAME_SEC)

  // Only silence at the BEGINNING of the assigned interval belongs to the
  // next word. Searching the whole interval also found pauses *inside* a
  // spoken word, moving its start to a later syllable. Allow a very short
  // leading tail from the previous word, but never skip sustained speech.
  let index = 0
  while (index < levels.length && levels[index] >= activeLevel) index++
  if (index > quietFramesNeeded) return start
  const quietFrom = index
  while (index < levels.length && levels[index] < quietLevel) index++
  if (index - quietFrom < quietFramesNeeded || index + 2 >= levels.length) return start
  const sustained = levels[index] >= activeLevel && levels[index + 1] >= activeLevel && levels[index + 2] >= activeLevel
  if (sustained) {
    // Back up one frame to retain a soft consonant/attack immediately before
    // the stable energy rise.
    const refined = start + Math.max(0, index - 1) * FRAME_SEC
    return refined - start >= MIN_SHIFT_SEC && refined < end ? refined : start
  }
  return start
}

export function refineCaptionWordStarts(
  words: CaptionWord[],
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): CaptionWord[] {
  return words.map((word) => ({
    ...word,
    start: Math.min(word.end, refineWordStartFromAudio(word.start, word.end, audio, audioStart, sampleRate))
  }))
}

/** How far back a word's start may be pulled to where its sound began. */
const MAX_BACK_SEC = 0.6
/** A pause before an onset: at least this much quiet. Longer than a stop
 *  consonant's closure (the silent "k" in "gerek yok"), which is not one. */
const ONSET_QUIET_SEC = 0.12

/**
 * Pulls a word's start BACK to its speech onset when its sound began a little
 * before the time it was given: the waveform rises out of a pause shortly
 * before `start` and stays up all the way to it. The other half of
 * `refineWordStartFromAudio` (which moves a start that sits in silence
 * forward). Whisper's phrase-level fallback and the multilingual model's
 * timing often land a word a few tenths late, after its first syllable.
 * Never past `floor` (the previous word's start, so a word cannot take its
 * neighbour's sound), never across a pause, and never more than 0.6 s.
 */
export function pullStartBackToOnset(
  start: number,
  floor: number,
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): number {
  if (!Number.isFinite(start) || audio.length === 0) return start
  const frameSize = Math.max(1, Math.round(FRAME_SEC * sampleRate))
  const at = Math.round((start - audioStart) / FRAME_SEC)
  const totalFrames = Math.floor(audio.length / frameSize)
  if (at <= 0 || at >= totalFrames) return start
  // The speech level from a couple of seconds around (a quiet word in a loud
  // passage is still a word).
  const ctxFrom = Math.max(0, at - 150)
  const ctxTo = Math.min(totalFrames, at + 150)
  const level = (f: number): number => frameRms(audio, f * frameSize, Math.min(audio.length, (f + 1) * frameSize))
  const ctx: number[] = []
  for (let f = ctxFrom; f < ctxTo; f += 2) ctx.push(level(f))
  const speechLevel = percentile(ctx, 0.9)
  if (speechLevel < 0.001) return start
  const quietLevel = Math.max(0.00035, speechLevel * 0.12)
  const activeLevel = Math.max(0.0008, speechLevel * 0.22)
  // The start must be in sound already, or a closure's moment before it
  // (in silence, it is the forward case).
  let sounding = false
  for (let k = 0; k <= 6 && at + k < totalFrames; k++) if (level(at + k) >= activeLevel) sounding = true
  if (!sounding) return start
  const lowest = Math.max(0, Math.ceil((floor - audioStart) / FRAME_SEC) + 1, at - Math.round(MAX_BACK_SEC / FRAME_SEC))
  const quietNeeded = Math.ceil(ONSET_QUIET_SEC / FRAME_SEC)
  // Walk back through the sound (a stop consonant's brief dip is allowed) to
  // where it rose out of a real pause.
  let f = at
  let dip = 0
  while (f > lowest) {
    const v = level(f - 1)
    if (v < quietLevel) {
      dip++
      if (dip >= quietNeeded) break
    } else dip = 0
    f--
  }
  if (dip < quietNeeded) return start // no pause within reach: inside continuous speech
  // The pause ran over frames f-1 … f+dip-2; the sound rose at the next one.
  const onset = f + dip - 1
  // Keep a soft attack: one frame before the rise.
  const refined = audioStart + Math.max(0, onset - 1) * FRAME_SEC
  return start - refined >= MIN_SHIFT_SEC && refined < start ? refined : start
}

/**
 * An ESTIMATED word (Whisper's phrase fallback spreads a phrase's words by
 * their letters) often starts on the tail of the word before and has its own
 * pause inside it. Its start goes to the end of the first real pause (0.12 s
 * or more) in its first 0.6 s, when sound follows it.
 */
export function pushStartPastPause(
  start: number,
  end: number,
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): number {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || audio.length === 0) return start
  const frameSize = Math.max(1, Math.round(FRAME_SEC * sampleRate))
  const totalFrames = Math.floor(audio.length / frameSize)
  const level = (f: number): number => frameRms(audio, f * frameSize, Math.min(audio.length, (f + 1) * frameSize))
  const from = Math.max(0, Math.round((start - audioStart) / FRAME_SEC))
  const to = Math.min(totalFrames - 3, Math.round((Math.min(end - 0.1, start + MAX_BACK_SEC) - audioStart) / FRAME_SEC))
  if (to - from < 15) return start
  const ctx: number[] = []
  for (let f = Math.max(0, from - 150); f < Math.min(totalFrames, from + 150); f += 2) ctx.push(level(f))
  const speechLevel = percentile(ctx, 0.9)
  if (speechLevel < 0.001) return start
  const quietLevel = Math.max(0.00035, speechLevel * 0.12)
  const activeLevel = Math.max(0.0008, speechLevel * 0.22)
  const quietNeeded = Math.ceil(ONSET_QUIET_SEC / FRAME_SEC)
  for (let f = from; f < to; ) {
    if (level(f) >= quietLevel) {
      f++
      continue
    }
    let g = f
    while (g < to + quietNeeded && g < totalFrames - 3 && level(g) < quietLevel) g++
    // Sound must follow (a soft attack may take a few frames to rise).
    let rises = false
    for (let k = g; k < Math.min(totalFrames - 2, g + 8); k++) {
      if (level(k) >= activeLevel && level(k + 1) >= activeLevel && level(k + 2) >= activeLevel) rises = true
    }
    if (g - f >= quietNeeded && rises) {
      const refined = audioStart + Math.max(0, g - 1) * FRAME_SEC
      return refined - start >= MIN_SHIFT_SEC && refined < end - 0.05 ? refined : start
    }
    f = g + 1
  }
  return start
}

/**
 * Every word's start on its speech onset, from the waveform alone (no model,
 * any language): a start sitting in the silence before its word moves forward
 * to where the sound begins, and one that came after its first syllable moves
 * back to it. Cue starts follow (they are their first word's). Words keep
 * their order; a moved start never crosses its neighbours.
 */
export function snapChunkStartsToSpeech(
  words: WordChunk[],
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): WordChunk[] {
  const out: WordChunk[] = []
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const end = word.timestamp[1]
    if (end === null) {
      out.push(word)
      continue
    }
    let start = refineWordStartFromAudio(word.timestamp[0], end, audio, audioStart, sampleRate)
    if (start === word.timestamp[0] && word.estimated) start = pushStartPastPause(start, end, audio, audioStart, sampleRate)
    if (start === word.timestamp[0]) {
      const prev = out[out.length - 1]
      const floor = prev ? prev.timestamp[0] + 0.05 : audioStart
      start = pullStartBackToOnset(start, floor, audio, audioStart, sampleRate)
      // The word before ends where this one now begins.
      if (prev && prev.timestamp[1] !== null && prev.timestamp[1] > start)
        out[out.length - 1] = { ...prev, timestamp: [prev.timestamp[0], Math.max(prev.timestamp[0], start)] }
    }
    out.push({ ...word, timestamp: [Math.min(end, start), end] })
  }
  return out
}

export function refineChunkWordStarts(
  words: WordChunk[],
  audio: Float32Array,
  audioStart: number,
  sampleRate = 16000
): WordChunk[] {
  return words.map((word) => {
    const end = word.timestamp[1]
    if (end === null) return word
    const start = refineWordStartFromAudio(word.timestamp[0], end, audio, audioStart, sampleRate)
    return { ...word, timestamp: [Math.min(end, start), end] }
  })
}
