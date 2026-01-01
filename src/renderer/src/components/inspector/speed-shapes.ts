// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The ready speed curves of the Speed card's Curve part (REF-AB, item 4;
// REF-AB-PLAN-I.md). Six shapes of the kinds a short-video editor offers —
// a cut-up rhythm, a big moment slowed twice, time almost stopped, a skip
// ahead, a rushed start, a rushed end — in our own words, beside the five
// shapes the curve already had (timeline/speed-curve.ts CURVE_PRESETS). A
// shape is written into today's curve model as plain points around the
// clip's speed, as the five were (presetPoints); the engine reads them as it
// reads any curve. Which shape a curve is, is read back from its points (no
// name is stored). Pure.
import { CURVE_PRESETS, clampCurveSpeed, type CurvePoint, type CurvePreset } from '../../timeline/speed-curve'

/** The new shapes, around a speed of 1 (u: along the clip, v: its speed). */
export const SPEED_SHAPES = {
  rhythm: [{ u: 0, v: 1 }, { u: 0.18, v: 2 }, { u: 0.36, v: 0.4 }, { u: 0.6, v: 0.4 }, { u: 0.8, v: 3 }, { u: 1, v: 1 }],
  moment: [{ u: 0, v: 1.6 }, { u: 0.22, v: 0.3 }, { u: 0.4, v: 1.6 }, { u: 0.6, v: 1.6 }, { u: 0.78, v: 0.3 }, { u: 1, v: 1.6 }],
  timestop: [{ u: 0, v: 3 }, { u: 0.25, v: 0.15 }, { u: 0.75, v: 0.15 }, { u: 1, v: 3 }],
  skip: [{ u: 0, v: 0.6 }, { u: 0.44, v: 0.6 }, { u: 0.5, v: 10 }, { u: 0.56, v: 0.6 }, { u: 1, v: 0.6 }],
  'rush-in': [{ u: 0, v: 4 }, { u: 0.3, v: 1 }, { u: 1, v: 1 }],
  'rush-out': [{ u: 0, v: 1 }, { u: 0.7, v: 1 }, { u: 1, v: 4 }]
} as const satisfies Record<string, readonly CurvePoint[]>

export type SpeedShape = keyof typeof SPEED_SHAPES
/** Every ready curve: the new shapes and the five older ones. */
export type ShapeName = SpeedShape | CurvePreset

/** The order the tiles are drawn in, after "None" and "Custom". */
export const SHAPE_ORDER: readonly ShapeName[] = ['rhythm', 'moment', 'timestop', 'skip', 'rush-in', 'rush-out', 'ease-in', 'ease-out', 'slow-middle', 'fast-middle', 'pulse']

/** A shape's points around speed 1. */
export const shapeOf = (name: ShapeName): readonly CurvePoint[] => (name in SPEED_SHAPES ? SPEED_SHAPES[name as SpeedShape] : CURVE_PRESETS[name as CurvePreset])

/** Each name's key in t(): the new ones in strings-ref-i.ts, the older five
 *  where they were. */
export const SHAPE_KEY = {
  rhythm: 'refi.shape.rhythm',
  moment: 'refi.shape.moment',
  timestop: 'refi.shape.timestop',
  skip: 'refi.shape.skip',
  'rush-in': 'refi.shape.rushIn',
  'rush-out': 'refi.shape.rushOut',
  'ease-in': 'insp.curve.preset.easeIn',
  'ease-out': 'insp.curve.preset.easeOut',
  'slow-middle': 'insp.curve.preset.slowMiddle',
  'fast-middle': 'insp.curve.preset.fastMiddle',
  pulse: 'insp.curve.preset.pulse'
} as const satisfies Record<ShapeName, string>

/** A shape around `base` (the clip's speed), each speed to the hundredth and
 *  held to 0.1x – 100x (as presetPoints). */
export function shapePoints(name: ShapeName, base: number): CurvePoint[] {
  return shapeOf(name).map((p) => ({ u: p.u, v: clampCurveSpeed(Math.round(p.v * base * 100) / 100) }))
}

/** Whether every point of a curve has one speed (a curve that changes nothing). */
export const isFlat = (points: readonly CurvePoint[]): boolean => points.every((p) => Math.abs(p.v - points[0].v) < 1e-9)

/**
 * Which ready shape `points` are, around any speed; 'flat' for one speed all
 * along, null for a curve of one's own. A shape counts as itself while its
 * points stand where it put them and its speeds keep their ratios (to the
 * hundredth it was rounded to, or 2 %).
 */
export function matchShape(points: readonly CurvePoint[]): ShapeName | 'flat' | null {
  if (points.length < 2) return null
  if (isFlat(points)) return 'flat'
  for (const name of SHAPE_ORDER) {
    const s = shapeOf(name)
    if (s.length !== points.length || s.some((p, i) => Math.abs(p.u - points[i].u) > 0.002)) continue
    // The base from the shape's fastest point (its speed is the least rounded).
    let k = 0
    s.forEach((p, i) => {
      if (p.v > s[k].v) k = i
    })
    const base = points[k].v / s[k].v
    const want = shapePoints(name, base)
    if (want.every((w, i) => Math.abs(w.v - points[i].v) <= Math.max(0.011, 0.02 * w.v))) return name
  }
  return null
}

/** The speed a shape asks for at `u`, eased between its points as the engine
 *  eases them (smoothstep in log speed; straight with `linear`). */
export function shapeSpeedAt(points: readonly CurvePoint[], u: number, linear = false): number {
  if (u <= points[0].u) return points[0].v
  const last = points[points.length - 1]
  if (u >= last.u) return last.v
  let i = 0
  while (i < points.length - 2 && points[i + 1].u <= u) i++
  const a = points[i]
  const b = points[i + 1]
  const f = b.u > a.u ? (u - a.u) / (b.u - a.u) : 1
  const e = linear ? f : f * f * (3 - 2 * f)
  return Math.exp(Math.log(a.v) + (Math.log(b.v) - Math.log(a.v)) * e)
}

/** The log speeds a tile's drawing spans (0.1x … 10x), so 1x is its middle
 *  in every tile. */
const LO = -1
const HI = 1

/** A shape's line in a `w` × `h` box (SVG path data): across, the clip;
 *  up, the speed on a log scale. */
export function shapePath(points: readonly CurvePoint[], w: number, h: number, pad = 3): string {
  const steps = 48
  const y = (v: number): number => {
    const l = Math.min(HI, Math.max(LO, Math.log10(v)))
    return pad + (1 - (l - LO) / (HI - LO)) * (h - 2 * pad)
  }
  return Array.from({ length: steps + 1 }, (_, k) => {
    const u = k / steps
    return `${k ? 'L' : 'M'}${(pad + u * (w - 2 * pad)).toFixed(1)},${y(shapeSpeedAt(points, u)).toFixed(1)}`
  }).join(' ')
}
