// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The cutout title's layout: its paper pieces, fonts and the (lazy, guarded)
// text measure. Moved out of templates/model.ts in SnippStudio phase 2B
// (no change).
import { type TemplateBlock } from '../../types'
import { templateSlots } from './common'

// -- cutout title ------------------------------------------------------------------

/** Each word's paper: where it lies, how big, its type and colours. */
export interface CutoutPiece {
  text: string
  cx: number
  cy: number
  w: number
  h: number
  rot: number
  size: number
  font: string
  weight: number
  /** Baseline nudge (fractions of the size) for fonts that sit high. */
  dy: number
  paper: string
  ink: string
  seed: number
  tape: boolean
  tapeRot: number
}

export const CUT_FONTS: { font: string; weight: number; upper: boolean; dy: number }[] = [
  { font: 'Archivo Black', weight: 400, upper: false, dy: 0.04 },
  { font: 'Anton', weight: 400, upper: true, dy: 0.05 },
  { font: 'Bebas Neue', weight: 400, upper: true, dy: 0.06 },
  { font: 'Merriweather', weight: 800, upper: false, dy: 0.04 },
  { font: 'Oswald', weight: 700, upper: true, dy: 0.05 },
  { font: 'Permanent Marker', weight: 400, upper: false, dy: 0.06 }
]
export const h01 = (a: number, b: number): number => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return n - Math.floor(n)
}
export let measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
export function measure(text: string, font: string): number {
  if (!measureCtx) {
    measureCtx =
      typeof OffscreenCanvas !== 'undefined'
        ? (new OffscreenCanvas(8, 8).getContext('2d') as OffscreenCanvasRenderingContext2D)
        : typeof document !== 'undefined'
          ? document.createElement('canvas').getContext('2d')
          : null
  }
  if (!measureCtx) return text.length * 0.6 * (parseFloat(font.split('px')[0].split(' ').pop() ?? '40') || 40)
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/**
 * The cutout title laid out (frame pixels): words set in lines, centred,
 * each on its own paper — a different type and paper for each, chosen by
 * the block's seed — its size from the word's value (100 = normal).
 */
export function cutoutLayout(b: Pick<TemplateBlock, 'items' | 'seed' | 'style'>, left: number, W: number, H: number): CutoutPiece[] {
  const portrait = W / H < 1
  const base = (portrait ? 0.075 : 0.1) * H
  const papers: [string, string][] = [
    ['#ffffff', '#0b0b0d'],
    [b.style.accent, '#0b0b0d'],
    ['#0b0b0d', '#ffffff'],
    ['#e6d5b0', '#2a1d10'],
    ['#ff5a3c', '#ffffff'],
    ['#f3efe6', '#b3262e']
  ]
  const raw = b.items.map((it, i) => {
    const fi = Math.floor(h01(b.seed, i * 7 + 1) * CUT_FONTS.length)
    const f = CUT_FONTS[(fi + i) % CUT_FONTS.length]
    const text = f.upper ? (it.title ?? '').toLocaleUpperCase('tr') : it.title ?? ''
    const size = base * Math.max(0.4, Math.min(3, (it.value ?? 100) / 100))
    const tw = measure(text, `${f.weight} ${size}px "${f.font}"`)
    const pad = size * 0.28
    const pi = (i + Math.floor(h01(b.seed, i * 3 + 2) * 3)) % papers.length
    return { text, f, size, w: tw + pad * 2, h: size * 1.28, paper: papers[pi][0], ink: papers[pi][1] }
  })
  // Lines, centred, no wider than most of the frame.
  const maxW = W * (portrait ? 0.86 : 0.8)
  const gap = base * 0.18
  const lines: (typeof raw)[] = [[]]
  let lw = 0
  for (const r of raw) {
    if (lines[lines.length - 1].length && lw + gap + r.w > maxW) {
      lines.push([r])
      lw = r.w
    } else {
      lw += (lines[lines.length - 1].length ? gap : 0) + r.w
      lines[lines.length - 1].push(r)
    }
  }
  const heights = lines.map((l) => Math.max(...l.map((r) => r.h)))
  const total = heights.reduce((a, h) => a + h, 0) + gap * (lines.length - 1)
  let y = H * (portrait ? 0.42 : 0.5) - total / 2
  const out: CutoutPiece[] = []
  let idx = 0
  lines.forEach((line, li) => {
    const width = line.reduce((a, r) => a + r.w, 0) + gap * (line.length - 1)
    let x = left + W / 2 - width / 2
    for (const r of line) {
      const i = idx++
      out.push({
        text: r.text,
        cx: x + r.w / 2,
        cy: y + heights[li] / 2 + (h01(b.seed, i * 5 + 3) - 0.5) * base * 0.12,
        w: r.w,
        h: r.h,
        rot: (h01(b.seed, i * 11 + 4) - 0.5) * 0.12,
        size: r.size,
        font: r.f.font,
        weight: r.f.weight,
        dy: r.f.dy,
        paper: r.paper,
        ink: r.ink,
        seed: b.seed * 31 + i,
        tape: h01(b.seed, i * 13 + 5) > 0.55,
        tapeRot: (h01(b.seed, i * 17 + 6) - 0.5) * 0.5
      })
      x += r.w + gap
    }
    y += heights[li] + gap
  })
  return out
}

/** When each word is carried in (block time) and where from: the left and
 *  right edges in turn, a little above or below where it lands. */
export function cutoutTimes(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items' | 'seed' | 'style'>, left: number, W: number, H: number): { t0: number; t1: number; from: [number, number]; rot0: number }[] {
  const s = templateSlots(b)
  const L = cutoutLayout(b, left, W, H)
  const carry = Math.min(0.5, Math.max(0.28, s.len * 0.7))
  return L.map((p, i) => {
    const fromLeft = i % 2 === 0
    const t1 = s.at(i)
    return {
      t0: Math.max(0.05, t1 - carry),
      t1,
      from: [fromLeft ? left - p.w * 0.2 : left + W + p.w * 0.2, p.cy + (h01(b.seed, i * 19 + 7) - 0.5) * H * 0.3],
      rot0: (fromLeft ? -1 : 1) * 0.35
    }
  })
}
