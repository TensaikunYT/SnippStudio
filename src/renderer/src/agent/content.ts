// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Content addressing (SnippStudio phase 4A.9, FAZ4A-YENIDEN.md A1), pure.
//
// What lasts in an edit is not a second of the timeline but content: "second
// 14.2 of this footage". An agent's seconds mean something only in the
// version it read, so each is turned, in that version's project, into a
// content point (a clip instance and a second of its source), and found
// again in the project as it is when the edit is applied.
//
// Only one-to-one media has content points: a video, sound or code clip
// without a freeze. A still, a held frame, a title, an adjustment layer or a
// compound clip shows the same thing at many times (or none of its own), so
// it never anchors a time.
import type { Clip, Project } from '../types'
import { instanceOf } from '../types'
import { shownAt } from '../notes/model'
import { voiceTrackVotes } from '../subtitles/follow'
import { localAtMedia } from '../timeline/media-time'
import { hasCurve } from '../timeline/speed-curve'

export type Iv = [number, number]
const EPS = 1e-7

const speedOf = (c: Clip): number => Math.max(0.01, c.speed ?? 1)

/** Does a time on this clip name one moment of its source? */
export function oneToOne(p: Project, c: Clip): boolean {
  if (c.freeze !== undefined || c.nested || c.adjustment) return false
  const a = assetsOf(p).get(c.assetId)
  return !!a && (a.kind === 'video' || a.kind === 'audio' || a.kind === 'code')
}

/** The timeline time at which a clip shows second `m` of its source (the
 *  inverse of notes/model.ts shownAt, reversed clips included). */
export const timeOfShown = (c: Clip, m: number): number =>
  hasCurve(c) ? c.start + localAtMedia(c, m) : c.reversed ? c.start + c.duration - (m - c.inPoint) / speedOf(c) : c.start + (m - c.inPoint) / speedOf(c)

/** The source seconds a clip shows, low to high. */
export function windowOf(c: Clip): Iv {
  const a = shownAt(c, c.start)
  const b = shownAt(c, c.start + c.duration)
  return a <= b ? [a, b] : [b, a]
}

// ---- intervals ---------------------------------------------------------------

export const lenOf = (list: readonly Iv[]): number => list.reduce((n, [a, b]) => n + b - a, 0)

export function merge(list: readonly Iv[], eps = 1e-9): Iv[] {
  const out: Iv[] = []
  for (const [a, b] of [...list].filter(([x, y]) => y > x).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + eps) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

export function overlap(x: readonly Iv[], y: readonly Iv[]): Iv[] {
  const out: Iv[] = []
  for (const [a, b] of x) for (const [c, d] of y) if (Math.min(b, d) > Math.max(a, c)) out.push([Math.max(a, c), Math.min(b, d)])
  return merge(out)
}

export function without(x: readonly Iv[], y: readonly Iv[]): Iv[] {
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

// ---- a project's index (projects are immutable: made once each) ----------------

interface Index {
  assets: Map<string, Project['assets'][number]>
  /** Clips by content instance. */
  byInstance: Map<string, Clip[]>
  /** Each track's clips in time order. */
  byTrack: Map<string, Clip[]>
}

const indexes = new WeakMap<Project, Index>()

function indexOf(p: Project): Index {
  let x = indexes.get(p)
  if (x) return x
  const byInstance = new Map<string, Clip[]>()
  for (const c of Object.values(p.clips)) {
    const k = instanceOf(c)
    const list = byInstance.get(k)
    if (list) list.push(c)
    else byInstance.set(k, [c])
  }
  const byTrack = new Map<string, Clip[]>()
  for (const t of p.tracks) byTrack.set(t.id, t.clipIds.map((id) => p.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start))
  x = { assets: new Map(p.assets.map((a) => [a.id, a])), byInstance, byTrack }
  indexes.set(p, x)
  return x
}

const assetsOf = (p: Project): Index['assets'] => indexOf(p).assets
export const clipsOn = (p: Project, track: string): Clip[] => indexOf(p).byTrack.get(track) ?? []
export const piecesOf = (p: Project, instance: string): Clip[] => indexOf(p).byInstance.get(instance) ?? []
export const isLocked = (p: Project, track: string): boolean => !!p.tracks.find((t) => t.id === track)?.locked

// ---- points --------------------------------------------------------------------

/** A moment of content: second `m` of the source of instance `inst`. */
export interface Point {
  inst: string
  m: number
}

/** The one-to-one clip of `track` playing at `t` (a time on a join is the
 *  later clip's; with `endSide`, the earlier one's). */
export function clipAt(p: Project, track: string, t: number, endSide = false): Clip | undefined {
  const list = clipsOn(p, track)
  const fits = (c: Clip): boolean => {
    const a = c.start
    const b = c.start + c.duration
    return (endSide ? t > a + EPS && t <= b + EPS : t >= a - EPS && t < b - EPS) && oneToOne(p, c)
  }
  // The clips are in time order: the last one starting at or before t, and
  // its neighbours (clips may overlap on a track for a moment of a drag).
  let lo = 0
  let hi = list.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (list[mid].start <= t + EPS) lo = mid
    else hi = mid - 1
  }
  for (let i = Math.min(list.length - 1, lo + 1); i >= 0 && i >= lo - 3; i--) if (fits(list[i])) return list[i]
  return undefined
}

export function pointAt(p: Project, track: string, t: number, endSide = false): Point | null {
  const c = clipAt(p, track, t, endSide)
  return c ? { inst: instanceOf(c), m: shownAt(c, t) } : null
}

export type Located = { clip: Clip; time: number } | 'gone' | 'ambiguous'

/** Where a moment of content is in `p` now. `endSide`: the point is the end
 *  of something (it belongs to the piece that ends there). */
export function locate(p: Project, pt: Point, endSide = false): Located {
  let hit: Clip | undefined
  for (const c of piecesOf(p, pt.inst)) {
    if (!oneToOne(p, c)) continue
    const [lo, hi] = windowOf(c)
    // The side of a piece a boundary second belongs to follows the way the
    // piece plays: forwards, its low edge is its start.
    const startsLow = !c.reversed
    const inside = (endSide ? !startsLow : startsLow) ? pt.m >= lo - EPS && pt.m < hi - EPS : pt.m > lo + EPS && pt.m <= hi + EPS
    if (!inside) continue
    if (hit) return 'ambiguous'
    hit = c
  }
  return hit ? { clip: hit, time: timeOfShown(hit, pt.m) } : 'gone'
}

// ---- anchors -------------------------------------------------------------------

/**
 * The track whose content a time of the project is about (the primary
 * anchor): the track of the subtitles' voice; with no subtitles, the one
 * unlocked track of talking pictures (their own sound, or their sound taken
 * out); with no sound at all, the lowest unlocked track with one-to-one
 * media. Never chosen by length: a row of stills or a music bed under a talk
 * is not what the agent's seconds are about. Null when it cannot be told.
 */
export function anchorTrack(p: Project): string | null {
  const cached = anchors.get(p)
  if (cached !== undefined) return cached
  const found = findAnchor(p)
  anchors.set(p, found)
  return found
}
const anchors = new WeakMap<Project, string | null>()

function findAnchor(p: Project): string | null {
  // The track most subtitle lines have their voice on (most lines first; the
  // lower track on a tie).
  const votes = new Map<string, number>()
  for (const [track, n] of voiceTrackVotes(p)) if (clipsOn(p, track).some((c) => oneToOne(p, c))) votes.set(track, n)
  if (votes.size) {
    const order = new Map(p.tracks.map((t, i) => [t.id, i]))
    return [...votes].sort((a, b) => b[1] - a[1] || (order.get(b[0]) ?? 0) - (order.get(a[0]) ?? 0))[0][0]
  }
  // No subtitles (phase 4A.10, A2): NEVER the track with the most sound — a
  // music bed longer than the talk is not what the agent's seconds are
  // about. The talk is the picture that carries its own sound, or the sound
  // taken out of a picture (its linked partner). One such track: that one.
  // Several, or none and more than one sound track: it cannot be told, and
  // there is no anchor (the edit is then made literally, or not at all).
  const fromPicture = new Set(Object.values(p.clips).filter((c) => c.audioExtracted && c.linkId).map((c) => c.linkId))
  const talk = new Set<string>()
  const sound = new Set<string>()
  for (const c of Object.values(p.clips)) {
    const a = assetsOf(p).get(c.assetId)
    // (Locked or not: which track the talk is on does not change with a lock;
    // an op whose anchor is locked follows nothing.)
    // (A clip whose sound is off — muted, or at volume 0 — is no talk and no
    // sound: stock footage under a voice-over carries a silent track. K5.)
    if (!a || !oneToOne(p, c) || c.muted || (c.volume ?? 1) <= 0) continue
    const own = a.kind !== 'audio' && !!a.hasAudio && !c.audioExtracted
    if (own || (a.kind === 'audio' && !!c.linkId && fromPicture.has(c.linkId))) talk.add(c.trackId)
    if (own || a.kind === 'audio') sound.add(c.trackId)
  }
  if (talk.size) return talk.size === 1 ? [...talk][0] : null
  if (sound.size) return sound.size === 1 ? [...sound][0] : null
  for (let i = p.tracks.length - 1; i >= 0; i--) {
    const t = p.tracks[i]
    if (clipsOn(p, t.id).some((c) => oneToOne(p, c))) return t.id
  }
  return null
}

/** Two clips of `track` that lie over each other (a linked drag can leave
 *  them so: plan 7.4, K-4), or null. A ripple cut through such a place has
 *  no one meaning. */
export function overlapOn(p: Project, track: string): [string, string] | null {
  const list = [...clipsOn(p, track)].sort((a, b) => a.start - b.start)
  for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].start + list[i - 1].duration - 1e-6) return [list[i - 1].id, list[i].id]
  return null
}

/**
 * A range of `from`'s timeline as the same footage's range on `to`'s (by the
 * anchor track's content), or null when it cannot be placed there (no
 * footage under an end, footage `to` does not have, ends that changed
 * order). The notes tool uses it: ranges an agent names while its draft
 * waits are the draft's seconds; a note is the live project's (phase 4A.9,
 * V-accept-ids-6: stored as given, they were moved by the draft's cuts a
 * second time on accept).
 */
export function carryRange(from: Project, to: Project, range: readonly [number, number]): [number, number] | null {
  if (from === to) return [range[0], range[1]]
  const anchor = anchorTrack(from)
  if (!anchor) return null
  const a = pointAt(from, anchor, range[0]) ?? pointAt(from, anchor, range[0], true)
  const b = pointAt(from, anchor, range[1], true) ?? pointAt(from, anchor, range[1])
  if (!a || !b) return null
  const la = locate(to, a)
  const lb = locate(to, b, true)
  const start = typeof la === 'string' ? locate(to, a, true) : la
  const end = typeof lb === 'string' ? locate(to, b) : lb
  if (typeof start === 'string' || typeof end === 'string' || end.time < start.time - 1e-9) return null
  return [start.time, end.time]
}

// ---- ranges --------------------------------------------------------------------

/** A stretch of content: source seconds [lo, hi] of an instance. */
export interface Piece {
  inst: string
  lo: number
  hi: number
}

/** The content of `track` in [a, b), and whether the range lies wholly on
 *  one-to-one content of that track. */
export function piecesIn(p: Project, track: string, a: number, b: number): { pieces: Piece[]; covered: boolean } {
  const pieces: Piece[] = []
  const spans: Iv[] = []
  for (const c of clipsOn(p, track)) {
    const lo = Math.max(a, c.start)
    const hi = Math.min(b, c.start + c.duration)
    if (hi - lo <= 1e-9 || !oneToOne(p, c)) continue
    const x = shownAt(c, lo)
    const y = shownAt(c, hi)
    pieces.push({ inst: instanceOf(c), lo: Math.min(x, y), hi: Math.max(x, y) })
    spans.push([lo, hi])
  }
  const joined = merge(spans, 1e-6)
  return { pieces, covered: joined.length === 1 && joined[0][0] <= a + 1e-6 && joined[0][1] >= b - 1e-6 }
}

/** Where pieces of content play now: timeline ranges, in order, touching
 *  ones joined. */
export function spansOf(p: Project, pieces: readonly Piece[]): Iv[] {
  const out: Iv[] = []
  for (const piece of pieces) {
    for (const c of piecesOf(p, piece.inst)) {
      if (!oneToOne(p, c)) continue
      for (const [lo, hi] of overlap([windowOf(c)], [[piece.lo, piece.hi]])) {
        const x = timeOfShown(c, lo)
        const y = timeOfShown(c, hi)
        out.push([Math.min(x, y), Math.max(x, y)])
      }
    }
  }
  return merge(out, 1e-6)
}

/** The source seconds of an instance a project still shows (on any track). */
export function coverOf(p: Project, inst: string): Iv[] {
  return merge(piecesOf(p, inst).filter((c) => oneToOne(p, c)).map(windowOf))
}
