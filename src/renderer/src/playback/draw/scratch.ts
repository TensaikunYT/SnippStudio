// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The renderer's scratch canvases (masks, effects, nested clips, looks) and
// their pruning; a source's pixel size; a blurred copy. Moved out of
// playback/render.ts in SnippStudio phase 2B (no change).
import { smoothing } from './quality'


// Scratch canvases for feathered masking, one per clip.
export const maskScratch = new Map<string, HTMLCanvasElement>()
/** When each scratch buffer was last drawn into. A transition needs five
 *  full-frame surfaces; a clip that HAS one is not a clip that is playing one,
 *  and holding forty megabytes for a cut that happens once at 03:12 is not a
 *  cache, it is a leak with a clip id on it. */
export const scratchTouched = new Map<string, number>()

export function scratchFor(clipId: string, w: number, h: number): HTMLCanvasElement {
  scratchTouched.set(clipId, performance.now())
  let cv = maskScratch.get(clipId)
  if (!cv) {
    cv = document.createElement('canvas')
    maskScratch.set(clipId, cv)
  }
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  // The resampling filter of the frame being drawn (phase Ç3a: 'high' in
  // the export; the preview's 'low', as it always was).
  smoothing(cv.getContext('2d'))
  return cv
}

/** Pixel width of whatever we are drawing — a <video> reports its size as
 *  videoWidth, and its `width` attribute is usually 0. */
export function sourcePixelW(src: CanvasImageSource, fallback: number): number {
  if (src instanceof HTMLVideoElement) return src.videoWidth || fallback
  if (src instanceof HTMLImageElement) return src.naturalWidth || fallback
  return (src as HTMLCanvasElement).width || fallback
}
export function sourcePixelH(src: CanvasImageSource, fallback: number): number {
  if (src instanceof HTMLVideoElement) return src.videoHeight || fallback
  if (src instanceof HTMLImageElement) return src.naturalHeight || fallback
  return (src as HTMLCanvasElement).height || fallback
}

/**
 * A blurred copy of an image whose EDGES hold up.
 *
 * `ctx.filter = 'blur(n)'` samples everything outside the source rectangle as
 * transparent, so the outer n pixels of a blurred draw fade away and whatever
 * was underneath shows through. On a mask censor that is the whole frame
 * border: the picture blurs everywhere except a sharp ring around the outside,
 * which is exactly the corner that never blurred.
 *
 * So the source is copied into a padded canvas with its edge row and column
 * stretched outward first — the blur then has real pixels to reach for — and
 * the padding is dropped on the way back out.
 */
export function blurredCopy(
  key: string,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  radius: number
): HTMLCanvasElement {
  // Rounded up to a multiple of 32. A canvas whose size changes is a canvas
  // that gets REALLOCATED, and an animated blur — a blur dissolve, a keyframed
  // blur — moves its radius every frame. Quantising the padding means the
  // buffers are built once and then simply reused.
  const P = Math.min(224, (Math.ceil((radius * 2 + 2) / 32) || 1) * 32)
  const pad = scratchFor(`${key}:pad`, Math.max(2, dw + 2 * P), Math.max(2, dh + 2 * P))
  const pctx = pad.getContext('2d')!
  pctx.setTransform(1, 0, 0, 1, 0, 0)
  pctx.filter = 'none'
  pctx.globalCompositeOperation = 'source-over'
  pctx.clearRect(0, 0, pad.width, pad.height)
  pctx.drawImage(src, 0, 0, sw, sh, P, P, dw, dh)
  // Edge strips, one source pixel wide, stretched into the padding.
  pctx.drawImage(src, 0, 0, 1, sh, 0, P, P, dh)
  pctx.drawImage(src, sw - 1, 0, 1, sh, P + dw, P, P, dh)
  pctx.drawImage(src, 0, 0, sw, 1, P, 0, dw, P)
  pctx.drawImage(src, 0, sh - 1, sw, 1, P, P + dh, dw, P)
  // ...and the four corner pixels into the corners.
  pctx.drawImage(src, 0, 0, 1, 1, 0, 0, P, P)
  pctx.drawImage(src, sw - 1, 0, 1, 1, P + dw, 0, P, P)
  pctx.drawImage(src, 0, sh - 1, 1, 1, 0, P + dh, P, P)
  pctx.drawImage(src, sw - 1, sh - 1, 1, 1, P + dw, P + dh, P, P)

  const out = scratchFor(`${key}:blur`, Math.max(2, dw), Math.max(2, dh))
  const octx = out.getContext('2d')!
  octx.setTransform(1, 0, 0, 1, 0, 0)
  octx.globalCompositeOperation = 'source-over'
  octx.clearRect(0, 0, out.width, out.height)
  octx.filter = `blur(${radius.toFixed(2)}px)`
  octx.drawImage(pad, -P, -P)
  octx.filter = 'none'
  return out
}

export const fxScratch = new Map<string, HTMLCanvasElement>()
/** Reused downscale buffer for the pixelate censor (was allocated per frame). */
export const pixelateScratch = document.createElement('canvas')

/** One scratch frame per compound clip; reused every frame. */
export const nestedScratch = new Map<string, HTMLCanvasElement>()

/**
 * Frees per-clip scratch canvases (pixel-fx, mask, compound) whose clip is no
 * longer alive. These are keyed by clip id and would otherwise linger for the
 * whole session after a clip is deleted — this includes image clips, which
 * have no <video> element for the engine's element prune to catch. Called
 * periodically from the engine with the set of currently-live clip ids.
 */
export function pruneClipScratch(aliveIds: Set<string>): void {
  const now = performance.now()
  for (const map of [maskScratch, fxScratch, nestedScratch, lookCopies] as Map<string, HTMLCanvasElement | OffscreenCanvas>[]) {
    for (const [key, cv] of map) {
      // Scratch keys are "<clipId>" or "<clipId>:<slot>" — a clip needs more
      // than one buffer now, and pruning on the whole key would have thrown
      // every extra slot away on the very next tick.
      const id = key.includes(':') ? key.slice(0, key.indexOf(':')) : key
      // Alive, but idle: a buffer nothing has drawn into for five seconds is
      // not being used by anything on screen.
      const idle = now - (scratchTouched.get(key) ?? now) > 5000
      // Living Frame is one reusable frame-space surface rather than a clip
      // buffer. Keep it only while it is actually being drawn; otherwise the
      // periodic prune would recreate three canvases during every playback.
      if ((aliveIds.has(id) || id === 'living-frame') && !idle) continue
      scratchTouched.delete(key)
      // Zero the backing store so the memory is released promptly.
      cv.width = 0
      cv.height = 0
      map.delete(key)
    }
  }
}

// A clip's own camera look: its picture copied at the size it is drawn, the
// look laid over the copy, the copy drawn in its place.
export const lookCopies = new Map<string, HTMLCanvasElement | OffscreenCanvas>()
