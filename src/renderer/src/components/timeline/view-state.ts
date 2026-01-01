// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's own view state (phase 3c.T): the lane height step, and the
// zoom's fixed point and its short animation. Kept out of the project store
// (as playback/viewport.ts is): none of it is an edit, none of it is undone.
import { create } from 'zustand'
import { useStore } from '../../state/store'
import { useViewport } from '../../playback/viewport'
import { motionOff } from '../../ui/motion'
import { projectDuration, TIMELINE_HEADER_W as HEADER_W } from '../../types'
import { clampZoom, fitZoom, laneHeight, movedToSmall, nextTrackScale, timeAtViewX, trackScaleOf, zoomBetween, zoomScrollLeft, type TrackScale } from '../../timeline/view-math'

const SCALE_KEY = 'snipp-track-scale'
/** Written once the profile has been through the move to small (below). */
const SMALL_MOVE_KEY = 'snipp-track-scale-s22'
const read = (): TrackScale => {
  try {
    const saved = localStorage.getItem(SCALE_KEY)
    // 22 November, L6 (the user: "varsayılan S olsun", still seeing M): once
    // per profile, a height nobody chose becomes small. The step before this
    // one WROTE medium into every used profile that had no height, so a
    // stored medium is that writing's trace as likely as a choice: it moves
    // too (view-math movedToSmall). A height chosen after this stays.
    if (localStorage.getItem(SMALL_MOVE_KEY) === null) {
      localStorage.setItem(SMALL_MOVE_KEY, '1')
      if (movedToSmall(saved)) {
        localStorage.setItem(SCALE_KEY, 'small')
        return 'small'
      }
    }
    return trackScaleOf(saved)
  } catch {
    return 'small'
  }
}

/** The lane height step (small / medium / large): the user's, kept with the
 *  profile. Medium is the timeline's own geometry. */
export const useTimelineView = create<{
  trackScale: TrackScale
  setTrackScale: (scale: TrackScale) => void
  stepTrackScale: (dir: 1 | -1) => void
  /** A zoom is under way (wheel steps, the slider's drag, the short glide):
   *  the drawn strips and sound drawings are stretched, and drawn again once
   *  it has settled (ZOOM_SETTLE_MS after its last step). */
  zooming: boolean
  /** A trim under way: its label (where the edge is, how far it moved, how
   *  long the clip is now), beside the edge at `time`, on the lane at `top`. */
  trimTip: { time: number; top: number; side: 'l' | 'r'; text: string } | null
}>((set, get) => ({
  trackScale: read(),
  zooming: false,
  trimTip: null,
  setTrackScale: (trackScale) => {
    try {
      localStorage.setItem(SCALE_KEY, trackScale)
    } catch {
      /* storage blocked: the choice lasts this session */
    }
    set({ trackScale })
  },
  stepTrackScale: (dir) => get().setTrackScale(nextTrackScale(get().trackScale, dir))
}))

/** A drawing's height on its clip (film strip, sound drawing), measured once
 *  per lane height and place (its parent's class) and remembered: every
 *  drawing used to ask the page for its height between writes to its bitmap,
 *  so drawing twenty clips again laid the page out twenty times. */
const drawnHeights = new Map<string, number>()
export function drawingHeight(canvas: HTMLCanvasElement, laneH: number): number {
  const key = `${laneH}|${canvas.className}|${canvas.parentElement?.className.split(' ')[0] ?? ''}`
  let h = drawnHeights.get(key)
  if (h === undefined || h <= 0) {
    h = canvas.clientHeight
    if (h > 0) drawnHeights.set(key, h)
  }
  return h
}

/** The height a lane is drawn at (0: no such lane). */
export function useLaneHeight(trackId: string): number {
  const scale = useTimelineView((v) => v.trackScale)
  return useStore((s) => {
    const track = s.project.tracks.find((t) => t.id === trackId)
    return track ? laneHeight(track.kind, track.height, scale) : 0
  })
}

// ---- zoom about a fixed point -----------------------------------------------------
/** The time that stays where it is on screen through a zoom: `viewX` px from
 *  the scroll area's left edge. */
export interface ZoomAnchor {
  time: number
  viewX: number
}

let pending: ZoomAnchor | null = null
let anim = 0
let settleTimer = 0
/** How long after a zoom's last step the film strips and sound drawings are
 *  drawn again at the new zoom. */
export const ZOOM_SETTLE_MS = 90

const scroller = (): HTMLDivElement | null => document.querySelector<HTMLDivElement>('.tl-scroll')

/** The anchor of a zoom made without a pointer (the slider, a button, a
 *  key): the playhead when it is in view, else the middle of the view. */
export function restAnchor(): ZoomAnchor | null {
  const el = scroller()
  if (!el) return null
  const s = useStore.getState()
  const headX = s.currentTime * s.pxPerSec + HEADER_W - el.scrollLeft
  if (headX >= HEADER_W && headX <= el.clientWidth) return { time: s.currentTime, viewX: headX }
  const viewX = HEADER_W + (el.clientWidth - HEADER_W) / 2
  return { time: Math.max(0, timeAtViewX(viewX, el.scrollLeft, s.pxPerSec, HEADER_W)), viewX }
}

/** The anchor the next zoom step keeps in place (taken once, by the timeline,
 *  after it has drawn the new zoom and before the screen shows it). */
export function takeZoomAnchor(): ZoomAnchor | null {
  const a = pending
  pending = null
  return a
}

/** One zoom step. What follows the view (film strips, sound drawings,
 *  subtitle chips) is told where the view will be in the same breath as the
 *  zoom, so it is drawn once for the step, not once for the zoom and again
 *  for the scroll that keeps the anchor in place. */
function apply(px: number, anchor: ZoomAnchor | null): void {
  pending = anchor
  if (!useTimelineView.getState().zooming) useTimelineView.setState({ zooming: true })
  window.clearTimeout(settleTimer)
  settleTimer = window.setTimeout(() => useTimelineView.setState({ zooming: false }), ZOOM_SETTLE_MS)
  const el = scroller()
  if (anchor && el) useViewport.getState().set(zoomScrollLeft(anchor.time, anchor.viewX, px, HEADER_W), el.clientWidth)
  useStore.getState().setPxPerSec(px)
}

const stopAnim = (): void => {
  if (anim) cancelAnimationFrame(anim)
  anim = 0
}

/** Sets the zoom at once, keeping `anchor` (default: restAnchor) in place. */
export function setZoom(px: number, anchor: ZoomAnchor | null = restAnchor()): void {
  stopAnim()
  const next = clampZoom(px)
  if (next === useStore.getState().pxPerSec) return
  apply(next, anchor)
}

/** Zooms to `px` over a short moment (120 ms; at once with motion off: ui/motion.ts),
 *  the anchor in place the whole way. */
export function zoomSmooth(px: number, anchor: ZoomAnchor | null = restAnchor(), ms = 120): void {
  stopAnim()
  const to = clampZoom(px)
  const from = useStore.getState().pxPerSec
  if (to === from) return
  if (motionOff() || ms <= 0) return setZoom(to, anchor)
  const t0 = performance.now()
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / ms)
    apply(zoomBetween(from, to, t), anchor)
    anim = t < 1 ? requestAnimationFrame(step) : 0
  }
  anim = requestAnimationFrame(step)
}

/** The whole film in the view, from its first frame. */
export function fitTimeline(): void {
  const el = scroller()
  const s = useStore.getState()
  zoomSmooth(fitZoom(projectDuration(s.project), el?.clientWidth ?? 1200, HEADER_W), { time: 0, viewX: HEADER_W })
}

/** A stretch of the film in the view (the selected clips). */
export function zoomToRange(from: number, to: number): void {
  const el = scroller()
  const width = Math.max(200, (el?.clientWidth ?? 1200) - HEADER_W - 24)
  zoomSmooth(clampZoom(width / Math.max(0.2, to - from)), { time: from, viewX: HEADER_W + 20 })
}
