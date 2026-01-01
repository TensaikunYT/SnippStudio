// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What every template layout uses: a rectangle, the glide easing, and when each
// item of a block comes in (its slots). Moved out of templates/model.ts in
// SnippStudio phase 2B (no change).
import { type TemplateBlock } from '../../types'

export type Rect = { x: number; y: number; w: number; h: number }

/** A gallery's photo i: when it is tapped open and when it closes again
 *  (block time). Tap to open uses the same beat. */
export function galleryTimes(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>, i: number): { tap: number; open: number; close: number } {
  const s = templateSlots(b)
  const open = s.at(i)
  const next = i + 1 < s.count ? s.at(i + 1) : b.duration - 0.4
  return { tap: open - 0.08, open, close: Math.max(open + 0.6, next - 0.5) }
}

/**
 * When each item arrives, in the block's own time. The items share the
 * block evenly, so stretching the block on the lane slows the whole reveal
 * down and shrinking it speeds it up — the pacing is one drag.
 */
export function templateSlots(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>): {
  count: number
  at: (i: number) => number
  len: number
} {
  const [lead, tail] =
    b.kind === 'ranking'
      ? [0.55, 0.4]
      : b.kind === 'versus'
        ? [1.5, 1.4]
        : b.kind === 'timeline'
          ? [0.6, 0.8]
          : b.kind === 'gallery' || b.kind === 'focus'
            ? [1.2, 0.7]
            : b.kind === 'map'
              ? [1.1, 0.9]
            : b.kind === 'line'
              ? [1.35, 1.3]
            : b.kind === 'bars' || b.kind === 'pie'
              ? [0.9, 1.3]
            : b.kind === 'cutout'
              ? [1.0, 1.1]
            : b.kind === 'checklist'
              ? [1.0, 0.9]
            : b.kind === 'list'
              ? [0.9, 0.9]
            : b.kind === 'post'
              ? [1.3, 1.0]
            : b.kind === 'count'
              ? [0.9, 1.1]
              : [0.55, 0.9]
  if (b.kind === 'boxes') {
    // Each box's own glow.
    const T = boxesTimes(b)
    return { count: b.items.length, at: (i) => T.light[i] ?? 0, len: T.travel }
  }
  const count = b.kind === 'versus' ? Math.max(0, b.items.length - 2) : b.kind === 'stat' ? 0 : b.items.length
  const len = Math.max(0.35, (b.duration - lead - tail) / Math.max(1, count))
  return { count, at: (i) => lead + i * len, len }
}

/** The glide every drag and what follows it share. */
export const glide = (u: number): number => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/**
 * When each box comes up and when it lights (block seconds), and how long
 * the light takes along a line. The main box lights first; each box lights
 * at its own `at` when set, else they share the block evenly.
 */
export function boxesTimes(b: Pick<TemplateBlock, 'items' | 'duration'>): { appear: number[]; light: number[]; travel: number } {
  const n = b.items.length
  const D = Math.max(1, b.duration)
  const appear = b.items.map((_, i) => (i === 0 ? 0.12 : 0.32 + 0.07 * (i - 1)))
  const first = Math.min(0.95, D * 0.16)
  const lastAt = D - Math.min(1.1, D * 0.18)
  const travel = Math.max(0.28, Math.min(0.62, ((lastAt - first) / Math.max(1, n - 1)) * 0.55))
  const light = b.items.map((it, i) => {
    if (it.at !== undefined && Number.isFinite(it.at)) return Math.max(0, Math.min(D - 0.1, it.at))
    if (i === 0) return first
    return first + travel + ((lastAt - first - travel) * (i - 1)) / Math.max(1, n - 2)
  })
  return { appear, light, travel }
}
