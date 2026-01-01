// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the transcript panel shows beside the words (çekirdek cila S, 8–11):
// the pauses between them as tokens that can be selected and cut, a
// selection over words and pauses as a time range, and the agent's filler
// and repeat findings as rows to tick. Pure: the panel and its tests.
import { keptPause } from '../audio/silence'
import type { Item } from '../agent/answers'
import { fillerDoubt, type FillerLanguage } from './fillers'
import type { RepeatFinding } from './repeats'
import { guessedTime, type FlatWord } from './words'

/** A gap between two words at least this long is shown as a pause token. */
export const PAUSE_MIN = 0.6
/** What the silence cut keeps around speech (the window's default). */
const PAD = 0.11

export interface PauseToken {
  /** The word (index in the flat list) it comes after. */
  after: number
  /** From that word's end to the next word's start. */
  start: number
  end: number
  gap: number
  /** What deleting it cuts: the pause down to a natural breath, by the
   *  silence cut's own rule (audio/silence.ts keptPause). */
  cut: [number, number]
}

/** The pauses between the words, by the index of the word before each. */
export function pauseTokens(words: readonly FlatWord[]): Map<number, PauseToken> {
  const out = new Map<number, PauseToken>()
  for (let i = 0; i + 1 < words.length; i++) {
    const start = words[i].end
    const end = words[i + 1].start
    const gap = end - start
    if (gap < PAUSE_MIN - 1e-9) continue
    const keep = keptPause(gap, PAD, 'natural')
    const cut: [number, number] = [start + keep * 0.55, end - keep * 0.45]
    if (cut[1] - cut[0] < 0.06) continue
    out.set(i, { after: i, start, end, gap, cut })
  }
  return out
}

// A selection runs over "slots": word i is slot 2i, the pause after it 2i+1.
export const wordSlot = (i: number): number => 2 * i
export const pauseSlot = (after: number): number => 2 * after + 1

export interface SlotRange {
  /** The time the selection covers (what Delete cuts). */
  start: number
  end: number
  words: number
  pauses: number
  /** The first and last word inside it (-1: it holds no word). */
  firstWord: number
  lastWord: number
}

/** A selection of slots [a, b] as a time range: from the first slot's start
 *  to the last one's end; a pause at either end gives its cut (a breath
 *  stays), a pause inside goes whole with the words around it. */
export function slotRange(words: readonly FlatWord[], pauses: ReadonlyMap<number, PauseToken>, sel: readonly [number, number]): SlotRange | null {
  // The slots there really are (a pause slot exists only when it has a token).
  const real = (s: number): boolean => (s % 2 === 0 ? !!words[s / 2] : pauses.has((s - 1) / 2))
  let a = Math.min(sel[0], sel[1])
  let b = Math.max(sel[0], sel[1])
  while (a <= b && !real(a)) a++
  while (b >= a && !real(b)) b--
  if (a > b) return null
  const start = a % 2 === 0 ? words[a / 2].start : pauses.get((a - 1) / 2)!.cut[0]
  const end = b % 2 === 0 ? words[b / 2].end : pauses.get((b - 1) / 2)!.cut[1]
  let nWords = 0
  let nPauses = 0
  let firstWord = -1
  let lastWord = -1
  for (let s = a; s <= b; s++) {
    if (!real(s)) continue
    if (s % 2 === 0) {
      nWords++
      if (firstWord < 0) firstWord = s / 2
      lastWord = s / 2
    } else nPauses++
  }
  return { start, end: Math.max(end, start + 0.05), words: nWords, pauses: nPauses, firstWord, lastWord }
}

/** Why a finding is not ticked by itself (a key of the panel's words). */
export type ReviewWhy = 'mark' | 'word' | 'quotes' | 'capital' | 'answer' | 'opens' | 'goesOn' | 'guessed' | 'island' | 'repeat'

export interface ReviewRow {
  id: string
  kind: 'filler' | 'repeat'
  /** What ticking it cuts, and what "play" plays (the same stretch). */
  cut: [number, number]
  /** Sure findings come ticked; the others are listed, not ticked. */
  sure: boolean
  why?: ReviewWhy
  /** For a repeat: the finder's own reasons, as it wrote them. */
  detail?: string
  /** The words shown: before, the thing itself, after. */
  before: string
  text: string
  after: string
}

const whyOf = (doubt: string): ReviewWhy =>
  doubt.startsWith('said with') ? 'mark'
    : doubt.includes('also a word') ? 'word'
      : doubt === 'in quotes' ? 'quotes'
        : doubt.startsWith('a capital') ? 'capital'
          : doubt.startsWith('alone after') ? 'answer'
            : doubt.startsWith('opens') ? 'opens'
              : 'goesOn'

const around = (words: readonly FlatWord[], from: number, to: number, n = 3): { before: string; after: string } => ({
  before: words.slice(Math.max(0, from - n), from).map((w) => w.text).join(' '),
  after: words.slice(to + 1, to + 1 + n).map((w) => w.text).join(' ')
})

/**
 * The agent's `analyze fillers` items as rows (the same finder: the sounds by
 * their shape and the language, the user's extra words, the doubt of each,
 * the sounds no word covers). `extra`: the user's own words (never doubted).
 */
export function fillerRows(items: readonly Item[], words: readonly FlatWord[], lang: FillerLanguage, extra: ReadonlySet<string>, normalize: (w: string) => string): ReviewRow[] {
  const rows: ReviewRow[] = []
  items.forEach((it, k) => {
    if (!it.cut || !it.range) return
    const island = (it.data as { source?: string } | undefined)?.source === 'audio'
    if (island) {
      // The words on either side of the sound.
      let next = words.findIndex((w) => w.start >= it.range![1] - 1e-6)
      if (next < 0) next = words.length
      rows.push({ id: `f${k}`, kind: 'filler', cut: it.cut, sure: false, why: 'island', text: '', before: words.slice(Math.max(0, next - 3), next).map((w) => w.text).join(' '), after: words.slice(next, next + 3).map((w) => w.text).join(' ') })
      return
    }
    const wi = words.findIndex((w) => Math.abs(w.start - it.range![0]) < 1e-6 && Math.abs(w.end - it.range![1]) < 1e-6)
    if (wi < 0) return
    const w = words[wi]
    const doubt = guessedTime(w) ? 'guessed' : extra.has(normalize(w.text)) ? null : fillerDoubt(words, wi, lang)
    rows.push({ id: `f${k}`, kind: 'filler', cut: it.cut, sure: !it.uncertain, ...(doubt ? { why: doubt === 'guessed' ? ('guessed' as const) : whyOf(doubt) } : {}), text: w.text, ...around(words, wi, wi) })
  })
  return rows.sort((a, b) => a.cut[0] - b.cut[0])
}

/** The agent's `analyze repeats` items as rows: the take that is dropped
 *  (the earlier one), and for speech with no words written, that stretch. */
export function repeatRows(items: readonly Item[], words: readonly FlatWord[]): ReviewRow[] {
  const rows: ReviewRow[] = []
  items.forEach((it, k) => {
    if (!it.cut) return
    const f = it.data as Partial<RepeatFinding> & { sentenceWords?: [number, number] }
    if (f.firstWords && f.secondWords) {
      const [a, b] = f.drop === 'second' ? f.secondWords : f.firstWords
      rows.push({ id: `r${k}`, kind: 'repeat', cut: it.cut, sure: !it.uncertain, ...(it.uncertain ? { why: 'repeat' as const, detail: (f.why ?? []).join(', ') } : {}), text: words.slice(a, b + 1).map((w) => w.text).join(' '), ...around(words, a, b, 2) })
    } else if (f.sentenceWords) {
      // Speech with no words after a written sentence: that sentence is shown.
      const [a, b] = f.sentenceWords
      rows.push({ id: `r${k}`, kind: 'repeat', cut: it.cut, sure: false, why: 'island', text: '', before: words.slice(a, b + 1).map((w) => w.text).join(' '), after: '' })
    }
  })
  return rows.sort((a, b) => a.cut[0] - b.cut[0])
}
