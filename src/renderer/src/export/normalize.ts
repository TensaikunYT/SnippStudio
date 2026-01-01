// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's loudness normalizing (its '−14 LUFS' choice), on plain sample
// arrays so a test can read it.
//
// It measures with the SAME ITU-R BS.1770 meter the inspector shows, then
// moves the level to the target, but never so far up that the loudest sample
// passes −1 dBFS. It used to raise the level by up to +12 dB and then cut
// every sample over full scale off flat: a narration at −20 LUFS with its
// peaks at −3 dBFS came out 3 dB over, every plosive and loud syllable
// distorted. Now it stops short of the target instead, and says so.

import { integratedLufsMulti } from '../audio/loudness'
import { t } from '../ui/strings'

/** YouTube's loudness (LUFS). */
export const NORMALIZE_TARGET_LUFS = -14
/** The loudest a sample may be raised to (dBFS): room for the encoder's own
 *  overshoot between samples. */
export const NORMALIZE_CEILING_DB = -1
/** The most it is ever raised or lowered (dB). */
const MAX_UP_DB = 12
const MAX_DOWN_DB = 24

export interface NormalizeGain {
  /** The gain applied (dB). */
  gainDb: number
  /** The mix's loudness before (LUFS). */
  measured: number
  /** Its loudness after (LUFS). */
  reached: number
  /** How far under the target it stays (dB; 0 when reached). */
  short: number
  /** Its peaks held it back (it would have passed the ceiling). */
  heldByPeaks: boolean
}

/** The gain toward `target` for a mix measured at `measured` LUFS whose
 *  loudest sample is `peak` (linear, 1 = full scale). Null: nothing to
 *  measure (silence). A mix already peaking over the ceiling is not raised
 *  at all (rather than lowered, away from its target). */
export function normalizeGain(measured: number, peak: number, target = NORMALIZE_TARGET_LUFS): NormalizeGain | null {
  if (!Number.isFinite(measured)) return null
  const wanted = target - measured
  const clamped = Math.min(MAX_UP_DB, Math.max(-MAX_DOWN_DB, wanted))
  const room = peak > 0 && Number.isFinite(peak) ? NORMALIZE_CEILING_DB - 20 * Math.log10(peak) : Infinity
  const gainDb = clamped > 0 ? Math.min(clamped, Math.max(0, room)) : clamped
  const reached = measured + gainDb
  return { gainDb, measured, reached, short: Math.max(0, target - reached), heldByPeaks: clamped > 0 && gainDb < clamped - 1e-9 }
}

/** The loudest sample's size (linear) across channels. */
export function samplePeak(channels: Float32Array[]): number {
  let peak = 0
  for (const d of channels) {
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i])
      if (v > peak) peak = v
    }
  }
  return peak
}

/** Normalizes the channels in place; what was done (null: silence). Changes
 *  under 0.1 dB are left alone. */
export function normalizeChannels(channels: Float32Array[], sampleRate: number, target = NORMALIZE_TARGET_LUFS): NormalizeGain | null {
  const measured = integratedLufsMulti(channels, sampleRate)
  const g = normalizeGain(measured, samplePeak(channels), target)
  if (!g) return null
  if (Math.abs(g.gainDb) < 0.1) return { ...g, gainDb: 0, reached: measured, short: Math.max(0, target - measured) }
  const gain = Math.pow(10, g.gainDb / 20)
  for (const d of channels) {
    for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * gain))
  }
  return g
}

/** What to tell the person when the target was not reached (null: it was,
 *  within half a dB). */
export function normalizeNote(g: NormalizeGain | null, target = NORMALIZE_TARGET_LUFS): string | null {
  if (!g) return null
  // Reached: said with the gain it took (phase Ç3 patch, S-4: a −9 LUFS
  // master turned down 5 dB without a word).
  if (g.short < 0.5) {
    if (Math.abs(g.gainDb) < 0.1) return null
    const db = `${g.gainDb > 0 ? '+' : '−'}${Math.abs(g.gainDb).toFixed(1)} dB`
    return t('export.normalize.applied', { lufs: `${target < 0 ? '−' : ''}${Math.abs(target).toFixed(0)}`, db })
  }
  const lufs = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
  const why = g.heldByPeaks
    ? `louder would have pushed its loudest moments past ${lufs(NORMALIZE_CEILING_DB)} dBFS`
    : `it is raised by ${MAX_UP_DB} dB at most`
  return `Sound normalized to ${lufs(g.reached)} LUFS, not ${lufs(target)}: ${why}`
}
