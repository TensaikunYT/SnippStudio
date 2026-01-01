// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where a template sits in the frame: which kinds can be placed, their
// placement, and a block's bounds. Moved out of templates/model.ts in
// SnippStudio phase 2B (no change).
import { type TemplateBlock, type TemplateKind } from '../../types'
import { chessLayout } from '../chess-plan'
import { SCENE_KINDS } from '../info'
import type { Rect } from './common'
import { compareLayout, checklistLayout, postLayout, pollLayout, cardsLayout, dominoLayout } from './scenes'
import { barsLayout } from './charts'
import { cutoutLayout } from './cutout'
import { boxesLayout } from './boxes'

// -- placing a template ------------------------------------------------------------

/** Can this template be moved and scaled as a whole? (Not the ones that turn
 *  the live picture into a scene, nor the verse panel, which has its size.) */
export const placeable = (kind: TemplateKind): boolean => !SCENE_KINDS.has(kind) && kind !== 'quote' && kind !== 'news'

/** Its placing, when it has one that does anything. */
export function templatePlace(b: Pick<TemplateBlock, 'kind' | 'place'>): { x: number; y: number; s: number } | null {
  const pl = b.place
  if (!pl || !placeable(b.kind)) return null
  if (Math.abs(pl.x) < 1e-4 && Math.abs(pl.y) < 1e-4 && Math.abs(pl.s - 1) < 1e-4) return null
  return pl
}

/** Where a point of the laid-out template ends up once it is placed: scaled
 *  round the middle of the view, then moved. Null when it isn't placed. */
export function placeMap(b: Pick<TemplateBlock, 'kind' | 'place'>, left: number, W: number, H: number): ((x: number, y: number) => [number, number]) | null {
  const pl = templatePlace(b)
  if (!pl) return null
  const cx = left + W / 2
  const cy = H / 2
  return (x, y) => [cx + (x - cx) * pl.s + pl.x * W, cy + (y - cy) * pl.s + pl.y * H]
}

/** What the template covers, laid out (before placing) — its words, its
 *  card or its chart; the whole view when it has no tighter shape. */
export function templateBounds(b: TemplateBlock, left: number, W: number, H: number): Rect {
  const union = (rs: Rect[]): Rect => {
    const x0 = Math.min(...rs.map((r) => r.x))
    const y0 = Math.min(...rs.map((r) => r.y))
    const x1 = Math.max(...rs.map((r) => r.x + r.w))
    const y1 = Math.max(...rs.map((r) => r.y + r.h))
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  switch (b.kind) {
    case 'cutout': {
      const P = cutoutLayout(b, left, W, H)
      if (P.length) return union(P.map((q) => ({ x: q.cx - q.w / 2, y: q.cy - q.h / 2, w: q.w, h: q.h })))
      break
    }
    case 'bars':
    case 'pie':
    case 'line':
      return barsLayout(b, left, W, H).panel
    case 'checklist':
      return checklistLayout(b, left, W, H).card
    case 'domino': {
      const L = dominoLayout(b, left, W, H)
      return { x: L.shelf.x, y: L.floor - L.th - 12, w: L.shelf.w, h: L.th + L.shelf.h + L.label * 3 + 40 }
    }
    case 'boxes':
      return union(boxesLayout(b, left, W, H).boxes)
    case 'poll':
      return pollLayout(b, left, W, H).card
    case 'cards': {
      const L = cardsLayout(b, left, W, H)
      return union([...L.slots.map(([x, y]) => ({ x: x - L.w / 2, y: y - L.h / 2, w: L.w, h: L.h })), { x: L.deck[0] - L.w * 0.4, y: L.deck[1] - L.h * 0.4, w: L.w * 0.8, h: L.h * 0.8 }])
    }
    case 'post': {
      const cs = postLayout(b, left, W, H).cards
      if (cs.length) return union(cs)
      break
    }
    case 'compare':
      return compareLayout(left, W, H)
    case 'chess': {
      const L = chessLayout(left, W, H)
      return union([L.frame, L.panel])
    }
  }
  return { x: left, y: 0, w: W, h: H }
}

/** The placing that puts the template's top (or bottom) edge by the frame's
 *  edge, or back in the middle, keeping its size. */
export function placeAt(b: TemplateBlock, where: 'top' | 'middle' | 'bottom', left: number, W: number, H: number): { x: number; y: number; s: number } {
  const s = b.place?.s ?? 1
  const x = b.place?.x ?? 0
  const r = templateBounds(b, left, W, H)
  const cy = H / 2
  const top = cy + (r.y - cy) * s
  const bottom = cy + (r.y + r.h - cy) * s
  if (where === 'top') return { x, y: (H * 0.06 - top) / H, s }
  if (where === 'bottom') return { x, y: (H * 0.9 - bottom) / H, s }
  return { x, y: (cy - (top + bottom) / 2) / H, s }
}
