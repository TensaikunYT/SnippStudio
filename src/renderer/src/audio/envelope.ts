// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Clip } from '../types'
import { evalNumberKeys } from '../playback/keys'

/** Volume points are joined by straight lines. */
export const linearKey = (p: number): number => p

/**
 * The clip's audio gain at a clip-local time: base volume, volume keyframes
 * (linear between points) and fade-in/out ramps, all combined.
 */
export function volumeAt(clip: Clip, local: number): number {
  // Mute wins over everything, including keyframes — which is the whole point
  // of it being a flag rather than "set the volume to zero".
  if (clip.muted) return 0
  return envelopeAt(clip, local)
}

/**
 * Raw volume automation at a clip-local time, before fade-in/out and mute.
 * Controls use this value: displaying the post-fade result in the keyframe
 * slider would make writing 50% during a fade produce less than 50% audibly.
 */
export function automationGainAt(clip: Clip, local: number): number {
  // Linear between points (playback/keys.ts: phase Ç2c.1, decision 6).
  const value = evalNumberKeys(clip.volumeKeyframes, local, { ease: linearKey }) ?? clip.volume
  return Math.max(0, Math.min(2, value))
}

/**
 * The same envelope WITHOUT the mute flag — what the clip's audio would be if
 * it were audible. The waveform draws with this so muting a clip doesn't erase
 * the picture of its sound: you still need to see where the words are in order
 * to cut against them.
 */
export function envelopeAt(clip: Clip, local: number): number {
  let v = automationGainAt(clip, local)
  const fadeIn = clip.fadeIn ?? 0
  if (fadeIn > 0 && local < fadeIn) v *= Math.max(0, local / fadeIn)
  const fadeOut = clip.fadeOut ?? 0
  if (fadeOut > 0 && local > clip.duration - fadeOut) {
    v *= Math.max(0, (clip.duration - local) / fadeOut)
  }
  // Ceiling is 2 (+6 dB), matching the 0–200% Volume slider — clamping at 1
  // silently made every boost above 100% inaudible.
  return Math.max(0, Math.min(2, v))
}
