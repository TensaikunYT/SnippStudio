// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Clip } from '../types'
import { evalNumberKeys } from '../playback/keys'
import { linearKey } from './envelope'

export interface DuckingOptions {
  /** Seconds represented by one activity cell. */
  cell: number
  /** Gain multiplier while speech is active (0.25 = 25% of the music's own level). */
  duckRatio: number
  /** Start lowering this many seconds before detected speech. */
  attack: number
  /** Stay low this long after the last active speech cell. */
  hold: number
  /** Seconds used to return to the original level. */
  release: number
}

export type VolumePoint = { time: number; value: number }

/** Adaptive RMS voice activity derived from the selected track's own range. */
export function detectSpeechActivity(
  samples: Float32Array,
  sampleRate: number,
  cellSeconds = 0.1
): boolean[] {
  const windowSize = Math.max(1, Math.round(sampleRate * cellSeconds))
  const levels: number[] = []
  for (let from = 0; from < samples.length; from += windowSize) {
    const to = Math.min(samples.length, from + windowSize)
    let sum = 0
    for (let i = from; i < to; i++) sum += samples[i] * samples[i]
    levels.push(Math.sqrt(sum / Math.max(1, to - from)))
  }
  if (levels.length === 0) return []
  const sorted = [...levels].sort((a, b) => a - b)
  const percentile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const floor = percentile(0.2)
  const high = percentile(0.95)
  // Sparse narration may occupy much less than 5% of a long timeline. In that
  // case the percentile is still silence, so fall back to the real peak.
  const peak = high > Math.max(0.001, floor * 1.5) ? high : sorted[sorted.length - 1]
  if (peak < 0.001) return levels.map(() => false)
  // A nearly flat signal is fan/room tone, not dialogue. For real speech use
  // the dynamic range rather than one global amplitude, so a quiet recording
  // is treated as fairly as a loud one.
  if (peak - floor < Math.max(0.0008, peak * 0.12)) return levels.map(() => false)
  const threshold = Math.max(0.0015, floor + (peak - floor) * 0.18)
  const active = levels.map((level) => level >= threshold)

  // Close natural sub-0.3 s gaps between words so the music does not pump.
  const maxGap = Math.max(1, Math.round(0.3 / cellSeconds))
  for (let i = 0; i < active.length;) {
    if (active[i]) {
      i++
      continue
    }
    const start = i
    while (i < active.length && !active[i]) i++
    if (start > 0 && i < active.length && i - start <= maxGap) {
      for (let j = start; j < i; j++) active[j] = true
    }
  }
  return active
}

interface ActivityRun {
  start: number
  end: number
}

function activityRuns(activity: readonly boolean[], cell: number): ActivityRun[] {
  const runs: ActivityRun[] = []
  for (let i = 0; i < activity.length;) {
    if (!activity[i]) {
      i++
      continue
    }
    const start = i
    while (i + 1 < activity.length && activity[i + 1]) i++
    runs.push({ start: start * cell, end: (i + 1) * cell })
    i++
  }
  return runs
}

function baseGainAt(clip: Clip, keyframes: readonly VolumePoint[] | undefined, local: number): number {
  // (playback/keys.ts, linear as the volume: phase Ç2c.1, decision 6.)
  return evalNumberKeys(keyframes, local, { ease: linearKey }) ?? clip.volume
}

/** Builds clip-local keyframes which multiply the music's existing envelope. */
export function planDuckingKeyframes(
  clip: Clip,
  activity: readonly boolean[],
  options: DuckingOptions,
  baseKeyframes: readonly VolumePoint[] | undefined = clip.volumeKeyframes
): VolumePoint[] | null {
  const cell = Math.max(0.01, options.cell)
  const ratio = Math.max(0, Math.min(1, options.duckRatio))
  const attack = Math.max(0, options.attack)
  const hold = Math.max(0, options.hold)
  const release = Math.max(0, options.release)
  const clipStart = clip.start
  const clipEnd = clip.start + clip.duration
  const runs = activityRuns(activity, cell).filter(
    (run) => run.end + hold + release > clipStart && run.start - attack < clipEnd
  )
  if (runs.length === 0) return null

  const factorAt = (timelineTime: number): number => {
    let factor = 1
    for (const run of runs) {
      const downStart = run.start - attack
      const upStart = run.end + hold
      const upEnd = upStart + release
      let value = 1
      if (timelineTime >= run.start && timelineTime <= upStart) value = ratio
      else if (attack > 0 && timelineTime > downStart && timelineTime < run.start) {
        value = 1 - (1 - ratio) * ((timelineTime - downStart) / attack)
      } else if (release > 0 && timelineTime > upStart && timelineTime < upEnd) {
        value = ratio + (1 - ratio) * ((timelineTime - upStart) / release)
      }
      factor = Math.min(factor, value)
    }
    return factor
  }

  const times = new Set<number>([0, clip.duration])
  for (const keyframe of baseKeyframes ?? []) {
    if (keyframe.time >= 0 && keyframe.time <= clip.duration) times.add(keyframe.time)
  }
  for (const run of runs) {
    for (const timelineTime of [run.start - attack, run.start, run.end + hold, run.end + hold + release]) {
      times.add(Math.max(0, Math.min(clip.duration, timelineTime - clipStart)))
    }
  }

  const points = [...times]
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      value: Math.max(0, Math.min(2, baseGainAt(clip, baseKeyframes, time) * factorAt(clipStart + time)))
    }))
  const deduped = points.filter((point, index) => index === 0 || Math.abs(point.time - points[index - 1].time) > 1e-6)
  const compact: VolumePoint[] = []
  for (const point of deduped) {
    const a = compact[compact.length - 2]
    const b = compact[compact.length - 1]
    if (a && b) {
      const expected = a.value + (point.value - a.value) * ((b.time - a.time) / Math.max(1e-6, point.time - a.time))
      if (Math.abs(expected - b.value) < 1e-7) compact.pop()
    }
    compact.push(point)
  }
  return compact
}
