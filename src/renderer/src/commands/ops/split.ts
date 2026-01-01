// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Splitting clips (moved out of state/store.ts in phase 2A, unchanged).
import type { Clip, Project } from '../../types'
import { instanceOf, uid } from '../../types'
import { automationOf, freshNestedIds, sliceClipAutomation, sliceMotionFx, type ClipAutomation } from '../../timeline/slice'
import { clone, findTrack, sortTrack } from './base'
import { freePairs } from './links'
import { inPointFor, takePart } from '../../timeline/media-time'
import { EDGE_MIN, MS_EPS } from '../../timeline/eps'

/**
 * Gives the two halves of a split their keyframes (phase Ç2c.1, decision 1;
 * report K1, K9, K15): both carry the whole list, the right half's moved by
 * the left one's length, so each shows exactly the motion it showed before
 * (channels, volume, the ducking's envelope, the mask, a picture's moves).
 * `source` is the clip's automation before the cut; the right half gets
 * keyframe ids of its own.
 */
export function divideAutomation(left: Clip, right: Clip, local: number, source: ClipAutomation = automationOf(left)): void {
  sliceClipAutomation(left, 0, local, source)
  sliceClipAutomation(right, local, local + right.duration, source, { freshIds: true })
}

/** The clips of `ids` a cut at timeline time `t` really splits: on a track
 *  that is not locked, the cut more than 0.05 s inside. With `linkAV` (the
 *  A/V link on), a linked partner is cut with its clip, so the halves stay
 *  pairs. */
export function clipsToSplit(p: Project, ids: readonly string[], t: number, linkAV: boolean): Clip[] {
  // With their partners; a pair a lock holds (one of them on a locked
  // track) is not cut at all (phase Ç2b.1, decision 3).
  const want = freePairs(p, ids, linkAV)
  const out: Clip[] = []
  for (const id of want) {
    const clip = p.clips[id]
    if (!clip) continue
    const local = t - clip.start
    if (local <= EDGE_MIN || local >= clip.duration - EDGE_MIN) continue
    out.push(clip)
  }
  return out
}

/**
 * Splits clips at timeline time `t` (from `clipsToSplit`). The right piece is
 * the same clip from there on: it joins the left's group (a group stays one
 * block), and when both halves of a linked pair are cut, the right halves are
 * linked to each other, not to the left ones (before, all four pieces shared
 * one link, so moving the left half with the link on dragged the right half
 * along). A linked clip cut alone keeps its link on both halves: its partner
 * still runs under both. Returns the right pieces' ids.
 */
/**
 * A clip cut into a left and a right piece (a split, a cut out of its middle,
 * a freeze frame), `whole` seconds long before; the left piece ends at its
 * clip-local `leftEnd`, the right one starts at `rightStart` (the same for a
 * split). The transition into the next clip belongs to the piece that still
 * ends where the clip ended — the left one ran it into its own continuation —
 * and so do the way out and the fade-out; the way in and the fade-in stay
 * with the left one. Copied to both, the cut showed a dip or a restart. A
 * slow push or pan (Cinematize) goes on across the cut, and a compound's
 * children get ids of their
 * own (one id in two compounds made the engine drive one element for both).
 */
export function divideClipExtras(p: Project, left: Clip, right: Clip, whole: number, leftEnd: number, rightStart: number): void {
  delete left.transitionOut
  delete left.fadeOut
  delete right.fadeIn
  if (left.anim) {
    delete left.anim.out
    delete left.anim.outDur
  }
  if (right.anim) {
    delete right.anim.in
    delete right.anim.inDur
  }
  if (left.motionFx && whole > 0) {
    const fx = left.motionFx
    left.motionFx = sliceMotionFx(fx, 0, leftEnd / whole, 0)
    right.motionFx = sliceMotionFx(fx, rightStart / whole, 1, rightStart)
  }
  freshNestedIds(right)
}

export function splitClipsIn(p: Project, clips: readonly Clip[], t: number): string[] {
  const rights: string[] = []
  const rightsByLink = new Map<string, Clip[]>()
  for (const clip of clips) {
    const local = t - clip.start
    const right: Clip = {
      ...clone(clip),
      id: uid(),
      // The same content, cut in two (types.ts Clip.instance).
      instance: instanceOf(clip),
      start: clip.start + local,
      // The media of the right part (a backwards clip's right part shows
      // the media BEFORE its left part's: timeline/media-time.ts).
      inPoint: inPointFor(clip, local, clip.duration),
      duration: clip.duration - local
    }
    // (Along a speed curve each part also has its own average speed.)
    takePart(right, clip, local, clip.duration)
    const whole = clip.duration
    takePart(clip, clip, 0, local)
    clip.duration = local
    divideAutomation(clip, right, local)
    divideClipExtras(p, clip, right, whole, local, local)
    p.clips[right.id] = right
    const track = findTrack(p, clip.trackId)
    if (track) {
      track.clipIds.push(right.id)
      sortTrack(p, track)
    }
    for (const g of p.groups ?? []) if (g.clipIds.includes(clip.id)) g.clipIds.push(right.id)
    if (clip.linkId) rightsByLink.set(clip.linkId, [...(rightsByLink.get(clip.linkId) ?? []), right])
    rights.push(right.id)
  }
  for (const pieces of rightsByLink.values()) {
    if (pieces.length < 2) continue
    const link = uid()
    for (const piece of pieces) piece.linkId = link
  }
  return rights
}

/**
 * Removes the time range [a, b] from the project and ripples everything after
 * it left: clips are trimmed/split/deleted per track (respecting locks and an
 * optional single-track scope), and — when unscoped — captions are removed,
 * word-rebuilt, or shifted to match.
 */
/**
 * The clip a fast edit (Ctrl+B / Q / W) acts on: a selected clip the playhead
 * sits inside, otherwise the topmost clip under the playhead (tracks[0] is the
 * top layer). A tiny epsilon keeps an edge-exact playhead from counting.
 */
export function targetClipAt(p: Project, selectedIds: string[], t: number): Clip | undefined {
  // A clip on a locked track is never the target: Ctrl+B or a ripple trim
  // there would edit what the lock is meant to keep.
  // Nor on a hidden one (phase Ç2b.1, report L7): Ctrl+B / Q / W there cut
  // what cannot be seen.
  const inside = (c: Clip | undefined): c is Clip =>
    !!c && t > c.start + MS_EPS && t < c.start + c.duration - MS_EPS && !findTrack(p, c.trackId)?.locked && !findTrack(p, c.trackId)?.hidden
  for (const id of selectedIds) {
    const c = p.clips[id]
    if (inside(c)) return c
  }
  for (const track of p.tracks) {
    for (const id of track.clipIds) {
      const c = p.clips[id]
      if (inside(c)) return c
    }
  }
  return undefined
}
