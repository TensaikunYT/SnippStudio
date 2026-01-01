// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { audioPresentationOffset, getAudioSink } from '../media/sources'
import type { Clip, Project } from '../types'
import { assetById, clipsOfTrack } from '../types'
import { localAtMedia } from '../timeline/media-time'
import { curveSig, hasCurve } from '../timeline/speed-curve'
import { bedTracks, silenceRanges } from '../commands/timeline'
import { lockedBehind, ripplePlan } from '../commands/ops/ripple'
import { partnersOf } from '../commands/ops/links'
import { EPS } from '../timeline/eps'

/** True if this clip's own audible sound is what gets analysed. */
export function carriesAudio(project: Project, clip: Clip): boolean {
  const asset = assetById(project, clip.assetId)
  const track = project.tracks.find((candidate) => candidate.id === clip.trackId)
  return !!asset && !asset.missing && asset.hasAudio && !clip.audioExtracted &&
    !clip.disabled && !clip.muted && !track?.locked && !track?.muted
}

/**
 * Every selected audible clip is analysed independently. Only an explicitly
 * selected linked picture follows its extracted audio; an unrelated music bed
 * or still image selected by Ctrl+A is never cut to somebody else's pauses.
 */
export function resolveSilenceSelection(
  project: Project,
  selectedIds: readonly string[]
): { sources: Clip[]; targetsBySource: Record<string, string[]> } | null {
  const selected = selectedIds.map((id) => project.clips[id]).filter(Boolean)
  if (selected.length === 0) return null
  const sources = selected.filter((clip) => carriesAudio(project, clip))
  const targetsBySource: Record<string, string[]> = {}
  for (const source of sources) targetsBySource[source.id] = [source.id]

  // Selecting an extracted-audio video alone still finds its sound partner.
  // When both are selected, the video follows that audio at exactly the same
  // cut points. Do not sweep up unrelated selected images or music.
  for (const c of selected) {
    if (!c.linkId || carriesAudio(project, c)) continue
    if (project.tracks.find((track) => track.id === c.trackId)?.locked) continue
    // One linkId can belong to MANY fragments after an earlier silence pass.
    // Match the fragment occupying this picture's time, not the first audio
    // object with that id, or a second pass analyses the wrong voice fragment.
    const partner = Object.values(project.clips)
      .filter((other) => other.id !== c.id && other.linkId === c.linkId && carriesAudio(project, other))
      .map((other) => ({
        clip: other,
        overlap: Math.min(c.start + c.duration, other.start + other.duration) - Math.max(c.start, other.start)
      }))
      .filter((candidate) => candidate.overlap > 0.02)
      .sort((a, b) => b.overlap - a.overlap)[0]?.clip
    if (partner) {
      if (!targetsBySource[partner.id]) {
        sources.push(partner)
        targetsBySource[partner.id] = [partner.id]
      }
      targetsBySource[partner.id].push(c.id)
    }
  }
  return sources.length > 0 ? { sources, targetsBySource } : null
}

export interface SilenceRegion {
  clipId: string
  /** Timeline seconds. */
  start: number
  end: number
  /** A pause the finder was not sure of, taken in by the user (drawn hatched). */
  unsure?: boolean
}

/** How aggressively to treat quiet passages as silence. */
export type SilenceSensitivity = 'less' | 'balanced' | 'more'

/** How much of a pause is left after the cut. */
export type SilencePace = 'tight' | 'natural' | 'relaxed'

export interface SilenceOptions {
  /** Relative sensitivity — the threshold is auto-calibrated per clip. */
  sensitivity: SilenceSensitivity
  /** Absolute dBFS override. When set, auto-calibration is skipped entirely:
   *  anything quieter than this counts as silence. Lower it to protect audible
   *  passages the automatic threshold was wrongly flagging. */
  thresholdDb?: number
  /** Only stretches at least this long (seconds) get cut. */
  minDuration: number
  /** Seconds of audio kept on each side of the removed gap — the least a
   *  cut pause is left with is twice this. */
  pad: number
  /** How much of a long pause stays, past the pads: 'tight' jump cuts,
   *  'natural' breathing room (default), 'relaxed' unhurried. */
  pace?: SilencePace
}

/** Something that says when a long read should stop. */
export interface Cancel {
  cancelled(): boolean
}

/** The window every analysis reads loudness at, the user's silence removal
 *  and the agent's alike (one size: one cache entry; phase 4A.10, table#7). */
export const ANALYSIS_WINDOW = 0.04

// dB above the clip's own noise floor that still counts as "silence". Higher =
// catches more quiet passages. These are relative, so they work at any level.
const SENS_MARGIN: Record<SilenceSensitivity, number> = { less: 4, balanced: 8, more: 13 }
const CONTENT_GUARD: Record<SilenceSensitivity, number> = { less: 10, balanced: 7, more: 5 }
// Share of the floor-to-speech distance that still counts as quiet. A noisy
// room (fan, hiss, a breath between words) sits well above the floor but far
// below speech: a fixed margin over the floor called it "sound" and left the
// pause in.
const SENS_SHARE: Record<SilenceSensitivity, number> = { less: 0.35, balanced: 0.45, more: 0.55 }
// Share of a pause (past the pads) that stays, and its cap: a long pause is
// shortened to a natural breath, not to nothing, so the words never run into
// each other.
const PACE_SHARE: Record<SilencePace, number> = { tight: 0.1, natural: 0.22, relaxed: 0.35 }
// Cuts shorter than this aren't worth a splice.
const MIN_CUT = 0.06

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return -90
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

/**
 * Picks a silence threshold (dBFS) FROM the clip itself instead of a fixed
 * absolute value. A fixed −26 dB wrongly flagged normal audio, because real
 * speech/music often sits below that. Here we read the loudness distribution:
 * the low percentile is the clip's quiet/noise floor, the high percentile is
 * its actual content level. Silence = clearly quieter than the content, a few
 * dB above the floor (nudged by sensitivity). If the clip is uniformly loud
 * (no real gap between floor and content) we drop the threshold below the floor
 * so essentially nothing is cut.
 */
export function autoThresholdDb(dbs: number[], sensitivity: SilenceSensitivity): number {
  const sorted = [...dbs].sort((a, b) => a - b)
  const floorDb = percentile(sorted, 5)
  const loudDb = percentile(sorted, 85)
  const margin = SENS_MARGIN[sensitivity]
  if (loudDb <= -85) return -80 // genuinely empty audio should be removable
  if (loudDb - floorDb < 6) return floorDb - 4 // uniform loudness → cut almost nothing
  // The old 10 dB uniformity rule missed long, quieter room-tone gaps when
  // speech was only 7–9 dB louder. A lower percentile also sees sparse gaps.
  const above = Math.max(margin, SENS_SHARE[sensitivity] * (loudDb - floorDb))
  return Math.min(floorDb + above, loudDb - CONTENT_GUARD[sensitivity])
}

/**
 * How much of a quiet stretch `gap` seconds long stays after the cut: never
 * less than the two pads, then a share of the rest, capped — short gaps
 * between words keep nearly all of themselves, a long hesitation shrinks to
 * a sentence-sized breath.
 */
export function keptPause(gap: number, pad: number, pace: SilencePace = 'natural'): number {
  const base = 2 * pad
  if (gap <= base) return gap
  const share = PACE_SHARE[pace]
  return base + Math.min(share * (gap - base), share * 1.1)
}

/**
 * Finds clip-local cut intervals from 40 ms loudness windows. A pause between
 * words is cut in its middle and keeps a natural length (see keptPause) —
 * a little more of it after the last word (its tail and room) than before
 * the next. Quiet at the very start or end of the clip goes, down to a pad.
 */
export function silenceRangesFromDb(
  dbs: readonly number[],
  thresholdDb: number,
  opts: Pick<SilenceOptions, 'minDuration' | 'pad' | 'pace'>
): { start: number; end: number }[] {
  const quiet = dbs.map((db) => db < thresholdDb)
  // A click/noise blip one or two windows long must not split a large silent
  // stretch into several sub-minimum pieces. Never bridge speech-level sound.
  for (let i = 0; i < quiet.length;) {
    if (quiet[i]) { i++; continue }
    const start = i
    while (i < quiet.length && !quiet[i]) i++
    if (start > 0 && i < quiet.length && i - start <= 2 &&
      dbs.slice(start, i).every((db) => db < thresholdDb + 6)) {
      quiet.fill(true, start, i)
    }
  }
  const ranges: { start: number; end: number }[] = []
  let runStart = -1
  const flush = (endWindow: number): void => {
    if (runStart < 0) return
    const a = runStart * ANALYSIS_WINDOW
    const b = endWindow * ANALYSIS_WINDOW
    const gap = b - a
    const first = runStart === 0
    runStart = -1
    if (gap < opts.minDuration) return
    let start: number
    let end: number
    if (first && endWindow >= quiet.length) {
      // Nothing but quiet: all of it can go.
      start = 0
      end = b
    } else if (first) {
      // Lead-in before the first word.
      start = 0
      end = b - opts.pad
    } else if (endWindow >= quiet.length) {
      // Room after the last word.
      start = a + opts.pad * 1.5
      end = b
    } else {
      const keep = keptPause(gap, opts.pad, opts.pace)
      start = a + keep * 0.55
      end = b - keep * 0.45
    }
    if (end - start >= MIN_CUT) ranges.push({ start, end })
  }
  for (let w = 0; w < quiet.length; w++) {
    if (quiet[w]) { if (runStart < 0) runStart = w }
    else flush(w)
  }
  flush(quiet.length)
  return ranges
}

/** Loudness already read, per file, stretch of it, speed and window (the
 *  agent asks for silences, fillers, repeats and preflight of the same sound
 *  one after another: G6). Kept by how much it is, not by a count of
 *  entries: after a rough cut one talk is some eighty pieces, and a dozen
 *  entries meant every later analysis read every piece again (phase 4A.9,
 *  V-limits-sessions-4). A million windows ≈ eleven hours of sound at
 *  0.04 s; the least recently used go first. */
const loudnessCache = new Map<string, number[]>()
export const LOUDNESS_CACHE_WINDOWS = 1_000_000
let cachedWindows = 0

type LoudnessReader = (project: Project, clip: Clip, window: number, signal?: Cancel) => Promise<number[] | null>
let reader: LoudnessReader | null = null
/** Tests: another reader than the file's sound (and an empty cache);
 *  returns the function that puts the real one back. */
export function setLoudnessReader(next: LoudnessReader): () => void {
  reader = next
  loudnessCache.clear()
  cachedWindows = 0
  return () => {
    reader = null
    loudnessCache.clear()
    cachedWindows = 0
  }
}

/**
 * A clip's speech-band loudness in `window`-second timeline windows (dBFS),
 * or null when its audio can't be read. Read once per file stretch (kept);
 * `signal` stops the read between decoded buffers (it then throws).
 */
export async function clipLoudnessDb(project: Project, clip: Clip, window = ANALYSIS_WINDOW, signal?: Cancel): Promise<number[] | null> {
  const asset = assetById(project, clip.assetId)
  if (!asset) return null
  const key = `${asset.id}|${asset.url ?? ''}|${clip.inPoint.toFixed(4)}|${clip.duration.toFixed(4)}|${clip.speed ?? 1}|${curveSig(clip.speedCurve)}|${clip.reversed ? 'r' : ''}|${window}`
  const known = loudnessCache.get(key)
  if (known) {
    loudnessCache.delete(key)
    loudnessCache.set(key, known)
    return known
  }
  const dbs = await (reader ?? readLoudnessDb)(project, clip, window, signal)
  if (dbs) {
    loudnessCache.set(key, dbs)
    cachedWindows += dbs.length
    while (cachedWindows > LOUDNESS_CACHE_WINDOWS && loudnessCache.size > 1) {
      const oldest = loudnessCache.keys().next().value as string
      cachedWindows -= loudnessCache.get(oldest)!.length
      loudnessCache.delete(oldest)
    }
  }
  return dbs
}

async function readLoudnessDb(project: Project, clip: Clip, window: number, signal?: Cancel): Promise<number[] | null> {
  const asset = assetById(project, clip.assetId)
  if (!asset) return null
  const sink = await getAudioSink(asset, true)
  if (!sink) return null
  // Same presentation-time alignment the waveform uses, so the red marks
  // land on the gaps you can actually hear.
  const originShift = await audioPresentationOffset(asset)

  // RMS per window across the clip's used media range.
  const windows = Math.max(1, Math.ceil(clip.duration / window))
  const sum = new Float64Array(windows)
  const count = new Float64Array(windows)
  // Media time runs at `speed` per timeline second, so a retimed clip uses a
  // longer (or shorter) stretch of the file than its duration suggests.
  const spd = clip.speed ?? 1
  const from = clip.inPoint
  const to = Math.min(asset.duration, clip.inPoint + clip.duration * spd)
  // (Along a speed curve, the curve's inverse: core polish C. A backwards
  // clip mirrored: its last media second is its first timeline second;
  // audit patch yama-c, D4.)
  const toLocal = hasCurve(clip) || clip.reversed ? (m: number): number => localAtMedia(clip, m) : (m: number): number => (m - clip.inPoint) / spd
  // Speech band only: a one-pole high-pass near 120 Hz, run on the
  // sampled stream, drops the hum, rumble and handling thumps that sit
  // in the pauses and made them read as "sound".
  let prevX: number[] = []
  let prevY: number[] = []
  for await (const wrapped of sink.buffers(from, to)) {
    if (signal?.cancelled()) throw new Error('cancelled')
    const channels = Array.from({ length: wrapped.buffer.numberOfChannels }, (_, index) =>
      wrapped.buffer.getChannelData(index))
    if (channels.length === 0) continue
    const sr = wrapped.buffer.sampleRate
    // 4 kHz sampling keeps the analysis responsive while retaining enough
    // speech-band energy; the old 800 Hz stride could repeatedly land on
    // zero crossings and misclassify audible speech as empty windows.
    const step = Math.max(1, Math.floor(sr / 4000))
    const rc = 1 / (2 * Math.PI * 120)
    const hp = rc / (rc + step / sr)
    if (prevX.length !== channels.length) {
      prevX = channels.map(() => 0)
      prevY = channels.map(() => 0)
    }
    for (let i = 0; i < channels[0].length; i += step) {
      let energy = 0
      for (let c = 0; c < channels.length; c++) {
        const x = channels[c][i]
        const y = hp * (prevY[c] + x - prevX[c])
        prevX[c] = x
        prevY[c] = y
        energy += y * y
      }
      const t = toLocal(wrapped.timestamp + originShift + i / sr)
      const idx = Math.floor(t / window)
      if (idx < 0 || idx >= windows) continue
      sum[idx] += energy / channels.length
      count[idx]++
    }
  }

  // Window loudness in dBFS, then an auto threshold from the distribution.
  const dbs = new Array<number>(windows)
  for (let w = 0; w < windows; w++) {
    const rms = count[w] > 0 ? Math.sqrt(sum[w] / count[w]) : 0
    dbs[w] = rms > 1e-6 ? 20 * Math.log10(rms) : -90
  }
  return dbs
}

// ---- what a silence cut will do, before it is made (çekirdek cila S) --------

/**
 * The stretch of the timeline the scan is kept to (decision 1): between the
 * two cut marks when there are two, else the loop range, else no limit.
 */
export function silenceLimit(s: { cutMarks: readonly number[]; loopRange: readonly [number, number] | null }): [number, number] | null {
  if (s.cutMarks.length >= 2) {
    const a = Math.min(...s.cutMarks)
    const b = Math.max(...s.cutMarks)
    if (b - a >= 0.1) return [a, b]
  }
  if (s.loopRange && s.loopRange[1] - s.loopRange[0] >= 0.1) return [s.loopRange[0], s.loopRange[1]]
  return null
}

export interface SilencePlan {
  /** What the command gets: the chosen ranges on each clip listened to. */
  regions: SilenceRegion[]
  picked: string[]
  /** The ranges the cut will really take out of the timeline, and their sum. */
  ranges: [number, number][]
  total: number
  /** Tracks the cut leaves alone (the music bed), tracks it cuts, and locked
   *  tracks with something after the first cut (they stay, out of step). */
  keepTracks: string[]
  cutTracks: string[]
  lockedTracks: string[]
  /** With `tracks` asked (sessiz): the tracks cut only because a clip on an
   *  asked one is linked to a clip on them; and the tracks left uncut that
   *  hold a clip after the first cut (they may fall out of step). */
  pulled: string[]
  behind: string[]
  /** The red marks: every range on every clip that will be cut. */
  marks: SilenceRegion[]
}

/** The tracks the clips `sources` lie on (the "picked sound" choice, before
 *  its linked picture is added by silenceCutTracks). */
export const sourceTracks = (project: Project, sources: readonly string[]): string[] =>
  [...new Set(sources.map((id) => project.clips[id]?.trackId).filter((id): id is string => !!id))]

/**
 * The tracks a silence cut asked on `tracks` is made on (sessiz,
 * SESSIZ-PLAN.md decision 1): those, and every track holding the linked
 * partner of a clip the cut reaches on one of them (it ends after `from`,
 * the first cut), and theirs in turn. Cutting a picture without its linked
 * sound would pull the pair apart; moving the sound up without cutting it
 * would too (ops/ripple.ts closeTracks moves a partner, but a silence cut
 * takes material out). A locked track is not added: it stays where it is,
 * out of step, as a locked track always does. Pure.
 */
export function silenceCutTracks(project: Project, tracks: readonly string[], from = -Infinity): string[] {
  const out = new Set(tracks.filter((id) => project.tracks.some((t) => t.id === id)))
  for (let grew = true; grew; ) {
    grew = false
    for (const c of Object.values(project.clips)) {
      if (!c.linkId || !out.has(c.trackId) || c.start + c.duration <= from + EPS) continue
      for (const o of partnersOf(project, c)) {
        if (out.has(o.trackId) || project.tracks.find((t) => t.id === o.trackId)?.locked) continue
        out.add(o.trackId)
        grew = true
      }
    }
  }
  return project.tracks.filter((t) => out.has(t.id)).map((t) => t.id)
}

/**
 * The cut the window is about to make, worked out with the functions the
 * command itself uses (decision 4: what is shown is what is cut). `sources`:
 * the clips listened to; `chosen`: the pauses to take out (timeline ranges
 * where every source is quiet). Pure.
 */
export function planSilenceCut(project: Project, sources: readonly string[], chosen: readonly (readonly [number, number])[], opts: { keepMusic: boolean; tracks?: readonly string[] }): SilencePlan {
  const picked = sources.filter((id) => !!project.clips[id])
  const regions: SilenceRegion[] = []
  for (const [a, b] of chosen) {
    for (const id of picked) {
      const c = project.clips[id]
      const start = Math.max(a, c.start)
      const end = Math.min(b, c.start + c.duration)
      if (end - start > 0.02) regions.push({ clipId: id, start, end })
    }
  }
  const ranges = ripplePlan(silenceRanges(project, regions, picked))
  const first = ranges.length ? ranges[0][0] : Infinity
  const live = project.tracks.filter((t) => !t.locked && t.clipIds.length > 0).map((t) => t.id)
  // `tracks` asked (sessiz): those and their linked partners' are cut, every
  // other live track is left as it is (the same keepTracks path the music
  // bed takes). Not asked: every live track but the music bed, as before.
  const asked = opts.tracks ? silenceCutTracks(project, opts.tracks, ranges.length ? first : -Infinity) : null
  const keepTracks = asked ? live.filter((id) => !asked.includes(id)) : opts.keepMusic ? bedTracks(project, picked) : []
  const cutTracks = live.filter((id) => !keepTracks.includes(id))
  const pulled = asked ? cutTracks.filter((id) => !opts.tracks!.includes(id)) : []
  const behind = asked
    ? keepTracks.filter((id) =>
        project.tracks.find((t) => t.id === id)!.clipIds.some((cid) => {
          const c = project.clips[cid]
          return !!c && c.start + c.duration > first + EPS
        }))
    : []
  const lockedTracks = lockedBehind(project, first).map((t) => t.id)
  const marks: SilenceRegion[] = []
  for (const id of cutTracks) {
    for (const clip of clipsOfTrack(project, project.tracks.find((t) => t.id === id)!)) {
      for (const [a, b] of ranges) {
        const start = Math.max(a, clip.start)
        const end = Math.min(b, clip.start + clip.duration)
        if (end > start) marks.push({ clipId: clip.id, start, end })
      }
    }
  }
  return { regions, picked, ranges, total: ranges.reduce((n, [a, b]) => n + b - a, 0), keepTracks, cutTracks, lockedTracks, pulled, behind, marks: marks.sort((x, y) => x.start - y.start) }
}
