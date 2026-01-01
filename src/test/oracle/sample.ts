// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The oracle's own reading of a project (SnippStudio phase 4A.9, A8), by
// brute force. Two readings: every track as content samples on a 0.02 s grid
// of the SOURCE — (track, content instance, source step) and the timeline
// time it plays at — and, for what must be exact (the edges of a cut, where
// a title sits), the source windows themselves as intervals. Nothing here is
// shared with the app's own content addressing: only types.ts.
import type { Caption, Clip, Project, SpeedCurve } from '../../renderer/src/types'
import { instOf, wordTag } from './fixture'

export const STEP = 0.02
const EPS = 1e-7

/** "track|instance" → (source step → the timeline times it plays at: more
 *  than one when the same source second is shown twice). */
export type Samples = Map<string, Map<number, number[]>>

export const speedOf = (c: Clip): number => Math.max(0.01, c.speed ?? 1)
/** The second of its source a clip shows at `t` (a reversed clip runs
 *  backwards from its out point). */
export const srcAt = (c: Clip, t: number): number =>
  curved(c) ? curveSrc(c, t - c.start) : c.reversed ? c.inPoint + (c.duration - (t - c.start)) * speedOf(c) : c.inPoint + (t - c.start) * speedOf(c)
/** The time a clip shows second `m` of its source at. */
export const timeAt = (c: Clip, m: number): number =>
  curved(c) ? c.start + curveLocal(c, m) : c.reversed ? c.start + c.duration - (m - c.inPoint) / speedOf(c) : c.start + (m - c.inPoint) / speedOf(c)

// ---- a speed curve, read by the oracle itself (core polish C) ------------------
// The spec (CILA-C-PLAN.md C2, C3), written again here without the app's
// code: between two points the speed eases in log speed (smoothstep, or
// straight with `linear`); each stretch is cut into cells of 20 ms of media
// (32 to 4096), inside a cell
// the speed is a straight line in media seconds; T(m) = integral of dm / v.
// Here T is summed by Simpson's rule and inverted by bisection, not in
// closed form.

export const curved = (c: Clip): c is Clip & { speedCurve: SpeedCurve } => !!c.speedCurve && c.freeze === undefined && c.speedCurve.keys.length > 0

interface OTable { m: number[]; v: number[]; t: number[] }
const otables = new WeakMap<SpeedCurve, OTable>()
function eased(curve: SpeedCurve, m: number): number {
  const k = curve.keys
  if (m <= k[0].m) return k[0].v
  if (m >= k[k.length - 1].m) return k[k.length - 1].v
  let i = 0
  while (k[i + 1].m <= m) i++
  const u = (m - k[i].m) / (k[i + 1].m - k[i].m)
  const e = curve.linear ? u : u * u * (3 - 2 * u)
  return Math.exp(Math.log(k[i].v) * (1 - e) + Math.log(k[i + 1].v) * e)
}
/** The integral over the first `s` of a cell of width h of 1 / (a speed
 *  going straight from va to vb), by Simpson's rule. */
function simpson(h: number, va: number, vb: number, s: number): number {
  const n = 16
  const f = (x: number): number => 1 / (va + (vb - va) * x)
  let sum = f(0) + f(s)
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f((s * i) / n)
  return (h * s * sum) / (3 * n)
}
function otable(curve: SpeedCurve): OTable {
  const hit = otables.get(curve)
  if (hit) return hit
  const k = curve.keys
  const m: number[] = [k[0].m]
  for (let i = 0; i + 1 < k.length; i++) {
    // (One cell per 20 ms of media, 32 to 4096 of them.)
    const n = Math.min(4096, Math.max(32, Math.ceil((k[i + 1].m - k[i].m) / 0.02)))
    for (let j = 1; j <= n; j++) m.push(j === n ? k[i + 1].m : k[i].m + ((k[i + 1].m - k[i].m) * j) / n)
  }
  const v = m.map((x) => eased(curve, x))
  const t = [0]
  for (let i = 1; i < m.length; i++) t.push(t[i - 1] + simpson(m[i] - m[i - 1], v[i - 1], v[i], 1))
  const tb = { m, v, t }
  otables.set(curve, tb)
  return tb
}
/** T(m) of a curve. */
export function curveT(curve: SpeedCurve, x: number): number {
  const { m, v, t } = otable(curve)
  const n = m.length - 1
  if (x <= m[0]) return (x - m[0]) / v[0]
  if (x >= m[n]) return t[n] + (x - m[n]) / v[n]
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (m[mid] <= x) lo = mid
    else hi = mid
  }
  const h = m[lo + 1] - m[lo]
  return t[lo] + simpson(h, v[lo], v[lo + 1], (x - m[lo]) / h)
}
/** The media second T = `tt` reaches (bisection). */
function curveM(curve: SpeedCurve, tt: number): number {
  const { m } = otable(curve)
  let lo = m[0] - 200 - Math.abs(tt) * 100
  let hi = m[m.length - 1] + 200 + Math.abs(tt) * 100
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (curveT(curve, mid) < tt) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
/** The raw curve seconds per timeline second of a clip (1: the length its points ask for). */
export function curveK(c: Clip & { speedCurve: SpeedCurve }): number {
  return (curveT(c.speedCurve, c.inPoint + c.duration * speedOf(c)) - curveT(c.speedCurve, c.inPoint)) / c.duration
}
function curveSrc(c: Clip & { speedCurve: SpeedCurve }, local: number): number {
  const k = curveK(c)
  const t0 = curveT(c.speedCurve, c.inPoint)
  const t1 = curveT(c.speedCurve, c.inPoint + c.duration * speedOf(c))
  return curveM(c.speedCurve, c.reversed ? t1 - local * k : t0 + local * k)
}
function curveLocal(c: Clip & { speedCurve: SpeedCurve }, x: number): number {
  const k = curveK(c)
  const t = curveT(c.speedCurve, x)
  return c.reversed ? (curveT(c.speedCurve, c.inPoint + c.duration * speedOf(c)) - t) / k : (t - curveT(c.speedCurve, c.inPoint)) / k
}

/** A still: media with no clock of its own. It has no source seconds to
 *  speak of (a trim and a cut keep its in point differently), so it is read
 *  by where it is on the timeline, never by "source". */
// (An empty placeholder of the picture automation shows no footage either.)
export const isStill = (p: Project, c: Clip): boolean => c.freeze !== undefined || c.automationMissing !== undefined || p.assets.find((a) => a.id === c.assetId)?.kind === 'image'

const cache = new WeakMap<Project, Samples>()

export function samplesOf(p: Project): Samples {
  const hit = cache.get(p)
  if (hit) return hit
  const out: Samples = new Map()
  for (const tr of p.tracks) {
    for (const id of tr.clipIds) {
      const c = p.clips[id]
      if (!c || isStill(p, c)) continue
      const key = `${tr.id}|${instOf(c)}`
      let m = out.get(key)
      if (!m) out.set(key, (m = new Map()))
      for (const [k, t] of clipKeys(c)) {
        const list = m.get(k)
        if (list) list.push(t)
        else m.set(k, [t])
      }
    }
  }
  cache.set(p, out)
  return out
}

export const trackOf = (key: string): string => key.slice(0, key.indexOf('|'))

/** Every clip of `track` under `t` (clips may lie over each other after a
 *  drag): what each shows there. */
export function allAt(p: Project, track: string, t: number): Content[] {
  return clipsOn(p, track)
    .filter((c) => t >= c.start - EPS && t <= c.start + c.duration + EPS)
    .map((c) => ({ track, inst: instOf(c), src: srcAt(c, t), clip: c.id }))
}

/** The clips of a track in time order. */
export function clipsOn(p: Project, track: string): Clip[] {
  const tr = p.tracks.find((t) => t.id === track)
  return tr ? tr.clipIds.map((id) => p.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start) : []
}

export interface Content {
  track: string
  inst: string
  src: number
  clip: string
}

/** What plays on `track` at `t` (a time on a join is the later clip's; with
 *  `before`, the earlier one's). */
export function contentAt(p: Project, track: string, t: number, before = false): Content | null {
  for (const c of clipsOn(p, track)) {
    const a = c.start
    const b = c.start + c.duration
    const inside = before ? t > a + EPS && t <= b + EPS : t >= a - EPS && t < b - EPS
    if (inside) return { track, inst: instOf(c), src: srcAt(c, t), clip: c.id }
  }
  return null
}

/** The samples of one clip: source step → time. */
export function clipKeys(c: Clip): Map<number, number> {
  const m = new Map<number, number>()
  const end = c.inPoint + c.duration * speedOf(c)
  for (let k = Math.ceil((c.inPoint - EPS) / STEP); k * STEP < end - EPS; k++) m.set(k, timeAt(c, k * STEP))
  return m
}

export interface WordSpot {
  tag: string
  line: string
  start: number
  end: number
}

/** Every tagged word of the subtitle lines with word times. */
export function wordsOf(p: Project): WordSpot[] {
  const out: WordSpot[] = []
  for (const c of p.captions as Caption[]) {
    if (c.manual || c.shape) continue
    for (const w of c.words ?? []) {
      const t = wordTag(w)
      if (t) out.push({ tag: t, line: c.id, start: w.start, end: w.end })
    }
  }
  return out
}

/** A project's film as one string (for "is it the same film the agent saw"):
 *  every clip's place and source, the locks, the lines' times. */
export function filmSig(p: Project): string {
  const rows: string[] = []
  for (const tr of p.tracks) {
    rows.push(`T${tr.id}${tr.locked ? 'L' : ''}`)
    for (const c of clipsOn(p, tr.id)) rows.push(`${instOf(c)}@${c.start.toFixed(4)}+${c.duration.toFixed(4)}i${c.inPoint.toFixed(4)}x${speedOf(c)}${c.speedCurve ? `~${JSON.stringify(c.speedCurve)}` : ''}`)
  }
  for (const c of p.captions) rows.push(`C${c.id}@${c.start.toFixed(4)}-${c.end.toFixed(4)}`)
  return rows.join(';')
}

// ---- exact: source windows as intervals ----------------------------------------

export type Iv = [number, number]

export const lenOf = (list: readonly Iv[]): number => list.reduce((n, [a, b]) => n + b - a, 0)

export function union(list: readonly Iv[], eps = 1e-9): Iv[] {
  const out: Iv[] = []
  for (const [a, b] of [...list].filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + eps) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export function inter(x: readonly Iv[], y: readonly Iv[]): Iv[] {
  const out: Iv[] = []
  for (const [a, b] of x) for (const [c, d] of y) if (Math.min(b, d) > Math.max(a, c)) out.push([Math.max(a, c), Math.min(b, d)])
  return union(out)
}

export function minus(x: readonly Iv[], y: readonly Iv[]): Iv[] {
  let cur: Iv[] = x.map(([a, b]) => [a, b])
  for (const [c, d] of y) {
    const next: Iv[] = []
    for (const [a, b] of cur) {
      if (d <= a || c >= b) next.push([a, b])
      else {
        if (c > a) next.push([a, c])
        if (d < b) next.push([d, b])
      }
    }
    cur = next
  }
  return cur
}

/** The source window a clip shows, as [low, high]. */
export const windowOf = (c: Clip): Iv => [c.inPoint, c.inPoint + c.duration * speedOf(c)]

/** The source an instance still shows on a track: merged windows. */
export function coverOf(p: Project, track: string, inst: string): Iv[] {
  return union(clipsOn(p, track).filter((c) => instOf(c) === inst).map(windowOf))
}

/** The clip of an instance on a track showing source `m` (at a piece's end
 *  with `endSide`). */
export function clipAtSource(p: Project, track: string, inst: string, m: number, endSide = false): Clip | undefined {
  return clipsOn(p, track).find((c) => {
    if (instOf(c) !== inst) return false
    const [a, b] = windowOf(c)
    return endSide ? m > a + EPS && m <= b + EPS : m >= a - EPS && m < b - EPS
  })
}
