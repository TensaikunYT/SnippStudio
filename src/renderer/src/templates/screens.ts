// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The typing template's other screens. The keyboard still rises from the
// dock and types every key; what it types into changes:
//   browser — an address bar; Enter loads the page (its headline, your picture)
//   chat    — a message box; Enter sends the bubble, and the reply comes back
//   notes   — a sheet of paper; each line typed, its note under it in grey
//   search  — a search box; Enter lifts it and the results come in
// Everything is drawn in the templates' own flat, inked style.

import { searchThumb, SEARCH_OPEN, type TypedLine } from './model'
import { clamp01, drawCover, fontOf, imageOf, prog, roundRect, text, type Ctx } from './draw'

type Rect = { x: number; y: number; w: number; h: number }
type Script = { lines: TypedLine[] }

const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3
const sans = (size: number, weight = 500): string => fontOf(size, 'Inter', weight)

/** What of line `l` is typed by t, and whether it is still being typed. */
function typed(l: TypedLine, t: number): { s: string; typing: boolean } {
  const n = l.at.filter((q) => q <= t).length
  return { s: [...l.text].slice(0, n).join(''), typing: t < l.enter }
}

/** The line being typed (or last typed) at t. */
function current(S: Script, t: number): { l: TypedLine; i: number } | null {
  let cur: { l: TypedLine; i: number } | null = null
  S.lines.forEach((l, i) => {
    if (t >= l.at[0] - 0.05 || i === 0) cur = { l, i }
  })
  return cur
}

function caret(c: Ctx, x: number, y: number, h: number, color: string): void {
  if (Math.floor(c.t * 2.2) % 2 !== 0) return
  c.g.fillStyle = color
  c.g.fillRect(x, y - h * 0.8, Math.max(1.5, h * 0.08), h)
}

/** A light window: shadow, body, a title bar with the three lights. */
function frame(c: Ctx, w: Rect, body: string, bar: number, title?: string): void {
  const g = c.g
  const u = c.u
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 36 * u
  g.shadowOffsetY = 14 * u
  g.fillStyle = body
  roundRect(g, w.x, w.y, w.w, w.h, 14 * u)
  g.fill()
  g.restore()
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = Math.max(1, u)
  roundRect(g, w.x, w.y, w.w, w.h, 14 * u)
  g.stroke()
  ;['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    g.fillStyle = col
    g.beginPath()
    g.arc(w.x + bar * 0.6 + i * bar * 0.55, w.y + bar / 2, bar * 0.14, 0, Math.PI * 2)
    g.fill()
  })
  if (title) text(c, title, w.x + w.w / 2, w.y + bar * 0.64, { size: bar * 0.36, weight: 600, color: 'rgba(20,22,28,0.55)', align: 'center', maxW: w.w * 0.5 })
}

/** A few grey bars standing in for text. */
function skeleton(c: Ctx, x: number, y: number, w: number, h: number, rows: number, k = 1): void {
  const g = c.g
  g.fillStyle = `rgba(20,22,28,${(0.1 * k).toFixed(3)})`
  for (let i = 0; i < rows; i++) {
    const ww = w * (i === rows - 1 ? 0.62 : 0.94 - 0.06 * (i % 2))
    roundRect(g, x, y + i * h * 1.9, ww, h, h / 2)
    g.fill()
  }
}

// -- browser ------------------------------------------------------------------

function drawBrowser(c: Ctx, w: Rect, S: Script): void {
  const g = c.g
  const st = c.b.style
  const t = c.t
  const u = c.u
  const bar = c.H * 0.056
  frame(c, w, '#ffffff', bar)
  const cur = current(S, t)
  // The page on screen: the last one whose load has finished.
  let shown = -1
  S.lines.forEach((l, i) => {
    if (t >= l.outAt) shown = i
  })
  // Tab.
  const tabW = Math.min(w.w * 0.32, 300 * u)
  g.fillStyle = '#eef0f3'
  roundRect(g, w.x + bar * 2.4, w.y + bar * 0.18, tabW, bar * 0.82, 8 * u)
  g.fill()
  const tabTitle = shown >= 0 ? S.lines[shown].out || S.lines[shown].text : c.b.title || 'New tab'
  text(c, tabTitle, w.x + bar * 2.4 + 12 * u, w.y + bar * 0.7, { size: bar * 0.32, weight: 600, color: '#23262d', align: 'left', maxW: tabW - 24 * u })
  // Address bar.
  const ab: Rect = { x: w.x + bar * 0.5, y: w.y + bar * 1.12, w: w.w - bar, h: bar * 0.8 }
  g.fillStyle = '#f1f3f5'
  roundRect(g, ab.x, ab.y, ab.w, ab.h, ab.h / 2)
  g.fill()
  const fs = ab.h * 0.5
  const tx = ab.x + ab.h * 0.9
  // A small lock.
  g.strokeStyle = '#5b6170'
  g.lineWidth = Math.max(1, fs * 0.1)
  g.beginPath()
  g.arc(ab.x + ab.h * 0.45, ab.y + ab.h * 0.42, fs * 0.2, Math.PI, 0)
  g.stroke()
  g.fillStyle = '#5b6170'
  g.fillRect(ab.x + ab.h * 0.45 - fs * 0.28, ab.y + ab.h * 0.42, fs * 0.56, fs * 0.42)
  if (cur) {
    const { s, typing } = typed(cur.l, t)
    // Retyping: the old address is selected first, then replaced.
    const old = cur.i > 0 && t < cur.l.at[0] + 0.02 && t > cur.l.at[0] - 0.3 ? S.lines[cur.i - 1].text : null
    g.font = sans(fs, 500)
    if (old) {
      const ow = g.measureText(old).width
      g.fillStyle = 'rgba(64,132,255,0.28)'
      g.fillRect(tx - 2 * u, ab.y + ab.h * 0.2, ow + 4 * u, ab.h * 0.6)
      text(c, old, tx, ab.y + ab.h * 0.66, { size: fs, weight: 500, color: '#23262d', align: 'left', family: 'Inter' })
    } else {
      text(c, s, tx, ab.y + ab.h * 0.66, { size: fs, weight: 500, color: '#23262d', align: 'left' })
      if (typing) caret(c, tx + g.measureText(s).width + 2 * u, ab.y + ab.h * 0.72, fs * 1.1, '#23262d')
    }
  }
  // The page.
  const pg: Rect = { x: w.x, y: ab.y + ab.h + bar * 0.3, w: w.w, h: w.y + w.h - (ab.y + ab.h + bar * 0.3) }
  g.save()
  roundRect(g, pg.x, pg.y, pg.w, pg.h, 14 * u)
  g.clip()
  g.fillStyle = 'rgba(0,0,0,0.06)'
  g.fillRect(pg.x, pg.y, pg.w, Math.max(1, u))
  // Loading: a thin bar runs across under the address.
  if (cur && t >= cur.l.enter && t < cur.l.outAt + 0.2) {
    const v = easeOut(prog(t, cur.l.enter, cur.l.outAt + 0.15 - cur.l.enter))
    g.fillStyle = st.accent
    g.globalAlpha *= 1 - prog(t, cur.l.outAt, 0.2)
    g.fillRect(pg.x, pg.y, pg.w * v, 3 * u)
    g.globalAlpha = 1
  }
  if (shown >= 0) {
    const l = S.lines[shown]
    const k = easeOut(prog(t, l.outAt, 0.35))
    g.globalAlpha *= k
    const pad = pg.w * 0.05
    const dy = (1 - k) * 12 * u
    const it = c.b.items[shown]
    const img = imageOf(c, it)
    const colW = img ? pg.w * 0.5 : pg.w - pad * 2
    const hs = Math.min(pg.h * 0.13, c.H * 0.05)
    text(c, l.out || l.text, pg.x + pad, pg.y + pad * 0.9 + hs + dy, { size: hs, weight: 800, color: '#15171c', align: 'left', maxW: colW - pad * 0.5 })
    g.fillStyle = st.accent
    g.fillRect(pg.x + pad, pg.y + pad * 0.9 + hs * 1.45 + dy, hs * 1.6, Math.max(2, hs * 0.1))
    skeleton(c, pg.x + pad, pg.y + pad * 0.9 + hs * 2.1 + dy, colW - pad * 0.8, hs * 0.26, 5)
    if (img) {
      const ir: Rect = { x: pg.x + pg.w * 0.55, y: pg.y + pad * 0.8 + dy, w: pg.w * 0.4, h: pg.h - pad * 1.6 }
      g.save()
      roundRect(g, ir.x, ir.y, ir.w, ir.h, 10 * u)
      g.clip()
      drawCover(g, img, ir.x, ir.y, ir.w, ir.h)
      g.restore()
    }
    g.globalAlpha = 1
  }
  g.restore()
}

// -- chat ---------------------------------------------------------------------

function drawChat(c: Ctx, w: Rect, S: Script): void {
  const g = c.g
  const st = c.b.style
  const t = c.t
  const u = c.u
  const bar = c.H * 0.056
  frame(c, w, '#f4f5f7', bar)
  // Who you are talking to.
  const av = bar * 0.62
  g.fillStyle = st.accent
  g.beginPath()
  g.arc(w.x + w.w / 2 - av * 2.2, w.y + bar / 2, av / 2, 0, Math.PI * 2)
  g.fill()
  const name = c.b.title || 'Chat'
  text(c, name.slice(0, 1).toUpperCase(), w.x + w.w / 2 - av * 2.2, w.y + bar / 2 + av * 0.18, { size: av * 0.5, weight: 800, color: '#fff', align: 'center' })
  text(c, name, w.x + w.w / 2 - av * 1.6, w.y + bar * 0.64, { size: bar * 0.36, weight: 700, color: '#23262d', align: 'left', maxW: w.w * 0.4 })
  g.fillStyle = 'rgba(0,0,0,0.07)'
  g.fillRect(w.x, w.y + bar, w.w, Math.max(1, u))
  // The box you type in.
  const ib: Rect = { x: w.x + bar * 0.4, y: w.y + w.h - bar * 1.2, w: w.w - bar * 1.6, h: bar * 0.9 }
  g.fillStyle = '#ffffff'
  roundRect(g, ib.x, ib.y, ib.w, ib.h, ib.h / 2)
  g.fill()
  g.strokeStyle = 'rgba(0,0,0,0.1)'
  g.lineWidth = Math.max(1, u)
  g.stroke()
  const fs = ib.h * 0.48
  const cur = current(S, t)
  const inBox = cur && t < cur.l.enter ? typed(cur.l, t).s : ''
  g.font = sans(fs, 500)
  if (inBox) text(c, inBox, ib.x + ib.h * 0.5, ib.y + ib.h * 0.66, { size: fs, weight: 500, color: '#23262d', align: 'left' })
  else text(c, 'Message', ib.x + ib.h * 0.5, ib.y + ib.h * 0.66, { size: fs, weight: 500, color: 'rgba(35,38,45,0.35)', align: 'left' })
  if (cur && t < cur.l.enter && t >= cur.l.at[0] - 0.3) caret(c, ib.x + ib.h * 0.5 + (inBox ? g.measureText(inBox).width + 2 * u : 0), ib.y + ib.h * 0.72, fs * 1.1, '#23262d')
  // Send: lights up with text in the box, pressed on Enter.
  const sx = w.x + w.w - bar * 0.7
  const sy = ib.y + ib.h / 2
  const hot = inBox ? 1 : 0.35
  g.fillStyle = st.accent
  g.globalAlpha *= hot
  g.beginPath()
  g.arc(sx, sy, ib.h * 0.42, 0, Math.PI * 2)
  g.fill()
  g.globalAlpha /= hot
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(sx - ib.h * 0.14, sy - ib.h * 0.16)
  g.lineTo(sx + ib.h * 0.18, sy)
  g.lineTo(sx - ib.h * 0.14, sy + ib.h * 0.16)
  g.closePath()
  g.fill()
  // The conversation, from the bottom up.
  type Bubble = { s: string; me: boolean; at: number; dots?: boolean }
  const bubbles: Bubble[] = []
  for (const l of S.lines) {
    if (t < l.enter) break
    if (l.text) bubbles.push({ s: l.text, me: true, at: l.enter })
    if (l.out) {
      // Typing dots from a moment after yours goes (or, when they write
      // first, for most of the wait), then the reply.
      const dots = l.text ? Math.min(l.enter + 0.3, l.outAt - 0.2) : l.enter + (l.outAt - l.enter) * 0.25
      if (t >= l.outAt) bubbles.push({ s: l.out, me: false, at: l.outAt })
      else if (t >= dots) bubbles.push({ s: '', me: false, at: dots, dots: true })
    }
  }
  const area: Rect = { x: w.x, y: w.y + bar, w: w.w, h: ib.y - (w.y + bar) - bar * 0.25 }
  g.save()
  g.beginPath()
  g.rect(area.x, area.y, area.w, area.h)
  g.clip()
  const bs = Math.min(c.H * 0.03, area.h * 0.11)
  const maxW = w.w * 0.62
  let y = area.y + area.h
  for (let i = bubbles.length - 1; i >= 0 && y > area.y; i--) {
    const bb = bubbles[i]
    g.font = sans(bs, 500)
    const tw = bb.dots ? bs * 2.4 : Math.min(maxW, g.measureText(bb.s).width)
    const bw = tw + bs * 1.3
    const bh = bs * 1.9
    const k = easeOut(prog(t, bb.at, 0.25))
    y -= bh + bs * 0.45
    const x = bb.me ? w.x + w.w - bar * 0.4 - bw : w.x + bar * 0.4
    g.save()
    g.globalAlpha *= k
    g.translate(0, (1 - k) * bs * 0.8)
    g.fillStyle = bb.me ? st.accent : '#ffffff'
    roundRect(g, x, y, bw, bh, bh * 0.45)
    g.fill()
    if (!bb.me) {
      g.strokeStyle = 'rgba(0,0,0,0.08)'
      g.lineWidth = Math.max(1, u)
      g.stroke()
    }
    if (bb.dots) {
      for (let d = 0; d < 3; d++) {
        const lift = Math.max(0, Math.sin((t * 6 - d * 0.7) % (Math.PI * 2)))
        g.fillStyle = `rgba(35,38,45,${(0.3 + 0.35 * lift).toFixed(3)})`
        g.beginPath()
        g.arc(x + bs * 0.95 + d * bs * 0.62, y + bh / 2 - lift * bs * 0.12, bs * 0.16, 0, Math.PI * 2)
        g.fill()
      }
    } else {
      text(c, bb.s, x + bs * 0.65, y + bh * 0.66, { size: bs, weight: 500, color: bb.me ? '#ffffff' : '#23262d', align: 'left', maxW: maxW })
    }
    g.restore()
  }
  g.restore()
}

// -- notes --------------------------------------------------------------------

function drawNotes(c: Ctx, w: Rect, S: Script): void {
  const g = c.g
  const st = c.b.style
  const t = c.t
  const u = c.u
  const bar = c.H * 0.045
  frame(c, w, '#fbf8f1', bar)
  const pad = w.w * 0.06
  const hs = Math.min(c.H * 0.042, w.h * 0.1)
  text(c, c.b.title || 'Notes', w.x + pad, w.y + bar + hs * 1.3, { size: hs, weight: 800, color: '#1d1b17', align: 'left', maxW: w.w - pad * 2 })
  const fs = hs * 0.66
  const lh = fs * 1.75
  const top = w.y + bar + hs * 2.3
  // Faint rules.
  g.strokeStyle = 'rgba(60,50,30,0.08)'
  g.lineWidth = Math.max(1, u)
  for (let y = top + lh * 0.35; y < w.y + w.h - lh * 0.3; y += lh) {
    g.beginPath()
    g.moveTo(w.x + pad * 0.6, y)
    g.lineTo(w.x + w.w - pad * 0.6, y)
    g.stroke()
  }
  g.save()
  g.beginPath()
  g.rect(w.x, top - lh, w.w, w.y + w.h - top + lh * 0.6)
  g.clip()
  const rows: { s: string; note: boolean; caret: boolean }[] = []
  for (const l of S.lines) {
    if (t < l.at[0] - 0.05 && l !== S.lines[0]) break
    const { s, typing } = typed(l, t)
    if (l.text) rows.push({ s, note: false, caret: typing })
    if (l.out && t >= l.outAt) rows.push({ s: l.out, note: true, caret: false })
    if (typing) break
  }
  const fit = Math.max(1, Math.floor((w.y + w.h - top) / lh))
  let y = top
  for (const r of rows.slice(Math.max(0, rows.length - fit))) {
    const x = w.x + pad + (r.note ? fs * 1.2 : 0)
    if (!r.note) {
      g.fillStyle = st.accent
      g.beginPath()
      g.arc(w.x + pad - fs * 0.7, y - fs * 0.32, fs * 0.16, 0, Math.PI * 2)
      g.fill()
    }
    text(c, r.s, x, y, { size: r.note ? fs * 0.86 : fs, weight: r.note ? 500 : 600, color: r.note ? 'rgba(29,27,23,0.5)' : '#1d1b17', align: 'left', maxW: w.w - pad * 2.2 })
    if (r.caret) {
      g.font = sans(fs, 600)
      caret(c, x + g.measureText(r.s).width + 2 * u, y + fs * 0.12, fs * 1.1, st.accent)
    }
    y += lh
  }
  g.restore()
}

// -- search -------------------------------------------------------------------

function drawSearch(c: Ctx, w: Rect, S: Script): void {
  const g = c.g
  const st = c.b.style
  const t = c.t
  const u = c.u
  const bar = c.H * 0.045
  frame(c, w, '#ffffff', bar)
  const cur = current(S, t)
  let shown = -1
  S.lines.forEach((l, i) => {
    if (t >= l.outAt) shown = i
  })
  // Before the first search the box sits in the middle under the name; with
  // results it moves up to the top.
  const up = S.lines.length ? easeOut(prog(t, S.lines[0].enter, 0.4)) : 0
  const sw = w.w * (0.7 - 0.08 * up)
  const sh = bar * 0.95
  const cy = w.y + w.h * 0.5 + (w.y + bar * 1.6 - (w.y + w.h * 0.5)) * up
  const sx = w.x + (w.w - sw) / 2 - (w.w * 0.1) * up
  const logo = c.b.title || 'Search'
  const ls = Math.min(c.H * 0.06, w.h * 0.14)
  if (up < 1) text(c, logo, w.x + w.w / 2, cy - sh * 0.9, { size: ls, weight: 800, color: st.accent, align: 'center', alpha: 1 - up, maxW: w.w * 0.7 })
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.12)'
  g.shadowBlur = 10 * u
  g.shadowOffsetY = 2 * u
  g.fillStyle = '#ffffff'
  roundRect(g, sx, cy - sh / 2, sw, sh, sh / 2)
  g.fill()
  g.restore()
  g.strokeStyle = 'rgba(0,0,0,0.12)'
  g.lineWidth = Math.max(1, u)
  roundRect(g, sx, cy - sh / 2, sw, sh, sh / 2)
  g.stroke()
  // Magnifier.
  const mr = sh * 0.17
  g.strokeStyle = '#5b6170'
  g.lineWidth = Math.max(1.2, sh * 0.06)
  g.beginPath()
  g.arc(sx + sh * 0.5, cy - mr * 0.2, mr, 0, Math.PI * 2)
  g.moveTo(sx + sh * 0.5 + mr * 0.7, cy + mr * 0.5)
  g.lineTo(sx + sh * 0.5 + mr * 1.5, cy + mr * 1.3)
  g.stroke()
  const fs = sh * 0.4
  if (cur) {
    const { s, typing } = typed(cur.l, t)
    const q = s || (cur.i > 0 ? S.lines[cur.i - 1].text : '')
    text(c, q, sx + sh * 0.95, cy + fs * 0.36, { size: fs, weight: 500, color: '#23262d', align: 'left', maxW: sw - sh * 1.4 })
    if (typing && t >= cur.l.at[0] - 0.3) {
      g.font = sans(fs, 500)
      caret(c, sx + sh * 0.95 + g.measureText(s).width + 2 * u, cy + fs * 0.42, fs * 1.15, '#23262d')
    }
  }
  // Searching: after Enter, a moment of the bar running under the box and
  // the page's grey shapes breathing, before the results.
  const pending = S.lines.findIndex((l) => l.text && t >= l.enter && t < l.outAt)
  if (pending >= 0) {
    const l = S.lines[pending]
    const p = clamp01((t - l.enter) / Math.max(0.2, l.outAt - l.enter))
    g.fillStyle = st.accent
    g.fillRect(w.x, w.y + bar, w.w * (0.15 + 0.8 * easeOut(p)), 3 * u)
    const x = sx + sh * 0.3
    let y = w.y + bar * 2.6
    const rs = Math.min(c.H * 0.03, w.h * 0.07)
    g.save()
    g.globalAlpha *= 0.35 + 0.25 * Math.sin(t * 7)
    for (let r = 0; r < 3; r++) {
      skeleton(c, x, y, rs * 7, rs * 0.3, 1, 0.8)
      skeleton(c, x, y + rs * 0.9, w.w * 0.4, rs * 0.45, 1, 0.9)
      skeleton(c, x, y + rs * 2.1, w.w * 0.6, rs * 0.28, 2, 0.9)
      y += rs * 3.9
    }
    g.restore()
  }
  // Results: the top one with its site, its headline and its picture.
  if (shown >= 0 && pending < 0) {
    const l = S.lines[shown]
    const k = easeOut(prog(t, l.outAt, 0.35))
    const x = sx + sh * 0.3
    let y = w.y + bar * 2.6
    const rs = Math.min(c.H * 0.03, w.h * 0.07)
    const item = c.b.items[shown]
    const img = imageOf(c, item)
    // "Headline | site.com" names the site; else it is made from the words.
    const [head, site0] = (l.out || l.text).split(/\s*[|—]\s*/)
    const site = (site0 || `www.${(l.text.split(/\s+/)[0] || 'search').toLowerCase().replace(/[^a-z0-9ğüşıöç]/g, '')}.com`).trim()
    g.save()
    g.beginPath()
    g.rect(w.x, w.y + bar * 2.2, w.w, w.h - bar * 2.2)
    g.clip()
    for (let r = 0; r < 3; r++) {
      const kr = easeOut(prog(t, l.outAt + r * 0.08, 0.3))
      g.globalAlpha = kr
      const dy = (1 - kr) * 10 * u
      if (r === 0) {
        // The site: a round mark with its letter, its name and address.
        const fr = rs * 0.55
        g.fillStyle = st.accent
        g.beginPath()
        g.arc(x + fr, y + fr * 0.4 + dy, fr, 0, Math.PI * 2)
        g.fill()
        text(c, site[0]?.toUpperCase() ?? 'S', x + fr, y + fr * 0.75 + dy, { size: fr * 1.1, weight: 800, color: '#ffffff', align: 'center' })
        text(c, site.replace(/^www\./, ''), x + fr * 2.6, y + fr * 0.2 + dy, { size: rs * 0.55, weight: 600, color: '#23262d', align: 'left', maxW: w.w * 0.4 })
        text(c, `https://${site}`, x + fr * 2.6, y + fr * 1.05 + dy, { size: rs * 0.45, weight: 500, color: '#5b6170', align: 'left', maxW: w.w * 0.4 })
        text(c, head || l.text, x, y + rs * 2.2 + dy, { size: rs, weight: 700, color: '#1a4fd6', align: 'left', maxW: img ? w.w * 0.55 : w.w * 0.62 })
        skeleton(c, x, y + rs * 2.8 + dy, img ? w.w * 0.52 : w.w * 0.6, rs * 0.28, 2, 0.9)
        if (img) {
          const th = searchThumb(w, c.H)
          g.save()
          roundRect(g, th.x, th.y + dy, th.w, th.h, 8 * u)
          g.clip()
          drawCover(g, img, th.x, th.y + dy, th.w, th.h)
          g.restore()
        }
        y += rs * 4.6
        continue
      }
      skeleton(c, x, y + dy, rs * 7, rs * 0.3, 1, 0.8)
      g.fillStyle = 'rgba(40,90,200,0.22)'
      roundRect(g, x, y + rs * 0.75 + dy, w.w * (0.34 + 0.08 * r), rs * 0.55, rs * 0.27)
      g.fill()
      skeleton(c, x, y + rs * 2.1 + dy, w.w * 0.6, rs * 0.28, 2, 0.9)
      y += rs * 3.9
    }
    g.globalAlpha = k
    g.restore()
  }
}

/**
 * The top result's picture, tapped: it grows out of its place in the window
 * to fill the frame — the thing searched for, found — and stays.
 */
export function drawSearchOpen(c: Ctx, w: Rect, S: Script): void {
  const t = c.t
  let pick = -1
  S.lines.forEach((l, i) => {
    if (l.text && c.b.items[i]?.assetId && t >= l.outAt + SEARCH_OPEN) pick = i
  })
  if (pick < 0) return
  const img = imageOf(c, c.b.items[pick])
  if (!img) return
  const l = S.lines[pick]
  const e = easeOut(prog(t, l.outAt + SEARCH_OPEN + 0.05, 0.55))
  const th = searchThumb(w, c.H)
  const x = th.x + (c.x0 - th.x) * e
  const y = th.y + (0 - th.y) * e
  const ww = th.w + (c.W - th.w) * e
  const hh = th.h + (c.H - th.h) * e
  const g = c.g
  g.save()
  g.shadowColor = `rgba(0,0,0,${(0.45 * (1 - e)).toFixed(3)})`
  g.shadowBlur = 30 * c.u
  roundRect(g, x, y, ww, hh, 8 * c.u * (1 - e))
  g.fillStyle = '#000'
  g.fill()
  g.restore()
  g.save()
  roundRect(g, x, y, ww, hh, 8 * c.u * (1 - e))
  g.clip()
  drawCover(g, img, x, y, ww, hh)
  g.restore()
}

export type ScreenKind = 'browser' | 'chat' | 'notes' | 'search'

/** Draws the window of a typing screen other than the terminal. */
export function drawScreen(c: Ctx, kind: ScreenKind, w: Rect, S: Script): void {
  if (kind === 'browser') drawBrowser(c, w, S)
  else if (kind === 'chat') drawChat(c, w, S)
  else if (kind === 'notes') drawNotes(c, w, S)
  else drawSearch(c, w, S)
}
