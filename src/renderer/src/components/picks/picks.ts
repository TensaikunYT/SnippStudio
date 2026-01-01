// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Search, favourites and recents of the left panel's pages (REF-AB item 6,
// REF-AB-PLAN-P.md): Effects, Transitions, Filters (and, at the merge, the
// clip animations). A page's things have an id, a name and a group; the
// favourites and the last used (at most 12, newest first) are kept per page
// in the profile (localStorage), never in the project. The rules are pure
// (the store's functions take and give the state); a small zustand store
// keeps the pages drawn when one changes.
import { create } from 'zustand'
import { matches } from '../../media/bin-order'

export type PickPage = 'effects' | 'transitions' | 'filters' | 'anim'
export type PickMode = 'all' | 'fav' | 'recent'

export const RECENT_MAX = 12
const FAV_MAX = 200
export const PICKS_KEY = 'snipp-picks'

export interface PickLists {
  fav: Partial<Record<PickPage, string[]>>
  recent: Partial<Record<PickPage, string[]>>
}

export interface PickItem {
  id: string
  name: string
  group?: string
}

const EMPTY: PickLists = { fav: {}, recent: {} }

/** Pure: `id` used now: first in the page's recents, at most 12. */
export function used(lists: PickLists, page: PickPage, id: string): PickLists {
  const was = lists.recent[page] ?? []
  return { ...lists, recent: { ...lists.recent, [page]: [id, ...was.filter((x) => x !== id)].slice(0, RECENT_MAX) } }
}

/** Pure: `id` in or out of the page's favourites (newest first). */
export function toggleFav(lists: PickLists, page: PickPage, id: string): PickLists {
  const was = lists.fav[page] ?? []
  const next = was.includes(id) ? was.filter((x) => x !== id) : [id, ...was].slice(0, FAV_MAX)
  return { ...lists, fav: { ...lists.fav, [page]: next } }
}

/** Pure: what a page shows, in its order: every item matching the search
 *  (by name and group) for "all"; the favourites or the recents in their
 *  own order (newest first) for the others, searched too. Ids no longer
 *  known (a look removed since) are left out. */
export function visible(items: readonly PickItem[], lists: PickLists, page: PickPage, mode: PickMode, query: string): PickItem[] {
  const hit = (it: PickItem): boolean => matches(query, it.name, it.group)
  if (mode === 'all') return items.filter(hit)
  const byId = new Map(items.map((it) => [it.id, it]))
  const order = (mode === 'fav' ? lists.fav[page] : lists.recent[page]) ?? []
  return order.map((id) => byId.get(id)).filter((it): it is PickItem => !!it && hit(it))
}

/** Pure: a stored value made safe (anything else in the profile's key is
 *  dropped, not trusted). */
export function cleanLists(raw: unknown): PickLists {
  if (!raw || typeof raw !== 'object') return EMPTY
  const out: PickLists = { fav: {}, recent: {} }
  for (const part of ['fav', 'recent'] as const) {
    const src = (raw as Record<string, unknown>)[part]
    if (!src || typeof src !== 'object') continue
    for (const page of ['effects', 'transitions', 'filters', 'anim'] as const) {
      const list = (src as Record<string, unknown>)[page]
      if (!Array.isArray(list)) continue
      const ids = [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120))]
      out[part][page] = ids.slice(0, part === 'recent' ? RECENT_MAX : FAV_MAX)
    }
  }
  return out
}

function load(): PickLists {
  try {
    return cleanLists(JSON.parse(localStorage.getItem(PICKS_KEY) ?? 'null'))
  } catch {
    return EMPTY
  }
}

function save(lists: PickLists): void {
  try {
    localStorage.setItem(PICKS_KEY, JSON.stringify(lists))
  } catch {
    /* not remembered: fine */
  }
}

interface PicksState {
  lists: PickLists
  use: (page: PickPage, id: string) => void
  fav: (page: PickPage, id: string) => void
}

export const usePicks = create<PicksState>((set, get) => ({
  lists: typeof localStorage === 'undefined' ? EMPTY : load(),
  use: (page, id) => {
    const lists = used(get().lists, page, id)
    save(lists)
    set({ lists })
  },
  fav: (page, id) => {
    const lists = toggleFav(get().lists, page, id)
    save(lists)
    set({ lists })
  }
}))

/** A thing used on a page (applied, given to a clip, dragged onto a cut). */
export function pickUsed(page: PickPage, id: string): void {
  usePicks.getState().use(page, id)
}
