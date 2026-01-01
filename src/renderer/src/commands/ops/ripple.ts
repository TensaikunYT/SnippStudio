// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Taking time out of the timeline and putting it in (moved out of
// state/store.ts in phase 2A, unchanged).
import type { Clip, Project } from '../../types'
import { assetById, instanceOf, templateEnd, uid } from '../../types'
import { automationOf, remapClipAutomation, sliceClipAutomation, sliceMotionFx } from '../../timeline/slice'
import { cutTimedLists, insertTimedLists, rippleCaptions } from '../../timeline/timed-lists'
import { clone, forgetClips, sortTrack } from './base'
import { partnersOf } from './links'
import { divideClipExtras, splitClipsIn } from './split'
import { takePart } from '../../timeline/media-time'
import { EPS } from '../../timeline/eps'

/** (The captions' cut lives in the register now: timeline/timed-lists.ts.) */
export { rippleCaptions }

/** A clip whose tail a cut took (it is `whole` seconds long before). */
function tailCut(c: Clip, whole: number, fades: boolean): void {
  delete c.fadeOut
  if (c.motionFx && whole > 0) c.motionFx = sliceMotionFx(c.motionFx, 0, c.duration / whole, 0)
  if (fades) c.fadeOut = CLICK_FADE
}

/** …and one whose head it took (`cut` seconds of it). */
function headCut(c: Clip, whole: number, cut: number, fades: boolean): void {
  delete c.fadeIn
  if (c.motionFx && whole > 0) c.motionFx = sliceMotionFx(c.motionFx, cut / whole, 1, cut)
  if (fades) c.fadeIn = CLICK_FADE
}

/** No cut leaves a piece of a clip shorter than this (phase Ç2b.1, K-3: a
 *  4A cut left a 1e-9 s clip behind); the piece goes with the cut (where it
 *  was, the track keeps a gap that short). The recipe asks 0.05 s: that
 *  took real frames from under subtitle words at the edge of an agent's
 *  cut (e2e 25 / 30), so 2 ms (FAZC2B-PLAN.md, karardan sapma). */
export const MIN_PIECE = 0.002
/** The silence cut's click guard: a fade this long on each new edge. */
const CLICK_FADE = 0.05

/** Ranges sorted and merged where they touch or overlap (no length limit). */
function joinRanges(ranges: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = []
  for (const [a, b] of [...ranges].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** The ranges a ripple of `ranges` takes out: sorted and merged. Pure. */
export function ripplePlan(ranges: readonly (readonly [number, number])[]): [number, number][] {
  return joinRanges(ranges)
}

/** Locked tracks a whole-timeline cut starting at `from` leaves behind: they
 *  have a clip that ends after it (phase Ç2b.1, decision 1: the cut is made,
 *  and the user is told these tracks are out of step now). */
export function lockedBehind(p: Project, from: number): Project['tracks'] {
  return p.tracks.filter((t) => t.locked && t.clipIds.some((id) => {
    const c = p.clips[id]
    return !!c && c.start + c.duration > from + EPS
  }))
}

/**
 * The one ripple (phase Ç2b.1, decision 1): `ranges` taken out of every
 * unlocked track (`scope` null: clips, subtitles, markers, notes, Shorts
 * bands and templates all move up together) or out of one track (`scope` its
 * id: nothing else moves). Merged, cut back to front so the earlier times
 * keep their meaning. No cut leaves a piece of a clip shorter than
 * MIN_PIECE: such a sliver goes with the cut (K-3), on its own track only —
 * the time taken out stays the same on every track, so nothing falls out of
 * step, and a sliver of under 0.05 s leaves a gap the player takes for a
 * join. `fades`: tiny sound fades on the
 * new edges (the silence cut's click guard). Returns the ranges taken out.
 *
 * `keepTracks` (çekirdek cila S, decision 2): tracks the cut leaves as they
 * are, as it leaves a locked one — a music bed under a silence cut is not
 * cut up and does not move. Not given, or empty: nothing changes (the agent,
 * the replay and the undo records never give it).
 */
export function rippleRange(p: Project, ranges: readonly (readonly [number, number])[], scope: string | null, opts: { fades?: boolean; keepTracks?: readonly string[] } = {}): [number, number][] {
  const plan = ripplePlan(ranges)
  const keep = opts.keepTracks?.length ? new Set(opts.keepTracks) : undefined
  for (let i = plan.length - 1; i >= 0; i--) rippleDeleteRange(p, plan[i][0], plan[i][1], scope, opts.fades, keep)
  return plan
}

/** A music clip that has no fade-out of its own ends with one this long
 *  where the film now ends (endBeds). */
export const BED_FADE = 1

/** Where everything but the `keep` tracks ends: the clips of the other
 *  tracks, the captions, the templates (types.ts projectDuration without
 *  those tracks). */
export function restEnd(p: Project, keep: ReadonlySet<string>): number {
  let end = 0
  for (const t of p.tracks) {
    if (keep.has(t.id)) continue
    for (const id of t.clipIds) {
      const c = p.clips[id]
      if (c) end = Math.max(end, c.start + c.duration)
    }
  }
  for (const c of p.captions ?? []) end = Math.max(end, c.end)
  for (const t of p.templates ?? []) end = Math.max(end, templateEnd(t))
  return end
}

/**
 * The music ends with the film (çekirdek cila S, decision 3). A cut that
 * left the `keep` tracks alone made everything else `was − restEnd(p)`
 * shorter; a clip of a kept track that now runs further past the end of the
 * rest than it did before is cut back to where it ran to then (the same
 * tail after the last picture, none when it had none). It keeps its
 * fade-out; one without gets BED_FADE (a song stopped in its middle). A
 * clip that would begin after that point goes. `was`: restEnd before the
 * cut. Locked tracks are left as they are. Returns the clips it changed.
 */
export function endBeds(p: Project, keepTracks: readonly string[], was: number): string[] {
  const keep = new Set(keepTracks)
  const now = restEnd(p, keep)
  if (!(now > 0) || now >= was - EPS) return []
  const changed: string[] = []
  const removed: string[] = []
  for (const track of p.tracks) {
    if (!keep.has(track.id) || track.locked) continue
    for (const id of [...track.clipIds]) {
      const clip = p.clips[id]
      if (!clip) continue
      const end = clip.start + clip.duration
      const to = now + Math.max(0, end - was)
      if (end <= to + EPS) continue
      changed.push(id)
      if (clip.start >= to - MIN_PIECE) {
        removed.push(id)
        track.clipIds = track.clipIds.filter((x) => x !== id)
        delete p.clips[id]
        continue
      }
      const whole = clip.duration
      const source = automationOf(clip)
      takePart(clip, clip, 0, to - clip.start)
      clip.duration = to - clip.start
      sliceClipAutomation(clip, 0, clip.duration, source)
      if (clip.motionFx && whole > 0) clip.motionFx = sliceMotionFx(clip.motionFx, 0, clip.duration / whole, 0)
      if (!(clip.fadeOut && clip.fadeOut > 0)) clip.fadeOut = Math.min(BED_FADE, clip.duration / 2)
    }
  }
  forgetClips(p, removed)
  return changed
}

export function rippleDeleteRange(p: Project, a: number, b: number, trackScope: string | readonly string[] | null, fades = false, keep?: ReadonlySet<string>): void {
  const range = b - a
  // (Several tracks at once, 22 Nov K3: a linked pair cut through on two of
  // them gets ONE fresh link for its right pieces.)
  const scoped = trackScope === null ? null : new Set(typeof trackScope === 'string' ? [trackScope] : trackScope)
  const removed: string[] = []
  // The right pieces of a linked pair cut here share a fresh link of their
  // own (as a split gives): with the old one, every piece of a silence cut
  // was every other piece's partner, so deleting one deleted the whole talk.
  const freshLinks = new Map<string, string>()
  const linksTouched = new Set<string>()
  for (const track of p.tracks) {
    if (track.locked) continue
    if (scoped && !scoped.has(track.id)) continue
    if (keep?.has(track.id)) continue
    const kept: string[] = []
    for (const id of [...track.clipIds]) {
      const clip = p.clips[id]
      if (!clip) continue
      const cs = clip.start
      const ce = cs + clip.duration
      const whole = clip.duration
      // The clip's automation as it was, for every piece cut from it: each
      // piece keeps the keys inside it, with a key at a cut that falls
      // between two (timeline/slice.ts). Dropping the keys outside a piece
      // with none at its edges made a slow push-in a still shot that jumped
      // at every cut of a silence removal.
      const source = automationOf(clip)
      /** The piece `c` (its duration already set) is the original's clip-local
       *  window from `d` on. */
      const shiftInner = (c: Clip, d: number) => {
        sliceClipAutomation(c, d, d + c.duration, source, { freshIds: c !== clip })
      }
      // The pieces the cut leaves: one shorter than MIN_PIECE goes with the
      // cut (K-3; it would be a sliver nobody can see, pick or trim).
      const leftKept = cs < a && a - cs >= MIN_PIECE - 1e-9
      const rightKept = ce > b && ce - b >= MIN_PIECE - 1e-9
      if (ce <= a) {
        kept.push(id)
      } else if (cs >= b) {
        clip.start = cs - range
        kept.push(id)
      } else if (leftKept && rightKept) {
        // Clip spans the whole range: split into left + right pieces.
        const right: Clip = { ...clone(clip), id: uid(), instance: instanceOf(clip) }
        if (clip.linkId) {
          if (!freshLinks.has(clip.linkId)) freshLinks.set(clip.linkId, uid())
          linksTouched.add(clip.linkId)
          right.linkId = freshLinks.get(clip.linkId)
        }
        // Each piece shows the media it showed (a backwards clip's right
        // piece holds the media before its left one's: timeline/media-time.ts).
        takePart(right, clip, b - cs, whole)
        takePart(clip, clip, 0, a - cs)
        clip.duration = a - cs
        shiftInner(clip, 0)
        right.start = a
        right.duration = ce - b
        shiftInner(right, b - cs)
        divideClipExtras(p, clip, right, whole, a - cs, b - cs)
        if (fades) {
          clip.fadeOut = CLICK_FADE
          right.fadeIn = CLICK_FADE
        }
        p.clips[right.id] = right
        kept.push(id, right.id)
      } else if (leftKept) {
        takePart(clip, clip, 0, a - cs)
        clip.duration = a - cs
        shiftInner(clip, 0)
        // Its tail is gone: the fade-out was the tail's, a slow push or pan
        // stops where the clip now ends (as the silence cut always did).
        tailCut(clip, whole, fades)
        kept.push(id)
      } else if (rightKept) {
        const cut = b - cs
        takePart(clip, clip, cut, whole)
        clip.duration = ce - b
        clip.start = a
        shiftInner(clip, cut)
        headCut(clip, whole, cut, fades)
        kept.push(id)
      } else {
        removed.push(id)
        if (clip.linkId) linksTouched.add(clip.linkId)
        delete p.clips[id]
      }
    }
    track.clipIds = kept
    sortTrack(p, track)
  }
  forgetClips(p, removed)
  // A link this cut left on one clip only joins nothing: it goes.
  if (linksTouched.size) {
    const watch = new Set([...linksTouched, ...freshLinks.values()])
    const count = new Map<string, Clip[]>()
    for (const c of Object.values(p.clips)) if (c.linkId && watch.has(c.linkId)) count.set(c.linkId, [...(count.get(c.linkId) ?? []), c])
    for (const list of count.values()) if (list.length < 2) for (const c of list) delete c.linkId
  }
  // The timeline's other timed lists ride along only when cutting the whole
  // timeline (no scope): captions, markers, notes, the Shorts bands and pan,
  // the trackers, the templates — every one in the register
  // (timeline/timed-lists.ts, phase Ç2c.2, decision 3).
  if (!scoped) cutTimedLists(p, a, b)
}

/** How `closeTracks` is asked (22 Nov, K3). */
export interface CloseOptions {
  /** The A/V link counts: the linked partners of what moves follow. Off:
   *  only the named tracks change (the user's link switch is off). */
  linked?: boolean
  /** The clips the cut is made FOR (a Q / W target and its partners): a
   *  pair of them is trimmed together, so neither is asked to "follow". */
  members?: readonly string[]
  /** A track's own place for the cut, the same length (a partner that
   *  starts earlier or ends later than its picture loses its own edge). */
  at?: Readonly<Record<string, readonly [number, number]>>
}

export interface ClosePlan {
  /** The named tracks the cut is made on (they exist and are not locked). */
  tracks: string[]
  /** Other tracks that move up with them: everything on one that starts at
   *  or after the end of the range comes `b − a` earlier. */
  followers: string[]
  /** Set: the tracks cannot close without pulling a linked pair apart; the
   *  id of the track in the way (locked, or with material in the range, or
   *  holding the half of a pair that would stay). */
  blockedBy?: string
}

/**
 * What closing `range` on `trackIds` only does to the linked pairs (22 Nov,
 * K3: Q / W on a still with no sound moved the talking clip after it and
 * left that clip's linked sound where it was, 3 s late, and said nothing).
 * A clip that moves up (it starts in or after the range on a closed track)
 * takes its linked partner the same distance; the partner's track becomes a
 * follower: all of it from the end of the range on moves up, so what was
 * laid against the partner stays against it. That goes on from track to
 * track. It cannot be done when a follower is locked or has material inside
 * the range (moving up would lay clips over it), or when one clip of a pair
 * moves and the other stays or is cut in two: then `blockedBy` is set and
 * nothing may close. Pure, changes nothing.
 */
export function closePlan(p: Project, range: readonly [number, number], trackIds: readonly string[], opts: CloseOptions = {}): ClosePlan {
  const [a, b] = range
  const tracks = [...new Set(trackIds)].filter((id) => p.tracks.some((t) => t.id === id && !t.locked))
  if (!opts.linked || !(b > a)) return { tracks, followers: [] }
  const closing = new Set(tracks)
  const followers = new Set<string>()
  const members = new Set(opts.members ?? [])
  const at = (trackId: string): readonly [number, number] => opts.at?.[trackId] ?? range
  /** What the cut does to a clip: it comes `b − a` earlier (whole, or what
   *  is left of it after its head was cut), it stays (its start and what it
   *  shows there), it is cut in two, or it is gone. */
  const fate = (c: Clip): 'moves' | 'stays' | 'split' | 'gone' => {
    const cs = c.start
    const ce = c.start + c.duration
    if (closing.has(c.trackId)) {
      const [ta, tb] = at(c.trackId)
      if (ce <= ta + EPS) return 'stays'
      if (cs >= ta - EPS) return ce <= tb + EPS ? 'gone' : 'moves'
      return ce > tb + EPS ? 'split' : 'stays'
    }
    return followers.has(c.trackId) && cs >= b - EPS ? 'moves' : 'stays'
  }
  const linked = Object.values(p.clips).filter((c) => !!c.linkId)
  // (Two members both cut here are one trim; a member the cut does not
  // reach is a partner like any other: it must follow.)
  const pair = (c: Clip, o: Clip): boolean => members.has(c.id) && members.has(o.id) && closing.has(c.trackId) && closing.has(o.trackId)
  for (let round = 0; round <= p.tracks.length; round++) {
    let grew = false
    for (const c of linked) {
      if (fate(c) !== 'moves') continue
      for (const o of partnersOf(p, c)) {
        if (pair(c, o) || closing.has(o.trackId) || followers.has(o.trackId)) continue
        // An untouched track: it follows, when it can.
        const track = p.tracks.find((t) => t.id === o.trackId)
        if (!track || track.locked) return { tracks, followers: [...followers], blockedBy: o.trackId }
        const inTheWay = track.clipIds.some((id) => {
          const x = p.clips[id]
          return !!x && x.start < b - EPS && x.start + x.duration > a + EPS
        })
        if (inTheWay) return { tracks, followers: [...followers], blockedBy: o.trackId }
        followers.add(o.trackId)
        grew = true
      }
    }
    if (!grew) break
  }
  // Every pair in step: what moves has no partner that stays or is halved.
  for (const c of linked) {
    const f = fate(c)
    if (f !== 'moves' && f !== 'split') continue
    for (const o of partnersOf(p, c)) {
      if (pair(c, o)) continue
      const g = fate(o)
      if (f === 'moves' ? g === 'stays' || g === 'split' : g !== 'split') return { tracks, followers: [...followers], blockedBy: o.trackId }
    }
  }
  return { tracks, followers: [...followers] }
}

/**
 * The one track-only close (22 Nov, K3): `range` taken out of `trackIds`
 * (not the whole timeline: subtitles, markers and the other tracks stay),
 * the clips after it on those tracks moved up, and with them — the link on —
 * their linked partners on other tracks (closePlan). Q / W, a range cut out
 * of one track and "close this track's gap" all end here.
 *
 * When the pairs cannot stay in step (`blockedBy`), the range is still
 * taken out but NOTHING moves up: the gap stays where the material was, as
 * a ripple delete leaves it when another track has material there (Ç2b
 * patch, item 3). Cutting the track in the way would take material nobody
 * picked; closing anyway is the silent loss of sync this replaces. The
 * caller says so (the returned plan).
 */
export function closeTracks(p: Project, range: readonly [number, number], trackIds: readonly string[], opts: CloseOptions = {}): ClosePlan {
  const plan = closePlan(p, range, trackIds, opts)
  const [a, b] = range
  if (!(b > a)) return plan
  // Tracks cut at the same place go in one pass (a pair cut through on two
  // of them keeps one link for its right pieces).
  const places = new Map<string, { at: readonly [number, number]; tracks: string[] }>()
  for (const id of plan.tracks) {
    const at = opts.at?.[id] ?? range
    const key = `${at[0]}:${at[1]}`
    places.set(key, { at, tracks: [...(places.get(key)?.tracks ?? []), id] })
  }
  for (const { at, tracks } of places.values()) {
    rippleDeleteRange(p, at[0], at[1], tracks)
    if (plan.blockedBy === undefined) continue
    // Not closed: what the cut moved up goes back (the gap stays).
    for (const id of tracks) {
      const track = p.tracks.find((t) => t.id === id)
      if (!track) continue
      for (const cid of track.clipIds) {
        const c = p.clips[cid]
        if (c && c.start >= at[0] - EPS) c.start += at[1] - at[0]
      }
      sortTrack(p, track)
    }
  }
  if (plan.blockedBy !== undefined) return plan
  for (const id of plan.followers) {
    const track = p.tracks.find((t) => t.id === id)
    if (!track) continue
    for (const cid of track.clipIds) {
      const c = p.clips[cid]
      if (c && c.start >= b - EPS) c.start -= b - a
    }
    sortTrack(p, track)
  }
  return plan
}

/** A stretch of one track that was emptied (a deleted clip's place). */
export interface TrackSpan {
  trackId: string
  range: readonly [number, number]
}

export interface SpansPlan {
  /** What closes up on each track, merged and sorted: its own spans, and the
   *  stretches it takes on so that a linked pair stays in step. */
  cuts: Record<string, [number, number][]>
  /** Tracks that had no span of their own and move up with a partner. */
  followers: string[]
  /** Set: a linked pair could not stay in step; the track in the way
   *  (locked, material in the stretch, or the half of a pair that would
   *  stay). Then NOTHING closes. */
  blockedBy?: string
}

/** `ranges` without what `cut` (merged, sorted) covers. */
function without(ranges: readonly (readonly [number, number])[], cut: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = []
  for (const [a0, b0] of ranges) {
    let at = a0
    for (const [ca, cb] of cut) {
      if (cb <= at + EPS || ca >= b0 - EPS) continue
      if (ca > at + EPS) out.push([at, ca])
      at = Math.max(at, cb)
    }
    if (b0 > at + EPS) out.push([at, b0])
  }
  return out
}

/**
 * Emptied stretches on several tracks closed together, the linked pairs
 * kept in step (22 Nov, K3's last open way: Alt + ripple delete closed each
 * clip's own track and left the linked sound of what moved up where it was).
 *
 * The stretches differ from track to track and may overlap across tracks
 * (V1 lost 5–10, V2 lost 6–12), so nothing is worked out by closing one
 * track and then looking at the next: a track closed first could carry
 * material into a stretch not handled yet, and the next close would take it.
 * Everything is planned on the timeline AS IT IS, in its own times:
 *  - each track gets a set of stretches (`cuts`): at first its own spans;
 *  - a clip comes earlier by the length of its track's stretches before it;
 *  - where a linked pair would then come apart, the partner's track takes
 *    on the stretches the clip's track loses before the clip (that track
 *    becomes a follower if it had none), until every pair agrees;
 *  - a track can take a stretch on only when it is not locked, has nothing
 *    in it, and the partner lies after it. Otherwise: `blockedBy`.
 * Closing is then a move and nothing else: every stretch is empty on its
 * track, so no clip is ever cut. `gone`: clips about to be deleted (the plan
 * made before the delete). Pure, changes nothing.
 */
export function closeSpansPlan(p: Project, spans: readonly TrackSpan[], opts: { linked?: boolean; gone?: ReadonlySet<string> } = {}): SpansPlan {
  const gone = opts.gone ?? new Set<string>()
  const open = new Set(p.tracks.filter((t) => !t.locked).map((t) => t.id))
  const cuts = new Map<string, [number, number][]>()
  for (const sp of spans) {
    if (!open.has(sp.trackId) || !(sp.range[1] > sp.range[0])) continue
    cuts.set(sp.trackId, joinRanges([...(cuts.get(sp.trackId) ?? []), sp.range]))
  }
  const own = new Set(cuts.keys())
  const done = (blockedBy?: string): SpansPlan => ({
    cuts: Object.fromEntries(cuts),
    followers: [...cuts.keys()].filter((id) => !own.has(id)),
    ...(blockedBy !== undefined ? { blockedBy } : {})
  })
  if (!opts.linked || cuts.size === 0) return done()
  const before = (trackId: string, start: number): [number, number][] => (cuts.get(trackId) ?? []).filter(([, b]) => b <= start + EPS)
  const shift = (c: Clip): number => before(c.trackId, c.start).reduce((n, [a, b]) => n + b - a, 0)
  const clips = Object.values(p.clips).filter((c) => !gone.has(c.id))
  const linked = clips.filter((c) => !!c.linkId)
  const partners = (c: Clip): Clip[] => linked.filter((o) => o.id !== c.id && o.linkId === c.linkId && o.trackId !== c.trackId)
  // (The sets only grow, out of the spans' own edges: this ends. The cap is
  // for a project that breaks the model's rules.)
  for (let round = 0; round < 64; round++) {
    let grew = false
    for (const c of linked) {
      for (const o of partners(c)) {
        if (Math.abs(shift(c) - shift(o)) < EPS) continue
        // What c's track loses before c and o's track does not: o's takes it on.
        const need = without(before(c.trackId, c.start), cuts.get(o.trackId) ?? [])
        if (need.length === 0) continue
        if (!open.has(o.trackId)) return done(o.trackId)
        for (const [a, b] of need) {
          // o would not come earlier by a stretch that is not before it…
          if (b > o.start + EPS) return done(o.trackId)
          // …and nothing of o's track may lie in it.
          if (clips.some((x) => x.trackId === o.trackId && x.start < b - EPS && x.start + x.duration > a + EPS)) return done(o.trackId)
        }
        cuts.set(o.trackId, joinRanges([...(cuts.get(o.trackId) ?? []), ...need]))
        grew = true
      }
    }
    if (!grew) break
  }
  // Every pair in step, or nothing closes.
  for (const c of linked) for (const o of partners(c)) if (Math.abs(shift(c) - shift(o)) >= EPS) return done(o.trackId)
  return done()
}

/** closeSpansPlan carried out: the clips after each stretch moved up (none
 *  is cut: the stretches are empty). Blocked: nothing moves; the caller says
 *  so (the returned plan). */
export function closeSpans(p: Project, spans: readonly TrackSpan[], opts: { linked?: boolean } = {}): SpansPlan {
  const plan = closeSpansPlan(p, spans, opts)
  if (plan.blockedBy !== undefined) return plan
  for (const [trackId, ranges] of Object.entries(plan.cuts)) {
    const track = p.tracks.find((t) => t.id === trackId)
    if (!track || track.locked) continue
    for (const id of track.clipIds) {
      const c = p.clips[id]
      if (!c) continue
      const from = c.start
      // (Back to front, one stretch at a time: the same sums a ripple makes.)
      for (let i = ranges.length - 1; i >= 0; i--) if (ranges[i][1] <= from + EPS) c.start -= ranges[i][1] - ranges[i][0]
    }
    sortTrack(p, track)
  }
  return plan
}

/**
 * Seconds of time (hold) put in at t on every unlocked track but skipTrack
 * (whose own clips the caller moved): a media clip running through t is
 * cut there and its rest moved on (the voice pauses with the frozen
 * picture); a still, a title or an adjustment running through it is
 * stretched instead (it stays on screen through the hold); everything after
 * moves on. Markers, Shorts bands and the templates after
 * t move too. Subtitles follow their voice clip (followClipEdits). A locked
 * track stays as it is (phase Ç2b.1, decision 3: a partner on it was cut and
 * moved over the clips after it); the freeze frame is refused before when
 * the clip's partner is on one.
 */
export function insertTimeElsewhere(p: Project, t: number, hold: number, skipTrack: string, linkId?: string): void {
  for (const track of p.tracks) {
    if (track.id === skipTrack) continue
    const clips = track.clipIds.map((id) => p.clips[id]).filter((c): c is Clip => !!c)
    void linkId
    if (track.locked) continue
    for (const c of clips) {
      // (A cut within MIN_PIECE of an edge would leave a sliver, K-3: the
      // clip moves on whole, or is not cut at all.)
      if (c.start >= t - MIN_PIECE) {
        c.start += hold
        continue
      }
      if (c.start + c.duration <= t + MIN_PIECE) continue
      const asset = assetById(p, c.assetId)
      const media = !!asset && (asset.kind === 'video' || asset.kind === 'audio') && !c.nested
      if (!media) {
        // Its keys after t move on with what they were timed to (report K18:
        // they stayed, so its motion ran `hold` ahead of the footage).
        const at = t - c.start
        c.duration += hold
        remapClipAutomation(c, (x) => (x > at ? x + hold : x))
        continue
      }
      const [rightId] = splitClipsIn(p, [c], t)
      const right = rightId ? p.clips[rightId] : undefined
      if (right) right.start += hold
    }
    sortTrack(p, track)
  }
  // Every timed list of the register (phase Ç2c.2, decision 3).
  insertTimedLists(p, t, hold)
}
