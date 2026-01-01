// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Taking a drag back (cila A): Esc while something is dragged in the preview
// puts the project back as it was at the press, with no undo step left behind
// and the redo steps as they were.
//
// A drag writes the project as it goes (the Inspector's numbers and the
// timeline follow it live), inside the store's gesture window: its first
// change records one undo step. Taking it back is that step undone, and then
// the redo entry the undo made dropped again: Esc is "this never happened",
// not "undo" (Ctrl+Shift+Z must not bring the cancelled drag back).
import { useStore, type EditorState } from '../../state/store'

/** The undo history at a press: its newest step and its redo steps. */
export interface GestureMark {
  top: unknown
  future: EditorState['future']
}

export function gestureMark(): GestureMark {
  const s = useStore.getState()
  return { top: s.past[s.past.length - 1], future: s.future }
}

/**
 * Closes the open gesture and takes back what it changed since `mark`.
 * True when there was something to take back.
 */
export function takeBackGesture(mark: GestureMark | undefined): boolean {
  useStore.getState().endGesture()
  const now = useStore.getState()
  if (!mark || now.past.length === 0 || now.past[now.past.length - 1] === mark.top) return false
  // The store's undo drops the selection (a jump in time may take the picked
  // thing away); a drag taken back changed only where things are, so what
  // was picked at the press stays picked (the crop mode, which needs a
  // picked clip, stays on).
  const { selectedClipIds, selectedCaptionIds, selectedTrackerId, templateSel, noteSel, noteReview, activeShortSegmentId } = now
  now.undo()
  useStore.setState({ future: mark.future, selectedClipIds, selectedCaptionIds, selectedTrackerId, templateSel, noteSel, noteReview, activeShortSegmentId })
  return true
}
