// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The layouts and timings of the card-like templates: gallery, count, focus,
// before/after, checklist, posts, poll, card deck, news, list, store chart,
// domino, search. Moved out of templates/model.ts in SnippStudio phase 2B
// (no change).
import { type TemplateBlock } from '../../types'
import { templateSlots, glide } from './common'
import type { Rect } from './common'

/**
 * Where a gallery's parts are, in frame pixels: the panel, its header, each
 * thumbnail and the viewer a photo opens into.
 */
export function galleryLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): { panel: Rect; header: number; thumbs: Rect[]; viewer: Rect } {
  const portrait = W / H < 1
  const pw = portrait ? W * 0.88 : W * 0.6
  const ph = portrait ? H * 0.6 : H * 0.72
  const panel: Rect = { x: left + (W - pw) / 2, y: (H - ph) / 2 + H * 0.015, w: pw, h: ph }
  const header = ph * 0.1
  const pad = pw * 0.04
  const n = Math.max(1, b.items.length)
  const cols = n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const gap = pw * 0.022
  const gw = pw - pad * 2
  const gh = ph - header - pad * 1.4
  let cw = (gw - gap * (cols - 1)) / cols
  let ch = cw * 0.72
  if (ch * rows + gap * (rows - 1) > gh) {
    ch = (gh - gap * (rows - 1)) / rows
    cw = ch / 0.72
  }
  const totalW = cw * cols + gap * (cols - 1)
  const totalH = ch * rows + gap * (rows - 1)
  const gx = panel.x + (pw - totalW) / 2
  const gy = panel.y + header + (ph - header - totalH) / 2
  const thumbs: Rect[] = b.items.map((_, i) => ({ x: gx + (i % cols) * (cw + gap), y: gy + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }))
  const viewer: Rect = { x: panel.x + pad * 0.6, y: panel.y + header, w: pw - pad * 1.2, h: ph - header - pad * 0.6 }
  return { panel, header, thumbs, viewer }
}

/**
 * A Count block's parts, in frame pixels: the card with its list, the badge
 * the number sits in, and each row.
 */
export function countLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): { card: Rect; badge: Rect; rows: Rect[] } {
  const portrait = W / H < 1
  const card: Rect = portrait ? { x: left + W * 0.07, y: H * 0.1, w: W * 0.86, h: H * 0.46 } : { x: left + W * 0.09, y: H * 0.2, w: W * 0.53, h: H * 0.6 }
  const pad = Math.min(card.w, card.h) * 0.09
  const head = card.h * 0.2
  const bs = Math.min(card.h - head - pad * 1.5, card.w * 0.32)
  const badge: Rect = { x: card.x + pad, y: card.y + head + (card.h - head - bs) / 2 - pad * 0.2, w: bs, h: bs }
  const n = Math.max(1, b.items.length)
  const rx = badge.x + bs + pad
  const rw = card.x + card.w - pad - rx
  const top = card.y + head + pad * 0.3
  const rh = Math.min((card.h - head - pad * 1.3) / n, card.h * 0.16)
  const rows: Rect[] = b.items.map((_, i) => ({ x: rx, y: top + i * rh + ((card.h - head - pad * 1.3) - rh * n) / 2, w: rw, h: rh }))
  return { card, badge, rows }
}

/**
 * A "Tap to open" block's cards, in frame pixels, and the whole view a card
 * opens into.
 */
export function focusLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): { cards: Rect[]; full: Rect } {
  const portrait = W / H < 1
  const n = Math.max(1, b.items.length)
  const cards: Rect[] = []
  if (portrait) {
    const cw = W * 0.64
    const gap = H * 0.035
    let ch = cw * 0.62
    const room = H * 0.72
    if (ch * n + gap * (n - 1) > room) ch = (room - gap * (n - 1)) / n
    const total = ch * n + gap * (n - 1)
    for (let i = 0; i < n; i++) cards.push({ x: left + (W - cw) / 2, y: H * 0.46 - total / 2 + i * (ch + gap), w: cw, h: ch })
  } else {
    const gap = W * 0.03
    const cw = Math.min(W * 0.3, (W * 0.84 - gap * (n - 1)) / n)
    const ch = cw * 0.72
    const total = cw * n + gap * (n - 1)
    for (let i = 0; i < n; i++) cards.push({ x: left + (W - total) / 2 + i * (cw + gap), y: H * 0.45 - ch / 2, w: cw, h: ch })
  }
  return { cards, full: { x: left, y: 0, w: W, h: H } }
}
// -- before/after, checklist, comments, poll ---------------------------------------

/** The before/after card. */
export function compareLayout(left: number, W: number, H: number): Rect {
  const portrait = W / H < 1
  const w = portrait ? W * 0.9 : W * 0.76
  const h = portrait ? H * 0.56 : H * 0.72
  return { x: left + (W - w) / 2, y: portrait ? H * 0.2 : H * 0.17, w, h }
}

/** Where the divider is at each key (block time, fraction across): half,
 *  over to the before, across to the after, back to half. */
export function compareKeys(b: Pick<TemplateBlock, 'duration'>): [number, number][] {
  const D = Math.max(3, b.duration)
  const a = 0.9
  const p1 = a + 0.2 * D
  const p2 = p1 + 0.3 * D
  const p3 = Math.min(D - 0.5, p2 + 0.18 * D)
  return [
    [a, 0.5],
    [p1, 0.86],
    [p2, 0.14],
    [p3, 0.5]
  ]
}

/** The divider at block time t (its own glide between keys). */
export function compareSplit(b: Pick<TemplateBlock, 'duration'>, t: number): number {
  const K = compareKeys(b)
  if (t <= K[0][0]) return K[0][1]
  for (let i = 0; i + 1 < K.length; i++) {
    if (t <= K[i + 1][0]) return K[i][1] + (K[i + 1][1] - K[i][1]) * glide((t - K[i][0]) / (K[i + 1][0] - K[i][0]))
  }
  return K[K.length - 1][1]
}

/** The checklist card and its rows. */
export function checklistLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): { card: Rect; pad: number; titleSize: number; size: number; rows: { box: Rect; textX: number }[] } {
  const portrait = W / H < 1
  const u = H / 1080
  const pad = 44 * u
  const titleSize = (portrait ? 50 : 56) * u
  const size = (portrait ? 34 : 38) * u
  const rowH = size * (b.items.some((it) => it.note) ? 2.3 : 1.9)
  const w = portrait ? W * 0.86 : Math.min(W * 0.5, 900 * u)
  const h = pad * 2 + titleSize * 1.6 + rowH * b.items.length
  const card: Rect = { x: left + (W - w) / 2, y: Math.max(40 * u, H / 2 - h / 2), w, h }
  const box = size * 1.1
  const rows = b.items.map((_, i) => {
    const y = card.y + pad + titleSize * 1.6 + i * rowH + (rowH - box) / 2
    return { box: { x: card.x + pad, y, w: box, h: box }, textX: card.x + pad + box + 24 * u }
  })
  return { card, pad, titleSize, size, rows }
}

/** The comment cards, stacked in the middle. */
export function postLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): { cards: Rect[] } {
  const portrait = W / H < 1
  const u = H / 1080
  const w = portrait ? W * 0.9 : Math.min(W * 0.56, 1060 * u)
  const heights = b.items.map((it) => {
    const lines = Math.min(4, Math.max(1, Math.ceil(((it.title ?? '').length * 40 * u * 0.52) / (w - 52 * u))))
    return 110 * u + lines * 52 * u + 80 * u
  })
  const gap = 28 * u
  const total = heights.reduce((a, h) => a + h, 0) + gap * (heights.length - 1)
  let y = H / 2 - total / 2
  const cards = heights.map((h) => {
    const r = { x: left + (W - w) / 2, y, w, h }
    y += h + gap
    return r
  })
  return { cards }
}

/** The poll card, its answers, which one is voted and when. */
export function pollLayout(b: Pick<TemplateBlock, 'items' | 'duration'>, left: number, W: number, H: number): { card: Rect; pad: number; qSize: number; rows: Rect[]; pick: number; tapAt: number } {
  const portrait = W / H < 1
  const u = H / 1080
  const pad = 44 * u
  const qSize = (portrait ? 44 : 50) * u
  const rowH = 70 * u
  const gap = 20 * u
  const w = portrait ? W * 0.86 : Math.min(W * 0.52, 940 * u)
  const qLines = 2
  const h = pad * 2.4 + qSize * 1.15 * qLines + b.items.length * (rowH + gap)
  const card: Rect = { x: left + (W - w) / 2, y: H / 2 - h / 2, w, h }
  const rows = b.items.map((_, i) => ({ x: card.x + pad, y: card.y + pad + qSize * 1.15 * qLines + i * (rowH + gap), w: w - pad * 2 - rowH * 0.9, h: rowH }))
  const marked = b.items.findIndex((it) => /✓|✔|x|\*/i.test(it.note ?? ''))
  const vals = b.items.map((it) => it.value ?? 0)
  const pick = marked >= 0 ? marked : vals.indexOf(Math.max(...vals))
  return { card, pad, qSize, rows, pick: Math.max(0, pick), tapAt: Math.max(1.4, b.duration * 0.38) }
}
// -- card deck ---------------------------------------------------------------------

/** The card deck: where the deck sits, each card's place, size and tilt. */
export function cardsLayout(b: Pick<TemplateBlock, 'items' | 'seed'>, left: number, W: number, H: number): { deck: [number, number]; slots: [number, number][]; w: number; h: number; rot: number[] } {
  const n = Math.max(1, b.items.length)
  const portrait = W / H < 1
  const cols = portrait ? Math.min(3, n) : n
  const rows = Math.ceil(n / cols)
  const gap = W * 0.025
  const maxW = (W * (portrait ? 0.9 : 0.84) - gap * (cols - 1)) / cols
  const maxH = (H * (portrait ? 0.5 : 0.56)) / rows - gap
  const w = Math.min(maxW, maxH * 0.72)
  const h = w / 0.72
  const totalW = cols * w + (cols - 1) * gap
  const top = H * (portrait ? 0.3 : 0.42) - ((rows - 1) * (h + gap)) / 2
  const slots: [number, number][] = []
  const rot: number[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols)
    const inRow = Math.min(cols, n - r * cols)
    const rowW = inRow * w + (inRow - 1) * gap
    const k = i - r * cols
    slots.push([left + W / 2 - rowW / 2 + w / 2 + k * (w + gap), top + r * (h + gap)])
    const s = Math.sin((b.seed + 1) * 12.9898 + i * 78.233) * 43758.5453
    rot.push(((s - Math.floor(s)) - 0.5) * 0.06)
  }
  void totalW
  return { deck: [left + W / 2, Math.min(H * (portrait ? 0.82 : 0.86), H - h * 0.36 - H * 0.03)], slots, w, h, rot }
}

/** A saved card deck's dealing, repaired. */
export function cleanDeal(v: unknown): { deal?: { up?: boolean; pick?: number } } {
  if (!v || typeof v !== 'object') return {}
  const d = v as { up?: unknown; pick?: unknown }
  const up = d.up === true
  const pick = typeof d.pick === 'number' && Number.isInteger(d.pick) && d.pick >= 0 ? d.pick : undefined
  return up || pick !== undefined ? { deal: { ...(up ? { up: true } : {}), ...(pick !== undefined ? { pick } : {}) } } : {}
}

/** The card picked at the end (index), if one is. */
export const cardsPick = (b: Pick<TemplateBlock, 'items' | 'deal'>): number | null =>
  b.deal?.pick !== undefined && b.deal.pick < b.items.length ? b.deal.pick : null

/** When each card is dealt (block time, from–to), when it is turned (face
 *  up: already, as it is dealt), and when the picked one is taken up and
 *  brought close (from–to). */
export function cardsTimes(b: Pick<TemplateBlock, 'items' | 'duration' | 'deal'>): { deal: [number, number][]; flip: number[]; pick: [number, number] | null } {
  const n = Math.max(1, b.items.length)
  const step = 0.46
  const deal: [number, number][] = b.items.map((_, i) => [0.6 + i * step, 0.6 + i * step + 0.36])
  const dealt = deal.length ? deal[deal.length - 1][1] : 0.6
  const picks = cardsPick(b) !== null
  let flip: number[]
  let last: number
  if (b.deal?.up) {
    flip = deal.map(([d0]) => d0 - 1)
    last = dealt
  } else {
    const room = Math.max(0.6, b.duration - dealt - 1.2 - (picks ? 1.6 : 0))
    const each = Math.max(0.45, Math.min(1.4, room / n))
    flip = b.items.map((_, i) => dealt + 0.5 + i * each)
    last = flip[flip.length - 1] + 0.38
  }
  const p0 = Math.min(Math.max(last + 0.55, b.duration * 0.55), b.duration - 1.1)
  return { deal, flip, pick: picks ? [p0, p0 + 0.7] : null }
}

/** Where the picked card is brought: the middle, close (big). */
export function cardsPickPlace(left: number, W: number, H: number, L: { w: number; h: number }): { x: number; y: number; k: number } {
  return { x: left + W / 2, y: H * 0.5, k: Math.min((H * 0.78) / L.h, (W * 0.62) / L.w) }
}

// -- the word in the news -------------------------------------------------------------

/** When each page cuts in (block time), quicker and quicker, and when the
 *  last page is up and settled (`reveal`). */
export function newsTimes(b: Pick<TemplateBlock, 'items' | 'duration'>): { cuts: number[]; reveal: number } {
  const n = Math.max(1, b.items.length)
  if (n === 1) return { cuts: [0], reveal: Math.min(b.duration * 0.5, 0.8) }
  const endHold = Math.min(1.8, Math.max(0.9, b.duration * 0.28))
  const avail = Math.max(0.1 * (n - 1), b.duration - endHold)
  const w = Array.from({ length: n - 1 }, (_, i) => 1 - 0.7 * (n > 2 ? i / (n - 2) : 0))
  const sum = w.reduce((a, x) => a + x, 0)
  const cuts = [0]
  for (let i = 0; i < n - 1; i++) cuts.push(cuts[i] + (avail * w[i]) / sum)
  return { cuts, reveal: cuts[n - 1] + 0.3 }
}

// -- a list video --------------------------------------------------------------------

export interface ListLayout {
  thumbs: Rect[]
  big: Rect
  text: { x: number; w: number }
  head: number
  headSize: number
  numY: number
  numSize: number
  titleSize: number
  noteSize: number
}

/** Where a list video's parts sit: the strip of small pictures, the big
 *  frame, the words. */
export function listLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): ListLayout {
  const n = Math.max(1, b.items.length)
  const portrait = W / H < 1
  const strip = (y: number, h0: number, aspect: number, maxW: number): Rect[] => {
    const gap = W * 0.014
    let h = h0
    let w = h * aspect
    if (n * w + (n - 1) * gap > maxW) {
      w = (maxW - (n - 1) * gap) / n
      h = w / aspect
    }
    const x0 = left + (W - (n * w + (n - 1) * gap)) / 2
    return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gap), y: y + (h0 - h) / 2, w, h }))
  }
  if (portrait) {
    const bw = W * 0.86
    return {
      thumbs: strip(H * 0.86, H * 0.075, 1.2, W * 0.9),
      big: { x: left + (W - bw) / 2, y: H * 0.1, w: bw, h: bw * 0.75 },
      text: { x: left + W * 0.07, w: W * 0.86 },
      head: H * 0.07,
      headSize: H * 0.034,
      numY: H * 0.62,
      numSize: H * 0.1,
      titleSize: H * 0.042,
      noteSize: H * 0.023
    }
  }
  const bw = W * 0.46
  return {
    thumbs: strip(H * 0.81, H * 0.105, 1.5, W * 0.86),
    big: { x: left + W * 0.465, y: H * 0.1, w: bw, h: bw * 0.64 },
    text: { x: left + W * 0.07, w: W * 0.34 },
    head: H * 0.14,
    headSize: H * 0.042,
    numY: H * 0.45,
    numSize: H * 0.21,
    titleSize: H * 0.066,
    noteSize: H * 0.031
  }
}

/** Each item's beats (block time): the tap that brings it up, the moment it
 *  starts back down to the strip. */
export function listTimes(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>): { tap: number; back: number }[] {
  const s = templateSlots({ ...b, kind: 'list' })
  return b.items.map((_, i) => ({ tap: s.at(i), back: s.at(i) + Math.max(0.6, s.len - 0.35) }))
}

/** A search's top result picture, in the window (frame pixels). */
export function searchThumb(win: Rect, H: number): Rect {
  const bar = H * 0.045
  const w = win.w * 0.2
  return { x: win.x + win.w * 0.74, y: win.y + bar * 2.7, w, h: w * 0.66 }
}
/** How long after the results come in the top picture opens. */
export const SEARCH_OPEN = 0.95

// -- a store's chart -----------------------------------------------------------------

/** Where a store chart's parts sit: the list panel and its rows, the large
 *  entry beside it, and its GET button. */
export function storeLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): {
  panel: Rect
  pad: number
  head: number
  rowH: number
  hero: { x: number; y: number; w: number; iconSize: number; gap: number; rankSize: number; nameSize: number }
  button: (k: number) => Rect
} {
  const portrait = W / H < 1
  if (portrait) {
    const panel = { x: left + W * 0.06, y: H * 0.5, w: W * 0.88, h: H * 0.44 }
    const iconSize = W * 0.3
    const hero = { x: left + W * 0.08, y: H * 0.07, w: W * 0.84, iconSize, gap: H * 0.02, rankSize: H * 0.05, nameSize: H * 0.035 }
    return { panel, pad: W * 0.05, head: H * 0.06, rowH: H * 0.075, hero, button: () => ({ x: left + W * 0.62, y: H * 0.07 + iconSize * 0.3, w: W * 0.3, h: H * 0.04 }) }
  }
  const panel = { x: left + W * 0.08, y: H * 0.07, w: W * 0.36, h: H * 0.86 }
  const iconSize = H * 0.26
  const hx = left + W * 0.52
  const hero = { x: hx, y: H * 0.14, w: W * 0.4, iconSize, gap: H * 0.04, rankSize: H * 0.09, nameSize: H * 0.065 }
  return {
    panel,
    pad: W * 0.018,
    head: H * 0.1,
    rowH: H * 0.1,
    hero,
    button: () => ({ x: hx + iconSize + W * 0.03, y: H * 0.14 + iconSize * 0.5 - H * 0.03, w: W * 0.11, h: H * 0.06 })
  }
}

/** When each entry comes up (block time, in the order shown), and how long
 *  after that GET is pressed. */
export function storeTimes(b: Pick<TemplateBlock, 'items' | 'duration'>): { at: number[]; press: number } {
  const n = Math.max(1, b.items.length)
  const lead = 0.9
  const tail = 0.8
  const len = Math.max(0.8, (b.duration - lead - tail) / n)
  return { at: b.items.map((_, k) => lead + k * len), press: Math.min(1.1, len * 0.45) }
}

// -- domino --------------------------------------------------------------------------

export interface DominoLayout {
  /** Each tile's middle across (frame pixels). */
  tiles: { x: number }[]
  tw: number
  th: number
  /** The line they stand on, and the gap between two tiles. */
  floor: number
  gap: number
  step: number
  shelf: Rect
  label: number
}

/** Tiles in a row on a shelf, room after the last for it to lie flat. */
export function dominoLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): DominoLayout {
  const n = Math.max(1, b.items.length)
  const portrait = W / H < 1
  let th = H * (portrait ? 0.2 : 0.3)
  let tw = th * 0.46
  let gap = th * 0.55
  const avail = W * (portrait ? 0.86 : 0.8)
  const need = (n - 1) * (tw + gap) + tw + th * 0.95
  if (need > avail) {
    const k = avail / need
    th *= k
    tw *= k
    gap *= k
  }
  const step = tw + gap
  const total = (n - 1) * step + tw + th * 0.95
  const x0 = left + W / 2 - total / 2 + tw / 2
  const floor = H * (portrait ? 0.56 : 0.6)
  return {
    tiles: b.items.map((_, i) => ({ x: x0 + i * step })),
    tw,
    th,
    floor,
    gap,
    step,
    shelf: { x: x0 - tw / 2 - th * 0.16, y: floor, w: total + th * 0.32, h: Math.max(10, th * 0.06) },
    label: Math.min(H * (portrait ? 0.032 : 0.042), Math.max(H * 0.022, step * 0.2))
  }
}

/**
 * When the first tile is pushed and each starts to fall (block
 * seconds), and each tile's turn at t (radians, falling to the right): it
 * gathers speed as it goes over, rests on the next at the angle where it
 * touches it — leaning a little further as that one goes — and the last
 * lies flat.
 */
export function dominoTimes(b: Pick<TemplateBlock, 'items' | 'duration'>, L: Pick<DominoLayout, 'gap' | 'th'>): { push: number; fall: number[]; angle: (i: number, t: number) => number } {
  const n = b.items.length
  const D = Math.max(1, b.duration)
  const push = Math.min(1.1, D * 0.18)
  const span = Math.max(0.24, Math.min(0.62, (D - push - 1.4) / Math.max(1, n)))
  const fall = b.items.map((_, i) => push + i * span)
  const lean = Math.asin(Math.min(0.95, L.gap / L.th))
  const angle = (i: number, t: number): number => {
    if (i >= n || t <= fall[i]) return 0
    if (i === n - 1) {
      const u = Math.min(1, (t - fall[i]) / (span * 1.6))
      return (Math.PI / 2) * u * u
    }
    const u = Math.min(1, (t - fall[i]) / span)
    return lean * u * u + (u >= 1 ? 0.28 * angle(i + 1, t) : 0)
  }
  return { push, fall, angle }
}
