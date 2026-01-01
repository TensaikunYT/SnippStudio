// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the preview draws over the picture for a title or a shape (SnippStudio
// YAZI2-PLAN.md, 2.3–2.5): its outline, its handles and knob, the lines a
// drag rests on, and the caret and selection of a title being typed in. One
// look with the picture's own handles (ui/handles.ts).
import { HANDLE_ACCENT, drawGrip, drawKnob, type Pt } from '../../../ui/handles'
import { boxCorners, boxHandles, boxKnob, type HandleId, type TurnedBox } from './handles'
import type { GuideLine } from './guides'
import type { Rect } from './layout'

/** The lines a drag rests on, in two tones so they read on any picture: the
 *  accent (--accent of ui/tokens.css) between two dark edges. On a white
 *  frame the dark edges carry the line, on a dark one the accent does. */
const GUIDE = '#B6F067'
const GUIDE_EDGE = 'rgba(8, 10, 12, 0.9)'
const HALO = 'rgba(8, 10, 12, 0.55)'
/** A typed selection: --select-soft. */
const SELECTION = 'rgba(61, 107, 224, 0.5)'

function trace(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.closePath()
}

/** A thing the pointer is on, not selected: a thin outline (it can be picked up). */
export function drawHoverOutline(ctx: CanvasRenderingContext2D, outline: TurnedBox): void {
  ctx.save()
  trace(ctx, boxCorners(outline))
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.strokeStyle = HANDLE_ACCENT
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/** A side's handle: a small bar lying along its side. */
function drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, upright: boolean, hot: boolean): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  const long = hot ? 18 : 16
  const short = hot ? 8 : 6
  const w = upright ? short : long
  const h = upright ? long : short
  ctx.fillStyle = hot ? HANDLE_ACCENT : '#ffffff'
  ctx.strokeStyle = hot ? '#ffffff' : HANDLE_ACCENT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, 3)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/**
 * A selected thing: a solid outline; with `handles`, a square on each corner,
 * a bar on each side long enough for one, and the knob on its stem. `hot` is
 * the handle the pointer is on ('knob' for the knob).
 */
export function drawSelection(ctx: CanvasRenderingContext2D, outline: TurnedBox, o: { handles: boolean; hot?: HandleId | 'knob' | null; canvasH: number }): void {
  ctx.save()
  trace(ctx, boxCorners(outline))
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3.5
  ctx.stroke()
  ctx.strokeStyle = HANDLE_ACCENT
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  if (!o.handles) return
  const { base, knob } = boxKnob(outline, o.canvasH)
  drawKnob(ctx, base, knob, HANDLE_ACCENT, o.hot === 'knob')
  for (const h of boxHandles(outline)) {
    if (h.id.length === 2) drawGrip(ctx, h.x, h.y, HANDLE_ACCENT, undefined, o.hot === h.id)
    else drawBar(ctx, h.x, h.y, outline.rot, h.id === 'e' || h.id === 'w', o.hot === h.id)
  }
}

/** The lines the dragged thing rests on. `toScreen` maps a frame point. */
export function drawGuides(ctx: CanvasRenderingContext2D, guides: readonly GuideLine[], toScreen: (x: number, y: number) => Pt): void {
  if (!guides.length) return
  ctx.save()
  for (const g of guides) {
    const a = g.axis === 'v' ? toScreen(g.pos, g.from) : toScreen(g.from, g.pos)
    const b = g.axis === 'v' ? toScreen(g.pos, g.to) : toScreen(g.to, g.pos)
    // On the pixel grid (two pixels of accent, one dark on each side): sharp.
    const ax = g.axis === 'v' ? Math.round(a[0]) : a[0]
    const ay = g.axis === 'h' ? Math.round(a[1]) : a[1]
    const bx = g.axis === 'v' ? ax : b[0]
    const by = g.axis === 'h' ? ay : b[1]
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.strokeStyle = GUIDE_EDGE
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.strokeStyle = GUIDE
    ctx.lineWidth = 2
    ctx.stroke()
    if (g.kind === 'centre') {
      // The frame's middle: a small diamond where the line crosses it.
      const mx = (ax + bx) / 2
      const my = (ay + by) / 2
      ctx.beginPath()
      ctx.moveTo(mx, my - 6)
      ctx.lineTo(mx + 6, my)
      ctx.lineTo(mx, my + 6)
      ctx.lineTo(mx - 6, my)
      ctx.closePath()
      ctx.fillStyle = GUIDE
      ctx.strokeStyle = GUIDE_EDGE
      ctx.lineWidth = 1
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * The caret and the selection of a title being typed in. The context is put
 * in the block's own frame (its middle at the origin, frame pixels, turned
 * and sized as the title is) by `enter`; `px` is one screen pixel there.
 */
export function drawTyping(ctx: CanvasRenderingContext2D, enter: () => void, px: number, o: { rects: readonly Rect[]; caret: { x: number; y: number } | null; height: number }): void {
  ctx.save()
  enter()
  ctx.fillStyle = SELECTION
  for (const r of o.rects) ctx.fillRect(r.x, r.y, r.w, r.h)
  if (o.caret) {
    const h = o.height
    ctx.fillStyle = 'rgba(8, 10, 12, 0.7)'
    ctx.fillRect(o.caret.x - 2 * px, o.caret.y - h / 2 - px, 4 * px, h + 2 * px)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(o.caret.x - px, o.caret.y - h / 2, 2 * px, h)
  }
  ctx.restore()
}
