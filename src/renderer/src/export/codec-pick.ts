// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which codecs an export (and a preview proxy) uses, from what this computer's
// encoders can do (phase 10b.1; report M1-M2). Desktop Linux has no AAC
// encoder in Chromium (MDN), and whether it has H.264 is not known until it is
// asked: there, an MP4 becomes a WebM (VP9 + Opus) and an M4A an MP3, with the
// reason said in the export window. With both encoders (Windows, as before
// phase 10, and a Mac) every answer is the container asked for. No WASM AAC or
// H.264 encoder is added (that would be a download: YAYIN.md).
// Pure: no DOM, no mediabunny.
import type { ExportContainer } from './formats'

export interface CodecCaps {
  /** An AAC-LC encoder (48 kHz stereo). */
  canAac: boolean
  /** An H.264 encoder (hardware or software). */
  canAvc: boolean
}

export type CodecReason = 'noAac' | 'noAvc'
export type AudioCodec = 'aac' | 'opus' | 'mp3' | 'pcm'
export type VideoCodec = 'avc' | 'vp9'

export interface AudioPick {
  container: ExportContainer
  audio: AudioCodec
  reason?: CodecReason
}

/** The sound's codec for a container; an AAC container without AAC moves:
 *  MP4 → WebM (Opus), M4A → MP3. */
export function pickAudioCodec({ canAac, container }: { canAac: boolean; container: ExportContainer }): AudioPick {
  switch (container) {
    case 'mp4':
      return canAac ? { container, audio: 'aac' } : { container: 'webm', audio: 'opus', reason: 'noAac' }
    case 'm4a':
      return canAac ? { container, audio: 'aac' } : { container: 'mp3', audio: 'mp3', reason: 'noAac' }
    case 'webm':
      return { container, audio: 'opus' }
    case 'mp3':
      return { container, audio: 'mp3' }
    case 'wav':
    // (A GIF has no sound: nothing is encoded for it.)
    case 'gif':
      return { container, audio: 'pcm' }
  }
}

export interface VideoPick {
  container: ExportContainer
  video: VideoCodec
  reason?: CodecReason
}

/** The picture's codec for a (video) container; MP4 without H.264 → WebM (VP9). */
export function pickVideoCodec({ canAvc, container }: { canAvc: boolean; container: ExportContainer }): VideoPick {
  if (container === 'webm') return { container, video: 'vp9' }
  return canAvc ? { container: 'mp4', video: 'avc' } : { container: 'webm', video: 'vp9', reason: 'noAvc' }
}

export interface FormatPick {
  container: ExportContainer
  /** Why it is not the one asked for (empty: it is). */
  reasons: CodecReason[]
}

const AUDIO_ONLY: ReadonlySet<ExportContainer> = new Set(['mp3', 'm4a', 'wav'])

/** The container an export asked for `container` is written in on a computer
 *  with `caps`, and why it moved. */
export function pickExportFormat(container: ExportContainer, caps: CodecCaps): FormatPick {
  // (A GIF is written by the app itself, with no system encoder: KOLAY-PLAN.md.)
  if (container === 'gif') return { container, reasons: [] }
  if (AUDIO_ONLY.has(container)) {
    const a = pickAudioCodec({ canAac: caps.canAac, container })
    return { container: a.container, reasons: a.reason ? [a.reason] : [] }
  }
  const v = pickVideoCodec({ canAvc: caps.canAvc, container })
  const a = pickAudioCodec({ canAac: caps.canAac, container: v.container })
  const reasons = [v.reason, a.reason].filter((r): r is CodecReason => !!r)
  return { container: a.container, reasons }
}

export interface ProxyPick {
  container: 'mp4' | 'webm'
  video: VideoCodec
  audio: 'aac' | 'opus'
}

/** A preview proxy: H.264 + AAC in MP4 where both exist (as before phase
 *  10), else VP9 + Opus in WebM. */
export function pickProxyCodecs(caps: CodecCaps): ProxyPick {
  return caps.canAac && caps.canAvc ? { container: 'mp4', video: 'avc', audio: 'aac' } : { container: 'webm', video: 'vp9', audio: 'opus' }
}
