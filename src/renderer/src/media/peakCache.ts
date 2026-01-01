// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { create } from 'zustand'
import type { Asset } from '../types'
import { api } from '../platform'
import { computePeakPyramid, deserializePyramid, serializePyramid, type PeakPyramid } from './peaks'

/**
 * Peak pyramids live outside the project store (they're derived data, so undo
 * and project loads must never touch them) behind an LRU so a long session with
 * many imports can't grow without bound.
 */
const cache = new Map<string, PeakPyramid>()
const pending = new Set<string>()
/** Partial pyramids for files still being read, plus how far along they are. */
const partial = new Map<string, PeakPyramid>()
const progress = new Map<string, number>()

/** Rough cap on retained peak data. A pyramid is ~2.2 MB for 8 minutes. */
const MAX_BYTES = 200 * 1024 * 1024
let heldBytes = 0

const useVersion = create<{ v: number }>(() => ({ v: 0 }))
const bump = (): void => useVersion.setState((s) => ({ v: s.v + 1 }))

const keyOf = (asset: Asset): string => `${asset.id}|${asset.url}`

function sizeOf(p: PeakPyramid): number {
  let bytes = 0
  for (const l of p.levels) bytes += (l.min.length + l.max.length + l.rms.length) * 4
  return bytes
}

function put(key: string, pyramid: PeakPyramid): void {
  cache.set(key, pyramid)
  heldBytes += sizeOf(pyramid)
  while (heldBytes > MAX_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value
    if (oldest === undefined || oldest === key) break
    const victim = cache.get(oldest)
    if (victim) heldBytes -= sizeOf(victim)
    cache.delete(oldest)
  }
}

/**
 * Returns the asset's peak pyramid, kicking off the scan on first request.
 * 'loading' while it's being built, null when the asset has no usable audio.
 */
export function usePeaks(asset: Asset | undefined): PeakPyramid | 'loading' | null {
  useVersion((s) => s.v)
  if (!asset || !asset.hasAudio || !asset.url || asset.missing) return null
  const key = keyOf(asset)
  const hit = cache.get(key)
  if (hit) {
    // Refresh recency.
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const inFlight = partial.get(key)
  if (inFlight) {
    // Kick off nothing new; just draw what has been decoded so far.
    if (!pending.has(key)) pending.add(key)
    return inFlight
  }
  if (!pending.has(key)) {
    pending.add(key)
    // Disk first: analysing a file is deterministic, so a clip that has been
    // imported before comes back instantly instead of being re-read.
    void (async () => {
      if (!api || !asset.path) return false
      const bytes = await api.analysisGet(asset.path, 'peaks').catch(() => null)
      if (!bytes) return false
      const restored = deserializePyramid(bytes)
      if (!restored) return false
      put(key, restored)
      // Clearing the in-flight mark lets a later request re-read the file if the
      // LRU has since evicted this pyramid — otherwise an evicted asset would
      // report "analysing" for ever and never draw a waveform again.
      pending.delete(key)
      bump()
      return true
    })().then((hit) => {
      if (hit) return
      void computePeakPyramid(asset, (soFar, fraction) => {
      // Show the waveform filling in as the file is read instead of leaving the
      // clip blank until the whole thing has been decoded.
      partial.set(key, soFar)
      progress.set(key, fraction)
      bump()
    })
        .then((pyramid) => {
          if (!pyramid) throw new Error('no audio')
          partial.delete(key)
          progress.delete(key)
          put(key, pyramid)
          pending.delete(key)
          bump()
          // Persist for next time; failure here is never fatal.
          if (api && asset.path) {
            void api.analysisPut(asset.path, 'peaks', serializePyramid(pyramid)).catch(() => {})
          }
        })
        .catch((err) => {
          partial.delete(key)
          progress.delete(key)
          console.error(`waveform analysis failed for ${asset.name}:`, err)
          // Allow a retry in a few seconds (e.g. the decoder was busy).
          setTimeout(() => {
            pending.delete(key)
            bump()
          }, 4000)
        })
    })
  }
  return 'loading'
}

/** How far the analysis of an asset has got, 0..1 (undefined once done). */
export function peakProgress(asset: Asset | undefined): number | undefined {
  return asset ? progress.get(`${asset.id}|${asset.url}`) : undefined
}

/** Drops an asset's peaks (media replaced or removed). */
export function dropPeaks(assetId: string): void {
  // Walk `pending`, not `cache`: relinked media whose scan hadn't finished has
  // no cache entry yet, and leaving its key marked in-flight would stop the new
  // file from ever being analysed.
  for (const key of [...new Set([...cache.keys(), ...pending])]) {
    if (key.startsWith(`${assetId}|`)) {
      partial.delete(key)
      progress.delete(key)
      pending.delete(key)
      const victim = cache.get(key)
      if (victim) heldBytes -= sizeOf(victim)
      cache.delete(key)
    }
  }
}
