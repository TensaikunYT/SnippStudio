// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { AudioBufferSink } from 'mediabunny'
import { volumeAt } from '../audio/envelope'
import { resample, resampleAt, resampledLength } from '../audio/resample'
import { stretch, stretchInputSpan, stretchPlan, type StretchSpeed } from '../audio/time-stretch'
import { audibleGain, keepsPitch } from '../timeline/speed'
import { clipAudible, curveMediaAt, hasCurve } from '../timeline/speed-curve'
import { localAtMedia, mediaAtLocal } from '../timeline/media-time'
import { detectSpeechActivity } from '../audio/ducking'
import { getAudioSink } from '../media/sources'
import { clipMediaAt, soundWindows } from '../playback/render'
import type { Asset, Project } from '../types'
import { assetById, flatClipsOfTrack, projectDuration, trackAudible } from '../types'
import { batchReduction, declickAt, declickEdges, levelAt, levelCurve, transitionAudioFade, trimAudioPacket, type AudioSkip } from './audio-window'
import { cancellable } from './cancel'

export type { AudioSkip, AudioSkipReason } from './audio-window'

/** How long a recording may take to open, and how long its decoding may go
 *  without handing over anything, before its sound is given up on (and
 *  reported through `onSkip`) instead of hanging the whole mix. Tests
 *  shorten them. */
export const AUDIO_MIX_LIMITS = { openMs: 15000, stallMs: 20000 }

/** Assets whose SHARED audio Input (media/sources) a mix is reading now. A
 *  second mix at the same time (a transcription started again after Cancel,
 *  a word-timing check during one) opens its own Input for them instead: two
 *  iterators on one demuxer can steal reads or stall one another, and a
 *  stall made the watchdog drop the voice. An asset stays claimed until
 *  every decode of it has settled, so an abandoned (stalled) decoder keeps
 *  later mixes off its Input. */
const sharedAudioBusy = new Set<string>()

function audioReaders(): {
  open: (asset: Asset) => Promise<AudioBufferSink | null>
  hold: (assetId: string, job: Promise<unknown>) => void
  release: () => void
} {
  const sinks = new Map<string, Promise<AudioBufferSink | null>>()
  const work = new Map<string, Promise<unknown>[]>()
  return {
    open(asset) {
      let sink = sinks.get(asset.id)
      if (!sink) {
        const shared = !sharedAudioBusy.has(asset.id)
        sink = getAudioSink(asset, !shared)
        if (shared) {
          sharedAudioBusy.add(asset.id)
          work.set(asset.id, [sink])
        }
        sinks.set(asset.id, sink)
      }
      return sink
    },
    hold(assetId, job) {
      work.get(assetId)?.push(job)
    },
    release() {
      for (const [id, jobs] of work) void Promise.allSettled(jobs).then(() => sharedAudioBusy.delete(id))
    }
  }
}

/** `job`, or 'timeout' after `ms` (the timer is cleared either way). */
function orTimeout<T>(job: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([job, new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), ms) })])
    .finally(() => clearTimeout(timer))
}

/** A decoded batch rendered down to an analysis mix's rate and channels
 *  (see batchReduction) by WebAudio itself: the same speaker downmix and
 *  rate conversion the mix's own destination would have applied, done
 *  before the batch is held until rendering, so a 16 kHz mono transcription
 *  holds a sixth of a 48 kHz stereo recording instead of all of it. */
async function reduceBatch(buf: AudioBuffer, sampleRate: number, channels: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.ceil(buf.duration * sampleRate)), sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = buf
  source.connect(ctx.destination)
  source.start(0)
  return ctx.startRendering()
}

/**
 * Noise gate, applied straight to the decoded samples.
 *
 * WebAudio has no gate node, and the compressor is the wrong shape for this: a
 * compressor pulls the LOUD parts down, while what a room-tone problem needs is
 * the QUIET parts pulled to nothing. So it runs here, on the buffer, where a
 * proper envelope follower with attack, hold and release is a dozen lines and
 * exact — no approximation to explain later.
 *
 * `state` carries the follower across the ~20 s batches a clip is decoded in,
 * so the gate doesn't re-open at every batch boundary.
 */
function applyNoiseGate(
  buf: AudioBuffer,
  opts: { threshold: number; release: number },
  state: { env: number; gain: number; hold: number }
): void {
  const sr = buf.sampleRate
  const thresh = 10 ** (opts.threshold / 20)
  // Envelope follower time constants. Attack is fast enough not to clip the
  // front of a word; hold keeps the gate open through the short dips inside
  // one, which is what stops it chattering.
  const attackCoef = Math.exp(-1 / (0.002 * sr))
  const envCoef = Math.exp(-1 / (0.03 * sr))
  const holdSamples = Math.round(0.06 * sr)
  const releaseCoef = Math.exp(-1 / (Math.max(10, opts.release) / 1000) / sr)
  const chans: Float32Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  const n = buf.length
  for (let i = 0; i < n; i++) {
    let peak = 0
    for (const ch of chans) {
      const v = Math.abs(ch[i])
      if (v > peak) peak = v
    }
    // Rectified, smoothed level: fast up, slow down.
    state.env = peak > state.env ? peak + (state.env - peak) * attackCoef : peak + (state.env - peak) * envCoef
    if (state.env >= thresh) {
      state.hold = holdSamples
      state.gain = 1
    } else if (state.hold > 0) {
      state.hold--
    } else {
      state.gain *= releaseCoef
      if (state.gain < 1e-4) state.gain = 0
    }
    if (state.gain < 1) for (const ch of chans) ch[i] *= state.gain
  }
}

/**
 * Renders the project's audio mix (every audio clip plus the audio tracks of
 * video clips) into a single AudioBuffer via OfflineAudioContext. Used at
 * 48 kHz stereo for the export's short stretches (export/audio-stream.ts
 * mixes a film window by window) and at 16 kHz mono for transcription.
 *
 * A clip whose sound cannot be read (no sound track, the file does not open
 * in time, a decode error, a decoder that stops making progress) is left out
 * from that point rather than hanging the mix; `onSkip` hears about each one,
 * so the caller can tell the user instead of handing over a file with the
 * voice silently missing.
 */
export async function mixProjectAudio(
  project: Project,
  sampleRate: number,
  channels: number,
  onStage?: (label: string, fraction?: number) => void,
  /** Render only this timeline window (seconds). Everything is scheduled
   *  relative to `range[0]`, so a marked-range re-transcribe mixes just the
   *  marked seconds instead of the whole project. */
  range?: [number, number],
  signal?: AbortSignal,
  onSkip?: (skip: AudioSkip) => void
): Promise<AudioBuffer> {
  const readers = audioReaders()
  try {
    const a = range ? Math.max(0, range[0]) : 0
    const b = range ? Math.min(projectDuration(project), range[1]) : projectDuration(project)
    const frames = Math.ceil(Math.max(0.5, b - a) * sampleRate)
    return await mixSpan(readers, project, sampleRate, channels, a, frames, { onStage, signal, onSkip })
  } finally {
    readers.release()
  }
}

/** What a span's mixing is told and tells. */
export interface SpanOptions {
  onStage?: (label: string, fraction?: number) => void
  signal?: AbortSignal
  onSkip?: (skip: AudioSkip) => void
  /** Clips given up on in an earlier span of the same mix (a stalled
   *  decoder): left out from here on, not waited for again. */
  gone?: Set<string>
}

/** The readers one mix shares across its spans (a file opened once). */
export type AudioReaders = ReturnType<typeof audioReaders>
export { audioReaders }

/** Decoding starts this much before the span (a decoder's first packets,
 *  the resampler's reach); what lies before the span is not heard. */
const DECODE_LEAD = 0.25
/** And reaches this much past it. */
const DECODE_TAIL = 0.02

/**
 * `frames` samples of the mix from project time `start` on (the span), in a
 * fresh OfflineAudioContext. Only the media each clip plays inside the span
 * is decoded. Each decoded piece: the noise gate, then (a 48 kHz stereo mix,
 * a recording at another rate) the windowed-sinc resampler to 48 kHz
 * (audio/resample.ts; R11), or (an analysis mix) brought down to the mix's
 * rate and channels; then the clip's level — its volume, keyframes, fades,
 * the transition crossfade, and at a hard cut the 4 ms declick (R9) — on
 * the samples themselves (it was a 20 Hz curve on a gain node); then
 * scheduled on the clip's effect chain.
 */
export async function mixSpan(
  readers: AudioReaders,
  project: Project,
  sampleRate: number,
  channels: number,
  start: number,
  frames: number,
  opts: SpanOptions = {}
): Promise<AudioBuffer> {
  const { onStage, signal, onSkip } = opts
  const checkCancelled = (): void => { if (signal?.aborted) throw new DOMException('Audio rendering cancelled', 'AbortError') }
  checkCancelled()
  const rangeStart = start
  const duration = frames / sampleRate
  const rangeEnd = start + duration
  const offline = new OfflineAudioContext(channels, Math.max(1, frames), sampleRate)
  // The export's own mix (48 kHz stereo): recordings at another rate are
  // converted here, with the sinc (an analysis mix is brought down instead).
  const exportMix = batchReduction({ sampleRate, channels }, { sampleRate: 48000, channels: 2 }) === null && sampleRate === 48000

  // Count the clips we'll actually decode, for progress reporting.
  const audible = project.tracks
    .filter((t) => trackAudible(project, t))
    .flatMap((t) => flatClipsOfTrack(project, t))
    .filter((c) => {
      const a = assetById(project, c.assetId)
      const silent = c.muted || (c.volume <= 0 && !(c.volumeKeyframes && c.volumeKeyframes.length > 0))
      return a && !a.missing && a.hasAudio && !silent && !c.audioExtracted && c.freeze === undefined && !c.reversed && !c.disabled && clipAudible(c)
    }).length
  let doneClips = 0

  for (const track of project.tracks) {
    if (!trackAudible(project, track)) continue
    // Compound clips are expanded so grouped footage keeps its sound.
    const trackClips = flatClipsOfTrack(project, track)
    for (const clip of trackClips) {
      checkCancelled()
      const asset = clip ? assetById(project, clip.assetId) : undefined
      // A muted clip contributes nothing, so it isn't decoded at all.
      const silent =
        clip && (clip.muted || (clip.volume <= 0 && !(clip.volumeKeyframes && clip.volumeKeyframes.length > 0)))
      if (!clip || !asset || asset.missing || !asset.hasAudio || silent || clip.audioExtracted) continue
      // Freeze frames and reversed clips contribute no sound; nor does a
      // clip slower than 0.25x or faster than 8x (the preview's rule too:
      // timeline/speed.ts; a compound's speed is in a flattened child's).
      if (clip.freeze !== undefined || clip.reversed || clip.disabled || !clipAudible(clip)) continue
      if (opts.gone?.has(clip.id)) continue
      // Skip clips entirely outside the requested window.
      // (A sound on a track of its own crosses with its picture: phase
      // Ç2b.2, decision 4.)
      const { out: outWin, in: soundIn } = soundWindows(project, clip)
      if (clip.start + clip.duration + outWin.post <= rangeStart || clip.start >= rangeEnd) continue

      onStage?.(`Extracting audio… clip ${doneClips + 1}/${audible}`, audible > 0 ? doneClips / audible : 0)
      const sink = await cancellable(orTimeout(readers.open(asset), AUDIO_MIX_LIMITS.openMs), signal)
      checkCancelled()
      if (!sink || sink === 'timeout') {
        console.warn(`Audio for "${asset.name}" ${sink ? 'did not open in time' : 'has no sound track'} — its sound was skipped.`)
        onSkip?.({ clipId: clip.id, name: asset.name, at: Math.max(clip.start, rangeStart), reason: sink ? 'open-timeout' : 'no-sound-track' })
        opts.gone?.add(clip.id)
        doneClips++
        continue
      }

      // Per-clip audio effects chain: EQ → filters → compressor → out. Its
      // level is on the samples (below); the head is a plain join.
      const gain = offline.createGain()
      const fx = clip.audioFx
      let head: AudioNode = gain
      const link = (node: AudioNode) => {
        head.connect(node)
        head = node
      }
      if (fx) {
        if (fx.highpass > 0) {
          const f = offline.createBiquadFilter()
          f.type = 'highpass'
          f.frequency.value = fx.highpass
          link(f)
        }
        if (fx.lowpass > 0) {
          const f = offline.createBiquadFilter()
          f.type = 'lowpass'
          f.frequency.value = fx.lowpass
          link(f)
        }
        if (fx.eqLow !== 0) {
          const f = offline.createBiquadFilter()
          f.type = 'lowshelf'
          f.frequency.value = 200
          f.gain.value = fx.eqLow
          link(f)
        }
        if (fx.eqMid !== 0) {
          const f = offline.createBiquadFilter()
          f.type = 'peaking'
          f.frequency.value = 1000
          f.Q.value = 0.9
          f.gain.value = fx.eqMid
          link(f)
        }
        if (fx.eqHigh !== 0) {
          const f = offline.createBiquadFilter()
          f.type = 'highshelf'
          f.frequency.value = 6000
          f.gain.value = fx.eqHigh
          link(f)
        }
        if (fx.comp.enabled) {
          const c = offline.createDynamicsCompressor()
          c.threshold.value = fx.comp.threshold
          c.ratio.value = fx.comp.ratio
          c.knee.value = 10
          c.attack.value = 0.003
          c.release.value = 0.25
          link(c)
        }
      }
      head.connect(offline.destination)

      // The level: base volume, volume keyframes, fades, and the transition
      // crossfade — read from the same window helper the picture uses, so
      // the sound crosses over exactly where the image does however the
      // transition is aligned — every millisecond of the stretch this span
      // hears, and at a hard cut the declick (phase Ç3b, decision 2).
      const inWin = soundIn
      const tail = outWin.post
      // A speed curve (core polish C) bends the clip's clock as a ramp at a
      // cut does: the same paths, the curve's own inverse.
      const curved = hasCurve(clip)
      const ramped = curved || (asset.kind === 'video' && (outWin.type === 'speed-ramp' || inWin.type === 'speed-ramp'))
      const localForMedia = (mediaTime: number): number => {
        if (curved) return localAtMedia(clip, mediaTime)
        let low = 0
        let high = clip.duration
        for (let i = 0; i < 28; i++) {
          const mid = (low + high) / 2
          if (clipMediaAt(project, clip, clip.start + mid).time < mediaTime) low = mid
          else high = mid
        }
        return (low + high) / 2
      }
      const envelopeDur = clip.duration + tail
      const edges = declickEdges(clip, trackClips, outWin, inWin)
      const fps = project.settings.fps
      const winStartInClip = Math.max(0, rangeStart - clip.start)
      const winEndInClip = Math.min(envelopeDur, rangeEnd - clip.start)
      const level = levelCurve(
        (local) => volumeAt(clip, local) * transitionAudioFade(clip.start + local, clip, outWin, inWin, fps),
        Math.max(0, winStartInClip - DECODE_LEAD),
        Math.min(envelopeDur, winEndInClip + DECODE_TAIL)
      )
      // (Along a curve, heard only where it plays between 0.25x and 8x.)
      const audibleAt = (local: number): number => (curved ? audibleGain(curveMediaAt(clip, local)?.rate ?? 1) : 1)
      const gainAt = (local: number): number => (local < 0 || local > envelopeDur ? 0 : levelAt(level, local) * declickAt(local, clip.duration, edges) * audibleAt(local))

      // Decode only the media range this clip actually uses. At a speed
      // other than 1 the clip keeps its pitch (the export's own mix: the
      // time stretch, `placeStretched` below) unless "Keep pitch" is off —
      // then the media is played faster or slower via playbackRate and the
      // pitch follows. The preview does the same either way (engine.ts:
      // preservesPitch). A speed ramp at a cut bends the pitch, as before.
      const speed = clip.speed ?? 1
      const stretched = exportMix && keepsPitch(clip) && (curved || (!ramped && speed !== 1))
      // Output sample → input sample of the stretch: one speed, or the curve.
      const stretchSpeed: StretchSpeed = curved ? (m: number): number => (mediaAtLocal(clip, m / sampleRate) - clip.inPoint) * sampleRate : speed
      /** …and back: the output sample input sample `j` stands for. */
      const outOf = (j: number): number => (curved ? localAtMedia(clip, clip.inPoint + j / sampleRate) * sampleRate : j / speed)
      // Decode only the media that lands inside the render window — for a
      // marked-range re-transcribe this is a few seconds, not the whole clip.
      const from = ramped ? clipMediaAt(project, clip, clip.start + winStartInClip).time
        : clip.inPoint + winStartInClip * speed
      const to = Math.min(asset.duration, ramped
        ? clipMediaAt(project, clip, clip.start + winEndInClip).time
        : clip.inPoint + winEndInClip * speed)
      if (to <= from + 1e-4) continue
      let decodeFrom = Math.max(0, from - DECODE_LEAD * speed)
      let decodeTo = Math.min(asset.duration, to + DECODE_TAIL * speed)
      // The stretch works on the clip's own sample grid: clip-local output
      // sample m is span sample m + spanShift, input sample j the media at
      // in point + j / rate. This span hears its samples [outFrom, outTo);
      // the stretch reads the input from the anchor before them on
      // (audio/time-stretch.ts), so that much more is decoded.
      const plan = stretched ? stretchPlan(sampleRate) : null
      const spanShift = Math.round(clip.start * sampleRate) - Math.round(rangeStart * sampleRate)
      const outFrom = Math.max(0, -spanShift)
      const outTo = Math.min(frames - spanShift, Math.ceil(Math.min(envelopeDur, curved ? localAtMedia(clip, asset.duration) : (asset.duration - clip.inPoint) / speed) * sampleRate))
      if (plan) {
        if (outTo <= outFrom) continue
        const [j0, j1] = stretchInputSpan(stretchSpeed, outFrom, outTo - outFrom, plan)
        decodeFrom = Math.max(0, clip.inPoint + j0 / sampleRate - 0.01)
        decodeTo = Math.min(asset.duration, clip.inPoint + j1 / sampleRate + 0.01)
      }
      // Guard against a decoder stall on one bad file: if this clip's audio
      // stops making progress for 20s, skip it instead of hanging the whole
      // extraction (reported through onSkip; the rest still renders).
      let watchdog = 0
      // Set when the stall guard gives up on this clip: the decoder is told
      // to stop, and nothing it hands over later is scheduled — it would
      // land on a context that is already rendering, at the wrong time.
      let abandoned = false
      let stopDecoder: (() => void) | undefined
      // Media time up to which this clip's sound has been scheduled, and
      // the timeline second that is (where a skip says the sound is lost).
      let heardUntil = from
      const timelineAt = (media: number): number =>
        clip.start + Math.max(0, ramped ? localForMedia(media) : (media - clip.inPoint) / speed)

      /** Schedules ONE decoded buffer at its timeline position. */
      const schedule = (timestamp: number, buf: AudioBuffer): void => {
        if (abandoned) return
        if (curved) {
          // A speed curve with the pitch following it (core polish C): only
          // where it is heard (its rate held at 16 through a stretch faster
          // than that would put the rest of the buffer late), in pieces of
          // at most half a second, each started on its own exact media.
          const mediaFrom = Math.max(from, timestamp)
          const mediaTo = Math.min(to, timestamp + buf.duration)
          if (mediaTo <= mediaFrom + 1e-5) return
          const a0 = localForMedia(mediaFrom)
          const b0 = localForMedia(mediaTo)
          const piece = (lA: number, lB: number): void => {
            const span = lB - lA
            const whenRaw = clip.start + lA - rangeStart
            if (span <= 1e-5 || whenRaw < -1e-4 || whenRaw >= duration) return
            const mA = Math.max(mediaFrom, mediaAtLocal(clip, lA))
            const mB = Math.min(mediaTo, mediaAtLocal(clip, lB))
            if (mB <= mA + 1e-6) return
            const source = offline.createBufferSource()
            source.buffer = buf
            const samples = Math.max(2, Math.ceil(span * 60) + 1)
            const speeds = new Float32Array(samples)
            for (let i = 0; i < samples; i++) speeds[i] = Math.min(16, Math.abs(curveMediaAt(clip, lA + (span * i) / (samples - 1))?.rate ?? 1))
            source.playbackRate.setValueCurveAtTime(speeds, Math.max(0, whenRaw), span)
            source.connect(gain)
            source.start(Math.max(0, whenRaw), mA - timestamp, mB - mA)
          }
          let run: number | null = null
          for (let x = a0; ; x += 0.005) {
            const at = Math.min(x, b0)
            const heard = audibleGain(curveMediaAt(clip, at)?.rate ?? 1) > 0
            if (heard && run === null) run = at
            if ((!heard || at >= b0) && run !== null) {
              for (let y = run; y < at - 1e-6; y += 0.5) piece(y, Math.min(at, y + 0.5))
              run = null
            }
            if (at >= b0) break
          }
          return
        }
        if (ramped) {
          const mediaFrom = Math.max(from, timestamp)
          const mediaTo = Math.min(to, timestamp + buf.duration)
          if (mediaTo <= mediaFrom + 1e-5) return
          const startLocal = localForMedia(mediaFrom)
          const endLocal = localForMedia(mediaTo)
          const span = endLocal - startLocal
          const whenRaw = clip.start + startLocal - rangeStart
          if (span <= 1e-5 || whenRaw < -1e-4 || whenRaw >= duration) return
          const when = Math.max(0, whenRaw)
          const source = offline.createBufferSource()
          source.buffer = buf
          const samples = Math.max(2, Math.ceil(span * 60) + 1)
          const speeds = new Float32Array(samples)
          for (let i = 0; i < samples; i++) {
            speeds[i] = Math.min(16, clipMediaAt(project, clip,
              clip.start + startLocal + span * i / (samples - 1)).rate)
          }
          source.playbackRate.setValueCurveAtTime(speeds, when, span)
          source.connect(gain)
          source.start(when, mediaFrom - timestamp, mediaTo - mediaFrom)
          return
        }
        const packet = trimAudioPacket(timestamp, buf.duration, from, to)
        if (!packet) return
        const when = Math.max(0, clip.start + (packet.mediaStart - clip.inPoint) / speed - rangeStart)
        if (when >= duration) return
        const source = offline.createBufferSource()
        source.buffer = buf
        source.playbackRate.value = speed
        source.connect(gain)
        source.start(when, packet.offset, packet.duration)
      }

      /** The export's own mix, a clip at its own speed: a decoded piece
       *  (starting at media time `ts`) put straight onto the span's 48 kHz
       *  grid — each sample read at its exact media time (the windowed sinc
       *  for a recording at another rate; a 48 kHz one's own samples, at most
       *  half a sample (10 µs) from where they fall), its level on it, and
       *  started on a whole sample. Scheduled at a fraction of a sample, Web
       *  Audio read it between two samples, a straight line, and not at the
       *  same fraction in every window of the mix (phase Ç3b, decision 1). */
      const place = (ts: number, buf: AudioBuffer): void => {
        if (abandoned) return
        const sr = buf.sampleRate
        const mediaFrom = Math.max(from, ts)
        const mediaTo = Math.min(to, ts + buf.duration)
        if (mediaTo <= mediaFrom + 1e-9) return
        // Span time = media time + off.
        const off = clip.start - clip.inPoint - rangeStart
        const n0 = Math.max(0, Math.ceil((mediaFrom + off) * sampleRate - 1e-6))
        const n1 = Math.min(frames, Math.ceil((mediaTo + off) * sampleRate - 1e-6))
        if (n1 <= n0) return
        let p0 = (n0 / sampleRate - off - ts) * sr
        if (sr === sampleRate) p0 = Math.round(p0)
        const n = n1 - n0
        const out = offline.createBuffer(buf.numberOfChannels, n, sampleRate)
        const g = new Float32Array(n)
        for (let k = 0; k < n; k++) g[k] = gainAt(rangeStart + (n0 + k) / sampleRate - clip.start)
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = resampleAt(buf.getChannelData(c), sr, sampleRate, p0, n)
          for (let k = 0; k < n; k++) d[k] *= g[k]
          out.copyToChannel(d, c)
        }
        const source = offline.createBufferSource()
        source.buffer = out
        source.connect(gain)
        source.start(n0 / sampleRate)
      }

      /** The export's own mix, a clip at another speed that keeps its pitch:
       *  the part of this span's samples whose media lies in a decoded piece
       *  (starting at media time `ts`), stretched on the clip's own grid —
       *  the same samples whichever window asks — its level on it, started
       *  on a whole sample. A recording at another rate is first read onto
       *  the 48 kHz grid of its media (the windowed sinc). */
      const placeStretched = (ts: number, buf: AudioBuffer): void => {
        if (abandoned || !plan) return
        const sr = buf.sampleRate
        // The piece in input samples (media seconds from the in point × rate).
        const pieceFrom = (ts - clip.inPoint) * sampleRate
        const pieceTo = (ts + buf.duration - clip.inPoint) * sampleRate
        const m0 = Math.max(outFrom, Math.ceil(outOf(pieceFrom) - 1e-6))
        const m1 = Math.min(outTo, Math.ceil(outOf(pieceTo) - 1e-6))
        if (m1 <= m0) return
        const n = m1 - m0
        const chans: Float32Array[] = []
        let inputStart: number
        if (sr === sampleRate) {
          inputStart = Math.round(pieceFrom)
          for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
        } else {
          const [j0, j1] = stretchInputSpan(stretchSpeed, m0, n, plan)
          inputStart = Math.max(j0, Math.ceil(pieceFrom))
          const count = Math.max(0, Math.min(j1, Math.floor(pieceTo)) - inputStart)
          const p0 = (clip.inPoint + inputStart / sampleRate - ts) * sr
          for (let c = 0; c < buf.numberOfChannels; c++) chans.push(resampleAt(buf.getChannelData(c), sr, sampleRate, p0, count))
        }
        const made = stretch(chans, inputStart, stretchSpeed, m0, n, plan)
        const n0 = m0 + spanShift
        const out = offline.createBuffer(buf.numberOfChannels, n, sampleRate)
        const g = new Float32Array(n)
        for (let k = 0; k < n; k++) g[k] = gainAt(rangeStart + (n0 + k) / sampleRate - clip.start)
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = made[c]
          for (let k = 0; k < n; k++) d[k] *= g[k]
          out.copyToChannel(d, c)
        }
        const source = offline.createBufferSource()
        source.buffer = out
        source.connect(gain)
        source.start(n0 / sampleRate)
      }

      /** The level onto a decoded piece's samples (it starts at media time
       *  `ts`): each sample's clip-local time from its media time. */
      const levelOnto = (buf: AudioBuffer, ts: number): void => {
        const rate = buf.sampleRate
        const n = buf.length
        const g = new Float32Array(n)
        if (!ramped) {
          for (let i = 0; i < n; i++) g[i] = gainAt((ts + i / rate - clip.inPoint) / speed)
        } else {
          // A speed ramp: clip-local times every 5 ms of media, straight between.
          const step = 0.005
          const m = Math.ceil(n / rate / step) + 2
          const knots = new Float64Array(m)
          for (let k = 0; k < m; k++) knots[k] = localForMedia(ts + k * step)
          for (let i = 0; i < n; i++) {
            const p = i / rate / step
            const k = Math.min(m - 2, Math.floor(p))
            g[i] = gainAt(knots[k] + (knots[k + 1] - knots[k]) * (p - k))
          }
        }
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const d = buf.getChannelData(c)
          for (let i = 0; i < n; i++) d[i] *= g[i]
        }
      }

      // The decoder hands back small packets (tens of ms). Giving each one its
      // own AudioBufferSourceNode meant an 8-minute clip scheduled TENS OF
      // THOUSANDS of nodes, and OfflineAudioContext.startRendering() then took
      // effectively forever — which is exactly why short clips mixed fine and
      // long ones hung at "mixing". Packets are concatenated into ~20 s buffers
      // first, so node count stays in the tens regardless of length. (The
      // export's spans are about 30 s: one piece each, so the resampler sees
      // it whole.)
      const gateOpts =
        fx?.gate?.enabled ? { threshold: fx.gate.threshold, release: fx.gate.release } : null
      const gateState = { env: 0, gain: 1, hold: 0 }

      const BATCH_SEC = exportMix ? Infinity : 20
      let batch: { ts: number; buf: AudioBuffer }[] = []
      let batchSec = 0

      const flush = async (): Promise<void> => {
        if (batch.length === 0 || abandoned) return
        const taken = batch
        batch = []
        batchSec = 0
        const first = taken[0]
        const last = taken[taken.length - 1]
        const sr = first.buf.sampleRate
        const ch = first.buf.numberOfChannels
        const totalSec = last.ts + last.buf.duration - first.ts
        const len = Math.max(1, Math.ceil(totalSec * sr))
        let merged = offline.createBuffer(ch, len, sr)
        for (const b of taken) {
          const off = Math.round((b.ts - first.ts) * sr)
          if (off >= len) continue
          const room = len - off
          for (let c = 0; c < ch; c++) {
            const src = b.buf.getChannelData(Math.min(c, b.buf.numberOfChannels - 1))
            const slice = src.length > room ? src.subarray(0, room) : src
            merged.copyToChannel(slice, c, off)
          }
        }
        // Gate the decoded samples before they are scheduled — see
        // applyNoiseGate. Everything downstream (EQ, compressor, the volume
        // envelope) then works on already-clean audio.
        if (gateOpts) applyNoiseGate(merged, gateOpts, gateState)
        if (exportMix && !ramped && speed === 1) {
          place(first.ts, merged)
          heardUntil = Math.max(heardUntil, last.ts + last.buf.duration)
          return
        }
        if (stretched) {
          placeStretched(first.ts, merged)
          heardUntil = Math.max(heardUntil, last.ts + last.buf.duration)
          return
        }
        // The export's mix: a recording at another rate is made 48 kHz here,
        // with the windowed sinc (phase Ç3b, decision 3; report R11), not by
        // Web Audio's straight line between two samples.
        if (exportMix && sr !== sampleRate) {
          const out = offline.createBuffer(ch, resampledLength(len, sr, sampleRate), sampleRate)
          for (let c = 0; c < ch; c++) out.copyToChannel(resample(merged.getChannelData(c), sr, sampleRate), c)
          merged = out
        }
        // Every scheduled batch is held until the whole mix renders. For an
        // analysis mix (16 kHz mono transcription…) a batch of a second or
        // more is first brought down to the mix's rate and channels, so the
        // 48 kHz stereo recording is not held in full; schedule() works in
        // seconds, so nothing else changes. The 48 kHz stereo export never
        // takes this (batchReduction). Tiny batches (gaps) are kept as they
        // are: not worth a render each.
        const reduce = merged.duration >= 1
          ? batchReduction({ sampleRate, channels }, { sampleRate: merged.sampleRate, channels: ch })
          : null
        const held = reduce ? await reduceBatch(merged, reduce.sampleRate, reduce.channels) : merged
        if (abandoned) return
        levelOnto(held, first.ts)
        schedule(first.ts, held)
        heardUntil = Math.max(heardUntil, last.ts + last.buf.duration)
      }

      const decodeClip = async () => {
        const iterator = sink.buffers(decodeFrom, decodeTo)
        stopDecoder = () => { void iterator.return().catch(() => {}) }
        try { while (!abandoned) {
          const next = await cancellable(iterator.next(), signal, () => { void iterator.return().catch(() => {}) })
          if (abandoned) return
          if (next.done) break
          const wrapped = next.value
          checkCancelled()
          watchdog++
          const startInClip = ramped ? localForMedia(wrapped.timestamp) : (wrapped.timestamp - clip.inPoint) / speed
          const when = clip.start + Math.max(0, startInClip) - rangeStart
          // (A stretched clip reads on to the end of its last frame.)
          if (stretched ? wrapped.timestamp >= decodeTo : when >= duration + DECODE_TAIL) break
          // Keep the packets from the decoding lead on (the gate and the
          // resampler read them; schedule() trims to the span).
          if (wrapped.timestamp + wrapped.buffer.duration <= decodeFrom) continue
          // A gap or a format change closes the current batch (batches must be
          // contiguous and share sample rate / channel count).
          const first = batch[0]
          const last = batch[batch.length - 1]
          if (
            first &&
            (wrapped.buffer.sampleRate !== first.buf.sampleRate ||
              wrapped.buffer.numberOfChannels !== first.buf.numberOfChannels ||
              Math.abs(wrapped.timestamp - (last.ts + last.buf.duration)) > 0.05)
          ) {
            await flush()
          }
          batch.push({ ts: wrapped.timestamp, buf: wrapped.buffer })
          batchSec += wrapped.buffer.duration
          if (batchSec >= BATCH_SEC) await flush()
        } } catch (err) {
          // A decode error: what was decoded before it is still heard.
          if (!signal?.aborted && !abandoned) await flush().catch(() => {})
          throw err
        } finally { void iterator.return().catch(() => {}) }
        await flush()
      }
      const decodeDone = decodeClip().then(
        () => 'ok' as const,
        (err) => {
          if (signal?.aborted) throw err
          // Already given up on (and reported) by the stall guard.
          if (abandoned) return 'ok' as const
          console.warn(`Audio decode failed for "${asset.name}" — its sound was skipped:`, err)
          onSkip?.({ clipId: clip.id, name: asset.name, at: timelineAt(heardUntil), reason: 'decode-error' })
          return 'ok' as const
        }
      )
      readers.hold(asset.id, decodeDone)
      let stallTimer: ReturnType<typeof setInterval> | undefined
      const stallGuard = new Promise<'stalled'>((resolve) => {
        let last = -1
        stallTimer = setInterval(() => {
          if (watchdog === last) resolve('stalled')
          last = watchdog
        }, AUDIO_MIX_LIMITS.stallMs)
      })
      let result: 'ok' | 'stalled'
      try { result = await Promise.race([decodeDone, stallGuard]) }
      finally { clearInterval(stallTimer) }
      if (result === 'stalled') {
        abandoned = true
        stopDecoder?.()
        opts.gone?.add(clip.id)
        console.warn(`Audio decode stalled for "${asset.name}" — its sound was skipped in this mix.`)
        onSkip?.({ clipId: clip.id, name: asset.name, at: timelineAt(heardUntil), reason: 'stalled' })
      }
      doneClips++
    }
  }

  onStage?.('Extracting audio… mixing', 0.95)
  checkCancelled()
  const rendered = await cancellable(offline.startRendering(), signal)
  checkCancelled()
  return rendered
}

/** Downmixed mono Float32 samples at the given rate — Whisper input format. */
export async function projectAudioMono(
  project: Project,
  sampleRate = 16000,
  onStage?: (label: string, fraction?: number) => void,
  range?: [number, number],
  /** Stops the mix (a cancelled transcription): it rejects with an AbortError. */
  signal?: AbortSignal
): Promise<Float32Array> {
  const buffer = await mixProjectAudio(project, sampleRate, 1, onStage, range, signal)
  return buffer.getChannelData(0).slice()
}

/**
 * Speech activity from one explicit dialogue track, sampled at 10 Hz.
 */
export async function trackSpeechActivity(project: Project, sourceTrackId: string): Promise<boolean[]> {
  const p2 = structuredClone(project)
  for (const t of p2.tracks) {
    t.muted = t.id !== sourceTrackId
    // Solo is a monitoring aid, not part of the mix's meaning: leaving it on
    // would make ducking analyse only the soloed track and mis-detect speech.
    delete t.solo
  }
  const mono = await projectAudioMono(p2, 16000)
  return detectSpeechActivity(mono, 16000, 0.1)
}
