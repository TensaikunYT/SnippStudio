// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A video player over the picture: the video pauses (the
// big icon, the controls staying up), double-taps a side to skip, opens the
// settings for the speed or the quality — the picture going soft and then
// blocky as it drops to 144p — and turns the captions on. The picture is the
// live one underneath, so the player comes and goes without a cut.

import { MENU_STEPS, menuRect, menuRowAt, menuRows, playerEvents, playerLayout, playerState, QUALITIES, SPEEDS, type PlayerEvent, type PlayerLayout } from './player-plan'
import { clamp01, fontOf, outCubic, roundRect, text, type Ctx } from './draw'
import { projectDuration } from '../types'

type G = Ctx['g']
type Surface = HTMLCanvasElement | OffscreenCanvas

let small: Surface | null = null
function scratch(w: number, h: number): Surface {
  if (!small) small = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')
  if (small.width !== w || small.height !== h) {
    small.width = w
    small.height = h
  }
  return small
}

const fmt = (s: number): string => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = Math.floor(s % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** The picture at a lower quality: fewer lines, soft at 480p and 360p,
 *  blocky from 240p down. */
function degraded(c: Ctx, quality: string, k: number): void {
  if (!c.live || k <= 0) return
  const lines = parseInt(quality, 10) || 1080
  if (lines >= 720) return
  const g = c.g
  const rows = Math.max(24, Math.round(lines * (c.H / 1080)))
  const cols = Math.max(24, Math.round((rows * c.W) / c.H))
  const cv = scratch(cols, rows)
  const sg = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  sg.imageSmoothingEnabled = true
  sg.clearRect(0, 0, cols, rows)
  sg.drawImage(c.live, c.x0 * c.px, 0, c.W * c.px, c.H * c.px, 0, 0, cols, rows)
  g.save()
  g.globalAlpha *= k
  g.imageSmoothingEnabled = lines > 300
  g.drawImage(cv as CanvasImageSource, c.x0, 0, c.W, c.H)
  g.restore()
}

/** Play (a rounded triangle) or pause (two rounded bars), the way YouTube
 *  draws them now. */
function playIcon(g: G, x: number, y: number, s: number, paused: boolean): void {
  g.save()
  g.lineJoin = 'round'
  g.lineCap = 'round'
  if (paused) {
    const r = s * 0.07
    g.lineWidth = r * 2
    g.strokeStyle = g.fillStyle
    g.beginPath()
    g.moveTo(x - s * 0.28, y - s * 0.38)
    g.lineTo(x + s * 0.4, y)
    g.lineTo(x - s * 0.28, y + s * 0.38)
    g.closePath()
    g.fill()
    g.stroke()
  } else {
    roundRect(g, x - s * 0.3, y - s * 0.38, s * 0.2, s * 0.76, s * 0.06)
    g.fill()
    roundRect(g, x + s * 0.1, y - s * 0.38, s * 0.2, s * 0.76, s * 0.06)
    g.fill()
  }
  g.restore()
}

function controls(c: Ctx, L: PlayerLayout, st: ReturnType<typeof playerState>, a: number, total: number): void {
  const g = c.g
  const u = c.u
  g.save()
  g.globalAlpha *= a
  // The shade the controls sit on: light, only along the bottom.
  const sh = g.createLinearGradient(0, L.bar.y - 110 * u, 0, c.H)
  sh.addColorStop(0, 'rgba(0,0,0,0)')
  sh.addColorStop(1, 'rgba(0,0,0,0.6)')
  g.fillStyle = sh
  g.fillRect(c.x0, L.bar.y - 110 * u, c.W, c.H - L.bar.y + 110 * u)
  // The progress line: thin, grey, what is loaded a lighter grey, what is
  // played red, and the red dot at its head.
  const f = Math.min(1, st.pos / total)
  const w = L.bar.x1 - L.bar.x0
  const lh = 3.2 * u
  g.fillStyle = 'rgba(255,255,255,0.22)'
  g.fillRect(L.bar.x0, L.bar.y - lh / 2, w, lh)
  g.fillStyle = 'rgba(255,255,255,0.4)'
  g.fillRect(L.bar.x0, L.bar.y - lh / 2, w * Math.min(1, f + 0.004), lh)
  g.fillStyle = '#ff0033'
  g.fillRect(L.bar.x0, L.bar.y - lh / 2, w * f, lh)
  g.beginPath()
  g.arc(L.bar.x0 + w * f, L.bar.y, 6.5 * u, 0, Math.PI * 2)
  g.fill()
  const s = L.icon
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  playIcon(g, L.play[0], L.play[1], s, st.paused)
  // Volume: a rounded speaker and two waves.
  const vx = L.volume[0]
  const vy = L.volume[1]
  g.save()
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(vx - s * 0.4, vy - s * 0.13)
  g.lineTo(vx - s * 0.2, vy - s * 0.13)
  g.lineTo(vx + s * 0.02, vy - s * 0.34)
  g.lineTo(vx + s * 0.02, vy + s * 0.34)
  g.lineTo(vx - s * 0.2, vy + s * 0.13)
  g.lineTo(vx - s * 0.4, vy + s * 0.13)
  g.closePath()
  g.fill()
  g.lineWidth = 2.4 * u
  g.lineCap = 'round'
  for (const r of [0.18, 0.33]) {
    g.beginPath()
    g.arc(vx + s * 0.06, vy, s * r, -0.85, 0.85)
    g.stroke()
  }
  g.restore()
  // The time.
  text(c, `${fmt(st.pos)} / ${fmt(total)}`, vx + s * 0.95, L.row + 6 * u, { size: 17 * u, weight: 600, color: '#ffffff' })
  // Autoplay: a pill switch, the knob on the right with a little play in it.
  {
    const [ax, ay] = L.autoplay
    const pw = s * 1.15
    const ph = s * 0.42
    g.fillStyle = 'rgba(255,255,255,0.75)'
    roundRect(g, ax - pw / 2, ay - ph / 2, pw, ph, ph / 2)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(ax + pw / 2 - ph * 0.45, ay, ph * 0.72, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#0f0f0f'
    g.beginPath()
    const kx = ax + pw / 2 - ph * 0.45
    g.moveTo(kx - ph * 0.18, ay - ph * 0.26)
    g.lineTo(kx + ph * 0.28, ay)
    g.lineTo(kx - ph * 0.18, ay + ph * 0.26)
    g.closePath()
    g.fill()
    g.fillStyle = '#ffffff'
  }
  // Captions: a rounded box with two short lines in it; underlined red when on.
  {
    const [cx, cy] = L.cc
    g.lineWidth = 2.2 * u
    g.strokeStyle = st.cc ? '#ffffff' : 'rgba(255,255,255,0.6)'
    roundRect(g, cx - s * 0.42, cy - s * 0.3, s * 0.84, s * 0.6, 4 * u)
    g.stroke()
    g.fillStyle = st.cc ? '#ffffff' : 'rgba(255,255,255,0.6)'
    g.fillRect(cx - s * 0.26, cy + s * 0.02, s * 0.2, 2.2 * u)
    g.fillRect(cx - s * 0.02, cy + s * 0.02, s * 0.28, 2.2 * u)
    g.fillRect(cx - s * 0.26, cy + s * 0.13, s * 0.34, 2.2 * u)
    g.fillRect(cx + s * 0.12, cy + s * 0.13, s * 0.14, 2.2 * u)
    if (st.cc) {
      g.fillStyle = '#ff0033'
      g.fillRect(cx - s * 0.42, cy + s * 0.45, s * 0.84, 3 * u)
    }
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#ffffff'
  }
  // The gear: an outline cog with a hole.
  g.save()
  g.translate(L.gear[0], L.gear[1])
  g.lineWidth = 2.3 * u
  g.lineJoin = 'round'
  g.beginPath()
  for (let k = 0; k <= 16; k++) {
    const r = k % 2 ? s * 0.27 : s * 0.38
    const an = (k / 16) * Math.PI * 2 + Math.PI / 16
    if (k === 0) g.moveTo(Math.cos(an) * r, Math.sin(an) * r)
    else g.lineTo(Math.cos(an) * r, Math.sin(an) * r)
  }
  g.closePath()
  g.stroke()
  g.beginPath()
  g.arc(0, 0, s * 0.11, 0, Math.PI * 2)
  g.stroke()
  g.restore()
  // The quality badge on the gear when it isn't the top one.
  if (st.quality !== '1080p') {
    g.fillStyle = '#ff0033'
    roundRect(g, L.gear[0] + s * 0.08, L.gear[1] - s * 0.55, s * 0.6, s * 0.3, 3 * u)
    g.fill()
    text(c, st.quality.replace('p', ''), L.gear[0] + s * 0.38, L.gear[1] - s * 0.33, { size: s * 0.24, weight: 800, color: '#ffffff', align: 'center' })
    g.fillStyle = '#ffffff'
  }
  // Theatre mode: a wide rounded box with < > in it.
  {
    const [tx, ty] = L.theatre
    g.lineWidth = 2.2 * u
    roundRect(g, tx - s * 0.46, ty - s * 0.3, s * 0.92, s * 0.6, 4 * u)
    g.stroke()
    g.lineCap = 'round'
    g.lineJoin = 'round'
    for (const d of [-1, 1]) {
      g.beginPath()
      g.moveTo(tx + d * s * 0.12, ty - s * 0.12)
      g.lineTo(tx + d * s * 0.24, ty)
      g.lineTo(tx + d * s * 0.12, ty + s * 0.12)
      g.stroke()
    }
  }
  // Full screen: two arrows pointing out to opposite corners (↗ ↙).
  g.lineWidth = 2.3 * u
  g.lineCap = 'round'
  g.lineJoin = 'round'
  for (const d of [-1, 1]) {
    const x = L.full[0] + d * s * 0.34
    const y = L.full[1] - d * s * 0.32
    g.beginPath()
    g.moveTo(x - d * s * 0.2, y)
    g.lineTo(x, y)
    g.lineTo(x, y + d * s * 0.2)
    g.moveTo(x, y)
    g.lineTo(x - d * s * 0.22, y + d * s * 0.22)
    g.stroke()
  }
  // The "i" at the top right.
  {
    const [ix, iy] = L.info
    g.lineWidth = 2 * u
    g.beginPath()
    g.arc(ix, iy, s * 0.3, 0, Math.PI * 2)
    g.stroke()
    g.fillRect(ix - 1.2 * u, iy - s * 0.04, 2.4 * u, s * 0.2)
    g.beginPath()
    g.arc(ix, iy - s * 0.14, 1.8 * u, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

/** The settings panel at t: which list is open, if any, and the row lit. */
function menuAt(ev: PlayerEvent[], t: number): { kind: 'main' | 'speed' | 'quality'; lit: number; e: PlayerEvent; a: number } | null {
  for (const e of ev) {
    if (e.act !== 'speed' && e.act !== 'quality') continue
    const t0 = e.t + MENU_STEPS[0]
    const t1 = e.t + MENU_STEPS[1]
    const end = e.t + 0.3
    if (t < t0 || t > end + 0.2) continue
    const a = clamp01((t - t0) / 0.15) * (1 - clamp01((t - end) / 0.2))
    if (t < t1) return { kind: 'main', lit: t > t1 - 0.12 ? (e.act === 'speed' ? 0 : 2) : -1, e, a }
    const list = e.act === 'speed' ? SPEEDS : QUALITIES
    const pick = Math.max(0, list.indexOf(e.arg === '1' ? 'Normal' : e.arg))
    return { kind: e.act, lit: t > e.t - 0.12 ? pick : -1, e, a }
  }
  return null
}

function drawMenu(c: Ctx, L: PlayerLayout, m: NonNullable<ReturnType<typeof menuAt>>, st: ReturnType<typeof playerState>): void {
  const g = c.g
  const u = c.u
  const r = menuRect(L, m.kind)
  g.save()
  g.globalAlpha *= m.a
  g.fillStyle = 'rgba(28,28,28,0.9)'
  roundRect(g, r.x, r.y, r.w, r.h, 12 * u)
  g.fill()
  const rows = menuRows(m.kind)
  rows.forEach((label, i) => {
    const [, y] = menuRowAt(L, m.kind, i)
    if (i === m.lit) {
      g.fillStyle = 'rgba(255,255,255,0.14)'
      g.fillRect(r.x, y - L.rowH / 2, r.w, L.rowH)
    }
    const size = L.rowH * 0.34
    text(c, label, r.x + 22 * u, y + size * 0.36, { size, weight: 600, color: '#ffffff' })
    // The current setting on the right of the main list; a tick in a list.
    if (m.kind === 'main') {
      const val = i === 0 ? (st.speed === 'Normal' ? 'Normal' : `${st.speed}×`) : i === 1 ? (st.cc ? 'On' : 'Off') : st.quality
      text(c, `${val}  ›`, r.x + r.w - 20 * u, y + size * 0.36, { size, weight: 500, color: 'rgba(255,255,255,0.7)', align: 'right' })
    } else {
      const now = m.kind === 'speed' ? (st.speed === 'Normal' ? 'Normal' : st.speed) : st.quality
      if (label === now) text(c, '✓', r.x + r.w - 26 * u, y + size * 0.36, { size, weight: 700, color: '#ffffff', align: 'right' })
    }
  })
  g.restore()
}

export function drawPlayer(c: Ctx): void {
  const { g, b, t, x0, W, H, u } = c
  const L = playerLayout(x0, W, H)
  const ev = playerEvents(b)
  // The clock: the real time in this video and its real length, unless the
  // block says otherwise.
  const st = playerState(b, t, b.clock?.start ?? b.start)
  const total = Math.max(st.pos + 1, b.clock?.total ?? projectDuration(c.project))
  // The picture: the live one, at the quality chosen (dropping to it with a
  // moment's buffering).
  const lastQ = [...ev].reverse().find((e) => e.act === 'quality' && e.t <= t)
  const qk = lastQ ? clamp01((t - lastQ.t - 0.35) / 0.25) : 1
  if (lastQ) {
    const prevQ = [...ev].reverse().find((e) => e.act === 'quality' && e.t < lastQ.t)?.arg ?? '1080p'
    degraded(c, prevQ, 1 - qk)
    degraded(c, st.quality, qk)
  }
  // The block's own fade: the chrome comes and goes, the picture stays.
  const edge = clamp01(t / 0.3) * clamp01((b.duration - t) / 0.3)
  // The controls: up around every event, and all the while it is paused.
  let show = st.paused ? 1 : 0
  for (const e of ev) {
    const from = e.t + (e.act === 'speed' || e.act === 'quality' ? MENU_STEPS[0] : 0) - 0.5
    const to = e.t + 1.6
    if (t >= from - 0.25 && t <= to + 0.3) show = Math.max(show, clamp01((t - from + 0.25) / 0.25) * clamp01((to + 0.3 - t) / 0.3))
  }
  show = Math.max(show, clamp01((1.2 - t) / 0.3) * clamp01(t / 0.25))
  show *= edge
  // Buffering, just after a change of quality.
  if (lastQ && t > lastQ.t && t < lastQ.t + 0.7) {
    const k = Math.sin(Math.PI * clamp01((t - lastQ.t) / 0.7))
    g.save()
    g.globalAlpha *= k
    g.strokeStyle = '#ffffff'
    g.lineWidth = 6 * u
    g.lineCap = 'round'
    g.beginPath()
    g.arc(x0 + W / 2, H * 0.45, 34 * u, t * 9, t * 9 + Math.PI * 1.4)
    g.stroke()
    g.restore()
  }
  // Captions, the way the player shows them.
  if (st.cc) {
    const now = b.start + t
    const cap = c.project.captions.find((cp) => !cp.shape && (cp.layer ?? 0) === 0 && now >= cp.start && now < cp.end)
    if (cap) {
      const size = (c.portrait ? 40 : 38) * u
      g.font = fontOf(size, 'Inter', 600)
      const tw = Math.min(W * 0.8, g.measureText(cap.text).width)
      const y = (show > 0.1 ? L.bar.y - 70 * u : H - 90 * u) - size * 0.2
      g.fillStyle = 'rgba(8,8,8,0.75)'
      g.fillRect(x0 + W / 2 - tw / 2 - 12 * u, y - size * 0.95, tw + 24 * u, size * 1.35)
      text(c, cap.text, x0 + W / 2, y, { size, weight: 600, color: '#ffffff', align: 'center', maxW: W * 0.8 })
    }
  }
  // The big middle icon as it pauses or plays, and the double-tap ripples.
  for (const e of ev) {
    const d = t - e.t
    if (d < 0 || d > 0.8) continue
    const k = 1 - clamp01((d - 0.2) / 0.6)
    if (e.act === 'pause' || e.act === 'play') {
      // The big icon in the middle, plain white on the picture — no disc
      // behind it — swelling a little as it fades.
      const s = 1 + 0.18 * outCubic(clamp01(d / 0.8))
      const R = 46 * u * s
      g.save()
      g.globalAlpha *= k
      g.shadowColor = 'rgba(0,0,0,0.35)'
      g.shadowBlur = 12 * u * c.px
      g.fillStyle = '#ffffff'
      // Pausing shows the two bars, playing the triangle.
      playIcon(g, x0 + W / 2, H * 0.48, R * 1.25, e.act === 'play')
      g.restore()
    } else if (e.act === 'skip' || e.act === 'back') {
      const right = e.act === 'skip'
      const cx = right ? x0 + W : x0
      g.save()
      g.globalAlpha *= k
      g.beginPath()
      g.ellipse(cx, H * 0.45, W * 0.3, H * 0.7, 0, 0, Math.PI * 2)
      g.fillStyle = 'rgba(255,255,255,0.14)'
      g.fill()
      const lx = right ? x0 + W * 0.82 : x0 + W * 0.18
      for (let i = 0; i < 3; i++) {
        const on = Math.floor(d / 0.12) % 3 === i ? 1 : 0.45
        g.globalAlpha = k * on
        g.fillStyle = '#ffffff'
        const ax = lx + (right ? 1 : -1) * (i - 1) * 22 * u
        g.beginPath()
        g.moveTo(ax - (right ? 9 : -9) * u, H * 0.43 - 11 * u)
        g.lineTo(ax + (right ? 9 : -9) * u, H * 0.43)
        g.lineTo(ax - (right ? 9 : -9) * u, H * 0.43 + 11 * u)
        g.closePath()
        g.fill()
      }
      g.globalAlpha = k
      text(c, `${e.arg} seconds`, lx, H * 0.5, { size: 22 * u, weight: 700, color: '#ffffff', align: 'center' })
      g.restore()
    } else if (e.act === 'speed' && d > 0.25) {
      const kk = 1 - clamp01((d - 0.5) / 0.3)
      g.save()
      g.globalAlpha *= kk
      g.fillStyle = 'rgba(0,0,0,0.6)'
      roundRect(g, x0 + W / 2 - 60 * u, H * 0.1, 120 * u, 50 * u, 25 * u)
      g.fill()
      text(c, e.arg === 'Normal' || e.arg === '1' ? '1×' : `${e.arg}× ▸▸`, x0 + W / 2, H * 0.1 + 33 * u, { size: 22 * u, weight: 700, color: '#ffffff', align: 'center' })
      g.restore()
    }
  }
  if (show > 0.01) {
    controls(c, L, st, show, total)
    if (b.title) {
      g.save()
      g.globalAlpha *= show
      const sh = g.createLinearGradient(0, 0, 0, 120 * u)
      sh.addColorStop(0, 'rgba(0,0,0,0.6)')
      sh.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = sh
      g.fillRect(x0, 0, W, 120 * u)
      text(c, b.title, x0 + 28 * u, 56 * u, { size: 28 * u, weight: 600, color: '#ffffff', maxW: W * 0.7 })
      g.restore()
    }
  }
  const m = menuAt(ev, t)
  if (m) drawMenu(c, L, m, st)
}
