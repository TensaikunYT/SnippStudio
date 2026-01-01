// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { drawBackdrop } from './backdrop'
import { wordsFromSubs } from '../templates/model'
import { playerState } from '../templates/player-plan'
import { drawCameraLook } from '../effects/look'
import { JOIN_EPS } from './join'
import { drawTemplates } from '../templates/draw'
import type { Caption, Project } from '../types'
import { channelKfs, templateEnd } from '../types'
import { shortsWindowAt } from './pose'
import { applyWorldTransform } from './draw/core'
import type { Ctx2D, SourceResolver } from './draw/core'
import { renderList } from './draw/timing'
import { drawLookLayers } from './draw/pixel-fx'
import { drawCaptions } from './draw/captions'
import { livingFrameForEntries } from './draw/clip'
import { drawEntries } from './draw/entries'
import { smoothing, withDrawQuality } from './draw/quality'
export { drawClip, livingFrameForEntries } from './draw/clip'
export { seeThroughReads } from '../media/checker'
export { penEase, drawCaptions } from './draw/captions'
export type { BoilOffset } from './draw/captions'
export { ambientPulse } from './draw/still-fx'
export { sampleClipMotion, clipVisualPoseAt } from './draw/motion'
export { lutRegistry } from './draw/pixel-fx'
// (The tests' switch for the pixel pass's CPU path, and its arithmetic.)
export { setPixelFxCpuOnly, pixelFxGpuFrames } from './fxgl'
export { fxParamsFor } from './draw/pixel-fx'
export { traceMaskPath } from './draw/mask'
export { pruneClipScratch } from './draw/scratch'
export { visibleClips, transitionSeam, speedRamp, outgoingTransitionWindow, incomingTransitionInfo, incomingTransition, clipMediaAt, renderList, soundWindows } from './draw/timing'
export type { RenderEntry, TransitionWindow } from './draw/timing'
export { trackerDeltaAt, trackerPosAt, activeClipAtTime, isAdjustmentClip, nestedChildren, activeNestedChildren } from './draw/core'
export type { Ctx2D, SourceResolver, DrawClipOptions } from './draw/core'
export { JOIN_EPS }

// channelKfs lives with the types now (it is a pure accessor, and this module
// touches the DOM at import time, which put it out of reach of the tests).
// Re-exported so the places that already read it from here keep working.
export { channelKfs }
export { captionMotionAt, clipOpacityAt, clipTransformAt, maskGeomAt, shortSegmentAt, shortsWindowAt } from './pose'

/**
 * Renders one output frame. This single function backs both the live preview
 * and the exporter, so what you see is exactly what renders.
 */
export function renderFrame(
  ctx: Ctx2D,
  project: Project,
  time: number,
  resolveFrom: SourceResolver,
  opts: { includeCaptions?: boolean; scale?: number; shortsOverlay?: boolean; quality?: 'draft' | 'final' | 'refine' } = {}
): void {
  // The export and a still draw in final quality (phase Ç3a, decision 1):
  // the canvas's best resampling, looks and effects at the output's width
  // (playback/draw/quality.ts). The preview as it always was.
  withDrawQuality(opts.quality === 'final', ctx.canvas.width, () => {
    smoothing(ctx)
    drawFrame(ctx, project, time, resolveFrom, opts)
  })
}

function drawFrame(
  ctx: Ctx2D,
  project: Project,
  time: number,
  resolveFrom: SourceResolver,
  opts: { includeCaptions?: boolean; scale?: number; shortsOverlay?: boolean }
): void {
  const { width, height } = project.settings
  const scale = opts.scale ?? 1
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  // The canvas: black, or a designed background, under everything.
  drawBackdrop(ctx, project.backdrop, time, width, height, project.mode === 'shorts' ? shortsWindowAt(project, time) : undefined)
  applyWorldTransform(ctx, scale)

  const resolve: SourceResolver = resolveFrom
  const entries = renderList(project, time)
  drawEntries(ctx, project, entries, time, resolve, scale, { livingClip: livingFrameForEntries(entries) })

  const shorts = project.mode === 'shorts' ? shortsWindowAt(project, time) : null

  // Template graphics (the G lane) sit over the footage.
  drawTemplates(
    ctx,
    project,
    time,
    resolve,
    scale,
    shorts ? { left: shorts.cx - shorts.w / 2, width: shorts.w, height } : { left: 0, width, height }
  )

  // Look layers over the graphics too.
  drawLookLayers(ctx, project, time, width, height, scale, 'graphics', shorts ? { left: shorts.cx - shorts.w / 2, width: shorts.w } : undefined)

  // Look layers over all of it, and an older project's whole-picture look
  // (the captions stay clean on top).
  drawLookLayers(ctx, project, time, width, height, scale, 'all', shorts ? { left: shorts.cx - shorts.w / 2, width: shorts.w } : undefined)
  if (project.cameraLook) drawCameraLook(ctx, project.cameraLook, time, width, height, scale, shorts ? { left: shorts.cx - shorts.w / 2, width: shorts.w } : undefined)

  if (shorts && opts.shortsOverlay !== false) {
    // Dim everything outside the 9:16 window and outline it.
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(0, 0, shorts.cx - shorts.w / 2, height)
    ctx.fillRect(shorts.cx + shorts.w / 2, 0, width - (shorts.cx + shorts.w / 2), height)
    ctx.strokeStyle = 'rgba(37,208,194,0.9)'
    ctx.lineWidth = 3
    ctx.strokeRect(shorts.cx - shorts.w / 2, 0, shorts.w, height)
  }

  if (opts.includeCaptions !== false) {
    const capStyle = shorts && project.captionStyleShorts ? project.captionStyleShorts : project.captionStyle
    drawCaptions(
      ctx,
      subtitlesShown(project, time),
      capStyle,
      time,
      width,
      height,
      scale,
      shorts ? { centerX: shorts.cx, width: shorts.w } : undefined,
      project.trackers
    )
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// Big words set the narration on the screen themselves: the subtitles under
// them step aside (unless the block keeps them).
const withoutSubs = new WeakMap<object, Caption[]>()
export function subtitlesShown(project: Project, time: number): Caption[] {
  const big = project.templates?.some(
    (b) =>
      time >= b.start &&
      time < templateEnd(b) &&
      ((b.kind === 'words' && !b.keepSubs && wordsFromSubs(project, b)) || (b.kind === 'player' && playerState(b, time - b.start).cc))
  )
  if (!big) return project.captions
  let list = withoutSubs.get(project.captions)
  if (!list) {
    list = project.captions.filter((c) => c.shape || (c.layer ?? 0) !== 0)
    withoutSubs.set(project.captions, list)
  }
  return list
}
