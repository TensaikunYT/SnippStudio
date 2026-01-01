// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The microphone (REF-AB, worker S, item 8; REF-AB-PLAN-S.md). Opened only
// when the user presses Record: the page first tells the main process it is
// about to ask (`voiceover.arm`: the permission handler grants a microphone,
// and nothing else, only to the editor's own page right after that press).
// The samples are taken on the audio thread (voiceover-worklet.ts), raw: no
// echo cancelling, noise suppression or automatic gain.
import workletUrl from './voiceover-worklet.ts?worker&url'
import { api } from '../platform'
import { MAX_TAKE_SECONDS, peakOf, toInt16, VOICEOVER_RATE } from './voiceover'

export interface Mic {
  deviceId: string
  label: string
}

/** The microphones. Their names come only once the microphone was allowed
 *  (Chromium hides them before); until then, the default alone. */
export async function listMics(): Promise<Mic[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label)
      .map((d) => ({ deviceId: d.deviceId, label: d.label }))
  } catch {
    return []
  }
}

export interface Take {
  chunks: Int16Array[]
  frames: number
  rate: number
}

/** Why the microphone did not open (the page says it in words). */
export type MicError = 'denied' | 'none' | 'busy' | 'failed'

export class MicOpenError extends Error {
  constructor(readonly why: MicError, message: string) {
    super(message)
  }
}

function micErrorOf(err: unknown): MicError {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none'
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy'
  return 'failed'
}

async function askMic(deviceId: string): Promise<MediaStream> {
  const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  const ask = (id: string): Promise<MediaStream> => navigator.mediaDevices.getUserMedia({ audio: id ? { ...raw, deviceId: { exact: id } } : raw, video: false })
  // One press, one permission: the main process grants the next request only.
  await api?.voiceover?.arm()
  try {
    return await ask(deviceId)
  } catch (err) {
    // The chosen microphone is gone (unplugged): the default one.
    if (deviceId && micErrorOf(err) === 'none') {
      await api?.voiceover?.arm()
      return ask('')
    }
    throw err
  }
}

/** One open microphone: level while it is open, samples between start and stop. */
export class MicSession {
  private chunks: Int16Array[] = []
  private frames = 0
  private recording = false
  private stopped: (() => void) | null = null
  /** The loudest sample of the last block (0..1), for the meter. */
  onLevel: (peak: number) => void = () => {}
  /** The take reached its longest (MAX_TAKE_SECONDS). */
  onFull: () => void = () => {}

  private constructor(
    private readonly stream: MediaStream,
    private readonly ctx: AudioContext,
    private readonly node: AudioWorkletNode
  ) {
    node.port.onmessage = (e: MessageEvent): void => {
      const d = e.data as { samples?: Float32Array; recording?: boolean; stopped?: boolean }
      if (d.stopped) {
        this.stopped?.()
        this.stopped = null
        return
      }
      if (!d.samples) return
      this.onLevel(peakOf(d.samples))
      if (d.recording && this.recording) {
        this.chunks.push(toInt16(d.samples))
        this.frames += d.samples.length
        if (this.frames >= MAX_TAKE_SECONDS * VOICEOVER_RATE) this.onFull()
      }
    }
  }

  static async open(deviceId: string): Promise<MicSession> {
    let stream: MediaStream
    try {
      stream = await askMic(deviceId)
    } catch (err) {
      throw new MicOpenError(micErrorOf(err), err instanceof Error ? err.message : String(err))
    }
    const ctx = new AudioContext({ sampleRate: VOICEOVER_RATE, latencyHint: 'interactive' })
    try {
      await ctx.audioWorklet.addModule(workletUrl)
      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'snipp-voiceover-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
      // Pulled by the graph through a silent gain: nothing reaches the speakers.
      const hush = ctx.createGain()
      hush.gain.value = 0
      src.connect(node)
      node.connect(hush)
      hush.connect(ctx.destination)
      if (ctx.state === 'suspended') await ctx.resume()
      return new MicSession(stream, ctx, node)
    } catch (err) {
      for (const tr of stream.getTracks()) tr.stop()
      void ctx.close()
      throw new MicOpenError('failed', err instanceof Error ? err.message : String(err))
    }
  }

  /** The microphone's name as Chromium knows it. */
  get label(): string {
    return this.stream.getAudioTracks()[0]?.label ?? ''
  }

  get seconds(): number {
    return this.frames / VOICEOVER_RATE
  }

  start(): void {
    this.chunks = []
    this.frames = 0
    this.recording = true
    this.node.port.postMessage('start')
  }

  /** The take so far, with the last part block in it. */
  async stop(): Promise<Take> {
    if (this.recording) {
      const done = new Promise<void>((resolve) => {
        this.stopped = resolve
        setTimeout(resolve, 1000)
      })
      this.node.port.postMessage('stop')
      await done
      this.recording = false
    }
    return { chunks: this.chunks, frames: this.frames, rate: VOICEOVER_RATE }
  }

  /** The microphone off (its light goes out) and the graph gone. */
  close(): void {
    this.recording = false
    try {
      this.node.port.postMessage('close')
      this.node.disconnect()
    } catch {
      /* gone */
    }
    for (const tr of this.stream.getTracks()) tr.stop()
    void this.ctx.close().catch(() => undefined)
  }
}
