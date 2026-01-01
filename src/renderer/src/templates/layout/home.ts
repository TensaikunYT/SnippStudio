// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The home screen template's layout and timing. Moved out of
// templates/model.ts in SnippStudio phase 2B (no change).
import { type Project, type TemplateBlock } from '../../types'
import { glide } from './common'
import type { Rect } from './common'

export type HomeDesign = 'apps' | 'deck' | 'timeline' | 'slider'
export const homeDesign = (b: Pick<TemplateBlock, 'design'>): HomeDesign =>
  b.design === 'deck' || b.design === 'timeline' || b.design === 'slider' ? b.design : 'apps'

/** Which chapter a home screen opens: its own choice, or one more than the
 *  home screens before it on the timeline. */
export function homeOpens(p: Pick<Project, 'templates'>, b: TemplateBlock): number {
  const n = Math.max(1, b.items.length)
  if (b.open !== undefined) return Math.min(n - 1, Math.max(0, b.open))
  const before = (p.templates ?? []).filter((t) => t.kind === b.kind && t.start < b.start - 1e-6).length
  return Math.min(n - 1, before)
}

/**
 * The beats of a home screen (block time): the swipe up from the bottom edge
 * that takes the video home, the moment it lands in its place, the move to
 * the next chapter (the deck slides, the playhead is dragged), the tap, and
 * the chapter opening to fill the frame.
 */
export function homeTimes(b: Pick<TemplateBlock, 'duration' | 'design'>): { swipe: [number, number]; land: number; slide: [number, number]; tap: number; open: number; end: number } {
  const D = Math.max(2.4, b.duration)
  const tap = D - 0.95
  const slide0 = Math.min(1.35, tap - 0.9)
  return { swipe: [0.1, 0.62], land: 1.05, slide: [slide0, Math.min(slide0 + 0.55, tap - 0.3)], tap, open: tap + 0.07, end: D }
}

/** Where the swipe home starts and ends (frame pixels). */
export function homeSwipe(left: number, W: number, H: number): { from: [number, number]; to: [number, number] } {
  const cx = left + W / 2
  return { from: [cx, H * 0.985], to: [cx, H * 0.56] }
}

/** The live picture as a card while it is swiped home, at swipe progress p. */
export function homeLiveCard(left: number, W: number, H: number, p: number): Rect {
  const e = glide(p)
  const { from, to } = homeSwipe(left, W, H)
  const fy = from[1] + (to[1] - from[1]) * e
  const s = 1 - 0.5 * e
  const w = W * s
  const h = H * s
  // Its bottom edge rides just under the swipe point; at rest it is the frame.
  return { x: left + W / 2 - w / 2, y: fy - h * 0.985, w, h }
}

export interface HomeLayout {
  /** Each chapter's place: an app tile, a card, a clip on the track. */
  slots: Rect[]
  /** Timeline design: the monitor, its play button, the ruler's line and
   *  where the playhead is for a chapter position (fractional). */
  monitor?: Rect
  play?: Rect
  rulerY?: number
  playheadX?: (f: number) => number
}

/**
 * Where everything of a home screen is (frame pixels). `f` is the deck's
 * focus / the playhead's chapter position — fractional while it moves.
 */
export function homeLayout(b: Pick<TemplateBlock, 'items' | 'design'>, left: number, W: number, H: number, f: number): HomeLayout {
  const n = Math.max(1, b.items.length)
  const portrait = W / H < 1
  const cx = left + W / 2
  const design = homeDesign(b)
  if (design === 'slider') {
    // A cinematic reel: wide chapter frames one above the other, the one in
    // focus in the middle; the next chapter waits above and comes down.
    const cw = portrait ? W * 0.84 : W * 0.58
    const ch = cw / 2.2
    const step = ch * 1.12
    // Off centre a little in a wide frame, leaving the headline its corner.
    const rx = portrait ? cx : cx + W * 0.07
    const slots: Rect[] = []
    for (let i = 0; i < n; i++) {
      const d = i - f
      const k = 1 - 0.14 * Math.min(1.5, Math.abs(d))
      const y = H * 0.5 - d * step
      slots.push({ x: rx - (cw * k) / 2, y: y - (ch * k) / 2, w: cw * k, h: ch * k })
    }
    return { slots }
  }
  if (design === 'deck') {
    const ch = portrait ? H * 0.42 : H * 0.56
    const cw = ch * 0.75
    const slots: Rect[] = []
    for (let i = 0; i < n; i++) {
      const d = i - f
      const k = 1 - 0.16 * Math.min(1.5, Math.abs(d))
      const x = cx + Math.sign(d) * Math.min(Math.abs(d), 2.6) * cw * 0.74
      slots.push({ x: x - (cw * k) / 2, y: H * 0.5 - (ch * k) / 2, w: cw * k, h: ch * k })
    }
    return { slots }
  }
  if (design === 'timeline') {
    const mw = portrait ? W * 0.86 : W * 0.48
    const mh = (mw * 9) / 16
    const monitor: Rect = { x: cx - mw / 2, y: portrait ? H * 0.16 : H * 0.1, w: mw, h: mh }
    const ps = H * 0.055
    const play: Rect = { x: cx - ps / 2, y: monitor.y + mh + H * 0.025, w: ps, h: ps }
    const tx = left + W * (portrait ? 0.05 : 0.1)
    const tw = W * (portrait ? 0.9 : 0.8)
    const ty = portrait ? H * 0.66 : H * 0.72
    const th = H * (portrait ? 0.07 : 0.11)
    const gap = W * 0.004
    const cw = tw / n
    const slots: Rect[] = b.items.map((_, i) => ({ x: tx + i * cw + gap / 2, y: ty, w: cw - gap, h: th }))
    const rulerY = ty - H * 0.035
    return { slots, monitor, play, rulerY, playheadX: (fi: number) => tx + Math.max(0, Math.min(n, fi)) * cw }
  }
  // apps: a grid of rounded tiles, labels under them.
  const cols = portrait ? Math.min(3, n) : n <= 4 ? n : n <= 6 ? 3 : 4
  const rows = Math.ceil(n / cols)
  const s = portrait ? W * 0.23 : Math.min(W * 0.15, (W * 0.78) / (cols + (cols - 1) * 0.38), (H * 0.58) / (rows * 1.45))
  const gx = s * (portrait ? 0.4 : 0.38)
  const gy = s * 0.5
  const total = cols * s + (cols - 1) * gx
  // The grid sits a little below the middle, under the headline.
  const topY = (portrait ? H * 0.4 : H * 0.52) - (rows * s + (rows - 1) * gy) / 2 + (portrait ? 0 : -s * 0.12)
  const slots: Rect[] = b.items.map((_, i) => ({ x: cx - total / 2 + (i % cols) * (s + gx), y: topY + Math.floor(i / cols) * (s + gy), w: s, h: s }))
  return { slots }
}

/** The deck's focus / the playhead's position at block time t. */
export function homeFocus(b: Pick<TemplateBlock, 'duration' | 'design'>, open: number, t: number): number {
  const T = homeTimes(b)
  const design = homeDesign(b)
  if (design === 'apps') return open
  const from = design === 'timeline' ? (open > 0 ? open - 0.12 : 0) : Math.max(0, open - 1)
  const to = design === 'timeline' ? open + 0.06 : open
  return from + (to - from) * glide((t - T.slide[0]) / (T.slide[1] - T.slide[0]))
}
