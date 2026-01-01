// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A verse or a quote, set like a page of a fine book: a panel glides in from
// the side you choose (or drops from the top), the words come up one after
// another, a thin rule draws itself and the reference settles under it.
// For a verse, a quiet eight-pointed star marks it and the original line (in
// Arabic, say) can sit above the translation, revealed right to left; for a
// quote, a large opening mark. It leaves the video
// playing beside it.

import type { TemplateBlock } from '../types'
import { clamp01, fontOf, prog, text, type Ctx } from './draw'

type Rect = { x: number; y: number; w: number; h: number }

const SERIF = 'Merriweather'
const ARABIC = '"Amiri", "Scheherazade New", "Traditional Arabic", "Sakkal Majalla", "Arabic Typesetting", "Segoe UI", serif'
const easeOutExpo = (u: number): number => (u >= 1 ? 1 : 1 - 2 ** (-10 * clamp01(u)))
const easeIn = (u: number): number => clamp01(u) ** 3

export const quoteFrom = (b: Pick<TemplateBlock, 'from'>): 'left' | 'right' | 'top' => (b.from === 'right' || b.from === 'top' ? b.from : 'left')
export const quoteDesign = (b: Pick<TemplateBlock, 'design'>): 'verse' | 'quote' => (b.design === 'verse' ? 'verse' : 'quote')
/** How big the panel is: 1 the full side panel, less a card of that size. */
export const quoteSize = (b: Pick<TemplateBlock, 'size'>): number => Math.max(0.3, Math.min(1, b.size ?? 1))

/** Where the panel sits once it is in (frame pixels). */
export function quotePanel(b: Pick<TemplateBlock, 'from'>, left: number, W: number, H: number): Rect {
  const from = quoteFrom(b)
  const portrait = W / H < 1
  if (from === 'top') return portrait ? { x: left, y: 0, w: W, h: H * 0.46 } : { x: left, y: 0, w: W, h: H * 0.48 }
  if (portrait) return { x: from === 'left' ? left : left + W * 0.08, y: H * 0.16, w: W * 0.92, h: H * 0.56 }
  const w = W * 0.44
  return { x: from === 'left' ? left : left + W - w, y: 0, w, h: H }
}

/** The eight-pointed star: two squares turned against each other. */
function star(c: Ctx, x: number, y: number, R: number, k: number): void {
  const g = c.g
  g.save()
  g.translate(x, y)
  g.rotate((1 - k) * -0.4)
  g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k)
  g.strokeStyle = c.b.style.accent
  g.lineWidth = Math.max(1, R * 0.07)
  g.lineJoin = 'miter'
  for (const turn of [0, Math.PI / 4]) {
    g.save()
    g.rotate(turn)
    g.strokeRect(-R * 0.7, -R * 0.7, R * 1.4, R * 1.4)
    g.restore()
  }
  g.beginPath()
  g.arc(0, 0, R * 0.32, 0, Math.PI * 2)
  g.stroke()
  g.restore()
}

/** Words set in lines to a width: each word's place, its line's width. */
function setWords(g: Ctx['g'], words: string[], font: string, maxW: number): { lines: { word: string; x: number }[][]; widths: number[] } {
  g.font = font
  const space = g.measureText(' ').width
  const lines: { word: string; x: number }[][] = [[]]
  const widths = [0]
  for (const w of words) {
    const ww = g.measureText(w).width
    const line = lines[lines.length - 1]
    const x = widths[widths.length - 1]
    if (line.length && x + space + ww > maxW) {
      lines.push([{ word: w, x: 0 }])
      widths.push(ww)
    } else {
      line.push({ word: w, x: line.length ? x + space : 0 })
      widths[widths.length - 1] = (line.length > 1 ? x + space : 0) + ww
    }
  }
  return { lines, widths }
}

export function drawQuote(c: Ctx): void {
  const g = c.g
  const b = c.b
  const st = b.style
  const { x0, W, H, u, t } = c
  const D = b.duration
  const from = quoteFrom(b)
  const verse = quoteDesign(b) === 'verse'
  const portrait = c.portrait
  // Smaller than full: a card off the edge, as tall as its words.
  const k = quoteSize(b)
  const card = k < 0.999
  const margin = Math.min(W, H) * 0.04
  let P = quotePanel(b, x0, W, H)
  if (card) {
    const w = from === 'top' ? W * (0.3 + 0.62 * k) : portrait ? W * (0.52 + 0.4 * k) : W * 0.44 * (0.42 + 0.58 * k)
    P = { x: from === 'left' ? x0 + margin : from === 'right' ? x0 + W - margin - w : x0 + (W - w) / 2, y: margin, w, h: H - margin * 2 }
  }
  const inK = easeOutExpo(prog(t, 0, 0.8))
  const outK = easeIn(prog(t, D - 0.55, 0.55))
  const shown = inK * (1 - outK)
  if (shown <= 0.001) return
  // Off the frame on its own side, gliding in.
  const away = 1 - inK + outK

  // The video dims a little towards the panel.
  g.save()
  const scrim =
    from === 'top'
      ? g.createLinearGradient(0, 0, 0, H)
      : from === 'left'
        ? g.createLinearGradient(x0, 0, x0 + W, 0)
        : g.createLinearGradient(x0 + W, 0, x0, 0)
  // A card only shades the picture a little.
  const shade = shown * (card ? 0.25 + 0.6 * k : 1)
  scrim.addColorStop(0, `rgba(0,0,0,${(0.42 * shade).toFixed(3)})`)
  scrim.addColorStop(0.7, `rgba(0,0,0,${(0.12 * shade).toFixed(3)})`)
  scrim.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = scrim
  g.fillRect(x0, 0, W, H)
  g.restore()

  // The words, laid out first (a card is then made as tall as they are).
  const pad = Math.min(P.w, card ? P.w : P.h) * (portrait ? 0.09 : 0.1)
  const box: Rect = { x: P.x + pad * (from === 'top' ? 1.4 : 1), y: P.y + pad * 0.8, w: P.w - pad * (from === 'top' ? 2.8 : 2), h: P.h - pad * 1.6 }
  const ref = b.items[0]
  const orig = verse ? b.items[1]?.title?.trim() : ''
  const family = st.font === 'Archivo Black' ? SERIF : st.font
  const shrink = card ? 0.55 + 0.45 * k : 1
  const markSize = Math.min(H, W) * (portrait ? 0.05 : 0.045) * shrink
  const markH = verse ? markSize * 2 : markSize * 1.9
  const as = orig ? Math.min(H * 0.055 * shrink, box.w / 12) : 0
  const origH = orig ? as * 1.9 : 0
  const rs = Math.min(H * 0.026, 24 * u) * (card ? 0.72 + 0.28 * k : 1)
  const refH = ref?.title ? rs * (ref.note ? 4.4 : 3) : 0
  const words = (b.title || '').split(/\s+/).filter(Boolean)
  const room = box.h - markH - origH - refH
  let size = Math.min(H * (portrait ? 0.05 : 0.062) * shrink, box.w / 8)
  let set = setWords(g, words, fontOf(size, family, 400), box.w)
  while (size > 12 * u && set.lines.length * size * 1.55 > room) {
    size *= 0.93
    set = setWords(g, words, fontOf(size, family, 400), box.w)
  }
  const lh = size * 1.55
  const total = markH + origH + set.lines.length * lh + size * 0.4 + refH
  if (card) {
    const h = Math.min(H - margin * 2, total + pad * 1.6)
    P = { ...P, h, y: from === 'top' ? margin : portrait ? Math.max(margin, H * 0.42 - h / 2) : (H - h) / 2 }
    box.y = P.y + pad * 0.8
    box.h = P.h - pad * 1.6
  }
  const off = card ? margin : 0
  const dx = from === 'left' ? -away * (P.w + off + 40 * u) : from === 'right' ? away * (P.w + off + 40 * u) : 0
  const dy = from === 'top' ? -away * (P.y + P.h + 40 * u) : 0

  // The panel: deep, a soft light falling across it, a hairline of the
  // accent on the edge that faces the picture.
  g.save()
  g.translate(dx, dy)
  const r = card ? 16 * u : portrait && from !== 'top' ? 18 * u : 0
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.5)'
  g.shadowBlur = 50 * u
  g.fillStyle = st.card
  g.beginPath()
  g.roundRect(P.x, P.y, P.w, P.h, r)
  g.fill()
  g.restore()
  const light = g.createLinearGradient(P.x, P.y, P.x + P.w, P.y + P.h)
  light.addColorStop(0, 'rgba(255,255,255,0.06)')
  light.addColorStop(0.55, 'rgba(255,255,255,0.0)')
  light.addColorStop(1, 'rgba(0,0,0,0.18)')
  g.fillStyle = light
  g.beginPath()
  g.roundRect(P.x, P.y, P.w, P.h, r)
  g.fill()
  g.fillStyle = st.accent
  const hl = 2.5 * u
  if (from === 'left') g.fillRect(P.x + P.w - hl, P.y, hl, P.h)
  else if (from === 'right') g.fillRect(P.x, P.y, hl, P.h)
  else g.fillRect(P.x, P.y + P.h - hl, P.w, hl)

  // The block of words set in the middle of the panel.
  let top = box.y + Math.max(0, (box.h - total) / 2)
  // The mark at the head.
  const kMark = easeOutExpo(prog(t, 0.35, 0.8))
  if (verse) {
    star(c, box.x + markSize * 0.75, top + markSize * 0.75, markSize * 0.75, kMark)
  } else {
    g.save()
    g.globalAlpha *= kMark
    text(c, '“', box.x - markSize * 0.15, top + markSize * 2.6, { size: markSize * 4.2, family: SERIF, weight: 700, color: st.accent })
    g.restore()
  }
  top += markH
  // The original line, right to left, above the translation.
  if (orig) {
    const kA = clamp01(prog(t, 0.55, 1.1))
    g.save()
    g.beginPath()
    g.rect(box.x + box.w * (1 - kA), top - as * 0.3, box.w * kA + 4 * u, as * 1.8)
    g.clip()
    g.font = `400 ${as.toFixed(1)}px ${ARABIC}`
    g.direction = 'rtl'
    g.textAlign = from === 'right' || from === 'top' ? 'right' : 'right'
    g.textBaseline = 'alphabetic'
    g.fillStyle = st.ink
    g.globalAlpha *= 0.92
    let fs = as
    while (fs > as * 0.5 && g.measureText(orig).width > box.w) {
      fs *= 0.92
      g.font = `400 ${fs.toFixed(1)}px ${ARABIC}`
    }
    g.fillText(orig, box.x + box.w, top + as * 1.05)
    g.restore()
    top += origH
  }
  // The text itself, each word rising in turn.
  const w0 = 0.7
  const each = Math.min(0.11, Math.max(0.03, (D * 0.45 - w0) / Math.max(1, words.length)))
  let n = 0
  set.lines.forEach((line, li) => {
    for (const w of line) {
      const k = easeOutExpo(prog(t, w0 + n * each, 0.6))
      n++
      if (k <= 0.001) continue
      g.save()
      g.globalAlpha *= k
      text(c, w.word, box.x + w.x, top + size + li * lh + (1 - k) * size * 0.35, { size, family, weight: 400, color: st.ink })
      g.restore()
    }
  })
  const textEnd = w0 + n * each + 0.3
  top += set.lines.length * lh + size * 0.4
  // The rule and the reference.
  if (ref?.title) {
    const rk = easeOutExpo(prog(t, textEnd, 0.7))
    g.fillStyle = st.accent
    g.fillRect(box.x, top, box.w * 0.18 * rk, Math.max(1.5, 2 * u))
    const kr = easeOutExpo(prog(t, textEnd + 0.2, 0.6))
    g.save()
    g.globalAlpha *= kr
    ;(g as CanvasRenderingContext2D).letterSpacing = `${(rs * 0.14).toFixed(1)}px`
    text(c, ref.title.toLocaleUpperCase(), box.x, top + rs * 2.1 + (1 - kr) * 6 * u, { size: rs, weight: 700, color: st.accent, maxW: box.w })
    ;(g as CanvasRenderingContext2D).letterSpacing = '0px'
    if (ref.note) text(c, ref.note, box.x, top + rs * 3.7 + (1 - kr) * 6 * u, { size: rs * 0.9, weight: 500, color: st.ink, alpha: 0.6, maxW: box.w })
    g.restore()
  }
  g.restore()
}
