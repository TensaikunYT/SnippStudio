// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's crop edited in the preview (cila A): the crop's box in the clip's
// own frame, and the crop a dragged handle gives. Pure: no store, no canvas.
// The crop itself is the Inspector's field (Clip['crop']: fractions of the
// media cut from each side); the sliders there and the handles here write the
// same four numbers.
import { resizeBox, type Box4, type BoxHandle } from '../../ui/handles'

export interface Crop {
  l: number
  t: number
  r: number
  b: number
}

/** The most one side gives up: the Inspector's sliders end here too. */
export const CROP_MAX = 0.45
export const NO_CROP: Crop = { l: 0, t: 0, r: 0, b: 0 }

/** The eight handles, in box order. */
export const CROP_HANDLES: BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const clamp = (v: number): number => Math.round(Math.min(CROP_MAX, Math.max(0, v)) * 1000) / 1000

/**
 * The crop's box as it is drawn, in the clip's own frame (media pixels, the
 * middle at 0, 0). A flipped clip is drawn mirrored, so what is cut from the
 * media's left shows on the right.
 */
export function cropBox(crop: Crop | undefined, w: number, h: number, flipH = false, flipV = false): Box4 {
  const c = crop ?? NO_CROP
  const left = flipH ? c.r : c.l
  const right = flipH ? c.l : c.r
  const top = flipV ? c.b : c.t
  const bottom = flipV ? c.t : c.b
  return { l: -w / 2 + left * w, r: w / 2 - right * w, t: -h / 2 + top * h, b: h / 2 - bottom * h }
}

/** The crop a drawn box stands for (the other way round), each side within 0 … CROP_MAX. */
export function cropOfBox(box: Box4, w: number, h: number, flipH = false, flipV = false): Crop {
  const left = clamp((box.l + w / 2) / w)
  const right = clamp((w / 2 - box.r) / w)
  const top = clamp((box.t + h / 2) / h)
  const bottom = clamp((h / 2 - box.b) / h)
  return { l: flipH ? right : left, r: flipH ? left : right, t: flipV ? bottom : top, b: flipV ? top : bottom }
}

/** The eight handle points of a box, in CROP_HANDLES order. */
export function boxHandlePoints(b: Box4): [number, number][] {
  const mx = (b.l + b.r) / 2
  const my = (b.t + b.b) / 2
  return [[b.l, b.t], [mx, b.t], [b.r, b.t], [b.r, my], [b.r, b.b], [mx, b.b], [b.l, b.b], [b.l, my]]
}

/**
 * The crop after `handle` is dragged to (px, py) in the clip's own frame.
 * The opposite side stays; `keepRatio` (Shift) keeps the crop box's shape;
 * `centre` (Alt) moves the opposite side the same way. Never outside the
 * media, never more than CROP_MAX from a side.
 */
export function cropFromHandle(start: Crop | undefined, handle: BoxHandle, px: number, py: number, w: number, h: number, o: { flipH?: boolean; flipV?: boolean; keepRatio?: boolean; centre?: boolean } = {}): Crop {
  const box0 = cropBox(start, w, h, o.flipH, o.flipV)
  const min = Math.min(w, h) * (1 - 2 * CROP_MAX)
  const lim = (b: Box4): Box4 => ({
    l: Math.min(-w / 2 + CROP_MAX * w, Math.max(-w / 2, b.l)),
    r: Math.max(w / 2 - CROP_MAX * w, Math.min(w / 2, b.r)),
    t: Math.min(-h / 2 + CROP_MAX * h, Math.max(-h / 2, b.t)),
    b: Math.max(h / 2 - CROP_MAX * h, Math.min(h / 2, b.b))
  })
  let box = lim(resizeBox(box0, handle, px, py, !!o.keepRatio, min, !!o.centre))
  const w0 = box0.r - box0.l
  const h0 = box0.b - box0.t
  if (o.keepRatio && w0 > 0 && h0 > 0) {
    // A limit may have stopped one side: the shape is kept by the smaller of
    // the two, laid from the side that stays (or round the middle).
    const k = Math.min((box.r - box.l) / w0, (box.b - box.t) / h0)
    const bw = w0 * k
    const bh = h0 * k
    const mx = (box0.l + box0.r) / 2
    const my = (box0.t + box0.b) / 2
    const next = { ...box }
    if (o.centre || handle === 'n' || handle === 's') { next.l = mx - bw / 2; next.r = mx + bw / 2 }
    else if (handle.includes('w')) next.l = box0.r - bw
    else next.r = box0.l + bw
    if (o.centre || handle === 'e' || handle === 'w') { next.t = my - bh / 2; next.b = my + bh / 2 }
    else if (handle.startsWith('n')) next.t = box0.b - bh
    else next.b = box0.t + bh
    box = lim(next)
  }
  return cropOfBox(box, w, h, o.flipH, o.flipV)
}

/** The crop's window slid by (dx, dy) inside the media: its size stays. */
export function cropMoved(start: Crop | undefined, dx: number, dy: number, w: number, h: number, flipH = false, flipV = false): Crop {
  const c = start ?? NO_CROP
  // In media terms (a flipped clip's drawn x runs the other way).
  let mx = (flipH ? -dx : dx) / w
  let my = (flipV ? -dy : dy) / h
  mx = Math.min(c.r, CROP_MAX - c.l, Math.max(-c.l, c.r - CROP_MAX, mx))
  my = Math.min(c.b, CROP_MAX - c.t, Math.max(-c.t, c.b - CROP_MAX, my))
  return { l: clamp(c.l + mx), r: clamp(c.r - mx), t: clamp(c.t + my), b: clamp(c.b - my) }
}

export const isCropped = (c: Crop | undefined): boolean => !!c && (c.l > 0 || c.t > 0 || c.r > 0 || c.b > 0)
