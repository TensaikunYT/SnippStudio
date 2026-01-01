// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Chapters as a revolver: the video sinks back into a soft, dark blur; on one
// side a drum of the chapters' pictures — a revolver's cylinder, its faces
// curving away above and below — clicks round one chamber at a time, tak,
// tak, to the chapter it brings in; on the other the chapter lines stack up
// the way Big words' Stack does, each new one snapping up from below onto a
// slab of the accent, the older ones pushed up and fading. Then the picture
// in the drum's sight opens out to the full frame and becomes the footage.

import { glide, homeOpens, revolverLayout, revolverTimes } from './model'
import { clamp01, drawCover, fontOf, imageOf, outCubic, prog, roundRect, type Ctx } from './draw'
import { onAccent } from './extras'
import type { TemplateItem } from '../types'

type Rect = { x: number; y: number; w: number; h: number }
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX']
const numberOf = (i: number, roman: boolean): string => (roman ? ROMAN[i] ?? String(i + 1) : String(i + 1).padStart(2, '0'))

/** How far one click has turned (0 → 1): quick, then a hair of settle. */
function snap(t: number, at: number, dur: number): number {
  const u = clamp01((t - at) / dur)
  return outCubic(u)
}

function picture(c: Ctx, item: TemplateItem | undefined, i: number, r: Rect): void {
  const g = c.g
  const img = imageOf(c, item)
  if (img) {
    drawCover(g, img, r.x, r.y, r.w, r.h)
    return
  }
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
  gr.addColorStop(0, i % 2 ? '#2b3445' : '#3a2f2a')
  gr.addColorStop(1, '#0e0f13')
  g.fillStyle = gr
  g.fillRect(r.x, r.y, r.w, r.h)
}

export function drawRevolver(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const st = b.style
  const n = b.items.length
  if (!n) return
  const open = Math.min(n - 1, Math.max(0, homeOpens(c.project, b)))
  const T = revolverTimes(b, open)
  const L = revolverLayout(b, x0, W, H)
  const roman = !!b.rev?.roman
  const sink = glide(prog(t, 0, T.sink))
  const out = glide(prog(t, T.open, T.end - T.open))
  const steps = T.clicks.length
  // Where the drum is, in chapters: one more with each click.
  let pos = T.first - 1
  let kick = 0
  T.clicks.forEach((at, k) => {
    const last = k === steps - 1
    pos += snap(t, at, last ? 0.3 : 0.18)
    // Each click gives the drum a small jolt.
    const d = t - at - (last ? 0.3 : 0.18)
    if (d > -0.02 && d < 0.3) kick += Math.exp(-Math.max(0, d) / 0.06) * Math.sin(Math.max(0, d) * 70) * (last ? 1 : 0.6)
  })
  const clicked = T.clicks.filter((at) => t >= at).length
  const show = clamp01((t - T.sink * 0.6) / 0.35) * (1 - clamp01((t - T.open) / 0.3))

  // The room: the video sunk back into a soft, dark blur.
  if (c.live) {
    g.save()
    g.filter = `blur(${(38 * u * c.px * sink).toFixed(1)}px) brightness(${(1 - 0.5 * sink).toFixed(3)}) saturate(${(1 + 0.15 * sink).toFixed(3)})`
    const k = 1 + 0.06 * sink
    g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, x0 + (W - W * k) / 2, (H - H * k) / 2, W * k, H * k)
    g.filter = 'none'
    g.restore()
  } else {
    g.fillStyle = '#08080b'
    g.fillRect(x0, 0, W, H)
  }
  if (sink > 0) {
    const vg = g.createRadialGradient(x0 + W / 2, H / 2, H * 0.25, x0 + W / 2, H / 2, Math.hypot(W, H) * 0.62)
    vg.addColorStop(0, `rgba(4,4,7,${(0.25 * sink).toFixed(3)})`)
    vg.addColorStop(1, `rgba(4,4,7,${(0.78 * sink).toFixed(3)})`)
    g.fillStyle = vg
    g.fillRect(x0, 0, W, H)
  }

  // The drum.
  const D = L.drum
  if (D && show > 0.001) {
    const N = D.chambers
    const step = (Math.PI * 2) / N
    const faces: { j: number; th: number; cz: number }[] = []
    for (let j = Math.floor(pos) - 3; j <= Math.ceil(pos) + 3; j++) {
      const th = (j - pos) * step
      const cz = Math.cos(th)
      if (cz > 0.08) faces.push({ j, th, cz })
    }
    faces.sort((p, q) => p.cz - q.cz)
    g.save()
    g.globalAlpha *= show
    g.translate(0, kick * 2.2 * u)
    // The cylinder's shadow on the room.
    const sh = g.createRadialGradient(D.cx, D.cy, D.fw * 0.2, D.cx, D.cy, D.fw * 0.95)
    sh.addColorStop(0, 'rgba(0,0,0,0.5)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = sh
    g.fillRect(D.cx - D.fw, D.cy - D.R * 1.6, D.fw * 2, D.R * 3.2)
    // The cylinder itself: dark gunmetal, round — its light a band across
    // the middle, its top and bottom turning away into the dark — with a
    // rail down each side.
    {
      const bw = D.fw * 1.1
      const bh = D.R * 2.24
      const bx = D.cx - bw / 2
      const by = D.cy - D.R * 1.12
      const body = g.createLinearGradient(0, by, 0, by + bh)
      body.addColorStop(0, '#050506')
      body.addColorStop(0.3, '#17181c')
      body.addColorStop(0.47, '#2a2c33')
      body.addColorStop(0.53, '#22242a')
      body.addColorStop(0.7, '#141519')
      body.addColorStop(1, '#040405')
      g.fillStyle = body
      roundRect(g, bx, by, bw, bh, D.fh * 0.12)
      g.fill()
      for (const sx of [bx, bx + bw - D.fw * 0.03]) {
        const rail = g.createLinearGradient(sx, 0, sx + D.fw * 0.03, 0)
        rail.addColorStop(0, 'rgba(255,255,255,0.03)')
        rail.addColorStop(0.5, 'rgba(255,255,255,0.12)')
        rail.addColorStop(1, 'rgba(255,255,255,0.02)')
        g.fillStyle = rail
        g.fillRect(sx, by + D.fh * 0.12, D.fw * 0.03, bh - D.fh * 0.24)
      }
    }
    for (const f of faces) {
      const y = D.cy + D.R * Math.sin(f.th)
      const h = D.fh * f.cz
      const w = D.fw * (0.9 + 0.1 * f.cz)
      const r: Rect = { x: D.cx - w / 2, y: y - h / 2, w, h }
      const rad = D.fh * 0.06
      g.save()
      roundRect(g, r.x, r.y, r.w, r.h, rad)
      g.clip()
      if (f.j >= 0 && f.j < n) picture(c, b.items[f.j], f.j, r)
      else {
        g.fillStyle = '#121318'
        g.fillRect(r.x, r.y, r.w, r.h)
      }
      // Curving away: darker, and lit from above.
      const curve = g.createLinearGradient(0, r.y, 0, r.y + r.h)
      const away = 1 - f.cz
      curve.addColorStop(0, `rgba(255,255,255,${(f.th < 0 ? 0.04 : 0.1 * f.cz).toFixed(3)})`)
      curve.addColorStop(0.5, `rgba(0,0,0,${(0.15 + 0.6 * away).toFixed(3)})`)
      curve.addColorStop(1, `rgba(0,0,0,${(0.35 + 0.5 * away).toFixed(3)})`)
      g.fillStyle = curve
      g.fillRect(r.x, r.y, r.w, r.h)
      // The chamber's number on its face.
      if (f.j >= 0 && f.j < n) {
        const ns = D.fh * 0.13 * f.cz
        g.font = fontOf(ns, st.font, 800)
        g.textAlign = 'left'
        g.textBaseline = 'top'
        g.fillStyle = `rgba(255,255,255,${(0.85 * f.cz).toFixed(3)})`
        g.fillText(numberOf(f.j, roman), r.x + D.fw * 0.035, r.y + D.fh * 0.05 * f.cz)
      }
      g.restore()
      // The face's edge: a hairline, brighter for the one in the sight.
      g.strokeStyle = `rgba(255,255,255,${(0.08 + 0.18 * f.cz * f.cz).toFixed(3)})`
      g.lineWidth = 1.2 * u
      roundRect(g, r.x, r.y, r.w, r.h, rad)
      g.stroke()
    }
    // The sight: a thin accent frame round the face in the middle, and a
    // small notch beside it.
    const lit = clamp01(clicked / Math.max(1, steps))
    g.strokeStyle = st.accent
    g.lineWidth = 2.4 * u
    g.globalAlpha *= 0.5 + 0.5 * lit
    const sw = D.fw + 14 * u
    const shh = D.fh + 14 * u
    roundRect(g, D.cx - sw / 2, D.cy - shh / 2, sw, shh, D.fh * 0.08)
    g.stroke()
    const nx = D.cx - sw / 2 - 14 * u
    g.fillStyle = st.accent
    g.beginPath()
    g.moveTo(nx, D.cy - 9 * u)
    g.lineTo(nx + 11 * u, D.cy)
    g.lineTo(nx, D.cy + 9 * u)
    g.closePath()
    g.fill()
    g.restore()
  }

  // The stack of chapter lines.
  if (show > 0.001 && clicked > 0) {
    const S = L.stack
    const lh = S.size * 1.32
    const k = clicked - 1
    const at = T.clicks[k]
    const arrive = outCubic(clamp01((t - at + 0.02) / 0.22))
    g.save()
    g.globalAlpha *= show
    // Nothing shows below the newest line: it comes up out of it.
    g.beginPath()
    g.rect(x0, 0, W, S.y + lh * 0.6)
    g.clip()
    const fades = [1, 0.42, 0.22, 0.1, 0]
    for (let i = Math.max(0, k - 4); i <= k; i++) {
      const ch = T.first + i
      const posI = k - i - (1 - arrive)
      const f = posI <= 0 ? 1 : fades[Math.min(4, Math.floor(posI))] + (fades[Math.min(4, Math.floor(posI) + 1)] - fades[Math.min(4, Math.floor(posI))]) * (posI - Math.floor(posI))
      if (f <= 0.01) continue
      const y = S.y - posI * lh
      const item = b.items[ch]
      const num = numberOf(ch, roman)
      const newest = i === k
      g.save()
      g.globalAlpha *= f
      g.font = fontOf(S.size, st.font, 800)
      g.textBaseline = 'middle'
      g.textAlign = 'left'
      const numW = g.measureText(roman ? 'XVIII' : '00').width
      const title = item?.title ?? ''
      const tw = Math.min(S.w - numW - S.size * 0.9, g.measureText(title).width)
      if (newest && ch === open) {
        // The chapter it brings in: on a slab of the accent, wiped in.
        const wipe = outCubic(clamp01((t - at - 0.04) / 0.3))
        g.fillStyle = st.accent
        roundRect(g, S.x - S.size * 0.25, y - S.size * 0.62, (numW + tw + S.size * 1.1) * wipe, S.size * 1.24, S.size * 0.12)
        g.fill()
        g.fillStyle = wipe > 0.4 ? onAccent(c) : st.ink
      } else g.fillStyle = st.ink
      g.globalAlpha *= newest ? 1 : 0.9
      g.fillText(num, S.x, y + S.size * 0.04)
      g.fillText(title, S.x + numW + S.size * 0.55, y + S.size * 0.04, S.w - numW - S.size * 0.9)
      g.restore()
    }
    g.restore()
    // Its line, under the landed chapter.
    const item = b.items[open]
    if (item?.note && clicked === steps) {
      const nk = outCubic(clamp01((t - T.clicks[steps - 1] - 0.2) / 0.4))
      g.save()
      g.globalAlpha *= show * nk
      g.font = fontOf(S.size * 0.4, 'Inter', 500)
      g.fillStyle = st.ink
      g.globalAlpha *= 0.75
      g.textAlign = 'left'
      g.textBaseline = 'top'
      g.fillText(item.note, S.x, S.y + S.size * 0.95 + (1 - nk) * 8 * u, S.w)
      g.restore()
    }
    // The headline word over it all, small and spaced (CHAPTER).
    g.save()
    g.globalAlpha *= show * 0.85
    const ls = S.size * 0.28
    g.font = `700 ${ls.toFixed(1)}px "Inter", "Segoe UI", sans-serif`
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(ls * 0.35).toFixed(1)}px`
    g.fillStyle = st.accent
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    g.fillText(`${(b.title || 'CHAPTER').toUpperCase()} ${numberOf(open, roman)} / ${numberOf(n - 1, roman)}`, S.x, S.y - lh * Math.min(3, Math.max(0, k - 1 + arrive)) - S.size * 1.1)
    ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
    g.restore()
  }

  // The picture in the sight opens out to the full frame and is the footage.
  if (out > 0) {
    const from: Rect = D ? { x: D.cx - D.fw / 2, y: D.cy - D.fh / 2, w: D.fw, h: D.fh } : { x: x0 + W * 0.3, y: H * 0.3, w: W * 0.4, h: H * 0.4 }
    const r: Rect = { x: lerp(from.x, x0, out), y: lerp(from.y, 0, out), w: lerp(from.w, W, out), h: lerp(from.h, H, out) }
    g.save()
    roundRect(g, r.x, r.y, r.w, r.h, (D ? D.fh * 0.06 : 12 * u) * (1 - out))
    g.clip()
    picture(c, b.items[open], open, r)
    const toLive = clamp01((t - (T.end - 0.4)) / 0.35)
    if (toLive > 0 && c.live) {
      g.globalAlpha *= toLive
      g.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, x0, 0, W, H)
    }
    g.restore()
  }
}
