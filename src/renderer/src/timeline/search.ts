// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Searching the timeline (KOLAY-PLAN.md, item 2): a clip by its media's name,
// a subtitle or a text by what it says, a marker by its name or note, a work
// note by its text. Letter case and accents do not count, Turkish's dotted
// and dotless i are one letter. The hits in timeline order. Pure: it reads
// the project, changes nothing.
import { isSubtitle, type Project } from '../types'

export type HitKind = 'clip' | 'subtitle' | 'text' | 'marker' | 'note'

export interface SearchHit {
  kind: HitKind
  /** The clip's, line's, marker's or note's id. */
  id: string
  /** What is shown: the name, or the words around the match. */
  name: string
  /** Where it starts (timeline seconds). */
  at: number
  /** A clip: its media kind (the icon) and its lane. */
  media?: 'video' | 'image' | 'audio' | 'code'
  trackId?: string
}

/** At most this many hits are listed. */
export const SEARCH_MAX = 200

/** The form two strings are compared in: lower case, without accents,
 *  ı and i one letter, spaces folded. */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
}

/** The text around the first match, at most `room` characters, with … where cut. */
function around(text: string, q: string, room = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= room) return flat
  // (fold keeps the length of plain letters; an accent dropped shortens it, so
  // the place is a near one, which is enough to show the words.)
  const i = Math.max(0, fold(flat).indexOf(q))
  const from = Math.max(0, Math.min(i - Math.floor((room - q.length) / 2), flat.length - room))
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + room).trim()}${from + room < flat.length ? '…' : ''}`
}

/**
 * The hits for `query` in `project`, in timeline order (then clips, lines,
 * markers, notes). An empty query finds nothing; `pick` keeps only some
 * clips (and only clips) when given (the labels' filter).
 */
export function searchTimeline(project: Project, query: string, pick?: (clipId: string) => boolean): SearchHit[] {
  const q = fold(query).trim()
  if (!q && !pick) return []
  const has = (text: string | undefined | null): boolean => !q || (!!text && fold(text).includes(q))
  const hits: SearchHit[] = []
  const assets = new Map(project.assets.map((a) => [a.id, a]))
  for (const track of project.tracks)
    for (const id of track.clipIds) {
      const c = project.clips[id]
      if (!c || (pick && !pick(id))) continue
      const a = assets.get(c.assetId)
      if (!a || !has(a.name)) continue
      hits.push({ kind: 'clip', id, name: a.name, at: c.start, media: a.kind === 'video' || a.kind === 'image' || a.kind === 'audio' || a.kind === 'code' ? a.kind : undefined, trackId: track.id })
    }
  if (!pick) {
    for (const cap of project.captions) {
      if (cap.shape || !cap.text || !has(cap.text)) continue
      hits.push({ kind: isSubtitle(cap) ? 'subtitle' : 'text', id: cap.id, name: around(cap.text, q), at: cap.start })
    }
    for (const m of project.markers ?? []) {
      const name = [m.label, m.note].filter(Boolean).join(' · ')
      if (!name || !has(name)) continue
      hits.push({ kind: 'marker', id: m.id, name: around(name, q), at: m.time })
    }
    for (const n of project.notes ?? []) {
      if (!n.text || !has(n.text)) continue
      hits.push({ kind: 'note', id: n.id, name: `#${n.num} ${around(n.text, q)}`, at: n.start })
    }
  }
  const order: Record<HitKind, number> = { clip: 0, subtitle: 1, text: 2, marker: 3, note: 4 }
  return hits.sort((x, y) => x.at - y.at || order[x.kind] - order[y.kind]).slice(0, SEARCH_MAX)
}
