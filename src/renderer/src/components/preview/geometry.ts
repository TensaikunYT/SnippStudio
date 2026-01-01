// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The preview's geometry: frame ↔ screen, a clip's box and hit test, handles
// and grips for masks, shapes, texts and templates, a manual text's box.
// Moved out of PreviewCanvas.tsx in SnippStudio phase 2B (no change).
import { captionMotionAt, shortsWindowAt, trackerPosAt } from '../../playback/render'
import { captionFont } from '../../playback/draw/captions'
import { knobAt } from '../../ui/handles'
import type { Caption, Clip, Project, TemplateBlock } from '../../types'
import { assetById } from '../../types'
import { placeMap, templateBounds } from '../../templates/model'

/** Clip-local point → world (applies the clip transform). */
export function localToWorld(t: XfLike, lx: number, ly: number): [number, number] {
  const rx = lx * t.scale
  const ry = ly * t.scale
  return [
    t.x + rx * Math.cos(t.rotation) - ry * Math.sin(t.rotation),
    t.y + rx * Math.sin(t.rotation) + ry * Math.cos(t.rotation)
  ]
}

/** World point → clip-local (inverts the clip transform). */
export function worldToLocal(t: XfLike, wx: number, wy: number): [number, number] {
  const dx = wx - t.x
  const dy = wy - t.y
  const rx = dx * Math.cos(-t.rotation) - dy * Math.sin(-t.rotation)
  const ry = dx * Math.sin(-t.rotation) + dy * Math.cos(-t.rotation)
  return [rx / Math.max(1e-6, t.scale), ry / Math.max(1e-6, t.scale)]
}

/**
 * A mask corner in screen space. Mask geometry is clip-local and can be turned
 * about its own centre, so a corner is: rotate the offset by the mask's angle,
 * add the centre, then push it through the clip transform and the view.
 */
export function maskCornerScreen(
  t: XfLike,
  g: { cx: number; cy: number; w: number; h: number; rot?: number },
  xf: ViewXform,
  sx: number,
  sy: number
): [number, number] {
  const rot = g.rot ?? 0
  const ox = (sx * g.w) / 2
  const oy = (sy * g.h) / 2
  const lx = g.cx + ox * Math.cos(rot) - oy * Math.sin(rot)
  const ly = g.cy + ox * Math.sin(rot) + oy * Math.cos(rot)
  const [wx, wy] = localToWorld(t, lx, ly)
  return worldToScreen(xf, wx, wy)
}

/** The four corner handles, in screen space. */
export function maskHandlePoints(
  t: XfLike,
  g: { cx: number; cy: number; w: number; h: number; rot?: number },
  xf: ViewXform
): [number, number][] {
  return ([
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1]
  ] as const).map(([sx, sy]) => maskCornerScreen(t, g, xf, sx, sy))
}

/** The rotate grip: above the mask's top edge, in the mask's own direction. */
export function maskRotateGrip(
  t: XfLike,
  g: { cx: number; cy: number; w: number; h: number; rot?: number },
  xf: ViewXform
): [number, number] {
  const [tx, ty] = maskCornerScreen(t, g, xf, 0, -1)
  const [bx, by] = maskCornerScreen(t, g, xf, 0, 1)
  // 30 screen px beyond the top edge, along the mask's own up-axis — so the
  // grip follows the mask however the clip beneath it is turned or scaled.
  const len = Math.hypot(tx - bx, ty - by) || 1
  return [tx + ((tx - bx) / len) * 30, ty + ((ty - by) / len) * 30]
}

/** How far outside the mask's edge the soft-edge handle sits with no soft
 *  edge at all (screen px); the soft edge's own width is added to it. */
export const FEATHER_GAP = 16

/**
 * The soft-edge handle of a mask: out of the middle of its right side, along
 * its own sideways axis, as far out as the soft edge is wide. `u` is that
 * axis on screen (a unit vector), `perPx` how much soft edge one screen px is.
 */
export function maskFeatherGrip(
  t: XfLike,
  g: { cx: number; cy: number; w: number; h: number; rot?: number; points?: { x: number; y: number }[] },
  feather: number,
  xf: ViewXform,
  path = false
): { base: [number, number]; grip: [number, number]; u: [number, number]; perPx: number } {
  let base: [number, number]
  let from: [number, number]
  if (path && g.points && g.points.length > 0) {
    // A pen mask has no box of its own: the right side of its points.
    const xs = g.points.map((p) => p.x)
    const ys = g.points.map((p) => p.y)
    const my = (Math.min(...ys) + Math.max(...ys)) / 2
    const [bx, by] = localToWorld(t, Math.max(...xs), my)
    const [fx, fy] = localToWorld(t, Math.min(...xs), my)
    base = worldToScreen(xf, bx, by)
    from = worldToScreen(xf, fx, fy)
  } else {
    base = maskCornerScreen(t, g, xf, 1, 0)
    from = maskCornerScreen(t, g, xf, -1, 0)
  }
  const len = Math.hypot(base[0] - from[0], base[1] - from[1]) || 1
  const u: [number, number] = [(base[0] - from[0]) / len, (base[1] - from[1]) / len]
  const px = Math.max(1e-6, t.scale * xf.k)
  const d = FEATHER_GAP + Math.max(0, feather) * px
  return { base, grip: [base[0] + u[0] * d, base[1] + u[1] * d], u, perPx: 1 / px }
}

/** How far below the selection box the rotate grip sits, in SCREEN pixels, so
 *  it stays the same distance away at every preview zoom. */
export const ROTATE_GRIP_PX = 26

/**
 * Screen positions of the rotate grip and the stem that connects it to the
 * bottom edge of a selection box, for a box centred at (cx, cy) in world units,
 * half-height `h`, turned by `rot` radians.
 */
export function rotateGrip(
  xf: ViewXform,
  cx: number,
  cy: number,
  h: number,
  rot: number
): { base: [number, number]; grip: [number, number] } {
  // One rule for every knob (ui/handles.ts knobAt): out of the top
  // edge's middle along the box's own up, under the box only when that would
  // leave the preview. The view is zoom + pan only, so the screen box is the
  // world box times k.
  const [scx, scy] = worldToScreen(xf, cx, cy)
  const { base, knob } = knobAt(scx, scy, h * xf.k, rot, 8, ROTATE_GRIP_PX, xf.ch - 8)
  return { base, grip: knob }
}

/** The angle a caption is actually drawn at: its static rotation plus whatever
 *  its motion adds. Reading only the static one left the selection box upright
 *  while the caption itself turned. */
export function captionAngle(project: Project, cap: Caption, time: number): number {
  const style = cap.style ?? project.captionStyle
  return (style.rotate ?? 0) + captionMotionAt(cap, time - cap.start).rot
}

/** The eight handles of a box, in box order: nw n ne e se s sw w (the crop's
 *  handles; a title's and a shape's are text-edit/handles.ts). */
export const SHAPE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ShapeHandle = (typeof SHAPE_HANDLES)[number]

/**
 * Is (wx, wy) inside a caption's box, allowing for its rotation?
 *
 * The box is axis-aligned in world space; a rotated caption is drawn turned
 * around its own anchor. Testing the un-turned box meant a rotated shape was
 * grabbable in a rectangle that wasn't where it appeared to be — badly wrong
 * for anything past about 20°.
 */
export function insideCaptionBox(
  box: { l: number; t: number; r: number; b: number },
  rot: number,
  wx: number,
  wy: number,
  pad: number
): boolean {
  const cx = (box.l + box.r) / 2
  const cy = (box.t + box.b) / 2
  const cos = Math.cos(-rot)
  const sin = Math.sin(-rot)
  const dx = wx - cx
  const dy = wy - cy
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return (
    lx >= box.l - cx - pad && lx <= box.r - cx + pad && ly >= box.t - cy - pad && ly <= box.b - cy + pad
  )
}

// Text metrics context for hit-testing manual captions in the preview.
export const measureCtx = document.createElement('canvas').getContext('2d')!

export function captionTrackerOffset(project: Project, cap: Caption, time: number): { x: number; y: number } {
  const tracker = cap.trackerId ? project.trackers?.find((item) => item.id === cap.trackerId) : undefined
  const keyframes = tracker ? [...tracker.keyframes].sort((a, b) => a.time - b.time) : []
  const origin = keyframes[0]
  if (!tracker || !origin) return { x: 0, y: 0 }
  const tracked = trackerPosAt(keyframes, time)
  return { x: tracked.x - origin.x, y: tracked.y - origin.y }
}

/** World-space bounding box of a manual caption at the current settings. */
export function manualCaptionBox(
  project: Project,
  cap: Caption,
  /** Timeline time, so the box follows the caption's animated motion. */
  time = 0
): { l: number; t: number; r: number; b: number; fontSize: number } {
  const style = cap.style ?? project.captionStyle
  const { width: W, height: H } = project.settings
  // The renderer draws every caption through its motion — offset, scale and
  // extra rotation. The box has to go through the same thing or the outline
  // and its handles sit where the caption ISN'T as soon as it is animated.
  const m = captionMotionAt(cap, time - cap.start)
  const { x: trackX, y: trackY } = captionTrackerOffset(project, cap, time)
  // A shape's box is its own geometry — there is no text to measure.
  if (cap.shape) {
    const cx = (style.posX ?? 0.5) * W + m.x + trackX
    const cy = style.posY * H + m.y + trackY
    const sw = Math.max(2, cap.shape.w * W) * m.scale
    const sh = Math.max(2, cap.shape.h * H) * m.scale
    return { l: cx - sw / 2, t: cy - sh / 2, r: cx + sw / 2, b: cy + sh / 2, fontSize: sh }
  }
  const fontSize = style.fontSize * (H / 1080)
  measureCtx.font = captionFont(style, fontSize)
  measureCtx.letterSpacing = `${(style.letterSpacing ?? 0) * (H / 1080)}px`
  const text = style.uppercase ? cap.text.toUpperCase() : cap.text
  const lines: string[] = []
  for (const para of text.split(/\r?\n/)) {
    const wordsArr = para.trim().split(/\s+/).filter(Boolean)
    if (wordsArr.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const w of wordsArr) {
      if (line && line.length + 1 + w.length > style.maxLineChars) {
        lines.push(line)
        line = w
      } else line = line ? `${line} ${w}` : w
    }
    if (line) lines.push(line)
  }
  // Fit-to-width shrinks the drawn text, so the box has to shrink with it or
  // the handles would sit where the text used to be.
  const fitFrac = style.fitWidth ?? 0
  let drawSize = fontSize
  if (fitFrac > 0) {
    const widest = Math.max(1, ...lines.map((l) => measureCtx.measureText(l).width))
    const maxW = fitFrac * W
    if (widest > maxW) {
      drawSize = Math.max(8, fontSize * (maxW / widest))
      measureCtx.font = captionFont(style, drawSize)
    }
  }
  const lineHeight = drawSize * (style.lineHeight ?? 1.25)
  const wpx = Math.max(20, ...lines.map((l) => measureCtx.measureText(l).width))
  const h = Math.max(lineHeight, lines.length * lineHeight)
  const cx = (style.posX ?? 0.5) * W + m.x + trackX
  const cy = style.posY * H + m.y + trackY
  const bw = wpx * m.scale
  const bh = h * m.scale
  return { l: cx - bw / 2, t: cy - bh / 2, r: cx + bw / 2, b: cy + bh / 2, fontSize: drawSize * m.scale }
}

/** World→screen mapping shared by both view modes. */
export interface ViewXform {
  cx: number
  cy: number
  k: number
  cw: number
  ch: number
}

export function worldToScreen(v: ViewXform, x: number, y: number): [number, number] {
  return [(x - v.cx) * v.k + v.cw / 2, (y - v.cy) * v.k + v.ch / 2]
}

export function screenToWorld(v: ViewXform, x: number, y: number): [number, number] {
  return [(x - v.cw / 2) / v.k + v.cx, (y - v.ch / 2) / v.k + v.cy]
}

export interface XfLike {
  x: number
  y: number
  scale: number
  rotation: number
}

/** Axis-aligned bbox of a clip in world coordinates, at a given transform. */
export function clipBBox(project: Project, clip: Clip, t: XfLike): { l: number; r: number; t: number; b: number } | null {
  const asset = assetById(project, clip.assetId)
  if (!asset || asset.kind === 'audio') return null
  const w = (asset.width || 2) * t.scale
  const h = (asset.height || 2) * t.scale
  const cos = Math.abs(Math.cos(t.rotation))
  const sin = Math.abs(Math.sin(t.rotation))
  const bw = w * cos + h * sin
  const bh = w * sin + h * cos
  return { l: t.x - bw / 2, r: t.x + bw / 2, t: t.y - bh / 2, b: t.y + bh / 2 }
}

export function hitTestClip(project: Project, clip: Clip, wx: number, wy: number, t: XfLike): boolean {
  const asset = assetById(project, clip.assetId)
  if (!asset || asset.kind === 'audio') return false
  const dx = wx - t.x
  const dy = wy - t.y
  const cos = Math.cos(-t.rotation)
  const sin = Math.sin(-t.rotation)
  const lx = (dx * cos - dy * sin) / t.scale
  const ly = (dx * sin + dy * cos) / t.scale
  return Math.abs(lx) <= (asset.width || 2) / 2 && Math.abs(ly) <= (asset.height || 2) / 2
}

/** A placed template's box on the frame (what it covers, where it is now),
 *  with the middle it scales round and its laid-out centre. */
export function placedTemplateBox(
  project: Project,
  b: TemplateBlock,
  time: number
): { x0: number; y0: number; x1: number; y1: number; C: [number, number]; raw: [number, number]; w: number; h: number } {
  const { width: W, height: H } = project.settings
  const sw = project.mode === 'shorts' ? shortsWindowAt(project, time) : null
  const left = sw ? sw.cx - sw.w / 2 : 0
  const w = sw ? sw.w : W
  const r = templateBounds(b, left, w, H)
  const map = placeMap(b, left, w, H) ?? ((x: number, y: number): [number, number] => [x, y])
  const [x0, y0] = map(r.x, r.y)
  const [x1, y1] = map(r.x + r.w, r.y + r.h)
  return { x0, y0, x1, y1, C: [left + w / 2, H / 2], raw: [r.x + r.w / 2, r.y + r.h / 2], w, h: H }
}

export function activeCaptionStyle(project: Project): Project['captionStyle'] {
  return project.mode === 'shorts' && project.captionStyleShorts ? project.captionStyleShorts : project.captionStyle
}
