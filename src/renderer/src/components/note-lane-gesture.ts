// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a press on the empty part of the N lane does (phase 3c.Y, K3 of
// tarifler\FAZ3C-YERLESIM.md). The lane sits right under the ruler, so a
// plain drag there is what a drag on the ruler is: the playhead follows it.
// A new note is always a deliberate act: Shift + drag marks a range, a
// double click drops a point note, right click offers "Note here", the "+"
// button and the N key start one at the playhead. Pure, so the decision is
// tested without a window (src/test/note-lane-gesture.test.ts).

/** What a press on the empty lane starts. */
export type LanePress = 'scrub' | 'mark' | 'ignore'

export interface PressInfo {
  /** The pointer button (0 = left). */
  button: number
  shiftKey: boolean
}

/** Left button: Shift marks a range for a note, otherwise the playhead is
 *  dragged (a click moves it there). Any other button: nothing here (the
 *  right button opens the lane's menu on contextmenu; the side buttons
 *  scroll the timeline). */
export function lanePress(e: PressInfo): LanePress {
  if (e.button !== 0) return 'ignore'
  return e.shiftKey ? 'mark' : 'scrub'
}

/** While marking, the range's edges snap (the playhead, markers, clip edges,
 *  other notes) unless Alt is held: Shift is already the marking key, so it
 *  can no longer mean "exactly where I put it" as it does when a note block
 *  is moved. */
export const markSnapOff = (e: { altKey: boolean }): boolean => e.altKey

/** A drag starts only after this many pixels (as for the note blocks). */
export const LANE_SLOP_PX = 4

/** Is this press target the empty lane (not a block, the draft, a changed
 *  stretch, the label or its button)? */
export function isEmptyLaneTarget(target: { closest: (sel: string) => unknown } | null): boolean {
  if (!target) return false
  return !target.closest('.tl-note-block, .tl-note-touched, .tl-track-label')
}
