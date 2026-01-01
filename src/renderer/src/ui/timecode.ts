// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A time typed into the clock (G, or a click on it): the idea is VideoHub's
// review page (ui/review/transport.js parseTime), the forms are ours
// (ONIZLEME-UYGULA-PLAN.md, K2). Pure: the tests drive it.

/** The frame a time is in (a hair of tolerance so 0.1 × 3 is frame 3 at 30). */
export const frameOf = (t: number, fps: number): number => Math.max(0, Math.floor(t * fps + 1e-6))

/** The playhead `n` frames from `t`, on the frame grid (never below 0). */
export function stepFrame(t: number, fps: number, n: number): number {
  const f = fps > 0 ? fps : 30
  // From the frame the playhead shows: a playhead between two frames (put
  // there by a drag) lands on a frame with the first step.
  return Math.max(0, frameOf(t, f) + n) / f
}

/**
 * The time a typed text means, in timeline seconds at the start of its
 * frame, or null when it is not a time.
 *
 * - `1:23.45` minutes and seconds; `1:02:03.5` hours, minutes, seconds (the
 *   clock writes that past an hour: ui/format.ts fmtTime)
 * - `83.4`, `83,4`, `83s`: seconds (a comma is a decimal mark)
 * - `k1234`, `f1234`, `#1234`: a frame
 * - `+2`, `-0.5`: seconds from `now`; `+10f`, `-3k`: frames from `now`
 */
export function parseTime(text: string, fps: number, now = 0): number | null {
  const v = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
  if (!v) return null
  const f = fps > 0 ? fps : 30
  const cur = Number.isFinite(now) ? now : 0
  const at = (frame: number): number => Math.max(0, frame) / f
  // A number: "12", "12.5", "12." or ".5".
  const num = String.raw`(\d+(?:\.\d*)?|\.\d+)`
  let m: RegExpMatchArray | null
  if ((m = v.match(new RegExp(`^([+-])${num}([fk#])?$`)))) {
    const sign = m[1] === '-' ? -1 : 1
    const n = Number(m[2])
    if (m[3]) return Number.isInteger(n) ? at(frameOf(cur, f) + sign * n) : null
    return at(frameOf(Math.max(0, cur + sign * n), f))
  }
  if ((m = v.match(/^[kf#](\d+)$/))) return at(Number(m[1]))
  if ((m = v.match(new RegExp(String.raw`^(\d+):(\d{1,2}):` + num + '$')))) {
    const mm = Number(m[2])
    const ss = Number(m[3])
    if (mm >= 60 || ss >= 60) return null
    return at(frameOf(Number(m[1]) * 3600 + mm * 60 + ss, f))
  }
  if ((m = v.match(new RegExp(String.raw`^(\d+):` + num + '$')))) {
    const ss = Number(m[2])
    return ss < 60 ? at(frameOf(Number(m[1]) * 60 + ss, f)) : null
  }
  if ((m = v.match(new RegExp(`^${num}s?$`)))) return at(frameOf(Number(m[1]), f))
  return null
}
