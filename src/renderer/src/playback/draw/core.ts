// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The frame renderer's ground: the drawing context type, the frame source,
// the world transform, easing, which clip is on at a time, nested clips,
// trackers. Moved out of playback/render.ts in SnippStudio phase 2B (no change).
import type { Asset, Clip, Project } from '../../types'
import { evalKeys, smoothstep } from '../keys'

// ---------------------------------------------------------------------------
// Motion trackers: a manually keyframed path; attached elements ride the
// delta from the tracker's FIRST keyframe (so attaching never jumps).
// ---------------------------------------------------------------------------
export function trackerDeltaAt(project: Project, trackerId: string, time: number): { dx: number; dy: number } {
  const trk = project.trackers?.find((t) => t.id === trackerId)
  if (!trk || trk.keyframes.length === 0) return { dx: 0, dy: 0 }
  const kfs = [...trk.keyframes].sort((a, b) => a.time - b.time)
  const base = kfs[0]
  const pos = trackerPosAt(kfs, time)
  return { dx: pos.x - base.x, dy: pos.y - base.y }
}

export function trackerPosAt(
  kfs: { time: number; x: number; y: number }[],
  time: number
): { x: number; y: number } {
  // (playback/keys.ts: phase Ç2c.1, decision 6.)
  return (
    evalKeys(kfs, time, (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }), { ease: smoothstep, hold: (k) => k }) ?? { x: 0, y: 0 }
  )
}

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Resolves a clip's pixel source at a given media-local time. */
export type SourceResolver = (clip: Clip, asset: Asset, localTime: number) => CanvasImageSource | null

export function activeClipAtTime(clip: Clip, time: number): boolean {
  return time >= clip.start && time < clip.start + clip.duration
}

export interface DrawClipOptions {
  /** Extra transform applied before clips (used by the canvas-mode editor view). */
  worldTransform?: { scale: number; tx: number; ty: number }
}

/**
 * Puts the context into world (project-pixel) coordinates at the given render
 * scale. This used to also apply the animated canvas camera; with that gone the
 * frame is simply the project frame, so it is a plain scale — kept as its own
 * function because the adjustment-layer path resets the transform and has to
 * put it back.
 */
export function applyWorldTransform(ctx: Ctx2D, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Adjustment layers carry no media; they re-grade the layers beneath them. */
export function isAdjustmentClip(clip: Clip): boolean {
  return clip.adjustment === true
}

/**
 * Compound clips. `clip.nested.clips` hold children whose `start` is relative
 * to the compound clip's own timeline, so the group can be moved, trimmed and
 * effected as one object.
 */
export function nestedChildren(clip: Clip): Clip[] {
  return clip.nested?.clips ?? []
}

/** Children of a compound clip that are on screen at compound-local `local`. */
export function activeNestedChildren(clip: Clip, local: number): Clip[] {
  return nestedChildren(clip).filter((c) => local >= c.start && local < c.start + c.duration)
}

export const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * A harder ease than `smooth` for the pans: slow off the mark, quick through
 * the middle, and settled before it lands. A whip pan on a constant velocity
 * reads as a camera on rails; the snap is what makes it look thrown.
 */
export const snap = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** How long a compound clip's children run, on its own clock. */
export function nestedSpan(clip: Clip): number {
  let span = 0
  for (const c of nestedChildren(clip)) span = Math.max(span, c.start + c.duration)
  return span
}
