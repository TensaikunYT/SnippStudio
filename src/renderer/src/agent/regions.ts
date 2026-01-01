// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode, step 3 (EKIP-3-PLAN.md): a worker of an agent program takes
// a stretch of the timeline — a region — and the workers write at the same
// time without dropping each other's ops.
//
// A region is not part of the project (never saved; it lives in the agent
// store while the work lasts). It is kept as seconds of ONE project (`on`)
// and found again in any other by the footage of the anchor track that lay
// in it (`carryRegion`: content.ts, the way a cut finds its footage): a cut
// or an addition elsewhere shifts it, the owner's own cut inside shortens it.
// Where it lies is only ever a PROPOSAL: what an op may do because of a
// region is decided by comparing the region's inside exactly (`slab`: the
// records in it, at seconds counted from its start), never by the carry.
// Pure.
import type { Caption, Clip, Project } from '../types'
import { instanceOf } from '../types'
import { commandByName } from '../commands'
import { idsIn, lastingId, timesIn } from './address'
import { anchorTrack, oneToOne, piecesIn, spansOf, type Iv } from './content'

/** A stretch a worker took. */
export interface Region {
  /** The worker (its `as` label). */
  as: string
  start: number
  end: number
  /** Only these tracks' clips (ids); absent: every track, and the lines,
   *  markers and G lane items of the stretch. */
  tracks?: string[]
  /** The project `start` and `end` are seconds of. */
  on: Project
  /** The agent session that took it, and the project session it is of
   *  (it goes with either). */
  session?: string
  ps?: number
}

const EPS = 1e-6
const s2 = (t: number): string => (Math.round(t * 100) / 100).toFixed(2)
export const sayRange = (r: Iv): string => `${s2(r[0])}–${s2(r[1])} s`

const cache = new WeakMap<Project, WeakMap<Project, Map<string, Iv | null>>>()

/**
 * The stretch `range` of `from` as it lies in `to`: by the anchor track's
 * footage that lay in it (its first and last second there now; the room it
 * had before its first and after its last footage is kept). Null when it
 * cannot be told: no anchor footage in it, none of it left, or that footage
 * is on the timeline more than once.
 */
export function carryRegion(from: Project, to: Project, range: Iv): Iv | null {
  if (from === to) return [range[0], range[1]]
  let byTo = cache.get(from)
  if (!byTo) cache.set(from, (byTo = new WeakMap()))
  let known = byTo.get(to)
  if (!known) byTo.set(to, (known = new Map()))
  const key = `${range[0]}|${range[1]}`
  if (known.has(key)) return known.get(key)!
  const out = carried(from, to, range)
  known.set(key, out)
  return out
}

function carried(from: Project, to: Project, [a, b]: Iv): Iv | null {
  const anchor = anchorTrack(from)
  if (!anchor) return null
  const { pieces } = piecesIn(from, anchor, a, b)
  if (!pieces.length) return null
  const was = spansOf(from, pieces).filter(([x, y]) => y > a - EPS && x < b + EPS)
  const now = spansOf(to, pieces)
  if (!was.length || !now.length) return null
  const len = (l: readonly Iv[]): number => l.reduce((n, [x, y]) => n + y - x, 0)
  // (More of it than there was: the footage was put on the timeline again.)
  if (len(now) > len(spansOf(from, pieces)) + EPS) return null
  const lead = Math.max(0, was[0][0] - a)
  const tail = Math.max(0, b - was[was.length - 1][1])
  const start = Math.max(0, now[0][0] - lead)
  return [start, Math.max(start, now[now.length - 1][1] + tail)]
}

/** Where a region lies in `p`, or null when it cannot be told. */
export const placedIn = (r: Region, p: Project): Iv | null => carryRegion(r.on, p, [r.start, r.end])

/** The regions as seconds of `p` (those found there; the others stay). */
export function rebased(list: readonly Region[], p: Project): Region[] {
  return list.map((r) => {
    if (r.on === p) return r
    const at = placedIn(r, p)
    return at ? { ...r, start: at[0], end: at[1], on: p } : r
  })
}

const clipIn = (c: Clip, [a, b]: Iv): boolean => c.start < b - EPS && c.start + c.duration > a + EPS
const spanIn = (x: number, y: number, [a, b]: Iv): boolean => (y - x <= EPS ? x >= a - EPS && x < b - EPS : x < b - EPS && y > a + EPS)

/** A clip that may be shown by its part inside a stretch: plain footage
 *  with a clock of its own, nothing on it that is timed from its edges. */
const plain = (p: Project, c: Clip): boolean => {
  const x = c as unknown as Record<string, unknown>
  return oneToOne(p, c) && !c.reversed && !c.speedCurve && !c.transitionOut && !['keyframes', 'channels', 'volumeKeyframes', 'mask', 'fadeIn', 'fadeOut'].some((k) => !!x[k])
}

/**
 * The inside of a stretch as a project of its own: the clips that lie in it
 * (of `tracks`, when given), the lines, markers and G lane items in it (with
 * no `tracks`), every time counted from the stretch's start. A plain clip
 * that reaches past the stretch (a music bed under everything) is its part
 * inside, named by its footage: cut in two OUTSIDE the stretch, it is the
 * same inside. Any other clip that reaches past it is taken whole. Two stretches
 * hold the same when their slabs are the same film (replay.ts sameFilm /
 * sameLayout). `bare`: only the records (no track's or project's settings).
 */
export function slab(p: Project, range: Iv, tracks?: readonly string[], bare = false): Project {
  const a = range[0]
  const clips: Record<string, Clip> = {}
  for (const c of Object.values(p.clips)) {
    if ((tracks && !tracks.includes(c.trackId)) || !clipIn(c, range)) continue
    const lo = Math.max(c.start, a)
    const hi = Math.min(c.start + c.duration, range[1])
    if ((lo <= c.start + EPS && hi >= c.start + c.duration - EPS) || !plain(p, c)) {
      clips[c.id] = { ...c, start: c.start - a }
      continue
    }
    const inPoint = c.inPoint + (lo - c.start) * (c.speed ?? 1)
    const id = `${instanceOf(c)}@${inPoint.toFixed(4)}`
    // (Cut in two outside the stretch, its piece here is linked anew to its
    // partner's piece: which link it is, is not told by the part inside.)
    clips[id] = { ...c, id, instance: instanceOf(c), start: lo - a, duration: hi - lo, inPoint }
    delete clips[id].linkId
  }
  const rows = p.tracks.map((t) => ({ ...t, clipIds: t.clipIds.filter((id) => Object.hasOwn(clips, id)).sort((x, y) => clips[x].start - clips[y].start || (x < y ? -1 : 1)) }))
  const line = (c: Caption): Caption => ({ ...c, start: c.start - a, end: c.end - a, ...(c.words ? { words: c.words.map((w) => ({ ...w, start: w.start - a, end: w.end - a })) } : {}) })
  const all = !tracks
  const records = {
    clips,
    captions: all ? p.captions.filter((c) => spanIn(c.start, c.end, range)).map(line) : [],
    // (A marker's colour is given by how many markers there are when it is
    // made — the next of a row of colours: not a thing an op's meaning hangs
    // on. It counts only for `bare`: what another worker may not change.)
    markers: all ? (p.markers ?? []).filter((m) => spanIn(m.time, m.time, range)).map((m) => ({ ...m, time: m.time - a, ...(bare ? {} : { color: '' }) })) : [],
    templates: all ? (p.templates ?? []).filter((t) => spanIn(t.start, t.start + (t.duration ?? 0), range)).map((t) => ({ ...t, start: t.start - a })) : []
  }
  if (bare) return { ...records, tracks: [] } as unknown as Project
  const out = { ...p, ...records, tracks: rows } as Project
  delete (out as { notes?: unknown }).notes
  delete (out as { noteSeq?: unknown }).noteSeq
  return out
}

const sharesTrack = (x: readonly string[] | undefined, y: readonly string[] | undefined): boolean => !x || !y || x.some((t) => y.includes(t))

/** Do two stretches (seconds of one project) overlap? */
export const overlap = (x: Iv, xt: readonly string[] | undefined, y: Iv, yt: readonly string[] | undefined): boolean => x[0] < y[1] - EPS && y[0] < x[1] - EPS && sharesTrack(xt, yt)

/** Why `as` may not take `range` of `p`: another worker's region is there
 *  (who, and where it lies now). Null: it may. */
export function taken(list: readonly Region[], as: string, p: Project, range: Iv, tracks?: readonly string[]): { by: Region; at: Iv } | null {
  for (const r of list) {
    if (r.as === as) continue
    const at = placedIn(r, p) ?? [r.start, r.end]
    if (overlap(range, tracks, at, r.tracks)) return { by: r, at }
  }
  return null
}

/** Is everything an op names — its seconds, and the clips, lines, markers
 *  and G lane items it names by id — inside `range` of `p`? (An op that
 *  names no second and no such record is of no place: not inside.) */
export function opInside(p: Project, name: string, params: Record<string, unknown>, range: Iv): boolean {
  const [a, b] = range
  const schema = commandByName(name).params as never
  const times = timesIn(schema, params)
  if (times.some((t) => typeof t !== 'number' || t < a - EPS || t > b + EPS)) return false
  const ids = idsIn(schema, params, lastingId)
  const within = (x: number, y: number): boolean => x >= a - EPS && y <= b + EPS
  for (const id of ids) {
    const c = Object.hasOwn(p.clips, id) ? p.clips[id] : undefined
    if (c) {
      if (!within(c.start, c.start + c.duration)) return false
      continue
    }
    const l = p.captions.find((x) => x.id === id)
    const m = l ? undefined : p.markers?.find((x) => x.id === id)
    const g = l || m ? undefined : p.templates?.find((x) => x.id === id)
    if (l ? !within(l.start, l.end) : m ? !within(m.time, m.time) : g ? !within(g.start, g.start + (g.duration ?? 0)) : true) return false
  }
  return times.length + ids.length > 0
}

/** Another worker's region whose inside going from `before` to `after`
 *  changed (not: was shifted whole), as the sentence the agent is told; null
 *  when none. `same`: are two slabs the same film (replay.ts sameFilm). */
export function regionBreach(before: Project, after: Project, list: readonly Region[], as: string | undefined, same: (x: Project, y: Project) => boolean): string | null {
  for (const r of list) {
    if (r.as === (as ?? '')) continue
    const was = placedIn(r, before)
    if (!was) continue
    const now = carryRegion(before, after, was)
    if (now && Math.abs(now[1] - now[0] - (was[1] - was[0])) <= EPS && same(slab(before, was, r.tracks, true), slab(after, now, r.tracks, true))) continue
    return `it changes what is inside the region of worker "${r.as}" (${sayRange(was)}${r.tracks ? `, tracks ${r.tracks.join(', ')}` : ''}): not applied. Only that worker writes there`
  }
  return null
}
