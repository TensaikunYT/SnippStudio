// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Caption } from '../types'
import { uid } from '../types'

export interface WordChunk {
  text: string
  timestamp: [number, number | null]
  /** True when estimated from phrase timestamps after token alignment failed. */
  estimated?: boolean
}

/** Stored in CaptionStyle.wordsPerCue to request punctuation-delimited cues. */
export const FULL_SENTENCE_WORDS_PER_CUE = -1
/** Stored in CaptionStyle.wordsPerCue to keep punctuation/length grouping but
 * also begin a new cue after a genuine pause in Whisper's word timings. */
export const PAUSE_AWARE_WORDS_PER_CUE = -2

/** Full-sentence mode remains punctuation-aware, but must not turn a long
 * sentence into a paragraph-sized cue. Ten is the readability target; short
 * words may use a little more room, while fourteen is the absolute ceiling. */
export const FULL_SENTENCE_SOFT_WORD_LIMIT = 10
export const FULL_SENTENCE_HARD_WORD_LIMIT = 14

/** The shortest cue grouping leaves on screen when it has to shorten one to
 *  stop it overlapping the next: a shorter one joins the next cue. */
const MIN_CUE_SECONDS = 0.12

/** Whisper normally attaches punctuation to the preceding word. Include the
 * punctuation used by the languages its multilingual models support, and
 * allow a closing quote/bracket after it. */
function endsSentence(word: string): boolean {
  return /[.!?…。！？؟](?:["'”’»›)\]}]+)?$/u.test(word)
}

/** Full-sentence display can still become far too wide before the period.
 * Treat commas as readable clause boundaries in that explicit mode only. */
function endsSentenceOrComma(word: string): boolean {
  return endsSentence(word) || /[,，](?:["'”’»›)\]}]+)?$/u.test(word)
}

/** Some Whisper tokenizers return punctuation as its own timed chunk. */
function appendWord(text: string, word: string): string {
  if (!text) return word
  return /^[,.;:!?…、。，！？؛؟%‰”’»›)\]}]/u.test(word)
    ? `${text}${word}`
    : `${text} ${word}`
}

function isStandalonePunctuation(word: string): boolean {
  return /^[,.;:!?…、。，！？؛؟%‰”’»›)\]}]+$/u.test(word)
}

/** A suffix after an apostrophe — Turkish writes "B'nin", "Türkiye'de", and
 *  the multilingual model returns "'nin" as a word of its own. It belongs to
 *  the word before, with no space and never on the next line. */
function isApostropheSuffix(word: string): boolean {
  return /^['’]\p{L}/u.test(word)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** A fast narrator naturally leaves shorter gaps than a slow narrator. Base
 * Auto on normal word duration, while keeping it far enough above ordinary
 * between-word spacing that it reacts to pauses rather than cadence. */
function autoPauseThreshold(words: WordChunk[]): number {
  const durations = words
    .map(({ timestamp: [start, end] }) => (end !== null ? end - start : 0))
    .filter((duration) => Number.isFinite(duration) && duration >= 0.06 && duration <= 1.2)
  const typicalWord = median(durations) || 0.24
  return Math.min(0.75, Math.max(0.4, typicalWord * 1.8))
}

/** A light-weight approximation of rendered width in average glyph units.
 * It is intentionally font-independent: CaptionStyle.maxLineChars already
 * expresses the user's desired line width, while this keeps ten short words
 * from being treated like ten long ones. */
function visualTextUnits(text: string): number {
  let units = 0
  for (const char of text) {
    if (/\s/u.test(char)) units += 0.35
    else if (/[ilI1|!.,'’`]/u.test(char)) units += 0.45
    else if (/[mwMW@%&]/u.test(char)) units += 1.3
    else if (/[^\u0000-\u024f]/u.test(char)) units += 1.55
    else units += 0.9
  }
  return units
}

function spokenWordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

function fullSentenceTooLong(text: string, maxChars: number): boolean {
  const count = spokenWordCount(text)
  const width = visualTextUnits(text)
  const lineWidth = Math.max(10, maxChars)
  return (
    count >= FULL_SENTENCE_HARD_WORD_LIMIT ||
    (count >= FULL_SENTENCE_SOFT_WORD_LIMIT && width >= lineWidth) ||
    // A few unusually long words can fill two lines before reaching ten.
    (count >= 6 && width >= lineWidth * 1.8)
  )
}

/**
 * Groups Whisper word-level chunks into readable caption lines: a new caption
 * starts when the current one is long enough, has run too long, or a clear
 * pause occurs — and always on sentence-ending punctuation.
 */
export function groupWordsIntoCaptions(
  words: WordChunk[],
  opts: {
    maxChars?: number
    maxDuration?: number
    maxGap?: number
    wordsPerCue?: number
    /** Pause-aware only: 0/undefined = adapt to speech rate; otherwise seconds. */
    pauseThreshold?: number
  } = {}
): Caption[] {
  const maxChars = opts.maxChars ?? 42
  const maxDuration = opts.maxDuration ?? 5
  const maxGap = opts.maxGap ?? 0.7
  /** Fixed word count per cue (0 = automatic, -1 = full sentence,
   * -2 = sentence/clause grouping that also respects speech pauses). */
  const fullSentence = opts.wordsPerCue === FULL_SENTENCE_WORDS_PER_CUE
  const pauseAware = opts.wordsPerCue === PAUSE_AWARE_WORDS_PER_CUE
  const punctuationMode = fullSentence || pauseAware
  const pauseThreshold = opts.pauseThreshold && opts.pauseThreshold > 0
    ? Math.min(1.5, Math.max(0.2, opts.pauseThreshold))
    : autoPauseThreshold(words)
  const wordsPerCue = opts.wordsPerCue && opts.wordsPerCue > 0 ? Math.round(opts.wordsPerCue) : 0

  const captions: Caption[] = []
  let text = ''
  let start = 0
  let end = 0
  let lineWords: { text: string; start: number; end: number }[] = []

  const flush = () => {
    const trimmed = text.trim()
    if (trimmed) {
      captions.push({
        id: uid(),
        start,
        end: Math.max(end, start + 0.3),
        text: trimmed,
        words: lineWords
      })
    }
    text = ''
    lineWords = []
  }

  for (const word of words) {
    const w = word.text.trim()
    if (!w) continue
    const [wsRaw, weRaw] = word.timestamp
    // A corrupt worker response must not put NaN/Infinity on the timeline.
    if (!Number.isFinite(wsRaw)) continue
    const ws = Math.max(0, wsRaw)
    const we = weRaw !== null && Number.isFinite(weRaw) && weRaw > ws ? weRaw : ws + 0.3

    const cueFull = wordsPerCue > 0
      ? lineWords.length >= wordsPerCue
      : !punctuationMode && (text.length + w.length + 1 > maxChars || we - start > maxDuration)
    // A standalone punctuation token belongs to the word before it even when
    // its worker timestamp is imperfect. Never create punctuation-only cues.
    const attaches = (isStandalonePunctuation(w) || isApostropheSuffix(w)) && lineWords.length > 0
    const pauseBreak = pauseAware && !isStandalonePunctuation(w) && ws - end >= pauseThreshold
    // Full-sentence mode deliberately ignores pauses and size limits: a slow
    // speaker's sentence must not be split merely because one phrase lasted
    // longer than the automatic readability limits.
    if (!attaches && text && ((pauseAware && pauseBreak) || (!punctuationMode && ws - end > maxGap) || cueFull)) {
      flush()
    }
    if (!text) start = ws
    text = attaches && isApostropheSuffix(w) ? `${text}${w}` : appendWord(text, w)
    if (attaches) {
      const previous = lineWords[lineWords.length - 1]
      previous.text += w
      previous.end = Math.max(previous.end, we)
    } else {
      lineWords.push({ text: w, start: ws, end: we, ...(word.estimated ? { estimated: true } : {}) })
    }
    end = we
    if (punctuationMode && (endsSentenceOrComma(w) || fullSentenceTooLong(text, maxChars))) flush()
    else if (wordsPerCue === 0 && endsSentence(w) && text.length > maxChars * 0.5) flush()
  }
  flush()
  // Never let cues overlap: the 0.3s minimum-duration floor can push a cue's
  // end past the next cue's start (very visible with 1 word per cue).
  // Walked from the end, so a cue merged into the next is compared again
  // with the one before it.
  for (let i = captions.length - 2; i >= 0; i--) {
    const left = captions[i]
    const right = captions[i + 1]
    if (left.end <= right.start) continue
    if (right.start - left.start < MIN_CUE_SECONDS) {
      // Whisper often gives two words the same start. Shortening the left
      // cue would leave it (almost) no time at all: never drawn, and dropped
      // from the SRT and the image automation, so the word vanished. It
      // joins the next cue instead.
      right.start = Math.min(left.start, right.start)
      right.end = Math.max(left.end, right.end)
      right.text = appendWord(left.text, right.text)
      right.words = [...(left.words ?? []), ...(right.words ?? [])]
      captions.splice(i, 1)
    } else {
      // The incoming/right cue owns the boundary. Its first word must remain
      // at its actual Whisper start; only shorten the cue on the left.
      left.end = Math.max(left.start, right.start)
    }
  }
  return captions
}
