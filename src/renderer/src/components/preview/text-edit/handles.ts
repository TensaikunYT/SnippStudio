// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A selected title's or shape's box in the preview (SnippStudio
// YAZI2-PLAN.md, 2.3): its eight handles and its turn knob, the cursor each
// one shows, and what a pull on a handle makes of the box. A corner and the
// top and bottom sides size the title as a whole, the opposite corner or side
// staying where it is (Alt: its middle stays); the left and right sides set
// how wide the block may be (its words wrap), the opposite side staying.
// Pure; tested in src/test/text-edit-handles.test.ts.
import { TURN_STEP, knobAt, resizeCursor, type Pt } from '../../../ui/handles'

export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandleId = (typeof HANDLE_IDS)[number]

/** Which way a handle pulls, in the box's own frame. */
export const HANDLE_DIR: Record<HandleId, Pt> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }

/** A box as it stands (on screen or on the frame): its middle, its size, its turn. */
export interface TurnedBox {
  cx: number
  cy: number
  w: number
  h: number
  rot: number
}

/** The outline stands this far outside the letters (screen px). */
export const OUTLINE_PAD = 6
/** A side's handle is drawn only when the side is at least this long (screen
 *  px): on a shorter one it would sit on the corners'. */
export const SIDE_MIN = 26

const turn = (x: number, y: number, rot: number): Pt => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)]

/** A point of the box's own frame (from its middle) where it stands. */
export function boxPoint(b: TurnedBox, lx: number, ly: number): Pt {
  const [x, y] = turn(lx, ly, b.rot)
  return [b.cx + x, b.cy + y]
}

/** A point where it stands, in the box's own frame (from its middle). */
export function boxLocal(b: TurnedBox, x: number, y: number): Pt {
  return turn(x - b.cx, y - b.cy, -b.rot)
}

/** Is a point inside the box (grown by `pad` on every side)? */
export function insideBox(b: TurnedBox, x: number, y: number, pad = 0): boolean {
  const [lx, ly] = boxLocal(b, x, y)
  return Math.abs(lx) <= b.w / 2 + pad && Math.abs(ly) <= b.h / 2 + pad
}

/** The box grown by `pad` on every side. */
export const grown = (b: TurnedBox, pad: number): TurnedBox => ({ ...b, w: b.w + pad * 2, h: b.h + pad * 2 })

/** The box's four corners where it stands: nw, ne, se, sw. */
export function boxCorners(b: TurnedBox): Pt[] {
  return [boxPoint(b, -b.w / 2, -b.h / 2), boxPoint(b, b.w / 2, -b.h / 2), boxPoint(b, b.w / 2, b.h / 2), boxPoint(b, -b.w / 2, b.h / 2)]
}

/** The box that stands straight round a turned one: left, top, right, bottom. */
export function boundsOf(b: TurnedBox): { l: number; t: number; r: number; b: number } {
  const c = Math.abs(Math.cos(b.rot))
  const s = Math.abs(Math.sin(b.rot))
  const hw = (b.w * c + b.h * s) / 2
  const hh = (b.w * s + b.h * c) / 2
  return { l: b.cx - hw, t: b.cy - hh, r: b.cx + hw, b: b.cy + hh }
}

export interface HandleAt {
  id: HandleId
  x: number
  y: number
}

/** The handles of an outline (screen px), the corners first: a side's only
 *  when the side is long enough to hold it between the corners. */
export function boxHandles(b: TurnedBox): HandleAt[] {
  const out: HandleAt[] = []
  const put = (id: HandleId): void => {
    const [dx, dy] = HANDLE_DIR[id]
    const [x, y] = boxPoint(b, (dx * b.w) / 2, (dy * b.h) / 2)
    out.push({ id, x, y })
  }
  for (const id of ['nw', 'ne', 'se', 'sw'] as const) put(id)
  if (b.h >= SIDE_MIN) for (const id of ['e', 'w'] as const) put(id)
  if (b.w >= SIDE_MIN + 14) for (const id of ['n', 's'] as const) put(id)
  return out
}

/** The cursor over a handle: the arrows lie along its pull, on a turned box too. */
export function handleCursor(id: HandleId, rot: number): string {
  const [dx, dy] = HANDLE_DIR[id]
  return resizeCursor(Math.atan2(dy, dx) + rot)
}

/** The turn knob of an outline (screen px): above it, below when that would
 *  leave the preview (ui/handles.ts knobAt, one rule for every knob). */
export function boxKnob(b: TurnedBox, maxY: number): { base: Pt; knob: Pt } {
  const { base, knob } = knobAt(b.cx, b.cy, b.h / 2, b.rot, 8, 24, maxY - 8)
  return { base, knob }
}

/** A turn as a title takes it: Shift → 15° steps; otherwise every 45°
 *  catches within 4°, anything else is free. */
export function snapTurn(angle: number, steps: boolean): number {
  if (steps) return Math.round(angle / TURN_STEP) * TURN_STEP
  const eighth = Math.PI / 4
  const near = Math.round(angle / eighth) * eighth
  return Math.abs(angle - near) < (4 * Math.PI) / 180 ? near : angle
}

/**
 * A title sized by a pull on a corner or on its top or bottom side: `from`
 * and `to` are where the pointer pressed and where it is (the box's space).
 * The handle follows the pointer along its own line out of the fixed point
 * (the opposite corner or side's middle; with `centre`, the box's middle),
 * and the box grows by the same ratio round that point. `min` and `max` bound
 * the ratio.
 */
export function sizeByHandle(b: TurnedBox, id: HandleId, from: Pt, to: Pt, centre: boolean, min: number, max: number): { ratio: number; cx: number; cy: number } {
  const [dx, dy] = HANDLE_DIR[id]
  const h0: Pt = [(dx * b.w) / 2, (dy * b.h) / 2]
  const fixed: Pt = centre ? [0, 0] : [-h0[0], -h0[1]]
  const [mx, my] = turn(to[0] - from[0], to[1] - from[1], -b.rot)
  const vx = h0[0] - fixed[0]
  const vy = h0[1] - fixed[1]
  const len2 = vx * vx + vy * vy
  let ratio = len2 < 1e-9 ? 1 : ((vx + mx) * vx + (vy + my) * vy) / len2
  ratio = Math.min(max, Math.max(min, ratio))
  // The middle moves away from the fixed point as the box grows round it.
  const [ox, oy] = turn(fixed[0] * (1 - ratio), fixed[1] * (1 - ratio), b.rot)
  return { ratio, cx: b.cx + ox, cy: b.cy + oy }
}

/** How wide a pull on the left or right side wants the box (its own space):
 *  the side follows the pointer; with `centre` both sides move. */
export function widthByHandle(b: TurnedBox, id: 'e' | 'w', from: Pt, to: Pt, centre: boolean): number {
  const [mx] = turn(to[0] - from[0], to[1] - from[1], -b.rot)
  const pull = (id === 'e' ? mx : -mx) * (centre ? 2 : 1)
  return Math.max(1, b.w + pull)
}

/** The box's middle once it is `w` wide, the side opposite the pulled one
 *  where it was (with `centre`, the middle where it was). */
export function middleAfterWidth(b: TurnedBox, id: 'e' | 'w', w: number, centre: boolean): Pt {
  if (centre) return [b.cx, b.cy]
  const shift = ((w - b.w) / 2) * (id === 'e' ? 1 : -1)
  const [ox, oy] = turn(shift, 0, b.rot)
  return [b.cx + ox, b.cy + oy]
}
