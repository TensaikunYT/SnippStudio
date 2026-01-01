// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Taking time out: ranges cut out of the whole timeline (everything after
// moves up), a range out of one track, out of the subtitles only, and the
// silence cut. Bodies as they were in state/store.ts (phase 2A).
import type { Clip, Project } from '../types'
import { closePlan, closeTracks, endBeds, restEnd, rippleCaptions, rippleRange, type CloseOptions, type ClosePlan } from './ops/ripple'
import { onLockedTrack, partnersOf } from './ops/links'
import { defineCommand } from './core'
import { requireClip, requireTrack } from './require'
import { EPS } from '../timeline/eps'
import { s, type Infer, type Schema } from './schema'

/**
 * The store's own, not parameters by name (çekirdek cila S, decisions 2 and
 * 3; like the trims' `base`): they are not in the schema, so an agent's call
 * cannot give them and its tool definitions do not know them.
 * `keepTracks`: tracks the cut leaves as they are (a music bed).
 * `endBeds`: a clip of those tracks that then runs on past the end of the
 * rest is cut back there (ops/ripple.ts endBeds).
 */
export interface KeepParams {
  keepTracks?: readonly string[]
  endBeds?: boolean
}

/**
 * The tracks a cut made for `sources` (the clips whose pauses or words are
 * cut) leaves alone when "music and other sounds are not cut" is on: an
 * unlocked audio track that holds none of the sources, no clip linked to a
 * clip on another track (the sound of a picture stays with its picture) and
 * is not the sound-effects track (an effect belongs to a moment of the
 * picture). With no source on any track nothing is kept. Pure.
 */
export function bedTracks(p: Project, sources: readonly string[]): string[] {
  const src = new Set(sources.filter((id) => !!p.clips[id]))
  if (src.size === 0) return []
  const linksOn = new Map<string, Set<string>>()
  for (const c of Object.values(p.clips)) {
    if (!c.linkId) continue
    const on = linksOn.get(c.linkId) ?? new Set<string>()
    on.add(c.trackId)
    linksOn.set(c.linkId, on)
  }
  return p.tracks
    .filter((t) => t.kind === 'audio' && !t.locked && t.role !== 'sfx' && t.clipIds.length > 0)
    .filter((t) => !t.clipIds.some((id) => {
      const c = p.clips[id]
      return !!c && (src.has(id) || (!!c.linkId && (linksOn.get(c.linkId)?.size ?? 0) > 1))
    }))
    .map((t) => t.id)
}

/** A cut of `ranges` out of the whole timeline, leaving `keep.keepTracks`
 *  (and ending their clips with the rest when asked). */
function cutKeeping(p: Project, ranges: readonly (readonly [number, number])[], keep: KeepParams, fades = false): [number, number][] {
  const tracks = keep.keepTracks?.filter((id) => p.tracks.some((t) => t.id === id)) ?? []
  const was = tracks.length && keep.endBeds ? restEnd(p, new Set(tracks)) : 0
  const cut = rippleRange(p, ranges, null, { fades, ...(tracks.length ? { keepTracks: tracks } : {}) })
  if (tracks.length && keep.endBeds) endBeds(p, tracks, was)
  return cut
}

/** Ranges as one cut list: too short ones (under 0.02 s) dropped, sorted,
 *  and touching or overlapping ones merged — two fillers in a row ("ee, şey")
 *  are one cut, and overlapping ranges would otherwise remove time twice. */
export function mergeCutRanges(ranges: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = ranges
    .filter(([a, b]) => b - a >= 0.02)
    .map(([a, b]) => [a, b] as [number, number])
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + 0.02) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

const cutRangesParams = s.object({
  ranges: s.array(s.range('[start, end] in timeline seconds, as they are now'), { min: 1, max: 2000 })
})
type CutRangesParams = Infer<typeof cutRangesParams> & KeepParams

export const cutRanges = defineCommand<CutRangesParams, { ranges: [number, number][]; total: number }>({
  name: 'timeline.cutRanges',
  summary: 'Cut time ranges out of the whole timeline: every track, the subtitles, markers, notes, Shorts bands and templates after a cut move up.',
  params: cutRangesParams as Schema<CutRangesParams>,
  apply(p, { ranges, keepTracks, endBeds: end }): { ranges: [number, number][]; total: number } {
    // Merged, widened over slivers (K-3) and cut back to front
    // (ops/ripple.ts rippleRange): the ranges really taken out.
    const cut = keepTracks?.length ? cutKeeping(p, mergeCutRanges(ranges), { keepTracks, endBeds: end }) : rippleRange(p, mergeCutRanges(ranges), null)
    return { ranges: cut, total: cut.reduce((t, [a, b]) => t + b - a, 0) }
  }
})

/**
 * The store's own, not a parameter by name (as KeepParams): the user's A/V
 * link switch. Not given (an agent's call): the link counts, the partners of
 * what a track-only close moves follow (22 Nov, K3).
 */
export interface LinkParam {
  linkAV?: boolean
}

/** What a track-only close did, for whoever must say it. */
export interface Closed {
  /** False: a linked pair could not stay in step, so the range was taken
   *  out and the gap stays (nothing moved up). */
  closed: boolean
  /** Other tracks that moved up with it (linked partners). */
  movedWith: string[]
  /** The track in the way when it did not close. */
  inTheWay?: string
}

const closedOf = (plan: ClosePlan): Closed => ({ closed: plan.blockedBy === undefined, movedWith: plan.followers, ...(plan.blockedBy !== undefined ? { inTheWay: plan.blockedBy } : {}) })

const cutRangeOnTrackParams = s.object({ trackId: s.id(), range: s.range() })
type CutRangeOnTrackParams = Infer<typeof cutRangeOnTrackParams> & LinkParam

/** What cutRangeOnTrack will do to the linked pairs (closePlan): the store
 *  asks first, to tell the user when the gap stays. Pure. */
export const trackCutPlan = (p: Project, { trackId, range, linkAV }: CutRangeOnTrackParams): ClosePlan => closePlan(p, range, [trackId], { linked: linkAV !== false })

export const cutRangeOnTrack = defineCommand<CutRangeOnTrackParams, Closed>({
  name: 'timeline.cutRangeOnTrack',
  // (Kept no longer than it was: the agent's tool definitions hold its
  // first sentence, and they are at their size limit.)
  summary: 'Cut one time range out of one track only; the clips after it there and their linked partners move up.',
  params: cutRangeOnTrackParams as Schema<CutRangeOnTrackParams>,
  check(p, { trackId }) {
    requireTrack(p, trackId, 'timeline.cutRangeOnTrack', { edit: true })
  },
  apply(p, { trackId, range, linkAV }): Closed {
    // The one track-only close (ops/ripple.ts closeTracks, 22 Nov K3): a
    // clip that moves up takes its linked partner on another track along;
    // when it cannot, the range goes and the gap stays.
    return closedOf(closeTracks(p, range, [trackId], { linked: linkAV !== false }))
  }
})

const rippleTrimParams = s.object({
  clipId: s.id(),
  time: s.time('The timeline time the clip is trimmed to'),
  side: s.enum(['head', 'tail'], 'head: what is before the time goes; tail: what is after'),
  linkAV: s.optional(s.boolean())
})
type RippleTrimParams = Infer<typeof rippleTrimParams>

/**
 * How Q / W cut (22 Nov, K3): the range, the tracks it comes out of and
 * closeTracks' options. The clip loses [its start, time] (head) or [time,
 * its end] (tail); with the link on, so does each partner the range touches,
 * on its own track. One length for all of them: a partner that holds the
 * whole range inside it (its sound starts earlier or ends later: a J or L
 * cut) loses that much at its OWN edge instead, as a linked edge trim gives
 * every clip of a pair the same change — it is not cut in two, and what it
 * plays stays in step with the picture. A partner the range does not touch
 * is not cut (its track follows when what is after it must). Null: the time
 * is not inside the clip, or the clip is on a locked track. Pure.
 */
export function rippleTrimPlan(p: Project, { clipId, time, side, linkAV }: RippleTrimParams): { range: [number, number]; tracks: string[]; opts: CloseOptions; plan: ClosePlan } | null {
  const clip = p.clips[clipId]
  if (!clip || onLockedTrack(p, clip)) return null
  const end = clip.start + clip.duration
  if (!(time > clip.start + EPS && time < end - EPS)) return null
  const range: [number, number] = side === 'head' ? [clip.start, time] : [time, end]
  const [a, b] = range
  const d = b - a
  const group: Clip[] = [clip, ...(linkAV ? partnersOf(p, clip) : [])].filter((c) => !onLockedTrack(p, c))
  const tracks: string[] = []
  const at: Record<string, [number, number]> = {}
  for (const c of group) {
    const cs = c.start
    const ce = c.start + c.duration
    if (!(cs < b - EPS && ce > a + EPS) || tracks.includes(c.trackId)) continue
    tracks.push(c.trackId)
    if (c !== clip && cs < a - EPS && ce > b + EPS) at[c.trackId] = side === 'head' ? [cs, cs + d] : [ce - d, ce]
  }
  const opts: CloseOptions = { linked: !!linkAV, members: group.map((c) => c.id), at }
  return { range, tracks, opts, plan: closePlan(p, range, tracks, opts) }
}

export const rippleTrim = defineCommand<RippleTrimParams, Closed | null>({
  name: 'clip.rippleTrim',
  summary: 'Trim a clip to a time at its head or tail and close the gap on its own track and its linked partners; linked pairs after it stay in step.',
  // The store's Q / W. Not offered to an agent: timeline.cutRangeOnTrack is
  // the same close, and the tool definitions have no room for another.
  internal: true,
  params: rippleTrimParams,
  check(p, { clipId }) {
    requireClip(p, clipId, 'clip.rippleTrim')
  },
  apply(p, params): Closed | null {
    const cut = rippleTrimPlan(p, params)
    if (!cut) return null
    return closedOf(closeTracks(p, cut.range, cut.tracks, cut.opts))
  }
})

export const cutCaptionRange = defineCommand({
  name: 'captions.cutRange',
  summary: 'Cut one time range out of the subtitles and titles only (the lines after it move up); clips stay.',
  // The store's own (the subtitle lane's "delete between cuts"): it moves
  // every later line off the sound it belongs to, by design, so it is not
  // offered to an agent (phase 4A.9, A2: subtitles stay on their sound).
  internal: true,
  params: s.object({ range: s.range() }),
  apply(p, { range }): void {
    rippleCaptions(p, range[0], range[1])
  }
})

const region = s.object({ clipId: s.id(), start: s.time(), end: s.time() })

/** The silent ranges by clip, each clip's merged and sorted (regions on
 *  clips the project does not have, or empty ones, are left out). */
export function silenceByClip(p: Project, regions: readonly { clipId: string; start: number; end: number }[]): Map<string, { a: number; b: number }[]> {
  const byClip = new Map<string, { a: number; b: number }[]>()
  for (const r of regions) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start || !p.clips[r.clipId]) continue
    const ranges = byClip.get(r.clipId) ?? []
    ranges.push({ a: r.start, b: r.end })
    byClip.set(r.clipId, ranges)
  }
  for (const [clipId, ranges] of byClip) {
    ranges.sort((a, b) => a.a - b.a)
    const merged: typeof ranges = []
    for (const range of ranges) {
      const last = merged[merged.length - 1]
      if (last && range.a <= last.b + 1e-3) last.b = Math.max(last.b, range.b)
      else merged.push({ ...range })
    }
    byClip.set(clipId, merged)
  }
  return byClip
}

/**
 * The timeline ranges a silence cut takes out (phase Ç2b.1, decision 1):
 * where every picked clip that plays there is silent. One voice's pause is
 * where another picked voice may be talking (an interview on two tracks), so
 * it is cut only where they are all quiet. Regions of clips on locked tracks
 * are left out (a lock keeps its clips as they are). `picked`: the clips that
 * were analysed; one with no region (no pause found, or its analysis failed)
 * is loud over its whole span (Ç2b patch, item 1: its words were cut).
 */
export function silenceRanges(p: Project, regions: readonly { clipId: string; start: number; end: number }[], picked: readonly string[] = []): [number, number][] {
  const byClip = silenceByClip(p, regions)
  for (const id of picked) if (p.clips[id] && !byClip.has(id)) byClip.set(id, [])
  const quiet: [number, number][] = []
  const loud: [number, number][] = []
  for (const [clipId, ranges] of byClip) {
    const clip = p.clips[clipId]
    if (!clip || p.tracks.find((t) => t.id === clip.trackId)?.locked) continue
    const cs = clip.start
    const ce = clip.start + clip.duration
    let at = cs
    for (const r of ranges) {
      const a = Math.max(cs, r.a)
      const b = Math.min(ce, r.b)
      if (b - a <= 0.02) continue
      quiet.push([a, b])
      if (a > at) loud.push([at, a])
      at = Math.max(at, b)
    }
    if (ce > at) loud.push([at, ce])
  }
  // quiet minus loud
  const out: [number, number][] = []
  for (const [a0, b0] of quiet) {
    let pieces: [number, number][] = [[a0, b0]]
    for (const [la, lb] of loud) {
      pieces = pieces.flatMap(([a, b]): [number, number][] => (lb <= a || la >= b ? [[a, b]] : [...(la > a ? [[a, la] as [number, number]] : []), ...(lb < b ? [[lb, b] as [number, number]] : [])]))
    }
    out.push(...pieces.filter(([a, b]) => b - a > 0.02))
  }
  return out
}

/**
 * Removes the silent stretches of the clips they were found in from the
 * whole timeline (phase Ç2b.1, decision 1): every unlocked track, the
 * subtitles, markers and the rest move up together, as any ripple does.
 * Before, only the tracks of the picked clips rippled, and the picture, the
 * music and the other voices fell out of step.
 */
const applySilenceParams = s.object({
  regions: s.array(region, { max: 5000 }),
  // Every clip analysed: one with no region here is loud all through.
  picked: s.optional(s.array(s.id(), { max: 5000 })),
  crossfade: s.optional(s.boolean('Tiny audio fades on every new cut so the jumps do not click'))
})
type ApplySilenceParams = Infer<typeof applySilenceParams> & KeepParams

export const applySilence = defineCommand<ApplySilenceParams, { ranges: [number, number][] }>({
  name: 'silence.apply',
  summary: 'Remove silent stretches found in clips from the whole timeline (every unlocked track; subtitles and markers move up too), only where every picked clip (all analysed) is silent.',
  params: applySilenceParams as Schema<ApplySilenceParams>,
  check(p, { regions }) {
    for (const r of regions) requireClip(p, r.clipId, 'silence.apply')
  },
  apply(p, { regions, picked, crossfade, keepTracks, endBeds: end }): { ranges: [number, number][] } {
    const ranges = silenceRanges(p, regions, picked)
    if (ranges.length === 0) return { ranges: [] }
    if (keepTracks?.length) return { ranges: cutKeeping(p, ranges, { keepTracks, endBeds: end }, !!crossfade) }
    return { ranges: rippleRange(p, ranges, null, { fades: !!crossfade }) }
  }
})
