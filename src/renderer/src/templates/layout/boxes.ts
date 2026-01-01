// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Box to box: its design, layout and link points. Moved out of
// templates/model.ts in SnippStudio phase 2B (no change).
import { type TemplateBlock } from '../../types'
import type { Rect } from './common'

// -- box to box ----------------------------------------------------------------------

export type BoxesDesign = 'hub' | 'flow' | 'chain'
/** A hub (the main box in the middle, the rest round it), a flow (the main
 *  box leading into a column) or a chain (each box into the next). */
export const boxesDesign = (b: Pick<TemplateBlock, 'design'>): BoxesDesign => (b.design === 'flow' || b.design === 'chain' ? b.design : 'hub')

export type BPt = [number, number]
export interface BoxesLayout {
  boxes: Rect[]
  /** Each line the light runs along: from box, to box, a cubic curve. */
  links: { from: number; to: number; pts: [BPt, BPt, BPt, BPt] }[]
}

/** Where the boxes sit and the lines between them (frame pixels). */
export function boxesLayout(b: Pick<TemplateBlock, 'items' | 'design'>, left: number, W: number, H: number): BoxesLayout {
  const n = Math.max(1, b.items.length)
  const design = boxesDesign(b)
  const portrait = W / H < 1
  const cx = left + W / 2
  const boxes: Rect[] = []
  const links: BoxesLayout['links'] = []
  const horiz = (a: BPt, z: BPt, from: number, to: number): void => {
    const d = (z[0] - a[0]) * 0.5
    links.push({ from, to, pts: [a, [a[0] + d, a[1]], [z[0] - d, z[1]], z] })
  }
  const vert = (a: BPt, z: BPt, from: number, to: number): void => {
    const d = (z[1] - a[1]) * 0.5
    links.push({ from, to, pts: [a, [a[0], a[1] + d], [z[0], z[1] - d], z] })
  }
  const column = (x: number, w: number, count: number, cy: number, maxH: number, span: number): Rect[] => {
    const gap = H * (portrait ? 0.022 : 0.035)
    const h = Math.min(maxH, (span - gap * (count - 1)) / Math.max(1, count))
    const total = count * h + (count - 1) * gap
    return Array.from({ length: count }, (_, i) => ({ x, y: cy - total / 2 + i * (h + gap), w, h }))
  }
  if (design === 'chain') {
    if (!portrait) {
      const gap = W * 0.045
      const w = Math.min(W * 0.22, (W * 0.9 - gap * (n - 1)) / n)
      const h = Math.min(H * 0.22, w * 0.6)
      const total = n * w + (n - 1) * gap
      for (let i = 0; i < n; i++) boxes.push({ x: cx - total / 2 + i * (w + gap), y: H / 2 - h / 2, w, h })
      for (let i = 1; i < n; i++) horiz([boxes[i - 1].x + boxes[i - 1].w, H / 2], [boxes[i].x, H / 2], i - 1, i)
    } else {
      const w = W * 0.7
      boxes.push(...column(cx - w / 2, w, n, H * 0.5, H * 0.12, H * 0.78))
      for (let i = 1; i < n; i++) vert([cx, boxes[i - 1].y + boxes[i - 1].h], [cx, boxes[i].y], i - 1, i)
    }
    return { boxes, links }
  }
  const others = n - 1
  if (design === 'flow') {
    if (!portrait) {
      const main: Rect = { x: left + W * 0.07, y: H / 2 - H * 0.12, w: W * 0.27, h: H * 0.24 }
      boxes.push(main, ...column(left + W * 0.6, W * 0.32, others, H / 2, H * 0.15, H * 0.8))
      for (let i = 1; i < n; i++) horiz([main.x + main.w, main.y + main.h / 2], [boxes[i].x, boxes[i].y + boxes[i].h / 2], 0, i)
    } else {
      const main: Rect = { x: cx - W * 0.33, y: H * 0.1, w: W * 0.66, h: H * 0.12 }
      const rest = column(left + W * 0.22, W * 0.7, others, H * 0.6, H * 0.1, H * 0.62)
      boxes.push(main, ...rest)
      for (let i = 1; i < n; i++) {
        const a: BPt = [main.x + main.w * 0.18, main.y + main.h]
        const z: BPt = [boxes[i].x, boxes[i].y + boxes[i].h / 2]
        links.push({ from: 0, to: i, pts: [a, [a[0], z[1]], [a[0], z[1]], z] })
      }
    }
    return { boxes, links }
  }
  // The hub.
  if (!portrait) {
    const main: Rect = { x: cx - W * 0.14, y: H / 2 - H * 0.12, w: W * 0.28, h: H * 0.24 }
    boxes.push(main)
    const leftN = Math.floor(others / 2)
    const rightN = others - leftN
    const L = column(left + W * 0.05, W * 0.22, leftN, H / 2, H * 0.17, H * 0.8)
    const R = column(left + W * 0.73, W * 0.22, rightN, H / 2, H * 0.17, H * 0.8)
    // Alternating right, left, right… so the light crosses the frame.
    for (let i = 0; i < others; i++) boxes.push(i % 2 === 0 ? R[i >> 1] : L[i >> 1])
    for (let i = 1; i < n; i++) {
      const r = boxes[i]
      const toRight = r.x > main.x
      horiz([toRight ? main.x + main.w : main.x, main.y + main.h / 2], [toRight ? r.x : r.x + r.w, r.y + r.h / 2], 0, i)
    }
  } else {
    const main: Rect = { x: cx - W * 0.32, y: H * 0.44, w: W * 0.64, h: H * 0.12 }
    boxes.push(main)
    const upN = Math.floor(others / 2)
    const downN = others - upN
    const bw = W * 0.42
    const row = (count: number, y: number): Rect[] => {
      const h = H * 0.09
      const cols = Math.min(2, count)
      const gap = W * 0.04
      return Array.from({ length: count }, (_, i) => {
        const r = Math.floor(i / 2)
        const c = i % 2
        const inRow = Math.min(cols, count - r * 2)
        const total = inRow * bw + (inRow - 1) * gap
        return { x: cx - total / 2 + c * (bw + gap), y: y + r * (h + H * 0.025) * (y < H / 2 ? -1 : 1), w: bw, h }
      })
    }
    const up = row(upN, H * 0.25)
    const down = row(downN, H * 0.66)
    for (let i = 0; i < others; i++) boxes.push(i % 2 === 0 ? down[i >> 1] : up[i >> 1])
    for (let i = 1; i < n; i++) {
      const r = boxes[i]
      const below = r.y > main.y
      vert([r.x + r.w / 2 < cx ? main.x + main.w * 0.3 : main.x + main.w * 0.7, below ? main.y + main.h : main.y], [r.x + r.w / 2, below ? r.y : r.y + r.h], 0, i)
    }
  }
  return { boxes, links }
}

/** A point along a line at u (0 → 1). */
export function linkPoint(pts: [BPt, BPt, BPt, BPt], u: number): BPt {
  const v = 1 - u
  const a = v * v * v
  const b = 3 * v * v * u
  const c = 3 * v * u * u
  const d = u * u * u
  return [a * pts[0][0] + b * pts[1][0] + c * pts[2][0] + d * pts[3][0], a * pts[0][1] + b * pts[1][1] + c * pts[2][1] + d * pts[3][1]]
}
