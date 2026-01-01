// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The preview's zoom, as numbers (ONIZLEME-UYGULA-PLAN.md, K4): its limits,
// a zoom around a point (the wheel, under the pointer) and the zoom at which
// one pixel of the project is one pixel of the screen (the 1 key). Pure.

export const ZOOM_MIN = 0.2
/** 16: a 4K project in a small preview needs more than 6 for 100 %. */
export const ZOOM_MAX = 16

export interface PreviewView {
  zoom: number
  x: number
  y: number
}

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1))

/** The view zoomed to `zoom` keeping the point (sx, sy) of a cw × ch preview
 *  where it is (the preview's own fit: centre plus the pan). */
export function zoomAround(pv: PreviewView, zoom: number, sx: number, sy: number, cw: number, ch: number): PreviewView {
  const z = clampZoom(zoom)
  const ratio = z / (pv.zoom || 1)
  const cx = cw / 2
  const cy = ch / 2
  return { zoom: z, x: sx - cx - (sx - cx - pv.x) * ratio, y: sy - cy - (sy - cy - pv.y) * ratio }
}

/** How large the project is shown: 1 when one of its pixels is one device
 *  pixel, 0.5 at half that (22 November: the toolbar's number; it used to
 *  show the zoom itself, where 100 % meant "fits the preview", next to a
 *  "100 %" button that meant one pixel per pixel). The inverse of
 *  oneToOneZoom. A preview with no size yet: the zoom as it is. */
export function pixelScale(zoom: number, cw: number, ch: number, W: number, H: number, dpr: number): number {
  const fit = Math.min(cw / Math.max(1, W), ch / Math.max(1, H))
  if (!(fit > 0) || !(cw > 0) || !(ch > 0)) return zoom
  return zoom * fit * (dpr > 0 ? dpr : 1)
}

/** The zoom at which a W × H project shows one of its pixels on one device
 *  pixel in a cw × ch preview (CSS pixels) at `dpr`. */
export function oneToOneZoom(cw: number, ch: number, W: number, H: number, dpr: number): number {
  const fit = Math.min(cw / Math.max(1, W), ch / Math.max(1, H))
  if (!(fit > 0)) return 1
  return clampZoom(1 / (fit * (dpr > 0 ? dpr : 1)))
}
