// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The quality a frame is being drawn at (phase Ç3a, decision 1; report R5,
// R12, R20, R21). Set by renderFrame for the length of one synchronous call:
// the drawing below it (scratch surfaces, a clip's look, the CPU pixel pass)
// reads it instead of having it threaded through every signature.
//
// `final` (the export, a still): resampling uses the canvas's best filter
// ('high'; the default 'low' aliased fine detail on 4K footage, big photos and
// slow zooms), a clip's look and the CPU effect pass work at the output's
// width. Otherwise (the preview) everything is as it always was.
import type { Ctx2D } from './core'

export const drawQuality = {
  final: false,
  /** The width in device pixels of the canvas the frame is drawn on. */
  outW: 0
}

/** Sets a context's resampling filter for the frame being drawn. */
export function smoothing(g: Ctx2D | OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined): void {
  if (g) g.imageSmoothingQuality = drawQuality.final ? 'high' : 'low'
}

/** Runs `fn` with this quality, then puts the last one back. */
export function withDrawQuality<T>(final: boolean, outW: number, fn: () => T): T {
  const before = { ...drawQuality }
  drawQuality.final = final
  drawQuality.outW = outW
  try {
    return fn()
  } finally {
    drawQuality.final = before.final
    drawQuality.outW = before.outW
  }
}

/** The widest a clip's look (or the CPU effect pass) works at: the output's
 *  width in final quality (never under the old 2560), else 2560. */
export function lookCap(): number {
  return drawQuality.final ? Math.max(2560, drawQuality.outW) : 2560
}

/**
 * The pixel size of a clip's intermediate surface (mask, censor, GPU effect):
 * the size it will be drawn at on the device (`w × devPerUnit`), never more
 * than it was before (`w × q`, the asset's pixels at the render scale) and
 * never wider than the output (report R21: a 4K clip in a 4K export of a
 * 1080p project asked for 7680-wide buffers to show 3840 pixels). Final
 * quality only: the preview keeps its sizes (`w × q`).
 */
export function surfaceWidth(w: number, q: number, devPerUnit: number): number {
  if (!drawQuality.final) return Math.max(2, Math.round(w * q))
  const out = drawQuality.outW > 0 ? drawQuality.outW : Infinity
  return Math.max(2, Math.round(Math.min(w * q, w * devPerUnit, Math.max(2, out))))
}
