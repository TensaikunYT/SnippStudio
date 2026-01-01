// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The media panel's order, search and "in the timeline" badge (REF-AB item 5,
// REF-AB-PLAN-P.md). Pure: the panel passes the project's assets and clips.
import type { Asset, Clip, Project } from '../types'

export type BinSort = 'added' | 'name' | 'date' | 'duration' | 'kind'
export const BIN_SORTS: readonly BinSort[] = ['added', 'name', 'date', 'duration', 'kind']

/** The assets that have a clip in the timeline, inside compound clips too. */
export function usedAssetIds(p: Pick<Project, 'clips'>): Set<string> {
  const used = new Set<string>()
  const walk = (list: readonly Clip[]): void => {
    for (const c of list) {
      if (c.assetId) used.add(c.assetId)
      if (c.nested) walk(c.nested.clips)
    }
  }
  walk(Object.values(p.clips))
  return used
}

/** Lower case without accents (Turkish dotted / dotless i folded too): what
 *  a search compares. */
export function fold(s: string): string {
  return s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Whether every word of the query is in one of the texts. */
export function matches(query: string, ...texts: (string | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold(texts.filter(Boolean).join(' '))
  return words.every((w) => hay.includes(w))
}

const KIND_ORDER: Record<string, number> = { video: 0, image: 1, audio: 2, code: 3 }

/** The assets in the chosen order. "added" is the project's own order (as
 *  imported); the others keep it among equals (a stable sort). Date is the
 *  file's last change, newest first; one with no date goes last. */
export function sortAssets<A extends Pick<Asset, 'name' | 'mtime' | 'duration' | 'kind'>>(list: readonly A[], by: BinSort): A[] {
  const at = new Map(list.map((a, i) => [a, i]))
  const tie = (a: A, b: A): number => at.get(a)! - at.get(b)!
  const out = list.slice()
  if (by === 'added') return out
  const cmp: Record<Exclude<BinSort, 'added'>, (a: A, b: A) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    date: (a, b) => (b.mtime ?? -Infinity) - (a.mtime ?? -Infinity) || 0,
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
    kind: (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9)
  }
  return out.sort((a, b) => {
    const r = cmp[by](a, b)
    return Number.isNaN(r) || r === 0 ? tie(a, b) : r
  })
}
