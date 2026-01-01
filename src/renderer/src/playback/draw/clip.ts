// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Drawing one clip (and a nested one), through a scratch canvas or with motion
// blur on a speed ramp, and the living-frame overlay. Moved out of
// playback/render.ts in SnippStudio phase 2B (no change).
import { hasLook } from '../../effects/look'
import { burnHoles, seedOf } from '../../effects/film-burn'
import type { Asset, Clip, Project } from '../../types'
import { seeThrough } from '../../media/checker'
import { filmHasAlpha } from '../../media/film-alpha'
import { assetById, maskStrength } from '../../types'
import { clipOpacityAt, maskGeomAt } from '../pose'
import { activeClipAtTime, applyWorldTransform, isAdjustmentClip, nestedChildren, nestedSpan } from './core'
import type { Ctx2D, SourceResolver } from './core'
import { clipMediaAt, renderList } from './timing'
import { drawEntries } from './entries'
import type { RenderEntry } from './timing'
import { scratchTouched, scratchFor, sourcePixelW, sourcePixelH, blurredCopy, pixelateScratch, nestedScratch } from './scratch'
import { traceMaskPath } from './mask'
import { needsPixelFx, applyPixelFx, gradeFilterParts, keepPictureAlpha, lookedCopy } from './pixel-fx'
import { clipVisualPoseAt } from './motion'
import { drawStillImageFx, ambientPulse, drawAmbientFx } from './still-fx'
import { drawQuality, smoothing, surfaceWidth } from './quality'

/**
 * Composites a compound clip's children into an offscreen frame at project
 * resolution and returns it, to be used as the parent clip's source image.
 * Children are drawn bottom-up in array order using the same `drawClip`, so
 * everything (effects, masks, keyframes, blend) behaves identically nested.
 */
export function renderNested(
  project: Project,
  clip: Clip,
  local: number,
  resolve: SourceResolver,
  q = 1
): HTMLCanvasElement | null {
  const { width, height } = project.settings
  // Sized by the render scale as well, so compound clips get cheaper at lower
  // preview quality just like everything else.
  const bw = Math.max(2, Math.round(width * q))
  const bh = Math.max(2, Math.round(height * q))
  scratchTouched.set(clip.id, performance.now())
  let cv = nestedScratch.get(clip.id)
  if (!cv) {
    cv = document.createElement('canvas')
    nestedScratch.set(clip.id, cv)
  }
  if (cv.width !== bw || cv.height !== bh) {
    cv.width = bw
    cv.height = bh
  }
  const nctx = cv.getContext('2d')
  if (!nctx) return null
  smoothing(nctx)
  // Children draw in project units; the transform maps them into the buffer.
  nctx.setTransform(bw / width, 0, 0, bh / height, 0, 0)
  nctx.globalCompositeOperation = 'source-over'
  nctx.globalAlpha = 1
  nctx.filter = 'none'
  // Transparent, so a compound clip composites over lower tracks correctly.
  nctx.clearRect(0, 0, width, height)
  // The children on tracks of their own, as they lay, through the render
  // list (phase Ç2b.2, decision 5; report G7): the transitions between them
  // (their ghost frames, the mix, the reveals) are drawn as they were before
  // the compound was made. They live on the compound's own clock.
  const inner = nestedProject(project, clip)
  drawEntries(nctx, inner, renderList(inner, local), local, resolve, q, { key: `${clip.id}/` })
  return cv
}

/** A compound's children as a project of their own: one video track per
 *  layer they came from (the children are kept bottom layer first), each in
 *  time order; the outer project's media and settings. Cached per compound
 *  object (a new one after every edit of it). */
const innerCache = new WeakMap<Clip, Project>()
export function nestedProject(project: Project, clip: Clip): Project {
  const hit = innerCache.get(clip)
  if (hit && hit.assets === project.assets && hit.settings === project.settings) return hit
  const order: string[] = []
  const byTrack = new Map<string, Clip[]>()
  for (const c of nestedChildren(clip)) {
    if (!byTrack.has(c.trackId)) order.push(c.trackId)
    byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c])
  }
  // tracks[0] is the top layer: the last one the children came from.
  const tracks = order.reverse().map((id) => ({ id, kind: 'video' as const, name: id, clipIds: [...byTrack.get(id)!].sort((a, b) => a.start - b.start).map((c) => c.id) }))
  const inner: Project = { ...project, tracks, clips: Object.fromEntries(nestedChildren(clip).map((c) => [c.id, c])) }
  innerCache.set(clip, inner)
  return inner
}

export function drawClip(
  ctx: Ctx2D,
  project: Project,
  clip: Clip,
  time: number,
  resolve: SourceResolver,
  alpha = 1,
  dx = 0,
  /** Render scale (preview quality / export resolution). Shrinks the
   *  intermediate buffers so lowering quality genuinely costs less. */
  q = 1,
  /** Transition blur in project pixels. Merged into the clip's own filter —
   *  set separately it would simply be overwritten by the grade. */
  extraBlur = 0,
  suppressEdgeMotion?: boolean
): void {
  if (isAdjustmentClip(clip)) return
  const asset = assetById(project, clip.assetId)
  // A compound clip has no asset of its own: its children are composited into
  // an offscreen frame which then becomes this clip's source, so transform,
  // effects, mask and blend all apply to the group as a single image.
  const nested = clip.nested
  if (!nested && (!asset || asset.missing || asset.kind === 'audio')) return
  // The same source clock drives video decoders, preview playback and audio.
  const localTime = clipMediaAt(project, clip, time).time
  // A compound's ghost frames (a transition's lead or tail) past either end
  // of what its children cover hold its first or last frame, as a video does
  // at the ends of its media, instead of drawing an empty one.
  const src = nested
    ? renderNested(project, clip, activeClipAtTime(clip, time) ? localTime : Math.min(Math.max(0, localTime), Math.max(0, nestedSpan(clip) - 1 / 240)), resolve, q)
    : resolve(clip, asset!, localTime)
  if (!src) return

  const { transform: visual, animation: anim } = clipVisualPoseAt(project, clip, time, suppressEdgeMotion)
  ctx.save()
  if (dx) ctx.translate(dx, 0)
  const clipAlpha = Math.max(
    0,
    Math.min(1, alpha * clipOpacityAt(clip, time - clip.start) * anim.alpha)
  )
  ctx.globalAlpha = clipAlpha
  // Blend mode against whatever is already composited beneath this clip.
  if (clip.blendMode && clip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = clip.blendMode as GlobalCompositeOperation
  }
  // Color grade + blur (identical in preview and export via this shared path).
  const parts = gradeFilterParts(clip, q)
  // Filter lengths are device pixels whatever the transform says, so a preview
  // at half scale needs half the blur to look like the export does. The blur
  // itself is NOT put in this filter — see the edge-clamped pass below.
  const ambience = clip.ambientFx
  const ambientTime = time - clip.start + (ambience?.timeOffset ?? 0)
  const ambienceBlur = ambience?.style === 'soft-focus'
    ? (0.45 + 1.65 * Math.max(0, Math.min(1, ambience.amount)) * ambientPulse(ambience.seed, ambientTime))
    : 0
  const blurPx = (anim.blur + extraBlur + ambienceBlur) * q
  if (parts.length > 0) ctx.filter = parts.join(' ')

  // Canvas 2.5D depth: a pinhole-style parallax where the layer's offset from
  // the camera centre AND its size both scale by p = F/(F+z). Nearer layers
  // (z<0, p>1) move more and look bigger; farther layers move less / smaller —
  // so panning the camera flies THROUGH a layered scene. Purely a Canvas-2D
  // affine tweak, so preview and export stay identical.
  ctx.translate(visual.x, visual.y)
  ctx.rotate(visual.rotation)
  ctx.scale(visual.scale, visual.scale)
  // Squash, stretch and the turn of a picture's own moves.
  if (anim.sx !== undefined || anim.sy !== undefined) ctx.scale(anim.sx ?? 1, anim.sy ?? 1)
  // A compound clip's natural size is the project frame it was rendered into.
  const w = nested ? project.settings.width : asset!.width || 2
  const h = nested ? project.settings.height : asset!.height || 2
  try {
    // 1) Pixel effects (green screen / LUT / duotone / sharpen / vignette /
    //    grain / chromatic aberration) → processed scratch.
    let source: CanvasImageSource = src
    // Device pixels per local unit here (the clip's own scale and the
    // render's, rotation included): what its surfaces are sized by in final
    // quality (phase Ç3a, report R21).
    const m0 = ctx.getTransform()
    const devPerUnit0 = Math.hypot(m0.a, m0.b) || 1
    if (needsPixelFx(clip)) {
      source = applyPixelFx(clip, src, w, h, time, q, devPerUnit0)
    }

    // 2) Shape mask (cut / blur-censor / pixelate-censor). A freehand path
    //    with fewer than 3 points (still being drawn) is not applied — the
    //    whole clip stays visible so the user can see where to place it.
    const mask = clip.mask
    const maskReady = mask?.enabled && !(mask.shape === 'path' && (mask.points?.length ?? 0) < 3)
    if (mask?.enabled && maskReady) {
      // The scratch is sized by the render scale, not the media, so a
      // lower preview quality really does less work here. Everything below
      // still draws in media units — the context transform maps them in, and
      // blur radii (which are in device pixels) are scaled to match.
      // (In final quality by the size it is drawn at, never wider than the
      // output: quality.ts surfaceWidth. `mq` is the scratch's own scale.)
      const mw = surfaceWidth(w, q, devPerUnit0)
      const mq = drawQuality.final ? mw / w : q
      const mh = drawQuality.final ? Math.max(2, Math.round(h * mq)) : Math.max(2, Math.round(h * q))
      const cv = scratchFor(clip.id, mw, mh)
      const octx = cv.getContext('2d')!
      octx.setTransform(mw / w, 0, 0, mh / h, 0, 0)
      octx.filter = 'none'
      octx.globalCompositeOperation = 'source-over'
      octx.clearRect(0, 0, w, h)
      octx.drawImage(source, 0, 0, w, h)
      const g = maskGeomAt(mask, time - clip.start)
      const mode = mask.mode ?? 'cut'
      const srcPixW = sourcePixelW(source, w)
      const srcPixH = sourcePixelH(source, h)
      /** Traces the region the mask covers, inverted when asked. Even-odd with
       *  an outer rectangle is what turns "this shape" into "everything but". */
      const traceRegion = (c: Ctx2D): void => {
        c.translate(w / 2, h / 2) // mask coords are media-center-origin
        traceMaskPath(c, mask.shape, g, mask.smooth ?? 0)
        if (mask.invert) c.rect(-w, -h, w * 3, h * 3)
        c.translate(-w / 2, -h / 2)
      }
      const featherPx = Math.max(0, mask.feather) * mq
      if (mode === 'cut') {
        octx.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in'
        if (featherPx > 0) octx.filter = `blur(${featherPx.toFixed(2)}px)`
        octx.save()
        octx.translate(w / 2, h / 2)
        traceMaskPath(octx, mask.shape, g, mask.smooth ?? 0)
        octx.fillStyle = '#fff'
        octx.fill()
        octx.restore()
      } else {
        // Censor strength is its own setting now. Feather used to BE the
        // strength here, so a project saved before they were split keeps its
        // look through the old formula.
        const censor = maskStrength(mask, w, h)
        // The censored picture is built for the WHOLE frame, then cut to the
        // mask with a soft alpha and laid over the original. Clipping instead
        // gave a hard edge no amount of Feather could soften, and blurring
        // inside a clip left the frame's own border unblurred.
        const censorCv = scratchFor(`${clip.id}:censor`, mw, mh)
        const cctx = censorCv.getContext('2d')!
        cctx.setTransform(mw / w, 0, 0, mh / h, 0, 0)
        cctx.filter = 'none'
        cctx.globalCompositeOperation = 'source-over'
        cctx.clearRect(0, 0, w, h)
        if (mode === 'blur') {
          const soft = blurredCopy(`${clip.id}:mask`, source, srcPixW, srcPixH, mw, mh, censor * mq)
          cctx.drawImage(soft, 0, 0, soft.width, soft.height, 0, 0, w, h)
        } else {
          const factor = Math.max(8, Math.round(censor * 1.5))
          const tw = Math.max(2, Math.round(w / factor))
          const th = Math.max(2, Math.round(h / factor))
          const tiny = pixelateScratch
          if (tiny.width !== tw || tiny.height !== th) {
            tiny.width = tw
            tiny.height = th
          }
          const tctx = tiny.getContext('2d')!
          tctx.clearRect(0, 0, tw, th)
          tctx.drawImage(source, 0, 0, tw, th)
          cctx.imageSmoothingEnabled = false
          cctx.drawImage(tiny, 0, 0, tw, th, 0, 0, w, h)
          cctx.imageSmoothingEnabled = true
        }
        // Keep only the part of it the mask covers — softened by Feather, which
        // is the one thing Feather means everywhere now.
        cctx.globalCompositeOperation = 'destination-in'
        if (featherPx > 0) cctx.filter = `blur(${featherPx.toFixed(2)}px)`
        cctx.save()
        traceRegion(cctx)
        cctx.fillStyle = '#fff'
        cctx.fill(mask.invert ? 'evenodd' : 'nonzero')
        cctx.restore()
        cctx.filter = 'none'
        cctx.globalCompositeOperation = 'source-over'
        octx.drawImage(censorCv, 0, 0, censorCv.width, censorCv.height, 0, 0, w, h)
      }
      octx.filter = 'none'
      octx.globalCompositeOperation = 'source-over'
      source = cv
    }

    // 2b) Clip blur (and the blur a transition adds), with edges that hold.
    //     Through the filter it faded to transparent at the picture's own
    //     border and let the black behind it show as a dark rim — the same
    //     fault the mask censor had, in the place it is easiest to see.
    if (blurPx > 0.6) {
      const m = ctx.getTransform()
      // Device pixels per local unit, rotation included.
      const devPerUnit = Math.hypot(m.a, m.b) || 1
      // Working at the size it will be DRAWN at rather than the size it was
      // decoded at: on 4K footage in a scaled preview that is a quarter of the
      // pixels for the same result. Capped, because a clip scaled to 300% would
      // otherwise ask for a buffer three times the frame — the radius shrinks
      // with it, so the picture is the same either way.
      const want = Math.max(2, Math.round(w * devPerUnit))
      const cap = Math.min(1, 2560 / Math.max(1, want))
      const dw = Math.max(2, Math.round(want * cap))
      const dh = Math.max(2, Math.round(h * devPerUnit * cap))
      source = blurredCopy(
        `${clip.id}:soft`,
        source,
        sourcePixelW(source, w),
        sourcePixelH(source, h),
        dw,
        dh,
        blurPx * cap
      )
    }

    // A camera look on this clip alone: worked on a copy of its own picture,
    // so its grain, vignette and fade stay inside it (and, on a picture that
    // lets the tracks under it through, inside its opaque parts: phase 5b,
    // decision 3).
    const ambientOn = !!clip.ambientFx && clip.ambientFx.amount > 0 && clip.ambientFx.style !== 'soft-focus' && clip.ambientFx.style !== 'living-frame'
    const lookOn = !!clip.look && hasLook(clip.look)
    // (Asked of the picture itself, `src`, not of what the clip's own mask,
    // keyer, blur or pixel effects made of it: a still opaque in itself keeps
    // the path and the pixels it had before 5b; 5a/5b patch, audit S-2.)
    const clear = (lookOn || ambientOn) && mayLetThrough(asset, src, nested ? compoundAlphaKey(project, clip, activeClipAtTime(clip, time) ? localTime : Math.min(Math.max(0, localTime), Math.max(0, nestedSpan(clip) - 1 / 240))) : undefined)
    if (lookOn) {
      const m = ctx.getTransform()
      const devPerUnit = Math.hypot(m.a, m.b) || 1
      source = lookedCopy(clip, source, w, h, devPerUnit, time, 1, clear)
    }
    // The ambient light of a picture that lets things through: laid on a
    // copy of it and kept to its alpha (painted on the frame, it lit or
    // darkened the tracks under the transparent parts too).
    let ambientDone = false
    if (ambientOn && clear) {
      const m = ctx.getTransform()
      const devPerUnit = Math.hypot(m.a, m.b) || 1
      source = ambientCopy(clip, source, w, h, devPerUnit, time - clip.start, q)
      ambientDone = true
    }

    // A still's own light (window light, dust, light leak) on a still that
    // lets the tracks under it through: laid on a copy of it and kept to its
    // alpha, as the ambient light above (5a/5b patch, audit S-5: it painted
    // the empty parts of a transparent PNG). An opaque still: on the frame,
    // as before.
    let stillFxDone = false
    if (asset?.kind === 'image' && clip.stillImageFx && clip.stillImageFx.amount > 0 && mayLetThrough(asset, src)) {
      const m = ctx.getTransform()
      const devPerUnit = Math.hypot(m.a, m.b) || 1
      source = stillFxCopy(clip, source, w, h, devPerUnit, time - clip.start)
      stillFxDone = true
    }

    // 3) Flip + crop + draw.
    if (clip.flipH || clip.flipV) ctx.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1)
    const crop = clip.crop
    // Source pixel dimensions of what we're actually drawing (`source` may be
    // the mask/chroma scratch canvas). A <video> exposes `width` (the HTML
    // attr, often 0), so it must use videoWidth — the old `??` chain caught
    // that 0 as "defined" and cropped a 1×1 region → black frame.
    const srcW =
      source instanceof HTMLVideoElement
        ? source.videoWidth
        : source instanceof HTMLImageElement
          ? source.naturalWidth
          : (source as HTMLCanvasElement).width || w
    const srcH =
      source instanceof HTMLVideoElement
        ? source.videoHeight
        : source instanceof HTMLImageElement
          ? source.naturalHeight
          : (source as HTMLCanvasElement).height || h
    if (crop && (crop.l > 0 || crop.t > 0 || crop.r > 0 || crop.b > 0) && srcW > 0 && srcH > 0) {
      const sx = crop.l * srcW
      const sy = crop.t * srcH
      const sw = Math.max(1, srcW * (1 - crop.l - crop.r))
      const sh = Math.max(1, srcH * (1 - crop.t - crop.b))
      ctx.drawImage(
        source,
        sx,
        sy,
        sw,
        sh,
        -w / 2 + crop.l * w,
        -h / 2 + crop.t * h,
        Math.max(1, w * (1 - crop.l - crop.r)),
        Math.max(1, h * (1 - crop.t - crop.b))
      )
    } else {
      ctx.drawImage(source, -w / 2, -h / 2, w, h)
    }

    // Glow / bloom: overlay a blurred, brightened copy with additive blending.
    if (clip.glow && clip.glow > 0.01) {
      ctx.filter = `blur(${(8 + clip.glow * 20).toFixed(0)}px) brightness(1.5)`
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = clipAlpha * Math.min(0.9, clip.glow * 0.7)
      ctx.drawImage(source, -w / 2, -h / 2, w, h)
    }
    if (asset?.kind === 'image' && !stillFxDone) {
      drawStillImageFx(ctx, clip, w, h, time - clip.start, clipAlpha)
    }
    if (!ambientDone) drawAmbientFx(ctx, clip, w, h, time - clip.start, clipAlpha, q)
  } catch {
    // Source not ready yet (e.g. video element still seeking); skip the frame.
  }
  ctx.restore()
}

/** Pictures already read for transparency, with what they showed then
 *  (5a/5b patch, audit S-4: a canvas was read back on every frame). */
const readAlpha = new WeakMap<object, { key: string; v: boolean }>()
/**
 * Can this clip's picture let the tracks under it through (phase 5b,
 * decision 3)? A code film or a video says so by its asset (sampled at its
 * strip, read at import); a still and a compound's frame are read, once per
 * picture and what it shows: a still by its address (an ImageBitmap of the
 * export never changes), a compound's frame by `key` (compoundAlphaKey: the
 * same while its children are plain footage that stays put).
 */
export function mayLetThrough(asset: Asset | undefined, source: CanvasImageSource, key?: string): boolean {
  if (asset?.kind === 'code') return filmHasAlpha(asset)
  if (asset?.kind === 'video') return !!asset.alpha
  let k: string | null = null
  if (source instanceof HTMLImageElement) {
    if (!source.complete || source.naturalWidth <= 0) return false
    k = source.currentSrc || source.src
  } else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) k = ''
  else if (key !== undefined) k = key
  if (k === null) return seeThrough(source)
  const hit = readAlpha.get(source as object)
  if (hit && hit.key === k) return hit.v
  const v = seeThrough(source)
  readAlpha.set(source as object, { key: k, v })
  return v
}

/**
 * What a compound clip's frame shows at its local time `local`, as far as
 * its transparency goes. While every child drawn is plain opaque footage
 * (a video without alpha; no mask, keyer, pixel effect, blend, transition or
 * fade at that moment), only where they stand matters: their pose, opacity,
 * crop and blur. Anything else: the moment itself (read each frame, as
 * before).
 */
export function compoundAlphaKey(project: Project, clip: Clip, local: number): string {
  const inner = nestedProject(project, clip)
  const parts: string[] = [`${project.settings.width}x${project.settings.height}`]
  for (const e of renderList(inner, local)) {
    const c = e.clip
    const a = assetById(inner, c.assetId)
    const plain =
      !!a && a.kind === 'video' && a.alpha !== true && !c.nested && !c.mask?.enabled && !needsPixelFx(c) && (!c.blendMode || c.blendMode === 'normal') && !(c.glow && c.glow > 0.01) && !(c.ambientFx && c.ambientFx.amount > 0) &&
      !e.ghost && e.alpha === 1 && !e.mix && !e.dx && !e.dy && e.wipe === undefined && e.zoomFx === undefined && !e.blurFx && !e.motionBlur
    if (!plain) return `t${Math.round(local * 1e4)}`
    const { transform: v, animation: an } = clipVisualPoseAt(inner, c, local, e.suppressEdgeMotion)
    const op = clipOpacityAt(c, local - c.start) * an.alpha
    parts.push(`${c.id}:${v.x.toFixed(2)},${v.y.toFixed(2)},${v.scale.toFixed(5)},${v.rotation.toFixed(5)},${an.sx ?? 1},${an.sy ?? 1},${op.toFixed(4)},${an.blur},${JSON.stringify(c.crop ?? null)}`)
  }
  return parts.join('|')
}

/**
 * A clip's ambient light (edge glow, breathing shadow, burn flare) laid on a
 * copy of its picture and kept to the picture's alpha: on a transparent
 * picture it lights only what is there (phase 5b, decision 3). The copy is
 * drawn at the clip's opacity in its place, so the light is at full strength
 * on it.
 */
function ambientCopy(clip: Clip, source: CanvasImageSource, w: number, h: number, devPerUnit: number, local: number, q: number): CanvasImageSource {
  const cap = Math.min(1, 2560 / Math.max(1, w * devPerUnit))
  const dw = Math.max(2, Math.round(w * devPerUnit * cap))
  const dh = Math.max(2, Math.round(h * devPerUnit * cap))
  const cv = scratchFor(`${clip.id}:ambient`, dw, dh)
  const g = cv.getContext('2d')
  if (!g) return source
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  g.filter = 'none'
  g.clearRect(0, 0, dw, dh)
  try {
    g.drawImage(source, 0, 0, dw, dh)
  } catch {
    return source
  }
  // In the clip's own units, centred, as drawClip paints it.
  g.setTransform(dw / w, 0, 0, dh / h, dw / 2, dh / 2)
  drawAmbientFx(g as unknown as Ctx2D, clip, w, h, local, 1, q)
  // The picture's own alpha, once (5a/5b patch, audit S-1: destination-in
  // squared it).
  keepPictureAlpha(g as unknown as Ctx2D, source, dw, dh)
  g.globalCompositeOperation = 'source-over'
  return cv
}

/** A still's own light (drawStillImageFx) laid on a copy of the still and
 *  kept to its alpha (5a/5b patch, audit S-5); drawn at full strength on the
 *  copy, which is drawn at the clip's opacity. */
function stillFxCopy(clip: Clip, source: CanvasImageSource, w: number, h: number, devPerUnit: number, local: number): CanvasImageSource {
  const cap = Math.min(1, 2560 / Math.max(1, w * devPerUnit))
  const dw = Math.max(2, Math.round(w * devPerUnit * cap))
  const dh = Math.max(2, Math.round(h * devPerUnit * cap))
  const cv = scratchFor(`${clip.id}:stillfx`, dw, dh)
  const g = cv.getContext('2d')
  if (!g) return source
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'
  g.filter = 'none'
  g.clearRect(0, 0, dw, dh)
  try {
    g.drawImage(source, 0, 0, dw, dh)
  } catch {
    return source
  }
  g.setTransform(dw / w, 0, 0, dh / h, dw / 2, dh / 2)
  drawStillImageFx(g as unknown as Ctx2D, clip, w, h, local, 1)
  keepPictureAlpha(g as unknown as Ctx2D, source, dw, dh)
  g.globalCompositeOperation = 'source-over'
  return cv
}

/**
 * Draws one entry onto its own surface first, so pieces can be taken OUT of it.
 *
 * The frame already holds the incoming shot by the time an outgoing overlay is
 * drawn, so erasing with a gradient — or cutting the picture into bands —
 * straight onto it would take the incoming shot with it. On a scratch of its
 * own, the erase only touches this clip, and the result is laid over the top.
 */
export function drawEntryThroughScratch(
  ctx: Ctx2D,
  project: Project,
  entry: RenderEntry,
  time: number,
  resolve: SourceResolver,
  scale: number
): void {
  const { width, height } = project.settings
  const dw = Math.max(2, Math.round(width * scale))
  const dh = Math.max(2, Math.round(height * scale))
  const cv = scratchFor(`${entry.clip.id}:trans`, dw, dh)
  const tctx = cv.getContext('2d')!
  tctx.setTransform(scale, 0, 0, scale, 0, 0)
  tctx.filter = 'none'
  tctx.globalCompositeOperation = 'source-over'
  tctx.globalAlpha = 1
  tctx.clearRect(0, 0, width, height)
  drawClip(tctx, project, entry.clip, time, resolve, entry.alpha, entry.dx ?? 0, scale, entry.blurFx ?? 0, entry.suppressEdgeMotion)

  if (entry.softFrom !== undefined) {
    // Erase from the left, over a band rather than at a line. The band is wide
    // enough to read as light eating the picture and narrow enough that the
    // two shots are never both half-there across the whole frame.
    const f = entry.softFrom
    tctx.save()
    tctx.transform(1, 0, width * 0.16 / height, 1, -width * 0.08, 0)
    const band = width * 0.28
    const x0 = width * (-0.3 + 1.6 * f) - band * 0.5
    const grad = tctx.createLinearGradient(x0, 0, x0 + band, 0)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    tctx.globalCompositeOperation = 'destination-out'
    tctx.fillStyle = grad
    tctx.fillRect(-width, -height, width * 3, height * 3)
    tctx.restore()
    tctx.globalCompositeOperation = 'source-over'
  }
  // Burning away: scorched at the rims, holes eaten through to the new shot.
  if (entry.burn !== undefined) burnHoles(tctx, seedOf(entry.clip.id), entry.burn, width, height, scale)
  // Down towards black: the clip's own pixels only (source-atop), so the
  // tracks round a smaller picture are left as they are.
  if (entry.dip !== undefined && entry.dip > 0) {
    tctx.save()
    tctx.setTransform(1, 0, 0, 1, 0, 0)
    tctx.filter = 'none'
    tctx.globalAlpha = 1
    tctx.globalCompositeOperation = 'source-atop'
    tctx.fillStyle = `rgba(0,0,0,${Math.min(1, entry.dip).toFixed(4)})`
    tctx.fillRect(0, 0, dw, dh)
    tctx.restore()
  }

  ctx.save()
  applyWorldTransform(ctx, scale)
  if (entry.dy) ctx.translate(0, entry.dy)
  // Blended against the scene under it, as drawClip would have: on the
  // empty scratch a screen or multiply came out as the plain picture.
  if (entry.clip.blendMode && entry.clip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = entry.clip.blendMode as GlobalCompositeOperation
  }
  ctx.drawImage(cv, 0, 0, width, height)
  ctx.restore()
}

/** Draw the clip once, then integrate a soft shutter trail in its direction
 * of travel. Re-sampling the finished clip preserves crop, masks, glow and camera
 * motion while keeping this cheap enough for both preview and export. */
export function drawRampWithMotionBlur(
  ctx: Ctx2D,
  project: Project,
  entry: RenderEntry,
  time: number,
  resolve: SourceResolver,
  scale: number
): void {
  const { width, height } = project.settings
  const dw = Math.max(2, Math.round(width * scale))
  const dh = Math.max(2, Math.round(height * scale))
  const cv = scratchFor(`${entry.clip.id}:ramp-motion`, dw, dh)
  const tctx = cv.getContext('2d')!
  tctx.setTransform(1, 0, 0, 1, 0, 0)
  tctx.clearRect(0, 0, dw, dh)
  tctx.setTransform(ctx.getTransform())
  tctx.filter = 'none'
  tctx.globalCompositeOperation = 'source-over'
  tctx.globalAlpha = 1
  drawClip(tctx, project, entry.clip, time, resolve, entry.alpha, entry.dx ?? 0, scale, entry.blurFx ?? 0, entry.suppressEdgeMotion)

  const motion = entry.motionBlur!
  const trailX = motion.dx * scale
  const trailY = motion.dy * scale
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.filter = 'none'
  // Preserve the clip's blend against the scene beneath it, even though its
  // image is first collected on a transparent scratch canvas.
  if (entry.clip.blendMode && entry.clip.blendMode !== 'normal') {
    ctx.globalCompositeOperation = entry.clip.blendMode as GlobalCompositeOperation
  }
  ctx.globalAlpha = 1
  ctx.drawImage(cv, 0, 0)
  // The copies must be drawn above an opaque still, otherwise only the edge
  // shows any blur. Their low opacity smears detail without washing the shot.
  for (let sample = 8; sample >= 1; sample--) {
    const distance = sample / 8
    ctx.globalAlpha = 0.16 * (1 - distance * 0.65)
    ctx.drawImage(cv, -trailX * distance, -trailY * distance)
  }
  ctx.restore()
}

/** A Living Frame is chosen from the visible composite, not drawn once per
 * source clip. This avoids stacking four corner treatments at a transition. */
export function livingFrameForEntries(entries: RenderEntry[]): Clip | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const { clip, alpha } = entries[i]
    if (alpha > 0 && clip.ambientFx?.style === 'living-frame' && clip.ambientFx.amount > 0) {
      return clip
    }
  }
  return undefined
}

/** A shallow, neutral focus falloff in FRAME coordinates. Only four small
 * corner patches are blurred; the centre, source clip and subtitles retain
 * their original pixels and resolution. The same path is used by preview and
 * export, and the slow pulse uses project time across adjacent clips. */
export function drawLivingFrameOverlay(
  ctx: Ctx2D,
  width: number,
  height: number,
  scale: number,
  time: number,
  clip: Clip,
  /** How far it is on (1: all the way). */
  on = 1
): void {
  const fx = clip.ambientFx
  if (!fx || fx.style !== 'living-frame') return
  const amount = Math.min(1, Math.max(0, fx.amount)) * on
  if (amount <= 0) return
  const clock = time - clip.start + (fx.timeOffset ?? 0)
  const phase = ((fx.seed % 997) / 997) * Math.PI * 2
  const breathe = 0.5 + 0.5 * Math.sin(clock * 0.45 + phase)
  const dw = ctx.canvas.width
  const dh = ctx.canvas.height
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  // Soft lens edges: the finished frame, small and blurred, laid back over
  // it through an oval — sharp in the middle, softening towards the edges.
  const sw = Math.max(2, Math.round(dw / 3))
  const sh = Math.max(2, Math.round(dh / 3))
  const small = scratchFor('living-frame:small', sw, sh)
  const sctx = small.getContext('2d')!
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.globalCompositeOperation = 'source-over'
  sctx.filter = 'none'
  sctx.clearRect(0, 0, sw, sh)
  sctx.drawImage(ctx.canvas, 0, 0, dw, dh, 0, 0, sw, sh)
  const soft = blurredCopy('living-frame:soft', small, sw, sh, sw, sh, Math.min(sw, sh) * (0.01 + 0.016 * amount))
  const softCtx = soft.getContext('2d')!
  softCtx.save()
  softCtx.globalCompositeOperation = 'destination-in'
  softCtx.translate(sw / 2, sh / 2)
  softCtx.scale(sw / 2, sh / 2)
  const oval = softCtx.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2)
  const edge = Math.min(1, 0.75 + 0.25 * amount)
  oval.addColorStop(0, 'rgba(0,0,0,0)')
  oval.addColorStop(0.55, 'rgba(0,0,0,0)')
  oval.addColorStop(0.85, `rgba(0,0,0,${(edge * 0.75).toFixed(3)})`)
  oval.addColorStop(1, `rgba(0,0,0,${edge.toFixed(3)})`)
  softCtx.fillStyle = oval
  softCtx.fillRect(-1, -1, 2, 2)
  softCtx.restore()
  ctx.drawImage(soft, 0, 0, sw, sh, 0, 0, dw, dh)
  // A vignette that breathes a little.
  ctx.save()
  ctx.translate(dw / 2, dh / 2)
  ctx.scale(dw / 2, dh / 2)
  const vig = ctx.createRadialGradient(0, 0, 0.35, 0, 0, Math.SQRT2)
  const dark = amount * (0.34 + 0.08 * breathe)
  vig.addColorStop(0, 'rgba(4,5,10,0)')
  vig.addColorStop(0.55, `rgba(4,5,10,${(dark * 0.35).toFixed(3)})`)
  vig.addColorStop(1, `rgba(4,5,10,${dark.toFixed(3)})`)
  ctx.fillStyle = vig
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
  // A soft light that wanders slowly over the picture, never still.
  const lx = dw * (0.5 + 0.3 * Math.sin(clock * 0.13 + phase))
  const ly = dh * (0.36 + 0.16 * Math.sin(clock * 0.09 + phase * 1.7))
  const lr = Math.max(dw, dh) * 0.5
  const light = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr)
  const a = amount * (0.07 + 0.05 * breathe)
  light.addColorStop(0, `rgba(255,246,228,${a.toFixed(3)})`)
  light.addColorStop(0.5, `rgba(255,240,215,${(a * 0.45).toFixed(3)})`)
  light.addColorStop(1, 'rgba(255,240,215,0)')
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = light
  ctx.fillRect(0, 0, dw, dh)
  ctx.restore()
  void scale
  void width
  void height
}
