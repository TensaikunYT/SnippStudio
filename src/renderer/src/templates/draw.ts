// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Draws the G lane's template graphics. Called from renderFrame, so the
// preview, the thumbnails in the panel and the export are the same pixels.
//
// Everything is a function of (block, time): no state carries from one frame
// to the next, so scrubbing, looping and a parallel export all agree.

import type { Asset, Clip, Project, TemplateBlock, TemplateItem } from '../types'
import { templateEnd } from '../types'
import { chapterDesign, countLayout, CUT_DROP, cutGone, focusLayout, galleryLayout, galleryTimes, SCENE_KINDS, templatePlace, templateSlots } from './model'
import { drawHome } from './home'
import { drawMap } from './map'
import { drawTerminal } from './terminal'
import { drawQuote } from './quote'
import { drawBars, drawLine, drawPie } from './charts'
import { drawCutout } from './cutout'
import { drawChecklist, drawCompare, drawPoll, drawPost } from './extras'
import { drawCards } from './cards'
import { drawChess } from './chess'
import { drawNews } from './news'
import { drawChapter } from './chapter'
import { drawScope } from './scope'
import { drawRevolver } from './revolver'
import { drawList } from './list'
import { drawWords } from './words'
import { drawPlayer } from './player'
import { drawStore } from './store'
import { drawBoxes } from './boxes'
import { drawDomino } from './domino'

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Resolver = (clip: Clip, asset: Asset, localTime: number) => CanvasImageSource | null

export interface TemplateView {
  left: number
  width: number
  height: number
}

// -- small maths ---------------------------------------------------------------

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const prog = (t: number, at: number, dur: number): number => clamp01((t - at) / Math.max(1e-6, dur))
export const outCubic = (u: number): number => 1 - (1 - u) ** 3
export const inOutCubic = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)
export const outBack = (u: number, k = 1.7): number => 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2
export const outExpo = (u: number): number => (u >= 1 ? 1 : 1 - 2 ** (-10 * u))
/** A spring settling from 0 to 1 (underdamped), for pops. */
const springy = (u: number): number => (u <= 0 ? 0 : 1 - Math.exp(-7 * u) * Math.cos(11 * u))

/** Deterministic noise in [0, 1). */
export function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export interface Ctx {
  g: Ctx2D
  b: TemplateBlock
  t: number
  /** Frame box and the unit (1080p pixels scaled to it). */
  x0: number
  W: number
  H: number
  u: number
  portrait: boolean
  /** Whole-graphic entrance/exit, 0..1. */
  a: number
  project: Project
  resolve: Resolver
  /** Text colour over the backdrop (cards use style.ink). */
  onBg: string
  /** Device pixels per project pixel (the canvas's own scale). */
  px: number
  /** The frame as drawn before this block — the live picture a scene
   *  template turns into a card (null outside scene templates). */
  live: CanvasImageSource | null
}

let liveScratch: HTMLCanvasElement | OffscreenCanvas | null = null
/** A copy of what is on the canvas right now (the playing picture). */
function grabLive(g: Ctx2D): CanvasImageSource | null {
  const cv = g.canvas as HTMLCanvasElement | OffscreenCanvas
  const w = cv.width
  const h = cv.height
  if (!w || !h) return null
  if (!liveScratch) liveScratch = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h)
  if (liveScratch.width !== w || liveScratch.height !== h) {
    liveScratch.width = w
    liveScratch.height = h
  }
  const sg = liveScratch.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!sg) return null
  sg.setTransform(1, 0, 0, 1, 0, 0)
  sg.clearRect(0, 0, w, h)
  sg.drawImage(cv, 0, 0)
  return liveScratch
}

/** The hand-made tilt of element `i` (radians). */
function tilt(c: Ctx, i: number, deg = 3): number {
  if (!c.b.style.hand) return 0
  return ((hash(c.b.seed, i, 11) - 0.5) * 2 * deg * Math.PI) / 180
}

/** 12 fps "boil": the tiny redraw-to-redraw wobble of drawn animation. */
function boil(c: Ctx, i: number, amp = 1): { dx: number; dy: number; r: number } {
  if (!c.b.style.hand) return { dx: 0, dy: 0, r: 0 }
  const f = Math.floor(c.t * 12)
  return {
    dx: (hash(c.b.seed + f, i, 1) - 0.5) * 2.2 * c.u * amp,
    dy: (hash(c.b.seed + f, i, 2) - 0.5) * 2.2 * c.u * amp,
    r: (hash(c.b.seed + f, i, 3) - 0.5) * 0.006 * amp
  }
}

// -- text ------------------------------------------------------------------------

export const fontOf = (size: number, family: string, weight = 700): string =>
  `${weight} ${Math.max(1, size).toFixed(1)}px "${family}", "Inter", "Segoe UI", sans-serif`

/** Largest size (≤ `size`) at which `text` fits in `maxW`. */
function fitSize(g: Ctx2D, text: string, family: string, weight: number, size: number, maxW: number): number {
  g.font = fontOf(size, family, weight)
  const w = g.measureText(text).width
  if (w <= maxW || w <= 0) return size
  return Math.max(size * 0.45, (size * maxW) / w)
}

export function text(
  c: Ctx,
  str: string,
  x: number,
  y: number,
  o: { size: number; family?: string; weight?: number; color: string; align?: CanvasTextAlign; maxW?: number; alpha?: number; baseline?: CanvasTextBaseline }
): number {
  if (!str) return 0
  const g = c.g
  const family = o.family ?? 'Inter'
  const weight = o.weight ?? 700
  const size = o.maxW ? fitSize(g, str, family, weight, o.size, o.maxW) : o.size
  g.font = fontOf(size, family, weight)
  g.textAlign = o.align ?? 'left'
  g.textBaseline = o.baseline ?? 'alphabetic'
  g.fillStyle = o.color
  const prev = g.globalAlpha
  g.globalAlpha = prev * (o.alpha ?? 1)
  g.fillText(str, x, y)
  g.globalAlpha = prev
  return size
}

// -- pictures --------------------------------------------------------------------

export function imageOf(c: Ctx, item: TemplateItem | undefined): CanvasImageSource | null {
  if (!item?.assetId) return null
  const asset = c.project.assets.find((x) => x.id === item.assetId)
  if (!asset || asset.missing || asset.kind !== 'image') return null
  return c.resolve({ id: `tpl:${c.b.id}:${item.id}`, assetId: asset.id } as Clip, asset, 0)
}

export function sizeOf(img: CanvasImageSource): [number, number] {
  if (img instanceof HTMLImageElement) return [img.naturalWidth, img.naturalHeight]
  const s = img as { width: number; height: number }
  return [Number(s.width) || 1, Number(s.height) || 1]
}

/** Cover-fits `img` into the rect (centred crop). */
export function drawCover(g: Ctx2D, img: CanvasImageSource, x: number, y: number, w: number, h: number, zoom = 1): void {
  const [iw, ih] = sizeOf(img)
  if (iw <= 0 || ih <= 0) return
  const k = Math.max(w / iw, h / ih) * zoom
  const sw = w / k
  const sh = h / k
  g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h)
}

export function roundRect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  g.beginPath()
  g.moveTo(x + rr, y)
  g.arcTo(x + w, y, x + w, y + h, rr)
  g.arcTo(x + w, y + h, x, y + h, rr)
  g.arcTo(x, y + h, x, y, rr)
  g.arcTo(x, y, x + w, y, rr)
  g.closePath()
}

/** A card with a soft shadow. */
export function card(c: Ctx, x: number, y: number, w: number, h: number, fill: string, r = 14): void {
  const g = c.g
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.32)'
  g.shadowBlur = 22 * c.u
  g.shadowOffsetY = 8 * c.u
  g.fillStyle = fill
  roundRect(g, x, y, w, h, r * c.u)
  g.fill()
  g.restore()
}

/**
 * A printed photo: white border (a deeper one at the bottom when hand-made),
 * a shadow, and two strips of tape. Centred on (cx, cy).
 */
function photo(
  c: Ctx,
  img: CanvasImageSource | null,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rot: number,
  i: number,
  alpha = 1,
  caption?: string
): void {
  if (!img || alpha <= 0.001) return
  const g = c.g
  const pad = w * 0.04
  const foot = c.b.style.hand || caption ? w * 0.14 : pad
  g.save()
  g.globalAlpha *= alpha
  g.translate(cx, cy)
  g.rotate(rot)
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.38)'
  g.shadowBlur = 26 * c.u
  g.shadowOffsetY = 10 * c.u
  g.fillStyle = '#fdfbf6'
  g.fillRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad + foot)
  g.restore()
  drawCover(g, img, -w / 2, -h / 2, w, h)
  if (caption) {
    // Written on the white strip under the picture, in pen when hand-made.
    text(c, caption, 0, h / 2 + foot * 0.66, {
      size: foot * 0.6,
      family: c.b.style.hand ? 'Permanent Marker' : 'Inter',
      weight: c.b.style.hand ? 400 : 700,
      color: '#262626',
      align: 'center',
      maxW: w * 0.94
    })
  }
  if (c.b.style.hand) {
    // Tape: two translucent strips across the top corners.
    for (const side of [-1, 1]) {
      g.save()
      g.translate(side * (w / 2 - w * 0.06), -h / 2 - pad * 0.3)
      g.rotate(side * (0.55 + (hash(c.b.seed, i, side + 5) - 0.5) * 0.3))
      g.fillStyle = 'rgba(236, 226, 196, 0.78)'
      g.fillRect(-w * 0.09, -h * 0.035, w * 0.18, h * 0.07)
      g.restore()
    }
  }
  g.restore()
}

// -- hand-drawn strokes ------------------------------------------------------

/** A marker line from (x0,y0) to (x1,y1), drawn `p` of the way. */
function marker(c: Ctx, x0: number, y0: number, x1: number, y1: number, width: number, color: string, p: number, i: number): void {
  if (p <= 0) return
  const g = c.g
  const n = 24
  const len = Math.hypot(x1 - x0, y1 - y0)
  const nx = -(y1 - y0) / (len || 1)
  const ny = (x1 - x0) / (len || 1)
  const wob = c.b.style.hand ? width * 0.35 : 0
  g.save()
  g.strokeStyle = color
  g.lineWidth = width
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.globalAlpha *= 0.92
  g.beginPath()
  const last = Math.max(1, Math.round(n * clamp01(p)))
  for (let k = 0; k <= last; k++) {
    const s = k / n
    const off = wob * (Math.sin(s * 5.3 + hash(c.b.seed, i, 21) * 6) + (hash(c.b.seed, i, k) - 0.5) * 0.6)
    const x = x0 + (x1 - x0) * s + nx * off
    const y = y0 + (y1 - y0) * s + ny * off
    if (k === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
  g.restore()
}

/** A loose circle around (cx, cy), drawn `p` of the way (a bit over one turn). */
function scribbleCircle(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, p: number, i: number): void {
  if (p <= 0) return
  const g = c.g
  const turns = 1.12
  const n = 48
  g.save()
  g.strokeStyle = color
  g.lineWidth = 7 * c.u
  g.lineCap = 'round'
  g.beginPath()
  const last = Math.max(1, Math.round(n * clamp01(p)))
  const a0 = hash(c.b.seed, i, 31) * Math.PI * 2
  for (let k = 0; k <= last; k++) {
    const s = k / n
    const ang = a0 + s * turns * Math.PI * 2
    const wob = 1 + (c.b.style.hand ? (hash(c.b.seed, i, k + 40) - 0.5) * 0.06 + s * 0.05 : 0)
    const x = cx + Math.cos(ang) * rx * wob
    const y = cy + Math.sin(ang) * ry * wob
    if (k === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
  g.restore()
}

/** A drawn tick. */
function tick(c: Ctx, cx: number, cy: number, size: number, color: string, p: number): void {
  if (p <= 0) return
  const g = c.g
  const pts: [number, number][] = [
    [cx - size * 0.45, cy],
    [cx - size * 0.1, cy + size * 0.35],
    [cx + size * 0.5, cy - size * 0.4]
  ]
  g.save()
  g.strokeStyle = color
  g.lineWidth = size * 0.18
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(pts[0][0], pts[0][1])
  const q = clamp01(p) * 2
  const a = Math.min(1, q)
  g.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * a, pts[0][1] + (pts[1][1] - pts[0][1]) * a)
  if (q > 1) g.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * (q - 1), pts[1][1] + (pts[2][1] - pts[1][1]) * (q - 1))
  g.stroke()
  g.restore()
}

/** Round badge with a number in it. */
function badge(c: Ctx, cx: number, cy: number, r: number, label: string, fill: string, ink: string, scale = 1): void {
  if (scale <= 0.01) return
  const g = c.g
  g.save()
  g.translate(cx, cy)
  g.scale(scale, scale)
  g.fillStyle = fill
  g.beginPath()
  g.arc(0, 0, r, 0, Math.PI * 2)
  g.fill()
  g.lineWidth = 3 * c.u
  g.strokeStyle = 'rgba(0,0,0,0.25)'
  g.stroke()
  text(c, label, 0, r * 0.36, { size: r * 1.05, family: c.b.style.font, color: ink, align: 'center', maxW: r * 1.6 })
  g.restore()
}

// -- backdrop ------------------------------------------------------------------------

let paperTile: HTMLCanvasElement | null = null
/** A small seamless fibre-noise tile for the paper backdrop. */
function paperPattern(): HTMLCanvasElement {
  if (paperTile) return paperTile
  const cv = document.createElement('canvas')
  cv.width = 256
  cv.height = 256
  const g = cv.getContext('2d')!
  const img = g.createImageData(256, 256)
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const n = hash(x, y, 7) * 0.6 + hash(x >> 2, y >> 2, 9) * 0.4
      const v = Math.round(18 * n)
      const o = (y * 256 + x) * 4
      img.data[o] = 60
      img.data[o + 1] = 45
      img.data[o + 2] = 20
      img.data[o + 3] = v
    }
  }
  g.putImageData(img, 0, 0)
  paperTile = cv
  return cv
}

let blurScratch: HTMLCanvasElement | null = null

function backdrop(c: Ctx, scale: number): void {
  const g = c.g
  const { x0, W, H } = c
  const mode = c.b.style.backdrop
  // 'card': the graphic brings its own card; the video stays as it is.
  if (mode === 'none' || mode === 'card' || c.a <= 0) return
  if (mode === 'dim') {
    g.fillStyle = `rgba(8,8,12,${(0.58 * c.a).toFixed(3)})`
    g.fillRect(x0, 0, W, H)
    return
  }
  if (mode === 'blur') {
    // Frosted glass: the frame so far, blurred, laid back over itself.
    const cv = g.canvas as HTMLCanvasElement | OffscreenCanvas
    const cw = cv.width
    const chh = cv.height
    if (!blurScratch) blurScratch = document.createElement('canvas')
    if (blurScratch.width !== cw || blurScratch.height !== chh) {
      blurScratch.width = cw
      blurScratch.height = chh
    }
    const sg = blurScratch.getContext('2d')!
    sg.setTransform(1, 0, 0, 1, 0, 0)
    sg.clearRect(0, 0, cw, chh)
    sg.drawImage(cv, 0, 0)
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = c.a
    g.filter = `blur(${Math.max(1, 18 * c.u * scale).toFixed(1)}px)`
    g.drawImage(blurScratch, 0, 0)
    g.filter = 'none'
    g.fillStyle = 'rgba(10,10,14,0.35)'
    g.fillRect(0, 0, cw, chh)
    g.restore()
    return
  }
  // Paper.
  g.save()
  g.globalAlpha = c.a
  g.fillStyle = '#f3ecdc'
  g.fillRect(x0, 0, W, H)
  const pat = g.createPattern(paperPattern(), 'repeat')
  if (pat) {
    g.fillStyle = pat
    g.fillRect(x0, 0, W, H)
  }
  const vg = g.createRadialGradient(x0 + W / 2, H / 2, H * 0.3, x0 + W / 2, H / 2, Math.hypot(W, H) * 0.62)
  vg.addColorStop(0, 'rgba(90,60,20,0)')
  vg.addColorStop(1, 'rgba(90,60,20,0.22)')
  g.fillStyle = vg
  g.fillRect(x0, 0, W, H)
  g.restore()
}

/** Headline at the top left with a marker stroke under it. */
export function headline(c: Ctx, at = 0.25): void {
  if (!c.b.title) return
  const p = outCubic(prog(c.t, at, 0.45))
  if (p <= 0) return
  const bo = boil(c, 900, 0.6)
  const x = c.x0 + (c.portrait ? 0.07 : 0.06) * c.W + bo.dx
  const y = (c.portrait ? 0.1 : 0.15) * c.H + bo.dy + (1 - p) * 18 * c.u
  const size = text(c, c.b.title, x, y, {
    size: (c.portrait ? 60 : 70) * c.u,
    family: c.b.style.font,
    color: c.onBg,
    maxW: c.W * (c.portrait ? 0.86 : 0.6),
    alpha: p
  })
  c.g.font = fontOf(size, c.b.style.font)
  const w = c.g.measureText(c.b.title).width
  marker(c, x, y + 16 * c.u, x + w, y + 12 * c.u, 11 * c.u, c.b.style.accent, prog(c.t, at + 0.25, 0.45), 901)
}


// -- the five templates ----------------------------------------------------------

function drawSteps(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const items = b.items
  const n = items.length
  const s = templateSlots(b)
  headline(c)
  const hasPics = items.some((it) => imageOf(c, it))
  const listX = x0 + (c.portrait ? 0.07 : 0.06) * W
  const listW = W * (c.portrait ? 0.86 : hasPics ? 0.5 : 0.62)
  const top = (c.portrait ? (hasPics ? 0.52 : 0.2) : 0.25) * H
  const avail = H * (c.portrait ? (hasPics ? 0.42 : 0.7) : 0.68)
  const rowH = Math.min(150 * u, avail / n)
  let active = -1
  for (let i = 0; i < n; i++) if (c.t >= s.at(i)) active = i
  for (let i = 0; i < n; i++) {
    const t0 = s.at(i)
    const p = prog(c.t, t0, 0.45)
    if (p <= 0) continue
    const e = outBack(p)
    const item = items[i]
    const bo = boil(c, i)
    const done = i < active
    const on = i === active
    const y = top + i * rowH + bo.dy
    const h = rowH * 0.8
    const x = listX + (1 - e) * -60 * u + bo.dx
    g.save()
    // Finished rows stay solid (a see-through card over busy footage reads as
    // dirt) and quieten their words instead.
    g.globalAlpha *= clamp01(p * 1.6)
    g.translate(x, y + h / 2)
    g.rotate(tilt(c, i, 1.2) + bo.r)
    const zoom = on ? 1 + 0.03 * outCubic(prog(c.t, t0, 0.3)) : 1
    g.scale(zoom, zoom)
    card(c, 0, -h / 2, listW, h, b.style.card)
    if (on) {
      g.fillStyle = b.style.accent
      roundRect(g, 0, -h / 2, 9 * u, h, 4 * u)
      g.fill()
    }
    const r = h * 0.3
    // Finished steps swap their number for a drawn tick.
    const tp = done ? prog(c.t, s.at(i + 1), 0.3) : 0
    badge(c, 18 * u + r, 0, r, tp > 0 ? '' : String(i + 1), done ? '#dfe9d8' : b.style.accent, b.style.ink, springy(prog(c.t, t0 + 0.05, 0.6)))
    if (done) tick(c, 18 * u + r, 0, r * 1.1, '#1f8f4a', tp)
    const tx = 36 * u + r * 2
    const hasNote = !!item.note
    const quiet = done ? 0.5 : 1
    text(c, item.title, tx, hasNote ? -h * 0.02 : h * 0.12, { size: h * 0.34, color: b.style.ink, alpha: quiet, maxW: listW - tx - 20 * u })
    if (hasNote) text(c, item.note!, tx, h * 0.32, { size: h * 0.22, weight: 500, color: b.style.ink, alpha: 0.66 * quiet, maxW: listW - tx - 20 * u })
    g.restore()
  }
  // The active step's picture: the new one drops in as the old one leaves.
  if (hasPics && active >= 0) {
    const cx = x0 + (c.portrait ? 0.5 : 0.78) * W
    const cy = (c.portrait ? 0.3 : 0.55) * H
    const pw = c.portrait ? W * 0.62 : W * 0.3
    const ph = pw * 0.78
    const local = c.t - s.at(active)
    const inP = prog(local, 0, 0.5)
    if (active > 0 && local < 0.35) {
      const outP = outCubic(prog(local, 0, 0.35))
      const prevImg = imageOf(c, items[active - 1])
      photo(c, prevImg, cx + outP * W * 0.25, cy + outP * H * 0.1, pw, ph, tilt(c, active + 50, 5) + outP * 0.4, active + 49, 1 - outP)
    }
    const img = imageOf(c, items[active])
    const bo = boil(c, 700 + active, 0.7)
    const k = 1.18 - 0.18 * springy(inP)
    photo(c, img, cx + bo.dx, cy + bo.dy - (1 - outCubic(inP)) * 40 * u, pw * k, ph * k, tilt(c, active + 50, 5) + (1 - inP) * -0.25 + bo.r, active + 50, clamp01(inP * 2))
  }
}

function drawRanking(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const items = b.items
  const n = items.length
  const s = templateSlots(b)
  headline(c)
  const maxV = Math.max(1, ...items.map((it) => it.value ?? 0))
  // Countdown: rank n first, rank 1 last. k = order of appearance.
  const orderOf = (rank: number): number => n - rank
  let current = -1
  for (let k = 0; k < n; k++) if (c.t >= s.at(k)) current = k
  // Leaderboard: every rank whose spotlight is over, in rank order.
  if (!c.portrait) {
    const lx = x0 + 0.05 * W
    const lw = W * 0.3
    const top = 0.24 * H
    const rowH = Math.min(78 * u, (0.68 * H) / n)
    for (let rank = 1; rank <= n; rank++) {
      const k = orderOf(rank)
      const landed = c.t - (s.at(k) + s.len)
      const finale = rank === 1 && c.t >= s.at(k) + Math.min(s.len, 1.4)
      if (landed < 0 && !finale) continue
      const p = outBack(prog(finale ? c.t - (s.at(k) + Math.min(s.len, 1.4)) : landed, 0, 0.45))
      const bo = boil(c, 300 + rank, 0.6)
      const y = top + (rank - 1) * rowH + bo.dy
      g.save()
      g.globalAlpha *= clamp01(p * 1.5)
      g.translate(lx + (1 - p) * 80 * u + bo.dx, y)
      card(c, 0, 0, lw, rowH * 0.84, rank === 1 ? b.style.accent : b.style.card, 10)
      text(c, `#${rank}`, 16 * u, rowH * 0.58, { size: rowH * 0.42, family: b.style.font, color: b.style.ink })
      text(c, items[rank - 1].title, 16 * u + rowH * 1.1, rowH * 0.56, { size: rowH * 0.32, color: b.style.ink, maxW: lw - rowH * 1.3 - 20 * u })
      g.restore()
    }
  }
  if (current < 0) return
  // Spotlight on the rank being revealed (number one stays for the finale).
  const rank = n - current
  const item = items[rank - 1]
  const t0 = s.at(current)
  const hold = rank === 1 ? b.duration : Math.min(s.len, 99)
  const local = c.t - t0
  const inP = prog(local, 0, 0.5)
  const outP = rank === 1 ? 0 : prog(local, hold - 0.3, 0.3)
  const vis = clamp01(inP * 2) * (1 - outP)
  if (vis <= 0) return
  const cx = x0 + (c.portrait ? 0.5 : 0.66) * W
  const cy = (c.portrait ? 0.46 : 0.52) * H
  const bo = boil(c, 400 + rank)
  g.save()
  g.globalAlpha *= vis
  // Giant rank numeral behind.
  const numP = springy(prog(local, 0.05, 0.8))
  // Right-aligned against the photo's left edge, so the photo covers only
  // its tail and the number itself always reads.
  g.save()
  const numX = c.portrait ? cx : cx + W * 0.08 - W * 0.125 + 40 * u
  g.translate(numX + bo.dx, cy + bo.dy)
  g.rotate(-0.1 + tilt(c, rank, 2))
  g.scale(numP, numP)
  g.globalAlpha *= 0.92
  text(c, `#${rank}`, 0, 130 * u, {
    size: (c.portrait ? 300 : 330) * u,
    family: b.style.font,
    color: b.style.accent,
    align: c.portrait ? 'center' : 'right'
  })
  g.restore()
  const img = imageOf(c, item)
  const pw = c.portrait ? W * 0.6 : W * 0.25
  const ph = pw * 0.8
  const slideX = (1 - outCubic(inP)) * 120 * u - outP * 200 * u
  if (img) photo(c, img, cx + W * (c.portrait ? 0 : 0.08) + slideX + bo.dx, cy - ph * 0.12 + bo.dy, pw, ph, tilt(c, rank + 20, 5) + bo.r, rank + 20)
  const ty = img ? cy + ph * 0.62 : cy
  const nameSize = text(c, item.title, cx + (c.portrait ? 0 : W * 0.08) + slideX, ty + 36 * u, {
    size: 64 * u,
    family: b.style.font,
    color: c.onBg,
    align: 'center',
    maxW: c.portrait ? W * 0.86 : W * 0.5
  })
  if (item.note) text(c, item.note, cx + (c.portrait ? 0 : W * 0.08) + slideX, ty + 36 * u + nameSize * 0.95, { size: 32 * u, weight: 500, color: c.onBg, align: 'center', alpha: 0.8, maxW: W * 0.5 })
  // Score bar.
  if (item.value !== undefined) {
    const bw = c.portrait ? W * 0.7 : W * 0.34
    const bx = cx + (c.portrait ? 0 : W * 0.08) - bw / 2 + slideX
    const by = ty + 36 * u + nameSize * 0.95 + (item.note ? 44 : 24) * u
    const fill = outCubic(prog(local, 0.35, 0.8))
    g.fillStyle = 'rgba(255,255,255,0.22)'
    roundRect(g, bx, by, bw, 16 * u, 8 * u)
    g.fill()
    g.fillStyle = b.style.accent
    roundRect(g, bx, by, Math.max(16 * u, bw * (item.value / maxV) * fill), 16 * u, 8 * u)
    g.fill()
    text(c, String(Math.round(item.value * fill)), bx + bw + 14 * u, by + 15 * u, { size: 28 * u, color: c.onBg })
  }
  // Number one: a burst of drawn stars.
  if (rank === 1) {
    const bp = prog(local, 0.3, 0.9)
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2 + hash(b.seed, k, 61)
      const d = (180 + 120 * hash(b.seed, k, 62)) * u * outCubic(bp)
      const sx = cx + (c.portrait ? 0 : W * 0.08) + Math.cos(ang) * d * 1.4
      const sy = cy + Math.sin(ang) * d
      g.save()
      g.globalAlpha *= clamp01(1.4 - bp)
      text(c, '✦', sx, sy, { size: (26 + 20 * hash(b.seed, k, 63)) * u, color: b.style.accent, align: 'center' })
      g.restore()
    }
  }
  g.restore()
}

function drawVersus(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const [A, B] = b.items
  const stats = b.items.slice(2)
  headline(c)
  const sides: [TemplateItem, number][] = [
    [A, -1],
    [B, 1]
  ]
  const portrait = c.portrait
  const pw = portrait ? W * 0.46 : W * 0.21
  const ph = pw * 0.78
  const centers = sides.map(([, side]) =>
    portrait ? [x0 + W * 0.5, H * (side < 0 ? 0.235 : 0.575)] : [x0 + W * (0.5 + side * 0.22), H * 0.4]
  )
  // Who wins: more stat rows won; ties go to nobody.
  let score = 0
  for (const st of stats) score += Math.sign((st.value ?? 0) - (st.value2 ?? 0))
  const sStats = templateSlots(b)
  const verdictAt = stats.length ? sStats.at(stats.length) : b.duration - 1.2
  sides.forEach(([item, side], i) => {
    const p = outBack(prog(c.t, 0.3 + i * 0.15, 0.6))
    if (p <= 0) return
    const [cx, cy] = centers[i]
    const bo = boil(c, 200 + i)
    const slide = (1 - p) * side * (portrait ? 0 : W * 0.3)
    const img = imageOf(c, item)
    if (img) {
      photo(c, img, cx + slide + bo.dx, cy + bo.dy, pw, ph, side * 0.06 + tilt(c, i + 70, 2) + bo.r, i + 70, clamp01(p * 2))
    } else {
      g.save()
      g.globalAlpha *= clamp01(p * 2)
      card(c, cx + slide - pw / 2, cy - ph / 2, pw, ph, b.style.card, 18)
      g.restore()
    }
    const ny = img ? cy + ph * 0.5 + pw * 0.14 + 62 * u : cy + 20 * u
    g.save()
    g.globalAlpha *= clamp01(p * 2)
    text(c, item?.title ?? '', cx + slide + bo.dx, ny + bo.dy, {
      size: 64 * u,
      family: b.style.font,
      color: img ? c.onBg : b.style.ink,
      align: 'center',
      maxW: pw * 1.1
    })
    g.restore()
    // The verdict: a scribbled ring round the winner.
    const wins = (side < 0 && score > 0) || (side > 0 && score < 0)
    if (wins) scribbleCircle(c, cx, cy, pw * 0.66, ph * 0.72, b.style.accent, prog(c.t, verdictAt, 0.7), 80 + i)
  })
  // VS badge.
  const vp = springy(prog(c.t, 0.85, 0.9))
  if (vp > 0) {
    // Upright frames stack the two sides, so the badge moves off the names.
    const vx = x0 + W * (portrait ? 0.82 : 0.5)
    const vy = portrait ? H * 0.41 : H * 0.4
    const bo = boil(c, 250, 1.3)
    g.save()
    g.translate(vx + bo.dx, vy + bo.dy)
    g.rotate(-0.12 + bo.r * 3)
    g.scale(vp * (portrait ? 0.72 : 1), vp * (portrait ? 0.72 : 1))
    g.fillStyle = b.style.accent
    g.beginPath()
    for (let k = 0; k <= 16; k++) {
      // A spiky "impact" star.
      const ang = (k / 16) * Math.PI * 2
      const r = (k % 2 === 0 ? 92 : 66) * u * (1 + (hash(b.seed, k, 251) - 0.5) * 0.12)
      const px = Math.cos(ang) * r
      const py = Math.sin(ang) * r
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fill()
    text(c, 'VS', 0, 26 * u, { size: 78 * u, family: b.style.font, color: '#ffffff', align: 'center' })
    g.restore()
  }
  // Stat rows.
  if (stats.length) {
    const rowH = Math.min(74 * u, (H * (portrait ? 0.15 : 0.24)) / stats.length)
    const top = portrait ? H * 0.825 : H * 0.745
    const half = portrait ? W * 0.4 : W * 0.3
    const rowFill = b.style.backdrop === 'paper' ? 'rgba(60,40,20,0.1)' : 'rgba(0,0,0,0.42)'
    stats.forEach((st, k) => {
      const p = prog(c.t, sStats.at(k), 0.55)
      if (p <= 0) return
      const e = outCubic(p)
      const y = top + k * rowH
      const cxm = x0 + W / 2
      const va = st.value ?? 0
      const vb = st.value2 ?? 0
      const mx = Math.max(1e-9, Math.abs(va), Math.abs(vb))
      g.save()
      g.globalAlpha *= clamp01(p * 2)
      g.fillStyle = rowFill
      roundRect(g, cxm - half - 90 * u, y - rowH * 0.42, (half + 90 * u) * 2, rowH * 0.84, 12 * u)
      g.fill()
      const barH = rowH * 0.34
      const gap = 110 * u
      const wa = (half - gap) * (Math.abs(va) / mx) * e
      const wb = (half - gap) * (Math.abs(vb) / mx) * e
      g.fillStyle = va >= vb ? b.style.accent : '#9a9aa6'
      roundRect(g, cxm - gap - wa, y - barH / 2, wa, barH, barH / 2)
      g.fill()
      g.fillStyle = vb >= va ? b.style.accent : '#9a9aa6'
      roundRect(g, cxm + gap, y - barH / 2, wb, barH, barH / 2)
      g.fill()
      text(c, st.title, cxm, y + rowH * 0.13, { size: rowH * 0.38, color: c.onBg, align: 'center', maxW: gap * 1.85 })
      text(c, fmtNum(va * e, va), cxm - gap - wa - 12 * u, y + rowH * 0.13, { size: rowH * 0.38, color: c.onBg, align: 'right' })
      text(c, fmtNum(vb * e, vb), cxm + gap + wb + 12 * u, y + rowH * 0.13, { size: rowH * 0.38, color: c.onBg, align: 'left' })
      g.restore()
    })
  }
}

/** Number formatting: the system's grouping, with the decimals the target has. */
export function fmtNum(v: number, target: number): string {
  const decimals = Number.isInteger(target) ? 0 : Math.min(2, (String(target).split('.')[1] ?? '').length)
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function drawStat(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const main = b.items[0]
  const extra = b.items.slice(1)
  const img = imageOf(c, main)
  if (img) {
    // Its own backdrop: the picture, drifting slowly, darkened for the number.
    g.save()
    g.globalAlpha *= c.a
    const z = 1.02 + 0.08 * (c.t / Math.max(1, b.duration))
    drawCover(g, img, x0, 0, W, H, z)
    g.fillStyle = 'rgba(0,0,0,0.5)'
    g.fillRect(x0, 0, W, H)
    g.restore()
  }
  headline(c)
  const target = main.value ?? 0
  const countEnd = Math.max(0.9, b.duration * 0.55)
  const cp = outExpo(prog(c.t, 0.3, countEnd - 0.3))
  const landed = c.t >= countEnd
  const punch = landed ? 1 + 0.07 * Math.exp(-9 * (c.t - countEnd)) * Math.cos(16 * (c.t - countEnd)) : 1
  const bo = boil(c, 500, 1.2)
  const cx = x0 + W / 2
  const cy = H * (c.portrait ? 0.46 : 0.5)
  const num = fmtNum(target * cp, target)
  const unit = main.note ?? ''
  const color = img || c.b.style.backdrop !== 'paper' ? '#ffffff' : b.style.ink
  g.save()
  g.translate(cx + bo.dx, cy + bo.dy)
  g.rotate(bo.r + tilt(c, 501, 1.5))
  g.scale(punch, punch)
  const size = fitSize(g, num + unit, b.style.font, 700, (c.portrait ? 200 : 250) * u, W * 0.86)
  g.font = fontOf(size, b.style.font)
  const wNum = g.measureText(num).width
  g.font = fontOf(size * 0.5, b.style.font)
  const wUnit = unit ? g.measureText(unit).width + 10 * u : 0
  const left = -(wNum + wUnit) / 2
  const appear = clamp01(prog(c.t, 0.2, 0.3) * 1.2)
  g.globalAlpha *= appear
  text(c, num, left, size * 0.34, { size, family: b.style.font, color })
  if (unit) text(c, unit, left + wNum + 10 * u, size * 0.34, { size: size * 0.5, family: b.style.font, color: b.style.accent })
  // The landing: a marker stroke under the number.
  marker(c, left, size * 0.5, left + wNum + wUnit, size * 0.46, 16 * u, b.style.accent, prog(c.t, countEnd, 0.45), 502)
  g.restore()
  // What the number means.
  text(c, main.title, cx, cy + (c.portrait ? 150 : 185) * u, {
    size: 50 * u,
    color,
    align: 'center',
    maxW: W * 0.8,
    alpha: outCubic(prog(c.t, 0.5, 0.5))
  })
  // Context chips after the landing.
  extra.forEach((it, k) => {
    const p = outBack(prog(c.t, countEnd + 0.25 + k * 0.25, 0.45))
    if (p <= 0) return
    const n = extra.length
    const chipW = Math.min(W * 0.26, (W * 0.84) / n)
    const x = cx + (k - (n - 1) / 2) * (chipW + 16 * u)
    const y = H * (c.portrait ? 0.78 : 0.82)
    g.save()
    g.globalAlpha *= clamp01(p * 1.6)
    g.translate(x, y + (1 - p) * 30 * u)
    g.rotate(tilt(c, 520 + k, 2))
    card(c, -chipW / 2, -34 * u, chipW, 68 * u, b.style.accent, 34)
    const label = it.value !== undefined ? `${fmtNum(it.value, it.value)} ${it.title}` : it.title
    text(c, label, 0, 11 * u, { size: 30 * u, color: '#111111', align: 'center', maxW: chipW - 30 * u })
    g.restore()
  })
}

function drawTimeline(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const items = b.items
  const n = items.length
  const s = templateSlots(b)
  headline(c)
  const spacing = c.portrait ? W * 0.78 : W * 0.36
  const lineY = H * (c.portrait ? 0.55 : 0.56)
  const eventX = (i: number): number => i * spacing
  // The camera: parked on the active event, gliding to the next one.
  let cam = 0
  for (let i = 1; i < n; i++) cam += (eventX(i) - eventX(i - 1)) * inOutCubic(prog(c.t, s.at(i) - 0.55, 0.65))
  const screenX = (x: number): number => x0 + W * 0.5 + x - cam
  // The line, drawn out ahead of the camera.
  const lp = outCubic(prog(c.t, 0.15, 0.7))
  marker(c, screenX(-W * 0.62), lineY, screenX(-W * 0.62 + (cam + W * 1.1) * lp), lineY, 8 * u, c.onBg, 1, 600)
  const pw = c.portrait ? W * 0.56 : W * 0.19
  const ph = pw * 0.72
  const foot = pw * 0.14
  for (let i = 0; i < n; i++) {
    const x = screenX(eventX(i))
    if (x < x0 - W * 0.35 || x > x0 + W * 1.35) continue
    const t0 = s.at(i)
    const p = prog(c.t, t0 - 0.15, 0.5)
    if (p <= 0) continue
    const item = items[i]
    const active = c.t >= t0 - 0.15 && (i === n - 1 || c.t < s.at(i + 1) - 0.15)
    const bo = boil(c, 610 + i)
    const up = i % 2 === 0
    g.save()
    g.globalAlpha *= active ? 1 : 0.7
    const dp = springy(p)
    g.fillStyle = b.style.accent
    g.beginPath()
    g.arc(x, lineY, 15 * u * dp, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = c.onBg
    g.lineWidth = 4 * u
    g.stroke()
    // The date on the other side of the line from the picture.
    if (item.note) {
      text(c, item.note, x + bo.dx, lineY + (up ? 84 : -34) * u + bo.dy, {
        size: 62 * u,
        family: b.style.font,
        color: b.style.accent,
        align: 'center',
        alpha: clamp01(p * 2)
      })
    }
    const img = imageOf(c, item)
    const e = outBack(p)
    if (img) {
      // The polaroid's strip carries the event, written by hand.
      const cy = up ? lineY - 56 * u - foot - ph / 2 : lineY + 118 * u + ph / 2
      photo(c, img, x + bo.dx, cy + (1 - e) * (up ? 36 : -36) * u + bo.dy, pw, ph, tilt(c, i + 620, 4) + bo.r, i + 620, clamp01(p * 2), item.title)
    } else {
      text(c, item.title, x + bo.dx, lineY + (up ? -46 : 150) * u + bo.dy, {
        size: 42 * u,
        color: c.onBg,
        align: 'center',
        maxW: spacing * 0.9,
        alpha: clamp01(p * 2)
      })
    }
    g.restore()
  }
}

/**
 * A photo app: a quiet panel with a grid of photos. On each photo's turn it
 * dips as if pressed, opens into the viewer with its caption, holds and closes
 * again.
 */
function drawGallery(c: Ctx): void {
  const { g, b, u, W, H, x0 } = c
  const L = galleryLayout(b, x0, W, H)
  const st = b.style
  const appear = outCubic(prog(c.t, 0.05, 0.5))
  g.save()
  g.globalAlpha *= appear
  g.translate(0, (1 - appear) * 24 * u)
  // The panel and its header.
  card(c, L.panel.x, L.panel.y, L.panel.w, L.panel.h, st.card, 22)
  const hy = L.panel.y + L.header * 0.62
  text(c, b.title, L.panel.x + L.panel.w * 0.04, hy, { size: L.header * 0.36, family: st.font, weight: 700, color: st.ink, maxW: L.panel.w * 0.6 })
  for (let k = 0; k < 3; k++) {
    g.fillStyle = k === 0 ? st.accent : 'rgba(255,255,255,0.22)'
    g.beginPath()
    g.arc(L.panel.x + L.panel.w * (0.955 - k * 0.028), L.panel.y + L.header * 0.5, L.header * 0.07, 0, Math.PI * 2)
    g.fill()
  }
  // Which photo is open now (if any), and how far.
  let open = -1
  let e = 0
  b.items.forEach((_, i) => {
    const tm = galleryTimes(b, i)
    const po = prog(c.t, tm.open, 0.45)
    const pc = prog(c.t, tm.close, 0.38)
    const k = outExpo(po) * (1 - inOutCubic(pc))
    if (k > 0.001) {
      open = i
      e = k
    }
  })
  // The grid.
  b.items.forEach((item, i) => {
    const r = L.thumbs[i]
    const tm = galleryTimes(b, i)
    const pin = outCubic(prog(c.t, 0.25 + i * 0.06, 0.4))
    if (pin <= 0) return
    // A press: a small dip just before it opens.
    const press = Math.sin(Math.PI * prog(c.t, tm.tap - 0.06, 0.2)) * 0.05
    const k = 1 - press
    g.save()
    g.globalAlpha *= pin * (i === open ? 1 - 0.85 * e : 1)
    g.translate(r.x + r.w / 2, r.y + r.h / 2 + (1 - pin) * 14 * u)
    g.scale(k, k)
    g.save()
    roundRect(g, -r.w / 2, -r.h / 2, r.w, r.h, 12 * u)
    g.clip()
    const img = imageOf(c, item)
    if (img) drawCover(g, img, -r.w / 2, -r.h / 2, r.w, r.h)
    else {
      g.fillStyle = '#23252c'
      g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
      text(c, item.title, 0, r.h * 0.06, { size: r.h * 0.12, color: 'rgba(255,255,255,0.55)', align: 'center', maxW: r.w * 0.86, weight: 600 })
    }
    g.restore()
    g.restore()
  })
  // The open photo, grown from its thumbnail into the viewer.
  if (open >= 0 && e > 0.001) {
    const from = L.thumbs[open]
    const to = L.viewer
    const lerp = (a: number, bb: number): number => a + (bb - a) * e
    const r = { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) }
    // The grid steps back under it.
    g.fillStyle = `rgba(8,9,12,${(0.72 * e).toFixed(3)})`
    roundRect(g, L.panel.x, L.panel.y + L.header * 0.9, L.panel.w, L.panel.h - L.header * 0.9, 22 * u)
    g.fill()
    g.save()
    g.shadowColor = `rgba(0,0,0,${(0.45 * e).toFixed(3)})`
    g.shadowBlur = 30 * u * e
    g.shadowOffsetY = 10 * u * e
    roundRect(g, r.x, r.y, r.w, r.h, lerp(12, 16) * u)
    g.fillStyle = '#1b1c21'
    g.fill()
    g.restore()
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, lerp(12, 16) * u)
    g.clip()
    const item = b.items[open]
    const img = imageOf(c, item)
    if (img) drawCover(g, img, r.x, r.y, r.w, r.h)
    else {
      g.fillStyle = '#23252c'
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    // Its caption, over a soft shade at the bottom.
    const cap = clamp01((e - 0.6) / 0.4)
    if (cap > 0 && (item.title || item.note)) {
      const sh = g.createLinearGradient(0, r.y + r.h * 0.6, 0, r.y + r.h)
      sh.addColorStop(0, 'rgba(0,0,0,0)')
      sh.addColorStop(1, `rgba(0,0,0,${(0.6 * cap).toFixed(3)})`)
      g.fillStyle = sh
      g.fillRect(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4)
      text(c, item.title, r.x + r.w * 0.04, r.y + r.h * (item.note ? 0.87 : 0.93), { size: r.h * 0.07, color: '#ffffff', alpha: cap, maxW: r.w * 0.9 })
      if (item.note) text(c, item.note, r.x + r.w * 0.04, r.y + r.h * 0.94, { size: r.h * 0.045, weight: 500, color: '#ffffff', alpha: 0.8 * cap, maxW: r.w * 0.9 })
    }
    g.restore()
  }
  g.restore()
}

// -- the sticker look ----------------------------------------------------------

/** A sticker card: flat fill, one bold ink line round it, a
 *  dark sticker shadow down and to the right. */
export function sticker(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, ink: string, line = 1): void {
  const g = c.g
  const ol = 6.5 * c.u * line
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowBlur = 18 * c.u
  g.shadowOffsetX = 6 * c.u
  g.shadowOffsetY = 10 * c.u
  g.fillStyle = ink
  roundRect(g, x - ol, y - ol, w + ol * 2, h + ol * 2, r + ol)
  g.fill()
  g.restore()
  g.fillStyle = fill
  roundRect(g, x, y, w, h, r)
  g.fill()
}

/**
 * Count: a white card with the list; the number in its badge ticks up and
 * each item slides in on its count — the newest underlined, the earlier ones stepping back.
 */
function drawCount(c: Ctx): void {
  const { g, b, u } = c
  const L = countLayout(b, c.x0, c.W, c.H)
  const st = b.style
  const s = templateSlots(b)
  const appear = outCubic(prog(c.t, 0.05, 0.45))
  g.save()
  g.globalAlpha *= appear
  g.translate(0, (1 - appear) * 26 * u)
  sticker(c, L.card.x, L.card.y, L.card.w, L.card.h, 22 * u, st.card, st.ink)
  const head = L.card.h * 0.2
  const pad = Math.min(L.card.w, L.card.h) * 0.09
  text(c, b.title, L.card.x + pad, L.card.y + head * 0.72, { size: head * 0.42, family: st.font, weight: 400, color: st.ink, maxW: L.card.w - pad * 2 })
  // How many have been counted, and how fresh the last one is.
  let k = 0
  for (let i = 0; i < s.count; i++) if (c.t >= s.at(i)) k = i + 1
  const since = k > 0 ? c.t - s.at(k - 1) : 0
  // The badge: accent disc, ink ring, the number popping as it changes.
  const bx = L.badge.x + L.badge.w / 2
  const by = L.badge.y + L.badge.h / 2
  const R = L.badge.w / 2
  g.save()
  g.fillStyle = st.ink
  g.beginPath()
  g.arc(bx + 5 * u, by + 7 * u, R, 0, Math.PI * 2)
  g.globalAlpha *= 0.9
  g.fill()
  g.restore()
  g.fillStyle = st.ink
  g.beginPath()
  g.arc(bx, by, R, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = k > 0 ? st.accent : st.card
  g.beginPath()
  g.arc(bx, by, R - 6.5 * u, 0, Math.PI * 2)
  g.fill()
  if (k > 0) {
    // The old number drops out as the new one comes down into place.
    const v = outCubic(prog(since, 0, 0.32))
    const pop = 1 + 0.12 * Math.sin(Math.PI * prog(since, 0, 0.3))
    g.save()
    g.beginPath()
    g.arc(bx, by, R - 6.5 * u, 0, Math.PI * 2)
    g.clip()
    if (k > 1 && v < 1) text(c, String(k - 1), bx, by + R * 0.36 + v * R * 1.2, { size: R * 1.05, family: st.font, weight: 400, color: st.ink, align: 'center', alpha: 1 - v })
    g.translate(bx, by + R * 0.36 - (1 - v) * R * 1.2)
    g.scale(pop, pop)
    text(c, String(k), 0, 0, { size: R * 1.05, family: st.font, weight: 400, color: st.ink, align: 'center' })
    g.restore()
  }
  // The rows.
  b.items.forEach((item, i) => {
    const r = L.rows[i]
    const at = s.at(i)
    const p = outCubic(prog(c.t, at, 0.4))
    if (p <= 0.001) return
    const fresh = i === k - 1
    const alpha = p * (fresh ? 1 : 0.5 + 0.5 * (1 - prog(c.t, i + 1 < s.count ? s.at(i + 1) : 1e9, 0.3)))
    const y = r.y + r.h * 0.66
    g.save()
    g.globalAlpha *= alpha
    g.translate((1 - p) * 30 * u, 0)
    // Its number in a small ink chip.
    const cs = r.h * 0.62
    g.fillStyle = st.ink
    roundRect(g, r.x, r.y + (r.h - cs) / 2, cs, cs, 8 * u)
    g.fill()
    text(c, String(i + 1), r.x + cs / 2, r.y + r.h / 2 + cs * 0.24, { size: cs * 0.62, family: st.font, weight: 400, color: st.card, align: 'center' })
    const tx = r.x + cs + r.h * 0.35
    const size = text(c, item.title, tx, y, { size: r.h * 0.46, weight: 800, color: st.ink, maxW: r.x + r.w - tx })
    if (fresh) {
      // A marker stroke under the newest one, drawn as it lands.
      g.font = fontOf(size, 'Inter', 800)
      const tw = Math.min(r.x + r.w - tx, g.measureText(item.title).width)
      const q = outCubic(prog(c.t, at + 0.12, 0.35))
      g.fillStyle = st.accent
      g.globalAlpha *= 0.9
      g.fillRect(tx, y + r.h * 0.1, tw * q, r.h * 0.12)
    }
    g.restore()
  })
  g.restore()
}

/**
 * Tap to open: cards side by side; on its beat one dips as if tapped,
 * then opens into the whole frame (corners and line easing away), its title
 * on a chip; it closes back into its place before the next.
 */
function drawFocus(c: Ctx): void {
  const { g, b, u } = c
  const L = focusLayout(b, c.x0, c.W, c.H)
  const st = b.style
  const appear = outCubic(prog(c.t, 0.05, 0.45))
  let open = -1
  let e = 0
  b.items.forEach((_, i) => {
    const tm = galleryTimes(b, i)
    const k = outExpo(prog(c.t, tm.open, 0.5)) * (1 - inOutCubic(prog(c.t, tm.close, 0.42)))
    if (k > 0.001) {
      open = i
      e = k
    }
  })
  const cardAt = (item: TemplateItem, i: number, r: { x: number; y: number; w: number; h: number }, alpha: number): void => {
    const tm = galleryTimes(b, i)
    const press = Math.sin(Math.PI * prog(c.t, tm.tap - 0.06, 0.2)) * 0.05
    const pin = outCubic(prog(c.t, 0.2 + i * 0.08, 0.45))
    if (pin <= 0) return
    const k = 1 - press
    g.save()
    g.globalAlpha *= alpha * pin
    g.translate(r.x + r.w / 2, r.y + r.h / 2 + (1 - pin) * 20 * u)
    g.scale(k, k)
    const label = r.h * 0.2
    sticker(c, -r.w / 2, -r.h / 2, r.w, r.h + label, 16 * u, st.card, st.ink)
    g.save()
    roundRect(g, -r.w / 2 + 8 * u, -r.h / 2 + 8 * u, r.w - 16 * u, r.h - 8 * u, 10 * u)
    g.clip()
    const img = imageOf(c, item)
    if (img) drawCover(g, img, -r.w / 2 + 8 * u, -r.h / 2 + 8 * u, r.w - 16 * u, r.h - 8 * u)
    else {
      g.fillStyle = '#e9e9ec'
      g.fillRect(-r.w / 2, -r.h / 2, r.w, r.h)
    }
    g.restore()
    text(c, item.title, -r.w / 2 + 14 * u, r.h / 2 + label * 0.66, { size: label * 0.5, weight: 800, color: st.ink, maxW: r.w - 28 * u })
    g.restore()
  }
  g.save()
  g.globalAlpha *= appear
  b.items.forEach((item, i) => cardAt(item, i, L.cards[i], i === open ? 1 - Math.min(1, e * 3) : 1))
  if (open >= 0 && e > 0.001) {
    const from = L.cards[open]
    const to = L.full
    const lerp = (a: number, bb: number): number => a + (bb - a) * e
    const r = { x: lerp(from.x, to.x), y: lerp(from.y, to.y), w: lerp(from.w, to.w), h: lerp(from.h, to.h) }
    // Everything else steps back.
    g.fillStyle = `rgba(0,0,0,${(0.6 * e).toFixed(3)})`
    g.fillRect(c.x0, 0, c.W, c.H)
    const line = 1 - e
    const rad = lerp(16, 0) * u
    if (line > 0.02) sticker(c, r.x, r.y, r.w, r.h, rad, st.card, st.ink, line)
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, rad)
    g.clip()
    const item = b.items[open]
    const img = imageOf(c, item)
    if (img) drawCover(g, img, r.x, r.y, r.w, r.h)
    else {
      g.fillStyle = '#e9e9ec'
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    // Its title on a chip.
    const cap = clamp01((e - 0.7) / 0.3)
    if (cap > 0 && item.title) {
      const size = c.H * 0.045
      g.font = fontOf(size, 'Inter', 800)
      const tw = Math.min(c.W * 0.7, g.measureText(item.title).width)
      const nw = item.note ? Math.min(c.W * 0.7, (g.font = fontOf(size * 0.6, 'Inter', 600), g.measureText(item.note).width)) : 0
      const w = Math.max(tw, nw) + size * 1.2
      const h = size * (item.note ? 2.3 : 1.6)
      const x = c.x0 + c.W * 0.05
      // Top left.
      const y = c.H * 0.07 + (1 - cap) * 16 * u
      g.save()
      g.globalAlpha *= cap
      sticker(c, x, y, w, h, 12 * u, st.card, st.ink)
      text(c, item.title, x + size * 0.6, y + size * 1.1, { size, weight: 800, color: st.ink, maxW: c.W * 0.7 })
      if (item.note) text(c, item.note, x + size * 0.6, y + size * 1.85, { size: size * 0.6, weight: 600, color: st.ink, alpha: 0.7, maxW: c.W * 0.7 })
      g.restore()
    }
  }
  g.restore()
}

// -- entry point ---------------------------------------------------------------

/** Draws every template block live at `time`. */
export function drawTemplates(ctx: Ctx2D, project: Project, time: number, resolve: Resolver, scale: number, view: TemplateView): void {
  const list = project.templates
  if (!list || list.length === 0) return
  for (const b of list) {
    if (time < b.start || time >= templateEnd(b)) continue
    drawTemplateAt(ctx, project, b, time - b.start, resolve, scale, view)
  }
}

/** One block at local time `t` (also used for the panel's thumbnails). */
export function drawTemplateAt(
  ctx: Ctx2D,
  project: Project,
  b: TemplateBlock,
  tNow: number,
  resolve: Resolver,
  scale: number,
  view: TemplateView
): void {
  // Cut short: it stops where it was cut, and leaves.
  const t = b.cut !== undefined ? Math.min(tNow, b.cut) : tNow
  const gone = cutGone(b, tNow)
  // A scene template makes its own way in and out, from the live picture.
  const scene = SCENE_KINDS.has(b.kind)
  // A verse panel glides in and out by itself, over the playing video.
  const own = scene || b.kind === 'quote' || b.kind === 'news'
  const inA = outCubic(prog(t, 0, 0.35))
  const outA = 1 - inOutCubic(prog(t, b.duration - 0.4, 0.4))
  const a = own ? 1 : inA * outA
  if (a <= 0.001) return
  const live = scene ? grabLive(ctx) : null
  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.beginPath()
  ctx.rect(view.left, 0, view.width, view.height)
  ctx.clip()
  const c: Ctx = {
    g: ctx,
    b,
    t,
    x0: view.left,
    W: view.width,
    H: view.height,
    u: view.height / 1080,
    portrait: view.width / view.height < 1,
    a,
    project,
    resolve,
    onBg: b.style.backdrop === 'paper' || b.style.backdrop === 'card' ? b.style.ink : '#ffffff',
    px: scale,
    live
  }
  // Its backdrop lifts as it goes; the rest slides down out of the frame.
  // (Big words as a window bring their own veil: the picture through the
  // words is the picture as it is.)
  if (!own && !(b.kind === 'words' && b.big?.blend === 'window')) backdrop(gone > 0 ? { ...c, a: a * (1 - gone) } : c, scale)
  // How it leaves: dropped down, faded (a touch smaller), slid away.
  const exit = b.cutExit ?? 'drop'
  let fadeK = 1
  if (gone > 0) {
    if (exit === 'drop') ctx.translate(0, gone * CUT_DROP * view.height)
    else if (exit === 'slide') ctx.translate(-gone * view.width * 1.05, 0)
    else if (exit === 'fade') {
      fadeK = 1 - gone
      const k = 1 - 0.04 * gone
      const cx = view.left + view.width / 2
      ctx.translate(cx, view.height / 2)
      ctx.scale(k, k)
      ctx.translate(-cx, -view.height / 2)
    }
  }
  ctx.globalAlpha = a * fadeK
  // Moved and scaled as a whole (its backdrop stays on the whole frame).
  const pl = templatePlace(b)
  if (pl) {
    const cx = view.left + view.width / 2
    const cy = view.height / 2
    ctx.translate(cx + pl.x * view.width, cy + pl.y * view.height)
    ctx.scale(pl.s, pl.s)
    ctx.translate(-cx, -cy)
  }
  switch (b.kind) {
    case 'steps':
      drawSteps(c)
      break
    case 'ranking':
      drawRanking(c)
      break
    case 'versus':
      drawVersus(c)
      break
    case 'stat':
      drawStat(c)
      break
    case 'timeline':
      drawTimeline(c)
      break
    case 'gallery':
      drawGallery(c)
      break
    case 'count':
      drawCount(c)
      break
    case 'focus':
      drawFocus(c)
      break
    case 'home':
      drawHome(c)
      break
    case 'map':
    case 'atlas':
      drawMap(c)
      break
    case 'terminal':
      drawTerminal(c)
      break
    case 'quote':
      drawQuote(c)
      break
    case 'cutout':
      drawCutout(c)
      break
    case 'compare':
      drawCompare(c)
      break
    case 'checklist':
      drawChecklist(c)
      break
    case 'post':
      drawPost(c)
      break
    case 'poll':
      drawPoll(c)
      break
    case 'cards':
      drawCards(c)
      break
    case 'chess':
      drawChess(c)
      break
    case 'news':
      drawNews(c)
      break
    case 'chapter':
      if (chapterDesign(b) === 'reel') drawChapter(c)
      else if (chapterDesign(b) === 'scope') drawScope(c)
      else drawRevolver(c)
      break
    case 'list':
      drawList(c)
      break
    case 'words':
      drawWords(c)
      break
    case 'player':
      drawPlayer(c)
      break
    case 'store':
      drawStore(c)
      break
    case 'boxes':
      drawBoxes(c)
      break
    case 'domino':
      drawDomino(c)
      break
    case 'bars':
      drawBars(c)
      break
    case 'pie':
      drawPie(c)
      break
    case 'line':
      drawLine(c)
      break
  }
  ctx.restore()
}
