// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The range band made longer, shorter or moved by hand (cila3, 2b): its two
// edges on the ruler, and its body. Pure: src/test/cila3.test.ts. Each edge
// snaps with the timeline's own snapping (`snap`: components/timeline/
// shared.ts snapEdgeTime); a move snaps whichever edge is nearer a target.

export type BandGrip = 'start' | 'end' | 'move'

export interface BandDrag {
  grip: BandGrip
  /** The band when the press began. */
  start: number
  end: number
  /** Seconds the pointer travelled since. */
  dt: number
  /** The shortest a band may be, in seconds. */
  min: number
  /** An edge's time pulled to a target (or as it is). */
  snap: (t: number) => number
}

/** Where the band is after the drag: [start, end], start ≥ 0. */
export function dragBand(d: BandDrag): { start: number; end: number; guide: number | null } {
  const len = d.end - d.start
  if (d.grip === 'start') {
    const raw = Math.max(0, d.start + d.dt)
    const t = Math.min(Math.max(0, d.snap(raw)), d.end - d.min)
    return { start: Math.max(0, t), end: d.end, guide: t !== raw ? t : null }
  }
  if (d.grip === 'end') {
    const raw = d.end + d.dt
    const t = Math.max(d.snap(raw), d.start + d.min)
    return { start: d.start, end: t, guide: t !== raw ? t : null }
  }
  const s0 = Math.max(0, d.start + d.dt)
  const e0 = s0 + len
  const ss = d.snap(s0)
  const se = d.snap(e0)
  const ds = ss !== s0 ? Math.abs(ss - s0) : Infinity
  const de = se !== e0 ? Math.abs(se - e0) : Infinity
  if (ds === Infinity && de === Infinity) return { start: s0, end: e0, guide: null }
  if (ds <= de) {
    const s = Math.max(0, ss)
    return { start: s, end: s + len, guide: s }
  }
  const s = Math.max(0, se - len)
  return { start: s, end: s + len, guide: s + len }
}
