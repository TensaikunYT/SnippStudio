// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Four more templates: a before/after whose divider slides between the two,
// a checklist ticked off, social posts whose hearts are tapped, and a poll
// that is answered. All in the channel's sticker look — white cards,
// a bold ink line and hard shadow, one accent.

import { checklistLayout, compareLayout, compareSplit, pollLayout, postLayout, templateSlots } from './model'
import { clamp01, drawCover, fmtNum, fontOf, headline, imageOf, outBack, outCubic, outExpo, prog, roundRect, text, type Ctx } from './draw'

/** The template's ink (its lines and words) and its cards, from its palette. */
const ink = (c: Ctx): string => c.b.style.ink
const paper = (c: Ctx): string => c.b.style.card
/** A colour made see-through. */
export function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
/** Marks and words on the accent: dark on a light accent, white on a deep one. */
export function onAccent(c: Ctx): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.b.style.accent)
  const n = m ? parseInt(m[1], 16) : 0
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return l > 0.55 ? '#0b0b0d' : '#ffffff'
}

/** A card in the sticker style. */
function sticker(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill?: string): void {
  const g = c.g
  const u = c.u
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.55)'
  g.shadowOffsetX = 7 * u
  g.shadowOffsetY = 10 * u
  g.fillStyle = ink(c)
  roundRect(g, x - 5 * u, y - 5 * u, w + 10 * u, h + 10 * u, r + 5 * u)
  g.fill()
  g.restore()
  g.fillStyle = fill ?? paper(c)
  roundRect(g, x, y, w, h, r)
  g.fill()
}

/** A picture or, without one, a quiet placeholder saying so. */
function picture(c: Ctx, i: number, x: number, y: number, w: number, h: number): void {
  const g = c.g
  const img = imageOf(c, c.b.items[i])
  if (img) {
    drawCover(g, img, x, y, w, h)
    return
  }
  const gr = g.createLinearGradient(x, y, x + w, y + h)
  gr.addColorStop(0, i ? '#3a4a66' : '#5a4a3a')
  gr.addColorStop(1, i ? '#1b2233' : '#2a2018')
  g.fillStyle = gr
  g.fillRect(x, y, w, h)
  text(c, 'Add a picture', x + w / 2, y + h / 2, { size: 30 * c.u, weight: 700, color: 'rgba(255,255,255,0.5)', align: 'center' })
}

// -- before / after -------------------------------------------------------------

export function drawCompare(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = compareLayout(c.x0, c.W, c.H)
  const k = outExpo(prog(c.t, 0, 0.6))
  const s = compareSplit(b, c.t)
  g.save()
  g.translate(0, (1 - k) * c.H * 0.08)
  g.globalAlpha *= clamp01(k * 1.4)
  sticker(c, L.x, L.y, L.w, L.h, 18 * u)
  g.save()
  roundRect(g, L.x, L.y, L.w, L.h, 18 * u)
  g.clip()
  picture(c, 0, L.x, L.y, L.w, L.h)
  const sx = L.x + L.w * s
  g.beginPath()
  g.rect(sx, L.y, L.x + L.w - sx, L.h)
  g.clip()
  picture(c, 1, L.x, L.y, L.w, L.h)
  g.restore()
  // The labels, each fading as its side is covered.
  const chip = (label: string, x: number, right: boolean, a: number): void => {
    if (!label || a <= 0.02) return
    g.save()
    g.globalAlpha *= a
    g.font = fontOf(28 * u, st.font)
    const w = g.measureText(label.toLocaleUpperCase('tr')).width + 28 * u
    const cx = right ? x - w : x
    sticker(c, cx, L.y + 22 * u, w, 44 * u, 10 * u, right ? st.accent : paper(c))
    text(c, label.toLocaleUpperCase('tr'), cx + w / 2, L.y + 55 * u, { size: 28 * u, family: st.font, color: right ? onAccent(c) : ink(c), align: 'center' })
    g.restore()
  }
  chip(b.items[0]?.title ?? '', L.x + 22 * u, false, clamp01((s - 0.12) / 0.2))
  chip(b.items[1]?.title ?? '', L.x + L.w - 22 * u, true, clamp01((0.88 - s) / 0.2))
  // The divider and its handle.
  g.fillStyle = '#ffffff'
  g.fillRect(sx - 2.5 * u, L.y, 5 * u, L.h)
  const hy = L.y + L.h / 2
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowOffsetY = 6 * u
  g.fillStyle = ink(c)
  g.beginPath()
  g.arc(sx, hy, 38 * u, 0, Math.PI * 2)
  g.fill()
  g.restore()
  g.fillStyle = paper(c)
  g.beginPath()
  g.arc(sx, hy, 33 * u, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = ink(c)
  for (const d of [-1, 1]) {
    g.beginPath()
    g.moveTo(sx + d * 20 * u, hy)
    g.lineTo(sx + d * 8 * u, hy - 10 * u)
    g.lineTo(sx + d * 8 * u, hy + 10 * u)
    g.closePath()
    g.fill()
  }
  g.restore()
  if (b.title) headline(c)
}

// -- checklist ------------------------------------------------------------------

export function drawChecklist(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = checklistLayout(b, c.x0, c.W, c.H)
  const s = templateSlots(b)
  const k = outExpo(prog(c.t, 0, 0.55))
  g.save()
  g.translate(0, (1 - k) * c.H * 0.06)
  g.globalAlpha *= clamp01(k * 1.4)
  sticker(c, L.card.x, L.card.y, L.card.w, L.card.h, 22 * u, st.card)
  text(c, b.title, L.card.x + L.pad, L.card.y + L.pad + L.titleSize * 0.8, { size: L.titleSize, family: st.font, color: ink(c), maxW: L.card.w - L.pad * 2 })
  g.fillStyle = st.accent
  g.fillRect(L.card.x + L.pad, L.card.y + L.pad + L.titleSize * 1.12, L.titleSize * 1.4, 6 * u)
  b.items.forEach((it, i) => {
    const row = L.rows[i]
    const ka = outCubic(prog(c.t, 0.25 + i * 0.08, 0.4))
    if (ka <= 0) return
    g.save()
    g.globalAlpha *= ka
    const tick = s.at(i)
    const done = c.t >= tick
    const box = row.box
    // The box: pressed in for a moment when tapped.
    const press = Math.sin(Math.PI * clamp01((c.t - tick + 0.06) / 0.18)) * 0.1
    g.save()
    g.translate(box.x + box.w / 2, box.y + box.h / 2)
    g.scale(1 - press, 1 - press)
    g.fillStyle = ink(c)
    roundRect(g, -box.w / 2 - 3 * u, -box.h / 2 - 3 * u, box.w + 6 * u, box.h + 6 * u, 10 * u)
    g.fill()
    g.fillStyle = done ? st.accent : paper(c)
    roundRect(g, -box.w / 2, -box.h / 2, box.w, box.h, 8 * u)
    g.fill()
    // The tick, drawn in.
    const kt = clamp01((c.t - tick) / 0.25)
    if (kt > 0) {
      g.strokeStyle = onAccent(c)
      g.lineWidth = box.w * 0.14
      g.lineCap = 'round'
      g.lineJoin = 'round'
      const p1: [number, number] = [-box.w * 0.28, 0]
      const p2: [number, number] = [-box.w * 0.06, box.h * 0.22]
      const p3: [number, number] = [box.w * 0.3, -box.h * 0.26]
      g.beginPath()
      g.moveTo(p1[0], p1[1])
      const a1 = Math.min(1, kt / 0.35)
      g.lineTo(p1[0] + (p2[0] - p1[0]) * a1, p1[1] + (p2[1] - p1[1]) * a1)
      if (kt > 0.35) {
        const a2 = (kt - 0.35) / 0.65
        g.lineTo(p2[0] + (p3[0] - p2[0]) * a2, p2[1] + (p3[1] - p2[1]) * a2)
      }
      g.stroke()
    }
    g.restore()
    text(c, it.title, row.textX, box.y + box.h * 0.72, { size: L.size, weight: 700, color: ink(c), maxW: L.card.x + L.card.w - L.pad - row.textX, alpha: done ? 0.55 : 1 })
    if (it.note) text(c, it.note, row.textX, box.y + box.h * 0.72 + L.size * 0.95, { size: L.size * 0.62, weight: 500, color: ink(c), alpha: 0.5, maxW: L.card.x + L.card.w - L.pad - row.textX })
    g.restore()
  })
  g.restore()
}

// -- social post ----------------------------------------------------------------

function heart(g: Ctx['g'], x: number, y: number, s: number): void {
  g.beginPath()
  g.moveTo(x, y + s * 0.35)
  g.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.45, y - s * 0.95, x, y - s * 0.45)
  g.bezierCurveTo(x + s * 0.45, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35)
  g.closePath()
}

export function drawPost(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = postLayout(b, c.x0, c.W, c.H)
  const s = templateSlots(b)
  b.items.forEach((it, i) => {
    const card = L.cards[i]
    const tIn = Math.max(0, s.at(i) - 0.6)
    const k = outBack(prog(c.t, tIn, 0.5))
    if (k <= 0) return
    const tap = s.at(i)
    const liked = c.t >= tap
    g.save()
    g.translate(0, (1 - k) * c.H * 0.25)
    g.globalAlpha *= clamp01(k * 1.5)
    sticker(c, card.x, card.y, card.w, card.h, 20 * u)
    const pad = 26 * u
    // Who: a round avatar in the accent, the name and handle.
    g.fillStyle = st.accent
    g.beginPath()
    g.arc(card.x + pad + 26 * u, card.y + pad + 26 * u, 26 * u, 0, Math.PI * 2)
    g.fill()
    const name = it.note || b.title || 'Viewer'
    text(c, name.slice(0, 1).toLocaleUpperCase('tr'), card.x + pad + 26 * u, card.y + pad + 36 * u, { size: 28 * u, family: st.font, color: ink(c), align: 'center' })
    text(c, name, card.x + pad + 66 * u, card.y + pad + 22 * u, { size: 32 * u, weight: 800, color: ink(c), maxW: card.w * 0.6 })
    text(c, `@${name.toLocaleLowerCase('tr').replace(/\s+/g, '')} · ${i + 1}h`, card.x + pad + 66 * u, card.y + pad + 50 * u, { size: 24 * u, weight: 500, color: ink(c), alpha: 0.5, maxW: card.w * 0.6 })
    // What they wrote.
    const lines = wrap(g, it.title, 40 * u, card.w - pad * 2)
    lines.forEach((l, li) => text(c, l, card.x + pad, card.y + pad + 110 * u + li * 52 * u, { size: 40 * u, weight: 600, color: ink(c) }))
    // The heart and its count: tapped, it fills, swells a little and counts on.
    const hx = card.x + pad + 18 * u
    const hy = card.y + card.h - pad - 14 * u
    const pop = liked ? 1 + 0.35 * Math.exp(-(c.t - tap) / 0.12) * Math.sin(Math.min(Math.PI, (c.t - tap) * 18)) : 1
    g.save()
    g.translate(hx, hy)
    g.scale(pop, pop)
    heart(g, 0, 0, 22 * u)
    g.fillStyle = liked ? '#ff3b5c' : paper(c)
    g.fill()
    g.strokeStyle = ink(c)
    g.lineWidth = 4 * u
    g.stroke()
    g.restore()
    const base = it.value ?? 0
    const cnt = liked ? base + Math.round(outExpo(clamp01((c.t - tap) / 0.8)) * Math.max(1, Math.round(base * 0.02))) : base
    text(c, fmtNum(cnt, 1), hx + 36 * u, hy + 10 * u, { size: 26 * u, weight: 800, color: liked ? '#ff3b5c' : ink(c) })
    // A reply and a share mark, quietly.
    g.strokeStyle = alpha(ink(c), 0.45)
    g.lineWidth = 3 * u
    g.beginPath()
    g.arc(hx + 190 * u, hy - 2 * u, 14 * u, 0, Math.PI * 2)
    g.stroke()
    g.beginPath()
    g.moveTo(hx + 300 * u, hy + 10 * u)
    g.lineTo(hx + 300 * u, hy - 14 * u)
    g.moveTo(hx + 290 * u, hy - 4 * u)
    g.lineTo(hx + 300 * u, hy - 14 * u)
    g.lineTo(hx + 310 * u, hy - 4 * u)
    g.stroke()
    g.restore()
  })
}

export function wrap(g: Ctx['g'], s: string, size: number, maxW: number, family = 'Inter', weight = 600, most = 4): string[] {
  g.font = fontOf(size, family, weight)
  const out: string[] = []
  let line = ''
  for (const w of s.split(/\s+/)) {
    const next = line ? `${line} ${w}` : w
    if (g.measureText(next).width > maxW && line) {
      out.push(line)
      line = w
    } else line = next
  }
  if (line) out.push(line)
  return out.slice(0, most)
}

// -- poll -----------------------------------------------------------------------

export function drawPoll(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const u = c.u
  const L = pollLayout(b, c.x0, c.W, c.H)
  const k = outExpo(prog(c.t, 0, 0.55))
  const tap = L.tapAt
  const pick = L.pick
  const total = Math.max(1e-9, b.items.reduce((a, it) => a + Math.max(0, it.value ?? 0), 0))
  g.save()
  g.translate(0, (1 - k) * c.H * 0.06)
  g.globalAlpha *= clamp01(k * 1.4)
  sticker(c, L.card.x, L.card.y, L.card.w, L.card.h, 22 * u, st.card)
  const qLines = wrap(g, b.title || 'Which one?', L.qSize, L.card.w - L.pad * 2)
  qLines.forEach((l, li) => text(c, l, L.card.x + L.pad, L.card.y + L.pad + L.qSize * (0.9 + li * 1.15), { size: L.qSize, family: st.font, color: ink(c) }))
  const fill = outExpo(clamp01((c.t - tap - 0.15) / 0.9))
  b.items.forEach((it, i) => {
    const r = L.rows[i]
    const ka = outCubic(prog(c.t, 0.3 + i * 0.08, 0.35))
    if (ka <= 0) return
    const share = Math.max(0, it.value ?? 0) / total
    const chosen = i === pick && c.t >= tap
    const press = i === pick ? Math.sin(Math.PI * clamp01((c.t - tap + 0.06) / 0.18)) * 0.03 : 0
    g.save()
    g.globalAlpha *= ka
    g.translate(r.x + r.w / 2, r.y + r.h / 2)
    g.scale(1 - press, 1 - press)
    g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    g.fillStyle = ink(c)
    roundRect(g, r.x - 3 * u, r.y - 3 * u, r.w + 6 * u, r.h + 6 * u, r.h / 2 + 3 * u)
    g.fill()
    g.fillStyle = paper(c)
    roundRect(g, r.x, r.y, r.w, r.h, r.h / 2)
    g.fill()
    // The result, filling in once voted.
    if (fill > 0) {
      g.save()
      roundRect(g, r.x, r.y, r.w, r.h, r.h / 2)
      g.clip()
      g.fillStyle = chosen || i === pick ? st.accent : alpha(ink(c), 0.12)
      g.fillRect(r.x, r.y, r.w * share * fill, r.h)
      g.restore()
    }
    // Its words, and over the filled part the same words in the colour
    // that reads on the accent.
    const words = (col: string): void => {
      text(c, it.title, r.x + r.h * 0.55, r.y + r.h * 0.66, { size: r.h * 0.42, weight: 800, color: col, maxW: r.w * 0.66 })
      if (fill > 0) text(c, `${Math.round(share * 100 * fill)}%`, r.x + r.w - r.h * 0.5, r.y + r.h * 0.66, { size: r.h * 0.42, family: st.font, color: col, align: 'right' })
    }
    words(ink(c))
    if (fill > 0 && (chosen || i === pick)) {
      g.save()
      g.beginPath()
      g.rect(r.x, r.y, r.w * share * fill, r.h)
      g.clip()
      words(onAccent(c))
      g.restore()
    }
    if (chosen) {
      g.fillStyle = ink(c)
      g.beginPath()
      g.arc(r.x + r.w + r.h * 0.55, r.y + r.h / 2, r.h * 0.3, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = st.accent
      g.lineWidth = r.h * 0.08
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(r.x + r.w + r.h * 0.42, r.y + r.h * 0.5)
      g.lineTo(r.x + r.w + r.h * 0.52, r.y + r.h * 0.6)
      g.lineTo(r.x + r.w + r.h * 0.7, r.y + r.h * 0.38)
      g.stroke()
    }
    g.restore()
  })
  if (fill > 0) text(c, `${fmtNum(Math.round(total), 1)} votes`, L.card.x + L.pad, L.card.y + L.card.h - L.pad * 0.6, { size: 24 * u, weight: 600, color: ink(c), alpha: 0.5 * fill })
  g.restore()
}
