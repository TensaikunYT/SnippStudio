// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's mask as a path (shapes, pen points, feather). Moved out of
// playback/render.ts in SnippStudio phase 2B (no change).
import type { Clip, MaskGeom } from '../../types'
import type { Ctx2D } from './core'

/** Builds the mask outline path (asset-local, origin at media center). */
export function traceMaskPath(
  ctx: Ctx2D,
  shape: NonNullable<Clip['mask']>['shape'],
  g: MaskGeom,
  smooth = 0
): void {
  // The turn is applied while the path is BUILT, so it is baked into the
  // points themselves and every caller — fill, clip, stroke — gets a rotated
  // mask without knowing anything about it. The shape tracer below has early
  // returns, hence the wrapper rather than a save/restore around a body.
  const rot = g.rot ?? 0
  if (!rot) {
    traceMaskShape(ctx, shape, g, smooth)
    return
  }
  ctx.save()
  ctx.translate(g.cx, g.cy)
  ctx.rotate(rot)
  ctx.translate(-g.cx, -g.cy)
  traceMaskShape(ctx, shape, g, smooth)
  ctx.restore()
}

export function traceMaskShape(
  ctx: Ctx2D,
  shape: NonNullable<Clip['mask']>['shape'],
  g: MaskGeom,
  smooth = 0
): void {
  ctx.beginPath()
  if (shape === 'path' && g.points && g.points.length >= 3) {
    // A hand-drawn shape is traced EXACTLY as drawn by default. `smooth`
    // rounds the corners by cutting each one: 0 = sharp polygon, 1 = every
    // corner fully rounded (each cut reaches the edge midpoints, which is the
    // old always-curved behaviour).
    const pts = g.points
    const n = pts.length
    const P = (i: number) => pts[((i % n) + n) % n]
    const s = Math.max(0, Math.min(1, smooth))
    if (s < 0.01) {
      ctx.moveTo(pts[0].x, pts[0].y)
      for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y)
      ctx.closePath()
      return
    }
    const t = s * 0.5
    const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, f: number) => ({
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f
    })
    const start = lerp(P(0), P(1), t)
    ctx.moveTo(start.x, start.y)
    for (let i = 1; i <= n; i++) {
      const prev = P(i - 1)
      const p = P(i)
      const next = P(i + 1)
      const enter = lerp(prev, p, 1 - t)
      const exit = lerp(p, next, t)
      ctx.lineTo(enter.x, enter.y)
      ctx.quadraticCurveTo(p.x, p.y, exit.x, exit.y)
    }
    ctx.closePath()
    return
  }
  const x = g.cx - g.w / 2
  const y = g.cy - g.h / 2
  if (shape === 'rect') ctx.rect(x, y, g.w, g.h)
  else if (shape === 'round') ctx.roundRect(x, y, g.w, g.h, Math.min(g.w, g.h) * 0.2)
  else ctx.ellipse(g.cx, g.cy, Math.max(1, g.w / 2), Math.max(1, g.h / 2), 0, 0, Math.PI * 2)
}
