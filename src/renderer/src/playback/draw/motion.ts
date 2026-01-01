// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's motion: entrance and exit animations, idle motion, and its visual
// pose at a time. Moved out of playback/render.ts in SnippStudio phase 2B
// (no change).
import { mulberry32, sampleMotionFx } from '../../effects/cinematic'
import { pictureMoveAt } from '../../motion/picture-moves'
import type { Clip, ClipAnim, Project } from '../../types'
import { assetById } from '../../types'
import { mediaAtLocal } from '../../timeline/media-time'
import { hasCurve } from '../../timeline/speed-curve'
import { clipTransformAt } from '../pose'
import { trackerDeltaAt } from './core'
import { speedRamp, outgoingTransitionWindow, incomingTransitionInfo } from './timing'

// ---------------------------------------------------------------------------
// Clip entrance / exit animation + idle motion.
// ---------------------------------------------------------------------------

export const TAU2 = Math.PI * 2

export interface MotionSampleLite {
  dx: number
  dy: number
  scale: number
  rot: number
  alpha: number
  blur: number
  /** A picture's own moves: squash and stretch (and the turn's
   *  mirroring, in sx). */
  sx?: number
  sy?: number
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * One end of an entrance/exit. `e` runs 0 (fully off) → 1 (settled); `dir` is
 * +1 while entering and -1 while leaving, which flips travel direction so
 * "slide-up" means *in from below* on entry and *out upwards* on exit.
 */
export function animPhase(kind: ClipAnim, e: number, dir: number, W: number, H: number): MotionSampleLite {
  const s: MotionSampleLite = { dx: 0, dy: 0, scale: 1, rot: 0, alpha: 1, blur: 0 }
  const t = Math.min(1, Math.max(0, e))
  const k = easeOutCubic(t)
  const inv = 1 - k
  switch (kind) {
    case 'fade':
      s.alpha = k
      break
    case 'slide-up':
      s.dy = dir * inv * H * 0.35
      s.alpha = k
      break
    case 'slide-down':
      s.dy = -dir * inv * H * 0.35
      s.alpha = k
      break
    case 'slide-left':
      s.dx = dir * inv * W * 0.35
      s.alpha = k
      break
    case 'slide-right':
      s.dx = -dir * inv * W * 0.35
      s.alpha = k
      break
    case 'zoom-in':
      s.scale = 0.75 + 0.25 * k
      s.alpha = k
      break
    case 'zoom-out':
      s.scale = 1.3 - 0.3 * k
      s.alpha = k
      break
    case 'pop':
      s.scale = 0.55 + 0.45 * easeOutBack(t)
      s.alpha = Math.min(1, t * 2.2)
      break
    case 'blur':
      s.blur = inv * 26
      s.alpha = k
      break
    case 'spin':
      s.rot = dir * inv * Math.PI * 0.35
      s.scale = 0.8 + 0.2 * k
      s.alpha = k
      break
    case 'whip':
      s.dx = dir * inv * W * 0.65
      s.blur = inv * 32
      s.alpha = Math.min(1, t * 2.5)
      break
    case 'elastic':
      s.scale = easeOutBack(t)
      s.alpha = Math.min(1, t * 2.2)
      break
    case 'ramp-right':
    case 'ramp-left':
    case 'ramp-down':
    case 'ramp-up': {
      const ramp = speedRamp(t)
      const travel = (1 - ramp) * 1.08
      const sign = kind === 'ramp-right' || kind === 'ramp-down' ? 1 : -1
      if (kind === 'ramp-right' || kind === 'ramp-left') s.dx = -dir * sign * travel * W
      else s.dy = -dir * sign * travel * H
      s.scale = 1 + (1 - ramp) * 0.035
      s.blur = Math.sin(Math.PI * ramp) * Math.min(W, H) * 0.018
      s.alpha = Math.min(1, ramp * 4)
      break
    }
    default:
      break
  }
  return s
}

/** Stable per-clip seed so each clip drifts differently but reproducibly. */
export function hashSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Idle motion. `handheld` is the important one: several low-frequency sine
 * octaves at irrational ratios, so the drift never visibly loops and stays
 * smooth rather than jittery — the slow floaty camera look, not a shake. A
 * touch of extra scale hides the edges the drift would otherwise expose.
 */
export function sampleIdle(
  idle: NonNullable<Clip['idle']>,
  seed: string,
  t: number
): { dx: number; dy: number; rot: number; scale: number } {
  const clipId = seed
  const amt = Math.max(0, idle.amount)
  const sp = Math.max(0.05, idle.speed)
  const r = mulberry32(hashSeed(clipId))
  const p1 = r() * TAU2
  const p2 = r() * TAU2
  const p3 = r() * TAU2
  const p4 = r() * TAU2
  const p5 = r() * TAU2
  const deg = Math.PI / 180

  switch (idle.style) {
    case 'handheld': {
      const f = 0.13 * sp
      const nx =
        0.6 * Math.sin(TAU2 * f * t + p1) +
        0.3 * Math.sin(TAU2 * f * 1.73 * t + p2) +
        0.12 * Math.sin(TAU2 * f * 2.91 * t + p3)
      const ny =
        0.6 * Math.cos(TAU2 * f * 0.87 * t + p4) +
        0.3 * Math.sin(TAU2 * f * 1.51 * t + p5) +
        0.12 * Math.cos(TAU2 * f * 3.17 * t + p1)
      return {
        dx: nx * 24 * amt,
        dy: ny * 19 * amt,
        rot: Math.sin(TAU2 * f * 0.61 * t + p2) * 0.5 * amt * deg,
        scale: 1 + 0.025 * amt
      }
    }
    case 'float': {
      const f = 0.18 * sp
      return {
        dx: Math.sin(TAU2 * f * 0.7 * t + p1) * 6 * amt,
        dy: Math.sin(TAU2 * f * t + p2) * 16 * amt,
        rot: 0,
        scale: 1 + 0.02 * amt
      }
    }
    case 'sway': {
      const f = 0.16 * sp
      return {
        dx: Math.sin(TAU2 * f * t + p1) * 20 * amt,
        dy: 0,
        rot: Math.sin(TAU2 * f * t + p1 + 0.4) * 0.8 * amt * deg,
        scale: 1 + 0.02 * amt
      }
    }
    case 'breathe': {
      const f = 0.12 * sp
      return { dx: 0, dy: 0, rot: 0, scale: 1 + 0.035 * amt * (0.5 + 0.5 * Math.sin(TAU2 * f * t + p1)) }
    }
    default:
      return { dx: 0, dy: 0, rot: 0, scale: 1 }
  }
}

/** Which of a clip's edges a transition owns: its entrance or exit
 *  animation is left out there altogether (phase Ç2b.2, decision 3; report
 *  G3). `true`: both. */
export type OwnedEdges = boolean | { in: boolean; out: boolean }

/** Combined entrance/exit + idle contribution for a clip at `local` seconds. */
export function sampleClipMotion(clip: Clip, local: number, W: number, H: number, suppressEdgeMotion: OwnedEdges = false): MotionSampleLite {
  const out: MotionSampleLite = { dx: 0, dy: 0, scale: 1, rot: 0, alpha: 1, blur: 0 }
  const dur = clip.duration
  const a = clip.anim
  const ownedIn = suppressEdgeMotion === true || (typeof suppressEdgeMotion === 'object' && suppressEdgeMotion.in)
  const ownedOut = suppressEdgeMotion === true || (typeof suppressEdgeMotion === 'object' && suppressEdgeMotion.out)
  if (a && dur > 0 && !(ownedIn && ownedOut)) {
    let inDur = Math.max(0, a.inDur ?? 0.5)
    let outDur = Math.max(0, a.outDur ?? 0.5)
    // A clip trimmed shorter than its own in+out gets them squeezed to fit.
    const total = inDur + outDur
    if (total > dur && total > 0) {
      const f = dur / total
      inDur *= f
      outDur *= f
    }
    const hasIn = !ownedIn && a.in && a.in !== 'none' && inDur > 0
    const hasOut = !ownedOut && a.out && a.out !== 'none' && outDur > 0
    let s: MotionSampleLite | null = null
    if (hasIn && local < inDur) s = animPhase(a.in!, local / inDur, 1, W, H)
    else if (hasOut && local > dur - outDur) s = animPhase(a.out!, (dur - local) / outDur, -1, W, H)
    if (s) {
      out.dx += s.dx
      out.dy += s.dy
      out.scale *= s.scale
      out.rot += s.rot
      out.alpha *= s.alpha
      out.blur += s.blur
    }
  }
  if (clip.idle && clip.idle.style !== 'none' && clip.idle.amount > 0) {
    // Seeded by the ASSET and clocked in MEDIA time, not by the clip and its
    // own local time. Both matter: splitting a clip gives the halves new ids
    // and restarts local time at 0, so a clip-keyed drift snapped back to a
    // different phase at every cut — the drift visibly jumped exactly where the
    // picture didn't. Keyed to the footage, the motion runs straight through a
    // cut, and two pieces of the same take stay in step.
    const i = sampleIdle(
      clip.idle,
      clip.assetId || clip.id,
      hasCurve(clip) ? mediaAtLocal({ ...clip, reversed: false }, local) : clip.inPoint + local * (clip.speed ?? 1)
    )
    out.dx += i.dx
    out.dy += i.dy
    out.rot += i.rot
    out.scale *= i.scale
  }
  return out
}

/** The exact pose used to paint a clip, shared with preview handles and hit tests. */
export function clipVisualPoseAt(
  project: Project,
  clip: Clip,
  time: number,
  suppressEdgeMotion?: boolean
): {
  transform: Clip['transform']
  animation: MotionSampleLite
} {
  const local = time - clip.start
  const base = clipTransformAt(clip, local)
  // A transition that owns an edge takes its animation out WHOLE (phase
  // Ç2b.2, decision 3; report G3): switched off only inside the window, the
  // entrance started half-way at the window's end and the pose jumped. The
  // same for the render, the handles and the hit-tests (whatever the caller
  // passes): an edge is owned when a transition goes out of it or into it.
  void suppressEdgeMotion
  const edgeOwnedByTransition = { in: incomingTransitionInfo(project, clip).duration > 0, out: outgoingTransitionWindow(project, clip).duration > 0 }
  let animation = sampleClipMotion(clip, local, project.settings.width, project.settings.height, edgeOwnedByTransition)
  const fx = clip.motionFx?.enabled && clip.duration > 0
    ? sampleMotionFx(clip.motionFx, local / clip.duration, local)
    : { zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 }
  const tracker = clip.trackerId ? trackerDeltaAt(project, clip.trackerId, time) : { dx: 0, dy: 0 }
  const transform = {
    x: base.x + fx.offsetX + tracker.dx + animation.dx,
    y: base.y + fx.offsetY + tracker.dy + animation.dy,
    scale: base.scale * fx.zoom * animation.scale,
    rotation: base.rotation + fx.rotation + animation.rot
  }
  // Its own moves (enter, walk, hop…), with the motion model's physics.
  if (clip.moves?.actions.length) {
    const asset = clip.nested ? null : assetById(project, clip.assetId)
    const mw = clip.nested ? project.settings.width : asset?.width || 2
    const mh = clip.nested ? project.settings.height : asset?.height || 2
    const mv = pictureMoveAt(project, clip, time, transform, mw, mh)
    if (mv) {
      transform.x = mv.x
      transform.y = mv.y
      transform.scale = mv.scale
      transform.rotation = mv.rotation
      animation = { ...animation, alpha: animation.alpha * mv.alpha, sx: mv.sx, sy: mv.sy }
    }
  }
  return { transform, animation }
}
