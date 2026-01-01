// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's clip-local automation as its window moves over its content.
//
// Keyframe times (the transform channels, opacity, volume, the ducking's
// original envelope, the mask, a picture's moves) are clip-LOCAL seconds.
// Phase Ç2c.1, decision 1 (report K1, K2, K4, K9, K15): an edit changes only
// the WINDOW a clip shows of its keys; it never drops a key and never makes
// one up. A head trim, a ripple cut, the silence cut, keep-range, a split's
// right half move every key by the content they took off the front (`from`);
// a tail trim moves none; both halves of a split carry the whole list. A key
// outside [0, duration] is kept ("off the clip"): it still shapes the curve
// inside, and comes back when the clip is opened out again. So the value
// any piece shows at a frame of its content is the value the clip showed
// there before, to the bit — where a boundary key with the eased value at
// the cut used to restart the easing in every piece (a slow push pulsed at
// every silence cut) and a head trim lost the keys before it for good.

import type { MoveAction, Clip, FxKey, MaskKeyframe, MotionFx, PropKeyframe } from '../types'
import { FX_KEYS, KF_CHANNELS, defaultBloom, defaultHalation, defaultIsolate, uid } from '../types'
import { fxAmountAt } from '../playback/pose'


/** Everything on a clip that is timed in clip-local seconds, copied. */
export interface ClipAutomation {
  channels?: Clip['channels']
  /** The keys on effect amounts ("cila" part D). */
  fxKeys?: Clip['fxKeys']
  volumeKeyframes?: Clip['volumeKeyframes']
  /** autoDucking.originalVolumeKeyframes */
  duckKeyframes?: PropKeyframe[]
  maskKeyframes?: MaskKeyframe[]
  /** clip.moves.actions (a picture's moves) */
  moveActions?: MoveAction[]
}

/** A copy of the clip's automation, to cut pieces from later (a drag keeps
 *  the one it started with, so every frame of it is cut from the original). */
export function automationOf(clip: Clip): ClipAutomation {
  const out: ClipAutomation = {}
  if (clip.channels) out.channels = structuredClone(clip.channels)
  if (clip.fxKeys) out.fxKeys = structuredClone(clip.fxKeys)
  if (clip.volumeKeyframes) out.volumeKeyframes = structuredClone(clip.volumeKeyframes)
  if (clip.autoDucking?.originalVolumeKeyframes) out.duckKeyframes = structuredClone(clip.autoDucking.originalVolumeKeyframes)
  if (clip.mask?.keyframes) out.maskKeyframes = structuredClone(clip.mask.keyframes)
  if (clip.moves?.actions) out.moveActions = structuredClone(clip.moves.actions)
  return out
}

/** A keyable effect's own (unkeyed) amount, set ("cila" part D). */
export function setFxBase(clip: Clip, key: FxKey, value: number): void {
  if (key === 'bloom') clip.bloom = { ...defaultBloom(), ...clip.bloom, amount: value }
  else if (key === 'halation') clip.halation = { ...defaultHalation(), ...clip.halation, amount: value }
  else if (key === 'mosaic') {
    if (value > 0) clip.mosaic = value
    else delete clip.mosaic
  } else clip.isolate = { ...defaultIsolate(), ...clip.isolate, amount: value }
}

/** A held frame animates nothing: each keyed effect amount becomes what it
 *  showed at clip-local `local`, and its keys go. */
export function holdFxKeys(clip: Clip, local: number): void {
  if (!clip.fxKeys) return
  for (const key of FX_KEYS) if (clip.fxKeys[key]?.length) setFxBase(clip, key, fxAmountAt(clip, key, local))
  delete clip.fxKeys
}

/**
 * Puts `source`'s automation on `clip` with every key time `t` at `map(t)`
 * (a shift for a window edit, a scale for a speed change): every key kept,
 * none made. `freshIds` gives a NEW piece its own keyframe ids. A picture's
 * moves follow only a shift (`moves`: their lengths are not rescaled).
 */
export function remapClipAutomation(
  clip: Clip,
  map: (t: number) => number,
  source: ClipAutomation = automationOf(clip),
  opts: { freshIds?: boolean; moves?: boolean } = {}
): void {
  const fresh = !!opts.freshIds
  const move = <K extends { id: string; time: number }>(list: readonly K[]): K[] =>
    list.map((k) => ({ ...k, id: fresh ? uid() : k.id, time: map(k.time) }))
  if (source.channels) {
    const channels: NonNullable<Clip['channels']> = {}
    for (const ch of KF_CHANNELS) {
      const list = source.channels[ch]
      if (list && list.length > 0) channels[ch] = move(list)
    }
    clip.channels = channels
  }
  if (source.fxKeys) {
    const fxKeys: NonNullable<Clip['fxKeys']> = {}
    for (const key of FX_KEYS) {
      const list = source.fxKeys[key]
      if (list && list.length > 0) fxKeys[key] = move(list)
    }
    clip.fxKeys = fxKeys
  }
  if (source.volumeKeyframes) {
    if (source.volumeKeyframes.length > 0) clip.volumeKeyframes = move(source.volumeKeyframes)
    else delete clip.volumeKeyframes
  }
  if (clip.autoDucking && source.duckKeyframes) {
    if (source.duckKeyframes.length > 0) clip.autoDucking.originalVolumeKeyframes = move(source.duckKeyframes)
    else delete clip.autoDucking.originalVolumeKeyframes
  }
  if (clip.mask && source.maskKeyframes) {
    if (source.maskKeyframes.length > 0) clip.mask.keyframes = move(source.maskKeyframes)
    else delete clip.mask.keyframes
  }
  if (opts.moves !== false && clip.moves && source.moveActions) {
    clip.moves = { ...clip.moves, actions: source.moveActions.map((a) => ({ ...a, time: map(a.time) })) }
  }
}

/**
 * The clip now shows `source`'s clip-local window from `from` on (of the
 * clip's own automation by default), so local 0 is `from`: every key moves
 * by −from, none is dropped (the window's end, `to`, moves no key). `from`
 * may be negative: a head trim that reveals earlier footage moves every key
 * later.
 */
export function sliceClipAutomation(
  clip: Clip,
  from: number,
  to: number,
  source: ClipAutomation = automationOf(clip),
  opts: { freshIds?: boolean } = {}
): void {
  void to
  remapClipAutomation(clip, (t) => t - from, source, opts)
}

/**
 * A slip moved the media under `clip` from in point `oldIn` to `newIn`: its
 * keys move with the picture, so each stays on the frame it was put on (phase
 * Ç2c.1, decision 4; Premiere's way). A held frame shows one frame wherever
 * the media lies: its keys stay.
 */
export function slipAutomation(clip: Clip, oldIn: number, newIn: number): void {
  if (clip.freeze !== undefined) return
  const d = (newIn - oldIn) / (clip.speed ?? 1)
  const from = clip.reversed ? -d : d
  if (from === 0) return
  sliceClipAutomation(clip, from, from + clip.duration)
}

/**
 * The part of a Ken Burns / handheld move (`motionFx`) a piece of the clip
 * plays: normalised progress f0..f1 of the whole, as a linear slice the way a
 * motion chain is sliced, its shake clock `offset` seconds on. Each piece
 * then continues the move instead of restarting it.
 */
export function sliceMotionFx(fx: MotionFx, f0: number, f1: number, offset: number): MotionFx {
  const ease = (t: number): number => {
    const c = Math.min(1, Math.max(0, t))
    return fx.ease === 'linear' ? c : c * c * (3 - 2 * c)
  }
  const s0 = ease(f0)
  const s1 = ease(f1)
  const lerp = (a: number, b: number, s: number): number => a + (b - a) * s
  const out: MotionFx = {
    ...fx,
    zoomFrom: lerp(fx.zoomFrom, fx.zoomTo, s0),
    zoomTo: lerp(fx.zoomFrom, fx.zoomTo, s1),
    panFrom: lerp(fx.panFrom ?? -0.5, fx.panTo ?? 0.5, s0),
    panTo: lerp(fx.panFrom ?? -0.5, fx.panTo ?? 0.5, s1),
    ease: 'linear',
    timeOffset: (fx.timeOffset ?? 0) + offset
  }
  if (fx.gentlePanFrom !== undefined || fx.gentlePanTo !== undefined || fx.gentlePanX !== undefined || fx.gentlePanY !== undefined) {
    out.gentlePanFrom = lerp(fx.gentlePanFrom ?? -0.5, fx.gentlePanTo ?? 0.5, s0)
    out.gentlePanTo = lerp(fx.gentlePanFrom ?? -0.5, fx.gentlePanTo ?? 0.5, s1)
  }
  return out
}

/** Gives every clip nested inside a compound (at any depth) a new id: two
 *  compounds must never own children with one id, or the playback engine,
 *  the scrubber and the exporter (all keyed by clip id) drive one element for
 *  both. For a copy, a duplicate or a split's new piece. */
export function freshNestedIds(clip: Clip): void {
  if (!clip.nested) return
  const ids = new Map<string, string>()
  for (const child of clip.nested.clips) {
    const id = uid()
    ids.set(child.id, id)
    child.id = id
    freshNestedIds(child)
  }
  // A transition between two children names its sibling by id (phase
  // Ç2b.2, decision 1): re-aimed at the new one.
  for (const child of clip.nested.clips) {
    const to = child.transitionOut?.to
    if (typeof to === 'string' && ids.has(to)) child.transitionOut!.to = ids.get(to)!
  }
}

/** A copy of a clip (paste, duplicate, Alt-drag): new ids at every depth and
 *  new links between a compound's children, so the copy shares no id and no
 *  link with the clip it was copied from (phase Ç2a.1, report P6: two
 *  compounds owned children with the same ids, and the engine, the scrubber
 *  and the exporter, keyed by clip id, drove one element for both). */
export function freshCopy(clip: Clip): void {
  if (!clip.nested) return
  freshNestedIds(clip)
  const links = new Map<string, string>()
  const walk = (list: Clip[]): void => {
    for (const c of list) {
      if (c.linkId) {
        if (!links.has(c.linkId)) links.set(c.linkId, uid())
        c.linkId = links.get(c.linkId)
      }
      if (c.nested) walk(c.nested.clips)
    }
  }
  walk(clip.nested.clips)
}
