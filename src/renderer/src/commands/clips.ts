// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Clips: delete, move, trim, split, add, and their settings (transform,
// opacity, sound, speed, fades, the transition out). Bodies as they were in
// state/store.ts (phase 2A); what the store read from the UI (the A/V link,
// the playhead, the selection) is a parameter now.
import type { Asset, Clip, ClipTransform, KfChannel, MotionFx, Project, Track } from '../types'
import { isSubtitle, uid } from '../types'
import { JOIN_EPS } from '../playback/join'
import { NEW_AUDIO_TRACK, NEW_VIDEO_TRACK, planTimelinePlacement, type TimelinePlacement } from '../timeline/placement'
import { carryPartners, freePairs, keepPairsTogether, lockedPartner, onLockedTrack, partnersOf, relink, startsOf, withPartners } from './ops/links'
import { automationOf, freshCopy, sliceClipAutomation, sliceMotionFx, slipAutomation, type ClipAutomation } from '../timeline/slice'
import { applyAutoPack, cascadeTrack, clone, findTrack, forgetClips, newAssetsOf, nextTrackName, settleClipOnTrack, sortTrack } from './ops/base'
import { clipsToSplit, splitClipsIn } from './ops/split'
import { closeSpans, closeSpansPlan, rippleRange, type SpansPlan, type TrackSpan } from './ops/ripple'
import { appendAssetToTimeline, applyMediaDrop, retimeClip } from './ops/media'
import { CommandError, defineCommand } from './core'
import { headRoom, tailRoom, takePart } from '../timeline/media-time'
import { TRANSITION_LIMITS, transitionsOfCopy } from '../timeline/transition-links'
import { s, type Infer, type Schema } from './schema'
import { assetRef, requireAsset, requireClip, requireFreshId, requireTrack } from './require'
import { EDGE_MIN, EPS } from '../timeline/eps'
import { SPEED_MAX, SPEED_MIN, clampSpeed, fastestFor } from '../timeline/speed'
import { CURVE_MAX_KEYS, curveDuration, keysFromPoints, shiftCurve, tidyKeys } from '../timeline/speed-curve'

const clipOk = (cmd: string) => <T extends { clipId: string }>(p: Project, a: T): void => void requireClip(p, a.clipId, cmd)

/** A new clip under the id it was asked to have (its track, groups too). */
function renameClip(p: Project, from: string, to: string): void {
  const clip = p.clips[from]
  if (!clip || from === to) return
  p.clips[to] = { ...clip, id: to }
  delete p.clips[from]
  for (const t of p.tracks) if (t.clipIds.includes(from)) t.clipIds = t.clipIds.map((x) => (x === from ? to : x))
  if (p.groups) p.groups = p.groups.map((g) => ({ ...g, clipIds: g.clipIds.map((x) => (x === from ? to : x)) }))
}

const linkAV = s.optional(s.boolean('Treat the linked picture/sound partner as one unit with the clip: moved, trimmed, cut, deleted, slipped or retimed with it (the A/V link). Default off.'))
/** The A/V link of a call: the editor passes the user's switch (on by
 *  default since phase Ç2b.1, decision 2); a call by name says it. */
const linked = (v: boolean | undefined): boolean => v === true

/** The check of an edit of `ids` with the link: its partner on a locked
 *  track refuses it (decision 3). */
const linkFree = (cmd: string, ids: readonly string[], link: boolean, p: Project): void => {
  const held = lockedPartner(p, ids, link)
  if (held) throw new CommandError(cmd, `clip "${held.clip.id}" is linked to "${held.partner.id}" on a locked track (${held.track}): unlock it, or send linkAV false`)
}

// -- delete ---------------------------------------------------------------

/** The clips a delete of `ids` takes: with the link on (the default) their
 *  partners too; a clip on a locked track, or one whose partner is on one,
 *  stays with its partners (phase Ç2b.1, decisions 2 and 3). */
export function deletableClipIds(p: Project, ids: readonly string[], link = false): string[] {
  return freePairs(p, ids, link)
}

/** Whether a ripple delete of `ids` leaves the gap (the Ç2b patch, item 3,
 *  in place of E1's own-track fallback): another unlocked track has material
 *  inside the time one of them took (the talk under a B-roll: a clip, not
 *  deleted with them, overlapping it), or a title, shape or template lies
 *  wholly inside it. Then the clips are deleted WITHOUT ripple: closing
 *  only their own tracks drifted the linked pairs after them, closing every
 *  track cut that material. Alt (`onlyItsTrack`) stays the explicit choice.
 *  Linked partners deleted with them are deleted clips. Pure. */
export function rippleLeavesGap(p: Project, ids: readonly string[]): boolean {
  const gone = new Set(ids)
  return ids.some((did) => {
    const d = p.clips[did]
    if (!d) return false
    const a = d.start
    const b = d.start + d.duration
    const inside = (s: number, e: number): boolean => e > s && s >= a - EPS && e <= b + EPS
    return p.tracks.some((t) => !t.locked && t.id !== d.trackId && t.clipIds.some((id) => {
      const c = p.clips[id]
      return !!c && !gone.has(id) && c.start < b - EPS && c.start + c.duration > a + EPS
    })) ||
      p.captions.some((c) => !isSubtitle(c) && inside(c.start, c.end)) ||
      (p.templates ?? []).some((tb) => inside(tb.start, tb.start + tb.duration))
  })
}

/** The places the clips of `ids` take, by track (what a ripple closes). */
const spansOf = (p: Project, ids: readonly string[]): TrackSpan[] =>
  ids.map((id) => p.clips[id]).filter(Boolean).map((c) => ({ trackId: c.trackId, range: [c.start, c.start + c.duration] as [number, number] }))

/**
 * What a ripple delete of `ids` on their own tracks (`onlyItsTrack`, Alt)
 * does to the linked pairs after them (ops/ripple.ts closeSpansPlan; 22 Nov,
 * K3): the tracks that move up with them, or `blockedBy` when a pair could
 * not stay in step, and then the clips are deleted and every gap stays.
 * `ids` as the delete takes them (deletableClipIds). The store asks first, to
 * tell the user; the agent's answer says it too. Pure.
 */
export function ownTrackClosePlan(p: Project, ids: readonly string[], linkAV?: boolean): SpansPlan {
  return closeSpansPlan(p, spansOf(p, ids), { linked: linkAV !== false, gone: new Set(ids) })
}

const deleteParams = s.object({
  ids: s.array(s.id(), { min: 1 }),
  ripple: s.optional(s.boolean()),
  onlyItsTrack: s.optional(s.boolean('With ripple: close the gap on the track of each clip only (nothing else moves)'))
})
/** `linkAV` is the store's, not a parameter by name (as timeline.ts
 *  LinkParam): the user's A/V link switch for what the tracks' closing
 *  carries along. Not given (an agent's call): the link counts. (Which
 *  partners are DELETED is in `ids`: the editor names them itself.) */
type DeleteParams = Infer<typeof deleteParams> & { linkAV?: boolean }

export const deleteClips = defineCommand<DeleteParams, string[]>({
  name: 'clip.delete',
  summary: 'Delete clips; with ripple, their time is cut out of every unlocked track (subtitles, markers too), but when another track has material in that time nothing ripples (the gap stays; onlyItsTrack closes their own tracks). Clips on locked tracks stay.',
  params: deleteParams as Schema<DeleteParams>,
  check(p, { ids }) {
    for (const id of ids) requireClip(p, id, 'clip.delete')
  },
  apply(p, { ids, ripple, onlyItsTrack, linkAV }): string[] {
    // (The editor names the linked partners itself: deletableClipIds with
    // the user's link, phase Ç2b.1.)
    const clipIds = deletableClipIds(p, ids)
    const gone = new Set(clipIds)
    const gapLeft = !!ripple && !onlyItsTrack && rippleLeavesGap(p, clipIds)
    // The time each one took, as it was (phase Ç2b.1, decision 1: a ripple
    // delete is the one ripple over that range).
    const spans = spansOf(p, clipIds)
    for (const clipId of clipIds) {
      const clip = p.clips[clipId]
      if (!clip) continue
      const track = findTrack(p, clip.trackId)
      if (track) {
        // The transition into a deleted clip goes with it: left on the clip
        // before, it re-attached to whatever came to touch it next.
        for (const id of track.clipIds) {
          const prev = p.clips[id]
          if (prev && !gone.has(prev.id) && prev.transitionOut && Math.abs(prev.start + prev.duration - clip.start) < JOIN_EPS) delete prev.transitionOut
        }
        track.clipIds = track.clipIds.filter((id) => id !== clipId)
      }
      delete p.clips[clipId]
    }
    forgetClips(p, clipIds)
    if (ripple && !gapLeft) {
      // Their own tracks only (Alt): closed together, and what moves up
      // takes its linked partner on another track along, or, where a pair
      // could not stay in step, nothing closes and the gaps stay
      // (ops/ripple.ts closeSpans; 22 Nov, K3. Each track used to close on
      // its own: a still deleted before a talking clip left that clip's
      // linked sound where it was.)
      if (onlyItsTrack) closeSpans(p, spans, { linked: linkAV !== false })
      else rippleRange(p, spans.map((x) => x.range), null)
    }
    applyAutoPack(p)
    return clipIds
  }
})

export const unlinkClips = defineCommand({
  name: 'clip.unlink',
  // The store's (the clip menu): an agent edits pairs with linkAV false.
  internal: true,
  summary: 'Unlink clips from their linked picture/sound partners: from then on each moves, trims and is deleted on its own.',
  params: s.object({ ids: s.array(s.id(), { min: 1 }) }),
  check(p, { ids }) {
    for (const id of ids) requireClip(p, id, 'clip.unlink', { edit: false })
  },
  apply(p, { ids }): void {
    for (const id of ids) {
      const clip = p.clips[id]
      if (!clip?.linkId) continue
      for (const o of partnersOf(p, clip)) delete o.linkId
      delete clip.linkId
    }
  }
})

// -- move -------------------------------------------------------------------

/** Where a move of `clipId` to `start` lands: the drag's own plan
 *  (`planTimelinePlacement`), so a move by name is a drag by a known amount
 *  (phase Ç2b.1, K-4 = P10). Null: it cannot be made (locked, or a partner
 *  that has no room to come along). */
export const planMove = (p: Project, clipId: string, start: number, link: boolean): TimelinePlacement | null => {
  const clip = p.clips[clipId]
  return clip ? planTimelinePlacement(p, clipId, [clipId], Math.max(0, start) - clip.start, null, null, link) : null
}

/** The clips a clip.move names: one (clipId) or several (clipIds). */
const moveIds = (a: { clipId?: string; clipIds?: string[] }): string[] => (a.clipIds ? [...new Set(a.clipIds)] : a.clipId !== undefined ? [a.clipId] : [])

/** The plan of a clip.move: one clip to a start, or its clips all `by` the
 *  same amount at once — the drag of a selection (spacing kept, one step). */
function planMoves(p: Project, a: { clipId?: string; clipIds?: string[]; start?: number; by?: number; linkAV?: boolean }): TimelinePlacement | null {
  const ids = moveIds(a).filter((id) => !!p.clips[id])
  if (!a.clipIds) return ids.length ? planMove(p, ids[0], moveTarget(p, ids[0], a.start, a.by), linked(a.linkAV)) : null
  // The plan's anchor: the earliest named clip a lock does not hold.
  const anchor = ids.map((id) => p.clips[id]).filter((c) => !onLockedTrack(p, c)).sort((x, y) => x.start - y.start)[0]
  return anchor ? planTimelinePlacement(p, anchor.id, ids, a.by ?? 0, null, null, linked(a.linkAV)) : null
}

const at2 = (t: number): string => t.toFixed(2)
const few = (ids: readonly string[]): string => `${ids.slice(0, 4).join(', ')}${ids.length > 4 ? ` +${ids.length - 4}` : ''}`

/** Why a move that may not shift other clips (`push` false) is refused, or
 *  null: the clips it would move that are not named (nor, with the link, a
 *  named clip's partner), said with what to send instead. */
function pushProblem(p: Project, plan: TimelinePlacement, ids: readonly string[], link: boolean): string | null {
  const meant = new Set(withPartners(p, ids, link))
  const pushed = Object.entries(plan.positions).filter(([id, at]) => !meant.has(id) && !!p.clips[id] && (at.trackId !== p.clips[id].trackId || Math.abs(at.start - p.clips[id].start) > EPS)).map(([id]) => id)
  if (!pushed.length) return null
  const trackOf = (id: string): Track | undefined => p.tracks.find((t) => t.id === p.clips[id].trackId)
  const packed = [...ids, ...pushed].map(trackOf).find((t) => t?.autoPack)
  if (packed) return `track ${packed.name} keeps its clips joined (its magnet is on): this would only change their order and move ${few(pushed)}, which ${pushed.length === 1 ? 'is' : 'are'} not named. Send push:true for that; clips there cannot be shifted apart while the magnet is on (track.setMagnet{trackId:"${packed.id}",on:false} switches it off: send it first, in the same call; in a draft the user sees it)`
  const first = p.clips[pushed.slice().sort((x, y) => p.clips[x].start - p.clips[y].start)[0]]
  return `it would land on ${first.id} (${trackOf(first.id)?.name ?? first.trackId} ${at2(first.start)}–${at2(first.start + first.duration)}) and move ${pushed.length} clip${pushed.length === 1 ? '' : 's'} that ${pushed.length === 1 ? 'is' : 'are'} not named (${few(pushed)}). To shift several clips and keep their spacing, name them all in ONE op: clipIds:[…] with by. To put it there and move those later, send push:true`
}

export const moveClip = defineCommand({
  name: 'clip.move',
  // (DENEME-2, worker T: an agent asked to move clips "10 s later" had only
  // an absolute start to say it with; `by` says a shift. D22, A1: `clipIds`
  // shifts several at once, as dragging a selection does; `push` false
  // refuses a move that would shift clips that are not named.)
  summary: 'Move one clip (clipId) to start (a time) or by (± s, + later), or several (clipIds, with by) at once, spacing kept. As a drag does: clips it lands on move later (push false: refused instead). With linkAV linked partners move too.',
  params: s.object({
    clipId: s.optional(s.id()),
    clipIds: s.optional(s.array(s.id(), { min: 1, max: 2000 })),
    start: s.optional(s.time()),
    by: s.optional(s.number({ description: 'seconds' })),
    linkAV,
    push: s.optional(s.boolean('false: refuse a move that would shift a clip that is not named (default: it is shifted)'))
  }),
  check(p, a) {
    const { clipId, clipIds, start, by, linkAV, push } = a
    if ((clipId === undefined) === (clipIds === undefined)) throw new CommandError('clip.move', 'give one of clipId (one clip) or clipIds (several, moved together by the same amount)')
    const ids = moveIds(a)
    for (const id of ids) requireClip(p, id, 'clip.move')
    if (clipIds && (by === undefined || start !== undefined)) throw new CommandError('clip.move', 'with clipIds give by (the seconds to move them all by); start is one clip\'s time')
    if (!clipIds && (start === undefined) === (by === undefined)) throw new CommandError('clip.move', 'give one of start (the new time) or by (seconds to move by)')
    linkFree('clip.move', ids, linked(linkAV), p)
    const plan = planMoves(p, a)
    // (A packed track holds its clips: the magnet.)
    const packed = withPartners(p, ids, linked(linkAV)).map((id) => p.tracks.find((t) => t.id === p.clips[id].trackId)).find((t) => t?.autoPack)
    const magnet = packed ? `track ${packed.name} keeps its clips joined${p.tracks.filter((t) => t.kind === 'video').at(-1)?.id === packed.id ? ' from 0' : ''} (its magnet is on), so they cannot be shifted. Switch it off first with track.setMagnet{trackId:"${packed.id}",on:false} (the same call may hold both; in a draft the user sees it), then move them` : ''
    if (!plan) throw new CommandError('clip.move', packed && clipIds ? `the clips cannot move together: ${magnet}` : clipIds ? 'the clips cannot move together: a linked partner would not land with its clip' : `clip "${clipId}" cannot go to ${moveTarget(p, clipId!, start, by)}: its linked partner would not land with it`)
    if (clipIds) {
      // Several clips keep their spacing: a shift that would put one before
      // 0 is refused (a drag stops there; a call by name says so).
      const first = withPartners(p, ids, linked(linkAV)).map((id) => p.clips[id]).sort((x, y) => x.start - y.start)[0]
      if (first.start + by! < -EPS) throw new CommandError('clip.move', `by ${by} would put ${first.id} before 0 (it starts at ${at2(first.start)} s): at most ${at2(-first.start)}`)
    }
    if (push === false) {
      const why = pushProblem(p, plan, ids, linked(linkAV))
      if (why) throw new CommandError('clip.move', why)
    }
    // Asked to move, and a clip would not land where it was sent (a packed
    // track holds its clips; its linked partner then stays with it): said,
    // never done in part (the clips on other tracks alone).
    if (clipIds || push === false) {
      const stuck = withPartners(p, ids, linked(linkAV)).filter((id) => {
        const want = clipIds ? p.clips[id].start + by! : id === clipId ? moveTarget(p, id, start, by) : p.clips[id].start + (moveTarget(p, clipId!, start, by) - p.clips[clipId!].start)
        return Math.abs((plan.positions[id]?.start ?? p.clips[id].start) - want) > EPS
      })
      if (stuck.length) throw new CommandError('clip.move', packed ? `${stuck.length === withPartners(p, ids, linked(linkAV)).length ? 'nothing would move' : `${few(stuck)} would not move`}: ${magnet}` : `${few(stuck)} would not land where asked: a clip that stays is in the way, and moving it later moves ${stuck.length === 1 ? 'this one' : 'these'} too`)
    }
  },
  apply(p, a): void {
    const plan = planMoves(p, a)
    if (plan?.changed) layPlan(p, plan)
  }
})

/** Where clip.move sends a clip: `start`, or where it is moved `by`. */
const moveTarget = (p: Project, clipId: string, start: number | undefined, by: number | undefined): number => Math.max(0, start ?? (p.clips[clipId]?.start ?? 0) + (by ?? 0))

export const moveClipToTrack = defineCommand({
  name: 'clip.moveToTrack',
  summary: 'Move a clip onto another track of the same kind, at the nearest free place to where it is.',
  params: s.object({ clipId: s.id(), trackId: s.id() }),
  check(p, { clipId, trackId }) {
    const clip = requireClip(p, clipId, 'clip.moveToTrack')
    const from = p.tracks.find((t) => t.id === clip.trackId)
    requireTrack(p, trackId, 'clip.moveToTrack', { edit: true, ...(from ? { kind: from.kind } : {}) })
  },
  apply(p, { clipId, trackId }): void {
    const clip = p.clips[clipId]
    if (!clip || clip.trackId === trackId) return
    const from = findTrack(p, clip.trackId)
    const to = findTrack(p, trackId)
    if (!from || !to || from.kind !== to.kind) return
    from.clipIds = from.clipIds.filter((id) => id !== clipId)
    to.clipIds.push(clipId)
    clip.trackId = trackId
    settleClipOnTrack(p, to, clip)
    if (from.autoPack) applyAutoPack(p)
  }
})

/** A drag's plan (`planTimelinePlacement`), laid down. */
export const placeClips = defineCommand({
  name: 'clip.place',
  summary: 'Lay down a timeline placement plan (the result of planning a drag: new starts and rows, maybe a new row).',
  internal: true,
  params: s.object({ plan: s.object_any('A TimelinePlacement from planTimelinePlacement') }),
  apply(p, { plan: raw }): void {
    layPlan(p, raw as unknown as TimelinePlacement)
  }
})

/** A placement plan laid down (the drag's drop, a move by name). */
function layPlan(p: Project, plan: TimelinePlacement): void {
  {
    let createdTrackId: string | null = null
    if (plan.newTrack) {
      const track: Track = {
        id: uid(),
        kind: plan.newTrack,
        name: nextTrackName(p, plan.newTrack),
        clipIds: []
      }
      if (plan.newTrack === 'video') p.tracks.unshift(track)
      else p.tracks.push(track)
      createdTrackId = track.id
    }
    const actualTrackId = (id: string): string =>
      id === NEW_VIDEO_TRACK || id === NEW_AUDIO_TRACK ? (createdTrackId ?? id) : id
    for (const [id, position] of Object.entries(plan.positions)) {
      const clip = p.clips[id]
      if (!clip) continue
      clip.start = position.start
      clip.trackId = actualTrackId(position.trackId)
    }
    for (const [trackId, ids] of Object.entries(plan.trackClipIds)) {
      const track = p.tracks.find((candidate) => candidate.id === actualTrackId(trackId))
      if (track) track.clipIds = ids.filter((id) => !!p.clips[id])
    }
  }
}

// -- trim ---------------------------------------------------------------------

export interface TrimBase {
  start: number
  inPoint: number
  duration: number
  /** Its speed as the drag began, when a speed curve makes each trim give
   *  it another average (core polish C). */
  speed?: number
  automation?: ClipAutomation
  /** Its slow push / pan as the drag began (phase Ç2c.2, report K14). */
  motionFx?: MotionFx
  /** The linked partners' shapes as the drag began (by id). */
  partners?: Record<string, TrimBase>
}

/** A clip's shape as a head trim starts from it (with `p`, its linked
 *  partners' too: a drag trims them from where they were). */
export const trimBaseOf = (clip: Clip, p?: Project): TrimBase => ({
  start: clip.start,
  inPoint: clip.inPoint,
  duration: clip.duration,
  ...(clip.speedCurve ? { speed: clip.speed } : {}),
  automation: automationOf(clip),
  ...(clip.motionFx ? { motionFx: structuredClone(clip.motionFx) } : {}),
  ...(p && clip.linkId ? { partners: Object.fromEntries(partnersOf(p, clip).map((o) => [o.id, trimBaseOf(o)])) } : {})
})

/** How far a clip's head may move (`d`, timeline seconds from its base):
 *  not under 0.1 s long, not past its media (unless it has none), not over
 *  the previous clip on a loose track — or on any track when `held` (a
 *  linked trim: a packed clip held at its neighbour would grow from its tail
 *  and leave its partner out of step, Ç2b patch item 2). */
function headLimits(p: Project, clip: Clip, base: TrimBase, held = false): { lo: number; hi: number; floor: number; synthetic: boolean } {
  const asset = p.assets.find((a) => a.id === clip.assetId)
  // A still, an adjustment layer and a compound clip have no media timeline
  // of their own: their head moves as far as the previous clip allows.
  const synthetic = !asset || asset.kind === 'image'
  const track = findTrack(p, clip.trackId)
  // How far left the edge may travel before it meets the previous clip.
  let floor = 0
  for (const id of track?.clipIds ?? []) {
    const other = p.clips[id]
    if (!other || other.id === clip.id) continue
    const end = other.start + other.duration
    if (end <= base.start + EPS) floor = Math.max(floor, end)
  }
  let lo = -Infinity
  // As far as the media before its first frame goes (for a backwards clip,
  // the media after the part it uses: timeline/media-time.ts).
  if (!synthetic) lo = -headRoom({ inPoint: base.inPoint, duration: base.duration, speed: base.speed ?? clip.speed, reversed: clip.reversed, speedCurve: clip.speedCurve }, asset.duration)
  // With auto-pack off, a blocked edge stops. Still images always stop.
  if (synthetic || !track?.autoPack || held) lo = Math.max(lo, floor - base.start)
  // At least 0.1 s long, but a clip already shorter is not made longer by it
  // (as the tail trim: a 0.01 s piece left by a cut had a negative limit, its
  // head was pushed past the clip before it and it grew over the next one).
  return { lo, hi: base.duration - Math.min(0.1, base.duration), floor, synthetic }
}

/** The head of `clip` moved by `d` from `base` (within its limits). */
function headTrimBy(p: Project, clip: Clip, base: TrimBase, d: number): void {
  const { floor, synthetic } = headLimits(p, clip, base)
  const start = d < 0 ? Math.max(floor, base.start + d) : base.start + d
  const duration = base.duration - d
  if (Math.abs(start - clip.start) < EPS && Math.abs(duration - clip.duration) < EPS) return
  clip.start = start
  clip.duration = duration
  // (Along a speed curve the part has its own average speed: from the
  // clip's speed as the drag began, core polish C.)
  if (!synthetic) takePart(clip, { inPoint: base.inPoint, duration: base.duration, speed: base.speed ?? clip.speed, reversed: clip.reversed, freeze: clip.freeze, speedCurve: clip.speedCurve }, d, base.duration)
  // Clip-local keys stay on their frames: cut from the clip as the trim
  // found it, shifted by how far its content moved.
  const shift = synthetic ? start - base.start : d
  if (base.automation) sliceClipAutomation(clip, shift, shift + duration, base.automation)
  // Its slow push or pan is cut as the clip is, from where the trim began
  // (phase Ç2c.2, report K14: a head trim replayed the whole move in what was
  // left, as a split or a ripple cut never did; one rule for all of them).
  if (base.motionFx && base.duration > 0) clip.motionFx = sliceMotionFx(base.motionFx, shift / base.duration, 1, shift)
  const track = findTrack(p, clip.trackId)
  if (!track) return
  // Only packed tracks move neighbours.
  if (track.autoPack && duration > base.duration + EPS) cascadeTrack(p, track)
  else sortTrack(p, track)
}

/**
 * Head trim to an ABSOLUTE edge position, from the clip's shape when the trim
 * began (`base`; the clip as it is when not given). Dragging right trims the
 * head; dragging left reveals earlier media until the previous clip is in the
 * way — on a packed track the rest grows from the tail instead. With the link
 * on (default) its partners get the same edge change, held to what every one
 * of them allows (phase Ç2b.1, decision 2).
 */
const trimHeadParams = s.object({
  clipId: s.id(),
  // A timeline time (phase 4A.8, T5): carried across cuts, a word address works.
  edge: s.time('Where the start edge goes')
})
/** `base` (the clip as a drag began) and `linkAV` (the user's link: the
 *  partner gets the same edge change) are the store's: not parameters by
 *  name (an agent's trim stays one clip's, as 4A's contract has it). */
type TrimHeadParams = Infer<typeof trimHeadParams> & { base?: TrimBase; linkAV?: boolean }

export const trimHead = defineCommand<TrimHeadParams, void>({
  name: 'clip.trimHead',
  summary: 'Move the start edge of a clip to a timeline time: later trims its head, earlier reveals earlier media (stops at the previous clip).',
  params: trimHeadParams as Schema<TrimHeadParams>,
  check(p, { clipId, linkAV }) {
    requireClip(p, clipId, 'clip.trimHead')
    linkFree('clip.trimHead', [clipId], linked(linkAV), p)
  },
  apply(p, { clipId, edge: edgeSec, base: given, linkAV }): void {
    const clip = p.clips[clipId]
    if (!clip || onLockedTrack(p, clip) || lockedPartner(p, [clipId], linked(linkAV))) return
    const base = given ?? trimBaseOf(clip)
    const group = [clip, ...(linked(linkAV) ? partnersOf(p, clip) : [])]
    const baseOf = (c: Clip): TrimBase => (c === clip ? base : (base.partners?.[c.id] ?? trimBaseOf(c)))
    // One change for all of them, as far as every one allows (the shortest
    // length wins over the media and the neighbour).
    // A pair gets exactly the same change: every one stops at the clip
    // before it (none grows from its tail instead, Ç2b patch item 2).
    const held = group.length > 1
    let d = edgeSec - base.start
    for (const c of group) d = Math.max(d, headLimits(p, c, baseOf(c), held).lo)
    for (const c of group) d = Math.min(d, headLimits(p, c, baseOf(c), held).hi)
    for (const c of group) headTrimBy(p, c, baseOf(c), d)
    // Auto-pack means "always butt-joined": a trim closes the gap it opened.
    applyAutoPack(p)
  }
})

/** How long a clip's tail trim may make it: [shortest, longest]. */
function endLimits(p: Project, clip: Clip): [number, number] {
  const asset = p.assets.find((a) => a.id === clip.assetId)
  // At least 0.1 s, but a clip already shorter is not made longer by it
  // (phase Ç2a.1: a 0.06 s piece grew to 0.1 s over the next clip).
  const shortest = Math.min(0.1, clip.duration)
  let longest = Infinity
  // As far as the media after its last frame goes (for a backwards clip,
  // the media before its in point: timeline/media-time.ts).
  if (asset && (asset.kind === 'video' || asset.kind === 'audio')) longest = clip.duration + tailRoom(clip, asset.duration)
  const track = findTrack(p, clip.trackId)
  if (track && !track.autoPack) {
    const nextStart = track.clipIds
      .map((id) => p.clips[id])
      .filter((other) => other && other.id !== clip.id && other.start >= clip.start + clip.duration - EPS)
      .reduce((start, other) => Math.min(start, other.start), Infinity)
    // The next clip is a wall, whatever the minimum length says.
    if (Number.isFinite(nextStart)) longest = Math.min(longest, Math.max(clip.duration, nextStart - clip.start))
  }
  return [shortest, Math.max(shortest, longest)]
}

const trimEndParams = s.object({ clipId: s.id(), delta: s.number({ description: 'seconds' }) })
/** `linkAV` is the store's (see trimHead). */
type TrimEndParams = Infer<typeof trimEndParams> & { linkAV?: boolean }

export const trimEnd = defineCommand<TrimEndParams, void>({
  name: 'clip.trimEnd',
  summary: 'Lengthen or shorten the end of a clip by `delta` seconds (stops at the media end and at the next clip unless the track is packed).',
  params: trimEndParams as Schema<TrimEndParams>,
  check(p, { clipId, linkAV }) {
    requireClip(p, clipId, 'clip.trimEnd')
    linkFree('clip.trimEnd', [clipId], linked(linkAV), p)
  },
  apply(p, { clipId, delta: deltaSec, linkAV }): void {
    const clip = p.clips[clipId]
    if (!clip || onLockedTrack(p, clip) || lockedPartner(p, [clipId], linked(linkAV))) return
    const group = [clip, ...(linked(linkAV) ? partnersOf(p, clip) : [])]
    // One change for all of them, as far as every one allows (the shortest
    // length first, then the media and the next clip).
    let delta = deltaSec
    for (const c of group) delta = Math.max(delta, endLimits(p, c)[0] - c.duration)
    for (const c of group) delta = Math.min(delta, endLimits(p, c)[1] - c.duration)
    if (Math.abs(delta) < EPS) return
    for (const c of group) {
      const asset = p.assets.find((a) => a.id === c.assetId)
      const nd = c.duration + delta
      if (asset && (asset.kind === 'video' || asset.kind === 'audio')) takePart(c, c, 0, nd)
      c.duration = nd
      const track = findTrack(p, c.trackId)
      if (track?.autoPack) cascadeTrack(p, track)
    }
    applyAutoPack(p)
  }
})

/** Slips the media inside a clip: same place and length, other footage. */
export const slipClip = defineCommand({
  name: 'clip.slip',
  summary: 'Show other footage in the same place: move the media inside a clip by `delta` seconds (its place and length stay).',
  params: s.object({
    clipId: s.id(),
    delta: s.number({ description: 'seconds' }),
    baseInPoint: s.optional(s.number({ min: 0, description: 'The in point the slip starts from; default: as it is now' })),
    linkAV
  }),
  check(p, { clipId, linkAV }) {
    requireClip(p, clipId, 'clip.slip')
    linkFree('clip.slip', [clipId], linked(linkAV), p)
  },
  apply(p, { clipId, delta: deltaSec, baseInPoint, linkAV: link }): void {
    const linkAV = linked(link)
    const clip = p.clips[clipId]
    if (!clip || onLockedTrack(p, clip) || lockedPartner(p, [clipId], linkAV)) return
    const asset = p.assets.find((a) => a.id === clip.assetId)
    // A still has no media timeline to slip through.
    if (!asset || asset.kind === 'image') return
    const spd = clip.speed ?? 1
    const from = baseInPoint ?? clip.inPoint
    // Extracted audio slips by the same amount of MEDIA time, held to what
    // every one of them allows, from where the gesture began (Ç2b patch,
    // item 2: a partner stopped at its media end fell out of step). A
    // partner's start is where it is now less what the drag already moved.
    const group: { c: Clip; from: number; max: number }[] = [{ c: clip, from, max: Math.max(0, asset.duration - clip.duration * spd) }]
    if (clip.linkId && linkAV) {
      for (const other of Object.values(p.clips)) {
        if (other.linkId !== clip.linkId || other.id === clip.id) continue
        const oAsset = p.assets.find((a) => a.id === other.assetId)
        if (!oAsset || oAsset.kind === 'image') continue
        group.push({ c: other, from: other.inPoint - (clip.inPoint - from), max: Math.max(0, oAsset.duration - other.duration * (other.speed ?? 1)) })
      }
    }
    let d = deltaSec * spd
    for (const g of group) d = Math.max(d, -g.from)
    for (const g of group) d = Math.min(d, g.max - g.from)
    if (group.every((g) => Math.abs(g.from + d - g.c.inPoint) < EPS)) return
    for (const g of group) {
      const was = g.c.inPoint
      g.c.inPoint = Math.max(0, g.from + d)
      // A speed curve stays where it was on the timeline: other footage
      // under the same speeds (core polish C).
      if (g.c.speedCurve) g.c.speedCurve = shiftCurve(g.c.speedCurve, g.c.inPoint - was)
      // The keys ride with the footage (phase Ç2c.1, decision 4).
      slipAutomation(g.c, was, g.c.inPoint)
    }
  }
})

export const keepRange = defineCommand({
  name: 'clip.keepRange',
  summary: 'Keep only [start, end] of a clip (timeline seconds): its head and tail are trimmed away, nothing else moves.',
  params: s.object({ clipId: s.id(), range: s.range() }),
  check: clipOk('clip.keepRange'),
  apply(p, { clipId, range: [a, b] }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    const track = findTrack(p, clip.trackId)
    if (!track || track.locked) return
    const cs = clip.start
    const ce = cs + clip.duration
    const na = Math.max(cs, Math.min(a, b))
    const nb = Math.min(ce, Math.max(a, b))
    if (nb - na < EDGE_MIN) return
    const cutFront = na - cs
    const source = automationOf(clip)
    takePart(clip, clip, cutFront, nb - cs)
    clip.start = na
    clip.duration = nb - na
    sliceClipAutomation(clip, cutFront, cutFront + clip.duration, source)
    // Its slow push or pan too (report K14), as a split cuts it.
    if (clip.motionFx && ce - cs > 0) clip.motionFx = sliceMotionFx(clip.motionFx, cutFront / (ce - cs), (cutFront + clip.duration) / (ce - cs), cutFront)
    // A packed track stays packed (phase Ç2b.1, report L8: the gap stayed
    // until an unrelated edit closed it).
    applyAutoPack(p)
  }
})

// -- split ----------------------------------------------------------------------

/** Whether a split of `ids` at `time` would cut anything. */
export const splitsAnything = (p: Project, ids: readonly string[], time: number, linkAV: boolean): boolean =>
  clipsToSplit(p, ids, time, linkAV).length > 0

export const splitClips = defineCommand({
  name: 'clip.split',
  summary: 'Cut clips in two at a timeline time (with linkAV their linked partners too; clips on locked tracks, a pair with a partner on one, and cuts within 0.05 s of an edge are skipped). Returns the right pieces.',
  params: s.object({ clipIds: s.array(s.id(), { min: 1 }), time: s.time(), linkAV }),
  check(p, { clipIds, linkAV }) {
    for (const id of clipIds) requireClip(p, id, 'clip.split')
    linkFree('clip.split', clipIds, linked(linkAV), p)
  },
  apply(p, { clipIds, time, linkAV }): string[] {
    return splitClipsIn(p, clipsToSplit(p, clipIds, time, linked(linkAV)), time)
  }
})

// -- add --------------------------------------------------------------------------

export const addClip = defineCommand({
  name: 'clip.add',
  summary: 'Place a media id, clip id or file name at a time: on the given track if it is free there, else the nearest free one or a new one.',
  params: s.object({ assetId: s.id(), trackId: s.nullable(s.id()), start: s.time(), id: s.optional(s.id('An id for the new clip (default: a new one)')) }),
  check(p, { assetId, trackId, id }) {
    assetRef(p, assetId, 'clip.add')
    if (trackId) requireTrack(p, trackId, 'clip.add', { edit: true })
    requireFreshId(p, id, 'clip.add')
  },
  apply(p, { assetId, trackId, start, id }): string[] {
    // (assetId may name a clip on the timeline or a file name: assetRef.)
    const ids = applyMediaDrop(p, [assetRef(p, assetId, 'clip.add')], start, trackId, null)
    if (id && ids[0]) {
      renameClip(p, ids[0], id)
      ids[0] = id
    }
    return ids
  }
})

/** Copies of clips on their own tracks (Ctrl+D; the agent's clip.duplicate,
 *  23 Nov: an agent could not copy a clip at all). Each copy carries every
 *  setting of its clip but its transition; linked pairs are copied as pairs
 *  (`linkAV`) and the copies linked to each other. `at`: where the first copy
 *  starts (the others keep their spacing); default right after each clip.
 *  A taken place: the track's own rule (settleClipOnTrack). */
const duplicateParams = s.object({
  clipId: s.optional(s.id()),
  clipIds: s.optional(s.array(s.id(), { min: 1 })),
  at: s.optional(s.time()),
  linkAV: s.optional(s.boolean('Copy the linked picture/sound partner too (default true)'))
})
type DuplicateParams = Infer<typeof duplicateParams>
const dupIds = (a: DuplicateParams): string[] => (a.clipIds ? [...new Set(a.clipIds)] : a.clipId !== undefined ? [a.clipId] : [])

/** Copies of `ids` (partners already among them): Ctrl+D (store
 *  duplicateSelection, `align` off: a pair the track rule placed apart lets
 *  go of its link, phase Ç2b.1) and clip.duplicate (`align` on: the pair is
 *  moved on together where both tracks have room). */
export function duplicateInto(p: Project, ids: readonly string[], at: number | undefined, align: boolean): string[] {
  const first = Math.min(...ids.map((id) => p.clips[id]?.start ?? Infinity))
  const newIds: string[] = []
  const links = new Map<string, string>()
  const made: [string, string][] = []
  for (const id of ids) {
    const src = p.clips[id]
    const track = src ? findTrack(p, src.trackId) : undefined
    if (!src || !track) continue
    const start = at !== undefined ? at + (src.start - first) : src.start + src.duration
    const c: Clip = { ...clone(src), id: uid(), start }
    relink(c, links, ids, p)
    delete c.instance
    freshCopy(c)
    // (A copy comes without its transition: phase Ç2b.2, decision 1.)
    transitionsOfCopy(c)
    p.clips[c.id] = c
    track.clipIds.push(c.id)
    settleClipOnTrack(p, track, c)
    newIds.push(c.id)
    made.push([c.id, id])
  }
  if (align) alignPairs(p, made)
  keepPairsTogether(p, made)
  return newIds
}

export const duplicateClips = defineCommand<DuplicateParams, string[]>({
  name: 'clip.duplicate',
  summary: 'Copy clips (every setting) right after each one, or the first at "at"; a linked picture/sound partner is copied with it.',
  params: duplicateParams as Schema<DuplicateParams>,
  check(p, a) {
    const ids = dupIds(a)
    if (!ids.length) throw new CommandError('clip.duplicate', 'give clipId or clipIds')
    for (const id of ids) requireClip(p, id, 'clip.duplicate')
    linkFree('clip.duplicate', ids, a.linkAV !== false, p)
  },
  apply(p, a): string[] {
    return duplicateInto(p, withPartners(p, dupIds(a), a.linkAV !== false), a.at, true)
  }
})

/** Copies of a linked pair that the track rule placed apart (the picture's
 *  place was taken, the sound's not): all of them go to the furthest one's
 *  shift when that place is free on each track, so the pair stays a pair. */
function alignPairs(p: Project, made: readonly [string, string][]): void {
  const groups = new Map<string, [Clip, Clip][]>()
  for (const [copy, orig] of made) {
    const c = p.clips[copy]
    if (c?.linkId && p.clips[orig]) groups.set(c.linkId, [...(groups.get(c.linkId) ?? []), [c, p.clips[orig]]])
  }
  for (const list of groups.values()) {
    const shift = Math.max(...list.map(([c, o]) => c.start - o.start))
    const free = list.every(([c, o]) => {
      const track = findTrack(p, c.trackId)
      if (!track || track.autoPack) return false
      const a = o.start + shift
      const b = a + c.duration
      return track.clipIds.every((id) => id === c.id || !p.clips[id] || p.clips[id].start >= b - EPS || p.clips[id].start + p.clips[id].duration <= a + EPS)
    })
    if (!free) continue
    for (const [c, o] of list) {
      c.start = o.start + shift
      const track = findTrack(p, c.trackId)
      if (track) sortTrack(p, track)
    }
  }
}

/** Files dropped on the timeline: the new ones imported (one undo step with
 *  the placement), the ones the project has placed as the asset it has. */
const addMediaParams = s.object({
  assetIds: s.array(s.id(), { min: 1 }),
  trackId: s.nullable(s.id()),
  start: s.time(),
  newTrack: s.optional(s.nullable(s.enum(['video', 'audio'] as const)))
})
/** `assets` (files probed by the app) is the store's: not a parameter by name. */
type AddMediaParams = Infer<typeof addMediaParams> & { assets?: Asset[] }

export const addMedia = defineCommand<AddMediaParams, { added: Asset[]; clipIds: string[] }>({
  name: 'clip.addMedia',
  summary: 'Put project media on the timeline at a time, on the given track or the nearest free one (or a new one).',
  params: addMediaParams as Schema<AddMediaParams>,
  check(p, { assetIds, trackId }) {
    for (const id of assetIds) requireAsset(p, id, 'clip.addMedia')
    if (trackId) requireTrack(p, trackId, 'clip.addMedia', { edit: true })
  },
  apply(p, { assetIds, trackId, start, assets, newTrack }): { added: Asset[]; clipIds: string[] } {
    const incoming = assets ?? []
    const fresh = newAssetsOf(p, incoming)
    // A dropped file the project already has places the asset it has.
    const ids = assetIds.map((id) => {
      const probed = incoming.find((a) => a.id === id)
      if (!probed || fresh.includes(probed)) return id
      return [...p.assets, ...fresh].find((a) => a.id === id || (!!probed.path && a.path === probed.path && a.kind === probed.kind))?.id ?? id
    })
    p.assets.push(...fresh)
    const clipIds = applyMediaDrop(p, ids, start, trackId, newTrack ?? null)
    return { added: fresh, clipIds }
  }
})

export const appendClip = defineCommand({
  name: 'clip.append',
  summary: 'Put media at the end of a track (the first track of its kind when none is given; assetId as in clip.add).',
  params: s.object({ assetId: s.id(), trackId: s.optional(s.id()), id: s.optional(s.id('An id for the new clip')) }),
  check(p, { assetId, trackId, id }) {
    assetRef(p, assetId, 'clip.append')
    if (trackId) requireTrack(p, trackId, 'clip.append', { edit: true })
    requireFreshId(p, id, 'clip.append')
  },
  apply(p, { assetId: ref, trackId, id }): string | null {
    const assetId = assetRef(p, ref, 'clip.append')
    const before = new Set(Object.keys(p.clips))
    appendAssetToTimeline(p, assetId, trackId)
    applyAutoPack(p)
    // The new clip (a code film's sound, made with it, comes second).
    const made = Object.keys(p.clips).find((k) => !before.has(k) && p.clips[k].assetId === assetId) ?? null
    if (made && id) {
      renameClip(p, made, id)
      return id
    }
    return made
  }
})

// -- settings -------------------------------------------------------------------

/** The ones of `channels` that have keys on `clip`. */
const keyedOf = (clip: Clip, channels: readonly KfChannel[]): KfChannel[] => channels.filter((ch) => (clip.channels?.[ch]?.length ?? 0) > 0)
/** What the agent is told of keyed channels a static value was not set on:
 *  what they are, that nothing was set, what it can do (Ç2c patch, item 8). */
export const keyedSay = (clipId: string, keyed: readonly KfChannel[]): string =>
  `clip ${clipId}: ${keyed.join(', ')} ${keyed.length > 1 ? 'are' : 'is'} keyframed (its keys decide what is shown), so this value was not applied; leave it to the user, who can change the keys`
/**
 * A static value set on a channel that has keys shows nothing (its keys
 * decide what is drawn): the set is refused and says so (phase Ç2c.2,
 * report K13: it reported success and changed nothing one could see).
 */
function refuseKeyed(cmd: string, clip: Clip, channels: readonly KfChannel[]): void {
  const keyed = keyedOf(clip, channels)
  if (keyed.length > 0) throw new CommandError(cmd, keyedSay(clip.id, keyed))
}
/** The channels a transform patch sets. */
const transformChannels = (t: object): KfChannel[] => (['x', 'y', 'scale', 'rotation'] as const).filter((ch) => (t as Record<string, unknown>)[ch] !== undefined)

export const setTransform = defineCommand({
  name: 'clip.setTransform',
  summary: 'Set a clip\'s static position (x, y in project pixels), scale and rotation (radians).',
  params: s.object({
    clipId: s.id(),
    transform: s.object({ x: s.optional(s.number({ description: 'px' })), y: s.optional(s.number({ description: 'px' })), scale: s.optional(s.number({ min: 0 })), rotation: s.optional(s.number({ description: 'radians' })) })
  }),
  check(p, { clipId, transform }) {
    refuseKeyed('clip.setTransform', requireClip(p, clipId, 'clip.setTransform'), transformChannels(transform))
  },
  apply(p, { clipId, transform }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    refuseKeyed('clip.setTransform', clip, transformChannels(transform))
    Object.assign(clip.transform, transform as Partial<ClipTransform>)
  }
})

export const setOpacity = defineCommand({
  name: 'clip.setOpacity',
  summary: 'Set a clip\'s opacity, 0 to 1.',
  params: s.object({ clipId: s.id(), opacity: s.number({ min: 0, max: 1 }) }),
  check(p, { clipId }) {
    refuseKeyed('clip.setOpacity', requireClip(p, clipId, 'clip.setOpacity'), ['opacity'])
  },
  apply(p, { clipId, opacity }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    refuseKeyed('clip.setOpacity', clip, ['opacity'])
    clip.opacity = Math.max(0, Math.min(1, opacity))
  }
})

export const setVolume = defineCommand({
  name: 'clip.setVolume',
  summary: 'Set a clip\'s volume (1 = as recorded); it also unmutes the clip.',
  params: s.object({ clipId: s.id(), volume: s.number({ min: 0, max: 4 }) }),
  check: clipOk('clip.setVolume'),
  apply(p, { clipId, volume }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    clip.volume = volume
    // Touching the fader is an unambiguous "I want to hear this".
    if (clip.muted) delete clip.muted
  }
})

export const setMuted = defineCommand({
  name: 'clip.setMuted',
  summary: 'Mute or unmute a clip.',
  params: s.object({ clipId: s.id(), muted: s.boolean() }),
  check: clipOk('clip.setMuted'),
  apply(p, { clipId, muted }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    if (muted) clip.muted = true
    else delete clip.muted
  }
})

export const setSpeed = defineCommand({
  name: 'clip.setSpeed',
  summary: 'Play a clip faster or slower; its length changes with it, the same media stays on screen (never shorter than one frame: the speed is held there).',
  params: s.object({ clipId: s.id(), speed: s.number({ min: SPEED_MIN, max: SPEED_MAX }), linkAV }),
  check(p, { clipId, linkAV }) {
    requireClip(p, clipId, 'clip.setSpeed')
    linkFree('clip.setSpeed', [clipId], linked(linkAV), p)
  },
  apply(p, { clipId, speed, linkAV }): void {
    const clip = p.clips[clipId]
    // A lock keeps its clips as they are (phase Ç2b.1, decision 3: the
    // inspector could retime a selected clip after its track was locked).
    if (!clip || onLockedTrack(p, clip) || lockedPartner(p, [clipId], linked(linkAV))) return
    const asset = p.assets.find((a) => a.id === clip.assetId)
    if (asset && asset.kind === 'image') {
      clip.speed = 1 // speed is meaningless for stills
      return
    }
    const before = startsOf(p)
    const group = [clip, ...(linked(linkAV) ? partnersOf(p, clip) : [])]
    // No clip of the group is left shorter than one frame: the speed stops
    // where the shortest of them reaches it (they stay at one speed), so
    // none ever shows more media than it did (core polish B, decision K2).
    const fps = p.settings.fps
    const sp = Math.min(clampSpeed(speed), ...group.map((c) => fastestFor(c.duration * (c.speed ?? 1), c.speed ?? 1, fps)))
    // Its linked sound (or picture) keeps time with it. One speed: a speed
    // curve goes (core polish C; its average was the speed until now).
    for (const c of group) retimeClip(p, c, sp, c.speedCurve ? null : undefined)
    // What a retime pushed along its track takes its own partner along (P11).
    carryPartners(p, before, new Set(group.map((c) => c.id)))
    applyAutoPack(p)
  }
})

/** Whether a clip can take a speed curve: a video or a sound clip (not a
 *  still, a compound, a code film or a held frame; core polish C, C4). */
export function curveable(p: Project, clip: Clip): boolean {
  const asset = p.assets.find((a) => a.id === clip.assetId)
  return !!asset && (asset.kind === 'video' || asset.kind === 'audio') && !clip.nested && clip.freeze === undefined && !clip.adjustment
}

export const setSpeedCurve = defineCommand({
  name: 'clip.setSpeedCurve',
  // The inspector's curve editor (core polish C). An agent reads a curve
  // (its speed range in the clip's line) and sets one speed with
  // clip.setSpeed; the tool definitions stay within their budget.
  internal: true,
  summary: 'Give a clip a speed that changes along it (points: u 0..1 along the clip as it plays, v the speed there), or one speed again (null: its average).',
  params: s.object({
    clipId: s.id(),
    curve: s.nullable(s.object({
      points: s.array(s.object({ u: s.number({ min: 0, max: 1 }), v: s.number({ min: SPEED_MIN, max: SPEED_MAX }) }), { min: 1, max: CURVE_MAX_KEYS }),
      linear: s.optional(s.boolean())
    })),
    linkAV
  }),
  check(p, { clipId, linkAV }) {
    requireClip(p, clipId, 'clip.setSpeedCurve')
    linkFree('clip.setSpeedCurve', [clipId], linked(linkAV), p)
  },
  apply(p, { clipId, curve, linkAV }): void {
    const clip = p.clips[clipId]
    if (!clip || onLockedTrack(p, clip) || lockedPartner(p, [clipId], linked(linkAV))) return
    if (!curveable(p, clip)) return
    const before = startsOf(p)
    const group = [clip, ...(linked(linkAV) ? partnersOf(p, clip) : [])].filter((c) => curveable(p, c))
    const least = 1 / Math.max(1, p.settings.fps || 30)
    for (const c of group) {
      if (!curve) {
        // One speed again: its average, the same length.
        if (c.speedCurve) retimeClip(p, c, c.speed ?? 1, null)
        continue
      }
      const len = c.duration * (c.speed ?? 1)
      const lo = c.inPoint - EPS
      const hi = c.inPoint + len + EPS
      // The points the clip's window does not show (a trimmed or split
      // piece's) stay: trimming back out brings them back.
      const outside = (c.speedCurve?.keys ?? []).filter((k) => k.m < lo || k.m > hi)
      let keys = tidyKeys([...outside, ...keysFromPoints(c, curve.points)])
      let next = { keys, ...(curve.linear ? { linear: true as const } : {}) }
      let d = curveDuration(next, c.inPoint, len)
      // Never shorter than one frame: the whole curve is slowed till it is.
      if (d < least && d > 0) {
        const f = d / least
        keys = tidyKeys(keys.map((k) => ({ m: k.m, v: k.v * f })))
        next = { keys, ...(curve.linear ? { linear: true as const } : {}) }
        d = curveDuration(next, c.inPoint, len)
      }
      if (!(d > 0) || !(len > 0)) continue
      retimeClip(p, c, len / d, next)
    }
    carryPartners(p, before, new Set(group.map((c) => c.id)))
    applyAutoPack(p)
  }
})

export const setFades = defineCommand({
  name: 'clip.setFades',
  summary: 'Set a clip\'s fade-in and fade-out: seconds of its sound only fading in and out (the picture is not faded).',
  params: s.object({ clipId: s.id(), fadeIn: s.optional(s.number({ min: 0, description: 'seconds' })), fadeOut: s.optional(s.number({ min: 0, description: 'seconds' })) }),
  check: clipOk('clip.setFades'),
  apply(p, { clipId, fadeIn, fadeOut }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    if (fadeIn !== undefined) clip.fadeIn = fadeIn
    if (fadeOut !== undefined) clip.fadeOut = fadeOut
  }
})

export const TRANSITION_TYPES = ['mix', 'fade', 'slide', 'wipe', 'zoom', 'flash', 'whip', 'blur', 'iris', 'push', 'ramp-right', 'ramp-left', 'ramp-down', 'ramp-up', 'speed-ramp', 'light-leak', 'film-burn'] as const

const transition = s.object({
  type: s.enum(TRANSITION_TYPES),
  duration: s.number({ min: TRANSITION_LIMITS.min, max: TRANSITION_LIMITS.max, description: 'seconds' }),
  align: s.optional(s.enum(['auto', 'center', 'start', 'end'] as const))
})

export const setTransition = defineCommand({
  name: 'clip.setTransition',
  summary: 'Set (or remove, with null) the transition from a clip into the clip that follows it.',
  params: s.object({ clipId: s.id(), transition: s.nullable(transition) }),
  check: clipOk('clip.setTransition'),
  apply(p, { clipId, transition }): void {
    const clip = p.clips[clipId]
    if (!clip) return
    // Set (a new type, length, alignment): it goes into the clip after it
    // NOW, whatever partner the old value named — the edit's settle pass
    // fills `to` from the current neighbour, or null when none meets it
    // (Ç2b patch, item 7: a `to: null` spread back in by the junction menu or
    // the inspector stayed a fade-out, or drew nothing, with a clip after it).
    if (transition) {
      const { to: _old, ...rest } = transition as NonNullable<Clip['transitionOut']>
      void _old
      clip.transitionOut = rest as Clip['transitionOut']
    } else delete clip.transitionOut
  }
})

type SetClipArgs = {
  clipId: string
  transform?: Partial<ClipTransform>
  opacity?: number
  volume?: number
  muted?: boolean
  speed?: number
  fadeIn?: number
  fadeOut?: number
  transitionOut?: unknown
}
/** The channels of `clip` that `clip.set` with `a` would set but that are
 *  keyed (and so are not set). */
export function setClipKeyed(clip: Clip, a: { transform?: object; opacity?: number }): KfChannel[] {
  return keyedOf(clip, [...(a.transform ? transformChannels(a.transform) : []), ...(a.opacity !== undefined ? (['opacity'] as const) : [])])
}
/** `a` without the keyed channels; null when nothing else is left to set
 *  (then the call is refused whole). Ç2c patch, item 8: one keyed channel
 *  refused the volume, the fades… sent with it. */
function setClipRest<A extends SetClipArgs>(clip: Clip, a: A): A | null {
  const keyed = setClipKeyed(clip, a)
  if (keyed.length === 0) return a
  const t = a.transform ? Object.fromEntries(Object.entries(a.transform).filter(([k]) => !(keyed as string[]).includes(k))) : undefined
  const rest = { ...a, transform: t && transformChannels(t).length ? t : undefined, opacity: keyed.includes('opacity') ? undefined : a.opacity }
  const left = rest.transform !== undefined || [rest.opacity, rest.volume, rest.muted, rest.speed, rest.fadeIn, rest.fadeOut, rest.transitionOut].some((v) => v !== undefined)
  return left ? rest : null
}

/** Several settings of one clip at once, in a fixed order. */
export const setClip = defineCommand({
  name: 'clip.set',
  summary: 'Change several settings of one clip at once: transform, opacity, volume, muted, speed, fades, transition out.',
  params: s.object({
    clipId: s.id(),
    transform: s.optional(s.object({ x: s.optional(s.number({ description: 'px' })), y: s.optional(s.number({ description: 'px' })), scale: s.optional(s.number({ min: 0 })), rotation: s.optional(s.number({ description: 'radians' })) })),
    opacity: s.optional(s.number({ min: 0, max: 1 })),
    volume: s.optional(s.number({ min: 0, max: 4 })),
    muted: s.optional(s.boolean()),
    speed: s.optional(s.number({ min: SPEED_MIN, max: SPEED_MAX })),
    fadeIn: s.optional(s.number({ min: 0, description: 'seconds' })),
    fadeOut: s.optional(s.number({ min: 0, description: 'seconds' })),
    transitionOut: s.optional(s.nullable(transition)),
    linkAV
  }),
  check(p, a) {
    const clip = requireClip(p, a.clipId, 'clip.set')
    // (A keyed channel is not set, the rest is; refused whole, before
    // anything is set, when nothing else is left: report K13.)
    if (!setClipRest(clip, a)) refuseKeyed('clip.set', clip, setClipKeyed(clip, a))
  },
  apply(p, args, env): void {
    if (!p.clips[args.clipId]) throw new CommandError('clip.set', `there is no clip ${args.clipId}`)
    const a = setClipRest(p.clips[args.clipId], args)
    if (!a) return refuseKeyed('clip.set', p.clips[args.clipId], setClipKeyed(p.clips[args.clipId], args))
    if (a.transform) setTransform.apply(p, { clipId: a.clipId, transform: a.transform }, env)
    if (a.opacity !== undefined) setOpacity.apply(p, { clipId: a.clipId, opacity: a.opacity }, env)
    if (a.volume !== undefined) setVolume.apply(p, { clipId: a.clipId, volume: a.volume }, env)
    if (a.muted !== undefined) setMuted.apply(p, { clipId: a.clipId, muted: a.muted }, env)
    if (a.speed !== undefined) setSpeed.apply(p, { clipId: a.clipId, speed: a.speed, linkAV: a.linkAV }, env)
    if (a.fadeIn !== undefined || a.fadeOut !== undefined) setFades.apply(p, { clipId: a.clipId, fadeIn: a.fadeIn, fadeOut: a.fadeOut }, env)
    if (a.transitionOut !== undefined) setTransition.apply(p, { clipId: a.clipId, transition: a.transitionOut }, env)
  }
})
