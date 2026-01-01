// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// An export written to its file as it is made (2026-10-12). The exporter used
// to hold the whole finished film in one buffer (mediabunny's BufferTarget,
// MP4 fast start 'in-memory') and hand it over at the end; a 12-minute film
// at the films' 35 Mbps is about 3 GB, more than one buffer in the renderer
// can hold, so it failed with "RangeError: Array buffer allocation failed".
// With a path chosen through the save dialog (or the film tool's, in a dev
// build) the output streams there instead: mediabunny's StreamTarget writes
// at positions into <path>.part through the main process, which renames it
// into place when the file is finished, or drops it on a failure or a cancel.
// An MP4 keeps its fast start (the index at the front) by reserving room for
// it ('reserve'): the packet counts are known before the first frame.
//
// Phase Ç3b (decision 5; reports R19, R25): the finished .part can be read
// back (the export opens what it wrote and checks it before it is kept), and
// a disk that is full or refuses the file says so in a sentence, not in
// Node's words through an IPC wrapper.
import { Mp4OutputFormat, StreamSource, StreamTarget, WebMOutputFormat, type Source, type StreamTargetChunk } from 'mediabunny'
import { api } from '../platform'
import { t } from '../ui/strings'
import { checkRenderCancelled } from './cancel'
import { sizeLabel } from './verify'

export interface FileTarget {
  target: StreamTarget
  /** Closes the file: kept (renamed into place) or dropped. */
  done: (keep: boolean) => Promise<void>
  /** The file as written so far, to read back (mediabunny's Input). */
  source: (signal?: AbortSignal) => Source
  /** The size of the file kept (bytes), read from the file just before it
   *  was put in place; 0 until then. A streamed export returns no buffer,
   *  so the done card's size comes from here (cila4). */
  bytes: () => number
}

/** A file error as the person should read it: a full disk, a file or
 *  folder Windows will not let the export write; and an error from the main
 *  process without its "Error invoking remote method '…': Error:" wrapper. */
export function plainFileError(err: unknown, what: 'video' | 'file' = 'video'): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const msg = raw.replace(/^Error invoking remote method '[^']*':\s*(?:\w*Error:\s*)?/, '')
  const sfx = what === 'file' ? '.file' : ''
  if (/\bENOSPC\b|no space left/i.test(msg)) return new Error(t(`export.disk.full${sfx}`))
  if (/\bEACCES\b|\bEPERM\b|permission denied|operation not permitted/i.test(msg)) return new Error(t(`export.disk.denied${sfx}`))
  if (/\bEROFS\b/i.test(msg)) return new Error(t(`export.disk.denied${sfx}`))
  // (A folder that is not there any more — a drive taken out, a folder
  // deleted — or a "folder" that is a file: phase 11b, U4. It was Node's
  // own English, in the Turkish window too.)
  if (/\bENOENT\b|\bENOTDIR\b|no such file or directory/i.test(msg)) return new Error(t(`export.disk.gone${sfx}`))
  return msg === raw && err instanceof Error ? err : new Error(msg)
}

/** Bytes a whole file is written in, one IPC call each. */
const WHOLE_CHUNK = 16 * 2 ** 20

/**
 * A file made whole in memory (the sound alone, a frame, a Short's sound)
 * written the way a video is (phase Ç3 patch, R-1 / R-2): into <path>.part,
 * then put in place by the main process. They used to be written straight
 * onto the target (fs.writeFile truncates first): a full disk or a failed
 * write left the user's old file of that name emptied. Until the .part
 * replaces it, Cancel drops the .part and the old file stays as it was.
 */
export async function saveWholeFile(path: string, data: Uint8Array, signal?: AbortSignal): Promise<void> {
  checkRenderCancelled(signal)
  const sf = api?.streamFile
  if (!sf) throw new Error('This window cannot write the file.')
  const id = await sf.open(path).catch((e: unknown) => {
    throw plainFileError(e, 'file')
  })
  let placing = false
  try {
    for (let at = 0; at < data.byteLength; at += WHOLE_CHUNK) {
      checkRenderCancelled(signal)
      await sf.write(id, at, data.subarray(at, Math.min(data.byteLength, at + WHOLE_CHUNK)))
    }
    // The last moment a Cancel holds: from here the file is put in place.
    checkRenderCancelled(signal)
    placing = true
    await sf.close(id, true)
  } catch (err) {
    if (!placing) await sf.close(id, false).catch(() => {})
    throw plainFileError(err, 'file')
  }
}

/** Refuses a file of `need` bytes where the disk has less free (a fifth
 *  more is asked, as for a video), before any work. */
export async function checkRoomFor(path: string, need: number, what: 'video' | 'file'): Promise<void> {
  const want = Math.round(need * 1.2)
  const free = await freeSpaceAt(path)
  if (free !== null && free < want) throw new Error(t(what === 'file' ? 'export.disk.short.file' : 'export.disk.short', { need: sizeLabel(want), free: sizeLabel(free) }))
}

/** Opens a stream to `path` (a path the main process counts as chosen). */
export async function fileTarget(path: string): Promise<FileTarget> {
  const sf = api?.streamFile
  if (!sf) throw new Error('This window cannot write a file as it exports.')
  const id = await sf.open(path).catch((e: unknown) => {
    throw plainFileError(e)
  })
  let closed = false
  // The furthest byte written: the size when the file cannot be asked.
  let end = 0
  let kept = 0
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      await sf.write(id, chunk.position, chunk.data).catch((e: unknown) => {
        throw plainFileError(e)
      })
      end = Math.max(end, chunk.position + chunk.data.byteLength)
    }
  })
  return {
    target: new StreamTarget(writable, { chunked: true, chunkSize: 16 * 2 ** 20 }),
    done: async (keep) => {
      if (closed) return
      // The real size of what is kept, asked of the open file (the stream's
      // own door, file:stream-size) before it is closed and renamed.
      const size = keep ? await sf.size(id).catch(() => end) : 0
      closed = true
      await sf.close(id, keep).catch((e: unknown) => {
        throw plainFileError(e)
      })
      if (keep) kept = size
    },
    bytes: () => kept,
    // (Each read stops on Cancel: phase Ç3 patch, R-1.)
    source: (signal) =>
      new StreamSource({
        getSize: () => sf.size(id),
        read: (start, end) => {
          checkRenderCancelled(signal)
          return sf.read(id, start, end - start)
        }
      })
  }
}

/** The free space where `path` goes (bytes), or null when not known. */
export async function freeSpaceAt(path: string): Promise<number | null> {
  try {
    return (await api?.freeSpace?.(path)) ?? null
  } catch {
    return null
  }
}

/** The packets a track will carry at most, for an MP4's reserved index:
 *  the video's frames, and the sound's (AAC or Opus frames of about 1024 or
 *  960 samples at up to 48 kHz), each with room to spare. */
export function packetBounds(totalFrames: number, duration: number): { video: number; audio: number } {
  return { video: totalFrames + 16, audio: Math.ceil((duration * 48000) / 900) + 64 }
}

/** The output format: a WebM as before; an MP4 with fast start kept in
 *  memory for a buffer, or reserved at the front for a stream. */
export function outputFormat(container: string, streamed: boolean): Mp4OutputFormat | WebMOutputFormat {
  if (container === 'webm') return new WebMOutputFormat()
  return new Mp4OutputFormat({ fastStart: streamed ? 'reserve' : 'in-memory' })
}
