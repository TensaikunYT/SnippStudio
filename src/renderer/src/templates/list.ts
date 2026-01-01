// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A list video: every item's picture small in a strip along the bottom; the
// next one grows up out of the strip into the big frame,
// its number large beside it, its heading and a line about it; when the item
// is done the picture goes back down to its place in the strip, ticked, as
// the next one grows. Big and small, one continuous thing. Counting up, or
// down to number one.

import { glide, listLayout, listTimes } from './model'
import { clamp01, drawCover, imageOf, outCubic, prog, roundRect, text, type Ctx } from './draw'
import { wrap } from './extras'

type Rect = { x: number; y: number; w: number; h: number }
const lerpR = (a: Rect, b: Rect, k: number): Rect => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k })

/** An item's picture in a sticker frame: white border, the ink line, a hard
 *  shadow (deeper as it lifts). */
function frame(c: Ctx, i: number, r: Rect, rot: number, lift: number, dim = 0): void {
  const g = c.g
  const u = c.u
  const st = c.b.style
  const k = Math.min(1, r.w / (c.W * 0.3))
  const border = (4 + 10 * k) * u
  const line = (3 + 3 * k) * u
  g.save()
  g.translate(r.x + r.w / 2, r.y + r.h / 2)
  g.rotate(rot)
  const x = -r.w / 2
  const y = -r.h / 2
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowOffsetX = (4 + 8 * lift) * u * c.px
  g.shadowOffsetY = (6 + 12 * lift) * u * c.px
  g.shadowBlur = 8 * lift * u * c.px
  g.fillStyle = st.ink
  roundRect(g, x - line, y - line, r.w + line * 2, r.h + line * 2, 10 * k * u + line)
  g.fill()
  g.restore()
  g.fillStyle = st.card
  roundRect(g, x, y, r.w, r.h, 10 * k * u)
  g.fill()
  const pr = { x: x + border, y: y + border, w: r.w - border * 2, h: r.h - border * 2 }
  g.save()
  roundRect(g, pr.x, pr.y, pr.w, pr.h, 6 * k * u)
  g.clip()
  const img = imageOf(c, c.b.items[i])
  if (img) drawCover(g, img, pr.x, pr.y, pr.w, pr.h)
  else {
    const gr = g.createLinearGradient(pr.x, pr.y, pr.x + pr.w, pr.y + pr.h)
    gr.addColorStop(0, i % 2 ? '#3a4a66' : '#5a4a3a')
    gr.addColorStop(1, i % 2 ? '#1b2233' : '#2a2018')
    g.fillStyle = gr
    g.fillRect(pr.x, pr.y, pr.w, pr.h)
  }
  if (dim > 0) {
    g.fillStyle = `rgba(0,0,0,${dim.toFixed(3)})`
    g.fillRect(pr.x, pr.y, pr.w, pr.h)
  }
  g.restore()
  g.restore()
}

/** A small tick in the accent, on an item done. */
function tick(c: Ctx, x: number, y: number, R: number, a: number): void {
  const g = c.g
  g.save()
  g.globalAlpha *= a
  g.fillStyle = c.b.style.ink
  g.beginPath()
  g.arc(x + 1.5 * c.u, y + 2 * c.u, R + 2 * c.u, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = c.b.style.accent
  g.beginPath()
  g.arc(x, y, R, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = c.b.style.ink
  g.lineWidth = R * 0.28
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(x - R * 0.45, y + R * 0.02)
  g.lineTo(x - R * 0.1, y + R * 0.36)
  g.lineTo(x + R * 0.5, y - R * 0.34)
  g.stroke()
  g.restore()
}

export function drawList(c: Ctx): void {
  const { g, b, t, u } = c
  const st = b.style
  const n = b.items.length
  if (!n) return
  const L = listLayout(b, c.x0, c.W, c.H)
  const T = listTimes(b)
  const numberOf = (i: number): number => (b.countdown ? n - i : i + 1)
  // The item on now (the latest one tapped open), and how far it has grown.
  let cur = -1
  for (let i = 0; i < n; i++) if (t >= T[i].tap) cur = i
  const rot = (i: number): number => ((i % 2 ? 1 : -1) * 1.6 * Math.PI) / 180
  // The headline, top left.
  if (b.title) {
    const p = outCubic(prog(t, 0.1, 0.45))
    text(c, b.title, L.text.x, L.head + (1 - p) * 14 * u, { size: L.headSize, family: st.font, color: c.onBg, alpha: p, maxW: c.portrait ? c.W * 0.86 : L.text.w + c.W * 0.1 })
  }
  // The strip: every item small, in order, rising in one after another.
  for (let i = 0; i < n; i++) {
    const r0 = L.thumbs[i]
    const inK = outCubic(prog(t, 0.15 + i * 0.06, 0.4))
    // Up in the big frame (or on its way): its place in the strip is empty.
    const g0 = glide(prog(t, T[i].tap + 0.06, 0.5))
    const g1 = glide(prog(t, T[i].back, 0.45))
    const out = g0 * (1 - g1)
    if (out > 0.01) {
      // An outline where it will go back to.
      g.save()
      g.globalAlpha *= 0.35 * inK
      g.strokeStyle = c.onBg
      g.setLineDash([6 * u, 5 * u])
      g.lineWidth = 2 * u
      roundRect(g, r0.x, r0.y, r0.w, r0.h, 6 * u)
      g.stroke()
      g.restore()
      continue
    }
    const done = t >= T[i].back + 0.45
    const next = i === cur + 1
    g.save()
    g.globalAlpha *= inK
    const lift = next ? 0.4 : 0
    const r = { ...r0, y: r0.y + (1 - inK) * 30 * u - lift * 6 * u }
    frame(c, i, r, 0, lift, done ? 0.45 : 0)
    // Its number on it, small.
    text(c, String(numberOf(i)), r.x + 10 * u, r.y + r.h - 10 * u, { size: r.h * 0.34, family: st.font, color: '#ffffff', alpha: 0.95 })
    if (done) tick(c, r.x + r.w - 4 * u, r.y + 4 * u, r.h * 0.17, clamp01((t - T[i].back - 0.45) / 0.2))
    g.restore()
  }
  // The words of the item up now: its number large, the heading, a line.
  if (cur >= 0) {
    const it = b.items[cur]
    // On a Short the picture grows up through where the words go: they wait for it.
    const inK = outCubic(prog(t, T[cur].tap + (c.portrait ? 0.45 : 0.2), 0.5))
    const outK = glide(prog(t, T[cur].back - 0.05, 0.3))
    const a = inK * (1 - outK)
    if (a > 0.01) {
      const num = b.countdown ? `#${numberOf(cur)}` : String(numberOf(cur)).padStart(2, '0')
      const X = L.text.x
      // The number: rises out of a line, the accent under it.
      g.save()
      g.beginPath()
      g.rect(X - 20 * u, L.numY - L.numSize * 1.05, L.text.w + 40 * u, L.numSize * 1.12)
      g.clip()
      text(c, num, X, L.numY + (1 - inK) * L.numSize * 0.9 + outK * L.numSize * 0.9, { size: L.numSize, family: 'Anton', weight: 400, color: c.onBg })
      g.restore()
      g.save()
      g.globalAlpha *= a
      g.fillStyle = st.accent
      roundRect(g, X, L.numY + 12 * u, Math.min(L.text.w, 120 * u) * inK, 10 * u, 5 * u)
      g.fill()
      g.restore()
      let y = L.numY + 12 * u + L.titleSize * 1.35
      const lines = wrap(g, it.title, L.titleSize, L.text.w, st.font, 400, 2)
      lines.forEach((ln) => {
        text(c, ln, X + (1 - inK) * 20 * u, y, { size: L.titleSize, family: st.font, weight: 400, color: c.onBg, alpha: a })
        y += L.titleSize * 1.12
      })
      if (it.note) {
        const na = a * outCubic(prog(t, T[cur].tap + 0.45, 0.4))
        const nl = wrap(g, it.note, L.noteSize, L.text.w, 'Inter', 500, 3)
        y += L.noteSize * 0.5
        nl.forEach((ln) => {
          text(c, ln, X, y, { size: L.noteSize, weight: 500, color: c.onBg, alpha: na * 0.8 })
          y += L.noteSize * 1.35
        })
      }
    }
  }
  // The item up now (and the one going back down as it comes up).
  for (let i = 0; i < n; i++) {
    const g0 = glide(prog(t, T[i].tap + 0.06, 0.5))
    const g1 = glide(prog(t, T[i].back, 0.45))
    if (g0 <= 0 || g1 >= 1) continue
    const k = g0 * (1 - g1)
    const r = lerpR(L.thumbs[i], L.big, k)
    const lift = Math.sin(Math.PI * (g1 > 0 ? g1 : g0)) * 0.9 + 0.1
    frame(c, i, r, rot(i) * k, lift)
  }
}
