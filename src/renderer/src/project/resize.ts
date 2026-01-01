// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { CaptionStyle, Clip, Project } from '../types'
import { KF_CHANNELS } from '../types'

/**
 * Resize the live project canvas without rebuilding the project.
 *
 * Project-space positions use independent X/Y ratios. Visual scale follows
 * the width ratio: that keeps the apparent width of footage and text stable
 * relative to the canvas and, importantly, makes landscape -> portrait ->
 * landscape exactly reversible. Media-local data (crop and mask geometry) is
 * deliberately untouched.
 */
export function resizeProjectCanvas(project: Project, width: number, height: number): boolean {
  const oldWidth = project.settings.width
  const oldHeight = project.settings.height
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    oldWidth <= 0 ||
    oldHeight <= 0 ||
    (width === oldWidth && height === oldHeight)
  ) {
    return false
  }

  const rx = width / oldWidth
  const ry = height / oldHeight
  const scale = rx

  const resizeStyle = (style: CaptionStyle): void => {
    style.fontSize *= scale
    style.outlineWidth *= scale
    if (style.letterSpacing !== undefined) style.letterSpacing *= scale
    if (style.bgRadius !== undefined) style.bgRadius *= scale
    if (style.bgBorder) style.bgBorder.width *= scale
    if (style.shadow) {
      style.shadow.blur *= scale
      style.shadow.dx *= rx
      style.shadow.dy *= ry
    }
  }

  const resizeClip = (clip: Clip): void => {
    clip.transform.x *= rx
    clip.transform.y *= ry
    clip.transform.scale *= scale

    if (clip.channels) {
      for (const channel of KF_CHANNELS) {
        const keyframes = clip.channels[channel]
        if (!keyframes) continue
        const factor = channel === 'x' ? rx : channel === 'y' ? ry : channel === 'scale' ? scale : 1
        if (factor !== 1) for (const keyframe of keyframes) keyframe.value *= factor
      }
    }
    if (clip.motionFx) {
      clip.motionFx.panX *= rx
      clip.motionFx.panY *= ry
      if (clip.motionFx.gentlePanX !== undefined) clip.motionFx.gentlePanX *= rx
      if (clip.motionFx.gentlePanY !== undefined) clip.motionFx.gentlePanY *= ry
      clip.motionFx.shakeAmp *= scale
    }
    if (clip.blur !== undefined) clip.blur *= scale
    for (const child of clip.nested?.clips ?? []) resizeClip(child)
  }

  for (const clip of Object.values(project.clips)) resizeClip(clip)

  // Caption anchors are fractions of the frame, but their motion offsets and
  // typographic sizes are project pixels.
  resizeStyle(project.captionStyle)
  for (const caption of project.captions) {
    if (caption.style) resizeStyle(caption.style)
    if (caption.motion) {
      caption.motion.x *= rx
      caption.motion.y *= ry
    }
    for (const keyframe of caption.kfs ?? []) {
      keyframe.x *= rx
      keyframe.y *= ry
    }
  }

  for (const tracker of project.trackers ?? []) {
    for (const keyframe of tracker.keyframes) {
      keyframe.x *= rx
      keyframe.y *= ry
    }
  }

  // 9:16 crop-window positions live in the source project's X coordinates.
  if (project.shorts) {
    project.shorts.baseX *= rx
    for (const keyframe of project.shorts.keyframes) keyframe.x *= rx
  }
  for (const segment of project.shortSegments ?? []) {
    if (segment.baseX !== undefined) segment.baseX *= rx
    for (const keyframe of segment.keyframes ?? []) keyframe.x *= rx
  }

  project.settings.width = width
  project.settings.height = height
  return true
}
