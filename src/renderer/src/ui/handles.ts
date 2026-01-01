// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The canvas handles, one set of rules for the editor's preview: where the
// turn knob sits, how a turn follows the pointer and
// snaps, how a box is resized from a handle (Shift keeps its shape), and
// the angle shown while turning. The maths is pure (tested in
// src/test/ui-handles.test.ts); the three small drawing helpers at the end
// give both previews the same look.

export type Pt = [number, number]

const DEG = Math.PI / 180

/** Shift's step for a turn. */
export const TURN_STEP = 15 * DEG
/** Without Shift, upright and square (every 90°) still catch within this. */
export const TURN_CATCH = 4 * DEG
/** The knob's distance from the box's edge, in screen px. */
export const KNOB_GAP = 26

/**
 * A turn (radians, as the thing will stand) snapped: Shift → the nearest 15°;
 * otherwise every right angle catches within 4°, anything else is free.
 */
export function snapAngle(angle: number, steps: boolean): number {
  if (steps) return Math.round(angle / TURN_STEP) * TURN_STEP
  const right = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
  return Math.abs(angle - right) < TURN_CATCH ? right : angle
}

/**
 * The angle a thing stands at while its knob is dragged round its middle:
 * where it started plus how far the pointer has gone round, unwrapped so a
 * drag across the left side never jumps by a whole turn, and exactly the
 * start angle while the pointer is still where it grabbed (no jump on grab).
 */
export function turnFrom(centre: Pt, grab: Pt, pointer: Pt, startAngle: number, acc?: TurnAcc): number {
  const a1 = Math.atan2(pointer[1] - centre[1], pointer[0] - centre[0])
  if (acc) {
    // Step by step (phase Ç2c.2, report K23): each move's own turn, wrapped,
    // added up — so a drag goes past half a turn (190° clockwise is 190°,
    // not −170°, and a key written there turns the right way).
    const last = acc.last ?? Math.atan2(grab[1] - centre[1], grab[0] - centre[0])
    const step = a1 - last
    acc.sum += Math.atan2(Math.sin(step), Math.cos(step))
    acc.last = a1
    return startAngle + acc.sum
  }
  const a0 = Math.atan2(grab[1] - centre[1], grab[0] - centre[0])
  let d = a1 - a0
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return startAngle + d
}

/** How far a turn drag has gone round so far (kept by the drag). */
export interface TurnAcc {
  /** The pointer's angle at the last move (unset: the grab's). */
  last?: number
  /** The turn so far, radians, unwrapped. */
  sum: number
}

/** An angle as it is shown: whole degrees in (−180°, 180°]. */
export function degLabel(rad: number): string {
  let d = Math.round(rad / DEG) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  if (Object.is(d, -0)) d = 0
  return `${d < 0 ? '−' : ''}${Math.abs(d)}°`
}

/**
 * Where the turn knob goes (screen px): on a short stem out of the middle of
 * the box's top edge, along the box's own "up"; when that would leave the
 * preview at its top, out of the bottom edge instead; when both would leave
 * it (a picture filling the frame), just inside the top edge.
 * `half` is the box's half height on screen, `rot` its turn on screen.
 */
export function knobAt(cx: number, cy: number, half: number, rot: number, minY = 8, gap = KNOB_GAP, maxY = Infinity): { base: Pt; knob: Pt; below: boolean; inside?: boolean } {
  const ux = Math.sin(rot)
  const uy = -Math.cos(rot)
  const at = (d: number): Pt => [cx + ux * d, cy + uy * d]
  const up = { base: at(half), knob: at(half + gap) }
  if (up.knob[1] >= minY && up.knob[1] <= maxY) return { ...up, below: false }
  const down = { base: at(-half), knob: at(-half - gap) }
  if (down.knob[1] >= minY && down.knob[1] <= maxY) return { ...down, below: true }
  return { base: at(half), knob: at(Math.max(0, half - gap)), below: false, inside: true }
}

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** A box in its own (unturned) frame. */
export interface Box4 {
  l: number
  t: number
  r: number
  b: number
}

/**
 * A box resized by dragging one of its eight handles to (px, py) (both in
 * the box's own frame). The opposite edge or corner stays put. With
 * `keepRatio` (Shift) the box keeps its shape: a corner grows both sides by
 * the larger pull, an edge grows the other side round the middle. Never
 * smaller than `min`.
 */
export function resizeBox(box: Box4, handle: BoxHandle, px: number, py: number, keepRatio: boolean, min = 4, centre = false): Box4 {
  let { l, t, r, b } = box
  const w0 = box.r - box.l
  const h0 = box.b - box.t
  if (centre) {
    // Round the middle (Alt): the opposite side moves the same way out.
    const mx = (box.l + box.r) / 2
    const my = (box.t + box.b) / 2
    let hw = w0 / 2
    let hh = h0 / 2
    if (handle.includes('e')) hw = Math.max(min / 2, px - mx)
    if (handle.includes('w')) hw = Math.max(min / 2, mx - px)
    if (handle.startsWith('s')) hh = Math.max(min / 2, py - my)
    if (handle.startsWith('n')) hh = Math.max(min / 2, my - py)
    if (keepRatio && w0 > 0 && h0 > 0) {
      const k = handle.length === 2 ? Math.max(hw / (w0 / 2), hh / (h0 / 2)) : handle === 'e' || handle === 'w' ? hw / (w0 / 2) : hh / (h0 / 2)
      hw = Math.max(min / 2, (w0 / 2) * k)
      hh = Math.max(min / 2, (h0 / 2) * k)
    }
    return { l: mx - hw, r: mx + hw, t: my - hh, b: my + hh }
  }
  if (handle.includes('w')) l = Math.min(px, r - min)
  if (handle.includes('e')) r = Math.max(px, l + min)
  if (handle.startsWith('n')) t = Math.min(py, b - min)
  if (handle.startsWith('s')) b = Math.max(py, t + min)
  if (!keepRatio || w0 <= 0 || h0 <= 0) return { l, t, r, b }
  const corner = handle.length === 2
  if (corner) {
    const k = Math.max((r - l) / w0, (b - t) / h0)
    const w = Math.max(min, w0 * k)
    const h = Math.max(min, h0 * k)
    // Grown from the fixed (opposite) corner.
    if (handle.includes('w')) l = r - w
    else r = l + w
    if (handle.startsWith('n')) t = b - h
    else b = t + h
    return { l, t, r, b }
  }
  if (handle === 'e' || handle === 'w') {
    const h = Math.max(min, h0 * ((r - l) / w0))
    const my = (box.t + box.b) / 2
    return { l, r, t: my - h / 2, b: my + h / 2 }
  }
  const w = Math.max(min, w0 * ((b - t) / h0))
  const mx = (box.l + box.r) / 2
  return { t, b, l: mx - w / 2, r: mx + w / 2 }
}

// -- what a press takes, and the pointer over it --------------------------------

/** A handle's side as it is drawn, and how far from its middle a press still
 *  takes it (screen px; cila A: 10 and 12 before). */
export const HANDLE_SIZE = 12
export const HANDLE_HIT = 16
/** A drag starts once the pointer has gone this far from the press (screen px):
 *  a click with a shaking hand moves nothing and snaps to nothing. */
export const DRAG_THRESHOLD = 4

/**
 * How far a handle reaches on a box whose shorter side is `minSide` px on
 * screen: 16 px, less on a small box so its middle third stays free for
 * picking the box up, never under 8.
 */
export function handleReach(minSide: number): number {
  return Math.max(8, Math.min(HANDLE_HIT, minSide / 3))
}

/**
 * The handle a press at (x, y) takes: the nearest one within `reach` (a
 * square round each), or -1. Nearest, not first: on a small box the reaches
 * overlap, and the first in the list used to win whichever was pressed.
 */
export function nearestHandle(points: readonly (readonly [number, number])[], x: number, y: number, reach = HANDLE_HIT): number {
  let best = -1
  let bd = Infinity
  for (let i = 0; i < points.length; i++) {
    const dx = Math.abs(x - points[i][0])
    const dy = Math.abs(y - points[i][1])
    if (dx > reach || dy > reach) continue
    const d = dx * dx + dy * dy
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return best
}

/** The point of the segment a–b nearest to p, and how far it is. */
export function nearestOnSegment(a: readonly [number, number], b: readonly [number, number], p: readonly [number, number]): { x: number; y: number; d: number } {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const len2 = vx * vx + vy * vy
  const k = len2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0
  const x = a[0] + vx * k
  const y = a[1] + vy * k
  return { x, y, d: Math.hypot(p[0] - x, p[1] - y) }
}

/** Has the pointer left the press by the drag threshold? */
export function pastThreshold(x0: number, y0: number, x: number, y: number, px = DRAG_THRESHOLD): boolean {
  return Math.hypot(x - x0, y - y0) >= px
}

export type ResizeCursor = 'ew-resize' | 'nwse-resize' | 'ns-resize' | 'nesw-resize'
const RESIZE: ResizeCursor[] = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']

/**
 * The resize cursor for a handle that pulls along `angle` (screen radians:
 * 0 = right, a quarter turn = down), so the arrows lie along the pull on a
 * turned box too.
 */
export function resizeCursor(angle: number): ResizeCursor {
  const i = Math.round(angle / (Math.PI / 4))
  return RESIZE[((i % 4) + 4) % 4]
}

const turnCursors = new Map<number, string>()

/**
 * The cursor over a turn knob: a bent arrow, turned with the box (`rot`: the
 * way out of the box to the knob, 0 = up) in 15° steps. Drawn here (an SVG in
 * a data: address): there is no stock cursor for a turn.
 */
export function turnCursor(rot: number): string {
  const deg = (((Math.round(rot / TURN_STEP) * 15) % 360) + 360) % 360
  let c = turnCursors.get(deg)
  if (!c) {
    const d = 'M5.5 15a7.5 7.5 0 0 1 13 0M5.5 15l-.2-4.6M5.5 15l4.3-1.2M18.5 15l.2-4.6M18.5 15l-4.3-1.2'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(${deg} 12 12)" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${d}" stroke="#fff" stroke-width="4"/><path d="${d}" stroke="#14181a" stroke-width="1.8"/></g></svg>`
    c = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`
    turnCursors.set(deg, c)
  }
  return c
}

// -- the look, shared by both previews ----------------------------------------

/** The editor's and the Studio's handle colour: the selection's gold
 *  (--select of ui/tokens.css, palette v3.1; texts keep their yellow). */
export const HANDLE_ACCENT = '#E8CC5C'

/** A corner or edge handle: a white square with a coloured rim. `hot` (the
 *  pointer is on it): its colours the other way round and a little larger. */
export function drawGrip(ctx: CanvasRenderingContext2D, x: number, y: number, color = HANDLE_ACCENT, size = HANDLE_SIZE, hot = false): void {
  ctx.save()
  const s = hot ? size + 2 : size
  ctx.fillStyle = hot ? color : '#ffffff'
  ctx.strokeStyle = hot ? '#ffffff' : color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x - s / 2, y - s / 2, s, s, 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** A point handle (a pen mask's point, the soft-edge handle): a disc. */
export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color = HANDLE_ACCENT, size = HANDLE_SIZE, hot = false): void {
  ctx.save()
  ctx.fillStyle = hot ? color : '#ffffff'
  ctx.strokeStyle = hot ? '#ffffff' : color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(x, y, (hot ? size + 2 : size) / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** The turn knob on its stem: a white disc with a curved arrow. */
export function drawKnob(ctx: CanvasRenderingContext2D, base: Pt, knob: Pt, color = HANDLE_ACCENT, hot = false): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(base[0], base[1])
  ctx.lineTo(knob[0], knob[1])
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(knob[0], knob[1], hot ? 8.5 : 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(knob[0], knob[1], 3.2, -Math.PI * 0.9, Math.PI * 0.4)
  ctx.stroke()
  ctx.restore()
}

/** The angle while turning, in a small dark tag beside the knob. */
export function drawAngleTag(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, color = HANDLE_ACCENT): void {
  drawTag(ctx, x, y, degLabel(rad), color)
}

/** A value while it is being dragged (an angle, a size, a soft edge), in a
 *  small dark tag beside the handle. */
export function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color = HANDLE_ACCENT): void {
  ctx.save()
  ctx.font = '600 11px system-ui, sans-serif'
  const w = ctx.measureText(text).width + 12
  const left = x + 12
  const top = y - 10
  ctx.fillStyle = 'rgba(10, 14, 16, 0.88)'
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(left, top, w, 20, 5)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, left + 6, top + 10.5)
  ctx.restore()
}
