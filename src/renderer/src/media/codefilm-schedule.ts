// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which frames of a code film the preview asks for, and which one it shows
// (CODE-FILM-CLIP-PLAN.md, D7). Pure: no DOM, no timers, so it is tested.
//
// A code film's frames come back a round trip after they are asked for (the
// page draws in its own process). Paused or scrubbing, the preview asks for
// exactly the playhead's time (with the page's PREP: the export's frame) and
// a newer ask replaces one not started yet. Playing, it asks one round trip
// ahead on the film's frame grid, at most two at a time, and shows the newest
// frame not later than the clock.

export type FrameMode = 'exact' | 'play'

export interface HeldFrame<B> {
  t: number
  w: number
  h: number
  bmp: B
  /** The project state it was drawn for; 0: any. */
  key?: number
  /** Drawn by the page as it was before its code changed (`markOld`): still
   *  shown until a new one comes, never counted as having the frame. */
  old?: true
  /** The page wrote down an error while it drew this frame (phase 5e,
   *  decision 2): kept (it has its moment, so it is not asked again and
   *  again), but the last good frame is shown instead while there is one. */
  bad?: true
}

export interface Asked {
  id: number
  t: number
  w: number
  h: number
  prep: boolean
  key?: number
}

export interface ClipPlan<B> {
  /** Frames received, oldest first (at most RING). */
  frames: HeldFrame<B>[]
  /** Asked and not come back yet, oldest first. */
  asked: Asked[]
  /** Seconds from asking to having, a running average. */
  latency: number
}

export const RING = 3
/** At most this many asks in flight per clip while playing. */
export const PLAY_IN_FLIGHT = 2
const EPS = 1e-6

export function newPlan<B>(): ClipPlan<B> {
  return { frames: [], asked: [], latency: 0.05 }
}

/** The film-frame time at or after t (its grid starts at 0). */
export function gridAfter(t: number, fps: number): number {
  const f = Math.max(1, fps)
  return Math.ceil(t * f - 1e-6) / f
}

/** The frame to show at t, or null when none has come yet. A frame drawn
 *  with an error gives way to the newest good one held (phase 5e: an erring
 *  clip keeps its last good frame in the preview). */
export function pick<B>(plan: ClipPlan<B>, t: number, mode: FrameMode, fps: number, key = 0): HeldFrame<B> | null {
  const f = pickAny(plan, t, mode, fps, key)
  if (!f?.bad) return f
  // The newest good frame of the page as it is now, else of the page before.
  for (const old of [false, true])
    for (let i = plan.frames.length - 1; i >= 0; i--) {
      const g = plan.frames[i]
      if (!g.bad && !!g.old === old) return g
    }
  return f
}

function pickAny<B>(plan: ClipPlan<B>, t: number, mode: FrameMode, fps: number, key = 0): HeldFrame<B> | null {
  const fr = plan.frames
  if (!fr.length) return null
  if (mode === 'play') {
    const limit = t + 0.5 / Math.max(1, fps)
    // The newest frame not later than the clock: of the page as it is now
    // when there is one, else of the page before its code changed.
    for (const old of [false, true]) {
      let best: HeldFrame<B> | null = null
      for (const f of fr) if (!!f.old === old && f.t <= limit + EPS && (!best || f.t > best.t || (f.t === best.t && f.w > best.w))) best = f
      if (best) return best
    }
  } else {
    let same: HeldFrame<B> | null = null
    for (const f of fr) if (!f.old && Math.abs(f.t - t) < EPS && (f.key ?? 0) === key && (!same || f.w > same.w)) same = f
    if (same) return same
  }
  let near = fr[fr.length - 1]
  for (const f of fr) if (Math.abs(f.t - t) < Math.abs(near.t - t)) near = f
  return near
}

/** What to ask for at t, or null (already held or asked). In exact mode the
 *  answer replaces every ask of this clip not started yet (`drop`), and a
 *  frame drawn for another project state (`key`) does not count. */
export function want<B>(
  plan: ClipPlan<B>,
  t: number,
  mode: FrameMode,
  fps: number,
  w: number,
  h: number,
  key = 0
): { t: number; prep: boolean; w: number; h: number } | null {
  if (mode === 'exact') {
    if (plan.frames.some((f) => !f.old && Math.abs(f.t - t) < EPS && f.w >= w && (f.key ?? 0) === key)) return null
    if (plan.asked.some((a) => a.prep && Math.abs(a.t - t) < EPS && a.w >= w && (a.key ?? 0) === key)) return null
    return { t, prep: true, w, h }
  }
  if (plan.asked.length >= PLAY_IN_FLIGHT) return null
  const step = 1 / Math.max(1, fps)
  const target = gridAfter(t + plan.latency, fps)
  // What is already on its way or here, from about now on (an ask from before
  // a jump far ahead or behind does not count).
  let ahead = -Infinity
  for (const a of plan.asked) if (a.t >= t - step && a.t <= t + 2) ahead = Math.max(ahead, a.t)
  for (const f of plan.frames) if (!f.old && f.t >= t - step && f.t <= t + 2 && f.w >= w * 0.98) ahead = Math.max(ahead, f.t)
  if (ahead >= target - EPS) return null
  const at = ahead > -Infinity ? Math.max(target, ahead + step) : target
  return { t: at, prep: false, w, h }
}

/** The asks of this clip not started (exact mode replaces them). */
export function replaceable<B>(plan: ClipPlan<B>): number[] {
  return plan.asked.map((a) => a.id)
}

export function noteAsked<B>(plan: ClipPlan<B>, a: Asked): void {
  plan.asked.push(a)
}

/** Forget asks (dropped by the host, failed). */
export function forget<B>(plan: ClipPlan<B>, ids: readonly number[]): void {
  if (!ids.length) return
  const gone = new Set(ids)
  plan.asked = plan.asked.filter((a) => !gone.has(a.id))
}

/** A frame came back: kept (and what fell out of the ring returned, to be
 *  closed), or returned itself when nobody waits for it any more. */
export function arrive<B>(plan: ClipPlan<B>, id: number, frame: HeldFrame<B>, seconds: number): B[] {
  const i = plan.asked.findIndex((a) => a.id === id)
  if (i < 0) return [frame.bmp]
  const [asked] = plan.asked.splice(i, 1)
  if (Number.isFinite(seconds) && seconds >= 0) plan.latency = Math.min(1, plan.latency * 0.7 + seconds * 0.3)
  plan.frames.push(frame.key === undefined && asked.key ? { ...frame, key: asked.key } : frame)
  const out: B[] = []
  while (plan.frames.length > RING) {
    // (The newest good frame stays while bad ones come: phase 5e.)
    const goods = plan.frames.filter((f) => !f.bad)
    const keep = goods[goods.length - 1]
    const i = plan.frames[0] === keep ? 1 : 0
    out.push(plan.frames.splice(i, 1)[0].bmp)
  }
  return out
}

/**
 * The film's page started again (its code changed): the frames held are of
 * the page as it was. They stay on screen so nothing flashes black, but they
 * no longer count as having their moment, so the paused preview asks the new
 * page for the frame it is standing on. Before, a paused preview kept showing
 * the old picture after a code change, and showed it again whenever the
 * playhead came back to that frame.
 */
export function markOld<B>(plan: ClipPlan<B>): void {
  for (const f of plan.frames) f.old = true
}

/** Everything held, to be closed (the clip left, the film reloaded). */
export function clearPlan<B>(plan: ClipPlan<B>): B[] {
  const out = plan.frames.map((f) => f.bmp)
  plan.frames = []
  plan.asked = []
  return out
}
