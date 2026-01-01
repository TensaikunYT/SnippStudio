// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Pixel effects and grades: LUTs, the pixel pass (GPU or CPU), adjustment
// layers, camera-look layers and copies. Moved out of playback/render.ts in
// SnippStudio phase 2B (no change).
import { applyPixelFxGL } from '../fxgl'
import { drawCameraLook, lookAt } from '../../effects/look'
import type { Clip, FxKey, Project } from '../../types'
import { clipOpacityAt, fxAmountAt, maskGeomAt } from '../pose'
import { hexToRgb } from './core'
import type { Ctx2D } from './core'
import { scratchTouched, fxScratch, lookCopies, sourcePixelW } from './scratch'
import { traceMaskPath } from './mask'
import { drawQuality, lookCap, smoothing, surfaceWidth } from './quality'
import { VIDEO_FX_INDEX, bloomRadiusPx, gradeIsNeutral, halationRadiusPx, pixelPassCpu } from './fx-math'
import type { FxParams } from './fx-math'
import { lutFor, lutKeyOf } from './lut-table'

// ---------------------------------------------------------------------------
// Pixel effects: chroma key (green screen), LUTs, colour and the picture
// effects. Processed at a capped resolution for speed — identical in preview
// and export.
// ---------------------------------------------------------------------------
/** The LUTs only this window holds (export/parallel.ts asks): draw/lut-table.ts. */
export { lutRegistry } from './lut-table'
/** CPU fallback ceiling — the per-pixel JS loop can't do more than this in real
 *  time. The GPU path is not bound by it (see applyPixelFx). */
export const PIXEL_FX_MAX_W = 960
/** GPU ceiling. Generous enough that 4K keeps every pixel, while a 20-megapixel
 *  still can't push the shader into pointless work: the result is drawn into a
 *  frame-sized box, so detail beyond a few times the project width is thrown
 *  away by the very next draw call anyway. */
export const GL_FX_MAX_W = 3840

/** An effect of part D is on: its amount above nothing, or keyed (a key may
 *  bring it up later in the clip). */
const fxOn = (clip: Clip, key: FxKey, base: number | undefined): boolean => (base ?? 0) > 0.001 || (clip.fxKeys?.[key]?.length ?? 0) > 0

/** True if any of the ImageData-based pixel effects are active on this clip. */
export function needsPixelFx(clip: Clip): boolean {
  return !!(
    clip.chroma?.enabled ||
    lutFor(lutKeyOf(clip, drawQuality.final)) ||
    clip.duotone ||
    (clip.sharpen && clip.sharpen > 0.01) ||
    (clip.vignette && clip.vignette > 0.01) ||
    (clip.grain && clip.grain > 0.01) ||
    (clip.chromaAb && clip.chromaAb > 0.01) ||
    (!!clip.videoFx && clip.videoFx.style !== 'none' && clip.videoFx.amount > 0.001) ||
    // "cila" part D. Every one of them unset or neutral on a clip made
    // before it: that clip takes the path it always took.
    (clip.tone && !gradeIsNeutral(clip.tone)) ||
    fxOn(clip, 'bloom', clip.bloom?.amount) ||
    fxOn(clip, 'halation', clip.halation?.amount) ||
    fxOn(clip, 'mosaic', clip.mosaic) ||
    (clip.isolate && fxOn(clip, 'isolate', clip.isolate.amount))
  )
}

/**
 * What the pass is asked to do for `clip` at project time `time`, worked at
 * `pw` pixels across a picture `w` media pixels wide. One description for the
 * GPU and the CPU path, so the two are given the same numbers; lengths
 * written in media pixels (aberration, the mosaic's cell) or as a share of
 * the width (glow, halation) are turned into the pass's pixels here, which is
 * what makes a preview at half size show what the export does at full size.
 */
export function fxParamsFor(clip: Clip, time: number, pw: number, w: number): FxParams {
  const local = time - clip.start
  const lutKey = lutKeyOf(clip, drawQuality.final)
  const lut = lutFor(lutKey)
  const ch = clip.chroma?.enabled ? clip.chroma : null
  const keyer = ch?.method === 'chroma'
  const bloom = fxAmountAt(clip, 'bloom', local)
  const halation = fxAmountAt(clip, 'halation', local)
  const mosaic = fxAmountAt(clip, 'mosaic', local)
  const isolate = clip.isolate ? fxAmountAt(clip, 'isolate', local) : 0
  return {
    chroma: ch
      ? keyer
        ? // The chroma keyer: distances on the CbCr plane (a saturated key is
          // about half a unit from grey, so the dials' 0..1 is halved).
          { key: hexToRgb(ch.color), sim: ch.similarity * 0.5, smooth: Math.max(1e-4, ch.smoothness * 0.5), mode: 1, spill: Math.max(0, Math.min(1, ch.spill ?? 0)) }
        : { key: hexToRgb(ch.color), sim: ch.similarity * 255, smooth: Math.max(1, ch.smoothness * 255), mode: 0 }
      : null,
    lut: lut && lut.n > 1 ? lut : null,
    // (The looks' hover shows a look whole.)
    lutAmount: lutKey === clip.lut ? Math.max(0, Math.min(1, clip.lutAmount ?? 1)) : 1,
    grade: clip.tone && !gradeIsNeutral(clip.tone) ? clip.tone : null,
    duotone: clip.duotone ? { dark: hexToRgb(clip.duotone.dark), light: hexToRgb(clip.duotone.light) } : null,
    sharpen: clip.sharpen ?? 0,
    vignette: clip.vignette ?? 0,
    grain: clip.grain ?? 0,
    // Aberration is authored in media pixels, so it tracks the working size.
    cab: Math.round((clip.chromaAb ?? 0) * (pw / w)),
    time,
    fx: VIDEO_FX_INDEX[clip.videoFx?.style ?? 'none'] ?? 0,
    fxAmount: clip.videoFx && clip.videoFx.style !== 'none' ? clip.videoFx.amount : 0,
    mosaic: mosaic > 0.001 ? mosaic * (pw / w) : 0,
    isolate: clip.isolate && isolate > 0.001 ? { key: hexToRgb(clip.isolate.color), range: Math.max(0.005, Math.min(0.5, clip.isolate.range)), amount: Math.min(1, isolate) } : null,
    bloom: bloom > 0.001 ? { amount: Math.min(1, bloom), threshold: Math.max(0, Math.min(1, clip.bloom?.threshold ?? 0.6)), radius: bloomRadiusPx(clip.bloom?.radius ?? 0.4, pw) } : null,
    halation: halation > 0.001 ? { amount: Math.min(1, halation), radius: halationRadiusPx(clip.halation?.size ?? 0.5, pw) } : null
  }
}

export function applyPixelFx(
  clip: Clip,
  src: CanvasImageSource,
  w: number,
  h: number,
  time: number,
  quality = 1,
  /** Device pixels per media pixel where it is drawn (the export sizes its
   *  surfaces by it: phase Ç3a, report R21). */
  devPerUnit = quality,
  /** The picture's width in the pixels its lengths are written in (media
   *  pixels: `w`). An adjustment layer hands over the frame as drawn so far,
   *  at the preview's scale: its lengths are the project's pixels. */
  unitW = w
): HTMLCanvasElement {
  // GPU path first — same maths, ~10-50x faster, and used by BOTH preview and
  // export so the two stay identical. Falls through to the CPU loop below if
  // WebGL2 is unavailable on this machine.
  //
  // FULL resolution here, scaled only by the render quality (1 on export). The
  // shader is per-pixel work on the GPU, so the frame size barely matters — but
  // the old 960 px cap applied to this path too, which meant switching on a
  // vignette (or grain, or a LUT) quietly resampled 1080p down to 960 and back
  // up again. That is what looked like the clip losing resolution, and because
  // export runs the same code it was baked into the file as well.
  // In final quality: the size it is drawn at, never wider than the output
  // (a 4K clip in a 4K export of a 1080p project asked for 7680; R21).
  // In the preview: never under twice the size it is drawn at (DENEME-1, P5).
  // The quality alone ignored the clip's own scale: a 960 px still at 200 %
  // in a half-quality preview was worked at 480 px and drawn up to 820, so
  // pointing at a LUT made the picture coarse and its edges jump; without
  // an effect the same picture is drawn straight from its source.
  const glW = drawQuality.final ? surfaceWidth(w, quality, devPerUnit) : Math.max(2, Math.round(Math.min(w, GL_FX_MAX_W, Math.max(w * quality, 2 * w * devPerUnit))))
  const glH = Math.max(2, Math.round((h * glW) / w))
  // (The preview reads the source smoothly when it works smaller than it:
  // DENEME-1, P5. A final frame is as it was.)
  const gpu = applyPixelFxGL(src, glW, glH, fxParamsFor(clip, time, glW, unitW), !drawQuality.final && glW < sourcePixelW(src, w))
  if (gpu) return gpu

  // CPU fallback only: the per-pixel JavaScript loop really is too slow at full
  // resolution, so this path keeps the cap.
  // In final quality it works at the output's width as the GPU path does
  // (phase Ç3a, report R20: a LUT clip came out at 960 px in a 1080p
  // export, upscaled, without a word); slow, but the file is right.
  const pw = drawQuality.final ? glW : Math.max(2, Math.round(Math.min(PIXEL_FX_MAX_W, w) * quality))
  const ph = Math.max(2, Math.round((h * pw) / w))

  scratchTouched.set(clip.id, performance.now())
  let cv = fxScratch.get(clip.id)
  if (!cv) {
    cv = document.createElement('canvas')
    fxScratch.set(clip.id, cv)
  }
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw
    cv.height = ph
  }
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  smoothing(ctx)
  ctx.clearRect(0, 0, pw, ph)
  ctx.drawImage(src, 0, 0, pw, ph)
  const img = ctx.getImageData(0, 0, pw, ph)
  // The same pass as the shader's, as plain arithmetic (draw/fx-math.ts).
  pixelPassCpu(img.data, pw, ph, fxParamsFor(clip, time, pw, unitW))
  ctx.putImageData(img, 0, 0)
  return cv
}

/** CSS filter pieces for a clip's colour grade + gaussian blur. */
export function gradeFilterParts(clip: Clip, q = 1): string[] {
  const g = clip.grade
  const parts: string[] = []
  if (g) {
    if (g.brightness !== 1) parts.push(`brightness(${g.brightness.toFixed(3)})`)
    if (g.contrast !== 1) parts.push(`contrast(${g.contrast.toFixed(3)})`)
    if (g.saturation !== 1) parts.push(`saturate(${g.saturation.toFixed(3)})`)
    if (g.warmth > 0.005) parts.push(`sepia(${(g.warmth * 0.45).toFixed(3)}) saturate(${(1 + g.warmth * 0.25).toFixed(3)})`)
    else if (g.warmth < -0.005) parts.push(`hue-rotate(${(g.warmth * -14).toFixed(1)}deg) brightness(${(1 + g.warmth * 0.04).toFixed(3)})`)
  }
  // Blur is specified in PROJECT pixels; at preview scale it may land under a
  // device pixel, where it costs a full filter pass and changes nothing visible.
  if (clip.blur && clip.blur * q > 0.6) parts.push(`blur(${clip.blur.toFixed(1)}px)`)
  return parts
}

/** Scratch canvas holding the composite beneath an adjustment layer. */
export let adjScratch: HTMLCanvasElement | null = null

/**
 * Applies an adjustment layer: grabs everything composited so far, runs the
 * layer's grade / LUT / pixel effects over it and paints it back. Because it
 * reads the buffer at the point the layer sits in draw order, it only affects
 * clips *below* it — exactly like an adjustment layer in a normal NLE. An
 * optional mask limits it to a region (secondary correction).
 */
export function applyAdjustmentLayer(
  ctx: Ctx2D,
  clip: Clip,
  time: number,
  width: number,
  height: number,
  scale: number,
  alpha: number
): void {
  const bw = Math.max(1, Math.round(width * scale))
  const bh = Math.max(1, Math.round(height * scale))
  if (!adjScratch) adjScratch = document.createElement('canvas')
  if (adjScratch.width !== bw || adjScratch.height !== bh) {
    adjScratch.width = bw
    adjScratch.height = bh
  }
  const sctx = adjScratch.getContext('2d')
  if (!sctx) return
  smoothing(sctx)
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, bw, bh)
  try {
    sctx.drawImage(ctx.canvas as CanvasImageSource, 0, 0)
  } catch {
    return
  }

  let source: CanvasImageSource = adjScratch
  // (Its lengths — a mosaic's cell, the aberration — are the project's
  // pixels, whatever the scale the frame is drawn at: the preview at half
  // size shows what the export does. "Cila" part D; the aberration was the
  // same number of pixels at every scale.)
  if (needsPixelFx(clip)) source = applyPixelFx(clip, adjScratch, bw, bh, time, 1, 1, width)

  ctx.save()
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * clipOpacityAt(clip, time - clip.start)))
  const parts = gradeFilterParts(clip)
  if (parts.length > 0) ctx.filter = parts.join(' ')
  const mask = clip.mask
  if (mask?.enabled && !(mask.shape === 'path' && (mask.points?.length ?? 0) < 3)) {
    const g = maskGeomAt(mask, time - clip.start)
    ctx.translate(width / 2, height / 2)
    traceMaskPath(ctx, mask.shape, g, mask.smooth ?? 0)
    ctx.translate(-width / 2, -height / 2)
    ctx.clip()
  }
  ctx.drawImage(source, 0, 0, width, height)
  ctx.restore()
  // Its look, when it lies over the tracks below (the graphics
  // get theirs later, over them).
  if (clip.cameraLook && (clip.lookOver ?? 'below') === 'below') {
    drawCameraLook(ctx, lookAt(clip.cameraLook, alpha * clipOpacityAt(clip, time - clip.start)), time, width, height, scale)
  }
}

/**
 * Look layers that lie over more than the tracks below them: over the
 * graphics as well, or over everything but the subtitles — laid on once the
 * frame has those, for as long as each layer lasts, at its strength.
 */
export function drawLookLayers(ctx: Ctx2D, project: Project, time: number, width: number, height: number, scale: number, over: 'graphics' | 'all', region?: { left: number; width: number }): void {
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const id of track.clipIds) {
      const clip = project.clips[id]
      if (!clip?.adjustment || clip.disabled || !clip.cameraLook || clip.lookOver !== over) continue
      if (time < clip.start || time >= clip.start + clip.duration) continue
      const k = clipOpacityAt(clip, time - clip.start)
      if (k <= 0.001) continue
      drawCameraLook(ctx, lookAt(clip.cameraLook, k), time, width, height, scale, region)
    }
  }
}
export function lookedCopy(clip: Clip, source: CanvasImageSource, w: number, h: number, devPerUnit: number, time: number, k = 1, keepAlpha = false): CanvasImageSource {
  // (At the output's width in final quality: phase Ç3a, report R12. It was
  // 2560 everywhere, so a looked clip in a 4K export was soft all over.)
  const cap = Math.min(1, lookCap() / Math.max(1, w * devPerUnit))
  const dw = Math.max(2, Math.round(w * devPerUnit * cap))
  const dh = Math.max(2, Math.round(h * devPerUnit * cap))
  // Keyed like the other clip scratches, so the engine's prune lets a copy
  // go once its clip is gone or idle (each can be 2560 px wide).
  const key = `${clip.id}:look`
  scratchTouched.set(key, performance.now())
  let cv = lookCopies.get(key)
  if (!cv) {
    cv = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(dw, dh)
    lookCopies.set(key, cv)
    if (lookCopies.size > 32) lookCopies.delete(lookCopies.keys().next().value as string)
  }
  if (cv.width !== dw || cv.height !== dh) {
    cv.width = dw
    cv.height = dh
  }
  const g = cv.getContext('2d') as Ctx2D | null
  if (!g) return source
  smoothing(g)
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, dw, dh)
  try {
    g.drawImage(source, 0, 0, dw, dh)
  } catch {
    return source
  }
  drawCameraLook(g, clip.look!, time, w, h, dw / w)
  // Coming on (just switched on): the plain picture over it, fading.
  if (k < 1) {
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = 1 - k
    g.drawImage(source, 0, 0, dw, dh)
    g.restore()
  }
  // A picture that lets the tracks under it through keeps its alpha: the
  // look's vignette, fade and grain painted its transparent parts (phase 5b,
  // decision 3). Only then: an opaque picture's copy stays as it was.
  // 'destination-atop' with the picture (5a/5b patch, audit S-1): the
  // result's alpha is the picture's own, once (destination-in multiplied the
  // copy's alpha by it again: a 50 % band came out at 25 %); where the
  // picture is opaque the copy is kept exactly, where it is clear nothing.
  if (keepAlpha) keepPictureAlpha(g, source, dw, dh)
  return cv as CanvasImageSource
}

/** The copy on `g` (the picture with an effect laid on it) given back the
 *  picture's own alpha: copy·α + picture·(1 − copy's α), alpha α (Porter-Duff
 *  destination-atop). Opaque pixels: the copy; clear pixels: nothing. */
export function keepPictureAlpha(g: Ctx2D, source: CanvasImageSource, dw: number, dh: number): void {
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = 1
  g.filter = 'none'
  g.globalCompositeOperation = 'destination-atop'
  g.drawImage(source, 0, 0, dw, dh)
  g.restore()
}
