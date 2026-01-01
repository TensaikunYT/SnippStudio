// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which media a piece of a clip shows (phase Ç2b.1, decision 4; report L3 =
// 4A's K-2). A clip shows its media from `inPoint` on, `speed` media
// seconds per timeline second — forwards, or backwards when `reversed`
// (then its first frame on screen is the media's LAST one it uses), or one
// held frame (`freeze`). Every edit that keeps part of a clip (split, the
// two trims, a ripple cut, keep-range, the silence cut, freeze frame) asks
// here for the kept part's in point, so a kept frame stays where it was.
// Along a speed curve (core polish C, timeline/speed-curve.ts) the same
// questions are answered by the curve.
// Pure.
import type { Clip } from '../types'
import { curveLocalAt, curveMediaAt, curvePart, curveSpan, hasCurve } from './speed-curve'

type Timed = Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'freeze' | 'speedCurve'>

/** The in point of the part of `clip` between clip-local timeline seconds
 *  `keepFrom` and `keepTo` (either may lie outside [0, duration]: a trim
 *  that reveals more media). */
export function inPointFor(clip: Timed, keepFrom: number, keepTo: number): number {
  // A held frame shows `freeze` wherever it is cut.
  if (clip.freeze !== undefined) return clip.inPoint
  // Along a speed curve: where the kept part's media begins.
  const part = hasCurve(clip) ? curvePart(clip, keepFrom, keepTo) : null
  if (part) return part.inPoint
  const speed = clip.speed ?? 1
  // Backwards: the media's end plays first, so what is kept at the clip's
  // tail decides where the kept media begins.
  if (clip.reversed) return clip.inPoint + (clip.duration - keepTo) * speed
  return clip.inPoint + keepFrom * speed
}

/** The in point AND speed of the part of `clip` between clip-local seconds
 *  `keepFrom` and `keepTo`: along a speed curve the part has its own
 *  average speed; otherwise it keeps the clip's. */
export function partOf(clip: Timed, keepFrom: number, keepTo: number): { inPoint: number; speed: number | undefined } {
  const part = hasCurve(clip) ? curvePart(clip, keepFrom, keepTo) : null
  if (part) return part
  return { inPoint: inPointFor(clip, keepFrom, keepTo), speed: clip.speed }
}

/** `target` (a piece of `clip`, or `clip` itself) made the part of `clip`
 *  between clip-local seconds `keepFrom` and `keepTo`: its in point, and
 *  along a speed curve its own average speed. (Read before anything of
 *  `clip` changes.) Without a curve: only the in point, as before. */
export function takePart(target: Pick<Clip, 'inPoint' | 'speed'>, clip: Timed, keepFrom: number, keepTo: number): void {
  const part = hasCurve(clip) ? curvePart(clip, keepFrom, keepTo) : null
  if (part) {
    target.inPoint = part.inPoint
    target.speed = part.speed
    return
  }
  target.inPoint = inPointFor(clip, keepFrom, keepTo)
}

/** The media second `clip` shows at clip-local timeline second `local`
 *  (no speed ramp at a cut; the edit's view of the clip). */
export function mediaAtLocal(clip: Timed, local: number): number {
  if (clip.freeze !== undefined) return clip.freeze
  const curved = curveMediaAt(clip, local)
  if (curved) return curved.time
  const speed = clip.speed ?? 1
  return clip.reversed ? clip.inPoint + (clip.duration - local) * speed : clip.inPoint + local * speed
}

/** The clip-local second `clip` shows media second `m` at (the inverse of
 *  mediaAtLocal; a freeze frame: its start). */
export function localAtMedia(clip: Timed, m: number): number {
  if (clip.freeze !== undefined) return 0
  const curved = curveLocalAt(clip, m)
  if (curved !== null) return curved
  const speed = clip.speed ?? 1
  return clip.reversed ? clip.duration - (m - clip.inPoint) / speed : (m - clip.inPoint) / speed
}

/** Timeline seconds a clip's start edge may move left before it runs out of
 *  media (its head handle): for a backwards clip, the media after the part
 *  it uses. `mediaDuration` is the asset's length. */
export function headRoom(clip: Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'speedCurve'>, mediaDuration: number): number {
  const curved = curveRoom(clip, mediaDuration)
  if (curved) return curved[0]
  const speed = clip.speed ?? 1
  if (clip.reversed) return Math.max(0, (mediaDuration - (clip.inPoint + clip.duration * speed)) / speed)
  return Math.max(0, clip.inPoint / speed)
}

/** …and its end edge may move right (its tail handle). */
export function tailRoom(clip: Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'speedCurve'>, mediaDuration: number): number {
  const curved = curveRoom(clip, mediaDuration)
  if (curved) return curved[1]
  const speed = clip.speed ?? 1
  if (clip.reversed) return Math.max(0, clip.inPoint / speed)
  return Math.max(0, (mediaDuration - (clip.inPoint + clip.duration * speed)) / speed)
}

/** A curved clip's head and tail room: the media outside its window, in the
 *  timeline seconds the curve gives it (null: no curve). */
export function curveRoom(clip: Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'speedCurve'>, mediaDuration: number): [number, number] | null {
  const curve = clip.speedCurve
  if (!curve || curve.keys.length === 0) return null
  const end = clip.inPoint + clip.duration * (clip.speed ?? 1)
  const own = curveSpan(curve, clip.inPoint, end)
  const k = clip.duration > 0 && own > 0 ? own / clip.duration : 1
  const before = Math.max(0, curveSpan(curve, 0, Math.max(0, clip.inPoint)) / k)
  const after = Math.max(0, curveSpan(curve, end, Math.max(end, mediaDuration)) / k)
  return clip.reversed ? [after, before] : [before, after]
}
