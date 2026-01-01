// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A deck of cards: your pictures dealt from a deck one by one into a row,
// face down, then turned over one after another. Sticker
// cards: a white border, the ink line, a hard shadow; the backs in the
// accent with a fine pattern.

import { cardsLayout, cardsPick, cardsPickPlace, cardsTimes, glide } from './model'
import { clamp01, drawCover, headline, imageOf, prog, roundRect, text, type Ctx } from './draw'

type Rect = { x: number; y: number; w: number; h: number }

function cardBack(c: Ctx, w: number, h: number): void {
  const g = c.g
  const st = c.b.style
  const u = c.u
  const r = Math.min(w, h) * 0.08
  const pad = Math.min(w, h) * 0.07
  g.fillStyle = '#ffffff'
  roundRect(g, -w / 2, -h / 2, w, h, r)
  g.fill()
  g.save()
  roundRect(g, -w / 2 + pad, -h / 2 + pad, w - pad * 2, h - pad * 2, r * 0.6)
  g.clip()
  g.fillStyle = st.accent
  g.fillRect(-w / 2, -h / 2, w, h)
  // A fine diagonal weave.
  g.strokeStyle = 'rgba(255,255,255,0.28)'
  g.lineWidth = Math.max(1, 2 * u)
  for (let x = -w - h; x < w + h; x += 14 * u) {
    g.beginPath()
    g.moveTo(x, -h / 2)
    g.lineTo(x + h, h / 2)
    g.moveTo(x + h, -h / 2)
    g.lineTo(x, h / 2)
    g.stroke()
  }
  g.restore()
  // A small emblem in the middle: a diamond in a ring.
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(0, 0, Math.min(w, h) * 0.16, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = st.accent
  const d = Math.min(w, h) * 0.08
  g.beginPath()
  g.moveTo(0, -d)
  g.lineTo(d * 0.75, 0)
  g.lineTo(0, d)
  g.lineTo(-d * 0.75, 0)
  g.closePath()
  g.fill()
}

function cardFront(c: Ctx, i: number, w: number, h: number): void {
  const g = c.g
  const st = c.b.style
  const it = c.b.items[i]
  const r = Math.min(w, h) * 0.08
  const pad = Math.min(w, h) * 0.06
  g.fillStyle = st.card
  roundRect(g, -w / 2, -h / 2, w, h, r)
  g.fill()
  const label = (it?.title ?? '').trim()
  const lh = label ? h * 0.2 : 0
  const img = imageOf(c, it)
  const pic: Rect = { x: -w / 2 + pad, y: -h / 2 + pad, w: w - pad * 2, h: h - pad * 2 - lh }
  g.save()
  roundRect(g, pic.x, pic.y, pic.w, pic.h, r * 0.6)
  g.clip()
  if (img) drawCover(g, img, pic.x, pic.y, pic.w, pic.h)
  else {
    const gr = g.createLinearGradient(pic.x, pic.y, pic.x + pic.w, pic.y + pic.h)
    gr.addColorStop(0, '#3a4a66')
    gr.addColorStop(1, '#1b2233')
    g.fillStyle = gr
    g.fillRect(pic.x, pic.y, pic.w, pic.h)
    text(c, String(i + 1), 0, pic.y + pic.h * 0.62, { size: pic.h * 0.4, family: st.font, color: 'rgba(255,255,255,0.35)', align: 'center' })
  }
  g.restore()
  if (label) text(c, label, 0, h / 2 - pad - lh * 0.3, { size: Math.min(lh * 0.55, w * 0.14), family: st.font, color: st.ink, align: 'center', maxW: w - pad * 2 })
}

/** A card at its place: the ink line and hard shadow, then its face. */
function card(c: Ctx, i: number, cx: number, cy: number, w: number, h: number, rot: number, flip: number, lift: number): void {
  const g = c.g
  const u = c.u
  const face = flip >= 0.5
  const sx = Math.max(0.02, Math.abs(Math.cos(Math.PI * flip)))
  g.save()
  g.translate(cx, cy - lift * 12 * u)
  g.rotate(rot)
  g.scale(sx * (1 + 0.05 * lift), 1 + 0.05 * lift)
  const r = Math.min(w, h) * 0.08
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowOffsetX = (6 + 10 * lift) * u
  g.shadowOffsetY = (9 + 12 * lift) * u
  g.fillStyle = c.b.style.ink
  roundRect(g, -w / 2 - 4 * u, -h / 2 - 4 * u, w + 8 * u, h + 8 * u, r + 4 * u)
  g.fill()
  g.restore()
  if (face) cardFront(c, i, w, h)
  else cardBack(c, w, h)
  g.restore()
}

export function drawCards(c: Ctx): void {
  const b = c.b
  const L = cardsLayout(b, c.x0, c.W, c.H)
  const T = cardsTimes(b)
  headline(c)
  const n = b.items.length
  // The deck: what is still to be dealt, a small stack.
  let left = 0
  for (let i = 0; i < n; i++) if (c.t < T.deal[i][0]) left++
  const dw = L.w * 0.72
  const dh = L.h * 0.72
  const inK = clamp01(prog(c.t, 0.05, 0.35))
  for (let k = 0; k < left; k++) {
    card(c, 0, L.deck[0] + k * 1.5 * c.u, L.deck[1] + (1 - inK) * c.H * 0.3 - k * 2.5 * c.u, dw, dh, -0.04, 0, 0)
  }
  // The dealt cards: carried from the deck to their place, turned over in
  // their turn. The picked one comes last, over the others.
  const pk = cardsPick(b)
  const pickK = pk !== null && T.pick ? glide((c.t - T.pick[0]) / (T.pick[1] - T.pick[0])) : 0
  for (let i = 0; i < n; i++) {
    const [d0, d1] = T.deal[i]
    if (c.t < d0 || (i === pk && pickK > 0)) continue
    const e = glide((c.t - d0) / (d1 - d0))
    const slot = L.slots[i]
    const x = L.deck[0] + (slot[0] - L.deck[0]) * e
    const y = L.deck[1] + (slot[1] - L.deck[1]) * e - Math.sin(Math.PI * e) * c.H * 0.05
    const w = dw + (L.w - dw) * e
    const h = dh + (L.h - dh) * e
    const rot = (1 - e) * -0.2 + e * L.rot[i]
    const f = clamp01((c.t - T.flip[i]) / 0.38)
    const lift = Math.sin(Math.PI * f)
    card(c, i, x, y, w, h, rot, f, lift)
  }
  if (pk !== null && pickK > 0) {
    // The rest of the table sinks back; the chosen card comes up close,
    // straightened, lifted high (its shadow far below it).
    c.g.fillStyle = `rgba(0,0,0,${(0.42 * pickK).toFixed(3)})`
    c.g.fillRect(c.x0, 0, c.W, c.H)
    const P = cardsPickPlace(c.x0, c.W, c.H, L)
    const slot = L.slots[pk]
    const k = 1 + (P.k - 1) * pickK
    const x = slot[0] + (P.x - slot[0]) * pickK
    const y = slot[1] + (P.y - slot[1]) * pickK - Math.sin(Math.PI * pickK) * c.H * 0.04
    card(c, pk, x, y, L.w * k, L.h * k, L.rot[pk] * (1 - pickK), 1, Math.min(1, pickK * 1.4))
  }
}
