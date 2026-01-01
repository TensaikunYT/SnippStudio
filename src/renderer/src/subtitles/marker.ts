// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { CaptionStyle } from '../types'

type Marker = NonNullable<CaptionStyle['marker']>

function tokens(text: string): Array<{ text: string; start: number; end: number }> {
  return [...text.matchAll(/\S+/gu)].map((match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length
  }))
}

/** A selection marks the words it intersects; a caret marks the word under
 * it (or the nearest one when it sits in a gap). */
export function wordIndicesAtSelection(text: string, from: number, to: number): number[] {
  const words = tokens(text)
  if (!words.length) return []
  const start = Math.max(0, Math.min(text.length, Math.min(from, to)))
  const end = Math.max(0, Math.min(text.length, Math.max(from, to)))
  if (end > start) {
    const hits = words.flatMap((word, index) => word.start < end && word.end > start ? [index] : [])
    if (hits.length) return hits
  }
  const underCaret = words.findIndex((word) => word.start <= start && start < word.end)
  if (underCaret >= 0) return [underCaret]
  let nearest = 0
  let distance = Infinity
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    const gap = start < word.start ? word.start - start : start > word.end ? start - word.end : 0
    if (gap <= distance) { distance = gap; nearest = index }
  }
  return [nearest]
}

export function markerCoversWord(marker: Marker | undefined, index: number): boolean {
  return !!marker?.enabled && (marker.words?.length ? marker.words.includes(index) : index === 0)
}

/** Keep the visual sweep inside the cue, including a very short final word.
 * This reads timestamps but never edits or redistributes them. */
export function markerRevealProgress(time: number, wordStart: number, cueEnd: number, duration: number): number {
  const onset = Math.min(wordStart, cueEnd - 0.08)
  const available = Math.max(0.02, cueEnd - onset)
  const sweep = Math.max(0.02, Math.min(Math.max(0.05, duration), available * 0.7))
  const progress = Math.min(1, Math.max(0, (time - onset) / sweep))
  // A pen stroke: it lands moving and eases to a stop.
  return 1 - (1 - progress) ** 2.6
}

/** Clicking Marker again removes just the selected word(s), not other marks. */
export function toggleMarkedWords(marker: Marker | undefined, selected: number[]): Marker {
  const existing = marker?.enabled ? (marker.words?.length ? marker.words : [0]) : []
  const remove = selected.every((index) => existing.includes(index))
  const words = remove
    ? existing.filter((index) => !selected.includes(index))
    : [...new Set([...existing, ...selected])].sort((a, b) => a - b)
  return { enabled: words.length > 0, color: marker?.color ?? '#f1ef00', duration: marker?.duration ?? 0.48, words }
}

/** Preserve the selected word through nearby text insertions/deletions when
 * possible; a rewritten word falls back to its local position. */
export function remapMarkedWords(oldText: string, newText: string, marked: number[]): number[] {
  const before = tokens(oldText)
  const after = tokens(newText)
  if (!after.length) return []
  const used = new Set<number>()
  return [...new Set(marked)].map((index) => {
    const old = before[index]?.text.toLocaleLowerCase()
    let best = Math.min(index, after.length - 1)
    let score = Infinity
    if (old) {
      after.forEach((word, candidate) => {
        if (used.has(candidate) || word.text.toLocaleLowerCase() !== old) return
        const cost = Math.abs(candidate - index)
        if (cost < score) { score = cost; best = candidate }
      })
    }
    used.add(best)
    return best
  }).sort((a, b) => a - b)
}

/** Splitting a subtitle keeps each band's target on its original side. */
export function splitMarkerAtWordIndex(marker: Marker | undefined, leftWordCount: number): [Marker | undefined, Marker | undefined] {
  if (!marker?.enabled) return [marker, marker]
  const original = marker.words?.length ? marker.words : [0]
  const left = original.filter((index) => index < leftWordCount)
  const right = original.filter((index) => index >= leftWordCount).map((index) => index - leftWordCount)
  return [
    { ...marker, enabled: left.length > 0, words: left },
    { ...marker, enabled: right.length > 0, words: right }
  ]
}
