// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Rules the preview engine follows that need no DOM, kept apart from
// engine.ts (which touches media elements and Web Audio at import time) so
// they can be tested on their own.

import type { Clip, Project } from '../types'

/** The part of a transition window the sound needs. */
export interface FadeWindow {
  duration: number
  post: number
}

/**
 * A clip's crossfade gain at timeline `time`: the rule the preview shares
 * with the export mix (export/audio.ts follows the same one).
 *
 * For a transition from A into B whose window is {pre, post} around the cut
 * c (A's end, B's start):
 *  - post > 0: A stays at 1 until c, then falls linearly to 0 over
 *    [c, c + post]; B rises linearly from 0 to 1 over the same span, so the
 *    two always add up to 1 (no hole in the middle of a dissolve).
 *  - post = 0: the sound simply cuts at c.
 * B is silent before c: the lead (pre) is picture-only. What B plays there is
 * footage before its in point, which the user trimmed off and the export
 * never plays.
 * A clip shorter than its incoming fade multiplies both, as before.
 */
export function transitionGain(time: number, start: number, end: number, inWin: FadeWindow, outWin: FadeWindow): number {
  if (time < start) return 0
  let gain = 1
  if (time >= end) {
    const tail = outWin.duration > 0 && outWin.post > 0 ? outWin.post : 0
    if (tail <= 0) return 0
    gain *= Math.max(0, 1 - (time - end) / tail)
  }
  if (inWin.duration > 0 && inWin.post > 0 && time < start + inWin.post) {
    gain *= Math.max(0, Math.min(1, (time - start) / inWin.post))
  }
  return gain
}

/**
 * Every clip id the timeline holds, compound children included, to the same
 * depth flattenClips expands them. The engine keys its media elements by the
 * ids flattenClips hands it, and a compound's children live only inside the
 * compound, so checking `project.clips` alone took a playing child for a
 * deleted clip and tore its element down every couple of seconds.
 */
export function aliveClipIds(project: Pick<Project, 'clips'>): Set<string> {
  const alive = new Set<string>()
  const walk = (clips: Iterable<Clip>, depth: number): void => {
    for (const c of clips) {
      alive.add(c.id)
      if (c.nested && depth < 4) walk(c.nested.clips, depth + 1)
    }
  }
  walk(Object.values(project.clips), 0)
  return alive
}

/** How far the store's time may sit from where the engine last put it, while
 *  rolling, before it counts as a jump (a seek made during playback). */
export const JUMP_SEC = 0.05

/** Was the playhead moved under the running transport? */
export function playheadJumped(current: number, lastWritten: number): boolean {
  return Math.abs(current - lastWritten) > JUMP_SEC
}

/**
 * Seconds the clock counts for a tick whose time is `now` (ms) when it was
 * last set at `last`: never negative, at most a quarter of a second. (A
 * frame's time is when the frame began, which can be before the moment the
 * clock was last set: the hand-over below sets it to the moment itself.)
 */
export function tickSeconds(now: number, last: number): number {
  return Math.max(0, Math.min(0.25, (now - last) / 1000))
}

/**
 * How far the playhead moves in a rolling tick. The first tick after a hold
 * (Play, a jump, a loop wrap) is the hand-over: the parked elements are told
 * to play in it, so the playhead stays where they were parked and the clock
 * counts from that moment on. Counting that tick's time too gave the clock
 * time no element had played: after a long frame (the redraw a click sets
 * off) the sound started that much behind the playhead and stayed there.
 */
export function clockStep(dt: number, pace: number, handOver: boolean): number {
  return handOver ? 0 : dt * pace
}
