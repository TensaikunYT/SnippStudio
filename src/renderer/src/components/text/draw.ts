// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's pictures (YAZI-PANELI-PLAN.md): what a title style, an
// animation or a ready-made text looks like, drawn by the subtitles' own
// renderer on a 1080p frame (the size, outline and shadow they have in the
// film), then the part that matters shown in the card.
import { drawCaptions } from '../../playback/draw/captions'
import type { Caption, CaptionStyle } from '../../types'

export const FRAME_W = 1920
export const FRAME_H = 1080

/** A part of the frame, in frame pixels. */
export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

/** The frame's middle, 420 × 236: the sample word fills a small card. */
export const MIDDLE: Crop = { x: 750, y: 422, w: 420, h: 236 }

/** No word-by-word pop: a sample has no spoken words. */
const NO_POPUP: CaptionStyle['popup'] = { enabled: false, duration: 0.16, intensity: 1, style: 'pop' }

/** A sample's style: `base` (the project's own) under `look`, in the frame's middle unless the look places it. */
export function sampleStyle(base: CaptionStyle, look?: Partial<CaptionStyle> | null, over?: Partial<CaptionStyle>): CaptionStyle {
  return { ...base, posX: 0.5, posY: 0.5, ...(look ?? {}), ...(over ?? {}), popup: NO_POPUP } as CaptionStyle
}

/** A sample title: `text` for `start`…`end`, in `style`, with `anim`. */
export function sampleCaption(id: string, text: string, style: CaptionStyle, start: number, end: number, anim?: Caption['anim'], layer = 1): Caption {
  return { id, start, end, text, manual: true, layer, style, anim } as Caption
}

/** The card's canvas at its shown size (16:9), in device pixels. */
export function fitCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  const W = Math.max(2, Math.round((cv.clientWidth || 140) * dpr))
  const H = Math.max(2, Math.round((W * 9) / 16))
  if (cv.width !== W || cv.height !== H) {
    cv.width = W
    cv.height = H
  }
  const g = cv.getContext('2d')!
  g.setTransform(1, 0, 0, 1, 0, 0)
  return g
}

let shared: OffscreenCanvasRenderingContext2D | null = null
/** THE 1080p frame every picture draws its sample on, then copies at once
 *  (drawing and copying are one synchronous step, so one frame serves them
 *  all). One per picture was 30 full-HD canvases held by a hidden page. */
export function newFrame(): OffscreenCanvasRenderingContext2D {
  shared ??= new OffscreenCanvas(FRAME_W, FRAME_H).getContext('2d', { willReadFrequently: false })!
  return shared
}

/** `caps` at `time`, alone on the cleared frame. */
export function paintFrame(fg: OffscreenCanvasRenderingContext2D, caps: Caption[], base: CaptionStyle, time: number): void {
  fg.setTransform(1, 0, 0, 1, 0, 0)
  fg.globalAlpha = 1
  fg.clearRect(0, 0, FRAME_W, FRAME_H)
  drawCaptions(fg, caps, base, time, FRAME_W, FRAME_H, 1)
}

/** The frame's `crop` into the whole card. */
export function show(g: CanvasRenderingContext2D, fg: OffscreenCanvasRenderingContext2D, crop: Crop, alpha = 1): void {
  g.globalAlpha = alpha
  g.drawImage(fg.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, g.canvas.width, g.canvas.height)
  g.globalAlpha = 1
}

/** The 16:9 part of the frame around what is drawn on it, with a margin (a
 *  lower third alone in a whole frame is a speck in a small card). */
export function cropAround(fg: OffscreenCanvasRenderingContext2D, margin = 60): Crop {
  // Read at a quarter size: a bounding box does not need every pixel.
  const q = new OffscreenCanvas(FRAME_W / 4, FRAME_H / 4).getContext('2d', { willReadFrequently: true })!
  q.clearRect(0, 0, FRAME_W / 4, FRAME_H / 4)
  q.drawImage(fg.canvas, 0, 0, FRAME_W / 4, FRAME_H / 4)
  const { data, width, height } = q.getImageData(0, 0, FRAME_W / 4, FRAME_H / 4)
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: FRAME_W, h: FRAME_H }
  const cx = ((x0 + x1 + 1) / 2) * 4
  const cy = ((y0 + y1 + 1) / 2) * 4
  let w = Math.max((x1 - x0 + 1) * 4 + margin * 2, ((y1 - y0 + 1) * 4 + margin * 2) * (16 / 9), 480)
  w = Math.min(FRAME_W, w)
  const h = (w * 9) / 16
  const x = Math.min(FRAME_W - w, Math.max(0, cx - w / 2))
  const y = Math.min(FRAME_H - h, Math.max(0, cy - h / 2))
  return { x, y, w, h }
}

/** Draws `paint(time)` in a loop of `loopMs` while `playing`; otherwise once
 *  (and again when the fonts arrive). Returns the effect's clean-up. It plays
 *  whatever the motion setting says (22 November, L2): a picture pointed at to
 *  see an animation is content, not decoration (ui/motion.ts). */
export function runPicture(playing: boolean, loopMs: number, rest: () => void, paint: (seconds: number) => void): () => void {
  if (!playing) {
    rest()
    let live = true
    void document.fonts?.ready.then(() => live && rest())
    return () => {
      live = false
    }
  }
  let raf = 0
  const t0 = performance.now()
  const tick = (now: number): void => {
    paint(((now - t0) % loopMs) / 1000)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
