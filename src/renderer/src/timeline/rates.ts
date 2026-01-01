// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Frame rates (phase Ç3a, decision 4; report R14).
//
// The project and the export offer 23.976, 24, 25, 29.97, 30, 50, 59.94 and
// 60. An NTSC rate is kept as its exact value (30000 / 1001 = 29.97002997…,
// the same number every time it is written and read) and frame times are
// worked out as exact fractions (frame i of 29.97 is at i × 1001 / 30000 s),
// so a 30-minute export has no drift and each frame sits on its tick (the
// file's time base is 1/30000 and r_frame_rate 30000/1001: measured, see
// FAZC3A-PLAN.md). Pure: no DOM.

/** The rates offered, in order. */
export const FRAME_RATES: readonly number[] = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]

/** The NTSC family: n × 1000 / 1001. */
const NTSC_BASES = [24, 30, 48, 60, 120]

/** A rate as an exact fraction { num, den }: 30 → 30/1, 29.97… → 30000/1001,
 *  anything else to a thousandth. */
export function rationalFps(fps: number): { num: number; den: number } {
  const whole = Math.round(fps)
  if (Math.abs(fps - whole) < 1e-9) return { num: whole, den: 1 }
  for (const n of NTSC_BASES) if (Math.abs(fps - (n * 1000) / 1001) < 1e-6) return { num: n * 1000, den: 1001 }
  return { num: Math.round(fps * 1000), den: 1000 }
}

/** A rate snapped to the one it means: 29.97 (or 29.970029…) → 30000/1001,
 *  23.976 → 24000/1001, 59.94 → 60000/1001, 30.0000001 → 30; others as
 *  they are. */
export function snapFps(fps: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return fps
  const whole = Math.round(fps)
  if (Math.abs(fps - whole) < 1e-6) return whole
  for (const n of NTSC_BASES) if (Math.abs(fps - (n * 1000) / 1001) < 0.002) return (n * 1000) / 1001
  return fps
}

/** The time of frame `i` (seconds from 0): exact for NTSC rates. */
export function frameTime(i: number, fps: number): number {
  const { num, den } = rationalFps(fps)
  return (i * den) / num
}

/** The rate as people write it: 29.97, 23.976, 25. */
export function fpsLabel(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : (Math.round(fps * 1000) / 1000).toString()
}

/**
 * The listed rate a source's measured rate is (within 0.05 %), or null (a
 * variable or unusual rate: the project keeps its own). A 29.97 phone file
 * measures 29.97, a 25 fps camera 25.
 */
export function listedRate(measured: number | undefined): number | null {
  if (!measured || !Number.isFinite(measured) || measured <= 0) return null
  // The nearest, within 0.05 % (29.97 and 30 are 0.1 % apart).
  let best: number | null = null
  for (const r of FRAME_RATES) if (Math.abs(measured - r) / r < 0.0005 && (best === null || Math.abs(measured - r) < Math.abs(measured - best))) best = r
  return best
}

/**
 * The rate an empty project takes when its first video comes in (decision
 * 4): that video's, when it is a listed rate; null otherwise. Empty means
 * nothing at all (phase Ç3 patch, G-2): no clip, no file in the project (a
 * video, a sound, a picture, a code film), no subtitle line, no title or
 * template. A rate picked by hand in a project that has anything stays.
 */
export function firstVideoRate(
  project: { clips: Record<string, unknown>; assets: readonly { kind: string }[]; captions?: readonly unknown[]; templates?: readonly unknown[]; unknownTemplates?: readonly unknown[] },
  added: readonly { kind: string; fps?: number; missing?: boolean }[]
): number | null {
  if (Object.keys(project.clips).length > 0) return null
  if (project.assets.length > 0) return null
  if ((project.captions?.length ?? 0) > 0 || (project.templates?.length ?? 0) > 0 || (project.unknownTemplates?.length ?? 0) > 0) return null
  const first = added.find((a) => a.kind === 'video' && !a.missing)
  return first ? listedRate(first.fps) : null
}
