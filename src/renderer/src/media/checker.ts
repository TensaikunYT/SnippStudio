// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Transparency in the media pictures (phase 5b, decision 2): a checker drawn
// under a picture where it lets things through (the timeline's filmstrip and
// the bin's thumbnail are JPEGs: they keep no alpha of their own), and the
// test whether a picture lets anything through at all.

type G = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The checker's squares (px) and its two greys: the usual mark of "nothing
 *  here" in picture tools, quiet enough under a picture. */
export const CHECKER_CELL = 8
const LIGHT = '#3a3a40'
const DARK = '#26262b'

/** A checker over x, y, w × h (the squares counted from x, y). */
export function drawChecker(g: G, x: number, y: number, w: number, h: number): void {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = DARK
  g.fillRect(x, y, w, h)
  g.fillStyle = LIGHT
  for (let r = 0; r * CHECKER_CELL < h; r++)
    for (let c = r % 2; c * CHECKER_CELL < w; c += 2) g.fillRect(x + c * CHECKER_CELL, y + r * CHECKER_CELL, CHECKER_CELL, CHECKER_CELL)
  g.restore()
}

/** True when any pixel of the RGBA data is not fully opaque. */
export function anyAlpha(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true
  return false
}

let reads = 0
/** How many pictures seeThrough has read back (a cost measure: e2e 73). */
export const seeThroughReads = (): number => reads

/** Does this picture let anything through? Read at most 160 px wide. */
export function seeThrough(src: CanvasImageSource): boolean {
  reads++
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : +((src as HTMLCanvasElement).width ?? 0)
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : +((src as HTMLCanvasElement).height ?? 0)
  if (!(sw > 0 && sh > 0)) return false
  const w = Math.max(1, Math.min(160, sw))
  const h = Math.max(1, Math.round((sh * w) / sw))
  try {
    const o = new OffscreenCanvas(w, h)
    const g = o.getContext('2d', { willReadFrequently: true })
    if (!g) return false
    // (Not smoothed: a soft edge is not made more or less transparent by it.)
    g.imageSmoothingEnabled = false
    g.drawImage(src, 0, 0, w, h)
    return anyAlpha(g.getImageData(0, 0, w, h).data)
  } catch {
    return false
  }
}
