// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chart templates' layouts (bar, pie, line). Moved out of
// templates/model.ts in SnippStudio phase 2B (no change).
import { type TemplateBlock } from '../../types'
import { templateSlots } from './common'
import type { Rect } from './common'

// -- charts ---------------------------------------------------------------------

/** Where a chart sits (frame pixels): its plot (left, width, baseline,
 *  height), its card, and the parts of each kind. */
export interface ChartLayout {
  left: number
  width: number
  base: number
  height: number
  panel: Rect
  bars: Rect[]
  pie?: { cx: number; cy: number; R: number }
  legend?: Rect[]
  points?: [number, number][]
  points2?: [number, number][]
  min?: number
  max?: number
}

/** A round number at or above v (1, 2, 2.5 or 5 times a power of ten). */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
}

/** The top of a bar chart's scale. */
export const barsMax = (b: Pick<TemplateBlock, 'items'>): number => niceCeil(Math.max(1e-9, ...b.items.map((it) => it.value ?? 0)) * 1.05)

/** How long a bar takes to rise: as long as there is room before the next
 *  one starts. */
export function barLift(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>): number {
  return Math.min(0.75, Math.max(0.35, templateSlots(b).len - 0.42))
}

/** How long the pen takes over the line's stretch from point i to i + 1. */
export const lineStretch = (at: number[], i: number): number => Math.min(0.9, at[i + 1] - at[i])

/** When each item of a chart arrives (block time). */
export function chartTimes(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>): { at: number[] } {
  const s = templateSlots(b)
  return { at: b.items.map((_, i) => s.at(i)) }
}

/** How far a pulled slice comes out (of the radius). */
export const PIE_PULL = 0.14

/** A pie's biggest slice, pinched and drawn out of the pie a little once the
 *  last is drawn (block seconds) — null when the block is too short. */
export function piePull(b: Pick<TemplateBlock, 'kind' | 'duration' | 'items'>): { index: number; at: number; dur: number } | null {
  if (b.kind !== 'pie' || b.items.length < 2) return null
  const T = chartTimes(b)
  // A beat after the last slice has come out.
  const at = T.at[T.at.length - 1] + 1.55
  const dur = 0.55
  if (at + dur > b.duration - 0.15) return null
  let index = 0
  b.items.forEach((it, i) => {
    if ((it.value ?? 0) > (b.items[index].value ?? 0)) index = i
  })
  return { index, at, dur }
}

export function plotArea(left: number, W: number, H: number): { left: number; width: number; base: number; height: number; panel: Rect } {
  const portrait = W / H < 1
  const l = left + W * (portrait ? 0.12 : 0.1)
  const w = W * (portrait ? 0.8 : 0.82)
  const base = H * (portrait ? 0.74 : 0.8)
  const height = H * (portrait ? 0.4 : 0.5)
  const panel: Rect = { x: left + W * (portrait ? 0.04 : 0.035), y: H * (portrait ? 0.05 : 0.06), w: W * (portrait ? 0.92 : 0.93), h: H * (portrait ? 0.78 : 0.86) }
  return { left: l, width: w, base, height, panel }
}

export function barsLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): ChartLayout {
  const a = plotArea(left, W, H)
  const n = Math.max(1, b.items.length)
  const slot = a.width / n
  const bw = Math.min(slot * 0.58, H * 0.16)
  const bars = b.items.map((_, i) => ({ x: a.left + slot * i + (slot - bw) / 2, y: a.base, w: bw, h: 0 }))
  return { ...a, bars }
}

export function pieLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): ChartLayout {
  const a = plotArea(left, W, H)
  const portrait = W / H < 1
  const R = portrait ? W * 0.3 : H * 0.29
  const cx = portrait ? left + W * 0.5 : left + W * 0.66
  const cy = portrait ? H * 0.42 : H * 0.55
  const lw = portrait ? W * 0.76 : W * 0.34
  const lx = portrait ? left + W * 0.12 : left + W * 0.07
  const ly = portrait ? H * 0.66 : H * 0.36
  const legend = b.items.map((_, i) => ({ x: lx, y: ly + i * H * (portrait ? 0.045 : 0.075), w: lw, h: 30 }))
  return { ...a, bars: [], pie: { cx, cy, R }, legend }
}

export function lineLayout(b: Pick<TemplateBlock, 'items'>, left: number, W: number, H: number): ChartLayout {
  const a = plotArea(left, W, H)
  const n = b.items.length
  const vals = b.items.flatMap((it) => [it.value ?? 0, ...(typeof it.value2 === 'number' ? [it.value2] : [])])
  const lo = Math.min(0, ...vals) < 0 ? -niceCeil(-Math.min(...vals) * 1.05) : 0
  const hi = niceCeil(Math.max(1e-9, ...vals) * 1.08)
  const x = (i: number): number => a.left + (n > 1 ? (a.width * i) / (n - 1) : a.width / 2)
  const y = (v: number): number => a.base - ((v - lo) / Math.max(1e-9, hi - lo)) * a.height
  const points = b.items.map((it, i) => [x(i), y(it.value ?? 0)] as [number, number])
  const second = b.items.some((it) => typeof it.value2 === 'number')
  const points2 = second ? b.items.map((it, i) => [x(i), y(it.value2 ?? 0)] as [number, number]) : undefined
  return { ...a, bars: [], points, ...(points2 ? { points2 } : {}), min: lo, max: hi }
}
