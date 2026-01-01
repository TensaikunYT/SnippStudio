// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A card's reset (REF-AB, item 2; REF-AB-PLAN-I.md): the ↺ at the right of
// a Clip card's title puts that card's values back to what a new clip has,
// as ONE undo step. What "back" means per card is here, pure: whether a card
// is already as new (its ↺ is then off), and the store's own actions that
// put it back (the reset runs them inside one `undoable`, so every rule the
// actions keep — linked sound, keys on the frame grid, the model check —
// holds for a reset too). A keyed value is reset with its keys: a value with
// keys is not at its default anywhere but on them.
import { containScale } from '../../commands/ops/base'
import type { EditorState } from '../../state/editor-state'
import { assetById, type Clip, type KfChannel, type Project } from '../../types'

/** The Clip tab's cards that hold values (the order they are drawn in). The
 *  others (applied layers, the code film, moves, the keyframe list, the
 *  transition) have their own remove or clear buttons and no reset. */
export const RESET_PARTS = ['transform', 'audio', 'speed', 'opacity', 'color', 'effects', 'mask', 'crop', 'chroma', 'tracker', 'motion', 'cinematic'] as const
export type ResetPart = (typeof RESET_PARTS)[number]

/** The transform's keyable channels (opacity is the Opacity card's). */
export const TRANSFORM_CHANNELS: readonly KfChannel[] = ['x', 'y', 'scale', 'rotation']

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6

/** The scale a new clip of this asset gets (the whole picture in the frame);
 *  a compound clip and a missing asset: 1. */
export function defaultScale(p: Project, clip: Clip): number {
  if (clip.nested) return 1
  const asset = assetById(p, clip.assetId)
  return asset && asset.width > 0 && asset.height > 0 ? containScale(p, asset) : 1
}

const keyed = (clip: Clip, ch: KfChannel): boolean => (clip.channels?.[ch]?.length ?? 0) > 0

/** Whether `part` of `clip` is as a new clip has it (nothing to reset). */
export function partIsDefault(p: Project, clip: Clip, part: ResetPart): boolean {
  switch (part) {
    case 'transform': {
      const tf = clip.transform
      return (
        TRANSFORM_CHANNELS.every((ch) => !keyed(clip, ch)) &&
        near(tf.x, p.settings.width / 2) &&
        near(tf.y, p.settings.height / 2) &&
        near(tf.scale, defaultScale(p, clip)) &&
        near(tf.rotation, 0) &&
        !clip.flipH &&
        !clip.flipV
      )
    }
    case 'audio':
      return near(clip.volume ?? 1, 1) && !clip.muted && !clip.fadeIn && !clip.fadeOut && !clip.volumeKeyframes?.length && !clip.audioFx && clip.keepPitch !== false
    case 'speed':
      return near(clip.speed ?? 1, 1) && !clip.speedCurve && !clip.reversed
    case 'opacity':
      return !keyed(clip, 'opacity') && near(clip.opacity ?? 1, 1) && (clip.blendMode ?? 'normal') === 'normal'
    case 'color':
      return !clip.grade && !clip.tone && !clip.lut && (clip.lutAmount === undefined || near(clip.lutAmount, 1)) && !clip.blur
    case 'effects':
      return (
        (!clip.videoFx || clip.videoFx.style === 'none') &&
        !clip.stillImageFx &&
        !clip.ambientFx &&
        !clip.sharpen &&
        !clip.vignette &&
        !clip.grain &&
        !clip.glow &&
        !clip.chromaAb &&
        !clip.duotone &&
        !clip.bloom &&
        !clip.halation &&
        !clip.mosaic &&
        !clip.isolate &&
        !clip.fxKeys
      )
    case 'mask':
      return !clip.mask
    case 'crop':
      return !clip.crop
    case 'chroma':
      return !clip.chroma
    case 'tracker':
      return !clip.trackerId
    case 'motion':
      return (!clip.anim || ((clip.anim.in ?? 'none') === 'none' && (clip.anim.out ?? 'none') === 'none')) && !clip.idle
    case 'cinematic':
      return !clip.motionFx
  }
}

/** The store actions a reset runs (the store's own; the test can watch
 *  them on a stand-in). */
export type ResetActions = Pick<
  EditorState,
  | 'deleteKeyframes' | 'setClipTransform' | 'setClipFlip' | 'setClipVolume' | 'toggleClipMute' | 'setClipFades' | 'clearVolumeKeyframes'
  | 'setClipAudioFx' | 'setClipKeepPitch' | 'setClipSpeedCurve' | 'setClipSpeed' | 'toggleReverse' | 'setClipOpacity' | 'setClipBlendMode'
  | 'setClipGrade' | 'setClipTone' | 'setClipLut' | 'setClipLutAmount' | 'setClipBlur' | 'setClipEffect' | 'setClipFx' | 'setClipMask'
  | 'setClipCrop' | 'setClipChroma' | 'setClipTracker' | 'setClipAnim' | 'setClipIdle' | 'setMotionFx'
>

/** Runs the actions that put `part` of `clip` back (the caller wraps them in
 *  one undo step). Only what differs is touched. */
export function runReset(p: Project, clip: Clip, part: ResetPart, a: ResetActions): void {
  const id = clip.id
  switch (part) {
    case 'transform': {
      const keys = TRANSFORM_CHANNELS.flatMap((ch) => (clip.channels?.[ch] ?? []).map((k) => ({ ch, id: k.id })))
      if (keys.length) a.deleteKeyframes(id, keys)
      a.setClipTransform(id, { x: p.settings.width / 2, y: p.settings.height / 2, scale: defaultScale(p, clip), rotation: 0 })
      if (clip.flipH || clip.flipV) a.setClipFlip(id, { h: false, v: false })
      return
    }
    case 'audio':
      if (clip.volumeKeyframes?.length) a.clearVolumeKeyframes(id)
      if (!near(clip.volume ?? 1, 1)) a.setClipVolume(id, 1)
      // (Read again: setting the volume unmutes.)
      if (clip.muted) a.toggleClipMute(id)
      if (clip.fadeIn || clip.fadeOut) a.setClipFades(id, { fadeIn: 0, fadeOut: 0 })
      if (clip.audioFx) a.setClipAudioFx(id, null)
      if (clip.keepPitch === false) a.setClipKeepPitch(id, true)
      return
    case 'speed':
      if (clip.speedCurve) a.setClipSpeedCurve(id, null)
      a.setClipSpeed(id, 1)
      if (clip.reversed) a.toggleReverse(id)
      return
    case 'opacity': {
      const keys = (clip.channels?.opacity ?? []).map((k) => ({ ch: 'opacity' as const, id: k.id }))
      if (keys.length) a.deleteKeyframes(id, keys)
      a.setClipOpacity(id, 1)
      if ((clip.blendMode ?? 'normal') !== 'normal') a.setClipBlendMode(id, 'normal')
      return
    }
    case 'color':
      if (clip.grade) a.setClipGrade(id, null)
      if (clip.tone) a.setClipTone(id, null)
      if (clip.lut) a.setClipLut(id, null)
      if (clip.lutAmount !== undefined && !near(clip.lutAmount, 1)) a.setClipLutAmount(id, 1)
      if (clip.blur) a.setClipBlur(id, 0)
      return
    case 'effects':
      // (setClipEffect drops a field given null; its type names only the
      // look ones as nullable.)
      a.setClipEffect(id, { videoFx: null, stillImageFx: null, ambientFx: null, sharpen: null, vignette: null, grain: null, glow: null, chromaAb: null, duotone: null } as unknown as Parameters<ResetActions['setClipEffect']>[1])
      a.setClipFx(id, { bloom: null, halation: null, mosaic: null, isolate: null })
      return
    case 'mask':
      return a.setClipMask(id, null)
    case 'crop':
      return a.setClipCrop(id, null)
    case 'chroma':
      return a.setClipChroma(id, null)
    case 'tracker':
      return a.setClipTracker(id, null)
    case 'motion':
      if (clip.anim) a.setClipAnim(id, { in: 'none', out: 'none' })
      if (clip.idle) a.setClipIdle(id, { style: 'none' })
      return
    case 'cinematic':
      return a.setMotionFx(id, null)
  }
}
