// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What is drawn on a frame for a work note: a box, an arrow, a pen stroke, a
// numbered pin (phase 11b, the user's request: one click points at a place), in
// 0..1 frame coordinates. VideoHub's ui/review/shapes.js, rewritten for
// Snipp: the same shape format and the same look, so a drawing reads the same
// on the preview, in the note's saved picture and to an agent. Pure: `paint`
// takes any 2D context (the tests hand it a recording one).

import type { NoteShape } from '../types'

/** The part of a 2D context the painter uses. */
export interface PaintContext {
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, w: number, h: number): void
  stroke(): void
  globalAlpha: number
  lineCap: string
  lineJoin: string
  lineWidth: number
  strokeStyle: unknown
  // (A pin: a filled head with its number.)
  closePath(): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  fillText(text: string, x: number, y: number): void
  fillStyle: unknown
  font: string
  textAlign: string
  textBaseline: string
}

/** Each shape's pin number (1, 2, 3 … in the note's order; null for a shape
 *  that is no pin). Counted every time from the order, never stored: a pin
 *  rubbed out renumbers the rest. */
export function pinNumbers(shapes: readonly NoteShape[]): (number | null)[] {
  let n = 0
  return shapes.map((s) => (s.type === 'pin' ? ++n : null))
}

/** Each pin's label when the pins belong to note `num` (the watch mode, where
 *  the list shows the note's number): "8" for a note's only pin, "8.1",
 *  "8.2" … for several; null for a shape that is no pin. */
export function notePinLabels(shapes: readonly NoteShape[], num: number): (string | null)[] {
  const nums = pinNumbers(shapes)
  const many = nums.filter((n) => n !== null).length > 1
  return nums.map((n) => (n === null ? null : many ? `${num}.${n}` : String(num)))
}

/** A pin's head radius on a frame W pixels wide, and how far above the point
 *  its centre sits (in radii): the tip is on the point, so the place pointed
 *  at stays in sight (VideoHub's pinR / PIN_HEAD). */
export const pinRadius = (W: number): number => Math.max(10, W * 0.012)
export const PIN_HEAD = 2.1

/** The pin's outline: a round head over the point, its tip on the point. */
function pinOutline(c: PaintContext, x: number, y: number, r: number): void {
  const hy = y - r * PIN_HEAD
  c.beginPath()
  c.moveTo(x, y - r * 0.15)
  c.lineTo(x - r * 0.62, hy + r * 0.78)
  c.arc(x, hy, r, Math.PI * 0.76, Math.PI * 0.24)
  c.closePath()
}

/** Colours a pin's number is dark on (the light ones of NOTE_COLORS). */
const LIGHT = new Set(['#ffb02e', '#3ee089', '#ffffff'])

function paintPin(c: PaintContext, s: NoteShape, label: string, W: number, H: number): void {
  const [px, py] = s.pts[0]
  const x = px * W
  const y = py * H
  const r = pinRadius(W)
  pinOutline(c, x, y, r)
  c.fillStyle = s.color
  c.fill()
  c.lineWidth = Math.max(1.6, r * 0.14)
  c.strokeStyle = '#ffffff'
  c.stroke()
  // The point itself: a small white dot with a dark rim.
  c.beginPath()
  c.arc(x, y, Math.max(2.2, r * 0.2), 0, Math.PI * 2)
  c.fillStyle = '#ffffff'
  c.fill()
  c.lineWidth = 1.2
  c.strokeStyle = 'rgba(0,0,0,0.8)'
  c.stroke()
  c.fillStyle = LIGHT.has(s.color.toLowerCase()) ? '#111111' : '#ffffff'
  c.font = `700 ${Math.round(r * (label.length > 3 ? 0.62 : label.length > 2 ? 0.8 : 1.05))}px sans-serif`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(label, x, y - r * PIN_HEAD + r * 0.06)
}

/** The box round every point of the shapes: [x0, y0, x1, y1] inside the
 *  frame. With no shapes: the whole frame. */
export function bbox(shapes: readonly NoteShape[]): [number, number, number, number] {
  let x0 = 1
  let y0 = 1
  let x1 = 0
  let y1 = 0
  let any = false
  for (const s of shapes) {
    for (const [x, y] of s.pts) {
      any = true
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, s.type === 'pin' ? y - 0.05 : y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (!any) return [0, 0, 1, 1]
  return [Math.max(0, x0), Math.max(0, y0), Math.min(1, x1), Math.min(1, y1)]
}

/** The part of the frame a close-up of the drawing shows: its box with room
 *  round it, never smaller than `min` of the frame a side. */
export function closeUp(shapes: readonly NoteShape[], pad = 0.08, min = 0.2): [number, number, number, number] {
  let [x0, y0, x1, y1] = bbox(shapes)
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 += pad
  const grow = (a: number, b: number): [number, number] => {
    const need = Math.min(1, min) - (b - a)
    if (need > 0) {
      a -= need / 2
      b += need / 2
    }
    if (a < 0) {
      b -= a
      a = 0
    }
    if (b > 1) {
      a -= b - 1
      b = 1
    }
    return [Math.max(0, a), Math.min(1, b)]
  }
  ;[x0, x1] = grow(x0, x1)
  ;[y0, y1] = grow(y0, y1)
  return [x0, y0, x1, y1]
}

/** The two barbs of an arrow's head at `b`, coming from `a` (frame pixels). */
export function arrowHead(a: [number, number], b: [number, number], W: number): [[number, number], [number, number]] {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
  const L = Math.max(12, W * 0.02)
  return [
    [b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45)],
    [b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)]
  ]
}

/** A stroke's width on a frame W pixels wide (it scales with the picture). */
export const strokeWidth = (W: number): number => Math.max(2.5, W * 0.0035)

function trace(c: PaintContext, s: NoteShape, W: number, H: number): void {
  const P = s.pts.map(([x, y]): [number, number] => [x * W, y * H])
  c.beginPath()
  if (P.length === 0) return
  if (s.type === 'pen') {
    P.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
    // A single dot is still a mark.
    if (P.length === 1) c.lineTo(P[0][0] + 0.01, P[0][1])
    return
  }
  const a = P[0]
  const b = P[P.length - 1]
  if (s.type === 'rect') {
    c.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))
    return
  }
  c.moveTo(a[0], a[1])
  c.lineTo(b[0], b[1])
  for (const barb of arrowHead(a, b, W)) {
    c.moveTo(b[0], b[1])
    c.lineTo(barb[0], barb[1])
  }
}

/**
 * Draws the shapes on a frame of W × H pixels (the context's origin is the
 * frame's top-left). Each stroke has a dark under-stroke, so a white arrow
 * reads on a white wall and a red box on a red shirt. `labels` (one per
 * shape) writes other words in the pins than 1, 2, 3 (notePinLabels).
 */
export function paintShapes(c: PaintContext, shapes: readonly NoteShape[], W: number, H: number, alpha = 1, labels?: readonly (string | null)[]): void {
  c.save()
  c.globalAlpha = alpha
  c.lineCap = 'round'
  c.lineJoin = 'round'
  const w = strokeWidth(W)
  const nums = pinNumbers(shapes)
  shapes.forEach((s, i) => {
    if (s.type === 'pin') {
      if (s.pts.length) paintPin(c, s, labels?.[i] ?? String(nums[i]), W, H)
      return
    }
    trace(c, s, W, H)
    c.lineWidth = w + Math.max(2, w * 0.8)
    c.strokeStyle = 'rgba(0,0,0,0.55)'
    c.stroke()
    c.lineWidth = w
    c.strokeStyle = s.color
    c.stroke()
  })
  c.restore()
}

/** The shape nearest to a point (to rub one out), or -1 when none is within
 *  `tol` of it. A box is picked by its edges, not its inside. */
export function hit(shapes: readonly NoteShape[], pt: [number, number], tol = 0.025): number {
  let best = -1
  let bd = tol
  const seg = (a: [number, number], b: [number, number]): number => {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const u = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / l2))
    return Math.hypot(pt[0] - (a[0] + u * dx), pt[1] - (a[1] + u * dy))
  }
  shapes.forEach((s, i) => {
    if (s.pts.length === 0) return
    let d = Infinity
    const a = s.pts[0]
    const b = s.pts[s.pts.length - 1]
    if (s.type === 'rect') {
      const [x0, y0, x1, y1] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
      d = Math.min(seg([x0, y0], [x1, y0]), seg([x1, y0], [x1, y1]), seg([x1, y1], [x0, y1]), seg([x0, y1], [x0, y0]))
    } else if (s.type === 'arrow') {
      d = seg(a, b)
    } else if (s.type === 'pin') {
      // Its point, or its head (about 0.04 of the frame above it).
      d = Math.min(Math.hypot(pt[0] - a[0], pt[1] - a[1]), Math.hypot(pt[0] - a[0], pt[1] - (a[1] - 0.04)))
    } else if (s.pts.length === 1) {
      d = Math.hypot(pt[0] - a[0], pt[1] - a[1])
    } else {
      for (let k = 1; k < s.pts.length; k++) d = Math.min(d, seg(s.pts[k - 1], s.pts[k]))
    }
    // Later shapes are on top: at the same distance the last one drawn wins.
    if (d <= bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** A pen stroke with the points that add nothing taken out (a drag gives one
 *  every pixel): every kept point is at least `min` of the frame from the last. */
export function thin(pts: readonly [number, number][], min = 0.003): [number, number][] {
  if (pts.length <= 2) return pts.map((p) => [p[0], p[1]])
  const out: [number, number][] = [[pts[0][0], pts[0][1]]]
  for (let i = 1; i < pts.length - 1; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) >= min) out.push([pts[i][0], pts[i][1]])
  }
  const end = pts[pts.length - 1]
  out.push([end[0], end[1]])
  return out
}

/** Whether a shape is worth keeping: a box or an arrow dragged a real
 *  distance, a pen stroke of any length, a pin. */
export function worthKeeping(s: NoteShape): boolean {
  if (s.pts.length === 0) return false
  if (s.type === 'pen' || s.type === 'pin') return true
  const a = s.pts[0]
  const b = s.pts[s.pts.length - 1]
  return Math.hypot(b[0] - a[0], b[1] - a[1]) >= 0.01
}

/** A press that moved less than this (CSS pixels) is a click: it puts a pin,
 *  whatever drawing tool is on (phase 11b, the user's request). */
export const CLICK_SLOP = 4

/** What a press and release of a drawing tool leaves: the shape drawn, or a
 *  pin at the press when the pointer moved less than `CLICK_SLOP` pixels. */
export function shapeOfStroke(shape: NoteShape, movedPx: number): NoteShape {
  if (shape.type === 'pin' || movedPx < CLICK_SLOP) return { type: 'pin', pts: [[shape.pts[0][0], shape.pts[0][1]]], color: shape.color }
  return shape.type === 'pen' ? { ...shape, pts: thin(shape.pts) } : shape
}
