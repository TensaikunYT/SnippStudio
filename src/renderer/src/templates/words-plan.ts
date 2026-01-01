// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Big words' timing, apart from their drawing: which pieces of the narration
// come up when, for each style — shared by the drawing and by the click each
// piece lands with.

import { wordsPhrases, type TimedWord } from './model'
import type { Project, TemplateBlock } from '../types'

export type WordsDesign = 'apple' | 'stack' | 'punch' | 'karaoke'
export const wordsDesign = (b: Pick<TemplateBlock, 'design'>): WordsDesign =>
  b.design === 'stack' || b.design === 'punch' || b.design === 'karaoke' ? b.design : 'apple'

/** A style's own settings (what each left-out one is). */
export function wordsDefaults(design: WordsDesign, portrait: boolean): { per: number; dim: number; y: number } {
  switch (design) {
    case 'stack':
      return { per: 3, dim: 0.52, y: portrait ? 0.62 : 0.66 }
    case 'karaoke':
      return { per: portrait ? 4 : 6, dim: 0.36, y: 0.56 }
    case 'punch':
      return { per: 1, dim: 0, y: 0.5 }
    default:
      return { per: portrait ? 4 : 6, dim: 0, y: 0.5 }
  }
}

/** Words grouped into pieces of at most `most` words (split evenly). */
function chunks(words: TimedWord[], most: number): TimedWord[][] {
  if (words.length <= most) return [words]
  const n = Math.ceil(words.length / most)
  const per = Math.ceil(words.length / n)
  const out: TimedWord[][] = []
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per))
  return out
}

export interface Piece {
  words: TimedWord[]
  t0: number
  t1: number
}

export function pieces(phrases: TimedWord[][], most: number): Piece[] {
  const out: Piece[] = []
  for (const p of phrases) {
    for (const ch of chunks(p, most)) out.push({ words: ch, t0: ch[0].t0, t1: ch[ch.length - 1].t1 })
  }
  // Each ends where the next begins (or a little after its last word).
  out.forEach((p, i) => (p.t1 = i + 1 < out.length ? Math.max(p.t1, out[i + 1].t0) : p.t1 + 0.6))
  return out
}

/** Punch: one word at a time; a little word rides with the next. */
export function punchWords(phrases: TimedWord[][]): TimedWord[] {
  const flat: TimedWord[] = []
  for (const phrase of phrases) {
    const ph = phrase.map((w) => ({ ...w }))
    for (let i = 0; i < ph.length; i++) {
      const w = ph[i]
      if ([...w.text].length <= 2 && i + 1 < ph.length) {
        ph[i + 1] = { ...ph[i + 1], text: `${w.text} ${ph[i + 1].text}`, t0: w.t0 }
        continue
      }
      flat.push(w)
    }
  }
  return flat
}

/** When each piece comes up (block seconds): where its click goes. */
export function wordsBeats(p: Pick<Project, 'captions'>, b: TemplateBlock, portrait: boolean): number[] {
  const phrases = wordsPhrases(p, b)
  if (!phrases.length) return []
  const design = wordsDesign(b)
  if (design === 'punch') return punchWords(phrases).map((w) => w.t0)
  return pieces(phrases, b.big?.per ?? wordsDefaults(design, portrait).per).map((q) => q.t0)
}
