// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The parallel export, the editor's side (the craft run, round 7). The plan
// is in parallel-plan.ts, drawing a stretch in render-worker.ts, the render
// processes in main/render-workers.ts.
//
// The editor starts a few render processes and, while they come up, mixes
// the sound (once, as the single-window export does: the same mix, the same
// `onMix`) and encodes it into the film. The film's stretches go out in
// order to whichever lane is free: the editor's own window is one lane,
// each render process another (each has its own GPU process, which is what
// a frame waits on). Every lane draws with the single-window export's frame
// drawer at the same times, and writes its stretch as an MP4 of its own.
// Then the editor copies the stretches' encoded video, in order, into the
// film (no second encode), and the stretches are deleted. Cancel ends the
// processes; a lane that fails fails the export, and the others stop.

import {
  AudioBufferSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Output,
  QUALITY_HIGH,
  UrlSource,
} from 'mediabunny'
import type { RenderWorkerResult } from '../../../preload/index'
import { importedFontCount } from '../fonts'
import { api } from '../platform'
import { lutRegistry } from '../playback/render'
import type { Project } from '../types'
import { cancellable, checkRenderCancelled } from './cancel'
import type { ExportOptions } from './exporter'
import { formatOf, type ExportContainer } from './formats'
import { joinFrames, joinedTime, onlyHere, probeSet, sameSetup, StretchQueue, stretchesOf, workerCount, type WorkerPlan } from './parallel-plan'
import { drawStretch } from './render-worker'
import { fileTarget, outputFormat, packetBounds } from './file-target'
import { ENCODER_FAULT, type HwPref } from './encoder'
import { frameTime } from '../timeline/rates'

/** What a lane is given: one stretch of the film. */
export interface RenderJob {
  jobId: string
  /** The stretch's number (its place in the film). */
  k: number
  /** The version being exported (versionOf already applied). */
  project: Project
  outW: number
  outH: number
  shorts: boolean
  fps: number
  rangeStart: number
  /** [first, end) frames, counted from the range's start. */
  frames: [number, number]
  codec: 'avc' | 'vp9'
  bitrate: number
  /** The codec string and the encoder the export asked for (encoder.ts). */
  codecString?: string
  hw?: HwPref
  /** Frames to hash (the exactness check), with their PNGs too. */
  probe: number[]
  probePng?: boolean
}

/** Why this project's frames cannot be drawn in other processes (null: they
 *  can): no render processes here, footage or pictures only this window can
 *  read, fonts or a LUT imported into this window alone (parallel-plan.ts,
 *  onlyHere), or a project that cannot be handed over. */
export function parallelBlocked(project: Project): string | null {
  if (!api?.render) return 'one window (no render processes here)'
  // The render processes and the stretches' folder are this window's: one
  // parallel export at a time (the export window runs one job at a time).
  if (running) return 'one window (another parallel export is running here)'
  // A code film's page draws in this window (CODE-FILM-CLIP-PLAN.md, D8:
  // one page per film; the lanes would each start their own).
  for (const c of Object.values(project.clips)) if (project.assets.find((x) => x.id === c.assetId)?.kind === 'code') return 'one window (a code film clip)'
  const onDisk = (url: string): boolean => /^(media|data):/i.test(url) || (!/^[a-z]+:/i.test(url) && !url.startsWith('//'))
  for (const c of Object.values(project.clips)) {
    const a = project.assets.find((x) => x.id === c.assetId)
    if (a && (a.kind === 'video' || a.kind === 'image') && !a.missing && !onDisk(a.url)) return 'one window (footage only this window can read)'
  }
  const imports = onlyHere(importedFontCount(), Object.values(project.clips).map((c) => c.lut), (l) => lutRegistry.has(l))
  if (imports) return imports
  try {
    structuredClone(project)
  } catch {
    return 'one window (the project cannot be handed to another process)'
  }
  return null
}

/** The lane count for this export (parallel-plan.ts's rule, on this
 *  machine as the main process sees it now). */
export async function planWorkers(project: Project, frames: number, fps: number, asked: number | 'auto', outBytes = 0): Promise<WorkerPlan> {
  const m = await api!.render.machine()
  return workerCount(m, { frames, fps, d3: false, asked, outBytes })
}

export interface ParallelContext {
  plan: WorkerPlan
  outW: number
  outH: number
  shorts: boolean
  fps: number
  rangeStart: number
  totalFrames: number
  container: ExportContainer
  videoBitrate: number
  /** The encoder asked (encoder.ts): every lane encodes with it. */
  encoder?: { codecString: string; hw: HwPref }
  /** The graphics card's encoder failed in a lane (phase Ç3 patch, G-1):
   *  the error the export stops with. */
  onEncoderFault?: () => Error
  /** The sound: its bitrate, the one asked, and the mix (the exporter's own). */
  audio: { bitrate: number; asked: number; mix: (share: [number, number]) => Promise<AudioBuffer> } | null
}

/** A parallel export is running in this window. */
let running = false

export async function exportParallel(project: Project, opts: ExportOptions, ctx: ParallelContext): Promise<Uint8Array> {
  running = true
  try {
    return await runParallel(project, opts, ctx)
  } finally {
    running = false
  }
}

async function runParallel(project: Project, opts: ExportOptions, ctx: ParallelContext): Promise<Uint8Array> {
  const R = api!.render
  const { plan, outW, outH, shorts, fps, rangeStart, totalFrames, container, videoBitrate, audio, encoder } = ctx
  const signal = opts.signal
  // A Cancel while the export got ready: no render process is started (one
  // started after it would sit idle for minutes, and the lanes would draw
  // the whole film regardless).
  checkRenderCancelled(signal)
  const stretches = stretchesOf(totalFrames, plan.n, fps)
  const lanes = Math.max(1, Math.min(plan.n, stretches.length))
  opts.onPlan?.({ workers: lanes, why: plan.why, stretches })
  const jobId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
  const codec = container === 'webm' ? 'vp9' : 'avc'
  const probes = probeSet(opts.settings?.probe, joinFrames(stretches))
  // Stops every lane: the person's Cancel, or a lane that failed.
  const inner = new AbortController()
  const stopAll = (): void => {
    inner.abort()
    void R.close().catch(() => {})
  }
  signal?.addEventListener('abort', stopAll)
  // (An abort that came before the listener never fires it.)
  if (signal?.aborted) stopAll()

  // The bar: the sound (while the processes start), the frames, the join.
  const MIX_SHARE = audio ? 0.06 : 0
  const FRAMES_END = 0.95
  const JOIN_END = 0.985
  let drawn = 0
  const current = new Map<number, number>()
  let lastReport = 0
  const report = (force = false): void => {
    const now = performance.now()
    if (!force && now - lastReport < 250) return
    lastReport = now
    let f = drawn
    for (const v of current.values()) f += v
    opts.onProgress(MIX_SHARE + (FRAMES_END - MIX_SHARE) * Math.min(1, f / totalFrames), `Drawing frame ${Math.min(totalFrames, f + 1)} of ${totalFrames} (${lanes} at once)`)
  }
  const unlisten = R.onProgress(({ id, frames }) => {
    current.set(id, frames)
    report()
  })

  // Written to its file as it is joined when a path is given (a long film
  // is more than one buffer can hold: export/file-target.ts).
  // (A file that cannot be opened ends the export here: its listeners go
  // with it, or the next export's progress would land on this dead one.)
  const file = opts.toPath
    ? await fileTarget(opts.toPath).catch((err: unknown) => {
        unlisten()
        signal?.removeEventListener('abort', stopAll)
        throw err
      })
    : null
  const target = file ? file.target : new BufferTarget()
  const output = new Output({ format: outputFormat(container, !!file), target })
  const bounds = packetBounds(totalFrames, frameTime(totalFrames, fps))
  const video = new EncodedVideoPacketSource(codec)
  output.addVideoTrack(video, { frameRate: fps, ...(file ? { maximumPacketCount: bounds.video } : {}) })
  let audioSource: AudioBufferSource | null = null
  if (audio) {
    audioSource = new AudioBufferSource({ codec: container === 'webm' ? 'opus' : 'aac', bitrate: container === 'webm' ? QUALITY_HIGH : audio.bitrate })
    output.addAudioTrack(audioSource, file ? { maximumPacketCount: bounds.audio } : undefined)
  }
  let started = false
  try {
    // The render processes start while the sound is mixed here.
    const opening = lanes > 1 && !inner.signal.aborted ? R.open(lanes - 1) : Promise.resolve([] as number[])
    let openError: string | null = null
    const ready = opening.catch((e: unknown) => {
      openError = e instanceof Error ? e.message : String(e)
      // Said at once: the card shows one lane while this window draws alone.
      opts.onPlan?.({ workers: 1, why: `the editor alone (the render processes did not start: ${openError})`, stretches })
      return [] as number[]
    })
    await output.start()
    started = true
    if (audioSource && audio) {
      const mix = await audio.mix([0, MIX_SHARE * 0.8])
      opts.onMix?.(mix, audio.bitrate, audio.asked)
      opts.onProgress(MIX_SHARE * 0.8, 'Encoding the sound')
      await cancellable(audioSource.add(mix), signal)
      audioSource.close()
    }
    report(true)

    // The stretches, in order, to whichever lane is free.
    const queue = new StretchQueue(stretches)
    const urls: (string | null)[] = stretches.map(() => null)
    let failed: Error | null = null
    let encoderFailed = false
    const fail = (k: number, why: string): void => {
      if (why.startsWith(ENCODER_FAULT)) encoderFailed = true
      if (!failed) failed = new Error(`A render lane failed (frames ${stretches[k][0] + 1}–${stretches[k][1]}): ${why}`)
      stopAll()
    }
    const jobOf = (k: number): RenderJob => {
      const [a, b] = stretches[k]
      return { jobId, k, project, outW, outH, shorts, fps, rangeStart, frames: [a, b], codec, bitrate: videoBitrate, ...(encoder ? { codecString: encoder.codecString, hw: encoder.hw } : {}), probe: probes ? [...probes].filter((f) => f >= a && f < b) : [], probePng: !!opts.settings?.probePng }
    }
    const took = (k: number, r: { probes?: Record<number, string> }): void => {
      drawn += stretches[k][1] - stretches[k][0]
      for (const [f, h] of Object.entries(r.probes ?? {})) opts.onProbe?.(Number(f), h)
      report()
    }
    // The editor's own lane (id 0 in the progress): only when no render process
    // came up. With processes it stays out (2026-10-21: its stretch came out of
    // a different encoder setup, so the join stopped, and a hidden editor drew
    // it some twenty times slower than a process).
    const ownLane = async (): Promise<void> => {
      if ((await ready).length > 0) return
      for (;;) {
        if (failed || inner.signal.aborted) return
        const k = queue.take()
        if (k === null) return
        try {
          const p = await drawStretch(jobOf(k), (pos, data) => R.write(k, pos, data), (n) => {
            current.set(0, n)
            report()
          }, inner.signal)
          urls[k] = await R.written(k)
          current.delete(0)
          took(k, { probes: p })
        } catch (e) {
          current.delete(0)
          if (inner.signal.aborted) return
          fail(k, e instanceof Error ? e.message : String(e))
          return
        }
      }
    }
    const processLane = async (id: number): Promise<void> => {
      for (;;) {
        if (failed || inner.signal.aborted) return
        const k = queue.take()
        if (k === null) return
        let r: RenderWorkerResult
        try {
          r = await R.run(id, jobOf(k))
        } catch (e) {
          r = { ok: false, error: e instanceof Error ? e.message : String(e) }
        }
        current.delete(id)
        if (inner.signal.aborted) return
        if (!r.ok || !r.url) {
          fail(k, r.error ?? 'no stretch came back')
          return
        }
        urls[k] = r.url
        took(k, r)
      }
    }
    await Promise.all([ownLane(), ready.then((ids) => Promise.all(ids.map(processLane)))])
    checkRenderCancelled(signal)
    if (failed) throw encoderFailed && ctx.onEncoderFault ? ctx.onEncoderFault() : failed
    // Every stretch drawn: the processes end.
    await R.close().catch(() => {})

    // The join: each stretch's encoded video, in order, moved to its place.
    let setup: VideoDecoderConfig | null = null
    for (let k = 0; k < stretches.length; k++) {
      checkRenderCancelled(signal)
      const [a, b] = stretches[k]
      const url = urls[k]
      if (!url) throw new Error(`stretch ${k + 1} is missing`)
      const input = new Input({ source: new UrlSource(url), formats: [MP4] })
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track) throw new Error(`stretch ${k + 1} has no video`)
        const cfg = await track.getDecoderConfig()
        if (!cfg) throw new Error(`stretch ${k + 1} has no decoder setup`)
        if (!setup) setup = cfg
        else if (!sameSetup(setup, cfg)) throw new Error(`the lanes' encoders set up differently (stretch ${k + 1}: ${cfg.codec}, the first: ${setup.codec})`)
        let count = 0
        for await (const p of new EncodedPacketSink(track).packets()) {
          checkRenderCancelled(signal)
          await video.add(p.clone({ timestamp: joinedTime(p.timestamp, a, fps) }), k === 0 && count === 0 ? { decoderConfig: setup } : undefined)
          count++
        }
        if (count !== b - a) throw new Error(`stretch ${k + 1} has ${count} frames, not ${b - a}`)
      } finally {
        input.dispose()
      }
      opts.onProgress(FRAMES_END + (JOIN_END - FRAMES_END) * ((k + 1) / stretches.length), `Joining the video: ${k + 1} of ${stretches.length}`)
    }
    video.close()
    opts.onProgress(JOIN_END, `Writing the ${formatOf(container).ext.toUpperCase()} file`)
    await cancellable(output.finalize(), signal)
  } catch (err) {
    inner.abort()
    if (started) await output.cancel().catch(() => {})
    await file?.done(false).catch(() => {})
    throw err
  } finally {
    signal?.removeEventListener('abort', stopAll)
    unlisten()
    await R.finish().catch(() => {})
  }
  if (file) {
    // Until the finished .part replaces the target, Cancel drops it (phase
    // Ç3 patch, R-1); from the replace on the export is done.
    if (signal?.aborted) {
      await file.done(false).catch(() => {})
      checkRenderCancelled(signal)
    }
    await file.done(true)
    opts.onWritten?.(file.bytes())
    return new Uint8Array(0)
  }
  const buffer = (target as BufferTarget).buffer
  if (!buffer) throw new Error('Export produced no data.')
  return new Uint8Array(buffer)
}
