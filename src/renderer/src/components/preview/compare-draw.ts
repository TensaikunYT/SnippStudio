// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Drawing a comparison (ONIZLEME-UYGULA-PLAN.md, K8): the before's sources
// and the two pictures put together on the preview canvas. The preview only:
// the export and the reference frames never come here.
import type { CompareMode } from '../../playback/candidate'
import type { SourceResolver } from '../../playback/render'
import { clipMediaAt } from '../../playback/draw/timing'
import { COMPARE_KEY, requestClipFrame } from '../../playback/scrub'
import type { Project } from '../../types'
import type { CompareLayout, Rect } from './compare'

/**
 * The before's sources. The engine plays the after: a clip of the before at
 * the same source second as the after's clip of the same id is that very
 * element (exact); any other video frame is asked of the decoder under its
 * own key (exact while paused, the latest one it has while playing).
 */
export function compareResolver(resolve: SourceResolver, shown: Project, time: number, used: Set<string>): SourceResolver {
  const half = 0.5 / Math.max(1, shown.settings.fps || 30)
  return (clip, asset, localTime) => {
    if (asset.kind !== 'video') return resolve(clip, asset, localTime)
    const twin = shown.clips[clip.id]
    if (twin && twin.assetId === clip.assetId && time >= twin.start && time < twin.start + twin.duration) {
      if (Math.abs(clipMediaAt(shown, twin, time).time - localTime) < half) return resolve(clip, asset, localTime)
    }
    const key = COMPARE_KEY + clip.id
    used.add(key)
    return requestClipFrame(key, asset, localTime)
  }
}

type Ctx = CanvasRenderingContext2D

const clipTo = (ctx: Ctx, r: Rect): void => {
  ctx.beginPath()
  ctx.rect(r.left, r.top, r.w, r.h)
  ctx.clip()
}

/** The two pictures on the canvas: side by side (each inside its half), the
 *  wipe (before, then after right of the line) or their difference. */
export function drawCompared(ctx: Ctx, mode: CompareMode, after: CanvasImageSource, before: CanvasImageSource, layout: CompareLayout, wipe: number): void {
  const a = layout.after
  const b = layout.before ?? a
  ctx.save()
  if (mode === 'side') {
    ctx.save()
    if (layout.beforeArea) clipTo(ctx, layout.beforeArea)
    ctx.drawImage(before, b.left, b.top, b.w, b.h)
    ctx.restore()
    if (layout.afterArea) clipTo(ctx, layout.afterArea)
    ctx.drawImage(after, a.left, a.top, a.w, a.h)
  } else if (mode === 'wipe') {
    ctx.drawImage(before, b.left, b.top, b.w, b.h)
    const x = a.left + a.w * wipe
    clipTo(ctx, { left: x, top: a.top, w: a.left + a.w - x, h: a.h })
    ctx.drawImage(after, a.left, a.top, a.w, a.h)
  } else {
    ctx.drawImage(before, b.left, b.top, b.w, b.h)
    ctx.globalCompositeOperation = 'difference'
    ctx.drawImage(after, a.left, a.top, a.w, a.h)
  }
  ctx.restore()
}
