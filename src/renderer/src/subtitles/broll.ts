// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Automatic B-roll: a picture or a clip from your media goes up where the
// narration says what it shows. Its words come from its file name (or your
// own), matched against the subtitles' words — Turkish letters folded, the
// suffix after an apostrophe dropped, a word's endings allowed ("İstanbul'da",
// "istanbulda" and "istanbul" all find istanbul.jpg). Everything is local.

import type { Asset, Caption } from '../types'

export interface BrollPlacement {
  assetId: string
  start: number
  end: number
  /** The words that found it, as said. */
  said: string
  captionId: string
}

/** Lower case, Turkish letters folded to plain ones, only letters and digits. */
export function foldWord(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[’'`´].*$/u, '')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a')
    .replace(/[îì]/g, 'i')
    .replace(/[ûù]/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const STOP = new Set(
  (
    'the a an of and or in on at to for with from by is are was this that these those my your our ' +
    'img image images photo photos pic pics picture pictures final copy edit edited new old stock broll hd uhd raw ' +
    'screenshot screen shot scan export render frame thumbnail thumb version draft ' +
    've ile bir bu su o da de ki icin gibi cok en resim resmi foto fotograf fotografi gorsel gorseli kopya yeni eski son'
  ).split(' ')
)

/** The words a file name gives: its parts, without numbers, sizes and
 *  filler ("01 - İstanbul boğazı (final).jpg" → istanbul, bogazi). */
export function assetKeywords(name: string): string[] {
  const base = name.replace(/\.[a-z0-9]{2,5}$/i, '')
  const out: string[] = []
  for (const part of base.split(/[^\p{L}\p{N}’']+/u)) {
    const w = foldWord(part)
    if (w.length < 3 || /\d/.test(w) || STOP.has(w)) continue
    if (!out.includes(w)) out.push(w)
  }
  return out
}

/** Does a spoken word say this keyword? Whole, or with its endings. */
export function saysKeyword(spoken: string, key: string): boolean {
  if (!spoken || !key) return false
  if (spoken === key) return true
  // Endings on a word ("istanbuldan"), and a keyword written with them
  // ("bogazi" for "bogaz") — never for short words.
  if (key.length >= 4 && spoken.startsWith(key) && spoken.length - key.length <= 5) return true
  if (spoken.length >= 5 && key.startsWith(spoken) && key.length - spoken.length <= 2) return true
  return false
}

interface Word {
  w: string
  raw: string
  start: number
  end: number
  captionId: string
  capEnd: number
}

/** Every spoken word with its time: Whisper's own, or spread over its line
 *  by length when a line has none. */
export function spokenWords(captions: Caption[]): Word[] {
  const out: Word[] = []
  for (const c of [...captions].sort((a, b) => a.start - b.start)) {
    if (c.shape || (c.layer ?? 0) !== 0) continue
    if (c.words?.length) {
      for (const w of c.words) {
        const f = foldWord(w.text)
        if (f) out.push({ w: f, raw: w.text.trim(), start: w.start, end: w.end, captionId: c.id, capEnd: c.end })
      }
      continue
    }
    const parts = c.text.split(/\s+/).filter(Boolean)
    const total = parts.reduce((n, p) => n + p.length + 1, 0) || 1
    let acc = 0
    for (const p of parts) {
      const a = c.start + ((c.end - c.start) * acc) / total
      acc += p.length + 1
      const b = c.start + ((c.end - c.start) * acc) / total
      const f = foldWord(p)
      if (f) out.push({ w: f, raw: p, start: a, end: b, captionId: c.id, capEnd: c.end })
    }
  }
  return out
}

/**
 * Where each picture goes: the first time the narration says its words (a
 * name of one or two words: all of them, or one that says something; a
 * longer name: two of them, near each other), from just before the word for
 * a few seconds or to the end of its line. Each is used once, and they never overlap — a later one waits
 * for the one before or is left out.
 */
export function planBroll(
  captions: Caption[],
  assets: Pick<Asset, 'id' | 'name' | 'kind' | 'duration'>[],
  opts: { keywords?: Record<string, string[]>; min?: number; max?: number; lead?: number } = {}
): { placements: BrollPlacement[]; unmatched: string[]; crowded: string[] } {
  const words = spokenWords(captions)
  const min = opts.min ?? 2
  const max = opts.max ?? 4.5
  const lead = opts.lead ?? 0.2
  const hits: (BrollPlacement & { at: number })[] = []
  const unmatched: string[] = []
  for (const a of assets) {
    const keys = (opts.keywords?.[a.id] ?? assetKeywords(a.name)).map(foldWord).filter((k) => k.length >= 2)
    if (!keys.length) {
      unmatched.push(a.id)
      continue
    }
    // One word of a short name is enough when it says something (five
    // letters or more); a longer name needs two of its words.
    let found: (BrollPlacement & { at: number }) | null = null
    for (let i = 0; i < words.length && !found; i++) {
      if (!keys.some((k) => saysKeyword(words[i].w, k))) continue
      // The rest of its words close by (within the next few words).
      const window = words.slice(Math.max(0, i - 3), i + 5)
      const got = keys.filter((k) => window.some((w) => saysKeyword(w.w, k)))
      const enough = keys.length <= 2 ? got.length === keys.length || got.some((k) => k.length >= 5) : got.length >= 2
      if (!enough) continue
      const first = window.find((w) => keys.some((k) => saysKeyword(w.w, k)))!
      const last = [...window].reverse().find((w) => keys.some((k) => saysKeyword(w.w, k)))!
      const start = Math.max(0, first.start - lead)
      let end = Math.max(last.end + 2.2, first.capEnd)
      end = Math.min(start + max, Math.max(start + min, end))
      if (a.kind === 'video' && a.duration > 0) end = Math.min(end, start + a.duration)
      const said = window
        .filter((w) => w.start >= first.start && w.start <= last.start)
        .map((w) => w.raw)
        .join(' ')
      found = { assetId: a.id, start, end, said, captionId: first.captionId, at: first.start }
    }
    if (found) hits.push(found)
    else unmatched.push(a.id)
  }
  // In order, never on top of each other.
  hits.sort((p, q) => p.at - q.at)
  const placements: BrollPlacement[] = []
  const crowded: string[] = []
  for (const h of hits) {
    const prev = placements[placements.length - 1]
    let { start, end } = h
    if (prev && start < prev.end + 0.05) {
      const len = end - start
      start = prev.end + 0.05
      end = start + len
      // Too late to still belong to what is being said: left out.
      if (start - h.at > 1.6) {
        crowded.push(h.assetId)
        continue
      }
    }
    placements.push({ assetId: h.assetId, start, end, said: h.said, captionId: h.captionId })
  }
  return { placements, unmatched, crowded }
}
