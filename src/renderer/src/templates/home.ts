// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The home screen between chapters. The picture that was playing is swiped
// up from the bottom edge like a phone app — it shrinks and settles into
// its own place on the home screen — then the next chapter opens, which grows back to fill the frame with the next part
// already playing in it. The cut between the chapters happens behind the
// home screen, so the whole thing reads as one take.
//
// Three homes: 'apps' (a phone's home screen of chapter tiles), 'deck' (a
// row of chapter cards that slides along) and 'timeline' (an editor: the
// chapters as clips, a monitor, a playhead moving on) — the channel's
// "editor made visible" in one frame.

import { glide, homeDesign, homeFocus, homeLayout, homeLiveCard, homeOpens, homeTimes } from './model'
import { clamp01, drawCover, imageOf, prog, roundRect, text, type Ctx } from './draw'
import type { TemplateItem } from '../types'

type Rect = { x: number; y: number; w: number; h: number }

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) })
const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3.2

/** A colour turned round the hue wheel and moved in lightness. */
function tone(hex: string, turn: number, light = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0x7aa2ff
  let r = ((n >> 16) & 255) / 255
  let g = ((n >> 8) & 255) / 255
  let b = (n & 255) / 255
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
  h = (((h + turn / 360) % 1) + 1) % 1
  const l = Math.min(0.95, Math.max(0.05, l0 + light))
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    const x = ((t % 1) + 1) % 1
    return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p
  }
  r = f(h + 1 / 3)
  g = f(h)
  b = f(h - 1 / 3)
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
}

/** The live picture (what is playing) laid into r, rounded, with a shadow. */
export function liveInto(c: Ctx, r: Rect, radius: number, alpha = 1, shadow = 1): void {
  if (!c.live || alpha <= 0.002) return
  const g = c.g
  g.save()
  g.globalAlpha *= alpha
  if (shadow > 0.01) {
    g.save()
    g.shadowColor = `rgba(0,0,0,${(0.5 * shadow).toFixed(3)})`
    g.shadowBlur = 44 * c.u * shadow
    g.shadowOffsetY = 16 * c.u * shadow
    g.fillStyle = '#000'
    roundRect(g, r.x, r.y, r.w, r.h, radius)
    g.fill()
    g.restore()
  }
  roundRect(g, r.x, r.y, r.w, r.h, radius)
  g.clip()
  g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, r.x, r.y, r.w, r.h)
  g.restore()
}

/** A chapter's picture filling r — its photo, or a quiet gradient with its
 *  number when it has none. */
function chapterPicture(c: Ctx, item: TemplateItem | undefined, i: number, r: Rect): void {
  const g = c.g
  const img = imageOf(c, item)
  if (img) {
    drawCover(g, img, r.x, r.y, r.w, r.h)
    return
  }
  const a = c.b.style.accent
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
  gr.addColorStop(0, tone(a, i * 38, -0.05))
  gr.addColorStop(1, tone(a, i * 38 + 50, -0.28))
  g.fillStyle = gr
  g.fillRect(r.x, r.y, r.w, r.h)
  text(c, String(i + 1).padStart(2, '0'), r.x + r.w / 2, r.y + r.h * 0.62, { size: Math.min(r.w, r.h) * 0.42, weight: 800, color: 'rgba(255,255,255,0.9)', align: 'center' })
}

/** A small round check, for a chapter already seen. */
function check(c: Ctx, x: number, y: number, R: number): void {
  const g = c.g
  g.save()
  g.fillStyle = c.b.style.accent
  g.beginPath()
  g.arc(x, y, R, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#0b0b0d'
  g.lineWidth = R * 0.28
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(x - R * 0.42, y + R * 0.02)
  g.lineTo(x - R * 0.1, y + R * 0.34)
  g.lineTo(x + R * 0.45, y - R * 0.3)
  g.stroke()
  g.restore()
}

// -- the three homes ---------------------------------------------------------------

function wallpaper(c: Ctx, design: 'apps' | 'deck' | 'timeline' | 'slider'): void {
  const g = c.g
  const { x0, W, H, t } = c
  const st = c.b.style
  g.fillStyle = st.card
  g.fillRect(x0, 0, W, H)
  if (design === 'slider') {
    // A dark screening room: one soft light from above, letterbox bars.
    g.fillStyle = '#07080b'
    g.fillRect(x0, 0, W, H)
    const sp = g.createRadialGradient(x0 + W / 2, H * 0.42, 0, x0 + W / 2, H * 0.42, Math.max(W, H) * 0.62)
    sp.addColorStop(0, tone(st.accent, 0, -0.1).replace('rgb(', 'rgba(').replace(')', ',0.2)'))
    sp.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sp
    g.fillRect(x0, 0, W, H)
    return
  }
  if (design === 'timeline') {
    // An editor's quiet panels.
    const top = g.createLinearGradient(0, 0, 0, H)
    top.addColorStop(0, 'rgba(255,255,255,0.035)')
    top.addColorStop(0.62, 'rgba(255,255,255,0.0)')
    top.addColorStop(0.64, 'rgba(255,255,255,0.03)')
    top.addColorStop(1, 'rgba(255,255,255,0.015)')
    g.fillStyle = top
    g.fillRect(x0, 0, W, H)
    g.fillStyle = 'rgba(255,255,255,0.06)'
    g.fillRect(x0, H * 0.635, W, Math.max(1, c.u))
    return
  }
  if (design === 'apps' && c.live) {
    // The video itself as the wallpaper, the way a phone blurs it behind its
    // home screen: deep, soft, a touch richer — then darkened so the tiles
    // stand out, one light of the accent drifting in it.
    g.save()
    g.filter = `blur(${(42 * c.u * c.px).toFixed(1)}px) saturate(1.25) brightness(0.62)`
    g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, x0 - W * 0.06, -H * 0.06, W * 1.12, H * 1.12)
    g.filter = 'none'
    g.restore()
    const shade = g.createLinearGradient(0, 0, 0, H)
    shade.addColorStop(0, 'rgba(6,7,12,0.55)')
    shade.addColorStop(0.5, 'rgba(6,7,12,0.3)')
    shade.addColorStop(1, 'rgba(6,7,12,0.62)')
    g.fillStyle = shade
    g.fillRect(x0, 0, W, H)
    const R = Math.max(W, H) * 0.5
    const lx = x0 + W * (0.25 + 0.04 * Math.sin(t * 0.3))
    const glow = g.createRadialGradient(lx, H * 0.25, 0, lx, H * 0.25, R)
    glow.addColorStop(0, tone(st.accent, 0, 0).replace('rgb(', 'rgba(').replace(')', ',0.22)'))
    glow.addColorStop(1, tone(st.accent, 0, 0).replace('rgb(', 'rgba(').replace(')', ',0)'))
    g.fillStyle = glow
    g.fillRect(x0, 0, W, H)
    const vg0 = g.createRadialGradient(x0 + W / 2, H / 2, H * 0.35, x0 + W / 2, H / 2, Math.hypot(W, H) * 0.65)
    vg0.addColorStop(0, 'rgba(0,0,0,0)')
    vg0.addColorStop(1, 'rgba(0,0,0,0.4)')
    g.fillStyle = vg0
    g.fillRect(x0, 0, W, H)
    return
  }
  // Two slow lights of the accent drifting in the dark, a vignette.
  const blobs: [number, number, number, string][] = [
    [0.22 + 0.03 * Math.sin(t * 0.35), 0.3 + 0.03 * Math.cos(t * 0.27), 0.55, tone(st.accent, 0, 0)],
    [0.8 + 0.03 * Math.cos(t * 0.31), 0.78 + 0.02 * Math.sin(t * 0.4), 0.5, tone(st.accent, 70, -0.08)]
  ]
  for (const [bx, by, br, col] of blobs) {
    const R = Math.max(W, H) * br
    const gr = g.createRadialGradient(x0 + W * bx, H * by, 0, x0 + W * bx, H * by, R)
    gr.addColorStop(0, col.replace('rgb(', 'rgba(').replace(')', design === 'deck' ? ',0.22)' : ',0.38)'))
    gr.addColorStop(1, col.replace('rgb(', 'rgba(').replace(')', ',0)'))
    g.fillStyle = gr
    g.fillRect(x0, 0, W, H)
  }
  if (design === 'deck') {
    const sp = g.createRadialGradient(x0 + W / 2, H * 0.55, 0, x0 + W / 2, H * 0.55, H * 0.6)
    sp.addColorStop(0, 'rgba(255,255,255,0.08)')
    sp.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = sp
    g.fillRect(x0, 0, W, H)
  }
  const vg = g.createRadialGradient(x0 + W / 2, H / 2, H * 0.35, x0 + W / 2, H / 2, Math.hypot(W, H) * 0.65)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.35)')
  g.fillStyle = vg
  g.fillRect(x0, 0, W, H)
}

/** The headline and the chapter count, top left. */
function header(c: Ctx, alpha: number, open: number, maxW = 0.7): void {
  if (alpha <= 0.01) return
  const g = c.g
  const st = c.b.style
  const x = c.x0 + c.W * (c.portrait ? 0.07 : 0.07)
  const y = c.H * (c.portrait ? 0.1 : 0.13)
  g.save()
  g.globalAlpha *= alpha
  // A small spaced-out label over it: how many chapters, which is next.
  {
    const ls = c.H * (c.portrait ? 0.016 : 0.019)
    g.font = `700 ${ls.toFixed(1)}px "Inter", "Segoe UI", sans-serif`
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(ls * 0.28).toFixed(1)}px`
    g.fillStyle = st.accent
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    g.fillText(`${c.b.items.length} CHAPTERS · NEXT ${String(open + 1).padStart(2, '0')}`, x, y - c.H * (c.portrait ? 0.045 : 0.06))
    ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
  }
  const size = text(c, c.b.title, x, y, { size: c.H * (c.portrait ? 0.04 : 0.052), family: st.font, weight: 800, color: st.ink, maxW: c.W * maxW })
  // A row of pips: seen, next, still to come.
  const n = c.b.items.length
  const pr = c.H * 0.0065
  for (let i = 0; i < n; i++) {
    g.fillStyle = i < open ? st.accent : i === open ? st.ink : 'rgba(255,255,255,0.25)'
    g.beginPath()
    const px = x + pr + i * pr * 3.4
    const py = y + size * 0.62
    if (i === open) roundRect(g, px - pr, py - pr, pr * 4.2, pr * 2, pr)
    else g.arc(px, py, pr, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

function drawTiles(c: Ctx, slots: Rect[], open: number, hide: number, appear: (i: number) => number, pressAt: number): void {
  const g = c.g
  const st = c.b.style
  const u = c.u
  // The dock: frosted glass under the row of tiles, coming up with them.
  if (slots.length) {
    const x0 = Math.min(...slots.map((r) => r.x))
    const x1 = Math.max(...slots.map((r) => r.x + r.w))
    const y0 = Math.min(...slots.map((r) => r.y))
    const y1 = Math.max(...slots.map((r) => r.y + r.h))
    const pad = slots[0].w * 0.22
    const k = appear(0)
    if (k > 0.001) {
      g.save()
      g.globalAlpha *= k
      const dr = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + slots[0].w * 0.42 }
      const rr = slots[0].w * 0.32
      g.save()
      g.shadowColor = 'rgba(0,0,0,0.35)'
      g.shadowBlur = 40 * u * c.px
      g.shadowOffsetY = 14 * u * c.px
      roundRect(g, dr.x, dr.y, dr.w, dr.h, rr)
      g.fillStyle = 'rgba(255,255,255,0.07)'
      g.fill()
      g.restore()
      const sheen = g.createLinearGradient(0, dr.y, 0, dr.y + dr.h)
      sheen.addColorStop(0, 'rgba(255,255,255,0.09)')
      sheen.addColorStop(0.35, 'rgba(255,255,255,0.02)')
      sheen.addColorStop(1, 'rgba(255,255,255,0.04)')
      g.fillStyle = sheen
      roundRect(g, dr.x, dr.y, dr.w, dr.h, rr)
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.16)'
      g.lineWidth = 1.2 * u
      g.stroke()
      g.restore()
    }
  }
  c.b.items.forEach((item, i) => {
    if (i === hide) return
    const r0 = slots[i]
    const k = appear(i)
    if (k <= 0.001) return
    const press = i === open ? Math.sin(Math.PI * prog(c.t, pressAt - 0.06, 0.2)) * 0.06 : 0
    // The next one stands a little proud of the others.
    const lift = i === open ? glide(prog(c.t, 0.2, 0.6)) * (1 - glide(prog(c.t, pressAt - 0.1, 0.2))) : 0
    const r = { ...r0, y: r0.y - lift * 10 * u }
    const s = (0.9 + 0.1 * k) * (1 - press) * (1 + 0.04 * lift)
    const R = r.w * 0.24
    g.save()
    g.globalAlpha *= k
    g.translate(r.x + r.w / 2, r.y + r.h / 2)
    g.scale(s, s)
    g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    g.save()
    g.shadowColor = i === open ? tone(st.accent, 0, 0).replace('rgb(', 'rgba(').replace(')', `,${(0.55 * lift).toFixed(3)})`) : 'rgba(0,0,0,0.45)'
    g.shadowBlur = (i === open ? 34 : 26) * u * c.px
    g.shadowOffsetY = (i === open ? 6 : 12) * u * c.px
    g.fillStyle = '#000'
    roundRect(g, r.x, r.y, r.w, r.h, R)
    g.fill()
    g.restore()
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, R)
    g.clip()
    chapterPicture(c, item, i, r)
    // Glass: a soft light across the top, a little depth at the bottom.
    const gl = g.createLinearGradient(0, r.y, 0, r.y + r.h)
    gl.addColorStop(0, 'rgba(255,255,255,0.2)')
    gl.addColorStop(0.42, 'rgba(255,255,255,0)')
    gl.addColorStop(1, 'rgba(0,0,0,0.18)')
    g.fillStyle = gl
    g.fillRect(r.x, r.y, r.w, r.h)
    if (i < open) {
      g.fillStyle = 'rgba(0,0,0,0.36)'
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    // The bezel: a hairline of light round the glass.
    g.strokeStyle = 'rgba(255,255,255,0.22)'
    g.lineWidth = 1.2 * u
    roundRect(g, r.x + 0.6 * u, r.y + 0.6 * u, r.w - 1.2 * u, r.h - 1.2 * u, R)
    g.stroke()
    if (i === open) {
      // The next one: a soft ring of the accent, breathing slowly.
      const br = 0.5 + 0.5 * Math.sin(c.t * 2.6)
      const o = 7 * u
      g.save()
      g.shadowColor = st.accent
      g.shadowBlur = 18 * u * c.px
      g.strokeStyle = st.accent
      g.globalAlpha *= 0.6 + 0.4 * br
      g.lineWidth = 2.6 * u
      roundRect(g, r.x - o, r.y - o, r.w + 2 * o, r.h + 2 * o, R + o)
      g.stroke()
      g.restore()
      // A small "next" pill over it.
      const ps = r.w * 0.085
      g.font = `800 ${ps.toFixed(1)}px "Inter", "Segoe UI", sans-serif`
      const label = 'NEXT'
      ;(g as CanvasRenderingContext2D).letterSpacing = `${(ps * 0.18).toFixed(1)}px`
      const pw = g.measureText(label).width + ps * 1.4
      const px = r.x + r.w / 2 - pw / 2
      const py = r.y - o - ps * 2.1
      g.fillStyle = st.accent
      roundRect(g, px, py, pw, ps * 1.7, ps * 0.85)
      g.fill()
      g.fillStyle = '#0b0b0d'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(label, r.x + r.w / 2 + ps * 0.09, py + ps * 0.88)
      ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
    }
    if (i < open) check(c, r.x + r.w - r.w * 0.04, r.y + r.w * 0.04, r.w * 0.12)
    text(c, item.title, r.x + r.w / 2, r.y + r.h + r.w * 0.2, { size: r.w * 0.125, weight: 700, color: st.ink, align: 'center', maxW: r.w * 1.45, alpha: i < open ? 0.55 : 1 })
    if (item.note) text(c, item.note.toUpperCase(), r.x + r.w / 2, r.y + r.h + r.w * 0.34, { size: r.w * 0.075, weight: 600, color: st.ink, align: 'center', maxW: r.w * 1.45, alpha: 0.5 })
    g.restore()
  })
}

function drawDeck(c: Ctx, slots: Rect[], f: number, open: number, hide: number, appear: (i: number) => number, pressAt: number): void {
  const g = c.g
  const st = c.b.style
  const order = c.b.items.map((_, i) => i).sort((a, b) => Math.abs(b - f) - Math.abs(a - f))
  for (const i of order) {
    if (i === hide) continue
    const d = Math.abs(i - f)
    if (d > 2.7) continue
    const item = c.b.items[i]
    const r = slots[i]
    const k = appear(i) * (1 - 0.32 * Math.min(2, d) * 0.5)
    if (k <= 0.001) continue
    const press = i === open ? Math.sin(Math.PI * prog(c.t, pressAt - 0.06, 0.2)) * 0.05 : 0
    const R = r.w * 0.07
    g.save()
    g.globalAlpha *= k
    g.translate(r.x + r.w / 2, r.y + r.h / 2)
    g.scale(1 - press, 1 - press)
    g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.55)'
    g.shadowBlur = 50 * c.u
    g.shadowOffsetY = 22 * c.u
    g.fillStyle = '#000'
    roundRect(g, r.x, r.y, r.w, r.h, R)
    g.fill()
    g.restore()
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, R)
    g.clip()
    chapterPicture(c, item, i, r)
    const sh = g.createLinearGradient(0, r.y + r.h * 0.45, 0, r.y + r.h)
    sh.addColorStop(0, 'rgba(0,0,0,0)')
    sh.addColorStop(1, 'rgba(0,0,0,0.78)')
    g.fillStyle = sh
    g.fillRect(r.x, r.y, r.w, r.h)
    // Further cards sit back in the dark.
    if (d > 0.02) {
      g.fillStyle = `rgba(0,0,0,${(0.42 * Math.min(1, d)).toFixed(3)})`
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    const pad = r.w * 0.08
    text(c, String(i + 1).padStart(2, '0'), r.x + pad, r.y + pad + r.w * 0.1, { size: r.w * 0.1, weight: 800, color: '#ffffff', alpha: 0.85 })
    if (item.note) text(c, item.note, r.x + pad, r.y + r.h - pad - r.w * 0.2, { size: r.w * 0.075, weight: 600, color: '#ffffff', alpha: 0.7, maxW: r.w - pad * 2 })
    text(c, item.title, r.x + pad, r.y + r.h - pad, { size: r.w * 0.12, family: st.font, weight: 800, color: '#ffffff', maxW: r.w - pad * 2 })
    if (i < open) check(c, r.x + r.w - pad * 1.4, r.y + pad * 1.4, r.w * 0.07)
    if (i === open && d < 0.3) {
      g.strokeStyle = st.accent
      g.lineWidth = 3.2 * c.u
      g.globalAlpha *= 1 - d / 0.3
      roundRect(g, r.x - 6 * c.u, r.y - 6 * c.u, r.w + 12 * c.u, r.h + 12 * c.u, R + 6 * c.u)
      g.stroke()
    }
    g.restore()
  }
}

/** The cinematic reel: wide frames stacked, the one in focus lit, the rest
 *  receding into the dark; a thin rail on the side shows where we are. */
function drawReel(c: Ctx, slots: Rect[], f: number, open: number, hide: number, appear: (i: number) => number, pressAt: number): void {
  const g = c.g
  const st = c.b.style
  const u = c.u
  const order = c.b.items.map((_, i) => i).sort((a, b) => Math.abs(b - f) - Math.abs(a - f))
  for (const i of order) {
    if (i === hide) continue
    const d = Math.abs(i - f)
    if (d > 2.4) continue
    const item = c.b.items[i]
    const r = slots[i]
    const k = appear(i) * (1 - 0.35 * Math.min(1.6, d) * 0.6)
    if (k <= 0.001 || r.y > c.H + r.h || r.y + r.h < -r.h) continue
    const press = i === open ? Math.sin(Math.PI * prog(c.t, pressAt - 0.06, 0.2)) * 0.035 : 0
    g.save()
    g.globalAlpha *= k
    g.translate(r.x + r.w / 2, r.y + r.h / 2)
    g.scale(1 - press, 1 - press)
    g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.7)'
    g.shadowBlur = 60 * u
    g.shadowOffsetY = 24 * u
    g.fillStyle = '#000'
    g.fillRect(r.x, r.y, r.w, r.h)
    g.restore()
    g.save()
    g.beginPath()
    g.rect(r.x, r.y, r.w, r.h)
    g.clip()
    chapterPicture(c, item, i, r)
    // A grade for the words on the left, and the dark the far frames sit in.
    const sh = g.createLinearGradient(r.x, 0, r.x + r.w * 0.75, 0)
    sh.addColorStop(0, 'rgba(0,0,0,0.72)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sh
    g.fillRect(r.x, r.y, r.w, r.h)
    if (d > 0.02) {
      g.fillStyle = `rgba(0,0,0,${(0.55 * Math.min(1, d)).toFixed(3)})`
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    // Words: a spaced-out chapter mark, the title, the note.
    const pad = r.h * 0.14
    const tx = r.x + pad
    g.save()
    g.font = `700 ${(r.h * 0.07).toFixed(1)}px "Inter", "Segoe UI", sans-serif`
    const mark = `CHAPTER ${String(i + 1).padStart(2, '0')}`
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(r.h * 0.018).toFixed(1)}px`
    g.fillStyle = st.accent
    g.textBaseline = 'alphabetic'
    g.textAlign = 'left'
    g.fillText(mark, tx, r.y + r.h * 0.38)
    g.restore()
    text(c, item.title, tx, r.y + r.h * 0.6, { size: r.h * 0.17, family: st.font, weight: 800, color: '#ffffff', maxW: r.w * 0.62 })
    if (item.note) text(c, item.note, tx, r.y + r.h * 0.76, { size: r.h * 0.075, weight: 500, color: '#ffffff', alpha: 0.72, maxW: r.w * 0.6 })
    if (i < open) check(c, r.x + r.w - pad, r.y + pad, r.h * 0.06)
    if (i === open && d < 0.3) {
      // The frame's own thin rule of the accent, as it settles in.
      g.globalAlpha *= 1 - d / 0.3
      g.fillStyle = st.accent
      g.fillRect(r.x, r.y + r.h - 3 * u, r.w, 3 * u)
    }
    g.restore()
  }
  // The rail: a tick per chapter, a lit bar at where we are.
  const n = c.b.items.length
  const rx = c.x0 + c.W * (c.portrait ? 0.955 : 0.9)
  const top = c.H * 0.3
  const bot = c.H * 0.7
  const at = (i: number): number => bot - ((bot - top) * i) / Math.max(1, n - 1)
  g.save()
  g.globalAlpha *= appear(0)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(rx - 0.75 * u, top, 1.5 * u, bot - top)
  for (let i = 0; i < n; i++) {
    g.fillStyle = i <= f + 0.01 ? st.accent : 'rgba(255,255,255,0.4)'
    g.fillRect(rx - 6 * u, at(i) - 1 * u, 12 * u, 2 * u)
  }
  g.fillStyle = st.accent
  const y = at(Math.max(0, Math.min(n - 1, f)))
  roundRect(g, rx - 3 * u, y - 14 * u, 6 * u, 28 * u, 3 * u)
  g.fill()
  g.restore()
}

function drawEditor(c: Ctx, L: ReturnType<typeof homeLayout>, f: number, open: number, appear: number, monitorImage: boolean, pressAt: number): void {
  const g = c.g
  const st = c.b.style
  const u = c.u
  if (!L.monitor || !L.play || L.rulerY === undefined || !L.playheadX) return
  g.save()
  g.globalAlpha *= appear
  // The monitor and what is under the playhead.
  const m = L.monitor
  g.fillStyle = '#050608'
  roundRect(g, m.x - 6 * u, m.y - 6 * u, m.w + 12 * u, m.h + 12 * u, 12 * u)
  g.fill()
  if (monitorImage) {
    const i0 = Math.min(c.b.items.length - 1, Math.max(0, Math.floor(f)))
    const i1 = Math.min(c.b.items.length - 1, i0 + 1)
    const fr = clamp01((f - i0 - 0.85) / 0.15)
    g.save()
    roundRect(g, m.x, m.y, m.w, m.h, 6 * u)
    g.clip()
    chapterPicture(c, c.b.items[i0], i0, m)
    if (fr > 0 && i1 !== i0) {
      g.globalAlpha *= fr
      chapterPicture(c, c.b.items[i1], i1, m)
    }
    g.restore()
  }
  // Play button.
  const p = L.play
  const press = Math.sin(Math.PI * prog(c.t, pressAt - 0.06, 0.2)) * 0.12
  const pc = { x: p.x + p.w / 2, y: p.y + p.h / 2 }
  g.save()
  g.translate(pc.x, pc.y)
  g.scale(1 - press, 1 - press)
  g.fillStyle = 'rgba(255,255,255,0.1)'
  g.beginPath()
  g.arc(0, 0, p.w / 2, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = st.ink
  g.beginPath()
  g.moveTo(-p.w * 0.14, -p.w * 0.2)
  g.lineTo(p.w * 0.22, 0)
  g.lineTo(-p.w * 0.14, p.w * 0.2)
  g.closePath()
  g.fill()
  g.restore()
  // Ruler.
  const x0r = L.playheadX(0)
  const x1r = L.playheadX(c.b.items.length)
  g.strokeStyle = 'rgba(255,255,255,0.28)'
  g.lineWidth = Math.max(1, 1.2 * u)
  g.beginPath()
  const ticks = 40
  for (let k = 0; k <= ticks; k++) {
    const x = x0r + ((x1r - x0r) * k) / ticks
    const h = k % 5 === 0 ? 12 * u : 6 * u
    g.moveTo(x, L.rulerY + 10 * u - h)
    g.lineTo(x, L.rulerY + 10 * u)
  }
  g.stroke()
  // The clips.
  c.b.items.forEach((item, i) => {
    const r = L.slots[i]
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, 8 * u)
    g.clip()
    chapterPicture(c, item, i, r)
    const sh = g.createLinearGradient(0, r.y, 0, r.y + r.h)
    sh.addColorStop(0, 'rgba(0,0,0,0.05)')
    sh.addColorStop(1, 'rgba(0,0,0,0.65)')
    g.fillStyle = sh
    g.fillRect(r.x, r.y, r.w, r.h)
    if (i < open) {
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.fillRect(r.x, r.y, r.w, r.h)
    }
    g.restore()
    g.strokeStyle = i === open ? st.accent : 'rgba(255,255,255,0.18)'
    g.lineWidth = (i === open ? 2.6 : 1.2) * u
    roundRect(g, r.x, r.y, r.w, r.h, 8 * u)
    g.stroke()
    text(c, item.title, r.x + 10 * u, r.y + r.h - 10 * u, { size: Math.min(r.h * 0.26, 22 * u), weight: 700, color: '#ffffff', maxW: r.w - 20 * u })
    if (i < open) check(c, r.x + r.w - 14 * u, r.y + 14 * u, 8 * u)
  })
  // The playhead, its handle on the ruler.
  const px = L.playheadX(f)
  g.fillStyle = st.accent
  g.fillRect(px - 1.5 * u, L.rulerY, 3 * u, L.slots[0].y + L.slots[0].h - L.rulerY + 6 * u)
  roundRect(g, px - 9 * u, L.rulerY - 14 * u, 18 * u, 18 * u, 5 * u)
  g.fill()
  g.restore()
}

// -- the whole thing --------------------------------------------------------------

export function drawHome(c: Ctx): void {
  const b = c.b
  const t = c.t
  const T = homeTimes(b)
  if (t < T.swipe[0]) return
  const design = homeDesign(b)
  const open = homeOpens(c.project, b)
  const from = open - 1
  const f = homeFocus(b, open, t)
  const L = homeLayout(b, c.x0, c.W, c.H, f)
  const g = c.g
  const full: Rect = { x: c.x0, y: 0, w: c.W, h: c.H }

  // Where the playing picture goes home to, and how round it is there.
  const home: { r: Rect; radius: number } | null =
    from < 0
      ? null
      : design === 'timeline'
        ? { r: L.monitor!, radius: 6 * c.u }
        : design === 'deck'
          ? { r: homeLayout(b, c.x0, c.W, c.H, homeFocus(b, open, T.land)).slots[from], radius: L.slots[from].w * 0.07 }
          : design === 'slider'
            ? { r: homeLayout(b, c.x0, c.W, c.H, homeFocus(b, open, T.land)).slots[from], radius: 0 }
            : { r: L.slots[from], radius: L.slots[from].w * 0.24 }
  const landed = t >= T.land
  const appear = (i: number): number => glide(prog(t, T.swipe[0] + 0.2 + 0.05 * i, 0.4))

  wallpaper(c, design)
  header(c, glide(prog(t, T.swipe[0] + 0.25, 0.4)), open, design === 'slider' && !c.portrait ? 0.15 : 0.7)
  const pressAt = T.tap
  if (design === 'apps') drawTiles(c, L.slots, open, landed ? -1 : from, appear, pressAt)
  else if (design === 'deck') drawDeck(c, L.slots, f, open, landed ? -1 : from, appear, pressAt)
  else if (design === 'slider') drawReel(c, L.slots, f, open, landed ? -1 : from, appear, pressAt)
  else drawEditor(c, L, f, open, glide(prog(t, T.swipe[0] + 0.15, 0.4)), landed, pressAt)

  // The playing picture, swiped home.
  if (t < T.land + 0.12) {
    const pS = prog(t, T.swipe[0], T.swipe[1] - T.swipe[0])
    const pF = prog(t, T.swipe[1], T.land - T.swipe[1])
    const up = homeLiveCard(c.x0, c.W, c.H, pS)
    const endR: Rect = home ? home.r : { x: c.x0 + c.W / 2 - c.W * 0.09, y: c.H * 0.46 - c.H * 0.09, w: c.W * 0.18, h: c.H * 0.18 }
    const e = glide(pF)
    const r = t < T.swipe[1] ? up : lerpRect(up, endR, e)
    const radius = lerp(0, 36 * c.u, glide(pS)) * (1 - e) + (home ? home.radius : 36 * c.u) * e
    // It becomes the chapter's own picture as it lands (or, with nowhere to
    // go, fades into the home).
    const fade = home ? 1 - glide(prog(t, T.land - 0.12, 0.2)) : 1 - glide(pF)
    if (home && t > T.land - 0.14 && design !== 'timeline') {
      g.save()
      roundRect(g, r.x, r.y, r.w, r.h, radius)
      g.clip()
      chapterPicture(c, b.items[from], from, r)
      g.restore()
    }
    liveInto(c, r, radius, fade, 1 - e * 0.6)
  }

  // The next chapter opening to fill the frame, playing already.
  if (t >= T.open) {
    const pO = prog(t, T.open, T.end - T.open)
    const src: Rect | undefined = design === 'timeline' ? L.monitor : L.slots[open]
    if (!src) return
    const srcR = design === 'timeline' ? 6 * c.u : design === 'deck' ? src.w * 0.07 : design === 'slider' ? 0 : src.w * 0.24
    const e = easeOut(pO)
    const r = lerpRect(src, full, e)
    const radius = lerp(srcR, 0, e)
    const toLive = glide(prog(pO, 0.12, 0.5))
    g.save()
    g.save()
    g.shadowColor = 'rgba(0,0,0,0.5)'
    g.shadowBlur = 40 * c.u * (1 - e)
    g.shadowOffsetY = 14 * c.u * (1 - e)
    roundRect(g, r.x, r.y, r.w, r.h, radius)
    g.fillStyle = '#000'
    g.fill()
    g.restore()
    roundRect(g, r.x, r.y, r.w, r.h, radius)
    g.clip()
    chapterPicture(c, b.items[open], open, r)
    g.restore()
    liveInto(c, r, radius, toLive, 0)
  }
}

