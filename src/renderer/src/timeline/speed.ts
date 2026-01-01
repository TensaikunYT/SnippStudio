// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's speed: its range, the shortest a retimed clip may get, and what
// its sound does at a speed (core polish, part B). One place, so the command,
// the model check, the preview engine, the export mix and the Inspector read
// the same numbers. Pure.
import type { Clip } from '../types'

/** The slowest and the fastest a clip plays. */
export const SPEED_MIN = 0.1
export const SPEED_MAX = 100

/** `speed` held to the range (1 for what is not a number). */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed))
}

/** The shortest a clip may be left by a speed change: one frame of the film. */
export function minClipLength(fps: number): number {
  return 1 / Math.max(1, Number.isFinite(fps) && fps > 0 ? fps : 30)
}

/**
 * The fastest a clip showing `mediaLen` seconds of media may play so that it
 * still lasts one frame — never slower than it plays now (`current`): a clip
 * already shorter than a frame is not slowed down by asking for more.
 */
export function fastestFor(mediaLen: number, current: number, fps: number): number {
  return Math.max(current, mediaLen / minClipLength(fps))
}

/** Sound is heard from this speed … */
export const AUDIBLE_MIN = 0.25
/** … up to this one; slower or faster, a clip is silent (preview and export). */
export const AUDIBLE_MAX = 8

/** Whether a clip playing at `speed` (media seconds per timeline second, a
 *  compound's speed already in it) is heard at all. */
export function speedAudible(speed: number): boolean {
  const s = Math.abs(speed)
  return s >= AUDIBLE_MIN - 1e-9 && s <= AUDIBLE_MAX + 1e-9
}

/** Whether a clip's sound keeps its pitch when the clip is retimed (the
 *  default; off: the pitch follows the speed, as a tape would). */
export function keepsPitch(clip: Pick<Clip, 'keepPitch'>): boolean {
  return clip.keepPitch !== false
}

/** What a media element plays by itself (Chromium refuses a playbackRate
 *  outside this); beyond it the preview steps through the frames. */
export const PLAYABLE_MIN = 0.0625
export const PLAYABLE_MAX = 16

export function elementPlayable(rate: number): boolean {
  const r = Math.abs(rate)
  return r >= PLAYABLE_MIN && r <= PLAYABLE_MAX
}

/** How loud a clip is heard at an instant of a speed curve, playing at
 *  `rate` (core polish C): 1 inside the audible range, 0 well outside it,
 *  and between, over 6 % of speed either side of each limit, a short fade —
 *  so a curve crossing 8x fades out rather than clicks off. The preview and
 *  the export alike. (A clip at one speed keeps the hard rule, speedAudible.) */
export function audibleGain(rate: number): number {
  const r = Math.abs(rate)
  if (!(r > 0)) return 0
  const edge = Math.log(1.06)
  const below = Math.log(r / AUDIBLE_MIN) / edge
  const above = Math.log(AUDIBLE_MAX / r) / edge
  return Math.min(1, Math.max(0, 1 + Math.min(below, above)))
}
