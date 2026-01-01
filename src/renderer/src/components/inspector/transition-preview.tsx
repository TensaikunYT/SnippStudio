// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A transition's small picture (DENEME-2, item 6; the user: "transition
// preview'ı gibi olsun … basitçe gözüksün ama premium olsun"). Drawn by the
// program's own renderer (playback/render.ts renderFrame, the one the preview
// and the export use) on a two-clip project made here: two quiet abstract
// frames, a cool one and a warm one, and the transition between them. So the
// tile shows the real thing, not an imitation of it. At rest it shows one
// moment inside the transition; pointed at (or focused) it plays it in a loop
// of one second; under reduced motion it stays still.
import { useEffect, useMemo, useRef } from 'react'
import { defaultProject, type Clip, type Project } from '../../types'
import { renderFrame, outgoingTransitionWindow } from '../../playback/render'
import { kindOf, type TransitionType } from '../../timeline/transition-types'

/** The two frames, the length of a clip and of the transition, in seconds. */
const CLIP = 2
const LOOP_MS = 1000
/** Of the loop: the outgoing frame held, then the transition, then the incoming one held. */
const HOLD_IN = 0.12
const HOLD_OUT = 0.16

/** The made-up project: A (0–2 s) → B (2–4 s) on one track, `type` between
 *  them, centred on the cut. Pure: the unit test reads it. */
export function previewProject(type: TransitionType): Project {
  const p = defaultProject('16:9', 'en')
  const { width, height } = p.settings
  const T = { x: width / 2, y: height / 2, scale: 1, rotation: 0 }
  const duration = Math.max(kindOf(type).minDuration ?? 0, 1)
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['A', 'B'] }]
  p.assets = [
    { id: 'tp-a', kind: 'image', name: 'a', url: '', size: 0, duration: 0, width, height, hasAudio: false },
    { id: 'tp-b', kind: 'image', name: 'b', url: '', size: 0, duration: 0, width, height, hasAudio: false }
  ]
  p.clips = {
    A: { id: 'A', assetId: 'tp-a', trackId: 'V1', start: 0, inPoint: 0, duration: CLIP, transform: { ...T }, volume: 1, transitionOut: { type, duration, to: 'B', align: 'center' } } as Clip,
    B: { id: 'B', assetId: 'tp-b', trackId: 'V1', start: CLIP, inPoint: 0, duration: CLIP, transform: { ...T }, volume: 1 } as Clip
  }
  p.captions = []
  return p
}

/** The project time of `progress` (0–1) through the transition of `p`. */
export function previewTime(p: Project, progress: number): number {
  const w = outgoingTransitionWindow(p, p.clips.A)
  // A velocity ramp cuts at the edit (no window of its own): its blur lives
  // in the few frames either side of the cut, shown over half a second.
  const ramp = w.pre + w.post === 0
  const from = CLIP - (ramp ? 0.25 : w.pre)
  const to = CLIP + (ramp ? 0.25 : w.post)
  return from + (to - from) * Math.min(1, Math.max(0, progress))
}

/** The moment shown at rest: the middle, but where the middle says nothing
 *  (a dip to black is black there) a moment that shows the kind. */
export function restProgress(type: TransitionType): number {
  return type === 'fade' ? 0.3 : type === 'flash' ? 0.42 : type === 'speed-ramp' ? 0.42 : 0.5
}

// ---- the two frames --------------------------------------------------------
/** The design values the frames are painted with (tokens.css: the content
 *  tones, never the accent). */
function tone(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'gray'
}

const FW = 320
const FH = 180
let frames: { a: HTMLCanvasElement; b: HTMLCanvasElement } | null = null

/** A cool frame (a night: a slate sky, a pale moon, a far ridge) and a warm
 *  one (a dusk: sand light, a low sun, a near hill). Soft gradients only: they
 *  are there to show movement and mixing, not to be looked at. */
function paint(cool: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = FW
  cv.height = FH
  const g = cv.getContext('2d')
  if (!g) return cv
  const fill = tone(cool ? '--clip-video-fill' : '--clip-image-fill')
  const line = tone(cool ? '--clip-video-line' : '--clip-image-line')
  const deep = tone('--bg-app')
  const light = tone(cool ? '--clip-video-text' : '--clip-image-text')
  const sky = g.createLinearGradient(0, 0, 0, FH)
  sky.addColorStop(0, cool ? deep : line)
  sky.addColorStop(0.75, cool ? line : fill)
  sky.addColorStop(1, fill)
  g.fillStyle = sky
  g.fillRect(0, 0, FW, FH)
  // The light: a soft disc with a glow round it.
  const lx = cool ? FW * 0.3 : FW * 0.68
  const ly = cool ? FH * 0.32 : FH * 0.5
  const r = cool ? 16 : 26
  const glow = g.createRadialGradient(lx, ly, r * 0.6, lx, ly, r * 4)
  glow.addColorStop(0, light)
  glow.addColorStop(1, 'transparent')
  g.globalAlpha = cool ? 0.22 : 0.35
  g.fillStyle = glow
  g.fillRect(0, 0, FW, FH)
  g.globalAlpha = cool ? 0.85 : 0.95
  g.fillStyle = light
  g.beginPath()
  g.arc(lx, ly, r, 0, Math.PI * 2)
  g.fill()
  // The ground: one long curve, darker than the sky.
  g.globalAlpha = 1
  g.fillStyle = deep
  g.beginPath()
  g.moveTo(0, FH)
  if (cool) {
    g.lineTo(0, FH * 0.74)
    g.bezierCurveTo(FW * 0.3, FH * 0.62, FW * 0.62, FH * 0.84, FW, FH * 0.7)
  } else {
    g.lineTo(0, FH * 0.8)
    g.bezierCurveTo(FW * 0.35, FH * 0.66, FW * 0.7, FH * 0.66, FW, FH * 0.78)
  }
  g.lineTo(FW, FH)
  g.closePath()
  g.globalAlpha = cool ? 0.9 : 0.55
  g.fill()
  g.globalAlpha = 1
  return cv
}

/** The two frames (the Filters page shows its looks on them too). */
export function theFrames(): { a: HTMLCanvasElement; b: HTMLCanvasElement } {
  frames ??= { a: paint(true), b: paint(false) }
  return frames
}

/** Draws `p` at time `time` on `cv` (its own size, the device's pixels),
 *  the two frames standing in for the clips' pictures. */
export function drawPreview(cv: HTMLCanvasElement, p: Project, time: number, ghosts: readonly number[] = [], light = false): void {
  const ctx = cv.getContext('2d')
  if (!ctx || cv.width < 2) return
  const { a, b } = theFrames()
  const pic = (clip: Clip): HTMLCanvasElement => (clip.assetId === 'tp-a' ? a : b)
  renderFrame(ctx, p, time, pic, { includeCaptions: false, scale: cv.width / p.settings.width })
  if (ghosts.length === 0) return
  // The moments before, faint over it (cila3, 3): a still that shows which
  // way the picture moves, like a photograph's double exposure. The nearer
  // a moment is to `time`, the stronger.
  const g = ghostCanvas(cv.width, cv.height)
  const gx = g.getContext('2d')
  if (!gx) return
  ghosts.forEach((at, i) => {
    gx.setTransform(1, 0, 0, 1, 0, 0)
    gx.clearRect(0, 0, g.width, g.height)
    renderFrame(gx, p, at, pic, { includeCaptions: false, scale: cv.width / p.settings.width })
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = GHOST_ALPHA[0] + ((GHOST_ALPHA[1] - GHOST_ALPHA[0]) * (i + 1)) / ghosts.length
    // `light` (cila4, 2): only what is lighter shows, so a moment with the
    // frame still dark or off the card (a ramp coming in) leaves no shadow
    // over the picture; the light's trail is what reads.
    if (light) ctx.globalCompositeOperation = 'lighten'
    ctx.drawImage(g, 0, 0)
    ctx.restore()
  })
}

/** How strong the faintest and the nearest moment before are drawn. */
const GHOST_ALPHA: readonly [number, number] = [0.2, 0.38]
let ghostCv: HTMLCanvasElement | null = null
function ghostCanvas(w: number, h: number): HTMLCanvasElement {
  ghostCv ??= document.createElement('canvas')
  if (ghostCv.width !== w) ghostCv.width = w
  if (ghostCv.height !== h) ghostCv.height = h
  return ghostCv
}

/** Draws `type` at `progress` on `cv`. */
export function drawTransitionPreview(cv: HTMLCanvasElement, type: TransitionType, progress: number, p = previewProject(type)): void {
  drawPreview(cv, p, previewTime(p, progress))
}


/**
 * A small picture of `project` (made here with the two frames): at rest the
 * moment `rest`, playing a loop of `loopMs` where `at(phase)` is the time
 * of each phase 0–1. Sized to the box it is given, at the device's pixels;
 * drawn again when that box changes. It plays whatever the motion setting
 * says (22 November, L2): a picture the user points at to see a transition
 * or an animation is content, not decoration (ui/motion.ts).
 */
export function PreviewCanvas({ project, still, rest, at, loopMs, playing, ghosts, light }: { project: Project; still?: Project; rest: number; at: (phase: number) => number; loopMs: number; playing: boolean; ghosts?: readonly number[]; light?: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const size = (): boolean => {
      const r = cv.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(2, Math.round(r.width * dpr))
      const h = Math.max(2, Math.round(r.height * dpr))
      if (cv.width === w && cv.height === h) return false
      cv.width = w
      cv.height = h
      return true
    }
    size()
    if (!playing) {
      // (At rest: `still`, the move drawn so a still shows it, when given.)
      const pic = still ?? project
      drawPreview(cv, pic, rest, ghosts, light)
      const ro = new ResizeObserver(() => size() && drawPreview(cv, pic, rest, ghosts, light))
      ro.observe(cv)
      return () => ro.disconnect()
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number): void => {
      drawPreview(cv, project, at(((now - t0) % loopMs) / loopMs))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // (`at` follows `project`: a new project is a new picture.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, still, rest, loopMs, playing, ghosts?.join(','), light])
  return <canvas ref={ref} className="tp-canvas" aria-hidden="true" />
}

/** A transition kind's picture. `playing`: the tile is pointed at or focused. */
export function TransitionPreview({ type, playing }: { type: TransitionType; playing: boolean }): JSX.Element {
  const p = useMemo(() => previewProject(type), [type])
  return <PreviewCanvas project={p} rest={previewTime(p, restProgress(type))} at={(phase) => previewTime(p, (phase - HOLD_IN) / (1 - HOLD_IN - HOLD_OUT))} loopMs={LOOP_MS} playing={playing} />
}

// ---- the Effects page's moves ----------------------------------------------
/** One clip (the warm frame), `CLIP * 2` seconds long, with `dress` done to it. */
export function moveProject(dress: (clip: Clip, p: Project) => void): Project {
  const p = defaultProject('16:9', 'en')
  const { width, height } = p.settings
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['A'] }]
  p.assets = [{ id: 'tp-b', kind: 'image', name: 'b', url: '', size: 0, duration: 0, width, height, hasAudio: false }]
  const clip = { id: 'A', assetId: 'tp-b', trackId: 'V1', start: 0, inPoint: 0, duration: CLIP * 2, transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0 }, volume: 1 } as Clip
  p.clips = { A: clip }
  p.captions = []
  dress(clip, p)
  return p
}

/** A clip's length in the made-up projects (the moves' clip is twice it). */
export const CLIP_PREVIEW_S = CLIP

/** The whole clip in one loop (a move across its length). */
export const MOVE_LOOP_MS = 1800
