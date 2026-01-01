// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The entries of a render list drawn onto a frame (moved out of renderFrame
// in phase Ç2b.2: a compound clip draws its children the same way, decision
// 5): adjustment layers, the transitions' reveals and glows, and the real
// cross-mix of a dissolve (decision 2).
import type { Clip, Project } from '../../types'
import { burnGlow, seedOf } from '../../effects/film-burn'
import { applyWorldTransform, isAdjustmentClip } from './core'
import type { Ctx2D, SourceResolver } from './core'
import type { RenderEntry } from './timing'
import { applyAdjustmentLayer } from './pixel-fx'
import { drawClip, drawEntryThroughScratch, drawRampWithMotionBlur, drawLivingFrameOverlay, mayLetThrough } from './clip'
import { assetById } from '../../types'
import { filmHasAlpha } from '../../media/film-alpha'
import { clipMediaAt } from './timing'
import { scratchFor } from './scratch'

export function drawEntries(
  ctx: Ctx2D,
  project: Project,
  entries: readonly RenderEntry[],
  time: number,
  resolve: SourceResolver,
  scale: number,
  opts: { livingClip?: Clip | null; key?: string } = {}
): void {
  const { width, height } = project.settings
  const livingClip = opts.livingClip ?? null
  /** One entry onto `target` (the frame, or a mix pair's surface). */
  const drawEntry = (target: Ctx2D, entry: RenderEntry): void => {
    // A soft-edged reveal needs the clip on a surface of its own before a
    // piece can be taken out of it: erasing straight onto the frame would eat
    // the shot underneath as well.
    //
    // NOT a `continue`: the light sweep's own bar is drawn at the bottom of
    // this loop, and skipping to the next entry would leave the sweep with no
    // light in it.
    // A dip to black darkens the clip's own pixels, on a surface of its own.
    const viaScratch = entry.softFrom !== undefined || entry.burn !== undefined || (entry.dip !== undefined && entry.dip > 0 && entry.alpha > 0)
    if (viaScratch) drawEntryThroughScratch(target, project, entry, time, resolve, scale)
    const needsFx =
      entry.wipe !== undefined ||
      entry.wipeFrom !== undefined ||
      entry.irisHole !== undefined ||
      entry.dy !== undefined ||
      (entry.zoomFx !== undefined && entry.zoomFx !== 1)
    if (needsFx && !viaScratch) {
      target.save()
      if (entry.wipe !== undefined) {
        // Wipe: only the left portion of the frame stays visible.
        target.beginPath()
        target.rect(0, -height, width * entry.wipe, height * 3)
        target.clip()
      }
      if (entry.wipeFrom !== undefined) {
        // The mirror of a wipe: everything the sweep has already passed is gone.
        target.beginPath()
        target.rect(width * entry.wipeFrom, -height, width * 2, height * 3)
        target.clip()
      }
      if (entry.irisHole !== undefined) {
        // A hole in this clip, through which the shot underneath shows. Radius
        // runs to the half-diagonal so the corners clear at the very end.
        const r = entry.irisHole * Math.hypot(width, height) * 0.5
        target.beginPath()
        target.rect(-width, -height, width * 3, height * 3)
        target.arc(width / 2, height / 2, Math.max(0.01, r), 0, Math.PI * 2)
        target.clip('evenodd')
      }
      if (entry.dy) target.translate(0, entry.dy)
      if (entry.zoomFx !== undefined && entry.zoomFx !== 1) {
        target.translate(width / 2, height / 2)
        target.scale(entry.zoomFx, entry.zoomFx)
        target.translate(-width / 2, -height / 2)
      }
    }
    if (!viaScratch && entry.motionBlur && Math.hypot(entry.motionBlur.dx, entry.motionBlur.dy) * scale > 0.75) {
      drawRampWithMotionBlur(target, project, entry, time, resolve, scale)
    } else if (!viaScratch) {
      drawClip(
        target,
        project,
        entry.clip,
        time,
        resolve,
        entry.alpha,
        entry.dx ?? 0,
        scale,
        entry.blurFx ?? 0,
        entry.suppressEdgeMotion
      )
    }
    if (needsFx && !viaScratch) target.restore()
  }
  /** The light an entry casts over both shots (a sweep's bar, a burn's
   *  glow, a leak): onto the frame, after the pair it belongs to. */
  const drawGlows = (target: Ctx2D, entry: RenderEntry): void => {
    // The light sweep's own bar, over both shots: a warm core with a wide soft
    // falloff, brightest at the middle of the cut and gone by the end of it.
    if (entry.flash !== undefined) {
      const f = entry.flash
      // Eased in and out rather than a plain sine: the light arrives before it
      // is bright and leaves after it has stopped being bright, which is the
      // difference between a glow and a slab.
      const s0 = Math.sin(Math.PI * Math.min(1, Math.max(0, f)))
      const heat = s0 * s0
      if (heat > 0.005) {
        target.save()
        applyWorldTransform(target, scale)
        target.globalCompositeOperation = 'screen'
        target.transform(1, 0, width * 0.16 / height, 1, -width * 0.08, 0)
        const x = width * (-0.3 + f * 1.6)
        // Wide and mostly falloff. The old bar was a sixth of the frame with a
        // hot line down the middle of it, which is why it read as a slab of
        // colour crossing the shot instead of light burning through it.
        const half = width * 0.25
        const grad = target.createLinearGradient(x - half, 0, x + half, 0)
        grad.addColorStop(0, 'rgba(255, 190, 90, 0)')
        grad.addColorStop(0.26, `rgba(255, 186, 96, ${(0.1 * heat).toFixed(3)})`)
        grad.addColorStop(0.42, `rgba(255, 214, 146, ${(0.34 * heat).toFixed(3)})`)
        grad.addColorStop(0.5, `rgba(255, 244, 214, ${(0.62 * heat).toFixed(3)})`)
        grad.addColorStop(0.58, `rgba(255, 214, 146, ${(0.34 * heat).toFixed(3)})`)
        grad.addColorStop(0.74, `rgba(255, 186, 96, ${(0.1 * heat).toFixed(3)})`)
        grad.addColorStop(1, 'rgba(255, 190, 90, 0)')
        target.fillStyle = grad
        target.fillRect(x - half, -height, half * 2, height * 3)
        target.restore()
      }
    }

    if (entry.burn !== undefined) {
      // The burn's own light, over both shots.
      target.save()
      applyWorldTransform(target, scale)
      burnGlow(target, seedOf(entry.clip.id), Math.min(1, Math.max(0, entry.burn)), width, height, scale)
      target.restore()
      applyWorldTransform(target, scale)
    }

    if (entry.lightLeak !== undefined) {
      const f = Math.min(1, Math.max(0, entry.lightLeak))
      const heat = Math.sin(Math.PI * f) ** 2
      if (heat > 0.004) {
        target.save()
        applyWorldTransform(target, scale)
        target.globalCompositeOperation = 'lighter'
        const x = width * (-0.05 + f * 1.1)
        const y = height * (0.22 + 0.18 * Math.sin(f * Math.PI))
        const radius = Math.max(width, height) * 0.75
        const glow = target.createRadialGradient(x, y, 0, x, y, radius)
        glow.addColorStop(0, `rgba(255,248,217,${(0.72 * heat).toFixed(3)})`)
        glow.addColorStop(0.26, `rgba(255,174,95,${(0.42 * heat).toFixed(3)})`)
        glow.addColorStop(0.62, `rgba(255,87,120,${(0.18 * heat).toFixed(3)})`)
        glow.addColorStop(1, 'rgba(255,66,96,0)')
        target.fillStyle = glow
        target.fillRect(0, 0, width, height)
        target.restore()
      }
    }
  }
  // A real cross-mix (phase Ç2b.2, decision 2): the incoming half on a
  // transparent surface of the track's own, the outgoing half added to it,
  // then the pair laid over the frame.
  const dw = Math.max(2, Math.round(width * scale))
  const dh = Math.max(2, Math.round(height * scale))
  const surface = (name: string): { cv: HTMLCanvasElement; c: Ctx2D } => {
    const cv = scratchFor(`${opts.key ?? ''}${name}`, dw, dh)
    const c = cv.getContext('2d')! as unknown as Ctx2D
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
    c.filter = 'none'
    c.clearRect(0, 0, dw, dh)
    applyWorldTransform(c, scale)
    return { cv, c }
  }
  /** Does this entry's picture let the tracks under it through (a code film
   *  with alpha, an alpha video, a still with alpha)? Its transition's light
   *  is then kept to it (5a/5b patch, audit S-6). A compound is not read here:
   *  its light stays as it was. */
  const clearPicture = (entry: RenderEntry): boolean => {
    const c = entry.clip
    if (c.nested) return false
    const a = assetById(project, c.assetId)
    if (!a) return false
    if (a.kind === 'code') return filmHasAlpha(a)
    if (a.kind === 'video') return !!a.alpha
    if (a.kind !== 'image') return false
    const src = resolve(c, a, clipMediaAt(project, c, time).time)
    return !!src && mayLetThrough(a, src)
  }
  const hasGlow = (entry: RenderEntry): boolean => entry.flash !== undefined || entry.burn !== undefined || entry.lightLeak !== undefined
  /** The entry's light, kept to the picture on `mask` (its alpha, weighted):
   *  drawn on a surface of its own, cut to the mask, laid on the frame as it
   *  would have been drawn on it. */
  const glowWithin = (entry: RenderEntry, mask: HTMLCanvasElement): void => {
    const g = surface(`glow:${entry.clip.trackId}`)
    drawGlows(g.c, entry)
    g.c.save()
    g.c.setTransform(1, 0, 0, 1, 0, 0)
    g.c.globalAlpha = 1
    g.c.globalCompositeOperation = 'destination-in'
    g.c.drawImage(mask, 0, 0)
    g.c.restore()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.globalCompositeOperation = entry.lightLeak !== undefined && entry.flash === undefined && entry.burn === undefined ? 'lighter' : 'screen'
    ctx.drawImage(g.cv, 0, 0)
    ctx.restore()
    applyWorldTransform(ctx, scale)
  }
  let pair: { cv: HTMLCanvasElement; c: Ctx2D; trackId: string; clear: boolean } | null = null
  const layPair = (): void => {
    if (!pair) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.filter = 'none'
    ctx.drawImage(pair.cv, 0, 0)
    ctx.restore()
    applyWorldTransform(ctx, scale)
    pair = null
  }
  for (const [entryIndex, entry] of entries.entries()) {
    // An adjustment layer re-grades the composite built so far, then the loop
    // carries on with the clips above it.
    if (isAdjustmentClip(entry.clip)) {
      applyAdjustmentLayer(ctx, entry.clip, time, width, height, scale, entry.alpha)
      // The layer resets the transform, so restore the camera for later clips.
      applyWorldTransform(ctx, scale)
      continue
    }
    if (pair && entry.clip.trackId !== pair.trackId) layPair()
    if (entry.mix === 'in') {
      layPair()
      const sf = surface(`mix-in:${entry.clip.trackId}`)
      drawEntry(sf.c, entry)
      pair = { ...sf, trackId: entry.clip.trackId, clear: clearPicture(entry) }
    } else if (entry.mix === 'out' && pair && pair.trackId === entry.clip.trackId) {
      const sf = surface(`mix-out:${entry.clip.trackId}`)
      drawEntry(sf.c, entry)
      pair.c.save()
      pair.c.setTransform(1, 0, 0, 1, 0, 0)
      pair.c.globalAlpha = 1
      pair.c.globalCompositeOperation = 'lighter'
      pair.c.drawImage(sf.cv, 0, 0)
      pair.c.restore()
      // Light over a pair that lets the tracks under it through: kept to
      // the pair (both shots), not the whole frame.
      const keep = hasGlow(entry) && (pair.clear || clearPicture(entry)) ? pair.cv : null
      layPair()
      if (keep) glowWithin(entry, keep)
      else drawGlows(ctx, entry)
    } else if (hasGlow(entry) && clearPicture(entry)) {
      // The picture as always; its light kept to it (its alpha drawn on a
      // surface of its own for that).
      drawEntry(ctx, entry)
      const sf = surface(`glow-pic:${entry.clip.trackId}`)
      drawEntry(sf.c, entry)
      glowWithin(entry, sf.cv)
    } else {
      drawEntry(ctx, entry)
      drawGlows(ctx, entry)
    }
    if (livingClip && entry.clip.trackId === livingClip.trackId &&
        entries[entryIndex + 1]?.clip.trackId !== livingClip.trackId) {
      drawLivingFrameOverlay(ctx, width, height, scale, time, livingClip)
      applyWorldTransform(ctx, scale)
    }
  }

  layPair()
}
