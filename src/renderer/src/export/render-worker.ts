// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Drawing one stretch of a film for the parallel export (the craft run,
// round 7), and a render process's window (the app's page opened with
// `#render-worker`, no editor in it; main/render-workers.ts starts it).
//
// A stretch is drawn with the single-window export's own frame drawer, at
// the times the single-window export gives its frames (the same frame
// wherever it is drawn), encoded with the same settings, and written as an
// MP4 of its own, piece by piece, wherever `write` puts the bytes: the
// render process's main process, or the editor's (its own share).

import { CanvasSource, Mp4OutputFormat, Output, StreamTarget, type StreamTargetChunk } from 'mediabunny'
import { api } from '../platform'
import { checkRenderCancelled } from './cancel'
import { ENCODER_FAULT, isEncoderFault } from './encoder'
import { frameDrawer, picturesReady, preloadImagesForExport, probeHash } from './exporter'
import type { RenderJob } from './parallel'
import { frameTime } from '../timeline/rates'

/** The export last made ready here (a window draws several stretches of one). */
let readyFor: string | null = null

/** Everything the film's frames need, there (once per export). */
async function ready(job: RenderJob): Promise<void> {
  if (readyFor === job.jobId) return
  const { project } = job
  await preloadImagesForExport(project)
  readyFor = job.jobId
}

/**
 * Draws a stretch's frames and writes them, encoded, as an MP4 through
 * `write` (bytes at a position; mediabunny writes the header last). Returns
 * the probed frames' hashes. `onFrames` hears how many are drawn.
 */
export async function drawStretch(
  job: RenderJob,
  write: (position: number, data: Uint8Array) => Promise<unknown>,
  onFrames?: (n: number) => void,
  signal?: AbortSignal
): Promise<Record<number, string>> {
  await ready(job)
  const { project, fps, rangeStart, frames } = job
  const [i0, i1] = frames
  // The pictures this stretch shows, loaded here too (or the lane stops,
  // naming them, rather than drawing its frames without them).
  await picturesReady(project, [rangeStart + frameTime(i0, fps), rangeStart + frameTime(i1, fps)], undefined, signal)
  const drawer = frameDrawer(project, { w: job.outW, h: job.outH, shorts: job.shorts }, signal)
  const sink = new WritableStream<StreamTargetChunk>({ write: async (c) => void (await write(c.position, c.data)) })
  // Pieces of 8 MB: a few writes a second at the films' bitrate.
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(sink, { chunked: true, chunkSize: 8 * 1024 * 1024 }) })
  // The encoder the export asked for (encoder.ts), a key frame every 2 s.
  const source = new CanvasSource(drawer.canvas, { codec: job.codec, bitrate: job.bitrate, keyFrameInterval: 2, ...(job.codecString ? { fullCodecString: job.codecString } : {}), ...(job.hw ? { hardwareAcceleration: job.hw } : {}) })
  output.addVideoTrack(source, { frameRate: fps })
  // An error of the hardware encoder is marked for the editor (phase Ç3
  // patch, G-1): the export stops with its own sentence, no lane retry.
  const encode = async (p: Promise<unknown>): Promise<void> => {
    try {
      await p
    } catch (err) {
      if (job.hw === 'prefer-hardware' && isEncoderFault(err)) throw new Error(ENCODER_FAULT + (err instanceof Error ? err.message : String(err)))
      throw err
    }
  }
  const probe = new Set(job.probe)
  const probes: Record<number, string> = {}
  try {
    await output.start()
    for (let i = i0; i < i1; i++) {
      checkRenderCancelled(signal)
      // The same time as the single-window export gives this frame.
      const t = rangeStart + frameTime(i, fps)
      await drawer.draw(t)
      if (probe.has(i)) probes[i] = await probeHash(drawer.canvas, job.probePng)
      await encode(source.add(frameTime(i, fps) - frameTime(i0, fps), frameTime(i + 1, fps) - frameTime(i, fps)))
      if ((i - i0) % 10 === 9) onFrames?.(i - i0 + 1)
    }
    source.close()
    await encode(output.finalize())
    onFrames?.(i1 - i0)
    return probes
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  } finally {
    drawer.close()
  }
}

/** A render process's window: listening, then ready. */
export function startRenderWorker(): void {
  const R = api?.render
  if (!R) return
  // One stretch at a time, in the order given.
  let chain = Promise.resolve()
  R.onJob((raw) => {
    const job = raw as RenderJob
    chain = chain.then(async () => {
      try {
        const probes = await drawStretch(job, (p, d) => R.workerWrite(p, d), (n) => R.workerProgress(n))
        R.workerDone({ ok: true, probes })
      } catch (err) {
        R.workerDone({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
  })
  R.workerReady()
}
