// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's sound, window by window (phase Ç3b, decision 1; reports R6,
// R29). The whole film's sound used to be decoded and mixed in one
// OfflineAudioContext before the first frame: a 30-minute project took the
// page to 1.7 GB and kept the bar at 5 % for 39 s (FAZC3B-PLAN.md). Now it
// is mixed 30 s at a time and each window goes to the encoder between the
// frames; what the page holds is a window, not the film.
//
// One window: the clips' sound over its 30 s (export/audio.ts mixSpan, with
// 3 s more before it when a clip's effects carry state: a filter, the
// compressor, the noise gate — mixed and dropped, so the window starts as
// the whole-film mix would); the timeline's sounds (guarded ones under the
// whole film's voice); the loudness gain; the master limiter (−1 dBTP,
// always on: audio/limiter.ts, R10).
//
// What needs the whole film first is read first, in walks over the same
// windows that keep nothing but numbers: the voice's level every twentieth
// of a second (when a sound is guarded under it, from time 0, as the
// whole-film mix read it) and the loudness (when "Normalize" is on).

import { LoudnessMeter } from '../audio/loudness'
import { TruePeakLimiter, type LimiterStats } from '../audio/limiter'
import { VoiceBlocks, type VoiceGuard } from '../audio/sfx-mix'
import { mixTimelineSfxWindow, timelineSfxEvents } from '../audio/timeline-sfx'
import type { Project } from '../types'
import { projectDuration } from '../types'
import { audioReaders, mixSpan, type AudioReaders } from './audio'
import { mixedClips, type AudioSkip } from './audio-window'
import { normalizeGain, type NormalizeGain } from './normalize'

export const MIX_RATE = 48000
/** A window's length (seconds; a whole number of twentieths). */
export const MIX_WINDOW_SEC = 30
/** The mix before a window that is mixed and dropped when a clip's effects
 *  carry state (seconds). */
export const STATE_LEAD_SEC = 3

/** Whether any clip the mix hears has an effect that remembers the samples
 *  before (a filter, the compressor, the noise gate). */
export function carriesState(project: Project): boolean {
  return mixedClips(project).some((c) => {
    const fx = c.audioFx
    return !!fx && (!!fx.eqLow || !!fx.eqMid || !!fx.eqHigh || !!fx.highpass || !!fx.lowpass || fx.comp.enabled || !!fx.gate?.enabled)
  })
}

export interface ExportMixOptions {
  signal?: AbortSignal
  normalize?: boolean
  /** Window length (seconds); tests make it short. */
  windowSec?: number
  /** A clip's sound missing from the mix (once per clip). */
  onSkip?: (skip: AudioSkip) => void
  /** The limiter's ceiling (dBTP). */
  ceilingDb?: number
}

export interface MixPassProgress {
  pass: 'voice' | 'loudness' | 'mix'
  window: number
  windows: number
}

export class ExportMix {
  readonly sampleRate = MIX_RATE
  readonly channels = 2
  /** The sound's length (samples). */
  readonly frames: number
  readonly windowFrames: number
  readonly windows: number
  /** The walks before the first window: 'voice', 'loudness'. */
  readonly passes: ('voice' | 'loudness')[]
  private readonly readers: AudioReaders
  private readonly gone = new Set<string>()
  private readonly skipped = new Set<string>()
  private readonly lead: number
  private voice: VoiceGuard | null = null
  private gain = 1
  private k = 0
  private readonly limiter: TruePeakLimiter
  normalized: NormalizeGain | null = null
  private closed = false

  constructor(private readonly project: Project, private readonly range: [number, number], private readonly opts: ExportMixOptions = {}) {
    const [a, b] = range
    this.frames = Math.max(1, Math.ceil(Math.max(0, b - a) * MIX_RATE))
    this.windowFrames = Math.round((opts.windowSec ?? MIX_WINDOW_SEC) * MIX_RATE)
    this.windows = Math.ceil(this.frames / this.windowFrames)
    this.passes = []
    if (timelineSfxEvents(project).some((e) => e.guard) && mixedClips(project).length) this.passes.push('voice')
    if (opts.normalize) this.passes.push('loudness')
    this.lead = carriesState(project) ? Math.round(STATE_LEAD_SEC * MIX_RATE) : 0
    this.readers = audioReaders()
    this.limiter = new TruePeakLimiter(MIX_RATE, 2, { ceilingDb: opts.ceilingDb ?? -1 })
  }

  /** Windows of every walk, the final one included (for the bar's shares). */
  get totalWindows(): number {
    let n = this.windows
    if (this.passes.includes('voice')) n += Math.ceil(Math.ceil(Math.max(0.5, projectDuration(this.project)) * MIX_RATE) / this.windowFrames)
    if (this.passes.includes('loudness')) n += this.windows
    return n
  }

  private onSkip = (s: AudioSkip): void => {
    if (this.skipped.has(s.clipId)) return
    this.skipped.add(s.clipId)
    this.opts.onSkip?.(s)
  }

  /** `frames` of the clips' sound from project time `start` (and the state
   *  lead before it, mixed and dropped). */
  private async clips(start: number, frames: number): Promise<AudioBuffer> {
    const lead = this.lead
    const buf = await mixSpan(this.readers, this.project, MIX_RATE, 2, start - lead / MIX_RATE, frames + lead, { signal: this.opts.signal, onSkip: this.onSkip, gone: this.gone })
    if (!lead) return buf
    const out = new AudioBuffer({ length: frames, sampleRate: MIX_RATE, numberOfChannels: 2 })
    for (let c = 0; c < 2; c++) out.copyToChannel(buf.getChannelData(c).subarray(lead, lead + frames), c)
    return out
  }

  /** Window `k` of the range: the clips and the timeline's sounds. */
  private async window(k: number): Promise<AudioBuffer> {
    const off = k * this.windowFrames
    const n = Math.min(this.windowFrames, this.frames - off)
    const start = this.range[0] + off / MIX_RATE
    const buf = await this.clips(start, n)
    mixTimelineSfxWindow(this.project, buf, start, this.voice)
    return buf
  }

  /** The walks that need the whole film before its first window. */
  async prepare(onWindow?: (p: MixPassProgress) => void): Promise<void> {
    if (this.passes.includes('voice')) {
      // The voice before any sound went in, the whole film from time 0 (as
      // the mix of the whole film read it), on its twentieths of a second.
      const end = Math.ceil(Math.max(0.5, projectDuration(this.project)) * MIX_RATE)
      const blocks = new VoiceBlocks(MIX_RATE)
      const n = Math.ceil(end / this.windowFrames)
      for (let k = 0; k < n; k++) {
        const off = k * this.windowFrames
        const buf = await this.clips(off / MIX_RATE, Math.min(this.windowFrames, end - off))
        blocks.push(buf.getChannelData(0), buf.getChannelData(1))
        onWindow?.({ pass: 'voice', window: k + 1, windows: n })
      }
      this.voice = blocks.guard()
    }
    if (this.passes.includes('loudness')) {
      const meter = new LoudnessMeter(MIX_RATE, 2)
      for (let k = 0; k < this.windows; k++) {
        const buf = await this.window(k)
        meter.push([buf.getChannelData(0), buf.getChannelData(1)])
        onWindow?.({ pass: 'loudness', window: k + 1, windows: this.windows })
      }
      const g = normalizeGain(meter.integrated(), meter.peak)
      // (Under 0.1 dB: left alone, as before.)
      this.normalized = g && Math.abs(g.gainDb) < 0.1 ? { ...g, gainDb: 0, reached: g.measured, short: Math.max(0, -14 - g.measured) } : g
      this.gain = this.normalized ? Math.pow(10, this.normalized.gainDb / 20) : 1
    }
  }

  /** The next window as it goes to the encoder (the limiter's output: the
   *  first a few samples shorter, the last that much longer), or null at
   *  the end. */
  async next(): Promise<AudioBuffer | null> {
    if (this.closed || this.k >= this.windows) {
      this.close()
      return null
    }
    const k = this.k++
    const last = k === this.windows - 1
    const buf = await this.window(k)
    const L = buf.getChannelData(0)
    const R = buf.getChannelData(1)
    if (this.gain !== 1) {
      for (let i = 0; i < L.length; i++) {
        L[i] *= this.gain
        R[i] *= this.gain
      }
    }
    let out = this.limiter.process([L, R])
    if (last) {
      const rest = this.limiter.flush()
      out = out.map((x, c) => {
        const j = new Float32Array(x.length + rest[c].length)
        j.set(x)
        j.set(rest[c], x.length)
        return j
      })
      this.close()
    }
    // (A first window shorter than the limiter's delay: nothing yet.)
    if (!out[0].length) return this.next()
    const b = new AudioBuffer({ length: out[0].length, sampleRate: MIX_RATE, numberOfChannels: 2 })
    b.copyToChannel(out[0] as Float32Array<ArrayBuffer>, 0)
    b.copyToChannel(out[1] as Float32Array<ArrayBuffer>, 1)
    return b
  }

  /** What the limiter did. */
  get limited(): LimiterStats {
    return this.limiter.stats
  }

  /** Done with (the readers let go). */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.readers.release()
  }
}

