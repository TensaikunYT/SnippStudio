// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The written film opened again and read before it is called done (phase
// Ç3b, decision 5; report R19). On Chromium 150 an encoder error late in a
// film can be lost after flush() resolves (crbug 529852980, fixed in 152):
// a film missing its tail was "done". Now the export counts the packets the
// encoder handed back, and reads what it wrote: its frames, its length, its
// sound; a file that does not hold what was asked is not kept.
//
// Phase Ç3 patch (R-1): the check reads a bounded part of the file. An MP4's
// frames are counted in its index (the moov at the front); a WebM has no
// count anywhere, and counting its blocks read the whole file back through
// IPC (3 GB for a 3 GB film, Cancel dead meanwhile). Its frames are now told
// by its first and last packets (found through the Cues at its end): the
// last frame of a film missing its tail is not there. It stops on Cancel.
import { EncodedPacketSink, Input, MATROSKA, MP4, QTFF, WEBM, type Source } from 'mediabunny'
import { cancellable, checkRenderCancelled } from './cancel'

export interface WrittenExpect {
  frames: number
  /** The video's length (seconds). */
  duration: number
  fps: number
  /** A sound track is there. */
  audio: boolean
}

/** What is wrong with the written file (a short phrase), or null. Throws an
 *  AbortError once `signal` is aborted. */
export async function verifyWritten(source: Source, want: WrittenExpect, signal?: AbortSignal): Promise<string | null> {
  checkRenderCancelled(signal)
  const input = new Input({ source, formats: [MP4, QTFF, WEBM, MATROSKA] })
  const step = <T>(p: Promise<T>): Promise<T> => cancellable(p, signal)
  try {
    const v = await step(input.getPrimaryVideoTrack())
    if (!v) return 'no video track'
    const format = await step(input.getFormat())
    let frames: number
    if (format === MP4 || format === QTFF) {
      // The index at the front holds every sample: no media read.
      frames = (await step(v.computePacketStats())).packetCount
    } else {
      const sink = new EncodedPacketSink(v)
      const first = await step(sink.getFirstPacket({ metadataOnly: true }))
      const last = await step(sink.getPacket(Infinity, { metadataOnly: true }))
      frames = first && last ? Math.round((last.timestamp - first.timestamp) * want.fps) + 1 : 0
    }
    if (frames !== want.frames) return `${frames} frames of ${want.frames}`
    const vd = await step(v.computeDuration())
    if (Math.abs(vd - want.duration) > 1.5 / want.fps) return `the video lasts ${vd.toFixed(3)} s of ${want.duration.toFixed(3)} s`
    if (want.audio) {
      const a = await step(input.getPrimaryAudioTrack())
      if (!a) return 'no sound track'
      const ad = await step(a.computeDuration())
      if (Math.abs(ad - want.duration) > 0.1) return `the sound lasts ${ad.toFixed(3)} s of ${want.duration.toFixed(3)} s`
    }
    return null
  } finally {
    input.dispose()
  }
}

/** "1.2 GB", "340 MB". */
export function sizeLabel(bytes: number): string {
  const mb = bytes / 2 ** 20
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}
