// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import {
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  canEncodeAudio,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type StreamTarget
} from 'mediabunny'
import { formatOf, type ExportContainer } from './formats'
import { aacSteps, AUDIO_BITRATE, FILM_AUDIO_BITRATE, FILM_BITRATE_FACTOR, videoBitrateOf } from './quality'
import { checkRoomFor, fileTarget, freeSpaceAt, outputFormat, packetBounds, plainFileError, saveWholeFile } from './file-target'
import { sizeLabel, verifyWritten } from './verify'
export { scaleForLines } from './quality'
export { filmChapters, youtubePackage } from './youtube'
// The encoders this computer is said to have, for the e2e (phase 10b.1).
export { setCodecCapsForTests } from './codec-caps'
import { codecCaps } from './codec-caps'
import { getInput, getVideoSink, lastVideoFrameTime, videoPresentationOffset } from '../media/sources'
import { browserFiles } from '../platform'
import { codeFilms } from '../media/codefilm'
import { clipMediaAt, renderFrame, renderList, shortsWindowAt } from '../playback/render'
import { shortsCropX } from '../playback/pose'
import type { Asset, Clip, Project } from '../types'
import { loadBundledFonts } from '../fonts'
import { ensureProjectLuts } from '../luts'
import { assetById, flatClipsOfTrack, flattenClips, projectDuration } from '../types'
import { type AudioSkip } from './audio'
import { timelineSfxEvents } from '../audio/timeline-sfx'
import { describeAudioSkip, exportCarriesSound } from './audio-window'
import { ExportMix, MIX_WINDOW_SEC, type MixPassProgress } from './audio-stream'
import { WorkBar } from './progress'
import { cancellable, checkRenderCancelled } from './cancel'
import { probeSet, wantsParallel } from './parallel-plan'
import { ClipFrameCursor, FRAME_EPS, ReverseCursor, staleClips } from './frame-cursor'
import { normalizeNote } from './normalize'
import { noteExportJob } from './job'
import { api } from '../platform'
import { fpsLabel, hardwareFailed, isEncoderFault, markHardwareFailed, probeEncoder, refusal, videoChoice, videoCodecString, type EncoderPref, type HwPref, type VideoChoice } from './encoder'
import { frameTime } from '../timeline/rates'
import { t, t as text } from '../ui/strings'
import { codeFilmsEnlarged, hdrShown } from './preflight'
import { PRODUCT_NAME } from '../../../shared/product'

/** A key frame every 2 s, said (phase Ç3a, decision 8). */
export const KEY_FRAME_INTERVAL = 2
/** What a reversed clip's kept frames may take (bytes; decision 7): 32
 *  frames at 4K. */
export const REVERSE_BYTES = 1100e6

export interface ExportSettings {
  /** Output resolution scale relative to the project (0.5, 1, 2). */
  resolutionScale: number
  fps: number
  /** Bitrate factor: ~0.08 standard, 0.12 high, 0.2 maximum; unset, the
   *  films' default (export/quality.ts: about 35 Mbps for 1080p60). */
  bitrateFactor: number
  /** The sound's AAC bitrate asked (bits/s); the encoder's best at or under
   *  it is used. Unset: 192 kbps, or 320 kbps at the films' default. */
  audioBitrate?: number
  /** In shorts mode: export the 9:16 crop (default) or the full 16:9 video. */
  target?: 'shorts' | 'landscape'
  /** Render only this [start, end] slice of the timeline (seconds). */
  range?: [number, number]
  /** Output container: MP4 (default), WebM, or sound only (MP3, M4A, WAV). */
  container?: ExportContainer
  /** Normalize loudness to ≈ -14 LUFS (YouTube standard). */
  normalize?: boolean
  /** Absolute video bitrate override (bits/s) — the "Custom" quality option. */
  videoBitrate?: number
  /** Beside a video: <name>.youtube.txt, the YouTube package (chapters, a
   *  description draft, the credits). The save flow writes it; the render
   *  ignores it. */
  youtube?: boolean
  /** The parallel export (the craft run, round 7): the frames drawn in this
   *  many lanes at once (this window and render processes, each a hidden copy
   *  of the app with its own GPU process), the video joined and the sound
   *  mixed once; 'auto' picks the count from the machine
   *  (export/parallel-plan.ts). Unset or 1: one window, as before. Only an
   *  MP4 or WebM, and only when asked for: the Export dialog does not offer
   *  it today (SnippStudio phase 3.6 brings it to code films). */
  workers?: number | 'auto'
  /** The exactness check: these frames' pixels hashed (frame numbers from
   *  the range's start; 'joins': two each side of every join of a parallel
   *  export), handed to `onProbe`. */
  probe?: number[] | 'joins'
  /** With `probe`: each probed frame's PNG too (after the hash and a colon,
   *  in base64), to compare the pixels themselves. */
  probePng?: boolean
  /** The video encoder: 'software' never asks the graphics card's (the
   *  export window's Encoder field, cila E). Unset or 'auto': hardware first. */
  encoder?: EncoderPref
  /** A GIF (container 'gif'): its width in pixels (the height in
   *  proportion); the frame rate is `fps` (KOLAY-PLAN.md, item 1). */
  gifWidth?: number
}

/** Something the person should know about this export's result: kept for
 *  the export window (export/job.ts), and in the log for the film tool. */
function exportNote(text: string): void {
  noteExportJob(text)
  console.warn(`[export] ${text}`)
}


/** A 16-bit PCM WAV of `frames` samples: its header written, its samples
 *  zero until wavFill puts them in. */
function wavHeader(frames: number, ch: number, sr: number): Uint8Array {
  const dataLen = frames * ch * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const dv = new DataView(buf)
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  dv.setUint32(4, 36 + dataLen, true)
  w(8, 'WAVEfmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, ch, true)
  dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * ch * 2, true)
  dv.setUint16(32, ch * 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, dataLen, true)
  return new Uint8Array(buf)
}

/** A piece of the sound into a wavHeader's file from sample `at` on (no
 *  further than `frames`); where the next piece goes. */
function wavFill(wav: Uint8Array, piece: AudioBuffer, at: number, frames: number): number {
  const ch = piece.numberOfChannels
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const chans = Array.from({ length: ch }, (_, c) => piece.getChannelData(c))
  const n = Math.min(piece.length, frames - at)
  let o = 44 + at * ch * 2
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]))
      dv.setInt16(o, Math.round(v * 32767), true)
      o += 2
    }
  }
  return at + n
}

/** AudioBuffer → 16-bit PCM WAV bytes. */
function encodeWav(mix: AudioBuffer): Uint8Array {
  const wav = wavHeader(mix.length, mix.numberOfChannels, mix.sampleRate)
  wavFill(wav, mix, 0, mix.length)
  return wav
}

export interface ExportOptions {
  onProgress: (fraction: number, label: string) => void
  signal?: AbortSignal
  settings?: Partial<ExportSettings>
  /** The finished mix and the sound's bitrate the encoder took (the film
   *  tool writes the sound again at the bitrate asked when the system's
   *  encoder stops lower). */
  onMix?: (mix: AudioBuffer, bitrate: number, asked: number) => void
  /** Clips whose sound (from `at` on) could not be read and is missing from
   *  the mix (no sound track, did not open in time, a decode error, a stalled
   *  decoder), once per mix, only when there are any. The export still
   *  finishes; this is so the user is told (describeAudioSkip). */
  onAudioSkips?: (skips: AudioSkip[]) => void
  /** How the frames were drawn: in how many lanes, why, the stretches. */
  onPlan?: (plan: { workers: number; why: string; stretches: [number, number][] }) => void
  /** A probed frame's pixel hash (settings.probe), and its PNG in base64
   *  after a colon (settings.probePng). */
  onProbe?: (frame: number, hash: string) => void
  /** The video encoder the export uses, once asked (encoder.ts): its codec
   *  string, hardware or software, the bitrate. */
  onEncoder?: (info: { codecString: string; hw: HwPref; bitrate: number }) => void
  /** Write the video to this path as it is made (a path the save dialog
   *  chose, or the film tool's in a dev build) and return an empty array:
   *  a long film is more than one buffer can hold (export/file-target.ts).
   *  Unset: the finished file is returned in memory, as before. */
  toPath?: string
  /** With `toPath`: the size of the file kept (bytes), once it is in place
   *  (the returned array is empty, so its length says nothing). */
  onWritten?: (bytes: number) => void
  /** The checks only (scripts/export-rig): called at a stage of the export
   *  ('opened': its file is open, nothing encoded yet), to throw there. */
  fault?: (stage: 'opened' | 'encoding') => void
}

/** The best AAC bitrate this system's encoder takes at or under `asked`, for
 *  a 48 kHz stereo mix (Windows' Media Foundation encoder stops at 192 kbps). */
async function aacBitrate(asked: number): Promise<number> {
  for (const b of aacSteps(asked)) if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: b }).catch(() => false)) return b
  return AUDIO_BITRATE
}

export { encodeWav }

/** The export's sound as windows (export/audio-stream.ts; phase Ç3b,
 *  decision 1), and what is said about it once it is all out: the clips
 *  whose sound could not be read, a loudness target not reached, the
 *  limiter's work. */
function soundStream(project: Project, opts: ExportOptions, rangeStart: number, duration: number, lossy = true): { mix: ExportMix; finish: () => void } {
  const skips: AudioSkip[] = []
  // The limiter's ceiling: −1 dBTP, and half a dB more room before a lossy
  // encoder (AAC, Opus, MP3), whose own overshoot it cannot see (two
  // full-scale tones: −1.0 dBTP into the encoder came out of AAC at −0.9).
  const ceilingDb = lossy ? LOSSY_CEILING_DB : -1
  const mix = new ExportMix(project, [rangeStart, rangeStart + duration], { signal: opts.signal, normalize: !!opts.settings?.normalize, ceilingDb, onSkip: (s) => skips.push(s) })
  return {
    mix,
    finish: () => {
      if (skips.length) {
        // Said beside the result (the job's notes), not only in the console.
        for (const skip of skips) exportNote(describeAudioSkip(skip))
        opts.onAudioSkips?.(skips)
      }
      const note = normalizeNote(mix.normalized)
      if (note) exportNote(note)
      const lim = mix.limited
      if (lim.samples > 0) exportNote(t('export.limiter.note', { ceil: ceilingDb.toFixed(1).replace('-', '−'), db: lim.maxDb.toFixed(1), at: clockOf(rangeStart + lim.maxAt), dur: lim.samples >= mix.sampleRate ? clockOf(lim.samples / mix.sampleRate) : `${Math.round((lim.samples / mix.sampleRate) * 1000)} ms` }))
    }
  }
}

/** The limiter's ceiling before a lossy encoder (dBTP). */
export const LOSSY_CEILING_DB = -1.5

/** "1:05", "1:02:03". */
function clockOf(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** The label of a walk over the sound's windows. */
function mixLabel(p: MixPassProgress): string {
  return t(p.pass === 'voice' ? 'export.mix.voice' : p.pass === 'loudness' ? 'export.mix.loudness' : 'export.mix.window', { i: p.window, n: p.windows })
}

/** The whole range's sound in one buffer (the parallel export's join, which
 *  takes it whole): `share` is the part of the bar it fills. */
async function exportAudioMix(project: Project, opts: ExportOptions, rangeStart: number, duration: number, share: [number, number] = [0, 0]): Promise<AudioBuffer> {
  const s = soundStream(project, opts, rangeStart, duration)
  const [p0, p1] = share
  const total = s.mix.totalWindows
  let done = 0
  opts.onProgress(p0, t('export.mix.start'))
  const tick = (p: MixPassProgress): void => opts.onProgress(p0 + (p1 - p0) * (++done / total), mixLabel(p))
  try {
    await s.mix.prepare(tick)
    const out = new AudioBuffer({ length: s.mix.frames, sampleRate: s.mix.sampleRate, numberOfChannels: 2 })
    let at = 0
    let w = 0
    for (let b = await s.mix.next(); b; b = await s.mix.next()) {
      for (let c = 0; c < 2; c++) out.copyToChannel(b.getChannelData(c).subarray(0, Math.max(0, s.mix.frames - at)), c, at)
      at += b.length
      tick({ pass: 'mix', window: ++w, windows: s.mix.windows })
    }
    checkRenderCancelled(opts.signal)
    s.finish()
    return out
  } finally {
    s.mix.close()
  }
}

/** LAME (WASM, `@mediabunny/mp3-encoder`), registered the first time an MP3
 *  is asked for — and only when the browser has no MP3 encoder of its own
 *  (Chromium has none). Loaded on demand, so it costs nothing at start-up. */
let mp3Ready: Promise<void> | null = null
function ensureMp3Encoder(): Promise<void> {
  mp3Ready ??= (async () => {
    if (await canEncodeAudio('mp3').catch(() => false)) return
    const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder')
    registerMp3Encoder()
  })().catch((err) => {
    mp3Ready = null
    throw err
  })
  return mp3Ready
}

/** The sound-only export: WAV (as it always was), MP3 (LAME) or M4A (AAC),
 *  its sound mixed and encoded window by window (phase Ç3b, decision 1). */
async function exportSoundOnly(project: Project, opts: ExportOptions, container: ExportContainer, rangeStart: number, duration: number): Promise<Uint8Array> {
  const fmt = formatOf(container)
  // An M4A is AAC (phase 10b.1, as the MP4 above).
  if (container === 'm4a' && !(await codecCaps()).canAac) throw new Error(t('export.codec.m4aStop'))
  if (container === 'mp3') {
    opts.onProgress(0, 'Getting the MP3 encoder ready')
    try {
      await ensureMp3Encoder()
    } catch (err) {
      throw new Error(`The MP3 encoder could not be started (${err instanceof Error ? err.message : String(err)}). M4A or WAV still work.`)
    }
  }
  // Room on the disk before the sound is mixed (phase Ç3 patch, R-2): the
  // WAV's exact size, a compressed file's by its bitrate.
  if (opts.toPath) await checkRoomFor(opts.toPath, container === 'wav' ? 44 + Math.round(duration * 48000) * 4 : (fmt.audioBitrate * duration) / 8 + 64 * 1024, 'file')
  checkRenderCancelled(opts.signal)
  const s = soundStream(project, opts, rangeStart, duration, container !== 'wav')
  const total = s.mix.totalWindows
  let done = 0
  const tick = (p: MixPassProgress): void => opts.onProgress(0.02 + 0.95 * (++done / total), mixLabel(p))
  const data = await mixSoundOnly(s, opts, container, fmt, tick)
  // With a path: written beside its target and put in place (R-1 / R-2).
  if (opts.toPath) {
    opts.onProgress(0.99, t('export.save.writing'))
    await saveWholeFile(opts.toPath, data, opts.signal)
  }
  return data
}

async function mixSoundOnly(s: ReturnType<typeof soundStream>, opts: ExportOptions, container: ExportContainer, fmt: ReturnType<typeof formatOf>, tick: (p: MixPassProgress) => void): Promise<Uint8Array> {
  try {
    opts.onProgress(0.02, t('export.mix.start'))
    await s.mix.prepare(tick)
    if (container === 'wav') {
      // The WAV's bytes, filled as the windows come (its length is known).
      const wav = wavHeader(s.mix.frames, 2, s.mix.sampleRate)
      let at = 0
      let w = 0
      for (let b = await s.mix.next(); b; b = await s.mix.next()) {
        at = wavFill(wav, b, at, s.mix.frames)
        tick({ pass: 'mix', window: ++w, windows: s.mix.windows })
      }
      checkRenderCancelled(opts.signal)
      s.finish()
      return wav
    }
    const target = new BufferTarget()
    const output = new Output({
      format: container === 'mp3' ? new Mp3OutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target
    })
    const source = new AudioBufferSource({ codec: container === 'mp3' ? 'mp3' : 'aac', bitrate: fmt.audioBitrate })
    output.addAudioTrack(source)
    await output.start()
    try {
      let w = 0
      for (let b = await s.mix.next(); b; b = await s.mix.next()) {
        checkRenderCancelled(opts.signal)
        await cancellable(source.add(b), opts.signal)
        tick({ pass: 'mix', window: ++w, windows: s.mix.windows })
      }
      source.close()
      opts.onProgress(0.98, `Writing the ${fmt.ext.toUpperCase()} file`)
      await cancellable(output.finalize(), opts.signal)
    } catch (err) {
      await output.cancel().catch(() => {})
      throw err
    }
    s.finish()
    const buffer = target.buffer
    if (!buffer) throw new Error('Export produced no data.')
    return new Uint8Array(buffer)
  } finally {
    s.mix.close()
  }
}

export async function exportProjectMp4(project: Project, opts: ExportOptions): Promise<Uint8Array> {
  // The PC stays awake until the file is written, the export fails or it is
  // cancelled: Windows going to sleep would stop a long export halfway. Every
  // export passes here (the Export dialog, the film tool, sound only).
  api?.keepAwake(true, 'export')
  // A code film's page moves only for the export while it runs.
  codeFilms.lockForExport(true)
  try {
    return await exportAwake(project, opts)
  } finally {
    codeFilms.lockForExport(false)
    api?.keepAwake(false, 'export')
  }
}

async function exportAwake(project: Project, opts: ExportOptions): Promise<Uint8Array> {
  checkRenderCancelled(opts.signal)
  // The project's LUT files, read before the first frame and before it is
  // decided whether other processes may draw ("cila" part D).
  await ensureProjectLuts(project).catch(() => {})
  const { width, height } = project.settings
  const fps = opts.settings?.fps ?? project.settings.fps
  const resScale = opts.settings?.resolutionScale ?? 1
  // The films' default when nothing is asked (the film tool): about 35 Mbps
  // for 1080p60, its sound AAC 320 kbps (export/quality.ts).
  const filmDefault = opts.settings?.bitrateFactor === undefined && !opts.settings?.videoBitrate
  const bitrateFactor = opts.settings?.bitrateFactor ?? FILM_BITRATE_FACTOR
  const fullDuration = projectDuration(project)
  if (fullDuration <= 0) throw new Error('The timeline is empty — add some clips first.')
  // Optional range export: render only [rangeStart, rangeEnd].
  const rangeStart = opts.settings?.range ? Math.max(0, opts.settings.range[0]) : 0
  const rangeEnd = opts.settings?.range ? Math.min(fullDuration, opts.settings.range[1]) : fullDuration
  const duration = rangeEnd - rangeStart
  if (duration <= 0) throw new Error('The selected range is empty.')

  // Shorts mode exports the animated 9:16 crop as a vertical video, unless
  // the user explicitly asked for the full landscape frame.
  const shorts = project.mode === 'shorts' && opts.settings?.target !== 'landscape'
  const outW = shorts ? Math.round(1080 * resScale) : Math.round((width * resScale) / 2) * 2
  const outH = shorts ? Math.round(1920 * resScale) : Math.round((height * resScale) / 2) * 2

  const container = formatOf(opts.settings?.container).id
  const audioOnly = formatOf(container).audioOnly
  // Code films drawn at the output's size (phase 5d.2, decision 6): a page
  // k = outH / its height (1 … 2) is loaded again for the export at that
  // scale, and at 1 again afterwards.
  if (!audioOnly) codeFilms.exportHeight(outH)

  // Every video and sound it reads, there and readable, before anything is
  // drawn (or it stops now, naming them).
  await mediaReady(project, [rangeStart, rangeEnd], (label) => opts.onProgress(0, label), opts.signal)

  // Sound only (WAV, MP3, M4A): mix, (optionally normalize), encode, done.
  if (audioOnly) return exportSoundOnly(project, opts, container, rangeStart, duration)

  // (A Cancel while the film got ready: nothing started yet, none started now.)
  checkRenderCancelled(opts.signal)
  // The pictures the frames show, there before the first frame (or the
  // export stops, naming them, rather than drawing frames without them).
  await picturesReady(project, [rangeStart, rangeEnd], (label) => opts.onProgress(0, label), opts.signal)

  // A GIF: its own small writer, no encoder, no sound (export/gif-export.ts).
  if (container === 'gif') {
    const { exportGif } = await import('./gif-export')
    return exportGif(project, opts, { base: shorts ? [1080, 1920] : [width, height], shorts, fps, rangeStart, duration })
  }

  const videoBitrate = opts.settings?.videoBitrate ? Math.round(opts.settings.videoBitrate) : videoBitrateOf(outW, outH, fps, bitrateFactor)
  // The encoder asked first, before the sound is mixed (phase Ç3a, decision
  // 2; report R2): the hardware encoder, else the software one (said), else
  // the export stops now with the reason. What is asked is what is encoded.
  const choice: VideoChoice = videoChoice(container === 'webm' ? 'vp9' : 'avc', outW, outH, fps, videoBitrate, opts.settings?.encoder)
  const verdict = await probeEncoder(choice)
  if (!verdict.ok || !verdict.hw) throw new Error(`The video was not exported. ${verdict.why ?? refusal(choice)}: choose another size, frame rate or quality.`)
  // (The software encoder chosen in the window is not news: nothing said.)
  if (verdict.hw === 'prefer-software' && !choice.software)
    exportNote(
      hardwareFailed(choice)
        ? t('export.encoder.afterFail')
        : `this computer's hardware encoder does not take ${choice.codec === 'avc' ? 'H.264' : 'VP9'} at ${outW} × ${outH}, ${fpsLabel(fps)} fps; the software encoder made it (slower, the same picture)`
    )
  const encoder = { codecString: videoCodecString(choice), hw: verdict.hw }
  /** The graphics card's encoder failed on this choice (phase Ç3 patch,
   *  G-1): no restart inside this export; the session's answer for it is the
   *  software encoder from now on, and the sentence says so. */
  const hardwareFault = (): Error => {
    markHardwareFailed(choice)
    return new Error(t('export.encoder.hwFailed'))
  }
  // A code film drawn at its own size and enlarged here: said, beside the
  // result (phase Ç3a, decision 10; the export window says it first).
  for (const f of codeFilmsEnlarged(project, outH)) exportNote(t('export.codeFilm.upscaled', { name: f.name, w: f.w, h: f.h, ow: outW, oh: outH }))
  // HDR footage, drawn through the SDR canvas (phase Ç3b, decision 7).
  const hdr = hdrShown(project, [rangeStart, rangeEnd])
  if (hdr.length) exportNote(t('export.hdr', { names: hdr.map((n) => `"${n}"`).join(', ') }))
  opts.onEncoder?.({ ...encoder, bitrate: videoBitrate })
  checkRenderCancelled(opts.signal)
  // A sound track when anything is heard: a clip (its keyframes count), a
  // sound (round 12b: a keyframed clip came out silent).
  const hasAudio = exportCarriesSound(project, timelineSfxEvents(project).length)
  const audioAsked = opts.settings?.audioBitrate ?? (filmDefault ? FILM_AUDIO_BITRATE : AUDIO_BITRATE)
  // An MP4's sound is AAC: without an AAC encoder (desktop Linux) the export
  // stops here with the reason rather than half way (phase 10b.1). The
  // export window has moved such an export to WebM before it starts.
  if (container === 'mp4' && hasAudio && !(await codecCaps()).canAac) throw new Error(t('export.codec.mp4Stop'))
  const audioBitrate = container === 'webm' ? 0 : await aacBitrate(audioAsked)
  checkRenderCancelled(opts.signal)
  const totalFrames = Math.max(1, Math.round(duration * fps))

  // The parallel export (round 7): the frames drawn in several lanes (this
  // window and render processes), the video joined here, the sound mixed once
  // (export/parallel.ts). Only when asked for.
  const asked = opts.settings?.workers
  if (asked !== undefined && wantsParallel(asked, audioOnly)) {
    const P = await import('./parallel')
    const why = P.parallelBlocked(project)
    if (!why) {
      // A main process without render processes (an app started before
      // them): one window, as before.
      // The finished film is held in memory (unless it streams to its file):
      // its size counts against the lanes.
      const outBytes = opts.toPath ? 0 : ((videoBitrate + (hasAudio ? audioAsked : 0)) * duration) / 8
      const plan = await P.planWorkers(project, totalFrames, fps, asked, outBytes).catch((e: unknown) => ({ n: 1, why: `one window (no render processes: ${e instanceof Error ? e.message : String(e)})` }))
      checkRenderCancelled(opts.signal)
      if (plan.n > 1)
        return P.exportParallel(project, opts, {
          onEncoderFault: encoder.hw === 'prefer-hardware' ? hardwareFault : undefined,
          plan,
          outW,
          outH,
          shorts,
          fps,
          rangeStart,
          totalFrames,
          container,
          videoBitrate,
          encoder,
          audio: hasAudio ? { bitrate: audioBitrate, asked: audioAsked, mix: (share) => exportAudioMix(project, opts, rangeStart, duration, share) } : null
        })
      opts.onPlan?.({ workers: 1, why: plan.why, stretches: [[0, totalFrames]] })
    } else opts.onPlan?.({ workers: 1, why, stretches: [[0, totalFrames]] })
  } else opts.onPlan?.({ workers: 1, why: 'one window', stretches: [[0, totalFrames]] })

  // Room on the disk before anything is drawn (phase Ç3b, decision 5;
  // report R25): the film's estimated size and a fifth more. A full disk
  // used to be found 636 frames in, in Node's words.
  if (opts.toPath) {
    const need = Math.round((((videoBitrate + (hasAudio ? audioBitrate || 160_000 : 0)) * duration) / 8) * 1.2)
    const free = await freeSpaceAt(opts.toPath)
    if (free !== null && free < need) throw new Error(t('export.disk.short', { need: sizeLabel(need), free: sizeLabel(free) }))
  }
  checkRenderCancelled(opts.signal)

  const drawer = frameDrawer(project, { w: outW, h: outH, shorts }, opts.signal)
  // A lost graphics context stops the export with a sentence (phase Ç3b,
  // decision 5; report R17): frames drawn after it would be black, or the
  // export would fail later with a decoder's or encoder's own words. It is
  // not made again by itself.
  let contextLost = false
  const onLost = (): void => {
    contextLost = true
  }
  drawer.canvas.addEventListener('contextlost', onLost)
  const lostError = (): Error => new Error(t('export.contextLost'))

  // Written to its file as it is made when a path is given (a long film is
  // more than one buffer can hold: export/file-target.ts). Opened inside the
  // try: a failure between opening it and the first frame used to leave the
  // .part (and its handle) behind (report R24).
  let file: Awaited<ReturnType<typeof fileTarget>> | null = null
  let output: Output | null = null
  let target: BufferTarget | StreamTarget | null = null
  let videoSource: CanvasSource | null = null
  let audioSource: AudioBufferSource | null = null
  const FRAMES_END = 0.98
  const probes = probeSet(opts.settings?.probe, null)
  // The sound, window by window between the frames (phase Ç3b, decision 1;
  // R6): it was all mixed and encoded before the first frame.
  const sound = hasAudio ? soundStream(project, opts, rangeStart, duration) : null
  // The bar by measured cost (R29: export/progress.ts).
  const bar = new WorkBar(totalFrames, sound?.mix.totalWindows ?? 0, 0, FRAMES_END)
  let windowsFed = 0
  // The video packets the encoder handed back (report R19: a late encoder
  // error can lose the film's tail without a word on Chromium 150).
  let packets = 0
  // An error the encoder threw (at its setup, on a frame, at the flush).
  let encoderError = false
  const encode = async <T>(p: Promise<T>): Promise<T> => {
    try {
      return await p
    } catch (err) {
      if (isEncoderFault(err)) encoderError = true
      throw err
    }
  }

  try {
    file = opts.toPath ? await fileTarget(opts.toPath) : null
    // (The checks' fault point: the file is open, nothing encoded yet.)
    opts.fault?.('opened')
    target = file ? file.target : new BufferTarget()
    output = new Output({ format: outputFormat(container, !!file), target })
    const bounds = packetBounds(totalFrames, duration)

    videoSource = new CanvasSource(drawer.canvas, {
      codec: choice.codec,
      bitrate: videoBitrate,
      // Exactly what was asked (encoder.ts): the level counting the frame rate
      // (R28), the encoder that said yes, a key frame every 2 s (decision 8;
      // it was mediabunny's unstated default).
      fullCodecString: encoder.codecString,
      hardwareAcceleration: encoder.hw,
      keyFrameInterval: KEY_FRAME_INTERVAL,
      onEncodedPacket: () => {
        packets++
      }
    })
    output.addVideoTrack(videoSource, { frameRate: fps, ...(file ? { maximumPacketCount: bounds.video } : {}) })

    if (hasAudio) {
      audioSource = new AudioBufferSource({
        codec: container === 'webm' ? 'opus' : 'aac',
        bitrate: container === 'webm' ? QUALITY_HIGH : audioBitrate
      })
      output.addAudioTrack(audioSource, file ? { maximumPacketCount: bounds.audio } : undefined)
    }

    await output.start()
    if (sound) {
      opts.onProgress(0, t('export.mix.start'))
      let t0 = performance.now()
      await sound.mix.prepare((p) => {
        const now = performance.now()
        bar.window(now - t0)
        t0 = now
        opts.onProgress(bar.fraction(), mixLabel(p))
      })
    }
    const audio = audioSource
    /** The sound's windows up to `until` seconds of the film (one window
     *  ahead of the frames: the encoder's queue holds a minute of sound at
     *  most), or all that is left. */
    const feedSound = async (until: number): Promise<void> => {
      if (!sound || !audio) return
      while (windowsFed < sound.mix.windows && windowsFed * MIX_WINDOW_SEC <= until) {
        const t0 = performance.now()
        const b = await sound.mix.next()
        windowsFed++
        if (b) await cancellable(audio.add(b), opts.signal)
        bar.window(performance.now() - t0)
        if (windowsFed >= sound.mix.windows) {
          audio.close()
          sound.finish()
        }
      }
    }

    for (let i = 0; i < totalFrames; i++) {
      if (opts.signal?.aborted) throw new Error('Export cancelled')
      if (contextLost) throw lostError()
      // t = absolute timeline time; output timestamp = t - rangeStart.
      // Exact for NTSC rates (i × 1001 / 30000: timeline/rates.ts).
      await feedSound(frameTime(i, fps) + MIX_WINDOW_SEC)
      const f0 = performance.now()
      const t = rangeStart + frameTime(i, fps)
      await drawer.draw(t)
      if (contextLost) throw lostError()
      if (probes?.has(i)) opts.onProbe?.(i, await probeHash(drawer.canvas, opts.settings?.probePng))
      await cancellable(encode(videoSource.add(frameTime(i, fps), frameTime(i + 1, fps) - frameTime(i, fps))), opts.signal)
      // (The checks' fault point: an encoder that fails on a frame.)
      if (i === 1 && opts.fault) await encode(Promise.resolve().then(() => opts.fault?.('encoding')))
      bar.frame(performance.now() - f0)
      if (i % 5 === 0) opts.onProgress(bar.fraction(), `Drawing frame ${i + 1} of ${totalFrames}`)
    }
    await feedSound(Infinity)
    videoSource.close()

    opts.onProgress(FRAMES_END, `Writing the ${formatOf(container).ext.toUpperCase()} file`)
    await cancellable(encode(output.finalize()), opts.signal)
    if (contextLost) throw lostError()
    // Every frame encoded, or no "Done" (R19).
    if (packets !== totalFrames) throw new Error(t('export.verify.frames', { got: packets, want: totalFrames }))
    // What was written, opened again and read (R19): its frames, its
    // length, its sound.
    // It reads a bounded part of the file and stops on Cancel (phase Ç3
    // patch, R-1: a WebM was read whole, Cancel dead meanwhile).
    opts.onProgress(0.99, t('export.verify.checking'))
    const problem = await verifyWritten(file ? file.source(opts.signal) : new BufferSource((target as BufferTarget).buffer!), { frames: totalFrames, duration: frameTime(totalFrames, fps), fps, audio: !!audioSource }, opts.signal)
    if (problem) throw new Error(t('export.verify.failed', { what: problem }))
    // The last moment a Cancel holds (R-1): until the finished .part replaces
    // the target, Cancel drops it and the old file stays; from here on the
    // export is done (a Cancel pressed meanwhile does not undo the replace).
    checkRenderCancelled(opts.signal)
    if (file) {
      await file.done(true)
      opts.onWritten?.(file.bytes())
    }
  } catch (err) {
    await output?.cancel().catch(() => {})
    await file?.done(false).catch(() => {})
    // (A context lost on the way: that is what is said, not the decoder's
    // or encoder's error it caused.)
    if (contextLost && !opts.signal?.aborted) throw lostError()
    // The graphics card's encoder failed: said, and the next export of this
    // choice uses the software encoder (G-1).
    if (encoderError && encoder.hw === 'prefer-hardware' && !opts.signal?.aborted) throw hardwareFault()
    throw plainFileError(err)
  } finally {
    drawer.canvas.removeEventListener('contextlost', onLost)
    drawer.close()
    sound?.mix.close()
  }

  if (file) return new Uint8Array(0)
  const buffer = (target as BufferTarget).buffer
  if (!buffer) throw new Error('Export produced no data.')
  return new Uint8Array(buffer)
}

/** A frame's pixels as a short hash (the exactness check), and with `png`
 *  the frame itself after a colon (a PNG in base64). Copied first to a
 *  canvas of its own: reading the export's canvas back often would make the
 *  browser draw it on the CPU from then on (a different raster). */
let probeCanvas: OffscreenCanvas | null = null
export async function probeHash(canvas: OffscreenCanvas, png = false): Promise<string> {
  if (!probeCanvas || probeCanvas.width !== canvas.width || probeCanvas.height !== canvas.height) probeCanvas = new OffscreenCanvas(canvas.width, canvas.height)
  const g = probeCanvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.drawImage(canvas, 0, 0)
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data
  const d = await crypto.subtle.digest('SHA-256', px)
  const hash = [...new Uint8Array(d).subarray(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
  if (!png) return hash
  const bytes = new Uint8Array(await (await probeCanvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
  let bin = ''
  for (let k = 0; k < bytes.length; k += 32768) bin += String.fromCharCode(...bytes.subarray(k, k + 32768))
  return `${hash}:${btoa(bin)}`
}

/** Draws an export's frames, one after another, into its canvas: the
 *  footage's decoders (a forward cursor per clip), the stills, the Shorts
 *  crop and its captions. The single-window export and every lane of a
 *  parallel one draw with this, so a frame is the same wherever it is
 *  drawn. */
export interface FrameDrawer {
  canvas: OffscreenCanvas
  /** The frame at timeline time t (seconds). */
  draw(t: number): Promise<void>
  /** What the last draw left out (a lenient drawer: a still): one sentence
   *  per clip, naming it (5a/5b patch, audit C-6). */
  leftOut: string[]
  close(): void
}

export interface DrawerSize {
  w: number
  h: number
  shorts: boolean
  /** The subtitles and texts drawn (default); false: a clean picture. */
  captions?: boolean
  /** 'final' (the export, default) or 'draft' (a thumbnail, a note's picture). */
  quality?: 'draft' | 'final'
  /** A clip whose frame cannot be read is left out, not an error (a still,
   *  a thumbnail: as exportFramePng always did). */
  lenient?: boolean
}

export function frameDrawer(project: Project, size: DrawerSize, signal?: AbortSignal): FrameDrawer {
  const { width, height } = project.settings
  const { w: outW, h: outH, shorts } = size
  const quality = size.quality ?? 'final'
  const captions = size.captions !== false
  const leftOut: string[] = []
  const canvas = new OffscreenCanvas(outW, outH)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Could not create a drawing context.')
  // A Short is the whole frame drawn at the output's scale (k = outH /
  // height: 3413 × 1920 for 1080 × 1920 from a 1080p project), then its 9:16
  // window copied out 1:1 (phase Ç3a, decision 1; report R1). It was the
  // project-size frame's 607 px window stretched 1.78× (3.56× at 2160 × 3840).
  const k = outH / height
  const fullCanvas = shorts ? new OffscreenCanvas(Math.max(outW, Math.round(width * k)), outH) : null
  const fullCtx = fullCanvas?.getContext('2d', { alpha: false }) ?? null

  // One frame cursor per clip, created lazily when the clip first shows.
  const cursors = new Map<string, ClipFrameCursor | null>()
  /**
   * Each clip's OWN sink (by clip id, not by file).
   *
   * A CanvasSink hands its frames out on a pool of two canvases, and that
   * pool belongs to the SINK. Shared by every clip cut from one file, two of
   * them on screen together (a transition between two cuts of one recording,
   * the same footage on a second layer, a freeze of it) painted over the
   * canvases the other's frames were still on, so a dissolve showed the
   * wrong side, a frame off, or flickered between the two. A copy made after
   * the seek came too late to help. A sink of its own costs no decoder (each
   * `canvases()` or `getCanvas()` call makes its own anyway), only its two
   * canvases, and those go with it when the clip is done (below).
   */
  const sinks = new Map<string, CanvasSink | null>()
  const sinkOf = async (clip: Clip, asset: Asset): Promise<CanvasSink | null> => {
    let sink = sinks.get(clip.id)
    if (sink === undefined) {
      sink = await cancellable(getVideoSink(asset, undefined, { original: true }), signal)
      sinks.set(clip.id, sink)
    }
    return sink
  }

  const getCursor = async (clip: Clip, asset: Asset): Promise<ClipFrameCursor | null> => {
    if (cursors.has(clip.id)) return cursors.get(clip.id)!
    const sink = await sinkOf(clip, asset)
    const cursor = sink
      ? new ClipFrameCursor(sink, clip, asset.duration, await cancellable(videoPresentationOffset(asset), signal))
      : null
    cursors.set(clip.id, cursor)
    return cursor
  }

  // When each clip was last drawn: a clip done with (a cut that has ended)
  // lets its decoder, its decoded frames and its canvases go, instead of
  // holding them all until the export ends (frame-cursor.ts, staleClips).
  const lastSeen = new Map<string, number>()
  const release = (id: string): void => {
    cursors.get(id)?.close()
    cursors.delete(id)
    sinks.delete(id)
    frozen.delete(id)
    reversers.delete(id)
  }

  // A freeze frame is read once and kept for the clip's life; a reversed
  // clip decodes a stretch forward and hands its frames out backwards
  // (phase Ç3a, decision 7; report R7: each of their output frames decoded
  // from the key frame before it, a 4K long-GOP freeze exported at a sixth
  // of a forward clip's speed). Copies on canvases of their own: a sink's
  // canvases are a pool of two.
  const frozen = new Map<string, { at: number; canvas: OffscreenCanvas }>()
  const copyOf = (src: { canvas: HTMLCanvasElement | OffscreenCanvas }, into?: OffscreenCanvas): OffscreenCanvas => {
    const w = src.canvas.width
    const h = src.canvas.height
    const cv = into && into.width === w && into.height === h ? into : new OffscreenCanvas(w, h)
    const g = cv.getContext('2d')!
    g.clearRect(0, 0, w, h)
    g.drawImage(src.canvas, 0, 0)
    return cv
  }
  const frozenFrame = async (id: string, sink: CanvasSink, at: number): Promise<OffscreenCanvas | null> => {
    const held = frozen.get(id)
    if (held && held.at === at) return held.canvas
    const wrapped = await cancellable(sink.getCanvas(at), signal)
    if (!wrapped) return null
    const canvas = copyOf(wrapped, held?.canvas)
    frozen.set(id, { at, canvas })
    return canvas
  }
  const reversers = new Map<string, ReverseCursor<OffscreenCanvas>>()
  const reversedFrame = async (clip: Clip, asset: Asset, sink: CanvasSink, at: number): Promise<OffscreenCanvas | null> => {
    let r = reversers.get(clip.id)
    if (!r) {
      // As many frames a stretch as about 1.1 GB holds (32 at 4K, 32 at
      // most: 265 MB at 1080p): measured on a 4 s-GOP 4K file, 9 frames
      // gave 0.40× a forward clip's speed, 19 gave 0.49×, 32 gave 0.60×
      // (FAZC3A-PLAN.md, decision 10 of the phase).
      const keep = Math.max(4, Math.min(32, Math.floor(REVERSE_BYTES / Math.max(1, asset.width * asset.height * 4))))
      const ring: OffscreenCanvas[] = []
      r = new ReverseCursor<OffscreenCanvas>(sink, keep, 1 / (asset.fps && asset.fps > 0 ? asset.fps : 30), (src, slot) => (ring[slot] = copyOf(src, ring[slot])))
      reversers.set(clip.id, r)
    }
    return r.frameAt(at, signal)
  }
  // Freeze-frame and reversed clips whose frame could not be read (said
  // once each, beside the result: not a silent hole in the video).
  const unreadable = new Set<string>()
  // Forward clips whose decoder failed twice: the last good frame (null:
  // there was none), held to the clip's end (report R16).
  const held = new Map<string, OffscreenCanvas | null>()

  // Allocated ONCE for the whole render, not per frame: at 60 fps for ten
  // minutes these were 36 000 throwaway Maps and 36 000 image lookups that
  // always resolved to the same handful of decoded stills.
  const frameByClip = new Map<string, CanvasImageSource>()
  const images = new Map<string, HTMLImageElement>()
  // Big pictures made smaller once for this export's size, with the
  // browser's best filter (phase Ç3a, decision 1; report R5): a 24 MP photo
  // in a 1080p frame was resampled 6:1 on every frame with the canvas's
  // default filter. Kept at twice the frame's long side (a slow zoom still
  // has its detail); a picture no bigger than that is drawn as it is (null).
  const stills = new Map<string, ImageBitmap | null>()
  const frameLong = Math.max(fullCanvas?.width ?? outW, outW, outH)
  const pictureOf = (asset: Asset): HTMLImageElement => {
    const img = images.get(asset.id) ?? exportImageCache.get(asset.id) ?? exportPicture(asset)
    images.set(asset.id, img)
    return img
  }
  const prepareStill = async (asset: Asset): Promise<void> => {
    if (stills.has(asset.id)) return
    const img = pictureOf(asset)
    if (!img.complete || img.naturalWidth <= 0) return
    const long = Math.max(img.naturalWidth, img.naturalHeight)
    if (long <= 2 * frameLong) {
      stills.set(asset.id, null)
      return
    }
    const f = (2 * frameLong) / long
    stills.set(asset.id, null)
    try {
      const bmp = await createImageBitmap(img, { resizeWidth: Math.max(1, Math.round(img.naturalWidth * f)), resizeHeight: Math.max(1, Math.round(img.naturalHeight * f)), resizeQuality: 'high' })
      stills.set(asset.id, bmp)
    } catch {
      /* drawn as it is */
    }
  }
  const resolveFrame = (clip: Clip, asset: Asset): CanvasImageSource | null => {
    if (asset.kind === 'video' || asset.kind === 'code') return frameByClip.get(clip.id) ?? null
    if (asset.kind === 'image') {
      const img = pictureOf(asset)
      if (!img.complete || img.naturalWidth <= 0) return null
      return stills.get(asset.id) ?? img
    }
    return null
  }

  const draw = async (t: number): Promise<void> => {
    // Advance the decoder cursor of every visible video clip (including
    // dissolve ghosts) to this time.
    frameByClip.clear()
    leftOut.length = 0
    // Code films' frames of this moment (closed once it is drawn).
    const codeFrames: ImageBitmap[] = []
    // Compound clips are expanded so nested footage is decoded too; child
    // ids are preserved, which is what resolveFrame looks up.
    for (const clip of flattenClips(renderList(project, t).map((e) => e.clip))) {
      const asset = assetById(project, clip.assetId)
      if (asset?.kind === 'image' && !asset.missing) {
        await prepareStill(asset)
        continue
      }
      if (asset?.kind === 'code' && !asset.missing) {
        // The page draws second T of the film (its PREP awaited), full size.
        try {
          const bmp = await codeFilms.exactFrame(asset, clipMediaAt(project, clip, t).time, signal)
          frameByClip.set(clip.id, bmp)
          codeFrames.push(bmp)
        } catch (err) {
          if (!size.lenient) throw err
          checkRenderCancelled(signal)
          // Left out of a still, and said (it was silent: audit C-6).
          const why = (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 300)
          const line = text('still.codeFilmLeftOut', { name: asset.name, why })
          if (!leftOut.includes(line)) leftOut.push(line)
        }
        continue
      }
      if (!asset || asset.kind !== 'video') continue
      lastSeen.set(clip.id, t)
      // Freeze frames and reversed clips need random access, not the
      // forward-only cursor.
      if (clip.freeze !== undefined || clip.reversed) {
        const sink = await sinkOf(clip, asset)
        if (!sink) continue
        const local = clipMediaAt(project, clip, t).time
        // Held to the file's last frame, which is reachable (phase Ç3a,
        // decision 7; report R27: it was held 50 ms before the end).
        const offset = await cancellable(videoPresentationOffset(asset), signal)
        const last = await cancellable(lastVideoFrameTime(asset), signal)
        const at = Math.min(Math.max(0, local) + offset, last ?? offset + Math.max(0, asset.duration - 0.05)) + FRAME_EPS
        // Read again once when the decoder fails (a new decoder); a second
        // failure is said, not hidden (and that clip is not read twice a
        // frame from then on).
        const tries = unreadable.has(clip.id) ? 1 : 2
        for (let attempt = 0; attempt < tries; attempt++) {
          try {
            const shown = clip.freeze !== undefined ? await frozenFrame(clip.id, sink, at) : await reversedFrame(clip, asset, sink, at)
            if (shown) frameByClip.set(clip.id, shown)
            break
          } catch (err) {
            reversers.delete(clip.id)
            checkRenderCancelled(signal)
            if (attempt === 1) {
              unreadable.add(clip.id)
              exportNote(`a frame of "${asset.name}" could not be read (${err instanceof Error ? err.message : String(err)}), so that ${clip.reversed ? 'reversed' : 'freeze-frame'} clip is missing from ${t.toFixed(2)} s`)
            }
          }
        }
        continue
      }
      // A clip whose decoder failed twice: its last good frame, held.
      const kept = held.get(clip.id)
      if (kept !== undefined) {
        if (kept) frameByClip.set(clip.id, kept)
        continue
      }
      const at = clipMediaAt(project, clip, t).time
      try {
        const cursor = await getCursor(clip, asset)
        if (!cursor) continue
        await cursor.seekTo(at, signal)
        if (cursor.current) frameByClip.set(clip.id, cursor.current.canvas)
      } catch (err) {
        checkRenderCancelled(signal)
        if (size.lenient) {
          release(clip.id)
          continue
        }
        // A decode error in the middle of a clip (phase Ç3b, decision 5;
        // report R16: it failed the whole export, after up to an hour): the
        // decoder made again once, seeked to this frame; failing again, the
        // last good frame is held to the clip's end, and said.
        const last = cursors.get(clip.id)?.current?.canvas
        const good = last ? copyOf({ canvas: last }) : null
        release(clip.id)
        try {
          const cursor = await getCursor(clip, asset)
          if (!cursor) continue
          await cursor.seekTo(at, signal)
          if (cursor.current) frameByClip.set(clip.id, cursor.current.canvas)
        } catch (again) {
          checkRenderCancelled(signal)
          release(clip.id)
          held.set(clip.id, good)
          if (good) frameByClip.set(clip.id, good)
          exportNote(text('export.decode.held', { name: asset.name, at: t.toFixed(2) }))
          console.warn(`export: "${asset.name}" could not be decoded at ${at.toFixed(3)} s:`, err, again)
        }
      }
    }
    // The clips that are done with let their decoders go (time only moves
    // forward; one that comes back gets a new cursor, seeked to its place).
    for (const id of staleClips(lastSeen, t)) release(id)
    try {
      await drawFrame(t)
    } finally {
      for (const b of codeFrames) b.close()
    }
  }

  const drawFrame = async (t: number): Promise<void> => {
    if (shorts && fullCtx && fullCanvas) {
      // The whole frame as the preview draws it (its captions too, in the
      // window, with their motion and trackers: the same call, report R8 and
      // K12), at the output's scale, no overlay; then the window, 1:1. Its
      // left edge on a whole pixel (a copy, not a resample: at most half an
      // output pixel from where the preview puts it).
      renderFrame(fullCtx, project, t, resolveFrame, { scale: k, shortsOverlay: false, quality, includeCaptions: captions })
      const win = shortsWindowAt(project, t)
      const sx = shortsCropX(width, k, outW, fullCanvas.width, win)
      if (sx >= 0 && sx + outW <= fullCanvas.width) ctx.drawImage(fullCanvas, sx, 0, outW, outH, 0, 0, outW, outH)
      else {
        // A project narrower than the window (phase Ç3 patch, G-3): black
        // beside it, the picture where the preview has it.
        const a = Math.max(0, sx)
        const b = Math.min(fullCanvas.width, sx + outW)
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, outW, outH)
        if (b > a) ctx.drawImage(fullCanvas, a, 0, b - a, outH, a - sx, 0, b - a, outH)
      }
    } else {
      // shortsOverlay off: a landscape export from shorts mode must not
      // bake the dimming overlay into the video.
      renderFrame(ctx, project, t, resolveFrame, { scale: outW / width, shortsOverlay: false, quality, includeCaptions: captions })
    }
  }

  return {
    canvas,
    draw,
    leftOut,
    close: () => {
      for (const cursor of cursors.values()) cursor?.close()
      cursors.clear()
      sinks.clear()
      lastSeen.clear()
      for (const b of stills.values()) b?.close()
      stills.clear()
      frozen.clear()
      reversers.clear()
      held.clear()
    }
  }
}

/** A still's size: the project's own, or 4K (2160 lines on its short side). */
export type StillSize = 'project' | '4k'

export interface StillOptions {
  size?: StillSize
  /** A Short's 9:16 window (a Shorts project's still), not the whole frame. */
  shorts?: boolean
  format?: 'png' | 'jpeg'
  /** The subtitles and texts drawn (default). */
  captions?: boolean
  quality?: 'draft' | 'final'
  /** Filled with a sentence per clip the still had to leave out (a code
   *  film that could not draw that moment: 5a/5b patch, audit C-6). */
  leftOut?: string[]
}

/** A still's pixel size: the project's (a Short's: 1080 × 1920, as the
 *  export makes it), or that scaled to 2160 lines on its short side. */
export function stillSize(project: Project, opts: Pick<StillOptions, 'size' | 'shorts'>): { w: number; h: number } {
  const { width, height } = project.settings
  // (A Short is 1080 × 1920, as the export makes it: exporter.ts outW.)
  const [bw, bh] = opts.shorts ? [1080, 1920] : [width, height]
  if (opts.size !== '4k') return { w: bw, h: bh }
  const k = 2160 / Math.max(1, Math.min(bw, bh))
  return { w: Math.round((bw * k) / 2) * 2, h: Math.round((bh * k) / 2) * 2 }
}

/**
 * One frame as a picture file (phase Ç3a, decision 9; report R26): drawn by
 * the export's own frameDrawer (the same decoders, the Short's window drawn
 * at its size, final quality unless asked), at the project's size or 4K,
 * as PNG or JPEG. It was the project's size only, PNG only, the 16:9 frame of
 * a Shorts project, and a decoder per video per call that was never closed.
 */
export async function stillFrame(project: Project, time: number, opts: StillOptions = {}): Promise<Uint8Array> {
  await preloadImagesForExport(project)
  const shorts = !!opts.shorts && project.mode === 'shorts'
  const { w, h } = stillSize(project, { size: opts.size, shorts })
  const drawer = frameDrawer(project, { w, h, shorts, captions: opts.captions !== false, quality: opts.quality ?? 'final', lenient: true })
  try {
    await drawer.draw(time)
    opts.leftOut?.push(...drawer.leftOut)
    const type = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await drawer.canvas.convertToBlob(opts.format === 'jpeg' ? { type, quality: 0.92 } : { type })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    drawer.close()
  }
}

/** One frame at the project's size as PNG bytes (thumbnails, a note's
 *  picture, the checks): stillFrame, the whole frame. */
export async function exportFramePng(project: Project, time: number, includeCaptions = true, quality: 'draft' | 'final' = 'draft', leftOut?: string[]): Promise<Uint8Array> {
  return stillFrame(project, time, { captions: includeCaptions, quality, format: 'png', leftOut })
}

/** Image decode cache shared across exports. */
const exportImageCache = new Map<string, HTMLImageElement>()

/** Ensures every image asset is decoded before the export loop starts. */
export async function preloadImagesForExport(project: Project): Promise<void> {
  // Canvas does not lazily load a font: it draws with whatever is registered
  // at the moment of the call and silently falls back otherwise. The bundled
  // faces are registered at startup without being waited for, so an export
  // begun in the first second could render its titles in the fallback face and
  // there would be nothing in the file to say so.
  // Bounded, always. Waiting for the fonts is worth a moment — canvas draws
  // with whatever is registered and silently falls back otherwise — but an
  // export must never be something a font can wedge. If they are not ready in
  // two seconds, render with what there is.
  await Promise.race([
    loadBundledFonts().catch(() => {}),
    new Promise((r) => setTimeout(r, 2000))
  ])
  // The project's LUT files (a still, a thumbnail, the checks' frames).
  await Promise.race([ensureProjectLuts(project).catch(() => {}), new Promise((r) => setTimeout(r, 4000))])
  const jobs: Promise<unknown>[] = []
  for (const asset of project.assets) {
    if (asset.kind !== 'image' || asset.missing) continue
    // Its load event, not decode(): with the window hidden or minimised,
    // decode() can wait for ever; a loaded image draws all the same.
    const im = exportPicture(asset)
    if (!im.complete)
      jobs.push(
        new Promise<void>((ok) => {
          im.addEventListener('load', () => ok(), { once: true })
          im.addEventListener('error', () => ok(), { once: true })
        })
      )
  }
  // Bounded like the font wait above, and for the same reason: this is the
  // phase that just proved it can wedge an export. An image that fails to
  // load ends its wait, but a source that never answers at all would leave
  // this waiting with nothing on screen to say why. Ten seconds is far longer
  // than a local file needs; past that the render goes ahead (and the
  // export's own wait, picturesReady, holds its first frame for a picture it
  // shows that is still loading, then stops naming it, rather than drawing
  // frames without it).
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 10_000))])
}

/** A picture's image for the export (made, and loading, when it is not
 *  there yet or its file changed). */
function exportPicture(asset: Asset): HTMLImageElement {
  let img = exportImageCache.get(asset.id)
  if (!img || img.dataset.src !== asset.url) {
    img = new Image()
    img.crossOrigin = 'anonymous'
    img.dataset.src = asset.url
    img.src = asset.url
    exportImageCache.set(asset.id, img)
  }
  return img
}

/** How long a picture the frames show is waited for, past the window's own
 *  ten seconds (preloadImagesForExport), before the export stops (ms). */
const PICTURE_WAIT_MS = 60_000
/** Seconds either side of the export's range a picture's clip still counts
 *  (a transition draws a clip a little past its own edges). */
const PICTURE_MARGIN = 10

/** The pictures (image files) the clips shown in or near [a, b] draw: still
 *  loading, and loaded with nothing to draw (a file that could not be read). */
function picturesOf(project: Project, [a, b]: [number, number]): { loading: Asset[]; broken: Asset[] } {
  const loading = new Map<string, Asset>()
  const broken = new Map<string, Asset>()
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const clip of flatClipsOfTrack(project, track)) {
      if (clip.disabled || clip.start > b + PICTURE_MARGIN || clip.start + clip.duration < a - PICTURE_MARGIN) continue
      const asset = assetById(project, clip.assetId)
      if (!asset || asset.kind !== 'image' || asset.missing) continue
      const img = exportPicture(asset)
      if (!img.complete) loading.set(asset.id, asset)
      else if (img.naturalWidth <= 0) broken.set(asset.id, asset)
    }
  }
  return { loading: [...loading.values()], broken: [...broken.values()] }
}

const namesOf = (assets: Asset[]): string =>
  assets.slice(0, 5).map((a) => `"${a.name}"`).join(', ') + (assets.length > 5 ? ` and ${assets.length - 5} more` : '')

/**
 * The videos and sounds an export over `range` reads (clips on a track that
 * is shown or heard), each checked before the first frame: the file still
 * there, and its format one the decoder reads. A file moved, renamed or
 * deleted since the project was opened used to stop the export part way,
 * with only the decoder's "Input has an unsupported or unrecognizable
 * format." (the app answers a missing file with a "Not found" page, which
 * the decoder then tries to read as the video). Now it stops before it
 * starts, naming the files.
 */
export async function mediaReady(project: Project, range: [number, number], onLabel?: (label: string) => void, signal?: AbortSignal): Promise<void> {
  const tracks = new Map(project.tracks.map((t) => [t.id, t]))
  const used = new Map<string, Asset>()
  // The videos whose picture is drawn: their decoder asked too.
  const shown = new Set<string>()
  for (const c of flattenClips(Object.values(project.clips))) {
    if (c.disabled || c.start >= range[1] || c.start + c.duration <= range[0]) continue
    const a = assetById(project, c.assetId)
    if (!a || (a.kind !== 'video' && a.kind !== 'audio')) continue
    const tr = tracks.get(c.trackId)
    // Not shown and not heard: not read.
    if (tr?.kind === 'audio' && tr.muted) continue
    if (tr?.kind === 'video' && tr.hidden && (a.kind !== 'video' || !a.hasAudio || tr.muted)) continue
    used.set(a.id, a)
    if (a.kind === 'video' && tr?.kind === 'video' && !tr.hidden) shown.add(a.id)
  }
  // Code films: their pages started and ready (or the export stops, naming them).
  if (flattenClips(Object.values(project.clips)).some((c) => assetById(project, c.assetId)?.kind === 'code')) {
    onLabel?.('Starting the code films')
    await codeFilms.ready(project, range, signal)
  }
  if (!used.size) return
  onLabel?.('Checking the media files')
  const missing: Asset[] = []
  const unreadable: Asset[] = []
  const undecodable: Asset[] = []
  await Promise.all(
    [...used.values()].map(async (a) => {
      if (browserFiles.get(a.id)) return
      if (a.missing || !a.url) {
        missing.push(a)
        return
      }
      try {
        const r = await fetch(a.url, { headers: { Range: 'bytes=0-0' } })
        await r.body?.cancel().catch(() => {})
        if (!r.ok) {
          missing.push(a)
          return
        }
      } catch {
        missing.push(a)
        return
      }
      try {
        await getInput(a).getFormat()
      } catch {
        unreadable.push(a)
        return
      }
      // Its pictures decodable on this computer (phase Ç3a, decision 6;
      // report R13): an HEVC, ProRes or AV1 file the preview's <video> may
      // still play stopped the export at its first frame, after the whole
      // sound had been mixed.
      if (shown.has(a.id) && !(await canDecodeVideo(a))) undecodable.push(a)
    })
  )
  checkRenderCancelled(signal)
  if (!missing.length && !unreadable.length && undecodable.length) throw new Error(t('export.undecodable', { n: undecodable.length, names: namesOf(undecodable) }))
  if (!missing.length && !unreadable.length) return
  const parts: string[] = []
  if (missing.length)
    parts.push(
      `${missing.length === 1 ? 'A file' : `${missing.length} files`} used in the video can't be found: ${namesOf(missing)}. ${missing.length === 1 ? 'It was' : 'They were'} moved, renamed or deleted since the project was opened — relink ${missing.length === 1 ? 'it' : 'them'} in the Media panel (or take ${missing.length === 1 ? 'it' : 'them'} off the timeline)`
    )
  if (unreadable.length)
    parts.push(`${unreadable.length === 1 ? 'A file' : `${unreadable.length} files`} can't be read (damaged, or a format ${PRODUCT_NAME} doesn't open): ${namesOf(unreadable)} — replace ${unreadable.length === 1 ? 'it' : 'them'}`)
  throw new Error(`The video was not exported. ${parts.join('. ')}, then export again.`)
}

/**
 * Every picture the export's frames show, loaded before the first frame. A
 * picture still loading past the window's own wait used to be drawn as
 * nothing until it arrived, and the export still said "Done". It is waited
 * for here, on the bar ("Loading the pictures: 3 left"), up to a minute;
 * then the export stops, naming them. One that could not be read at all is
 * said beside the result (it never draws).
 */
export async function picturesReady(project: Project, range: [number, number], onLabel?: (label: string) => void, signal?: AbortSignal): Promise<void> {
  const started = Date.now()
  for (;;) {
    checkRenderCancelled(signal)
    const { loading, broken } = picturesOf(project, range)
    if (!loading.length) {
      if (broken.length) exportNote(`${broken.length === 1 ? 'a picture' : `${broken.length} pictures`} could not be read and ${broken.length === 1 ? 'is' : 'are'} missing from the video: ${namesOf(broken)}`)
      return
    }
    if (Date.now() - started >= PICTURE_WAIT_MS)
      throw new Error(
        `${loading.length === 1 ? 'A picture' : `${loading.length} pictures`} did not load in time, so the video was not exported: ${namesOf(loading)}. Check that ${loading.length === 1 ? 'the file is' : 'the files are'} still there and can be opened, then export again.`
      )
    onLabel?.(`Loading the pictures: ${loading.length} left`)
    await cancellable(new Promise((r) => setTimeout(r, 200)), signal)
  }
}

/** Whether this computer decodes a video's pictures (WebCodecs, through
 *  mediabunny): false for a codec it has no decoder for. A file it cannot
 *  even open counts as decodable here (mediaReady says it is unreadable). */
export async function canDecodeVideo(asset: Asset): Promise<boolean> {
  try {
    const track = await getInput(asset).getPrimaryVideoTrack()
    return !track || (await track.canDecode())
  } catch {
    return true
  }
}
