// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The arithmetic of the timeline's view (phase 3c.T): the lane height steps,
// zooming about a fixed point, fitting the film in the view, when a press
// becomes a drag, how fast a drag at the edge scrolls. Pure: no store, no DOM
// (src/test/timeline-feel.test.ts).
import type { Track } from '../types'
import { defaultTrackHeight } from '../types'

/** The three lane heights. `medium` is the timeline's default geometry
 *  (video 72, sound 60 since the v3 interface; 58 and 48 before): the one the
 *  reference boxes are measured at. */
export type TrackScale = 'small' | 'medium' | 'large'
export const TRACK_SCALES: readonly TrackScale[] = ['small', 'medium', 'large']

/** A lane's height at a step, as a share of its medium height. Large: a video
 *  lane 1.5 times, a sound lane 1.4 times (a taller film strip and sound
 *  drawing); small: 42 and 34 px, for a film with many lanes. */
const FACTOR: Record<TrackScale, Record<Track['kind'], number>> = {
  small: { video: 42 / 72, audio: 34 / 60 },
  medium: { video: 1, audio: 1 },
  large: { video: 1.5, audio: 1.4 }
}

/** The height a lane is drawn at: its own height (dragged by hand) or its
 *  kind's, scaled by the step. Whole pixels; never under 24. */
export function laneHeight(kind: Track['kind'], own: number | undefined, scale: TrackScale): number {
  const base = own ?? defaultTrackHeight(kind)
  return scale === 'medium' ? base : Math.max(24, Math.round(base * FACTOR[scale][kind]))
}

/** The inverse, for the lane's resize grip: the height to keep for a lane
 *  that should be drawn `shown` px tall at this step. */
export function ownHeightFor(kind: Track['kind'], shown: number, scale: TrackScale): number {
  return scale === 'medium' ? shown : shown / FACTOR[scale][kind]
}

/** The step after (dir 1: taller) or before; stops at the ends. */
export function nextTrackScale(scale: TrackScale, dir: 1 | -1): TrackScale {
  const i = TRACK_SCALES.indexOf(scale)
  return TRACK_SCALES[Math.max(0, Math.min(TRACK_SCALES.length - 1, i + dir))]
}

/** The one-time move to small (22 November, L6): a profile with no stored
 *  height, or with the medium an earlier version wrote for it, goes to small;
 *  small and large stay as they are. */
export const movedToSmall = (saved: string | null | undefined): boolean => saved !== 'small' && saved !== 'large'

export function trackScaleOf(saved: string | null | undefined): TrackScale {
  // A new profile starts small (DENEME-3, item 12: the user's default); a
  // height chosen before is kept.
  return saved === 'medium' || saved === 'large' ? saved : 'small'
}

// ---- zoom -------------------------------------------------------------------------
/** Pixels per second: the same ends for the wheel, the slider, the number
 *  field and the shortcuts (the slider used to stop at 400, the wheel at 600). */
export const ZOOM_MIN = 1
export const ZOOM_MAX = 600
export const clampZoom = (px: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, px))

/** One wheel event's zoom: continuous in the wheel's travel (a trackpad sends
 *  many small ones, a wheel notch one of 100). */
export const wheelZoom = (px: number, deltaY: number): number => clampZoom(px * Math.exp(-deltaY * 0.0018))

/** The scroll offset that keeps `time` under the view's x `viewX` (pixels from
 *  the scroll area's left edge, the header column included) at a zoom. */
export const zoomScrollLeft = (time: number, viewX: number, px: number, headerW: number): number => Math.max(0, time * px + headerW - viewX)

/** The time under a view x at a zoom and scroll offset. */
export const timeAtViewX = (viewX: number, scrollLeft: number, px: number, headerW: number): number => (viewX + scrollLeft - headerW) / px

/** The zoom at which a film of `duration` seconds fills a view `viewWidth`
 *  wide (the header column and a small margin taken off). */
export function fitZoom(duration: number, viewWidth: number, headerW: number): number {
  const width = Math.max(200, viewWidth - headerW - 24)
  return clampZoom(width / Math.max(1, duration))
}

/** A zoom on its way from one value to another: `t` 0..1 of the way, eased
 *  out, in equal ratios (a zoom is felt as a ratio, not a difference). */
export function zoomBetween(from: number, to: number, t: number): number {
  if (t >= 1 || from <= 0 || to <= 0) return to
  const e = 1 - (1 - Math.max(0, t)) ** 3
  return from * (to / from) ** e
}

/** While a zoom is under way: the box (left, width) a drawing made at another
 *  zoom takes at this one, so it is stretched in place instead of drawn again
 *  on every step. `need`: the stretch of the clip (its own pixels, from..to)
 *  that has to be covered now; a drawing that no longer reaches it (zoomed far
 *  out, or scrolled away) is not held. Null: draw (no zoom under way, nothing
 *  drawn yet, the same zoom, or not covering). */
export function heldBox(zooming: boolean, drawn: { from: number; w: number; px: number } | null, px: number, need: { from: number; to: number }): { left: number; width: number } | null {
  if (!zooming || !drawn || drawn.px === px || drawn.px <= 0) return null
  const r = px / drawn.px
  const left = drawn.from * r
  const width = drawn.w * r
  if (left > need.from + 1 || left + width < need.to - 1) return null
  return { left, width }
}

/** The stretch of a clip a held drawing must still cover: what is drawn
 *  (from..to, 600 px past the view on either side) less most of that margin. */
export function heldNeed(from: number, to: number, margin = 344): { from: number; to: number } {
  const mid = (from + to) / 2
  return { from: Math.min(from + margin, mid), to: Math.max(to - margin, mid) }
}

// ---- drags -------------------------------------------------------------------------
/** A press becomes a drag once the pointer has travelled this far (px): the
 *  same for clips, subtitle chips, bands, blocks and the selection box. */
export const DRAG_START_PX = 4
export const dragStarted = (dx: number, dy = 0, slop = DRAG_START_PX): boolean => Math.abs(dx) >= slop || Math.abs(dy) >= slop

/** Pixels the view scrolls this frame while a drag is held `depth` px inside
 *  the edge zone (`zone` px wide), `held` ms after it entered it: faster the
 *  deeper it is, and faster the longer it stays (up to 2.5 times after 1.2 s).
 *  `dt` is the frame's length (ms), so the speed is per second, not per event. */
export function edgeScrollSpeed(depth: number, zone: number, held: number, dt: number): number {
  if (depth <= 0 || zone <= 0) return 0
  const deep = Math.min(1, depth / zone)
  const ramp = 1 + 1.5 * Math.min(1, Math.max(0, held) / 1200)
  // 240 px/s at the zone's lip to 1500 px/s at the very edge, times the ramp.
  const perSecond = (240 + 1260 * deep * deep) * ramp
  return (perSecond * Math.min(50, Math.max(0, dt))) / 1000
}

/** The words of a trim's label: the edge's time, how far it moved, how long
 *  the clip is now (the caller's text does the rest). */
export function trimDelta(moved: number): { sign: '+' | '−'; abs: string } {
  return { sign: moved >= 0 ? '+' : '−', abs: Math.abs(moved).toFixed(2) }
}
