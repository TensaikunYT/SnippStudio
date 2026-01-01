// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Filler sounds ("ee", "ıı", "um"): found two ways, both pure (SnippStudio
// phase 4A, ANA-PLAN.md 4.6).
//
// 1. In the text: words of a list (Turkish and English sounds; the transcript
//    panel's own list and the same matching it always used).
// 2. In the sound: the recogniser often writes no word at all for "ee", so a
//    short island of speech-level sound that no word's time covers is a
//    candidate too (source "audio"), kept apart from the text's.
import { endsSentence, normalizeWord, type FlatWord } from './words'

/**
 * Words a cleanup pass offers to cut. Only SOUNDS, not words (phase 4A.8,
 * T2): "şey" ("bir şey", "her şey"), "yani", "işte", "like", "ah", "eh" are
 * words as often as they are filler, so they are NOT here — the user can add
 * them if they overuse them. The sounds are matched by shape, whatever their
 * length ("eee", "ıııı", "mmmm", "hımm"): see isFillerSound. This list is
 * what the shapes cover, for the user to read.
 */
export const FILLER_DEFAULT = 'ee,eee,ıı,ııı,aa,mmm,hım,hmm,ııh,ehm,emm,um,uh,uhm'
/** English adds "er" and "erm" (in Turkish "er" is a word: "er ya da geç"). */
export const FILLER_DEFAULT_EN = `${FILLER_DEFAULT},er,erm`
/** The list an English interface shows (cogalt, 23 Nov: no Turkish sound in
 *  an English default). The Turkish sounds are still found by their shape
 *  (isFillerSound): leaving them out of the shown list loses nothing. */
export const FILLER_SHOWN_EN = 'um,uh,uhm,er,erm,hmm,mmm,ee,eee,aa,ehm,emm'

export type FillerLanguage = 'tr' | 'en'

/** Lower case the Turkish way (I → ı, İ → i), punctuation off. */
const soundForm = (w: string): string => w.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase().replace(/[^\p{L}]+/gu, '')

/** Sounds of both languages: ee, eee…, ıı, ııı…, aa…, mmm…, hım, hmm, ııh,
 *  ehm, em, uh, um, uhm. Any length of the held letter. ("mm" alone is a
 *  unit as often as a sound: three or more.) */
const SOUND = 'e{2,}|ı{2,}|i{3,}|a{2,}|m{3,}|h+ı+m+|h+m+|ı+h+|e+h+m+|e{2,}m+|e+m{2,}|u+h+|u+m+|u+h+m+'
const SOUND_TR = new RegExp(`^(?:${SOUND})$`)
/** English also: er, erm. */
const SOUND_EN = new RegExp(`^(?:${SOUND}|e+r+|e+r+m+)$`)

/**
 * Is this word a filler sound (not a word)? Never (phase 4A.9,
 * V-analysis-tools-tests-2): a word with a digit ("35mm") or a full stop
 * inside it ("a.m"), or one all in capitals of two letters or more (a Roman
 * numeral "II", an abbreviation "ER", a unit "MM"). By language: in Turkish
 * "er" is a word; "e", "a", "o" are words in both and are never matched.
 */
export function isFillerSound(w: string, lang: FillerLanguage = 'tr'): boolean {
  // The word without the marks around it ("Eee," "(ııı)" "Hmm…").
  const t = w.trim().replace(/^[("'“‘[]+/, '').replace(/[)"'”’\],.!?;:…]+$/, '')
  if (/\d/.test(t) || t.includes('.')) return false
  const letters = t.replace(/[^\p{L}]+/gu, '')
  if (letters.length >= 2 && letters === letters.toLocaleUpperCase('tr') && letters !== letters.toLocaleLowerCase('tr')) return false
  return (lang === 'en' ? SOUND_EN : SOUND_TR).test(soundForm(t))
}

/** Short words that are surely of one language (for the guess below). */
const TR_WORDS = new Set('ve bir bu da de ile için icin ama çok cok ne mi mı mu mü ben sen biz siz onlar şu gibi daha kadar var yok ya ki her şey sonra şimdi değil degil'.split(' '))
const EN_WORDS = new Set('the and of to is in that it you i we this was for on are with be not have what so but they my at he she there do just'.split(' '))

/** The language the filler sounds are read in: the one the subtitles were
 *  made in when that is known (or the English-only model made them), else
 *  the one most of the words are in (phase 4A.10, D4, analyses#6: not one
 *  Turkish letter in a name, "I met Erdoğan, er, …", nor one missing in a
 *  short Turkish line, "Er ya da gec gelir"). */
export function fillerLanguage(language: string | undefined, text: string, model?: string): FillerLanguage {
  if (language && language !== 'auto') return language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
  if (model === 'english') return 'en'
  let tr = 0
  let en = 0
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    if (!w) continue
    const low = w.replace(/İ/g, 'i').toLowerCase()
    if (/[çğıöşü]/.test(w.replace(/I/g, '').toLowerCase()) || TR_WORDS.has(low)) tr++
    else if (EN_WORDS.has(low)) en++
  }
  return tr > en ? 'tr' : 'en'
}

/** A pause this long after a sound sets it apart from the words after it
 *  (phase 4A.11, N4). */
export const APART_PAUSE = 0.15

/**
 * Why a filler hit is not sure (phase 4A.10, D4: analyses#6, #8; phase
 * 4A.11, N4: a filler is sure only when it stands apart), or null. English
 * "er" / "err" (a verb, a name); a word with a capital inside a sentence of
 * its line ("said Er", a name); a sound said with "!" or "?" ("Aa!", "Ee?",
 * "Hmm?": surprise, a question, meant); in quotes ('He wrote "hmm"'); alone
 * on its line after a question (an answer: "Do you agree?" / "Hmm."); the
 * first word of a sentence that ends with ! or ? ("Aa, ne güzel!", "Ee,
 * sonra ne oldu?"); the sentence going on after it with no comma, "…" or
 * pause of APART_PAUSE ("Um is our new app", "Emm told me", "two aa
 * batteries"). Listed apart: cut only when named.
 */
export function fillerDoubt(words: readonly FlatWord[], i: number, lang: FillerLanguage): string | null {
  const w = words[i].text.trim()
  if (/[!?]/.test(w)) return 'said with ! or ?'
  const form = soundForm(w)
  if (lang === 'en' && !SOUND_TR.test(form) && SOUND_EN.test(form)) return 'er / err is also a word'
  if (/["“”«»„‘’]/.test(w) || /^'|'[,.;:…]*$/.test(w)) return 'in quotes'
  const first = w.replace(/^[^\p{L}]+/u, '')
  // (A line's first word is written with a capital by the recogniser
  // whatever it is: only a capital inside a line counts.)
  if (i > 0 && words[i - 1].captionId === words[i].captionId && !endsSentence(words[i - 1].text) && first && first[0] !== first[0].toLocaleLowerCase(lang)) return 'a capital inside a sentence'
  const line = words.filter((x) => x.captionId === words[i].captionId)
  const prev = words.filter((x) => x.capIdx === words[i].capIdx - 1)
  if (line.every((x) => isFillerSound(x.text, lang)) && prev.length && /\?["'”’)\]]*$/.test(prev[prev.length - 1].text.trim())) return 'alone after a question'
  if (i === 0 || endsSentence(words[i - 1].text)) {
    let k = i
    while (k < words.length - 1 && !endsSentence(words[k].text)) k++
    const end = /([!?])["'”’)\]]*$/.exec(words[k].text.trim())
    if (end) return `opens a sentence ending in ${end[1]}`
  }
  /** Does the sentence stop after word k (a mark, a pause, the end), or does
   *  only another sound follow that stops it? */
  const apart = (k: number): boolean => {
    const x = words[k].text.trim()
    if (/(?:[,;:…]|\.\.\.)["'”’)\]]*$/.test(x) || endsSentence(x) || k === words.length - 1) return true
    if (words[k + 1].start - words[k].end >= APART_PAUSE - 1e-9) return true
    return isFillerSound(words[k + 1].text, lang) && apart(k + 1)
  }
  if (!apart(i)) return 'the sentence goes on'
  return null
}

/** A comma list as the set of words it names (the user's own extra words). */
export function fillerSet(list: string): Set<string> {
  return new Set(list.split(',').map((w) => normalizeWord(w)).filter(Boolean))
}

/** Indices of the filler words in `words`: a sound by its shape, or a word
 *  of `extra` (the user's list). */
export function fillerHits(words: readonly FlatWord[], extra: ReadonlySet<string> = new Set(), lang: FillerLanguage = 'tr'): number[] {
  const out: number[] = []
  words.forEach((w, i) => {
    if (isFillerSound(w.text, lang) || extra.has(normalizeWord(w.text))) out.push(i)
  })
  return out
}

/** The ranges that take those words out: a hair of padding either side (word
 *  boundaries sit right on the sound; cutting exactly there clips the next
 *  word about as often as not). */
export function fillerCutRanges(words: readonly FlatWord[], hits: readonly number[], pad = 0.02): [number, number][] {
  return hits.map((i) => [Math.max(0, words[i].start - pad), words[i].end + pad] as [number, number])
}

export interface IslandOptions {
  /** Shortest and longest island that can be a filler sound (seconds). */
  min?: number
  max?: number
  /** How close to a word's time an island may come and still be "no word". */
  margin?: number
}

/**
 * Short islands of sound that no word covers: speech-level windows
 * (`dbs[i] >= thresholdDb`, window `win` seconds, the first at `offset`)
 * forming a run of `min`–`max` seconds with quiet before and after, that do
 * not overlap any word (each word widened by `margin`).
 */
export function audioIslands(
  dbs: readonly number[],
  win: number,
  offset: number,
  thresholdDb: number,
  words: readonly { start: number; end: number }[],
  opts: IslandOptions = {}
): { start: number; end: number }[] {
  const min = opts.min ?? 0.15
  const max = opts.max ?? 1.2
  // Word times sit on the sound's edge; a tail of the word just before is
  // not a filler (phase 4A.8, T3: 0.05 → 0.12 s).
  const margin = opts.margin ?? 0.12
  const sorted = [...words].sort((a, b) => a.start - b.start)
  const covered = (a: number, b: number): boolean => {
    // Binary search the first word ending after a.
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid].end + margin <= a) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < sorted.length && sorted[i].start - margin < b; i++) {
      if (sorted[i].end + margin > a) return true
    }
    return false
  }
  const out: { start: number; end: number }[] = []
  let run = -1
  const flush = (end: number): void => {
    if (run < 0) return
    const a = offset + run * win
    const b = offset + end * win
    run = -1
    const len = b - a
    if (len < min - 1e-9 || len > max + 1e-9) return
    // Not at the very edges: an island needs quiet on both sides.
    if (a <= offset + 1e-9 || end >= dbs.length) return
    if (!covered(a, b)) out.push({ start: a, end: b })
  }
  for (let i = 0; i < dbs.length; i++) {
    if (dbs[i] >= thresholdDb) {
      if (run < 0) run = i
    } else flush(i)
  }
  flush(dbs.length)
  return out
}
