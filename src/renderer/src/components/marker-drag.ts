// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A ruler marker dragged (cila4, 6: a marker could only be put down with M
// and taken away; moving one meant deleting it and putting it down again).
// Pure; tested in src/test/cila4-markers.test.ts.
import type { Project } from '../types'

/** Where a marker dragged to `t` lands: the nearest of the start, the
 *  playhead, every clip's and title's edges, the other markers and the
 *  Shorts ranges within `threshold` seconds (its own place not counted), or
 *  `t` itself; never before 0. `guide`: the time snapped to, for the line. */
export function markerSnap(p: Project, t: number, self: string, playhead: number, threshold: number): { time: number; guide: number | null } {
  const at = Math.max(0, t)
  const targets: number[] = [0, playhead]
  for (const c of Object.values(p.clips)) targets.push(c.start, c.start + c.duration)
  for (const c of p.captions) targets.push(c.start, c.end)
  for (const m of p.markers ?? []) if (m.id !== self) targets.push(m.time)
  for (const s of p.shortSegments ?? []) targets.push(s.start, s.end)
  let best: number | null = null
  let dist = threshold
  for (const x of targets) {
    const d = Math.abs(at - x)
    if (d <= dist) {
      dist = d
      best = x
    }
  }
  return best === null ? { time: at, guide: null } : { time: best, guide: best }
}

/** A press becomes a drag past this many pixels (a click below it seeks). */
export const MARKER_DRAG_PX = 3
