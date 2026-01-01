// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Keys on the frame grid (phase Ç2c.2, decision 1; report K7, D4).
//
// Every key writer — a clip's channels, its mask, its volume, a caption's
// motion, a tracker, the Shorts pan, a map template's camera — puts the key
// on a frame of the project (the timeline's grid: frame n is at n / fps, the
// instants an export draws), and two keys are one key only when they fall on
// the same frame: closer than half a frame. The writers had merge windows of
// their own (0.04 s to 0.15 s), so at 30 fps a key one or two frames from
// another overwrote it, and frame-by-frame tracking could not be written.
// Pure.

import { frameTime } from './rates'

/** Two keys closer than this many frames are on the same frame. */
export const KEY_MERGE_FRAMES = 0.5

/** A frame rate a division can use (a broken setting reads as 30). */
const rate = (fps: number): number => (Number.isFinite(fps) && fps > 0 ? fps : 30)

/** Seconds within which a write lands on a key already there. */
export const keyMergeWindow = (fps: number): number => KEY_MERGE_FRAMES / rate(fps)

/** Whether two key times are on one frame. */
export const sameFrame = (a: number, b: number, fps: number): boolean => Math.abs(a - b) < keyMergeWindow(fps)

/** A timeline time on the nearest frame (the export's own frame time:
 *  exact for NTSC rates, phase Ç3a). */
export function onFrameGrid(t: number, fps: number): number {
  const f = rate(fps)
  return frameTime(Math.round(t * f), f)
}

/** A key time counted from `origin` (a clip's start, a caption's, a
 *  template's) put on the timeline's frame grid, still counted from
 *  `origin`. */
export const gridLocal = (local: number, origin: number, fps: number): number => onFrameGrid(origin + local, fps) - origin

/** A playhead this far outside a span still writes on its edge (float
 *  noise of a playhead put on the edge). */
const EDGE = 1e-6

/**
 * Where a key written with the playhead at timeline time `t` lands on a span
 * (a clip, a caption, a template block): its local time on the frame grid,
 * held to the span; null when the playhead is not on the span (report K19:
 * a key written there landed on the clip's edge, unasked).
 */
export function keyLocalAt(span: { start: number; duration: number }, t: number, fps: number): number | null {
  if (!(t >= span.start - EDGE) || !(t <= span.start + span.duration + EDGE)) return null
  const local = gridLocal(t - span.start, span.start, fps)
  return Math.min(span.duration, Math.max(0, local))
}

/** The key of `list` on the frame of `time`, if any (the nearest). */
export function keyOnFrame<K extends { time: number }>(list: readonly K[] | undefined, time: number, fps: number): K | undefined {
  let best: K | undefined
  for (const k of list ?? []) {
    if (!sameFrame(k.time, time, fps)) continue
    if (!best || Math.abs(k.time - time) < Math.abs(best.time - time)) best = k
  }
  return best
}
