// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Box to box: a main box and the boxes it leads to, on glass. The boxes
// come up out of a soft blur; the main one lights — filling with its light —
// and from it a light runs along each line — a bright head, the line catching
// behind it — into the next box, whose edge takes the light (a glint running
// once round it) and whose words come up. Every glow is at the time you give
// it. Calm, eased motion: a box swells a hair as it lights and settles,
// nothing bounces.

import { boxesLayout, boxesTimes, glide, linkPoint, type BoxesLayout } from './model'
import { clamp01, fontOf, outCubic, roundRect, type Ctx } from './draw'
import type { TemplateItem } from '../types'

type Rect = { x: number; y: number; w: number; h: number }
type RGB = [number, number, number]

const rgbOf = (hex: string): RGB => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const css = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(3)})`
const mixRgb = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const lumOf = (c: RGB): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255
const WHITE: RGB = [255, 255, 255]

/** A colour turned round the hue wheel (degrees) and moved in lightness. */
function turn(hex: string, deg: number, light: number): RGB {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l0 = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l0 > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  h = (((h + deg / 360) % 1) + 1) % 1
  const l = Math.min(0.95, Math.max(0.05, l0 + light))
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    const x = ((t % 1) + 1) % 1
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** Is the colour a blue (its fill turns towards violet, not towards cyan)? */
function blueish(hex: string): boolean {
  const [r, g, b] = rgbOf(hex)
  return b > r && b > g && b - Math.max(r, g) > 40 && g > r * 0.9
}

/** The colours a palette gives the boxes: the glass, its light, the words. */
interface Tones {
  dark: boolean
  /** The glass: its top (a little lit) and its body. */
  glassTop: RGB
  glass: RGB
  ink: RGB
  accent: RGB
  /** The light as a line or an edge: on deep glass a touch brighter. */
  line: RGB
  /** The light's second tone, a turn round the wheel, for the main box's fill. */
  accent2: RGB
  /** Words on the filled main box. */
  onAccent: RGB
}

function tonesOf(st: { accent: string; ink: string; card: string }): Tones {
  const card = rgbOf(st.card)
  const accent = rgbOf(st.accent)
  const dark = lumOf(card) < 0.5
  return {
    dark,
    // A deep glass leans a touch towards its light; a frosted one stays clean.
    glassTop: dark ? mixRgb(mixRgb(card, accent, 0.1), WHITE, 0.08) : mixRgb(card, WHITE, 0.6),
    glass: card,
    ink: rgbOf(st.ink),
    accent,
    line: dark ? mixRgb(accent, WHITE, 0.16) : accent,
    accent2: turn(st.accent, blueish(st.accent) ? 26 : -28, 0),
    onAccent: lumOf(accent) > 0.62 ? (dark ? mixRgb(card, [0, 0, 0], 0.2) : rgbOf(st.ink)) : WHITE
  }
}

function linkPath(c: Ctx, pts: BoxesLayout['links'][number]['pts'], from: number, to: number): void {
  const g = c.g
  const N = 40
  g.beginPath()
  for (let k = 0; k <= N; k++) {
    const u = from + ((to - from) * k) / N
    const [x, y] = linkPoint(pts, u)
    if (k === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
}

function drawBox(c: Ctx, r: Rect, item: TemplateItem | undefined, main: boolean, appear: number, lit: number, sweep: number, swell: number, tn: Tones): void {
  const { g, u } = c
  const st = c.b.style
  if (appear <= 0.001) return
  const k = outCubic(appear)
  const s = 1 + 0.025 * swell
  const rad = Math.min(r.w, r.h) * 0.16
  const fill = main ? lit : 0
  g.save()
  g.globalAlpha *= k
  g.translate(r.x + r.w / 2, r.y + r.h / 2 + (1 - k) * 16 * u)
  g.scale(s, s)
  const x = -r.w / 2
  const y = -r.h / 2
  if (k < 0.98) g.filter = `blur(${((1 - k) * 8 * u * c.px).toFixed(1)}px)`
  // The glass: a soft shadow, then a body that lets a little of what is
  // behind it through (frosted, over a blurred picture).
  const body = g.createLinearGradient(0, y, 0, y + r.h)
  body.addColorStop(0, css(tn.glassTop, tn.dark ? 0.92 : 0.93))
  body.addColorStop(1, css(tn.glass, tn.dark ? 0.9 : 0.9))
  g.save()
  g.shadowColor = tn.dark ? 'rgba(0,0,0,0.5)' : 'rgba(12,16,32,0.22)'
  g.shadowBlur = (tn.dark ? 34 : 28) * u * c.px
  g.shadowOffsetY = (tn.dark ? 12 : 9) * u * c.px
  g.fillStyle = body
  roundRect(g, x, y, r.w, r.h, rad)
  g.fill()
  g.restore()
  if (lit > 0.001) {
    // A soft bloom of the light round it.
    g.save()
    g.filter = `blur(${((main ? 14 : 10) * u * c.px).toFixed(1)}px)`
    g.strokeStyle = css(tn.accent, (main ? 0.6 : 0.42) * lit)
    g.lineWidth = (main ? 10 : 8) * u
    roundRect(g, x, y, r.w, r.h, rad)
    g.stroke()
    g.restore()
  }
  if (fill > 0.001) {
    // The main box fills with its light: the accent turning a little across
    // it, a sheen at the top, a fine bright edge.
    g.save()
    roundRect(g, x, y, r.w, r.h, rad)
    g.clip()
    g.globalAlpha *= fill
    const grad = g.createLinearGradient(x, y, x + r.w, y + r.h)
    grad.addColorStop(0, css(tn.accent))
    grad.addColorStop(1, css(tn.accent2))
    g.fillStyle = grad
    g.fillRect(x, y, r.w, r.h)
    const sheen = g.createLinearGradient(0, y, 0, y + r.h)
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)')
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.04)')
    sheen.addColorStop(1, 'rgba(0,0,0,0.08)')
    g.fillStyle = sheen
    g.fillRect(x, y, r.w, r.h)
    g.restore()
    g.strokeStyle = `rgba(255,255,255,${(0.32 * fill).toFixed(3)})`
    g.lineWidth = 1.2 * u
    roundRect(g, x + 0.6 * u, y + 0.6 * u, r.w - 1.2 * u, r.h - 1.2 * u, rad)
    g.stroke()
  } else if (lit > 0.001) {
    // A box the light has reached: a faint wash of it in the glass, its edge
    // lit.
    g.save()
    roundRect(g, x, y, r.w, r.h, rad)
    g.clip()
    const tint = g.createRadialGradient(0, y, 0, 0, y, Math.max(r.w, r.h) * 0.9)
    tint.addColorStop(0, css(tn.accent, (tn.dark ? 0.15 : 0.1) * lit))
    tint.addColorStop(1, css(tn.accent, 0))
    g.fillStyle = tint
    g.fillRect(x, y, r.w, r.h)
    g.restore()
    g.save()
    g.shadowColor = css(tn.accent, 0.9 * lit)
    g.shadowBlur = 18 * u * c.px * lit
    g.strokeStyle = css(tn.line, lit)
    g.lineWidth = 2.2 * u
    roundRect(g, x, y, r.w, r.h, rad)
    g.stroke()
    g.restore()
  }
  // The glass's own edge: a fine line, brighter along the top.
  if (lit < 0.999) {
    const edge = g.createLinearGradient(0, y, 0, y + r.h)
    const a = 1 - lit
    if (tn.dark) {
      edge.addColorStop(0, `rgba(255,255,255,${(0.22 * a).toFixed(3)})`)
      edge.addColorStop(1, `rgba(255,255,255,${(0.07 * a).toFixed(3)})`)
    } else {
      edge.addColorStop(0, css(tn.ink, 0.08 * a))
      edge.addColorStop(1, css(tn.ink, 0.16 * a))
    }
    g.strokeStyle = edge
    g.lineWidth = 1.2 * u
    roundRect(g, x, y, r.w, r.h, rad)
    g.stroke()
  }
  // The glint running once round the edge as it lights.
  if (sweep > 0 && sweep < 1 && 'createConicGradient' in g) {
    const a0 = -Math.PI / 2 + sweep * Math.PI * 2
    const cg = (g as CanvasRenderingContext2D).createConicGradient(a0 - 0.6, 0, 0)
    const fade = Math.sin(Math.PI * sweep)
    cg.addColorStop(0, 'rgba(255,255,255,0)')
    cg.addColorStop(0.07, `rgba(255,255,255,${(0.95 * fade).toFixed(3)})`)
    cg.addColorStop(0.1, 'rgba(255,255,255,0)')
    cg.addColorStop(1, 'rgba(255,255,255,0)')
    g.save()
    g.strokeStyle = cg
    g.lineWidth = 2.6 * u
    g.shadowColor = css(tn.accent, 0.9 * fade)
    g.shadowBlur = 14 * u * c.px
    roundRect(g, x, y, r.w, r.h, rad)
    g.stroke()
    g.restore()
  }
  // The words: the title, the line under it; they come up as it lights (the
  // main box shows its own from the start, turning to the colour that reads
  // on its light as it fills).
  const words = main ? 1 : 0.5 + 0.5 * lit
  if (item) {
    const hasNote = !!item.note
    const ink = mixRgb(tn.ink, tn.onAccent, fill)
    const ts = Math.min(r.h * (hasNote ? 0.27 : 0.32), r.w * 0.12) * (main ? 1.05 : 1)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = fontOf(ts, st.font, 700)
    const fit = (txt: string, size: number, weight: number): number => {
      g.font = fontOf(size, st.font, weight)
      const w = g.measureText(txt).width
      return w > r.w * 0.86 ? size * ((r.w * 0.86) / w) : size
    }
    const t1 = fit(item.title, ts, 700)
    g.font = fontOf(t1, st.font, 700)
    g.fillStyle = css(ink, words)
    g.fillText(item.title, 0, hasNote ? -r.h * 0.12 : 0)
    if (hasNote) {
      const t2 = fit(item.note!, ts * 0.55, 500)
      g.font = fontOf(t2, st.font, 500)
      g.fillStyle = css(ink, (0.62 + 0.14 * fill) * words)
      g.fillText(item.note!, 0, r.h * 0.2)
    }
  }
  g.restore()
}

export function drawBoxes(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const st = b.style
  const tn = tonesOf(st)
  const L = boxesLayout(b, x0, W, H)
  const T = boxesTimes(b)
  const n = L.boxes.length
  g.save()
  // The lines first, under the boxes.
  for (const ln of L.links) {
    const shown = Math.min(outCubic(clamp01((t - T.appear[ln.to] - 0.15) / 0.4)), outCubic(clamp01((t - T.appear[ln.from] - 0.15) / 0.4)))
    if (shown <= 0.001) continue
    const arrive = T.light[ln.to]
    const depart = arrive - T.travel
    const e = glide((t - depart) / T.travel)
    // The way it will go: a faint dotted line.
    g.save()
    g.globalAlpha *= shown
    g.setLineDash([2 * u, 7 * u])
    g.lineCap = 'round'
    g.strokeStyle = css(tn.ink, tn.dark ? 0.38 : 0.45)
    g.lineWidth = 1.8 * u
    linkPath(c, ln.pts, 0, 1)
    g.stroke()
    g.setLineDash([])
    if (e > 0) {
      // The light along it, and the line catching behind it.
      const after = clamp01((t - arrive) / 0.6)
      g.shadowColor = css(tn.accent, 0.95)
      g.shadowBlur = 16 * u * c.px
      g.strokeStyle = css(tn.line, 1 - 0.2 * after)
      g.lineWidth = 2.8 * u
      linkPath(c, ln.pts, 0, e)
      g.stroke()
      if (e < 1) {
        // The comet: a hot white tail just behind the head.
        g.strokeStyle = 'rgba(255,255,255,0.9)'
        g.lineWidth = 3.2 * u
        linkPath(c, ln.pts, Math.max(0, e - 0.12), e)
        g.stroke()
        const [hx, hy] = linkPoint(ln.pts, e)
        const head = g.createRadialGradient(hx, hy, 0, hx, hy, 26 * u)
        head.addColorStop(0, 'rgba(255,255,255,1)')
        head.addColorStop(0.25, css(mixRgb(tn.accent, WHITE, 0.4), 0.9))
        head.addColorStop(1, css(tn.accent, 0))
        g.shadowBlur = 0
        g.fillStyle = head
        g.beginPath()
        g.arc(hx, hy, 26 * u, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.restore()
  }
  // The main box gives a soft ring each time a light leaves it.
  const mainBox = L.boxes[0]
  for (const ln of L.links) {
    if (ln.from !== 0 || !mainBox) continue
    const depart = T.light[ln.to] - T.travel
    const q = (t - depart) / 0.7
    if (q <= 0 || q >= 1) continue
    const grow = outCubic(q) * 18 * u
    g.save()
    g.globalAlpha *= (1 - q) * 0.5
    g.strokeStyle = css(tn.accent)
    g.lineWidth = 1.5 * u
    roundRect(g, mainBox.x - grow, mainBox.y - grow, mainBox.w + grow * 2, mainBox.h + grow * 2, Math.min(mainBox.w, mainBox.h) * 0.16 + grow)
    g.stroke()
    g.restore()
  }
  for (let i = 0; i < n; i++) {
    const at = T.light[i]
    const lit = outCubic(clamp01((t - at) / 0.35))
    const sweep = (t - at) / 0.75
    const swell = Math.sin(Math.PI * clamp01((t - at) / 0.55))
    drawBox(c, L.boxes[i], b.items[i], i === 0, clamp01((t - T.appear[i]) / 0.5), lit, sweep, swell, tn)
  }
  // A headline over it all, when there is one.
  if (b.title) {
    g.font = fontOf(H * 0.045, st.font, 700)
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.fillStyle = css(tn.ink, outCubic(clamp01(t / 0.5)))
    g.fillText(b.title, x0 + W / 2, H * 0.1, W * 0.8)
  }
  g.restore()
}
