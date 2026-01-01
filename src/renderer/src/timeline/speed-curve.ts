// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A speed that changes along a clip (core polish C, CILA-C-PLAN.md C1–C3).
// Pure.
//
// The curve's points are tied to MEDIA seconds (the clip's own source time),
// not to the clip's place on the timeline: a split, a trim, a ripple cut, a
// copy or the linked sound keep the same points, each piece plays its own
// window of the media under them. `clip.speed` stays the clip's average
// (media length / duration), so the window is still `[inPoint, inPoint +
// duration × speed]`; the curve only bends time inside it.
//
// Time: T(m) = ∫ dm / v(m), the timeline seconds the curve spends on the
// media up to m (from its first point; negative before it). Clip-local
// second l shows the media m where T(m) − T(in) = l × k, with
// k = (T(in + M) − T(in)) / duration — 1 when the duration is the one the
// curve asks for (the commands keep it so); any other duration (a model
// repaired by hand, a compound's clock) is spread evenly, and the media end
// stays where `inPoint + duration × speed` says. The speed at l is v(m) × k.
//
// The table: between two points the speed eases (smoothstep in log speed) or
// runs straight in log speed (`linear`); each stretch is cut into cells of
// 20 ms of media (32 to 4096 of them), inside a cell the speed is a straight line in m, whose 1/v
// integrates in closed form (a log) and inverts in closed form (an exp). So
// T and its inverse are exact inverses of each other, and every user of a
// curve (preview, export, edits, followers) reads the same numbers.
import type { Clip, SpeedCurve, SpeedKey } from '../types'
import { AUDIBLE_MAX, AUDIBLE_MIN, SPEED_MAX, SPEED_MIN, speedAudible } from './speed'

/** Cells per stretch between two points: one per 20 ms of media, at least
 *  32, at most 4096. */
export const cellsFor = (len: number): number => Math.min(4096, Math.max(32, Math.ceil(len / 0.02)))
/** At most this many points on one curve. */
export const CURVE_MAX_KEYS = 16

interface Table {
  /** Cell edges (media seconds), speeds there, T there. */
  m: Float64Array
  v: Float64Array
  t: Float64Array
}

/** The speed the points give at media second `m` (before the cells). */
function keyedSpeed(keys: readonly SpeedKey[], linear: boolean, m: number): number {
  if (m <= keys[0].m) return keys[0].v
  const last = keys[keys.length - 1]
  if (m >= last.m) return last.v
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].m <= m) i++
  const a = keys[i]
  const b = keys[i + 1]
  const span = b.m - a.m
  if (!(span > 0)) return b.v
  const u = (m - a.m) / span
  const e = linear ? u : u * u * (3 - 2 * u)
  return Math.exp(Math.log(a.v) + (Math.log(b.v) - Math.log(a.v)) * e)
}

/** ∫ over part of a cell: from its start (speed v0) to `s` of its width h,
 *  the speed going straight to v1. */
function cellTime(h: number, v0: number, v1: number, s: number): number {
  const x = (v1 - v0) / v0
  if (Math.abs(x) < 1e-9) return (h * s) / v0
  return ((h / v0) * Math.log1p(x * s)) / x
}

/** …and back: the part `s` of the cell that takes `tau` seconds. */
function cellPart(h: number, v0: number, v1: number, tau: number): number {
  const x = (v1 - v0) / v0
  if (Math.abs(x) < 1e-9) return (tau * v0) / h
  return Math.expm1((tau * v0 * x) / h) / x
}

const cache = new WeakMap<SpeedCurve, Table>()

function tableOf(curve: SpeedCurve): Table {
  const hit = cache.get(curve)
  if (hit) return hit
  const keys = curve.keys
  const linear = !!curve.linear
  const ms: number[] = [keys[0].m]
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i].m
    const b = keys[i + 1].m
    if (!(b > a)) continue
    const cells = cellsFor(b - a)
    for (let c = 1; c <= cells; c++) ms.push(c === cells ? b : a + ((b - a) * c) / cells)
  }
  const n = ms.length
  const m = new Float64Array(ms)
  const v = new Float64Array(n)
  const t = new Float64Array(n)
  for (let i = 0; i < n; i++) v[i] = keyedSpeed(keys, linear, m[i])
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + cellTime(m[i] - m[i - 1], v[i - 1], v[i], 1)
  const table = { m, v, t }
  cache.set(curve, table)
  return table
}

/** The last cell edge at or before `x` in a sorted array (0 when before all). */
function edgeBefore(arr: Float64Array, x: number): number {
  let lo = 0
  let hi = arr.length - 1
  if (x <= arr[0]) return 0
  if (x >= arr[hi]) return hi
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= x) lo = mid
    else hi = mid
  }
  return lo
}

/** T(m): timeline seconds the curve spends from its first point to media `m`. */
export function curveTime(curve: SpeedCurve, m: number): number {
  const tb = tableOf(curve)
  const last = tb.m.length - 1
  if (m <= tb.m[0]) return (m - tb.m[0]) / tb.v[0]
  if (m >= tb.m[last]) return tb.t[last] + (m - tb.m[last]) / tb.v[last]
  const i = edgeBefore(tb.m, m)
  const h = tb.m[i + 1] - tb.m[i]
  return tb.t[i] + cellTime(h, tb.v[i], tb.v[i + 1], (m - tb.m[i]) / h)
}

/** The inverse of curveTime: the media second reached after `t` seconds. */
export function curveMedia(curve: SpeedCurve, t: number): number {
  const tb = tableOf(curve)
  const last = tb.m.length - 1
  if (t <= 0) return tb.m[0] + t * tb.v[0]
  if (t >= tb.t[last]) return tb.m[last] + (t - tb.t[last]) * tb.v[last]
  const i = edgeBefore(tb.t, t)
  const h = tb.m[i + 1] - tb.m[i]
  const s = Math.min(1, Math.max(0, cellPart(h, tb.v[i], tb.v[i + 1], t - tb.t[i])))
  return tb.m[i] + s * h
}

/** The curve's speed at media second `m` (as the table has it). */
export function curveSpeed(curve: SpeedCurve, m: number): number {
  const tb = tableOf(curve)
  const last = tb.m.length - 1
  if (m <= tb.m[0]) return tb.v[0]
  if (m >= tb.m[last]) return tb.v[last]
  const i = edgeBefore(tb.m, m)
  const s = (m - tb.m[i]) / (tb.m[i + 1] - tb.m[i])
  return tb.v[i] + (tb.v[i + 1] - tb.v[i]) * s
}

/** Seconds of timeline the curve gives media [from, to]. */
export function curveSpan(curve: SpeedCurve, from: number, to: number): number {
  return curveTime(curve, to) - curveTime(curve, from)
}

// -- a clip with a curve -----------------------------------------------------------

export type CurveClip = Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'speedCurve' | 'freeze'>

/** Whether `clip` plays along a curve (a freeze frame never does). */
export function hasCurve(clip: Pick<Clip, 'speedCurve' | 'freeze'>): clip is Pick<Clip, 'freeze'> & { speedCurve: SpeedCurve } {
  return !!clip.speedCurve && clip.freeze === undefined && clip.speedCurve.keys.length > 0
}

interface Frame {
  curve: SpeedCurve
  /** T at the window's first and last media second. */
  t0: number
  t1: number
  /** Raw curve seconds per timeline second (1: the duration the curve asks for). */
  k: number
}

function frameOf(clip: CurveClip): Frame | null {
  if (!hasCurve(clip)) return null
  const speed = clip.speed ?? 1
  const d = clip.duration
  if (!(d > 0) || !(speed > 0)) return null
  const curve = clip.speedCurve
  const t0 = curveTime(curve, clip.inPoint)
  const t1 = curveTime(curve, clip.inPoint + d * speed)
  const k = (t1 - t0) / d
  return k > 0 && Number.isFinite(k) ? { curve, t0, t1, k } : null
}

/**
 * The media second a curved clip shows at clip-local second `local` (which
 * may lie outside [0, duration]: a transition's ghost frames, a trim that
 * reveals more media) and its speed there (negative backwards). Null for a
 * clip without a curve (the caller's straight line).
 */
export function curveMediaAt(clip: CurveClip, local: number): { time: number; rate: number } | null {
  const f = frameOf(clip)
  if (!f) return null
  const time = curveMedia(f.curve, clip.reversed ? f.t1 - local * f.k : f.t0 + local * f.k)
  const rate = curveSpeed(f.curve, time) * f.k
  return { time, rate: clip.reversed ? -rate : rate }
}

/** The clip-local second a curved clip shows media second `m` at (null: no curve). */
export function curveLocalAt(clip: CurveClip, m: number): number | null {
  const f = frameOf(clip)
  if (!f) return null
  const t = curveTime(f.curve, m)
  return clip.reversed ? (f.t1 - t) / f.k : (t - f.t0) / f.k
}

/** The in point and (average) speed of the part of a curved clip between
 *  clip-local seconds `from` and `to` (null: no curve, or nothing between). */
export function curvePart(clip: CurveClip, from: number, to: number): { inPoint: number; speed: number } | null {
  if (!(to > from)) return null
  const a = curveMediaAt(clip, from)
  const b = curveMediaAt(clip, to)
  if (!a || !b) return null
  const lo = Math.min(a.time, b.time)
  const hi = Math.max(a.time, b.time)
  if (!(hi > lo)) return null
  return { inPoint: lo, speed: (hi - lo) / (to - from) }
}

/** Seconds of timeline the curve gives a window of `mediaLen` seconds from
 *  `inPoint` (the duration a clip with this curve should have). */
export function curveDuration(curve: SpeedCurve, inPoint: number, mediaLen: number): number {
  return curveSpan(curve, inPoint, inPoint + mediaLen)
}

/** The speeds the curve passes through inside a clip's window: [slowest,
 *  fastest] (what it plays at, its k in). */
export function curveRange(clip: CurveClip): [number, number] | null {
  const f = frameOf(clip)
  if (!f) return null
  const lo = clip.inPoint
  const hi = clip.inPoint + clip.duration * (clip.speed ?? 1)
  let min = Math.min(curveSpeed(f.curve, lo), curveSpeed(f.curve, hi))
  let max = Math.max(curveSpeed(f.curve, lo), curveSpeed(f.curve, hi))
  for (const key of f.curve.keys) {
    if (key.m <= lo || key.m >= hi) continue
    min = Math.min(min, key.v)
    max = Math.max(max, key.v)
  }
  return [min * f.k, max * f.k]
}

// -- making a curve ----------------------------------------------------------------

/** A point's speed held to the range. */
export const clampCurveSpeed = (v: number): number => (Number.isFinite(v) ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) : 1)

/** What is wrong with `curve` for the model (null: nothing): 1–CURVE_MAX_KEYS
 *  points, media seconds finite and strictly rising, speeds 0.1–100. */
export function curveProblem(curve: unknown): string | null {
  if (!curve || typeof curve !== 'object') return 'not an object'
  const keys = (curve as SpeedCurve).keys
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > CURVE_MAX_KEYS) return `${Array.isArray(keys) ? keys.length : 'no'} points`
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (!k || typeof k !== 'object' || !Number.isFinite(k.m) || !Number.isFinite(k.v) || !(k.v > 0)) return `point ${i} is not a number`
    if (k.v < SPEED_MIN - 1e-9 || k.v > SPEED_MAX + 1e-9 || Math.abs(k.m) > 1e7) return `point ${i} is out of range`
    if (i > 0 && !(k.m > keys[i - 1].m)) return `point ${i} is not after the one before`
  }
  const lin = (curve as SpeedCurve).linear
  if (lin !== undefined && lin !== true) return 'linear is not true'
  return null
}

/** Points sorted, near-equal media seconds merged (the later wins), at most
 *  CURVE_MAX_KEYS, speeds held to the range. */
export function tidyKeys(keys: readonly SpeedKey[]): SpeedKey[] {
  const sorted = keys
    .filter((k) => Number.isFinite(k.m) && Number.isFinite(k.v))
    .map((k) => ({ m: k.m, v: clampCurveSpeed(k.v) }))
    .sort((a, b) => a.m - b.m)
  const out: SpeedKey[] = []
  for (const k of sorted) {
    const prev = out[out.length - 1]
    if (prev && k.m - prev.m < 1e-6) out[out.length - 1] = k
    else out.push(k)
  }
  return out.slice(0, CURVE_MAX_KEYS)
}

/** A point on a clip's window as the editor sees it: `u` 0..1 along the clip
 *  as it plays (backwards clips: from its media end), `v` the speed. */
export interface CurvePoint {
  u: number
  v: number
}

/** Window points → media points of `clip` (its in point, its media length). */
export function keysFromPoints(clip: Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed'>, points: readonly CurvePoint[]): SpeedKey[] {
  const len = clip.duration * (clip.speed ?? 1)
  return points.map((p) => {
    const u = Math.min(1, Math.max(0, p.u))
    return { m: clip.inPoint + (clip.reversed ? 1 - u : u) * len, v: p.v }
  })
}

/** …and back: the points of `clip`'s curve inside its window, as `u`. */
export function pointsOf(clip: CurveClip): CurvePoint[] {
  if (!hasCurve(clip)) return []
  const len = clip.duration * (clip.speed ?? 1)
  if (!(len > 0)) return []
  const f = frameOf(clip)
  const k = f?.k ?? 1
  const out: CurvePoint[] = []
  for (const key of clip.speedCurve.keys) {
    const x = (key.m - clip.inPoint) / len
    if (x < -1e-9 || x > 1 + 1e-9) continue
    const u = Math.min(1, Math.max(0, clip.reversed ? 1 - x : x))
    out.push({ u, v: key.v * k })
  }
  return out.sort((a, b) => a.u - b.u)
}

/** The ready-made shapes (multiples of the clip's own speed, along `u`). */
export const CURVE_PRESETS = {
  'ease-in': [{ u: 0, v: 0.3 }, { u: 0.45, v: 1 }, { u: 1, v: 1 }],
  'ease-out': [{ u: 0, v: 1 }, { u: 0.55, v: 1 }, { u: 1, v: 0.3 }],
  'slow-middle': [{ u: 0, v: 2 }, { u: 0.42, v: 0.25 }, { u: 0.58, v: 0.25 }, { u: 1, v: 2 }],
  'fast-middle': [{ u: 0, v: 0.5 }, { u: 0.5, v: 4 }, { u: 1, v: 0.5 }],
  pulse: [{ u: 0, v: 1 }, { u: 0.38, v: 1 }, { u: 0.5, v: 6 }, { u: 0.62, v: 1 }, { u: 1, v: 1 }]
} as const satisfies Record<string, readonly CurvePoint[]>

export type CurvePreset = keyof typeof CURVE_PRESETS

/** `curve` moved along the media by `d` seconds (a slip: the same speeds stay
 *  where they were on the timeline, other footage under them). */
export function shiftCurve(curve: SpeedCurve, d: number): SpeedCurve {
  if (d === 0) return curve
  return { ...curve, keys: curve.keys.map((k) => ({ m: k.m + d, v: k.v })) }
}

/** Whether two clips have the same curve (none on both, or the same points). */
export function sameCurve(a: SpeedCurve | undefined, b: SpeedCurve | undefined): boolean {
  if (a === b) return true
  if (!a || !b || !!a.linear !== !!b.linear || a.keys.length !== b.keys.length) return false
  return a.keys.every((k, i) => k.m === b.keys[i].m && k.v === b.keys[i].v)
}

/** A curve as a short text (the same for the same points; '' for none). */
export function curveSig(curve: SpeedCurve | undefined): string {
  if (!curve) return ''
  return curve.keys.map((k) => `${k.m.toFixed(4)}:${k.v.toFixed(4)}`).join(',') + (curve.linear ? 'L' : '')
}

/** Whether a clip's sound is heard anywhere (a speed curve: some stretch of
 *  it between 0.25x and 8x; one speed: speedAudible). */
export function clipAudible(clip: Pick<Clip, 'speed' | 'speedCurve' | 'freeze' | 'inPoint' | 'duration' | 'reversed'>): boolean {
  const range = hasCurve(clip) ? curveRange(clip) : null
  if (range) return range[1] >= AUDIBLE_MIN * 0.94 && range[0] <= AUDIBLE_MAX * 1.06
  return speedAudible(clip.speed ?? 1)
}

/** A curved clip's raw curve seconds per timeline second (1: it lasts what
 *  its points ask for; null: no curve). */
export function curveScale(clip: CurveClip): number | null {
  return frameOf(clip)?.k ?? null
}
