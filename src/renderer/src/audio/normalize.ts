// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { mixProjectAudio } from '../export/audio'
import type { Project } from '../types'
import { gainForTarget, integratedLufsMulti, samplePeakDb } from './loudness'

const RATE = 48000

export interface LoudnessReading {
  lufs: number
  peakDb: number
  /** The clip's volume when it was measured (a clip's reading): what a
   *  correction multiplies, so a level changed since does not skew it. */
  volume?: number
}

/** The reading of a stereo mix exactly as the export measures it
 *  (normalizeMix: BS.1770 sums the power of L and R). A mono downmix read
 *  a mono or dual-mono voice 3 dB quieter than the export does, and wide
 *  stereo up to 6 dB, so "Normalize to -14" came out at -11 or hotter. */
export function readStereo(mix: { numberOfChannels: number; getChannelData: (c: number) => Float32Array }, sampleRate: number): LoudnessReading {
  const chans: Float32Array[] = []
  for (let c = 0; c < mix.numberOfChannels; c++) chans.push(mix.getChannelData(c))
  return { lufs: integratedLufsMulti(chans, sampleRate), peakDb: Math.max(...chans.map((d) => samplePeakDb(d))) }
}

/**
 * Measures ONE clip in isolation: the project is cloned with every other clip
 * removed, so the reading is that clip's own contribution — including its
 * current volume, fades and keyframes. Measuring post-gain is deliberate: the
 * correction is then just a multiplier on what the user already set (the
 * volume it was measured at, kept in the reading). Measured on the same
 * 48 kHz stereo mix and the same BS.1770 stereo sum as the export.
 */
export async function measureClip(project: Project, clipId: string, signal?: AbortSignal): Promise<LoudnessReading> {
  const clip = project.clips[clipId]
  if (!clip) return { lufs: -Infinity, peakDb: -Infinity }
  const solo: Project = structuredClone(project)
  for (const t of solo.tracks) {
    t.clipIds = t.clipIds.filter((id) => id === clipId)
    t.muted = false
    delete t.solo
  }
  // Measure the material, not the current mix decision: a muted clip would
  // otherwise read as silent, which is useless when the whole point is to work
  // out what level to set it to.
  delete solo.clips[clipId]?.muted
  const mix = await mixProjectAudio(solo, RATE, 2, undefined, [clip.start, clip.start + clip.duration], signal)
  return { ...readStereo(mix, RATE), volume: clip.volume }
}

/** Measures the whole timeline mix as the viewer would hear it. */
export async function measureProject(project: Project, signal?: AbortSignal): Promise<LoudnessReading> {
  return readStereo(await mixProjectAudio(project, RATE, 2, undefined, undefined, signal), RATE)
}

/** Volume that would put `reading` on `targetLufs`, clamped to the 0–200 %
 *  range the volume control allows. It multiplies the volume the reading was
 *  taken at (`currentVolume` only when the reading has none): a reading
 *  kept from before the level was changed would otherwise be applied to the
 *  new level and miss by exactly that change. */
export function correctionFor(reading: LoudnessReading, targetLufs: number, currentVolume: number): number {
  const gain = gainForTarget(reading.lufs, targetLufs)
  return Math.max(0, Math.min(2, (reading.volume ?? currentVolume) * gain))
}

/** What the clip of `reading` measures at `volume` instead: the honest
 *  readout after normalising (the target, unless the 200 % cap held the
 *  clip short of it). */
export function readingAtVolume(reading: LoudnessReading, volume: number): LoudnessReading {
  const base = reading.volume
  if (base === undefined || !(base > 0)) return { ...reading, volume }
  if (!(volume > 0)) return { lufs: -Infinity, peakDb: -Infinity, volume }
  const db = 20 * Math.log10(volume / base)
  return { lufs: reading.lufs + db, peakDb: reading.peakDb + db, volume }
}
