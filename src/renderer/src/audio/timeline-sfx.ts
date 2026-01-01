// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's own sounds, made from nothing: every one is synthesised from
// sine waves and filtered noise (no sample files, nothing downloaded). Each
// transition has one (a breath under a dissolve, a swish under a slide), the
// build-ups lead into the big moments, and some templates make their own (a
// click per line, a knock per chess move). They are short and low, and a pure
// function of the project, so the preview hears what the export writes.

import { riserTimes } from './risers'
import { outgoingTransitionWindow } from '../playback/render'
import type { Project } from '../types'
import { trackAudible } from '../types'
import { boxesTimes, chapterDesign, homeOpens, newsTimes, revolverTimes } from '../templates/model'
import { wordsBeats } from '../templates/words-plan'
import { chessGame, chessTimes } from '../templates/chess-plan'
import { LEVEL, MASTER, type SfxEvent } from './sfx-synth'
import { bakedOf, mixEvents, samplesOf, shiftedGuard, voiceGuard, type VoiceGuard } from './sfx-mix'
import { varyEvents } from './sfx-variety'

export { levelOf, slowed, synthSfx } from './sfx-synth'
export { bakedOf, samplesOf } from './sfx-mix'
export type { SfxEvent } from './sfx-synth'


// -- the project's sounds --------------------------------------------------------

const eventCache = new WeakMap<Project, SfxEvent[]>()

/** Every sound of the timeline, by time. */
export function timelineSfxEvents(project: Project): SfxEvent[] {
  const hit = eventCache.get(project)
  if (hit) return hit
  const out: SfxEvent[] = []
  let n = 0
  // A transition given a sound (silent by default since DENEME-3) has one
  // of its own: low and round, never a hiss — a breath under a dissolve, a
  // swish under a slide, a whoosh under a whip. One level for the project,
  // and each transition its own.
  const trLevel = project.transitionSfx ?? 0.5
  if (trLevel > 0) {
    for (const track of project.tracks) {
      // (Nor on a track that is not heard: muted, or left out by a solo.
      // Phase Ç2b.2, report G6.)
      if (track.kind !== 'video' || track.hidden || !trackAudible(project, track)) continue
      for (const id of track.clipIds) {
        const clip = project.clips[id]
        const tr = clip?.transitionOut
        if (!clip || clip.disabled || !tr) continue
        // Silent unless given a sound (DENEME-3, V item 2; an older file's
        // transitions got theirs written in on opening: model/format.ts, 7).
        const own = tr.sfx ?? 0
        if (own <= 0) continue
        const w = outgoingTransitionWindow(project, clip)
        // Only where something transitions (a speed ramp too: its window is
        // there only while it leads into a clip; G6).
        if (w.duration <= 0) continue
        const sfxLevel = trLevel * own
        const cut = clip.start + clip.duration
        const a = cut - w.pre
        const mid = a + w.duration / 2
        const right = tr.direction === 'right' || tr.type === 'ramp-right'
        const across = right ? [-0.5, 0.6] : [0.5, -0.6]
        const at = (t: number, kind: SfxEvent['kind'], gain = 1, extra: Partial<SfxEvent> = {}): void => {
          out.push({ t, kind, pan: 0, gain: sfxLevel * gain, seed: n++, ...extra })
        }
        switch (tr.type) {
          case 'mix':
          case 'fade':
          case 'blur':
            at(a, 'air', 0.9, { dur: Math.max(0.3, w.duration) })
            break
          case 'flash':
          case 'light-leak':
            at(a, 'airlight', 0.9, { dur: Math.max(0.35, w.duration) })
            break
          case 'film-burn':
            // The rush of it catching, and the film crackling.
            at(a, 'airlight', 0.8, { dur: Math.max(0.35, w.duration) })
            at(a + w.duration * 0.3, 'crack', 0.35)
            at(a + w.duration * 0.55, 'crack', 0.28)
            break
          case 'slide':
          case 'push':
          case 'wipe':
            at(mid - 0.15, 'swish', 0.85, { pan: across[0], panTo: across[1] })
            break
          case 'zoom':
            at(mid - 0.22, 'whoosh', 0.7)
            at(mid + 0.08, 'drop', 0.45)
            break
          case 'iris':
            at(a, 'air', 0.6, { dur: Math.max(0.3, w.duration) })
            at(mid, 'tick', 0.5)
            break
          case 'speed-ramp':
            at(cut - 0.22, 'whoosh', 0.8, { pan: across[0], panTo: across[1] })
            break
          default:
            // whip and the ramps: air rushing past.
            at(mid - 0.22, 'whoosh', 0.85, { pan: across[0], panTo: across[1] })
        }
      }
    }
  }
  // Build-ups into the big moments (see risers.ts).
  const riserLevel = Math.max(0, Math.min(1, project.risers ?? 0))
  for (const r of riserTimes(project)) out.push({ t: r.t, kind: 'riser', pan: 0, gain: riserLevel, dur: r.dur, seed: n++ })
  // Some templates have sounds of their own.
  const level = 0.6
  {
    for (const b of project.templates ?? []) {
      const at = (dt: number, kind: SfxEvent['kind'], pan = 0, gain = 1, panTo?: number): void => {
        if (b.cut !== undefined && dt > b.cut + 0.02) return
        out.push({ t: b.start + dt, kind, pan, gain: gain * level, seed: n++, ...(panTo !== undefined ? { panTo } : {}) })
      }
      if (b.kind === 'home') {
        at(1.05, 'drop', 0, 0.55)
      } else if (b.kind === 'map' || b.kind === 'atlas') {
        at(0.2, 'swish', -0.3, 0.6)
      } else if (b.kind === 'boxes') {
        // Each box taking the light: a soft, clean tick.
        boxesTimes(b).light.forEach((tl, i) => at(tl, 'tick', 0, i === 0 ? 0.5 : 0.38))
      } else if (b.kind === 'news') {
        // Each cut a dry click, like a shutter.
        newsTimes(b).cuts.forEach((c, i) => at(c + (i ? 0 : 0.02), 'tick', 0, 0.5))
      } else if (b.kind === 'chess') {
        // Each piece set down on the board.
        const game = chessGame(b)
        chessTimes(b, game.plies).forEach((tm, i) => {
          if (!game.plies[i].move) return
          at(tm.t1, 'knock', 0, 0.45)
          if (tm.rook) at(tm.rook[1], 'knock', 0, 0.35)
        })
      }
    }
  }
  // A revolver chapter: a solid click as the drum turns each chamber, the
  // last one heavier — on by itself, always.
  for (const b of project.templates ?? []) {
    if (b.kind !== 'chapter' || chapterDesign(b) !== 'revolver' || b.rev?.click === false) continue
    const vol = b.rev?.clickVol ?? 0.7
    if (vol <= 0) continue
    const T = revolverTimes(b, homeOpens(project, b))
    T.clicks.forEach((dt, k) => {
      if (b.cut !== undefined && dt > b.cut + 0.02) return
      const last = k === T.clicks.length - 1
      out.push({ t: b.start + dt + (last ? 0.22 : 0.12), kind: 'thock', pan: 0, gain: vol * (last ? 1 : 0.7), seed: n++ })
    })
  }
  // Big words: a solid click as each line comes up — on by itself,
  // always.
  const portrait = project.mode === 'shorts' || project.settings.width < project.settings.height
  for (const b of project.templates ?? []) {
    if (b.kind !== 'words' || b.big?.click === false) continue
    const vol = b.big?.clickVol ?? 0.7
    if (vol <= 0) continue
    for (const dt of wordsBeats(project, b, portrait)) {
      if (dt < -0.02 || dt >= b.duration || (b.cut !== undefined && dt > b.cut + 0.02)) continue
      out.push({ t: b.start + Math.max(0, dt), kind: 'thock', pan: 0, gain: vol, seed: n++ })
    }
  }
  // Only sounds that can be played: a time, a level and a place that are all
  // numbers (one NaN made Web Audio throw on every tick and froze playback).
  const ok = out.filter((e) => Number.isFinite(e.t) && Number.isFinite(e.gain) && e.gain > 0 && Number.isFinite(e.pan) && (e.panTo === undefined || Number.isFinite(e.panTo)) && (e.dur === undefined || Number.isFinite(e.dur)) && e.kind in LEVEL)
  ok.sort((p, q) => p.t - q.t)
  // Variety (the craft run's round 6): the same sound never twice alike in
  // a row; the tuned ones walk the key.
  varyEvents(ok, 110)
  eventCache.set(project, ok)
  return ok
}

/**
 * Adds the timeline's sounds into a rendered mix (export): `offset` is the
 * project time of the mix's first sample.
 */
export function mixTimelineSfx(project: Project, mix: AudioBuffer, offset = 0): void {
  const events = timelineSfxEvents(project)
  if (!events.length) return
  const sr = mix.sampleRate
  const L = mix.getChannelData(0)
  const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : null
  const voice = voiceGuard(L, R, sr)
  mixEvents(events, L, R, sr, offset, voice)
}

/** What a guarded sound's hold carries from before a window (its ease
 *  settles in well under this). */
const GUARD_LEAD = 3

/**
 * The timeline's sounds into one window of the export's mix (phase Ç3b,
 * decision 1): `offset` is the project time of the window's first sample,
 * `voice` the guard read from the whole film's voice before any sound went
 * in (export/audio-stream.ts reads it first, window by window, from time 0)
 * or null when no sound is guarded. The same as mixTimelineSfx over the
 * whole film, cut to the window: the guarded sounds are held under the
 * voice on a bus that starts GUARD_LEAD seconds earlier, on the whole
 * film's twentieths of a second.
 */
export function mixTimelineSfxWindow(project: Project, mix: AudioBuffer, offset: number, voice: VoiceGuard | null): void {
  const events = timelineSfxEvents(project)
  if (!events.length) return
  const sr = mix.sampleRate
  const L = mix.getChannelData(0)
  const R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : null
  const guarded = voice ? events.filter((e) => e.guard) : []
  mixEvents(voice ? events.filter((e) => !e.guard) : events, L, R, sr, offset, null)
  if (!voice || !guarded.length) return
  const t0 = Math.max(0, Math.floor((offset - GUARD_LEAD) * 20)) / 20
  const lead = Math.round((offset - t0) * sr)
  const busL = new Float32Array(lead + L.length)
  const busR = R ? new Float32Array(lead + L.length) : null
  mixEvents(guarded, busL, busR, sr, t0, shiftedGuard(voice, t0))
  for (let i = 0; i < L.length; i++) L[i] += busL[lead + i]
  if (R && busR) for (let i = 0; i < R.length; i++) R[i] += busR[lead + i]
}

// -- live, in the preview ------------------------------------------------------

/**
 * Plays the timeline's sounds while the preview plays: each tick it schedules
 * whatever falls in the next quarter second on the Web Audio clock, and a
 * jump (a seek, a loop) or a stop drops what was queued.
 */
export class TimelineSfxPlayer {
  private until = -1
  private lastTime = -1
  private queued: AudioBufferSourceNode[] = []
  private buffers = new Map<string, AudioBuffer>()

  tick(project: Project, time: number, rolling: boolean, ctx: AudioContext | null, out: AudioNode | null): void {
    if (!rolling || !ctx || !out) {
      if (this.queued.length) this.stopAll()
      this.until = -1
      this.lastTime = time
      return
    }
    let jumped = false
    if (this.until < 0 || time < this.lastTime - 1e-3 || time > this.lastTime + 0.5) {
      this.stopAll()
      this.until = time
      jumped = true
    }
    this.lastTime = time
    const ahead = time + 0.25
    if (ahead <= this.until) return
    const events = timelineSfxEvents(project)
    if (jumped) {
      // A bed already playing at the moment jumped to (rain, a fire, a
      // wake) starts part way, so a long bed is heard wherever play starts.
      for (const e of events) {
        if (e.t >= time) break
        if (!e.bed || !e.dur || e.t + e.dur <= time + 0.05) continue
        try {
          this.schedule(ctx, out, e, time, time - e.t)
        } catch (err) {
          console.warn('timeline sound skipped:', err)
        }
      }
    }
    for (const e of events) {
      if (e.t < this.until) continue
      if (e.t >= ahead) break
      try {
        this.schedule(ctx, out, e, time)
      } catch (err) {
        // One sound that will not play is skipped, never the rest.
        console.warn('timeline sound skipped:', err)
      }
    }
    this.until = ahead
  }

  private schedule(ctx: AudioContext, out: AudioNode, e: SfxEvent, time: number, offset = 0): void {
    const baked = bakedOf(e, ctx.sampleRate)
    const buf = baked ? this.stereoOf(ctx, e, baked) : this.bufferOf(ctx, e)
    // A film's own sound still being made in its sandbox: not this time.
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    gain.gain.value = e.gain * LEVEL[e.kind] * MASTER * (e.near ?? 1)
    const when = ctx.currentTime + Math.max(0, e.t - time)
    src.connect(gain)
    let last: AudioNode = gain
    if (!baked) {
      const pan = ctx.createStereoPanner()
      pan.pan.value = e.pan
      if (e.panTo !== undefined) pan.pan.linearRampToValueAtTime(e.panTo, when + buf.duration)
      gain.connect(pan)
      last = pan
    }
    last.connect(out)
    if (offset > 0) src.start(when, Math.min(offset, Math.max(0, buf.duration - 0.01)))
    else src.start(when)
    src.onended = () => {
      this.queued = this.queued.filter((q) => q !== src)
      last.disconnect()
    }
    this.queued.push(src)
  }

  private bufferOf(ctx: AudioContext, e: SfxEvent): AudioBuffer | null {
    const x = samplesOf(e, ctx.sampleRate)
    if (!x) return null
    const key = `${e.kind}:${e.name ?? ''}:${e.variant ?? e.seed % 5}:${e.pitch ?? 0}:${x.length}:${e.slow ?? ''}:${e.fc === undefined ? '' : Math.round(e.fc)}`
    let b = this.buffers.get(key)
    if (!b) {
      b = ctx.createBuffer(1, x.length, ctx.sampleRate)
      b.getChannelData(0).set(x)
      if (this.buffers.size > 200) this.buffers.clear()
      this.buffers.set(key, b)
    }
    return b
  }

  /** A placed or shaped sound, made in stereo (bakedOf). */
  private stereoOf(ctx: AudioContext, e: SfxEvent, baked: [Float32Array, Float32Array]): AudioBuffer {
    const key = `st:${e.seed}:${e.t.toFixed(4)}:${baked[0].length}`
    let b = this.buffers.get(key)
    if (!b) {
      b = ctx.createBuffer(2, baked[0].length, ctx.sampleRate)
      b.getChannelData(0).set(baked[0])
      b.getChannelData(1).set(baked[1])
      if (this.buffers.size > 200) this.buffers.clear()
      this.buffers.set(key, b)
    }
    return b
  }

  /** Stops what is playing and starts again from the next tick, as after a
   *  jump (the shown project switched: live ↔ candidate). */
  reset(): void {
    this.stopAll()
    this.until = -1
  }

  private stopAll(): void {
    for (const s of this.queued) {
      try {
        s.stop()
      } catch {
        /* already done */
      }
    }
    this.queued = []
  }
}
