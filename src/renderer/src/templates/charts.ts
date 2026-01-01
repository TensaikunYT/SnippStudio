// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Charts, in the templates' own style: a bar chart whose bars rise to their
// values, a donut whose slices open one by one, and a line that grows
// through time, a dot riding its head. Numbers count
// up, the leader wears the accent, the rest sit back; set on the video
// (clear, dimmed or blurred), on paper, or on a card of their own.

import { barLift, barsLayout, barsMax, chartTimes, glide, lineLayout, lineStretch, pieLayout, piePull, PIE_PULL, type ChartLayout } from './model'
import { clamp01, fontOf, fmtNum, headline, inOutCubic, outBack, outCubic, outExpo, prog, roundRect, text, type Ctx } from './draw'

const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3

/** A colour mixed toward another (hex in, rgb out). */
function mix(a: string, b: string, k: number): string {
  const p = (h: string): number[] => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h)
    const n = m ? parseInt(m[1], 16) : 0x888888
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const x = p(a)
  const y = p(b)
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`
}

/** The chart's own card, when the backdrop is 'card'. */
function panel(c: Ctx, L: ChartLayout): void {
  if (c.b.style.backdrop !== 'card') return
  const g = c.g
  const u = c.u
  const r = { x: L.panel.x, y: L.panel.y, w: L.panel.w, h: L.panel.h }
  const k = outCubic(prog(c.t, 0, 0.4))
  g.save()
  g.globalAlpha *= k
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowOffsetX = 8 * u
  g.shadowOffsetY = 12 * u
  g.fillStyle = c.b.style.ink
  roundRect(g, r.x - 6 * u, r.y - 6 * u, r.w + 12 * u, r.h + 12 * u, 26 * u)
  g.fill()
  g.shadowColor = 'transparent'
  g.fillStyle = c.b.style.card
  roundRect(g, r.x, r.y, r.w, r.h, 22 * u)
  g.fill()
  g.restore()
}

/** Faint value lines behind a chart, with their numbers at the left. */
function grid(c: Ctx, L: ChartLayout, max: number, min = 0, unit = ''): void {
  const g = c.g
  const u = c.u
  const k = outCubic(prog(c.t, 0.15, 0.5))
  if (k <= 0) return
  const steps = 4
  g.save()
  g.globalAlpha *= k
  for (let i = 0; i <= steps; i++) {
    const v = min + ((max - min) * i) / steps
    const y = L.base - ((v - min) / Math.max(1e-9, max - min)) * L.height
    g.fillStyle = c.onBg
    g.globalAlpha = k * (i === 0 ? 0.5 : 0.12)
    g.fillRect(L.left, y - (i === 0 ? 1.5 : 0.75) * u, L.width, (i === 0 ? 3 : 1.5) * u)
    g.globalAlpha = k * 0.5
    if (i > 0) text(c, `${fmtNum(v, Number.isInteger(v) ? 1 : 0.5)}${unit}`, L.left - 12 * u, y + 8 * u, { size: 22 * u, weight: 600, color: c.onBg, align: 'right' })
  }
  g.restore()
}

// -- bars ---------------------------------------------------------------------

export function drawBars(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = barsLayout(b, c.x0, c.W, c.H)
  const T = chartTimes(b)
  panel(c, L)
  headline(c)
  const vals = b.items.map((it) => it.value ?? 0)
  const max = barsMax(b)
  const unit = b.items[0]?.note ?? ''
  grid(c, L, max, 0, unit)
  const lead = vals.indexOf(Math.max(...vals))
  const lift = barLift(b)
  b.items.forEach((it, i) => {
    const v = it.value ?? 0
    const bar = L.bars[i]
    // Rising: the same glide over the same moment.
    const k = glide(prog(c.t, T.at[i], lift))
    const h = (v / max) * L.height * k
    const x = bar.x
    const w = bar.w
    const y = L.base - h
    const r = Math.min(w * 0.2, 16 * u)
    const col = i === lead ? st.accent : mix(st.accent, c.onBg === '#ffffff' ? '#ffffff' : '#ffffff', 0.45)
    if (h > 0.5) {
      g.save()
      // A hard sticker shadow, the ink line, then the fill.
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.beginPath()
      g.roundRect(x + 6 * u, y + 8 * u, w, h - 8 * u > 0 ? h - 8 * u : 0.1, [r, r, 0, 0])
      g.fill()
      g.fillStyle = st.ink
      g.beginPath()
      g.roundRect(x - 3 * u, y - 3 * u, w + 6 * u, h + 3 * u, [r + 3 * u, r + 3 * u, 0, 0])
      g.fill()
      g.fillStyle = col
      g.beginPath()
      g.roundRect(x, y, w, h, [r, r, 0, 0])
      g.fill()
      // A light down its left edge.
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.fillRect(x + w * 0.12, y + r, w * 0.08, Math.max(0, h - r - 6 * u))
      g.restore()
    }
    // Its number above it, counting up; its name under the line.
    const ka = clamp01(prog(c.t, T.at[i] + 0.1, 0.3))
    if (ka > 0) {
      const size = Math.min(58 * u, w * 0.42)
      text(c, `${fmtNum(v * k, v)}${unit}`, x + w / 2, y - 14 * u, { size, family: st.font, color: i === lead ? st.accent : c.onBg, align: 'center', alpha: ka })
      text(c, it.title, x + w / 2, L.base + 38 * u, { size: Math.min(28 * u, w * 0.3), weight: 700, color: c.onBg, align: 'center', alpha: ka, maxW: w * 1.4 })
    }
  })
}

// -- pie ----------------------------------------------------------------------

export function drawPie(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = pieLayout(b, c.x0, c.W, c.H)
  const T = chartTimes(b)
  panel(c, L)
  headline(c)
  const vals = b.items.map((it) => Math.max(0, it.value ?? 0))
  const total = Math.max(1e-9, vals.reduce((a, v) => a + v, 0))
  const { cx, cy, R } = L.pie!
  const r0 = R * 0.58
  const colors = b.items.map((_, i) => (i === 0 ? st.accent : mix(st.accent, i % 2 ? '#1b1d24' : '#ffffff', 0.25 + 0.18 * i)))
  const pull = piePull(b)
  let acc = -Math.PI / 2
  let shown = -1
  b.items.forEach((it, i) => {
    const frac = vals[i] / total
    const a0 = acc
    const a1 = acc + frac * Math.PI * 2
    acc = a1
    const k = easeOut(prog(c.t, T.at[i], 0.65))
    if (k <= 0) return
    shown = i
    const tap = T.at[i] + 0.45
    // Tapped, it steps out along its middle and eases most of the way back;
    // the biggest is then pinched and drawn right out, and stays out.
    const pulled = pull && pull.index === i ? inOutCubic(clamp01((c.t - pull.at) / pull.dur)) : 0
    const pop = (c.t < tap ? 0 : Math.exp(-(c.t - tap) / 0.35) * 0.05 + 0.02 * clamp01((c.t - tap) / 0.2)) + PIE_PULL * pulled
    const mid = (a0 + a1) / 2
    const ox = Math.cos(mid) * R * pop
    const oy = Math.sin(mid) * R * pop
    const end = a0 + (a1 - a0) * k
    g.save()
    g.translate(ox, oy)
    g.beginPath()
    g.arc(cx, cy, R, a0, end)
    g.arc(cx, cy, r0, end, a0, true)
    g.closePath()
    g.fillStyle = `rgba(0,0,0,${(0.3 + 0.08 * pulled).toFixed(3)})`
    g.save()
    g.translate((6 + 10 * pulled) * u, (8 + 14 * pulled) * u)
    g.fill()
    g.restore()
    g.fillStyle = colors[i]
    g.fill()
    g.strokeStyle = st.ink
    g.lineWidth = 4 * u
    g.lineJoin = 'round'
    g.stroke()
    g.restore()
  })
  // The middle: the slice just tapped (its share, counting), or the one
  // drawn out.
  if (pull && c.t >= pull.at) shown = pull.index
  if (shown >= 0) {
    const it = b.items[shown]
    const share = (vals[shown] / total) * 100
    const kc = outExpo(prog(c.t, T.at[shown] + 0.2, 0.6))
    const size = r0 * 0.62
    text(c, `${Math.round(share * kc)}%`, cx, cy + size * 0.2, { size, family: st.font, color: c.onBg, align: 'center' })
    text(c, it.title, cx, cy + size * 0.75, { size: size * 0.3, weight: 700, color: c.onBg, align: 'center', alpha: 0.8, maxW: r0 * 1.6 })
  }
  // The legend.
  b.items.forEach((it, i) => {
    const k = outBack(prog(c.t, T.at[i] + 0.1, 0.4))
    if (k <= 0) return
    const row = L.legend![i]
    g.save()
    g.globalAlpha *= clamp01(k)
    g.translate((1 - k) * -20 * u, 0)
    g.fillStyle = st.ink
    roundRect(g, row.x - 3 * u, row.y - 3 * u, 30 * u, 30 * u, 8 * u)
    g.fill()
    g.fillStyle = colors[i]
    roundRect(g, row.x, row.y, 24 * u, 24 * u, 6 * u)
    g.fill()
    text(c, it.title, row.x + 42 * u, row.y + 23 * u, { size: 36 * u, weight: 700, color: c.onBg, maxW: row.w - 150 * u })
    text(c, `${Math.round((vals[i] / total) * 100)}%`, row.x + row.w, row.y + 23 * u, { size: 36 * u, family: st.font, color: i === 0 ? st.accent : c.onBg, align: 'right' })
    g.restore()
  })
}

// -- line ---------------------------------------------------------------------

export function drawLine(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = lineLayout(b, c.x0, c.W, c.H)
  const T = chartTimes(b)
  panel(c, L)
  headline(c)
  const n = b.items.length
  const pts = L.points!
  const pts2 = L.points2
  grid(c, L, L.max!, L.min!, b.items[0]?.note ?? '')
  // How far the line has grown: point i is reached at its time.
  let f = 0
  for (let i = 0; i < n; i++) {
    if (c.t >= T.at[i]) f = i
    // Drawn by the pen: the same glide over the same stretch.
    if (i + 1 < n && c.t > T.at[i] && c.t < T.at[i + 1]) f = i + glide((c.t - T.at[i]) / lineStretch(T.at, i))
  }
  if (c.t < T.at[0]) return
  const headOf = (P: [number, number][], ff: number): [number, number] => {
    const i = Math.min(n - 1, Math.floor(ff))
    const k = ff - i
    const a = P[i]
    const q = P[Math.min(n - 1, i + 1)]
    return [a[0] + (q[0] - a[0]) * k, a[1] + (q[1] - a[1]) * k]
  }
  const path = (P: [number, number][], ff: number): void => {
    g.beginPath()
    g.moveTo(P[0][0], P[0][1])
    for (let i = 1; i <= Math.floor(ff); i++) g.lineTo(P[i][0], P[i][1])
    const h = headOf(P, ff)
    g.lineTo(h[0], h[1])
  }
  // The second line, quieter, dashed.
  if (pts2) {
    g.save()
    g.strokeStyle = c.onBg
    g.globalAlpha *= 0.55
    g.lineWidth = 5 * u
    g.setLineDash([14 * u, 10 * u])
    g.lineCap = 'round'
    g.lineJoin = 'round'
    path(pts2, f)
    g.stroke()
    g.restore()
  }
  // The area under the main line, then the line in ink and accent.
  const head = headOf(pts, f)
  g.save()
  path(pts, f)
  g.lineTo(head[0], L.base)
  g.lineTo(pts[0][0], L.base)
  g.closePath()
  const area = g.createLinearGradient(0, L.base - L.height, 0, L.base)
  area.addColorStop(0, mix(st.accent, st.accent, 0).replace('rgb(', 'rgba(').replace(')', ',0.35)'))
  area.addColorStop(1, mix(st.accent, st.accent, 0).replace('rgb(', 'rgba(').replace(')', ',0)'))
  g.fillStyle = area
  g.fill()
  g.lineCap = 'round'
  g.lineJoin = 'round'
  path(pts, f)
  g.strokeStyle = st.ink
  g.lineWidth = 12 * u
  g.stroke()
  g.strokeStyle = st.accent
  g.lineWidth = 7 * u
  g.stroke()
  g.restore()
  // The points reached, their labels along the bottom.
  for (let i = 0; i < n; i++) {
    if (i > f + 1e-6) break
    const ka = clamp01((c.t - T.at[i]) / 0.25)
    g.fillStyle = st.ink
    g.beginPath()
    g.arc(pts[i][0], pts[i][1], 9 * u, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = c.onBg === '#ffffff' ? '#ffffff' : st.card
    g.beginPath()
    g.arc(pts[i][0], pts[i][1], 5 * u, 0, Math.PI * 2)
    g.fill()
    text(c, b.items[i].title, pts[i][0], L.base + 38 * u, { size: 24 * u, weight: 700, color: c.onBg, align: 'center', alpha: ka })
  }
  // The head: a bright dot and its value on a tag.
  const i0 = Math.min(n - 1, Math.floor(f))
  const v0 = b.items[i0].value ?? 0
  const v1 = b.items[Math.min(n - 1, i0 + 1)].value ?? 0
  const v = v0 + (v1 - v0) * (f - i0)
  g.save()
  g.fillStyle = st.accent
  g.shadowColor = st.accent
  g.shadowBlur = 20 * u
  g.beginPath()
  g.arc(head[0], head[1], 13 * u, 0, Math.PI * 2)
  g.fill()
  g.restore()
  const label = `${fmtNum(v, v1)}${b.items[0]?.note ?? ''}`
  g.font = fontOf(34 * u, st.font)
  const tw = g.measureText(label).width + 28 * u
  const tx = Math.min(L.left + L.width - tw, Math.max(L.left, head[0] - tw / 2))
  const ty = head[1] - 76 * u
  g.fillStyle = st.ink
  roundRect(g, tx - 4 * u, ty - 4 * u, tw + 8 * u, 56 * u, 14 * u)
  g.fill()
  g.fillStyle = st.accent
  roundRect(g, tx, ty, tw, 48 * u, 11 * u)
  g.fill()
  text(c, label, tx + tw / 2, ty + 36 * u, { size: 34 * u, family: st.font, color: st.ink, align: 'center' })
}
