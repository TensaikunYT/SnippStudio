// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's favourites and recently used (REF-AB, item 6): ids of its
// cards ("ready:lower", "style:neon", "anim:in.slide"), kept in this
// profile's own storage (a preference of this computer, not of the project).
// Recently used: the last 12, newest first.
import { useSyncExternalStore } from 'react'

const KEY = 'snipp-text-picks'
export const RECENT_MAX = 12

export interface Picks {
  fav: string[]
  recent: string[]
}

const EMPTY: Picks = { fav: [], recent: [] }
let current: Picks | null = null
const listeners = new Set<() => void>()

function read(): Picks {
  if (current) return current
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Picks> | null
    const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
    current = v ? { fav: list(v.fav), recent: list(v.recent).slice(0, RECENT_MAX) } : EMPTY
  } catch {
    current = EMPTY
  }
  return current
}

function write(next: Picks): void {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* not kept: fine for this session */
  }
  for (const l of listeners) l()
}

/** `id` was just used: first in the recent list (the 12 newest kept). */
export function noteUsed(id: string): void {
  const p = read()
  write({ ...p, recent: [id, ...p.recent.filter((x) => x !== id)].slice(0, RECENT_MAX) })
}

/** `id` in or out of the favourites. */
export function toggleFav(id: string): void {
  const p = read()
  write({ ...p, fav: p.fav.includes(id) ? p.fav.filter((x) => x !== id) : [...p.fav, id] })
}

export function usePicks(): Picks {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read,
    read
  )
}

/** For the search: lower case, no accents, Turkish dotless i as i. */
export const fold = (s: string): string =>
  s
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
