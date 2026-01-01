// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The word in the news: one word, match-cut across page after page — a
// broadsheet, a news site, a tabloid, a pink financial paper, a phone, an old
// yellowed paper, a magazine — each cut quicker than the last. The word never
// moves: the camera holds it dead centre at one size, lit by the same marker,
// while the world round it changes. The pages fill the frame — a paper goes on
// into the next pages of its spread, a site or an app into its own ground —
// and each is made of something: paper has its grain and its ink its specks,
// a screen its pixels.

import { newsTimes } from './model'
import { clamp01, drawCover, fontOf, imageOf, outCubic, type Ctx } from './draw'
import type { TemplateItem } from '../types'

type G = Ctx['g']
type Rect = { x: number; y: number; w: number; h: number }

const fold = (s: string): string => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^\p{L}\p{N}]/gu, '')

/** Deterministic noise in [0, 1). */
function rnd(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Page {
  g: G
  word: string
  item: TemplateItem
  i: number
  /** How far the marker has swept over the word (0..1). */
  mark: number
  accent: string
  img: CanvasImageSource | null
  /** Words to set the small print in (from all the headlines). */
  filler: string[]
  /** Turkish headlines capitalise the Turkish way (i → İ). */
  locale: string | undefined
}

/**
 * A headline set in lines, the word found in it (or put in front of it) —
 * the marker drawn under the word, then the words. Returns the word's box.
 */
function headline(
  P: Page,
  x: number,
  y: number,
  maxW: number,
  size: number,
  o: { family: string; weight: number; color: string; upper?: boolean; lead?: number; align?: 'left' | 'center' }
): Rect {
  const g = P.g
  const tx = (s: string): string => (o.upper ? s.toLocaleUpperCase(P.locale) : s)
  let words = P.item.title.trim().split(/\s+/).filter(Boolean)
  const target = P.word.trim().split(/\s+/).filter(Boolean)
  const tf = target.map(fold)
  let at = words.findIndex((_, k) => tf.every((w, j) => k + j < words.length && fold(words[k + j]).startsWith(w)))
  if (at < 0) {
    words = [...target, ...words]
    at = 0
  }
  g.font = fontOf(size, o.family, o.weight)
  const space = g.measureText(' ').width
  const lines: { words: string[]; first: number }[] = []
  let cur: string[] = []
  let first = 0
  let w = 0
  words.forEach((wd, k) => {
    const ww = g.measureText(tx(wd)).width
    // Never break inside the word we are matching on.
    const inWord = k > at && k < at + target.length
    if (cur.length && w + space + ww > maxW && !inWord) {
      lines.push({ words: cur, first })
      cur = []
      first = k
      w = 0
    }
    w += (cur.length ? space : 0) + ww
    cur.push(wd)
  })
  if (cur.length) lines.push({ words: cur, first })
  const lead = size * (o.lead ?? 1.12)
  let box: Rect = { x: x, y: y, w: 10, h: size }
  const placed: { s: string; x: number; y: number; hit: boolean }[] = []
  lines.forEach((ln, li) => {
    const line = ln.words.map(tx).join(' ')
    const lw = g.measureText(line).width
    let cx = o.align === 'center' ? x + (maxW - lw) / 2 : x
    const by = y + size * 0.82 + li * lead
    ln.words.forEach((wd, j) => {
      const k = ln.first + j
      const s = tx(wd)
      const ww = g.measureText(s).width
      const hit = k >= at && k < at + target.length
      if (hit) {
        if (k === at) box = { x: cx, y: by - size * 0.8, w: ww, h: size }
        else box = { x: box.x, y: box.y, w: cx + ww - box.x, h: box.h }
      }
      placed.push({ s, x: cx, y: by, hit })
      cx += ww + space
    })
  })
  // The marker: a flat band a little bigger than the word, swept in from the
  // left, its ends not quite square.
  if (P.mark > 0) {
    const padX = size * 0.12
    const mx = box.x - padX
    const mw = (box.w + padX * 2) * P.mark
    g.fillStyle = P.accent
    g.beginPath()
    g.moveTo(mx + size * 0.03, box.y + size * 0.02)
    g.lineTo(mx + mw, box.y - size * 0.01)
    g.lineTo(mx + mw - size * 0.02, box.y + box.h + size * 0.06)
    g.lineTo(mx, box.y + box.h + size * 0.08)
    g.closePath()
    g.fill()
  }
  for (const p of placed) {
    g.fillStyle = p.hit && P.mark > 0.5 ? '#0b0b0d' : o.color
    g.fillText(p.s, p.x, p.y)
  }
  return box
}

/** Small print: lines of real words (from the headlines), set justified-ish. */
function body(P: Page, x: number, y: number, w: number, lines: number, size: number, color: string, family = 'Inter', seed = 0, lead = 1.55): void {
  const g = P.g
  g.font = fontOf(size, family, 400)
  g.fillStyle = color
  let k = seed * 7
  for (let l = 0; l < lines; l++) {
    let s = ''
    const last = l === lines - 1
    const room = last ? w * (0.35 + 0.4 * rnd(seed, l)) : w
    while (g.measureText(s).width < room - size * 3) s += (s ? ' ' : '') + P.filler[k++ % P.filler.length]
    g.fillText(s, x, y + l * size * lead, room)
  }
}

/** The article's picture, or a quiet stand-in. */
function picture(P: Page, x: number, y: number, w: number, h: number, tint: string): void {
  const g = P.g
  if (P.img) {
    drawCover(g, P.img, x, y, w, h)
    return
  }
  const gr = g.createLinearGradient(x, y, x + w, y + h)
  gr.addColorStop(0, tint)
  gr.addColorStop(1, '#1d2230')
  g.fillStyle = gr
  g.fillRect(x, y, w, h)
  // Soft shapes: a horizon, a sun — enough to read as a photo at speed.
  g.fillStyle = 'rgba(255,255,255,0.14)'
  g.beginPath()
  g.arc(x + w * (0.3 + 0.4 * rnd(P.i, 3)), y + h * 0.38, h * 0.14, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(0,0,0,0.22)'
  g.beginPath()
  g.moveTo(x, y + h * 0.72)
  for (let k = 0; k <= 8; k++) g.lineTo(x + (w * k) / 8, y + h * (0.62 + 0.12 * rnd(P.i, k)))
  g.lineTo(x + w, y + h)
  g.lineTo(x, y + h)
  g.closePath()
  g.fill()
}

function rule(g: G, x: number, y: number, w: number, lw: number, color: string): void {
  g.fillStyle = color
  g.fillRect(x, y, w, lw)
}

const DATE = 'MONDAY, 14 OCTOBER'

/** What a page is made of. */
type Stuff = 'paper' | 'gloss' | 'screen'

/** The facing pages of a paper's spread: the same paper, columns of small
 *  print, the fold between. Only what the frame sees (`vis`) is set. */
interface Spread {
  paper: string
  ink: string
  family: string
  size: number
  col: number
  gap: number
  top: number
}

interface Design {
  w: number
  h: number
  stuff: Stuff
  /** A paper: its facing pages round it. */
  spread?: Spread
  /** A site or an app: its ground going on, and what runs the full width. */
  ground?: string
  wide?: (g: G, vis: Rect) => void
  draw: (P: Page) => Rect
}

/** The pages, each its own world. Size in page units; returns the word's box. */
const DESIGNS: Design[] = [
  // A broadsheet: cream paper, a serif masthead, columns.
  {
    w: 1300,
    h: 1700,
    stuff: 'paper',
    spread: { paper: '#f3eee2', ink: '#3b3830', family: 'Merriweather', size: 19, col: 370, gap: 30, top: 290 },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#f3eee2'
      g.fillRect(0, 0, 1300, 1700)
      const ink = '#1a1814'
      g.font = fontOf(118, 'Merriweather', 900)
      g.fillStyle = ink
      g.textAlign = 'center'
      g.fillText(P.item.note || 'The Daily Chronicle', 650, 170, 1180)
      g.textAlign = 'left'
      rule(g, 60, 210, 1180, 6, ink)
      rule(g, 60, 222, 1180, 2, ink)
      g.font = fontOf(22, 'Merriweather', 700)
      g.fillText(DATE, 60, 256)
      g.textAlign = 'right'
      g.fillText('No. 48,211', 1240, 256)
      g.textAlign = 'left'
      rule(g, 60, 272, 1180, 2, ink)
      const box = headline(P, 60, 320, 1180, 104, { family: 'Merriweather', weight: 900, color: ink, lead: 1.08 })
      const top = box.y + 330
      picture(P, 60, top, 740, 480, '#6b7a8c')
      for (let c = 0; c < 3; c++) body(P, 60 + c * 400, top + 540, 370, 18, 19, '#3b3830', 'Merriweather', c + P.i)
      body(P, 840, top, 400, 22, 19, '#3b3830', 'Merriweather', 9 + P.i)
      return box
    }
  },
  // A news site: a black bar, a red tag, a big sans headline.
  {
    w: 1700,
    h: 1100,
    stuff: 'screen',
    ground: '#ffffff',
    wide: (g, vis) => {
      g.fillStyle = '#111214'
      g.fillRect(vis.x, 0, vis.w, 110)
    },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 1700, 1100)
      g.fillStyle = '#111214'
      g.fillRect(0, 0, 1700, 110)
      g.font = fontOf(48, 'Inter', 900)
      g.fillStyle = '#ffffff'
      g.fillText((P.item.note || 'Morning Herald').toUpperCase(), 60, 72)
      g.font = fontOf(22, 'Inter', 600)
      g.fillStyle = 'rgba(255,255,255,0.7)'
      ;['World', 'Business', 'Tech', 'Science', 'Opinion'].forEach((s, k) => g.fillText(s, 900 + k * 150, 66))
      g.fillStyle = '#e0302a'
      g.fillRect(100, 190, 190, 44)
      g.font = fontOf(24, 'Inter', 800)
      g.fillStyle = '#ffffff'
      g.fillText('BREAKING', 118, 221)
      const box = headline(P, 100, 262, 1020, 92, { family: 'Inter', weight: 800, color: '#111214', lead: 1.1 })
      g.font = fontOf(24, 'Inter', 500)
      g.fillStyle = '#6b6f78'
      g.fillText('By the newsroom · 4 min read', 100, box.y + 250)
      picture(P, 1180, 190, 420, 560, '#5a7896')
      body(P, 100, box.y + 320, 980, 12, 24, '#3a3d44', 'Inter', P.i)
      return box
    }
  },
  // A dark tech site: deep ground, a glowing tag.
  {
    w: 1700,
    h: 1100,
    stuff: 'screen',
    ground: '#0e1015',
    wide: (g, vis) => rule(g, vis.x, 130, vis.w, 1, 'rgba(255,255,255,0.12)'),
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#0e1015'
      g.fillRect(0, 0, 1700, 1100)
      g.font = fontOf(40, 'Inter', 800)
      g.fillStyle = '#e8eaf0'
      g.fillText(P.item.note || 'Techline', 80, 90)
      rule(g, 80, 130, 1540, 1, 'rgba(255,255,255,0.12)')
      g.strokeStyle = '#43e0c5'
      g.lineWidth = 2
      g.strokeRect(140, 230, 150, 40)
      g.font = fontOf(20, 'Inter', 700)
      g.fillStyle = '#43e0c5'
      g.fillText('ANALYSIS', 160, 257)
      const box = headline(P, 140, 300, 1300, 96, { family: 'Inter', weight: 800, color: '#f2f4f8', lead: 1.08 })
      body(P, 140, box.y + 260, 900, 10, 24, 'rgba(230,234,242,0.55)', 'Inter', P.i + 3)
      picture(P, 1100, box.y + 230, 460, 300, '#2a3a5a')
      return box
    }
  },
  // A tabloid: a red block masthead, a shouting headline.
  {
    w: 1300,
    h: 1700,
    stuff: 'paper',
    spread: { paper: '#fbfaf7', ink: '#2a2a2a', family: 'Inter', size: 21, col: 380, gap: 30, top: 300 },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#fbfaf7'
      g.fillRect(0, 0, 1300, 1700)
      g.fillStyle = '#d7201f'
      g.fillRect(50, 50, 700, 200)
      g.font = fontOf(150, 'Anton', 400)
      g.fillStyle = '#ffffff'
      g.fillText((P.item.note || 'THE WIRE').toUpperCase(), 80, 212, 640)
      g.fillStyle = '#ffd400'
      g.fillRect(780, 50, 470, 200)
      g.font = fontOf(46, 'Anton', 400)
      g.fillStyle = '#111'
      g.fillText('EXCLUSIVE', 820, 130)
      g.fillText('INSIDE TODAY', 820, 196)
      const box = headline(P, 50, 300, 1200, 170, { family: 'Anton', weight: 400, color: '#111111', upper: true, lead: 0.98 })
      picture(P, 50, box.y + 420, 1200, 620, '#8a6a5a')
      return box
    }
  },
  // A pink financial paper.
  {
    w: 1300,
    h: 1700,
    stuff: 'paper',
    spread: { paper: '#fbe4d5', ink: '#4a403a', family: 'Merriweather', size: 18, col: 275, gap: 25, top: 260 },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#fbe4d5'
      g.fillRect(0, 0, 1300, 1700)
      const ink = '#1f1a17'
      g.font = fontOf(84, 'Merriweather', 700)
      g.fillStyle = ink
      g.fillText((P.item.note || 'Financial Ledger').toUpperCase(), 60, 140, 1180)
      rule(g, 60, 172, 1180, 3, ink)
      // A ticker.
      g.font = fontOf(22, 'Inter', 700)
      ;['FTSE 7,412 ▲0.4%', 'DOW 38,120 ▼0.2%', '€/$ 1.087', 'GOLD 2,318 ▲1.1%'].forEach((s, k) => {
        g.fillStyle = s.includes('▼') ? '#b8342a' : '#1f6b4a'
        g.fillText(s, 60 + k * 300, 212)
      })
      rule(g, 60, 232, 1180, 1, ink)
      const box = headline(P, 60, 300, 1180, 98, { family: 'Merriweather', weight: 700, color: ink, lead: 1.1 })
      for (let c = 0; c < 4; c++) body(P, 60 + c * 300, box.y + 330, 275, 30, 18, '#4a403a', 'Merriweather', c + P.i + 5)
      return box
    }
  },
  // A phone: the news app's card.
  {
    w: 1000,
    h: 1800,
    stuff: 'screen',
    ground: '#eceef2',
    wide: (g, vis) => {
      g.fillStyle = '#ffffff'
      g.fillRect(vis.x, 0, vis.w, 150)
      rule(g, vis.x, 150, vis.w, 2, 'rgba(0,0,0,0.06)')
    },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#eceef2'
      g.fillRect(0, 0, 1000, 1800)
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, 1000, 150)
      g.font = fontOf(44, 'Inter', 800)
      g.fillStyle = '#111'
      g.fillText(P.item.note || 'Pocket News', 50, 108)
      g.fillStyle = '#ffffff'
      const cx = 40
      const cy = 200
      g.beginPath()
      g.roundRect?.(cx, cy, 920, 1500, 40)
      g.fill()
      g.save()
      g.beginPath()
      g.roundRect?.(cx, cy, 920, 520, [40, 40, 0, 0])
      g.clip()
      picture(P, cx, cy, 920, 520, '#4f7aa6')
      g.restore()
      g.font = fontOf(24, 'Inter', 700)
      g.fillStyle = '#3b6cf6'
      g.fillText('TOP STORY · 2h', 90, 790)
      const box = headline(P, 90, 820, 820, 76, { family: 'Inter', weight: 800, color: '#111', lead: 1.14 })
      body(P, 90, box.y + 300, 820, 9, 26, '#555a63', 'Inter', P.i + 1)
      return box
    }
  },
  // An old paper: yellowed, spotted, sepia.
  {
    w: 1300,
    h: 1700,
    stuff: 'paper',
    spread: { paper: '#e6d7b4', ink: '#5a4630', family: 'Merriweather', size: 18, col: 285, gap: 20, top: 250 },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#e6d7b4'
      g.fillRect(0, 0, 1300, 1700)
      g.fillStyle = 'rgba(120,90,40,0.10)'
      for (let k = 0; k < 90; k++) {
        g.beginPath()
        g.arc(rnd(k, 1) * 1300, rnd(k, 2) * 1700, 2 + rnd(k, 3) * 14, 0, Math.PI * 2)
        g.fill()
      }
      const ink = '#3a2c1c'
      g.font = fontOf(110, 'Merriweather', 900)
      g.fillStyle = ink
      g.textAlign = 'center'
      g.fillText(P.item.note || 'The Evening Gazette', 650, 160, 1200)
      g.font = fontOf(24, 'Merriweather', 700)
      g.fillText('— PRICE ONE PENNY —', 650, 205)
      g.textAlign = 'left'
      rule(g, 50, 225, 1200, 5, ink)
      const box = headline(P, 50, 280, 1200, 128, { family: 'Oswald', weight: 700, color: ink, upper: true, lead: 1.02, align: 'center' })
      for (let c = 0; c < 4; c++) body(P, 50 + c * 305, box.y + 360, 285, 34, 18, '#5a4630', 'Merriweather', c + P.i + 2)
      return box
    }
  },
  // A magazine: a bold colour, a huge headline — its facing page plain print.
  {
    w: 1300,
    h: 1700,
    stuff: 'gloss',
    spread: { paper: '#f6f3ec', ink: '#34363c', family: 'Inter', size: 20, col: 360, gap: 34, top: 180 },
    draw: (P) => {
      const g = P.g
      g.fillStyle = '#1f3a8a'
      g.fillRect(0, 0, 1300, 1700)
      picture(P, 0, 700, 1300, 1000, '#3a5ab0')
      g.fillStyle = 'rgba(31,58,138,0.55)'
      g.fillRect(0, 700, 1300, 1000)
      g.font = fontOf(200, 'Bebas Neue', 400)
      g.fillStyle = '#ffffff'
      g.fillText((P.item.note || 'WEEKLY').toUpperCase(), 60, 230, 1180)
      const box = headline(P, 60, 320, 1180, 132, { family: 'Archivo Black', weight: 400, color: '#ffffff', lead: 1.04 })
      return box
    }
  }
]

export function drawNews(c: Ctx): void {
  const { g, b, t, x0, W, H } = c
  const n = b.items.length
  if (!n) return
  const T = newsTimes(b)
  let i = 0
  while (i + 1 < n && t >= T.cuts[i + 1]) i++
  const item = b.items[i]
  const design = DESIGNS[(i + (b.seed % DESIGNS.length)) % DESIGNS.length]
  const filler = b.items.flatMap((it) => it.title.split(/\s+/)).filter(Boolean)
  // The desk under the pages.
  g.fillStyle = '#0c0c0f'
  g.fillRect(x0, 0, W, H)
  // Lay the page out once, off screen, to find where its word is.
  const turkish = /[çğıöşüÇĞİÖŞÜ]/.test(b.title + b.items.map((it) => it.title).join(' '))
  const P: Page = { g, word: b.title || 'NEWS', item, i, mark: i === 0 ? clamp01((t - 0.15) / 0.3) : 1, accent: b.style.accent, img: imageOf(c, item), filler: filler.length ? filler : ['news'], locale: turkish ? 'tr' : undefined }
  g.textAlign = 'left'
  g.save()
  g.globalAlpha = 0
  const box = design.draw(P)
  g.restore()
  const cx = x0 + W / 2
  const cy = H / 2
  // One size for the word on every page (a long one fitted to the width).
  const want = H * (c.portrait ? 0.12 : 0.19)
  let s = want / box.h
  s = Math.min(s, (W * 0.72) / box.w)
  const local = t - T.cuts[i]
  const span = (i + 1 < n ? T.cuts[i + 1] : b.duration) - T.cuts[i]
  // A slow push while each page is up; a hair of turn, different each time.
  s *= 1 + 0.05 * clamp01(local / Math.max(0.2, span))
  const rot = (rnd(b.seed, i) - 0.5) * 0.05
  const fx = box.x + box.w / 2
  const fy = box.y + box.h / 2
  // (The last page holds on the word too: no pulling back at the end.)
  g.save()
  g.translate(cx, cy)
  g.rotate(rot)
  g.scale(s, s)
  g.translate(-fx, -fy)
  g.textBaseline = 'alphabetic'
  // What the frame sees of the page's world, in page units (turned a hair).
  const R = Math.hypot(W, H) / 2 / s + 4
  const vis: Rect = { x: fx - R, y: fy - R, w: 2 * R, h: 2 * R }
  if (design.spread) facingPages(P, design, design.spread, vis)
  else {
    g.fillStyle = design.ground ?? '#ffffff'
    g.fillRect(vis.x, vis.y, vis.w, vis.h)
    design.wide?.(g, vis)
  }
  design.draw(P)
  if (design.spread) folds(g, design, vis)
  madeOf(g, design.stuff, vis, s)
  g.restore()
  // A cut is a flash of the new page: the first frames a touch brighter.
  if (i > 0) {
    const f = 1 - outCubic(clamp01(local / 0.08))
    if (f > 0) {
      g.fillStyle = `rgba(255,255,255,${(0.1 * f).toFixed(3)})`
      g.fillRect(x0, 0, W, H)
    }
  }
  // A soft vignette, as a lens sees a page.
  const vg = g.createRadialGradient(cx, cy, H * 0.35, cx, cy, Math.hypot(W, H) * 0.6)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.3)')
  g.fillStyle = vg
  g.fillRect(x0, 0, W, H)
}

// -- round the page --------------------------------------------------------------

/** A paper's facing pages: its own paper on, columns of small print on them. */
function facingPages(P: Page, d: Design, sp: Spread, vis: Rect): void {
  const g = P.g
  g.fillStyle = sp.paper
  g.fillRect(vis.x, vis.y, vis.w, vis.h)
  const lead = sp.size * 1.55
  const bottom = d.h - 90
  for (const side of [-1, 1]) {
    // The rule their mastheads end on.
    const rx = side < 0 ? Math.max(vis.x, -2000) : d.w + 60
    const rw = side < 0 ? -60 - rx : Math.min(vis.x + vis.w, d.w + 2000) - rx
    if (rw > 0) rule(g, rx, sp.top - 36, rw, 2, sp.ink)
    for (let k = 0; k < 8; k++) {
      const x = side < 0 ? -60 - sp.col - k * (sp.col + sp.gap) : d.w + 60 + k * (sp.col + sp.gap)
      if (x + sp.col < vis.x || x > vis.x + vis.w) continue
      // Only the lines the frame sees.
      const l0 = Math.max(0, Math.floor((vis.y - sp.top) / lead))
      const l1 = Math.min(Math.floor((bottom - sp.top) / lead), Math.ceil((vis.y + vis.h - sp.top) / lead))
      if (l1 <= l0) continue
      body(P, x, sp.top + l0 * lead, sp.col, l1 - l0, sp.size, sp.ink, sp.family, 11 + k * 3 + (side < 0 ? 0 : 17) + l0, 1.55)
    }
  }
}

/** The fold on its left (the spine of the spread), the next sheet's edge on
 *  its right: soft shade, not lines. */
function folds(g: G, d: Design, vis: Rect): void {
  if (vis.x < 60) {
    const gr = g.createLinearGradient(-70, 0, 70, 0)
    gr.addColorStop(0, 'rgba(40,30,20,0)')
    gr.addColorStop(0.5, 'rgba(40,30,20,0.2)')
    gr.addColorStop(1, 'rgba(40,30,20,0)')
    g.fillStyle = gr
    g.fillRect(-70, vis.y, 140, vis.h)
  }
  if (vis.x + vis.w > d.w - 60) {
    const gr = g.createLinearGradient(d.w - 8, 0, d.w + 40, 0)
    gr.addColorStop(0, 'rgba(40,30,20,0.16)')
    gr.addColorStop(1, 'rgba(40,30,20,0)')
    g.fillStyle = gr
    g.fillRect(d.w - 8, vis.y, 48, vis.h)
  }
}

// -- what it is made of ----------------------------------------------------------

type Tile = HTMLCanvasElement | OffscreenCanvas
const tileCache = new Map<string, Tile>()
const patterns = new WeakMap<object, Map<string, CanvasPattern | null>>()

function makeTile(n: number, fill: (d: Uint8ClampedArray, n: number) => void): Tile {
  const cv: Tile = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(n, n) : Object.assign(document.createElement('canvas'), { width: n, height: n })
  const t = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  const im = t.createImageData(n, n)
  fill(im.data, n)
  t.putImageData(im, 0, 0)
  return cv
}

/** The paper's grain: fine noise, a few fibres, faint clouding — multiplied. */
function grainTile(): Tile {
  return makeTile(256, (d, n) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = (y * n + x) * 4
        // Fine tooth, and a slow cloud (tileable: sines of whole periods).
        const cloud = 0.5 + 0.25 * Math.sin((x / n) * Math.PI * 4 + Math.sin((y / n) * Math.PI * 2) * 1.5) + 0.25 * Math.sin((y / n) * Math.PI * 6 + (x / n) * Math.PI * 2)
        const v = 255 - rnd(x, y) * 34 - cloud * 10
        d[k] = v
        d[k + 1] = v - 1
        d[k + 2] = v - 4
        d[k + 3] = 255
      }
    // Fibres: short faint strokes lying every which way.
    for (let f = 0; f < 70; f++) {
      const x0 = rnd(f, 91) * n
      const y0 = rnd(f, 92) * n
      const a = rnd(f, 93) * Math.PI
      const len = 6 + rnd(f, 94) * 16
      for (let q = 0; q < len; q++) {
        const x = Math.floor(x0 + Math.cos(a) * q + n) % n
        const y = Math.floor(y0 + Math.sin(a) * q + n) % n
        const k = (y * n + x) * 4
        d[k] -= 16
        d[k + 1] -= 16
        d[k + 2] -= 14
      }
    }
  })
}

/** Where the ink did not quite take: sparse light specks — screened over. */
function specksTile(): Tile {
  return makeTile(192, (d, n) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = (y * n + x) * 4
        const r = rnd(x + 400, y + 77)
        const v = r > 0.985 ? 150 + r * 60 : r > 0.94 ? 50 : 0
        d[k] = v
        d[k + 1] = v
        d[k + 2] = v
        d[k + 3] = 255
      }
  })
}

/** A screen up close: each pixel three stripes, red, green, blue, with the
 *  dark between them — multiplied. */
function pixelTile(): Tile {
  // One pixel is 12 × 12 here: stripes 4 wide with a dark column, a dark row.
  return makeTile(12, (d, n) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = (y * n + x) * 4
        const stripe = Math.floor(x / 4)
        const gap = x % 4 === 3 || y >= n - 2
        const on = gap ? 70 : 255
        const off = gap ? 70 : 120
        d[k] = stripe === 0 ? on : off
        d[k + 1] = stripe === 1 ? on : off
        d[k + 2] = stripe === 2 ? on : off
        d[k + 3] = 255
      }
  })
}

function patternOf(g: G, key: string, make: () => Tile): CanvasPattern | null {
  let m = patterns.get(g)
  if (!m) {
    m = new Map()
    patterns.set(g, m)
  }
  if (m.has(key)) return m.get(key)!
  let tl = tileCache.get(key)
  if (!tl) {
    tl = make()
    tileCache.set(key, tl)
  }
  const p = g.createPattern(tl as CanvasImageSource, 'repeat')
  m.set(key, p)
  return p
}

/** Lays what the page is made of over it (and round it), in page units so it
 *  moves with the page. `s` is page units → frame pixels. */
function madeOf(g: G, stuff: Stuff, vis: Rect, s: number): void {
  g.save()
  if (stuff === 'screen') {
    // About 7 frame pixels to a screen pixel, whatever the push.
    const p = patternOf(g, 'pixels', pixelTile)
    if (p) {
      const k = 7 / s / 12
      p.setTransform?.(new DOMMatrix([k, 0, 0, k, 0, 0]))
      g.globalCompositeOperation = 'multiply'
      g.globalAlpha = 0.3
      g.fillStyle = p
      g.fillRect(vis.x, vis.y, vis.w, vis.h)
    }
    // The glass: a faint sheen across it, lit from the top left.
    g.globalCompositeOperation = 'screen'
    g.globalAlpha = 1
    const gl = g.createLinearGradient(vis.x, vis.y, vis.x + vis.w, vis.y + vis.h)
    gl.addColorStop(0, 'rgba(255,255,255,0.07)')
    gl.addColorStop(0.45, 'rgba(255,255,255,0.02)')
    gl.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gl
    g.fillRect(vis.x, vis.y, vis.w, vis.h)
  } else {
    // A grain of about 1.4 frame pixels; gloss has less of it.
    const p = patternOf(g, 'grain', grainTile)
    if (p) {
      const k = 1.4 / s
      p.setTransform?.(new DOMMatrix([k, 0, 0, k, 0, 0]))
      g.globalCompositeOperation = 'multiply'
      g.globalAlpha = stuff === 'gloss' ? 0.45 : 1
      g.fillStyle = p
      g.fillRect(vis.x, vis.y, vis.w, vis.h)
    }
    if (stuff === 'paper') {
      const q = patternOf(g, 'specks', specksTile)
      if (q) {
        const k = 1.3 / s
        q.setTransform?.(new DOMMatrix([k, 0, 0, k, 0, 0]))
        g.globalCompositeOperation = 'screen'
        g.globalAlpha = 0.22
        g.fillStyle = q
        g.fillRect(vis.x, vis.y, vis.w, vis.h)
      }
    } else {
      // Gloss: a soft sheen where the light catches the coated page.
      g.globalCompositeOperation = 'screen'
      g.globalAlpha = 1
      const gl = g.createLinearGradient(vis.x, vis.y + vis.h, vis.x + vis.w, vis.y)
      gl.addColorStop(0.35, 'rgba(255,255,255,0)')
      gl.addColorStop(0.6, 'rgba(255,255,255,0.08)')
      gl.addColorStop(0.8, 'rgba(255,255,255,0)')
      g.fillStyle = gl
      g.fillRect(vis.x, vis.y, vis.w, vis.h)
    }
  }
  g.restore()
}
