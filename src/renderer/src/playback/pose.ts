// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's and a caption's pose at a moment (keyframes interpolated), the
// Shorts crop window: pure functions, moved out of render.ts in SnippStudio
// phase 2A so the commands can use them without the drawing module (which
// touches the DOM when it loads). render.ts re-exports them.
import type { Caption, CaptionKeyframe, CaptionMotion, Clip, FxKey, MaskGeom, MaskKeyframe, PropKeyframe, Project, ShortSegment } from '../types'
import { channelKfs, defaultCaptionMotion } from '../types'
import { evalKeys, evalNumberKeys, smoothstep } from './keys'

// (Every list here is read through playback/keys.ts: phase Ç2c.1, decision 6.)
const smoothKey = (p: number): number => smoothstep(p)

/** The short segment containing `time`, if any. */
export function shortSegmentAt(project: Project, time: number): ShortSegment | null {
  return project.shortSegments?.find((s) => time >= s.start && time <= s.end) ?? null
}

/** The 9:16 shorts crop window at `time`: center x + width, project pixels. */
export function shortsWindowAt(project: Project, time: number): { cx: number; w: number } {
  const { width, height } = project.settings
  const w = (height * 9) / 16
  // A segment containing this time supplies its own pan; the global shorts
  // pan is the fallback (also used inside segments that have no pan yet).
  const seg = shortSegmentAt(project, time)
  const useSeg = seg !== null && (seg.keyframes.length > 0 || seg.baseX !== undefined)
  const kfs = (useSeg ? seg.keyframes : project.shorts?.keyframes) ?? []
  let cx = (useSeg ? seg.baseX : project.shorts?.baseX) ?? project.shorts?.baseX ?? width / 2
  cx = evalKeys(kfs, time, (a, b, t) => a.x + (b.x - a.x) * t, { ease: smoothKey, hold: (k) => k.x }) ?? cx
  return { cx: Math.min(width - w / 2, Math.max(w / 2, cx)), w }
}

/**
 * Where a Short's window is copied from the whole frame drawn at the
 * output's scale `k` (`fullW` wide): its left edge in output pixels, on a
 * whole pixel. Kept inside a frame at least as wide as the window (a
 * rounding pixel); in a project narrower than the window (1080 × 2340, a
 * phone's screen recording) the window starts left of the frame, as the
 * preview has it (phase Ç3 patch, G-3: it was pushed to 0, the picture
 * 194 px left of where the preview shows it).
 */
export function shortsCropX(projectW: number, k: number, outW: number, fullW: number, win: { cx: number; w: number }): number {
  const sx = Math.round((win.cx - win.w / 2) * k)
  if (projectW * k < outW) return sx
  return Math.max(0, Math.min(fullW - outW, sx))
}

/** Interpolates one channel (or returns the base when it has no keyframes). */
function interpChannel(kfs: PropKeyframe[] | undefined, base: number, localTime: number): number {
  return evalNumberKeys(kfs, localTime) ?? base
}

/** Interpolated opacity at a clip-local time (opacity channel → base → 1). */
export function clipOpacityAt(clip: Clip, localTime: number): number {
  return interpChannel(channelKfs(clip, 'opacity'), clip.opacity ?? 1, localTime)
}

/** The clip's transform at a clip-local time — each property animates on its
 *  own channel, falling back to the static transform when unkeyed. */
export function clipTransformAt(clip: Clip, localTime: number): Clip['transform'] {
  const t = clip.transform
  if (!clip.channels) return t
  return {
    x: interpChannel(channelKfs(clip, 'x'), t.x, localTime),
    y: interpChannel(channelKfs(clip, 'y'), t.y, localTime),
    scale: interpChannel(channelKfs(clip, 'scale'), t.scale, localTime),
    rotation: interpChannel(channelKfs(clip, 'rotation'), t.rotation, localTime)
  }
}

/** A keyable effect's own (unkeyed) amount: glow, halation, the mosaic's cell,
 *  colour isolate ("cila" part D). */
export function fxBase(clip: Clip, key: FxKey): number {
  return (key === 'bloom' ? clip.bloom?.amount : key === 'halation' ? clip.halation?.amount : key === 'mosaic' ? clip.mosaic : clip.isolate?.amount) ?? 0
}

/** That amount at a clip-local time: its keys when it has them, else its own. */
export function fxAmountAt(clip: Clip, key: FxKey, localTime: number): number {
  return evalNumberKeys(clip.fxKeys?.[key], localTime) ?? fxBase(clip, key)
}

/** Interpolated mask geometry at a clip-local time. */
export function maskGeomAt(mask: NonNullable<Clip['mask']>, localTime: number): MaskGeom {
  const plain = (g: MaskGeom): MaskGeom => ({ cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot, points: g.points })
  const blend = (a: MaskKeyframe, b: MaskKeyframe, t: number): MaskGeom => {
    const lerp = (x: number, y: number) => x + (y - x) * t
    const points =
      a.points && b.points && a.points.length === b.points.length
        ? a.points.map((p, i2) => ({ x: lerp(p.x, b.points![i2].x), y: lerp(p.y, b.points![i2].y) }))
        : (a.points ?? b.points)
    return {
      cx: lerp(a.cx, b.cx),
      cy: lerp(a.cy, b.cy),
      w: lerp(a.w, b.w),
      h: lerp(a.h, b.h),
      rot: lerp(a.rot ?? 0, b.rot ?? 0),
      points
    }
  }
  // (A mask's shapes always ease smoothly.)
  return evalKeys(mask.keyframes, localTime, blend, { ease: smoothKey, hold: plain }) ?? plain(mask)
}

/**
 * A caption's motion at `local` seconds from its start: its keyframes when it
 * has them, its static offsets otherwise. Eased with the same smoothstep the
 * rest of the app animates with, so a text moves like everything else does.
 */
export function captionMotionAt(caption: Caption, local: number): CaptionMotion {
  const plain = (k: CaptionMotion): CaptionMotion => ({ x: k.x, y: k.y, scale: k.scale, rot: k.rot, opacity: k.opacity })
  const blend = (a: CaptionKeyframe, b: CaptionKeyframe, e: number): CaptionMotion => ({
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    scale: a.scale + (b.scale - a.scale) * e,
    rot: a.rot + (b.rot - a.rot) * e,
    opacity: a.opacity + (b.opacity - a.opacity) * e
  })
  // (Read in time order whatever order the list has: report K25.)
  return evalKeys(caption.kfs, local, blend, { ease: smoothKey, hold: plain }) ?? caption.motion ?? defaultCaptionMotion()
}
