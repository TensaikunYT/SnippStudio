// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's file formats in one place: what each is called in the dialog,
// its file extension, the save dialog's filter, its MIME type and whether it
// carries a picture at all. The exporter, the export dialog and the Shorts
// batch all read this, so a new format is one entry here (and its encoder).
// Pure: no DOM, so the tests can read it.

export type ExportContainer = 'mp4' | 'webm' | 'wav' | 'mp3' | 'm4a' | 'gif'

export interface ExportFormat {
  id: ExportContainer
  /** The dialog's line. */
  label: string
  /** The short name the progress window and the finished card show. */
  short: string
  ext: string
  mime: string
  /** The save dialog's filter name. */
  filter: string
  /** Sound only: no picture is drawn (and the 3D/terrain loads are skipped). */
  audioOnly: boolean
  /** The sound's codec, for the dialog's readout. */
  audioCodec: string
  /** Its bitrate in bits/s (0 = uncompressed PCM). */
  audioBitrate: number
  /** Its own output in the export window (the GIF: KOLAY-PLAN.md), not a
   *  choice in the video's or the sound's format list. */
  own?: true
}

export const EXPORT_FORMATS: ExportFormat[] = [
  { id: 'mp4', label: 'MP4 (H.264)', short: 'MP4 (H.264)', ext: 'mp4', mime: 'video/mp4', filter: 'MP4 video', audioOnly: false, audioCodec: 'AAC', audioBitrate: 192_000 },
  { id: 'webm', label: 'WebM (VP9)', short: 'WebM (VP9)', ext: 'webm', mime: 'video/webm', filter: 'WebM video', audioOnly: false, audioCodec: 'Opus', audioBitrate: 192_000 },
  { id: 'mp3', label: 'Sound only: MP3', short: 'MP3 audio', ext: 'mp3', mime: 'audio/mpeg', filter: 'MP3 audio', audioOnly: true, audioCodec: 'MP3 (LAME)', audioBitrate: 192_000 },
  { id: 'm4a', label: 'Sound only: M4A (AAC)', short: 'M4A audio (AAC)', ext: 'm4a', mime: 'audio/mp4', filter: 'M4A audio', audioOnly: true, audioCodec: 'AAC', audioBitrate: 192_000 },
  { id: 'wav', label: 'Sound only: WAV', short: 'WAV audio', ext: 'wav', mime: 'audio/wav', filter: 'WAV audio', audioOnly: true, audioCodec: '16-bit PCM', audioBitrate: 0 },
  // A silent animated picture, written by the app itself (export/gif.ts).
  { id: 'gif', label: 'GIF', short: 'GIF', ext: 'gif', mime: 'image/gif', filter: 'GIF image', audioOnly: false, audioCodec: '', audioBitrate: 0, own: true }
]

/** The format for a container (MP4 when none is given). */
export function formatOf(container?: ExportContainer | string | null): ExportFormat {
  return EXPORT_FORMATS.find((f) => f.id === container) ?? EXPORT_FORMATS[0]
}

/** Windows' reserved device names: a file may not be called these (any
 *  extension). */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A name a file on Windows can have, from a project's (or a Short's) name
 * as typed: a video title often holds a question mark or a colon ("Why
 * does the Moon show one face?"), which the save dialog refuses, and a
 * slash cut the Shorts batch's names to what followed it. Each run of
 * characters a file name may not hold becomes a space; spaces are folded,
 * a trailing dot or space goes (Windows drops it), a device name gets a
 * mark, and it is kept to a sensible length. Empty: `fallback`.
 */
export function safeFileName(name: string | null | undefined, fallback = 'video'): string {
  // eslint-disable-next-line no-control-regex
  let s = String(name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > 120) s = s.slice(0, 120).trim()
  s = s.replace(/[. ]+$/, '')
  if (!s) s = fallback
  // A device name with any extension is one too ("nul.backup"): the mark
  // goes on the part before the first dot.
  if (RESERVED.test(s.split('.')[0].trim())) s = s.replace(/^([^.]*?)\s*(\.|$)/, '$1_$2')
  return s
}

/** File names for a batch written into one folder, each its own: a name
 *  met again (Windows does not tell case apart) gets " (2)", " (3)" before
 *  its extension. Two Shorts named alike (deleting "Short 1" and adding one
 *  makes a second "Short 2") were written to one file, the second over the
 *  first (round 12b). */
export function uniqueFileNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((n) => {
    const dot = n.lastIndexOf('.')
    const stem = dot > 0 ? n.slice(0, dot) : n
    const ext = dot > 0 ? n.slice(dot) : ''
    let out = n
    for (let k = 2; seen.has(out.toLowerCase()); k++) out = `${stem} (${k})${ext}`
    seen.add(out.toLowerCase())
    return out
  })
}

/** Seconds of sound handed to the encoder at a time, so the percentage moves
 *  while a long mix is encoded (one call for the whole mix said nothing for
 *  a minute). */
export const AUDIO_ENCODE_CHUNK_SEC = 2

/** [start, end) sample ranges that cover `length` samples in chunks. */
export function audioChunks(length: number, sampleRate: number, chunkSec = AUDIO_ENCODE_CHUNK_SEC): [number, number][] {
  const step = Math.max(1, Math.round(chunkSec * sampleRate))
  const out: [number, number][] = []
  for (let a = 0; a < length; a += step) out.push([a, Math.min(length, a + step)])
  return out
}
