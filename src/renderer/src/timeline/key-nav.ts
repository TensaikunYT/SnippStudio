// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Going from key to key (phase Ç2c.2, decision 5; report D9): the timeline
// times of the keys of the selected clips and titles (all of them when
// nothing is selected) — a clip's channels, its volume and its mask, a
// title's motion; only keys on the clip or the line (those off it are kept
// by the edits but are not where anything changes on screen). Pure.

import type { Project } from '../types'
import { KF_CHANNELS } from '../types'

/** A key this close outside its clip's ends is on it (as the diamonds). */
const ON = 1e-3

/** The keys' timeline times, sorted, each once. */
export function keyTimes(p: Project, clipIds: readonly string[] = [], captionIds: readonly string[] = []): number[] {
  const all = clipIds.length === 0 && captionIds.length === 0
  const clips = all ? Object.values(p.clips) : clipIds.map((id) => p.clips[id]).filter((c) => !!c)
  const caps = all ? p.captions : p.captions.filter((c) => captionIds.includes(c.id))
  const out: number[] = []
  for (const c of clips) {
    const add = (t: number): void => {
      if (t >= -ON && t <= c.duration + ON) out.push(c.start + Math.min(c.duration, Math.max(0, t)))
    }
    for (const ch of KF_CHANNELS) for (const k of c.channels?.[ch] ?? []) add(k.time)
    for (const k of c.volumeKeyframes ?? []) add(k.time)
    for (const k of c.mask?.keyframes ?? []) add(k.time)
  }
  for (const cap of caps) {
    for (const k of cap.kfs ?? []) if (k.time >= -ON && k.time <= cap.end - cap.start + ON) out.push(cap.start + k.time)
  }
  out.sort((a, b) => a - b)
  return out.filter((t, i) => i === 0 || t - out[i - 1] > 1e-6)
}

/** The key time after (`dir` 1) or before (−1) `t`, if there is one. */
export function stepKey(times: readonly number[], t: number, dir: 1 | -1): number | undefined {
  return dir > 0 ? times.find((x) => x > t + 1e-4) : [...times].reverse().find((x) => x < t - 1e-4)
}
