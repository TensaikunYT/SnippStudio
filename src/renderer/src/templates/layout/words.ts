// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Big words: the subtitles under the block, word by word, as phrases.
// Moved out of templates/model.ts in SnippStudio phase 2B (no change).
import { type Caption, type Project, type TemplateBlock } from '../../types'

// -- big words ------------------------------------------------------------------------

/** A word and when it is said (block seconds). */
export interface TimedWord {
  text: string
  t0: number
  t1: number
}

/** The subtitle lines (not text layers or shapes) a big-words block covers. */
export function wordsCaptions(p: Pick<Project, 'captions'>, b: Pick<TemplateBlock, 'start' | 'duration'>): Caption[] {
  return p.captions.filter((c) => !c.shape && (c.layer ?? 0) === 0 && c.end > b.start && c.start < b.start + b.duration)
}

/** Does this block use the subtitles (rather than its own lines)? */
export const wordsFromSubs = (p: Pick<Project, 'captions'>, b: TemplateBlock): boolean => b.kind === 'words' && !b.own && wordsCaptions(p, b).length > 0

export const wordsCache = new WeakMap<object, Map<string, TimedWord[][]>>()
/**
 * What a big-words block says, phrase by phrase, each word with its time:
 * the subtitles in its span (their word timings, or spread over the line by
 * length), or its own lines spread evenly over it. Upper case the way the
 * language writes it (Turkish i → İ).
 */
export function wordsPhrases(p: Pick<Project, 'captions'>, b: TemplateBlock): TimedWord[][] {
  const key = JSON.stringify([b.start, b.duration, b.own ?? false, b.items.map((it) => it.title)])
  let per = wordsCache.get(p.captions)
  if (!per) {
    per = new Map()
    wordsCache.set(p.captions, per)
  }
  const hit = per.get(key)
  if (hit) return hit
  const spread = (text: string, a: number, z: number): TimedWord[] => {
    const parts = text.split(/\s+/).filter(Boolean)
    const total = parts.reduce((n, q) => n + q.length + 1, 0) || 1
    let acc = 0
    return parts.map((q) => {
      const t0 = a + ((z - a) * acc) / total
      acc += q.length + 1
      return { text: q, t0, t1: a + ((z - a) * acc) / total }
    })
  }
  let out: TimedWord[][] = []
  const subs = b.own ? [] : wordsCaptions(p, b)
  if (subs.length) {
    for (const c of [...subs].sort((x, y) => x.start - y.start)) {
      const words = c.words?.length ? c.words.map((w) => ({ text: w.text.trim(), t0: w.start, t1: w.end })).filter((w) => w.text) : spread(c.text, c.start, c.end)
      const inside = words.map((w) => ({ ...w, t0: w.t0 - b.start, t1: w.t1 - b.start })).filter((w) => w.t0 >= -0.05 && w.t0 < b.duration)
      if (inside.length) out.push(inside)
    }
  } else {
    const lines = b.items.map((it) => it.title.trim()).filter(Boolean)
    const slot = b.duration / Math.max(1, lines.length)
    out = lines.map((ln, i) => spread(ln, i * slot + 0.15, i * slot + 0.15 + slot * 0.7))
  }
  const all = out.flat().map((w) => w.text).join(' ')
  const turkish = /[çğıöşüÇĞİÖŞÜ]/.test(all)
  out = out.map((ph) => ph.map((w) => ({ ...w, text: turkish ? w.text.toLocaleUpperCase('tr') : w.text.toUpperCase() })))
  per.set(key, out)
  return out
}
