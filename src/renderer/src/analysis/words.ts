// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of the subtitles as one flat list, in time order: what the
// transcript panel shows and what the local finders (fillers, repeats) read.
// Pure (SnippStudio phase 4A; the flattening lived in TranscriptPanel.tsx).
import type { Caption } from '../types'

export interface FlatWord {
  text: string
  start: number
  end: number
  /** Index of the caption (in time order) this word belongs to. */
  capIdx: number
  /** The caption's id: a word's lasting address is (captionId, wordIdx). */
  captionId: string
  /** The word's place in its caption's own word list; -1 when the caption
   *  has no word times and the word was spread over the line evenly. */
  wordIdx: number
  /** The word's times were estimated (a phrase's times spread over its
   *  words, a line the user retyped): not measured (phase 4A.11, N2). */
  estimated?: boolean
}

/** Are the word's seconds a guess (no word times in its line, or estimated
 *  ones)? Phase 4A.11, N2: an estimated time is not a measured one. */
export const guessedTime = (w: FlatWord): boolean => w.wordIdx < 0 || !!w.estimated

/**
 * Every word of `captions` (sorted by start). A line without word times is
 * split on spaces and its words spread evenly over the line.
 */
export function flattenWords(captions: readonly Caption[]): FlatWord[] {
  const sorted = [...captions].sort((x, y) => x.start - y.start)
  const out: FlatWord[] = []
  sorted.forEach((c, ci) => {
    if (c.words && c.words.length > 0) {
      c.words.forEach((w, wi) => out.push({ text: w.text.trim(), start: w.start, end: w.end, capIdx: ci, captionId: c.id, wordIdx: wi, ...(w.estimated ? { estimated: true } : {}) }))
    } else {
      const parts = c.text.trim().split(/\s+/)
      parts.forEach((t, i) =>
        out.push({
          text: t,
          start: c.start + ((c.end - c.start) * i) / Math.max(1, parts.length),
          end: c.start + ((c.end - c.start) * (i + 1)) / Math.max(1, parts.length),
          capIdx: ci,
          captionId: c.id,
          wordIdx: -1
        })
      )
    }
  })
  return out.filter((w) => w.text)
}

/** Strips punctuation and case so "ee," matches "ee". */
export const normalizeWord = (w: string): string =>
  w
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’()[\]…]/g, '')
    .trim()

/** Words compared across two takes: lower case (Turkish dotted / dotless I
 *  folded to one i), no punctuation, no accents (ş → s, ü → u…), so the same
 *  sentence said twice and recognised a little differently still matches. */
export function foldWord(w: string): string {
  return w
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** A word as it is written, for the SURE retake (phase 4A.11, N1): lower
 *  case the Turkish way (I → ı, İ → i), punctuation off, and nothing else —
 *  accents and ı / i are NOT folded ("oldu" / "öldü", "sınır" / "sinir",
 *  "kar" / "kâr" are other words). */
export function exactWord(w: string): string {
  return w.normalize('NFC').toLocaleLowerCase('tr').replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
}

/** A word that ends a sentence ("done." "really?" "so…"). */
export const endsSentence = (w: string): boolean => /[.!?…]["'”’)\]]*$/.test(w.trim())
