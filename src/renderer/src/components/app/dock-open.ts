// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Whether the left panel's page is open (DENEME-1, P2: "soldaki panel tamamen
// kapanabilir olsun"). The category column always stays; closed, the window
// gives the page's width to the preview. Remembered in this window's storage.
import { useSyncExternalStore } from 'react'

const KEY = 'snipp-dock-open'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let open = read()

export const dockOpen = (): boolean => open

export function setDockOpen(next: boolean): void {
  if (next === open) return
  open = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    /* not remembered: fine */
  }
  for (const l of listeners) l()
}

export function useDockOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    dockOpen
  )
}

/** The category column's width (dock.css .dock-cats): the dock's width while closed. */
export const DOCK_CATS_PX = 64
