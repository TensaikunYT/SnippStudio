// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { assetById, flatClipsOfTrack, trackAudible, type Clip, type Project } from '../types'
import { volumeAt } from '../audio/envelope'
import { keepsPitch } from '../timeline/speed'
import { clipAudible } from '../timeline/speed-curve'

/** A cropped piece of WebAudio's linearly interpolated gain curve. The
 * original knot times stay anchored to the clip, even when the render starts
 * halfway through a fade or an automated volume change. */
export function cropGainCurve(curve: Float32Array, curveDuration: number, start: number, end: number): { time: number; gain: number }[] {
  if (!curve.length || end <= start) return []
  const at = (time: number): number => {
    const p = Math.max(0, Math.min(curve.length - 1, time / curveDuration * (curve.length - 1)))
    const a = Math.floor(p), b = Math.min(curve.length - 1, a + 1)
    return curve[a] + (curve[b] - curve[a]) * (p - a)
  }
  const knots = [{ time: 0, gain: at(start) }]
  for (let i = 1; i < curve.length; i++) {
    const time = i / (curve.length - 1) * curveDuration
    if (time > start && time < end) knots.push({ time: time - start, gain: curve[i] })
  }
  knots.push({ time: end - start, gain: at(end) })
  return knots
}

/** Trim decoder packets at a requested media window without throwing away
 * the packet that contains its first sample. */
export function trimAudioPacket(timestamp: number, duration: number, from: number, to: number): { mediaStart: number; offset: number; duration: number } | null {
  const a = Math.max(timestamp, from), b = Math.min(timestamp + duration, to)
  return b > a ? { mediaStart: a, offset: a - timestamp, duration: b - a } : null
}
/** The clips the mixer (mixProjectAudio) actually decodes: on a track that is
 *  heard, compound clips opened up (their children live in `nested`, not in
 *  `project.clips`), with sound, not muted, with a level of their own or from
 *  their volume keyframes, and not a freeze, reversed, disabled or
 *  sound-extracted clip. */
export function mixedClips(project: Project): Clip[] {
  return project.tracks.filter((t) => trackAudible(project, t)).flatMap((t) => flatClipsOfTrack(project, t)).filter((c) => {
    const asset = assetById(project, c.assetId)
    return !!asset?.hasAudio && !asset.missing && !c.muted && !c.disabled && !c.audioExtracted && !c.reversed && c.freeze === undefined && clipAudible(c) && (c.volume > 0 || !!c.volumeKeyframes?.length)
  })
}

/** Whether an export carries a sound track at all: a clip the mixer hears
 *  (`mixedClips`: a clip brought up from 0 by keyframes is mixed, so it is
 *  heard; a clip inside a compound clip too); or the timeline's sounds
 *  (`sounds`, how many). Before round 12b the keyframed clip was mixed
 *  into no track: the film came out silent. So did footage grouped into a
 *  compound clip, which this looked for only among the top-level clips. */
export function exportCarriesSound(project: Project, sounds: number): boolean {
  if (sounds > 0) return true
  return mixedClips(project).length > 0
}

/** The part of a transition window this sound needs (render.ts's
 *  TransitionWindow, kept structural so this module stays light). */
export interface AudioTransitionWindow {
  duration: number
  pre: number
  post: number
  type?: string
}

/**
 * The transition part of a clip's sound level at timeline time `t`, shared
 * rule with the preview (playback/engine.ts): for a transition from A into B
 * at the cut c (A's end), with `post` > 0, A stays at full level up to c and
 * falls linearly to 0 over [c, c + post] while B rises linearly from 0 to 1
 * over the same seconds, so the two always add up to one. B is silent before
 * c: the lead of a dissolve is picture only. With `post` 0 the sound simply
 * cuts at c. (It used to fade A over [c - pre, c + post] against B's
 * [c, c + post], a -6 dB hole at the cut of every centred dissolve.)
 * A speed ramp keeps its own short declick at the cut.
 */
export function transitionAudioFade(
  t: number,
  clip: { start: number; duration: number },
  outWin: AudioTransitionWindow,
  inWin: AudioTransitionWindow,
  fps: number
): number {
  const end = clip.start + clip.duration
  const dOut = outWin.duration
  const dIn = inWin.duration
  let fade = 1
  if (dOut > 0 && outWin.post > 0 && t >= end) fade *= Math.max(0, 1 - (t - end) / outWin.post)
  // From the clip's own start, across the part of the transition after it.
  if (dIn > 0 && inWin.post > 0 && t < clip.start + inWin.post) {
    fade *= Math.max(0, Math.min(1, (t - clip.start) / inWin.post))
  }
  if (outWin.type === 'speed-ramp' && dOut > 0) {
    fade *= Math.min(1, Math.max(0, (end - t) / Math.min(0.14, 5.5 / Math.max(12, fps))))
  }
  if (inWin.type === 'speed-ramp' && dIn > 0) {
    fade *= Math.min(1, Math.max(0, (t - clip.start) / Math.min(0.14, 5.5 / Math.max(12, fps))))
  }
  return fade
}

/** The declick at a clip's edge (phase Ç3b, decision 2; report R9): a
 *  raised-cosine ramp this long (seconds). */
export const DECLICK_SEC = 0.004

/** Two clips one after the other that play one recording on without a
 *  break (a split never taken apart): the same file, the second starting
 *  where the first ends, on the timeline and in the file, at one speed.
 *  Their join is not a cut, so it gets no declick (a ramp there would dip a
 *  continuous sound). Only while the level goes on too (phase Ç3 patch,
 *  S-1): the same mute, and the same gain at the join (volume, keyframes,
 *  fades). A piece turned down to 30 % or 0 after a split stepped there in
 *  one sample, the very click the declick is for. Not at another speed with
 *  the pitch kept (core polish B): each piece is stretched on its own grid
 *  (audio/time-stretch.ts), so the waveform does not run on across the cut. */
export function continuesInto(a: Clip, b: Clip): boolean {
  const speed = a.speed ?? 1
  if (a.assetId !== b.assetId || speed !== (b.speed ?? 1)) return false
  if (speed !== 1 && (keepsPitch(a) || keepsPitch(b))) return false
  if (a.reversed || b.reversed || a.freeze !== undefined || b.freeze !== undefined) return false
  // (Along a speed curve each piece plays on its own grid: core polish C.)
  if (a.speedCurve || b.speedCurve) return false
  if (Math.abs(a.start + a.duration - b.start) > 1e-6) return false
  if (Math.abs(a.inPoint + a.duration * speed - b.inPoint) >= 1 / 96000) return false
  if (!!a.muted !== !!b.muted) return false
  return Math.abs(volumeAt(a, a.duration) - volumeAt(b, 0)) < 1e-4
}

/** Which edges of a clip's sound are hard cuts that get the declick: not
 *  one a transition fades (or a speed ramp's own declick covers), not a
 *  join where the recording plays straight on (`continuesInto`). `track`
 *  is the clip's track's clips (compound clips opened up). */
export function declickEdges(clip: Clip, track: readonly Clip[], outWin: AudioTransitionWindow, inWin: AudioTransitionWindow): { head: boolean; tail: boolean } {
  const fadedIn = inWin.duration > 0 && (inWin.post > 0 || inWin.type === 'speed-ramp')
  const fadedOut = outWin.duration > 0 && (outWin.post > 0 || outWin.type === 'speed-ramp')
  const before = track.some((o) => o !== clip && !o.disabled && !o.muted && continuesInto(o, clip))
  const after = track.some((o) => o !== clip && !o.disabled && !o.muted && continuesInto(clip, o))
  return { head: !fadedIn && !before, tail: !fadedOut && !after }
}

/** The declick's gain at a clip-local time (1 away from the edges). */
export function declickAt(local: number, duration: number, edges: { head: boolean; tail: boolean }, ramp = DECLICK_SEC): number {
  let g = 1
  if (edges.head && local < ramp) g *= local <= 0 ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * local) / ramp)
  const left = duration - local
  if (edges.tail && left < ramp) g *= left <= 0 ? 0 : 0.5 - 0.5 * Math.cos((Math.PI * left) / ramp)
  return g
}

/** The sound's level along a stretch of a clip [from, to] (clip-local
 *  seconds), sampled every `step` seconds (1 ms: far above the 200 per
 *  second asked), for `levelAt` to read between. */
export function levelCurve(at: (local: number) => number, from: number, to: number, step = 0.001): { from: number; step: number; v: Float32Array } {
  const n = Math.max(2, Math.ceil((to - from) / step) + 2)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) v[i] = at(from + i * step)
  return { from, step, v }
}

/** A levelCurve read at a clip-local time (straight between its points). */
export function levelAt(c: { from: number; step: number; v: Float32Array }, local: number): number {
  const p = (local - c.from) / c.step
  if (p <= 0) return c.v[0]
  const i = Math.floor(p)
  if (i >= c.v.length - 1) return c.v[c.v.length - 1]
  return c.v[i] + (c.v[i + 1] - c.v[i]) * (p - i)
}

/** Why a clip's sound is missing from a mix. */
export type AudioSkipReason = 'no-sound-track' | 'open-timeout' | 'decode-error' | 'stalled'

/** A clip whose sound (from `at` on) did not make it into a mix. */
export interface AudioSkip {
  clipId: string
  /** The recording's name (its asset's). */
  name: string
  /** Timeline second from which the clip's sound is missing. */
  at: number
  reason: AudioSkipReason
}

const SKIP_WHY: Record<AudioSkipReason, string> = {
  'no-sound-track': 'no sound track was found in the file',
  'open-timeout': 'the file did not open in time',
  'decode-error': 'its sound could not be decoded',
  stalled: 'reading its sound stopped making progress'
}

function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** One line for the user about a skipped clip ("… from 1:05 …"). */
export function describeAudioSkip(skip: AudioSkip): string {
  return `The sound of "${skip.name}" from ${clockOf(skip.at)} is missing from the mix: ${SKIP_WHY[skip.reason]}.`
}

/** What a decoded batch is reduced to before an ANALYSIS mix holds it until
 *  rendering (transcription, speech detection, the audio review: below the
 *  export's 48 kHz stereo, or mono), or null to keep it as decoded. Only
 *  ever smaller, never more channels or a higher rate; the 48 kHz stereo
 *  export mix is never reduced, so it stays exactly as it was. */
export function batchReduction(
  mix: { sampleRate: number; channels: number },
  batch: { sampleRate: number; channels: number }
): { sampleRate: number; channels: number } | null {
  const analysis = mix.sampleRate < 48000 || mix.channels < 2
  if (!analysis) return null
  const sampleRate = Math.min(mix.sampleRate, batch.sampleRate)
  const channels = Math.min(mix.channels, batch.channels)
  return sampleRate < batch.sampleRate || channels < batch.channels ? { sampleRate, channels } : null
}

/** Filters, compressors and noise gates carry state from earlier samples.
 * Guarded sounds also use the narration's overall level (a stretch's own
 * voice would set it differently than the whole film's). Keep their full mix so a short preview
 * or a stretch sounds exactly like the corresponding part of the export. */
export function canMixAudioWindow(project: Project, guardedSounds: boolean): boolean {
  const clips = mixedClips(project)
  if (guardedSounds && clips.length) return false
  return clips.every((c) => {
    const fx = c.audioFx
    return !fx || (!fx.eqLow && !fx.eqMid && !fx.eqHigh && !fx.highpass && !fx.lowpass && !fx.comp.enabled && !fx.gate?.enabled)
  })
}
