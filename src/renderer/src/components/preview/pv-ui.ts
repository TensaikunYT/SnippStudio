// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The preview's own view state (cila A): the crop mode and the safe-area
// guides. Kept out of the project store (it is how the preview is looked at,
// never an edit: no undo step, nothing saved in the project), like the
// timeline's viewport (playback/viewport.ts).
import { create } from 'zustand'

const SAFE_KEY = 'snipp-safe-guides'
const NARRATION_KEY = 'snipp-narration-line'

function readSafe(): boolean {
  try {
    return localStorage.getItem(SAFE_KEY) === 'on'
  } catch {
    return false
  }
}

function readOn(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'on'
  } catch {
    return false
  }
}

function keep(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    /* the choice lasts this session */
  }
}

/** The click-and-type note's box: where its pin is (parts of the frame). */
export interface QuickNoteAt {
  x: number
  y: number
  /** The film was playing when the click stopped it: Enter plays on. */
  wasPlaying: boolean
}

export const usePreviewUi = create<{
  /** The selected clip's crop is edited with handles in the preview. */
  cropMode: boolean
  /** The 5 % and 10 % frames are drawn over the picture (preview only). */
  safeGuides: boolean
  setCropMode: (on: boolean) => void
  setSafeGuides: (on: boolean) => void
  // ONIZLEME-UYGULA-PLAN.md: the clock being typed into (G), the narration
  // line (Shift+C, kept), the shortcut list (?), the click-and-type note's
  // box, the review's "before" frame (B).
  timeEdit: boolean
  narration: boolean
  keyList: boolean
  quickNote: QuickNoteAt | null
  reviewBefore: boolean
  /** A comparison drawn smaller while playing (its two pictures cost more
   *  than a frame's time): said over the preview. Set by the draw. */
  compareDraft: boolean
  setTimeEdit: (on: boolean) => void
  setNarration: (on: boolean) => void
  setKeyList: (on: boolean) => void
  setQuickNote: (at: QuickNoteAt | null) => void
  setReviewBefore: (on: boolean) => void
}>((set) => ({
  cropMode: false,
  safeGuides: readSafe(),
  timeEdit: false,
  narration: readOn(NARRATION_KEY),
  keyList: false,
  quickNote: null,
  reviewBefore: false,
  compareDraft: false,
  setTimeEdit: (timeEdit) => set({ timeEdit }),
  setNarration: (narration) => {
    keep(NARRATION_KEY, narration)
    set({ narration })
  },
  setKeyList: (keyList) => set({ keyList }),
  setQuickNote: (quickNote) => set({ quickNote }),
  setReviewBefore: (reviewBefore) => set({ reviewBefore }),
  setCropMode: (cropMode) => set({ cropMode }),
  setSafeGuides: (safeGuides) => {
    try {
      localStorage.setItem(SAFE_KEY, safeGuides ? 'on' : 'off')
    } catch {
      /* the choice lasts this session */
    }
    set({ safeGuides })
  }
}))

/** The safe-area frames, as parts of the picture in from each edge. */
export const SAFE_INSETS = [0.05, 0.1] as const
