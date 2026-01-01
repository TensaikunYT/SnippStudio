// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The playhead (the line and its head on the ruler: the only parts that follow
// the time every frame) and the ruler's ticks. Moved out of Timeline.tsx in
// SnippStudio phase 2B (no change; still isolated from the rest).
import { memo, useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { useViewport } from '../../playback/viewport'
import { HEADER_W, useSlideX } from './shared'
import { useT } from '../../ui'
import { fmtTime } from '../../ui/format'

/** The ruler's ticks and time labels: rebuilt only when the length, the zoom
 *  or the frame rate changes (they were rebuilt, up to 2000 of them, on every
 *  render of the timeline, pointer moves in the cutter included). */
export const RulerTicks = memo(function RulerTicks({ duration, pxPerSec, fps }: { duration: number; pxPerSec: number; fps: number }): JSX.Element {
  const ticks: JSX.Element[] = []
  const viewStep = Math.max(200, useViewport((v) => v.width) / 2)
  const viewPage = useViewport((v) => Math.floor(v.left / Math.max(200, v.width / 2)))
  const frameDur = 1 / fps
  // Frame-aware nice steps: down to single frames when zoomed way in, so fine
  // work can land on exact frames / sub-second marks.
  const niceSteps = [frameDur, frameDur * 2, frameDur * 5, frameDur * 10, 0.5, 1, 2, 5, 10, 30, 60, 300]
  let tickStep = niceSteps[niceSteps.length - 1]
  for (const s of niceSteps) {
    if (s * pxPerSec >= 8) {
      tickStep = s
      break
    }
  }
  // Never emit more than ~2000 tick DOM nodes across the whole timeline, even
  // at extreme zoom on a long clip — coarsen the step to a nice value instead.
  while (duration / tickStep > 2000) {
    const bigger = niceSteps.find((s) => s > tickStep)
    if (bigger) tickStep = bigger
    else {
      tickStep = duration / 2000
      break
    }
  }
  // Label roughly every ~70px, snapped to a multiple of the tick step: on a
  // round time (half a second, a second, …) where one is a whole number of
  // ticks, else every ~70px.
  const roundLabel = niceSteps.find((s) => s >= tickStep && s * pxPerSec >= 70 && Math.abs(s / tickStep - Math.round(s / tickStep)) < 1e-6)
  const labelEvery = Math.max(1, Math.round((roundLabel ?? 70 / pxPerSec) / tickStep))
  // The one time form (ui/format.ts, audit G6): second+ ticks m:ss, sub-second
  // ticks with the hundredths ("0:26.50"; the old m:ss:ff read 26 s as
  // "0:26:00", like minutes). Its decimal mark follows the language.
  useT()
  const showFrames = tickStep < 0.999
  const fmtTick = (t: number): string => fmtTime(t, showFrames ? 2 : 0)
  // Only the ticks near the view are in the page (phase 3c.T): half a screen
  // before it to a screen after, watched half a screen at a time. Which ticks
  // there are and where they stand is as before; a zoom step on a long film no
  // longer builds two thousand of them again. An element is a place in the
  // window, not a tick of the film (its key): a zoom step that changes the
  // step between ticks moves and relabels the same elements.
  const first = Math.max(0, Math.floor(((viewPage - 1) * viewStep - HEADER_W) / pxPerSec / tickStep))
  const last = Math.ceil(((viewPage + 4) * viewStep) / pxPerSec / tickStep)
  for (let tickIdx = first, t = first * tickStep; t <= duration + 1e-6 && tickIdx <= last; tickIdx++, t = tickIdx * tickStep) {
    const major = tickIdx % labelEvery === 0
    ticks.push(
      <div key={tickIdx - first} className={`tl-tick${major ? ' major' : ''}`} style={{ left: HEADER_W + t * pxPerSec }}>
        {major ? fmtTick(t) : ''}
      </div>
    )
  }
  return <>{ticks}</>
})

/**
 * The red playhead line. It's the ONLY thing that must move every frame during
 * playback, so it subscribes to currentTime on its own — keeping that
 * subscription out of <Timeline> stops the entire clip tree from re-rendering
 * 30-60× per second. It also owns the follow-playhead scrolling for the same
 * reason.
 */
export function Playhead({
  pxPerSec,
  playing,
  follow,
  scrollRef,
  scrubbingRef
}: {
  pxPerSec: number
  playing: boolean
  follow: boolean
  scrollRef: React.RefObject<HTMLDivElement>
  scrubbingRef: React.MutableRefObject<boolean>
}): JSX.Element {
  const currentTime = useStore((s) => s.currentTime)
  const lastFollowRef = useRef(0)
  useEffect(() => {
    if (!playing || !follow || scrubbingRef.current) return
    // Reading scrollLeft/clientWidth forces a layout flush. Doing that on every
    // animation frame is layout thrash that shows up as playback stutter, and
    // the view only needs to jump when the playhead leaves the window anyway —
    // so check a few times a second instead of 60.
    const now = performance.now()
    if (now - lastFollowRef.current < 120) return
    lastFollowRef.current = now
    const el = scrollRef.current
    if (!el) return
    const x = HEADER_W + currentTime * pxPerSec
    const left = el.scrollLeft
    const right = left + el.clientWidth
    if (x < left + HEADER_W || x > right - 40) {
      el.scrollLeft = Math.max(0, x - HEADER_W - el.clientWidth * 0.15)
    }
  }, [currentTime, playing, follow, pxPerSec, scrollRef, scrubbingRef])
  const ref = useSlideX<HTMLDivElement>(HEADER_W + currentTime * pxPerSec)
  return <div ref={ref} className="tl-playhead" style={SLID} />
}

/** The playhead's head. Lives inside the ruler so the ruler's sticky corner
 *  hides it exactly like the header column hides the line. */
export function PlayheadHead({ pxPerSec }: { pxPerSec: number }): JSX.Element {
  const currentTime = useStore((s) => s.currentTime)
  const ref = useSlideX<HTMLDivElement>(HEADER_W + currentTime * pxPerSec)
  return <div ref={ref} className="tl-playhead-head" style={SLID} />
}

/** A slid mark's box: from the left edge (useSlideX moves it). */
const SLID = { left: 0 } as const
