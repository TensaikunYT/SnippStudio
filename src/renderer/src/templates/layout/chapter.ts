// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The chapter templates (reel, revolver, scope) and their timing. Moved out
// of templates/model.ts in SnippStudio phase 2B (no change).
import { type RevolverLook, type TemplateBlock } from '../../types'
import type { Rect } from './common'

// -- chapters, through a scope ---------------------------------------------------------

export type ChapterDesign = 'revolver' | 'scope' | 'reel'
/** A revolver (the default), through a scope, or as a cinema reel. */
export const chapterDesign = (b: Pick<TemplateBlock, 'design'>): ChapterDesign => (b.design === 'reel' ? 'reel' : b.design === 'scope' ? 'scope' : 'revolver')

/**
 * The revolver's beats (block time): the video sinking back, each click of
 * the drum (from `past` chapters before it up to the one it brings in), the
 * picture opening out, the end.
 */
export function revolverTimes(b: Pick<TemplateBlock, 'duration' | 'rev'>, open: number): { sink: number; clicks: number[]; first: number; open: number; end: number } {
  const D = Math.max(2, b.duration)
  const past = Math.max(0, Math.min(6, Math.round(b.rev?.past ?? 3)))
  const first = Math.max(0, open - past)
  const steps = open - first + 1
  const sink = Math.min(0.5, D * 0.13)
  const openAt = D - Math.min(0.8, D * 0.2)
  const room = Math.max(0.3, openAt - sink - 0.15 - Math.min(1.3, D * 0.32))
  const gap = Math.max(0.14, Math.min(0.42, room / Math.max(1, steps))) / Math.max(0.5, Math.min(2, b.rev?.speed ?? 1))
  const clicks = Array.from({ length: steps }, (_, k) => sink + 0.12 + k * gap + (k === steps - 1 && steps > 1 ? gap * 0.35 : 0))
  return { sink, clicks, first, open: openAt, end: D }
}

/** Where the revolver's parts sit: the drum (its middle, radius, face
 *  size) and the stack of chapter lines. */
export function revolverLayout(b: Pick<TemplateBlock, 'rev'>, left: number, W: number, H: number): { drum: { cx: number; cy: number; R: number; fw: number; fh: number; chambers: number } | null; stack: { x: number; y: number; w: number; size: number } } {
  const portrait = W / H < 1
  const side = b.rev?.drum ?? 'right'
  if (portrait) {
    const fw = W * 0.74
    const fh = fw / 1.78
    const drum = side === 'none' ? null : { cx: left + W / 2, cy: H * 0.34, R: fh * 1.05, fw, fh, chambers: 6 }
    return { drum, stack: { x: left + W * 0.08, y: side === 'none' ? H * 0.5 : H * 0.74, w: W * 0.84, size: W * 0.075 } }
  }
  const fw = W * 0.34
  const fh = fw / 1.78
  const R = fh * 1.05
  const drumX = side === 'left' ? left + W * 0.28 : left + W * 0.7
  const drum = side === 'none' ? null : { cx: drumX, cy: H * 0.5, R, fw, fh, chambers: 6 }
  const sx = side === 'left' ? left + W * 0.54 : left + W * 0.07
  return { drum, stack: { x: sx, y: H * 0.56, w: side === 'none' ? W * 0.86 : W * 0.42, size: H * 0.075 } }
}

/** A revolver's settings, made safe. */
export function cleanRevolverLook(v: unknown): RevolverLook {
  const o = (v ?? {}) as Record<string, unknown>
  const out: RevolverLook = {}
  const n = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (n(o.past)) out.past = Math.max(0, Math.min(6, Math.round(o.past)))
  if (n(o.speed)) out.speed = Math.max(0.5, Math.min(2, o.speed))
  if (o.drum === 'left' || o.drum === 'none') out.drum = o.drum
  if (o.roman === true) out.roman = true
  if (o.click === false) out.click = false
  if (n(o.clickVol)) out.clickVol = Math.max(0, Math.min(1, o.clickVol))
  return out
}

/** Where the eyepiece sits, how near it sees, and where the words go. */
export function scopeLayout(left: number, W: number, H: number): { cx: number; cy: number; R: number; zoom: number; text: { x: number; y: number; w: number; size: number; align: 'left' | 'center' } } {
  if (W / H < 1) {
    const R = W * 0.4
    const cy = H * 0.4
    const size = W * 0.1
    return { cx: left + W / 2, cy, R, zoom: 1.9, text: { x: left + W * 0.08, y: cy + R * 1.22 + size * 0.4, w: W * 0.84, size, align: 'center' } }
  }
  const R = H * 0.34
  const cx = left + W * 0.36
  const x = cx + R * 1.34
  return { cx, cy: H / 2, R, zoom: 1.9, text: { x, y: H * 0.43, w: left + W * 0.95 - x, size: H * 0.1, align: 'left' } }
}

/** The scope's beats (block time): raised, the swing to the next chapter,
 *  the glass opening out, the end. */
export function scopeTimes(b: Pick<TemplateBlock, 'duration'>): { raise: number; swing: [number, number]; open: number; end: number } {
  const D = Math.max(2, b.duration)
  const raise = Math.min(0.6, D * 0.15)
  const s0 = raise + Math.min(0.35, D * 0.08)
  const s1 = s0 + Math.min(0.62, D * 0.16)
  return { raise, swing: [s0, s1], open: Math.max(s1 + 0.4, D - Math.min(0.85, D * 0.22)), end: D }
}

// -- chapters, as a cinema reel --------------------------------------------------------

/** Where the reel's frames sit: the middle one, and how far apart they are. */
export function chapterLayout(b: Pick<TemplateBlock, 'items' | 'open'>, left: number, W: number, H: number, open?: number): { mid: Rect; spacing: number; open: number } {
  const portrait = W / H < 1
  const w = portrait ? W * 0.86 : W * 0.62
  const h = portrait ? w / 1.6 : w / 2.39
  const mid = { x: left + (W - w) / 2 + (portrait ? 0 : W * 0.035), y: (H - h) / 2, w, h }
  const n = Math.max(1, b.items.length)
  return { mid, spacing: h + H * (portrait ? 0.04 : 0.065), open: Math.min(n - 1, Math.max(0, open ?? b.open ?? 0)) }
}

/** The beats (block time): the video in its frame, the pull, the new
 *  chapter opening out, the end. */
export function chapterTimes(b: Pick<TemplateBlock, 'duration'>): { land: number; slide: [number, number]; open: number; end: number } {
  const D = Math.max(2, b.duration)
  const open = D - Math.min(0.9, D * 0.25)
  const s1 = Math.min(1.95, open - 0.45)
  return { land: Math.min(0.55, D * 0.16), slide: [Math.min(0.75, s1 - 0.5), s1], open, end: D }
}
