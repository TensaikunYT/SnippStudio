// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Notes tab's filter, shared with the N lane (DENEME-2-PLAN-N.md, K3):
// "All" is the one choice that shows the done notes, in the list and, faded,
// on the lane. Remembered as before (the same localStorage key).
import { create } from 'zustand'
import type { NoteFilter } from './model'

const FILTER_KEY = 'snipp-notes-filter'

function saved(): NoteFilter {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    return v === 'ready' || v === 'all' ? v : 'open'
  } catch {
    return 'open'
  }
}

interface NoteFilterState {
  filter: NoteFilter
  setFilter: (f: NoteFilter) => void
}

export const useNoteFilter = create<NoteFilterState>((set) => ({
  filter: typeof localStorage === 'undefined' ? 'open' : saved(),
  setFilter: (filter) => {
    set({ filter })
    try {
      localStorage.setItem(FILTER_KEY, filter)
    } catch {
      /* not remembered: fine */
    }
  }
}))
