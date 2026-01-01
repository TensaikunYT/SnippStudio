// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A store's top chart, counted down: the list on a phone-like panel — rank,
// icon, name, kind, stars and its GET button — scrolling smoothly as each
// place comes up, and beside it that entry large: its icon, its rank, its
// name, and its button pressed (the ring fills, it says OPEN). Any
// ranking works: games, apps, films, places.

import { glide, storeLayout, storeTimes } from './model'
import { clamp01, drawCover, imageOf, outCubic, prog, roundRect, text, type Ctx } from './draw'
import { onAccent } from './extras'
import type { TemplateItem } from '../types'

type Rect = { x: number; y: number; w: number; h: number }

function mixHex(a: string, b: string, k: number): string {
  const p = (h: string): number[] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h)
    const n = m ? parseInt(m[1], 16) : 0
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const A = p(a)
  const B = p(b)
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('')
}

/** An entry's icon: its picture in a rounded square, or a colour and its
 *  first letter. */
function icon(c: Ctx, item: TemplateItem | undefined, i: number, r: Rect): void {
  const g = c.g
  const rad = r.w * 0.23
  g.save()
  roundRect(g, r.x, r.y, r.w, r.h, rad)
  g.clip()
  const img = imageOf(c, item)
  if (img) drawCover(g, img, r.x, r.y, r.w, r.h)
  else {
    const hues = ['#ff6b4a', '#4a8cff', '#2fbf71', '#b35cff', '#ffb02e', '#ff4f9a', '#1fb5c9']
    const col = hues[i % hues.length]
    const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
    gr.addColorStop(0, col)
    gr.addColorStop(1, mixHex(col, '#000000', 0.35))
    g.fillStyle = gr
    g.fillRect(r.x, r.y, r.w, r.h)
    text(c, (item?.title ?? '?').trim()[0]?.toUpperCase() ?? '?', r.x + r.w / 2, r.y + r.h * 0.68, { size: r.h * 0.5, weight: 800, color: '#ffffff', align: 'center' })
  }
  g.restore()
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = Math.max(1, r.w * 0.012)
  roundRect(g, r.x, r.y, r.w, r.h, rad)
  g.stroke()
}

function stars(c: Ctx, x: number, y: number, size: number, value: number, color: string): void {
  const g = c.g
  for (let i = 0; i < 5; i++) {
    const cx = x + i * size * 1.15 + size / 2
    const fill = clamp01(value - i)
    g.save()
    g.beginPath()
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? size * 0.22 : size * 0.5
      const an = -Math.PI / 2 + (k * Math.PI) / 5
      const px = cx + Math.cos(an) * r
      const py = y + Math.sin(an) * r
      if (k === 0) g.moveTo(px, py)
      else g.lineTo(px, py)
    }
    g.closePath()
    g.fillStyle = 'rgba(0,0,0,0.12)'
    g.fill()
    if (fill > 0) {
      g.clip()
      g.fillStyle = color
      g.fillRect(cx - size / 2, y - size / 2, size * fill, size)
    }
    g.restore()
  }
}

/** The GET button; `k` how far the download is (0..1, then OPEN). */
function getButton(c: Ctx, r: Rect, k: number, pressed: number): void {
  const g = c.g
  const st = c.b.style
  const s = 1 - 0.06 * pressed
  g.save()
  g.translate(r.x + r.w / 2, r.y + r.h / 2)
  g.scale(s, s)
  const x = -r.w / 2
  const y = -r.h / 2
  if (k > 0 && k < 1) {
    // Downloading: a ring filling round a small square.
    const R = r.h * 0.42
    g.strokeStyle = 'rgba(0,0,0,0.12)'
    g.lineWidth = r.h * 0.12
    g.beginPath()
    g.arc(0, 0, R, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = st.accent
    g.beginPath()
    g.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k)
    g.stroke()
    g.fillStyle = st.accent
    g.fillRect(-R * 0.3, -R * 0.3, R * 0.6, R * 0.6)
  } else {
    g.fillStyle = k >= 1 ? st.accent : mixHex(st.card, st.ink, 0.08)
    roundRect(g, x, y, r.w, r.h, r.h / 2)
    g.fill()
    text(c, k >= 1 ? 'OPEN' : 'GET', 0, r.h * 0.17, { size: r.h * 0.46, weight: 800, color: k >= 1 ? onAccent(c) : st.accent, align: 'center' })
  }
  g.restore()
}

export function drawStore(c: Ctx): void {
  const { g, b, t, u } = c
  const st = b.style
  const n = b.items.length
  if (!n) return
  const L = storeLayout(b, c.x0, c.W, c.H)
  const T = storeTimes(b)
  const countdown = !!b.countdown
  const rankOf = (i: number): number => i + 1
  // The order they come up in: 15 → 1 counting down, else 1 → 15.
  const order = b.items.map((_, i) => i)
  if (countdown) order.reverse()
  let cur = -1
  for (let k = 0; k < n; k++) if (t >= T.at[k] - 0.02) cur = k
  const curIdx = cur >= 0 ? order[cur] : order[0]
  // -- the list panel -------------------------------------------------------------
  const P = L.panel
  const inK = outCubic(prog(t, 0.05, 0.5))
  g.save()
  g.globalAlpha *= inK
  g.translate(0, (1 - inK) * 30 * u)
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 40 * u * c.px
  g.shadowOffsetY = 16 * u * c.px
  g.fillStyle = st.card
  roundRect(g, P.x, P.y, P.w, P.h, 28 * u)
  g.fill()
  g.restore()
  text(c, b.title || 'Top Charts', P.x + L.pad, P.y + L.head * 0.62, { size: L.head * 0.42, family: st.font, weight: 800, color: st.ink, maxW: P.w - L.pad * 2 })
  g.fillStyle = mixHex(st.card, st.ink, 0.1)
  g.fillRect(P.x + L.pad, P.y + L.head - 1, P.w - L.pad * 2, Math.max(1, u))
  // The list, scrolled so the entry up now sits in view, gliding between.
  const listTop = P.y + L.head
  const listH = P.h - L.head - L.pad * 0.5
  const scrollAt = (k: number): number => {
    const idx = order[Math.max(0, Math.min(n - 1, k))]
    const want = idx * L.rowH - listH * 0.42
    return Math.max(0, Math.min(Math.max(0, n * L.rowH - listH), want))
  }
  let scroll = scrollAt(0)
  for (let k = 1; k < n; k++) {
    const e = glide(prog(t, T.at[k] - 0.55, 0.55))
    if (e <= 0) break
    scroll = scrollAt(k - 1) + (scrollAt(k) - scrollAt(k - 1)) * e
  }
  g.save()
  g.beginPath()
  g.rect(P.x, listTop, P.w, listH)
  g.clip()
  b.items.forEach((it, i) => {
    const y = listTop + i * L.rowH - scroll
    if (y > listTop + listH || y + L.rowH < listTop) return
    const seen = order.indexOf(i) <= cur
    const isCur = i === curIdx && cur >= 0
    const hl = isCur ? clamp01((t - T.at[cur] + 0.1) / 0.3) : 0
    if (hl > 0) {
      g.fillStyle = mixHex(st.card, st.accent, 0.12 * hl)
      roundRect(g, P.x + L.pad * 0.4, y + L.rowH * 0.06, P.w - L.pad * 0.8, L.rowH * 0.88, L.rowH * 0.18)
      g.fill()
    }
    g.save()
    g.globalAlpha *= seen ? 1 : 0.35
    const rx = P.x + L.pad
    text(c, String(rankOf(i)), rx + L.rowH * 0.18, y + L.rowH * 0.6, { size: L.rowH * 0.28, weight: 800, color: isCur ? st.accent : st.ink, align: 'center' })
    const ic = { x: rx + L.rowH * 0.42, y: y + L.rowH * 0.16, w: L.rowH * 0.68, h: L.rowH * 0.68 }
    icon(c, it, i, ic)
    const tx = ic.x + ic.w + L.rowH * 0.22
    const tw = P.x + P.w - L.pad - L.rowH * 1.1 - tx
    text(c, it.title, tx, y + L.rowH * 0.44, { size: L.rowH * 0.22, weight: 700, color: st.ink, maxW: tw })
    if (it.note) text(c, it.note, tx, y + L.rowH * 0.68, { size: L.rowH * 0.17, weight: 500, color: mixHex(st.ink, st.card, 0.45), maxW: tw })
    getButton(c, { x: P.x + P.w - L.pad - L.rowH * 0.95, y: y + L.rowH * 0.34, w: L.rowH * 0.95, h: L.rowH * 0.34 }, 0, 0)
    g.restore()
  })
  g.restore()
  g.restore()
  // -- the entry up now, large --------------------------------------------------------
  if (cur < 0) return
  const it = b.items[curIdx]
  const H0 = L.hero
  const a0 = T.at[cur]
  const next = cur + 1 < n ? T.at[cur + 1] : b.duration
  const k = outCubic(prog(t, a0 - 0.05, 0.45)) * (1 - glide(prog(t, next - 0.45, 0.4)))
  if (k <= 0.01) return
  g.save()
  g.globalAlpha *= k
  g.translate((1 - k) * 40 * u, 0)
  const ic = { x: H0.x, y: H0.y, w: H0.iconSize, h: H0.iconSize }
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.4)'
  g.shadowBlur = 36 * u * c.px
  g.shadowOffsetY = 14 * u * c.px
  g.fillStyle = '#000'
  roundRect(g, ic.x, ic.y, ic.w, ic.h, ic.w * 0.23)
  g.fill()
  g.restore()
  icon(c, it, curIdx, ic)
  // The rank, big, on its own line; then the name and its kind.
  const tx = H0.x
  let y = ic.y + ic.h + H0.gap
  text(c, `#${rankOf(curIdx)}`, tx, y + H0.rankSize * 0.8, { size: H0.rankSize, family: st.font, weight: 900, color: st.accent })
  y += H0.rankSize * 1.02
  text(c, it.title, tx, y + H0.nameSize * 0.85, { size: H0.nameSize, family: st.font, weight: 800, color: c.onBg, maxW: H0.w })
  y += H0.nameSize * 1.25
  if (it.note) {
    text(c, it.note, tx, y + H0.nameSize * 0.45, { size: H0.nameSize * 0.45, weight: 500, color: c.onBg, alpha: 0.7, maxW: H0.w })
    y += H0.nameSize * 0.75
  }
  if (typeof it.value === 'number' && it.value > 0) {
    stars(c, tx, y + H0.nameSize * 0.35, H0.nameSize * 0.42, Math.min(5, it.value), '#ffc83d')
    text(c, it.value.toFixed(1), tx + H0.nameSize * 0.42 * 5.9, y + H0.nameSize * 0.5, { size: H0.nameSize * 0.38, weight: 700, color: c.onBg, alpha: 0.85 })
    y += H0.nameSize * 0.8
  }
  // The button pressed: a ring filling, then OPEN.
  const btn = L.button(cur)
  const tp = T.at[cur] + T.press
  const dl = clamp01((t - tp - 0.1) / 0.9)
  const pressed = Math.sin(Math.PI * clamp01((t - tp + 0.04) / 0.16))
  getButton(c, btn, t < tp ? 0 : dl >= 1 ? 1 : Math.max(0.02, dl), pressed)
  g.restore()
}
