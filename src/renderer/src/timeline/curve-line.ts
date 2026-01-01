// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The mark a speed curve leaves on its clip on the timeline (core polish T):
// a thin line under the clip, its height the speed along it (log scale, 1×
// in the middle, 0.1× at the bottom, 10× and more at the top), and the
// range it passes through for the badge. Read from the curve's own answers
// (speed-curve.ts), the numbers the preview and the export use. Pure.
import type { Clip } from '../types'
import { curveMediaAt, curveRange, hasCurve } from './speed-curve'

type Curved = Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'speedCurve' | 'freeze'>

/** The line, as an SVG path in a box `w` × `h` px (null: no curve, or no
 *  room). One sample every `step` px (at most 160). */
export function curveLinePath(clip: Curved, w: number, h: number, step = 4): string | null {
  if (!hasCurve(clip) || !(w >= 8) || !(h >= 2)) return null
  const n = Math.max(2, Math.min(160, Math.ceil(w / step)))
  const mid = h / 2
  const span = mid - 0.75
  let d = ''
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * w
    const at = curveMediaAt(clip, (i / n) * clip.duration)
    const rate = Math.abs(at?.rate ?? clip.speed ?? 1)
    const lg = Math.max(-1, Math.min(1, Math.log10(rate > 0 ? rate : 1)))
    const y = mid - lg * span
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

/** The slowest and fastest speed along the clip, rounded for a badge. */
export function curveBadge(clip: Curved): { min: string; max: string } | null {
  const r = hasCurve(clip) ? curveRange(clip) : null
  if (!r) return null
  const fmt = (v: number): string => String(Number(v.toFixed(v < 1 ? 2 : 1)))
  return { min: fmt(r[0]), max: fmt(r[1]) }
}

/** Is the badge worth showing? Only when the curve's speed really changes
 *  along the clip (interface audit, item 14: a flat curve wore "1–1×"; its
 *  one speed is the plain speed badge's). */
export const curveBadgeShown = (b: { min: string; max: string } | null): b is { min: string; max: string } => !!b && b.min !== b.max
