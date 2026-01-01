// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which cut's "+" the pointer is near, along a video lane (the interface
// audit's G4: components/timeline/transitions.tsx shows that one whole). Pure.

/** How near the pointer (px, along the lane) shows a cut's "+" whole. */
export const NEAR_CUT_PX = 28

/** The cut (its clip's id) within `reach` px of the pointer, or null:
 *  `cuts` are [clip id, x along the lane] (interface audit G4). */
export function nearCut(cuts: readonly (readonly [string, number])[], x: number, reach = NEAR_CUT_PX): string | null {
  let best: string | null = null
  let d = reach
  for (const [id, cx] of cuts) {
    const dd = Math.abs(cx - x)
    if (dd <= d) {
      d = dd
      best = id
    }
  }
  return best
}

