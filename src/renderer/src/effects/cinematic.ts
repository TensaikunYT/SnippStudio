// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { MotionFx, Project } from '../types'

export type GentlePanDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'bottom-to-top'
  | 'top-to-bottom'
  | 'alternate-horizontal'
  | 'alternate-vertical'
  | 'mixed'

/** Deterministic PRNG so preview and export produce identical motion. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

interface ChainParams {
  seed: number
  zoomA: number
  zoomB: number
  panX: number
  panY: number
  shakeAmp: number
  shakeRotAmp: number
  shakeSpeed: number
}

/** Draws the shared motion parameters for one continuous chain of clips. */
function chainParams(chainIndex: number, intensity: number, project: Project, sharedSeed?: number): ChainParams {
  const seed = sharedSeed ?? ((Math.random() * 2 ** 31) | 0)
  const rand = mulberry32(seed ^ 0x9e3779b9)
  const { width, height } = project.settings
  const scaleRef = height / 1080

  // Deliberately gentle defaults — a slow creep, not a lunge.
  const zoomAmount = (0.025 + rand() * 0.02) * intensity
  const zoomIn = (chainIndex + (rand() < 0.18 ? 1 : 0)) % 2 === 0
  const panX = (rand() - 0.5) * 0.03 * width * intensity
  const panY = (rand() - 0.5) * 0.024 * height * intensity
  const shakeAmp = (1.1 + rand() * 1.5) * scaleRef * intensity
  const shakeRotAmp = (0.05 + rand() * 0.08) * intensity

  // Keep the media covering the frame for the whole move: the minimum zoom
  // must provide at least as much slack as the drift + shake + rotation can
  // consume, otherwise the picture slides off and exposes the frame edge.
  const rotSlack = Math.sin((shakeRotAmp * Math.PI) / 180) * (Math.max(width, height) / 2)
  const needX = (Math.abs(panX) / 2 + shakeAmp + rotSlack) / (width / 2)
  const needY = (Math.abs(panY) / 2 + shakeAmp + rotSlack) / (height / 2)
  const baseZoom = 1 + Math.max(needX, needY) * 1.15

  return {
    seed,
    zoomA: zoomIn ? baseZoom : baseZoom + zoomAmount,
    zoomB: zoomIn ? baseZoom + zoomAmount : baseZoom,
    panX,
    panY,
    shakeAmp,
    shakeRotAmp,
    shakeSpeed: 0.3 + rand() * 0.35
  }
}

/** Single-clip motion (a chain of one). */
export function generateMotionFx(index: number, intensity: number, project: Project): MotionFx {
  const p = chainParams(index, intensity, project)
  return {
    enabled: true,
    zoomFrom: p.zoomA,
    zoomTo: p.zoomB,
    panX: p.panX,
    panY: p.panY,
    shakeAmp: p.shakeAmp,
    shakeRotAmp: p.shakeRotAmp,
    shakeSpeed: p.shakeSpeed,
    seed: p.seed,
    ease: 'smooth'
  }
}

/**
 * A clean editorial drift with no handheld shake or zoom animation.
 *
 * This intentionally lives beside (rather than inside) Cinematize so the
 * established randomized look remains unchanged. `amountPercent` is total
 * travel as a percentage of the project axis. The small fixed overscan keeps
 * the frame covered at both ends of the move.
 */
export function generateGentlePanMotion(
  index: number,
  direction: GentlePanDirection,
  amountPercent: number,
  project: Project,
  sequenceSeed = 0x4d495845
): MotionFx {
  const amount = Math.min(10, Math.max(0.25, amountPercent)) / 100
  let resolved = direction
  if (direction === 'alternate-horizontal') resolved = index % 2 === 0 ? 'left-to-right' : 'right-to-left'
  if (direction === 'alternate-vertical') resolved = index % 2 === 0 ? 'bottom-to-top' : 'top-to-bottom'
  if (direction === 'mixed') resolved = mixedGentlePanDirection(index, sequenceSeed)

  let panX = 0
  let panY = 0
  if (resolved === 'left-to-right') panX = project.settings.width * amount
  if (resolved === 'right-to-left') panX = -project.settings.width * amount
  if (resolved === 'bottom-to-top') panY = -project.settings.height * amount
  if (resolved === 'top-to-bottom') panY = project.settings.height * amount

  const overscan = 1 + amount * 1.08
  return {
    enabled: true,
    zoomFrom: overscan,
    zoomTo: overscan,
    panX,
    panY,
    panFrom: -0.5,
    panTo: 0.5,
    shakeAmp: 0,
    shakeRotAmp: 0,
    shakeSpeed: 0.3,
    seed: (0x51f15e ^ Math.imul(index + 1, 0x9e3779b1)) | 0,
    ease: 'smooth'
  }
}

const isLegacyGentleMotion = (fx?: MotionFx): boolean =>
  !!fx &&
  fx.gentlePanX === undefined &&
  fx.gentlePanY === undefined &&
  fx.gentleZoom === undefined &&
  fx.enabled &&
  Math.abs(fx.zoomFrom - fx.zoomTo) < 1e-6 &&
  fx.shakeAmp === 0 &&
  fx.shakeRotAmp === 0 &&
  (Math.abs(fx.panX) > 1e-6 || Math.abs(fx.panY) > 1e-6)

const gentleLayer = (fx?: MotionFx): Pick<MotionFx, 'gentleZoom' | 'gentlePanX' | 'gentlePanY' | 'gentlePanFrom' | 'gentlePanTo'> => {
  if (!fx) return {}
  if (fx.gentlePanX !== undefined || fx.gentlePanY !== undefined || fx.gentleZoom !== undefined) {
    return {
      gentleZoom: fx.gentleZoom,
      gentlePanX: fx.gentlePanX,
      gentlePanY: fx.gentlePanY,
      gentlePanFrom: fx.gentlePanFrom,
      gentlePanTo: fx.gentlePanTo
    }
  }
  // Projects made before the layered format stored a pure Gentle Pan in the
  // main motion fields. Recognise that shape so applying Cinematize upgrades
  // it instead of silently erasing it.
  return isLegacyGentleMotion(fx)
    ? {
        gentleZoom: fx.zoomFrom,
        gentlePanX: fx.panX,
        gentlePanY: fx.panY,
        gentlePanFrom: fx.panFrom ?? -0.5,
        gentlePanTo: fx.panTo ?? 0.5
      }
    : {}
}

/** Adds/replaces only the Gentle Pan layer, preserving Cinematize motion. */
export function mergeGentlePanMotion(current: MotionFx | undefined, gentle: MotionFx): MotionFx {
  const base: MotionFx = current && !isLegacyGentleMotion(current)
    ? { ...current }
    : {
        enabled: true,
        zoomFrom: 1,
        zoomTo: 1,
        panX: 0,
        panY: 0,
        shakeAmp: 0,
        shakeRotAmp: 0,
        shakeSpeed: 0.3,
        seed: gentle.seed,
        ease: 'smooth'
      }
  return {
    ...base,
    enabled: true,
    gentleZoom: gentle.zoomFrom,
    gentlePanX: gentle.panX,
    gentlePanY: gentle.panY,
    gentlePanFrom: gentle.panFrom ?? -0.5,
    gentlePanTo: gentle.panTo ?? 0.5
  }
}

/** Replaces Cinematize while carrying an existing Gentle Pan layer forward. */
export function mergeCinematicMotion(current: MotionFx | undefined, cinematic: MotionFx): MotionFx {
  return { ...cinematic, ...gentleLayer(current) }
}

export function hasGentlePanMotion(fx?: MotionFx): boolean {
  return !!fx && (isLegacyGentleMotion(fx) || fx.gentleZoom !== undefined ||
    fx.gentlePanX !== undefined || fx.gentlePanY !== undefined)
}

export function hasCinematicMotion(fx?: MotionFx): boolean {
  return !!fx && !isLegacyGentleMotion(fx) && (
    fx.shakeAmp !== 0 || fx.shakeRotAmp !== 0 || fx.panX !== 0 || fx.panY !== 0 ||
    fx.zoomFrom !== 1 || fx.zoomTo !== 1
  )
}

/** Remove one batch-motion channel without wiping the other one. */
export function removeMotionLayer(fx: MotionFx | undefined, layer: 'cinematic' | 'gentle'): MotionFx | undefined {
  if (!fx) return undefined
  if (layer === 'cinematic') {
    if (!hasGentlePanMotion(fx)) return undefined
    return { enabled: fx.enabled, zoomFrom: 1, zoomTo: 1, panX: 0, panY: 0,
      shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 0.3, seed: fx.seed,
      ease: 'smooth', ...gentleLayer(fx) }
  }
  if (isLegacyGentleMotion(fx) || !hasCinematicMotion(fx)) return undefined
  const cinematic = { ...fx }
  delete cinematic.gentleZoom
  delete cinematic.gentlePanX
  delete cinematic.gentlePanY
  delete cinematic.gentlePanFrom
  delete cinematic.gentlePanTo
  return cinematic
}

/**
 * A deterministic weighted shuffle for Mixed pan. Horizontal moves dominate,
 * but the exact same direction never appears twice in a row. After a vertical
 * move the next clip strongly prefers horizontal, keeping the sequence varied
 * without making it feel erratic.
 */
function mixedGentlePanDirection(
  index: number,
  seed: number
): Exclude<GentlePanDirection, 'alternate-horizontal' | 'alternate-vertical' | 'mixed'> {
  const rand = mulberry32(seed ^ 0x2f6e2b1)
  let direction: 'left-to-right' | 'right-to-left' | 'bottom-to-top' | 'top-to-bottom' =
    rand() < 0.5 ? 'left-to-right' : 'right-to-left'

  for (let i = 1; i <= Math.max(0, index); i++) {
    const roll = rand()
    if (direction === 'left-to-right') {
      direction = roll < 0.64 ? 'right-to-left' : roll < 0.82 ? 'bottom-to-top' : 'top-to-bottom'
    } else if (direction === 'right-to-left') {
      direction = roll < 0.64 ? 'left-to-right' : roll < 0.82 ? 'top-to-bottom' : 'bottom-to-top'
    } else if (direction === 'bottom-to-top') {
      direction = roll < 0.42 ? 'left-to-right' : roll < 0.84 ? 'right-to-left' : 'top-to-bottom'
    } else {
      direction = roll < 0.42 ? 'right-to-left' : roll < 0.84 ? 'left-to-right' : 'bottom-to-top'
    }
  }
  return direction
}

/**
 * One continuous motion spanning a chain of back-to-back clips: the global
 * eased ramp is sliced per clip (linear within each slice), the pan progress
 * carries across cuts, and the shake clock is offset so it never restarts.
 * The result: one immersive camera move instead of a reset at every cut.
 */
export function generateChainMotion(
  durations: number[],
  chainIndex: number,
  intensity: number,
  project: Project,
  sharedSeed?: number,
  timelineStart = 0
): MotionFx[] {
  if (durations.length === 1) {
    const p = chainParams(chainIndex, intensity, project, sharedSeed)
    return [{ enabled: true, zoomFrom: p.zoomA, zoomTo: p.zoomB, panX: p.panX,
      panY: p.panY, shakeAmp: p.shakeAmp, shakeRotAmp: p.shakeRotAmp,
      shakeSpeed: p.shakeSpeed, seed: p.seed, ease: 'smooth', timeOffset: timelineStart }]
  }
  const p = chainParams(chainIndex, intensity, project, sharedSeed)
  const total = durations.reduce((a, b) => a + b, 0)
  const result: MotionFx[] = []
  let elapsed = 0
  for (const duration of durations) {
    const g0 = smoothstep(elapsed / total)
    const g1 = smoothstep((elapsed + duration) / total)
    result.push({
      enabled: true,
      zoomFrom: p.zoomA + (p.zoomB - p.zoomA) * g0,
      zoomTo: p.zoomA + (p.zoomB - p.zoomA) * g1,
      panX: p.panX,
      panY: p.panY,
      panFrom: g0 - 0.5,
      panTo: g1 - 0.5,
      shakeAmp: p.shakeAmp,
      shakeRotAmp: p.shakeRotAmp,
      shakeSpeed: p.shakeSpeed,
      seed: p.seed,
      ease: 'linear',
      timeOffset: timelineStart + elapsed
    })
    elapsed += duration
  }
  return result
}

export interface MotionSample {
  zoom: number
  offsetX: number
  offsetY: number
  rotation: number
}

const TAU = Math.PI * 2

/**
 * Samples the motion effect at a moment in the clip. Pure and deterministic:
 * the same (fx, tNorm, tAbs) always yields the same transform, which keeps
 * preview and export pixel-identical.
 */
export function sampleMotionFx(fx: MotionFx, tNorm: number, tAbs: number): MotionSample {
  const r = mulberry32(fx.seed)
  const p1 = r() * TAU
  const p2 = r() * TAU
  const p3 = r() * TAU
  const p4 = r() * TAU
  const p5 = r() * TAU

  const t = Math.min(1, Math.max(0, tNorm))
  const s = fx.ease === 'linear' ? t : t * t * (3 - 2 * t)
  const panProgress = (fx.panFrom ?? -0.5) + ((fx.panTo ?? 0.5) - (fx.panFrom ?? -0.5)) * s
  const gentleProgress =
    (fx.gentlePanFrom ?? -0.5) + ((fx.gentlePanTo ?? 0.5) - (fx.gentlePanFrom ?? -0.5)) * s
  const f = fx.shakeSpeed
  const tt = tAbs + (fx.timeOffset ?? 0)

  return {
    zoom: (fx.zoomFrom + (fx.zoomTo - fx.zoomFrom) * s) * (fx.gentleZoom ?? 1),
    offsetX:
      panProgress * fx.panX +
      gentleProgress * (fx.gentlePanX ?? 0) +
      fx.shakeAmp * (0.6 * Math.sin(TAU * f * tt + p1) + 0.4 * Math.sin(TAU * f * 2.7 * tt + p2)),
    offsetY:
      panProgress * fx.panY +
      gentleProgress * (fx.gentlePanY ?? 0) +
      fx.shakeAmp * (0.6 * Math.cos(TAU * f * 1.3 * tt + p3) + 0.4 * Math.sin(TAU * f * 3.1 * tt + p4)),
    rotation: ((fx.shakeRotAmp * Math.PI) / 180) * Math.sin(TAU * f * 0.7 * tt + p5)
  }
}
