// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import {
  MODEL_CPU_FILES,
  MODEL_MIN_FILES,
  modelFileUrl,
  pickInstalledModel,
  planWhisperMemory,
  spokenLanguage,
  WHISPER_MODELS,
  type SpokenLanguage,
  type WhisperModel,
  type WhisperMemoryPlan
} from './models'
import { projectAudioMono } from '../export/audio'
import { api } from '../platform'
import type { Caption, Project } from '../types'
import { groupWordsIntoCaptions, type WordChunk } from './captions'
import { snapChunkStartsToSpeech } from './timing'
import { frameLevels, mergeSliceWords, planVoiceSlices } from './slices'

let worker: Worker | null = null

// Cancellation. A transcription can stall (a huge decode, a wedged worker),
// and there was no way out. `cancelTranscription` terminates the worker — so
// the next run spawns a clean one — aborts the audio mix, and trips a flag
// the pipeline checks between phases to bail out promptly.
let cancelled = false
let activeReject: ((e: Error) => void) | null = null
/** The running transcription's audio mix: aborted on cancel, so it stops
 *  instead of decoding on behind the next run. */
let activeAbort: AbortController | null = null
/** One transcription at a time: a second would load the model's gigabytes
 *  again beside the first. */
let running = false
/** Request ids: a reply is only taken by the request it answers. */
let requestSeq = 0

export function cancelTranscription(): void {
  cancelled = true
  activeAbort?.abort()
  releaseWhisper()
  activeReject?.(new Error('Transcription cancelled.'))
  activeReject = null
}

/**
 * Ends the Whisper worker. Called after every run (done, failed or
 * cancelled) and on any error from it: what a load holds (ORT's WASM heap,
 * which never shrinks, the model in VRAM, buffers left on the GPU, a half-
 * made session after a failed load) only goes back to the OS with the
 * worker. The next run loads the model again.
 */
function releaseWhisper(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
}

class CancelledError extends Error {}
/** A failure no lighter retry can help (no audio, no model): said at once. */
class FinalError extends Error {}
/** Worker messages that mean the same on every retry. */
const FINAL_RE = /not installed|incomplete|not found|needs WebGPU|already running|no audible audio/i
/** The retries of a run that failed: lighter each time (the worker's safe level). */
const RETRY_LEVELS = 2
const retryLabel = (safe: number): string =>
  safe === 1 ? 'Transcription failed — trying again on the CPU with fewer threads…' : 'Still failing — trying again with one CPU thread (slow, but light)…'
function throwIfCancelled(): void {
  if (cancelled) throw new CancelledError('Transcription cancelled.')
}

/**
 * Awaits `p` but rejects immediately if the user cancels — so even a phase
 * that takes a moment to stop (the audio mix, aborted through the run's
 * signal) releases the UI instead of hanging.
 */
function cancellable<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    activeReject = reject
    p.then(
      (v) => {
        if (activeReject === reject) activeReject = null
        resolve(v)
      },
      (e) => {
        if (activeReject === reject) activeReject = null
        reject(e)
      }
    )
  })
}

/** True once the Whisper model files exist in the local store. */
export async function isWhisperInstalled(): Promise<boolean> {
  if (api) {
    try {
      return (await pickInstalledModel((k) => api!.modelCount(k))) !== null
    } catch {
      return false
    }
  }
  // Plain-browser dev fallback: the IndexedDB cache.
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('autocut-model-cache', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('files')
      req.onsuccess = () => {
        const db = req.result
        try {
          const keys = db.transaction('files', 'readonly').objectStore('files').getAllKeys()
          keys.onsuccess = () =>
            resolve(
              WHISPER_MODELS.some(
                (m) => (keys.result as string[]).filter((k) => String(k).includes(m.key)).length >= MODEL_MIN_FILES
              )
            )
          keys.onerror = () => resolve(false)
        } catch {
          resolve(false)
        }
      }
      req.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' })
    // RPC host: the worker cannot reach the sandboxed preload API, so model
    // disk reads/writes hop through this window. Electron IPC rejects
    // messages over ~256 MB, so gigabyte onnx files move in 32 MB pieces.
    // A file is never built whole here any more (that held the 1.2 GB
    // encoder and the 0.9 GB decoder at once on the editor's own thread):
    // the worker asks for its pieces one by one ('read') and each is handed
    // over as it arrives. Disk jobs run one at a time, in order; the worker
    // takes the big files one after the other.
    const CHUNK = 32 * 1024 * 1024
    let diskQueue: Promise<unknown> = Promise.resolve()
    const serial = <T>(job: () => Promise<T>): Promise<T> => {
      const next = diskQueue.then(job, job)
      diskQueue = next.catch(() => undefined)
      return next
    }
    const diskWrite = async (key: string, data: ArrayBuffer): Promise<boolean> => {
      if (!api) return false
      for (let off = 0; off < data.byteLength; off += CHUNK) {
        const ok = await api.modelAppend(key, data.slice(off, Math.min(data.byteLength, off + CHUNK)), off === 0)
        if (!ok) return false
      }
      return api.modelCommit(key)
    }
    const workerInstance = worker
    workerInstance.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: number; op?: string; key?: string; value?: ArrayBuffer; offset?: number; length?: number }
      if (!d || d.type !== 'rpc' || typeof d.id !== 'number') return
      void (async () => {
        let value: unknown = null
        try {
          const key = d.key ?? ''
          if (d.op === 'available') value = !!api
          else if (d.op === 'size') value = api ? await api.modelSize(key) : null
          else if (d.op === 'read') {
            const { offset, length } = d
            value = api && typeof offset === 'number' && typeof length === 'number'
              ? await serial(() => api!.modelRead(key, offset, length))
              : null
          }
          else if (d.op === 'put') value = await serial(() => diskWrite(key, d.value!))
          else if (d.op === 'count') value = api ? await api.modelCount(key) : 0
        } catch {
          value = d.op === 'count' ? 0 : null
        }
        // Cancellation may terminate and clear the worker while an async disk
        // read is still finishing. The reply then belongs to a dead instance.
        if (worker !== workerInstance) return
        if (value instanceof ArrayBuffer) workerInstance.postMessage({ type: 'rpc-result', id: d.id, value }, [value])
        else workerInstance.postMessage({ type: 'rpc-result', id: d.id, value })
      })()
    })
  }
  return worker
}

export interface TranscribeProgress {
  phase: 'prep' | 'download' | 'transcribe'
  /** 0..1 */
  fraction: number
  /** Estimated seconds remaining, or null when not yet known. */
  etaSec: number | null
  label: string
}

/** What the worker sends about a request; `req` names the request. */
interface WorkerReply {
  type?: string
  req?: number
  message?: string
  progress?: number
  file?: string
  cached?: boolean
  device?: string
  chunks?: WordChunk[]
}

/**
 * Sends one request to the worker and settles on ITS reply: every message
 * about a request carries the request's id, and anything else (a stale
 * reply, the RPC traffic) is ignored. An error reply or a crash ends the
 * worker at once: a failed load leaves half-made sessions behind, and
 * transformers.js keeps the failed first session's promise, so a retry in
 * the same worker would load the gigabytes again only to fail the same way.
 * cancelTranscription() rejects it at once.
 */
function ask<T>(
  w: Worker,
  message: Record<string, unknown>,
  transfer: Transferable[],
  onReply: (msg: WorkerReply) => { value: T } | undefined,
  crashed: string,
  failed: string
): Promise<T> {
  const req = ++requestSeq
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (activeReject === abandon) activeReject = null
    }
    const fail = (err: Error): void => {
      cleanup()
      if (worker === w) releaseWhisper()
      reject(err)
    }
    const abandon = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onMessage = (e: MessageEvent<WorkerReply>): void => {
      const msg = e.data
      if (!msg || msg.req !== req) return
      if (msg.type === 'error') {
        fail(new Error(msg.message ?? failed))
        return
      }
      const done = onReply(msg)
      if (done) {
        cleanup()
        resolve(done.value)
      }
    }
    const onError = (e: ErrorEvent): void => fail(new Error(e.message || crashed))
    activeReject = abandon
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ ...message, req }, transfer)
  })
}

/**
 * Warms the model in the worker BEFORE audio extraction runs on the main
 * thread. Doing both at once starved each other and hung the first
 * "Extracting audio…". Resolves once the model is loaded (the run's later
 * transcribe requests reuse it) with the device it runs on ("CPU, 4
 * threads"), which the transcribing label then shows.
 */
function preloadModel(onProgress: (p: TranscribeProgress) => void, language: SpokenLanguage, safe = 0): Promise<string> {
  return ask<string>(getWorker(), { preload: true, language, safe }, [], (msg) => {
    if (msg.type === 'download') {
      onProgress({
        phase: 'download',
        fraction: (msg.progress ?? 0) / 100,
        etaSec: null,
        label: `Loading local model… ${(msg.progress ?? 0).toFixed(0)}%`
      })
    } else if (msg.type === 'status') {
      onProgress({ phase: 'download', fraction: 0, etaSec: null, label: msg.message ?? 'Loading model…' })
    } else if (msg.type === 'ready') {
      return { value: msg.device ?? '' }
    }
    return undefined
  }, 'Model worker crashed', 'Model failed to load')
}

/** Runs Whisper on raw 16 kHz mono samples; forwards load progress. */
function runWhisper(
  audio: Float32Array,
  onDownload: (pct: number, file: string, cached: boolean) => void,
  language: SpokenLanguage,
  safe = 0
): Promise<WordChunk[]> {
  return ask<WordChunk[]>(getWorker(), { audio, language, safe }, [audio.buffer as ArrayBuffer], (msg) => {
    if (msg.type === 'download') onDownload(msg.progress ?? 0, msg.file ?? '', !!msg.cached)
    else if (msg.type === 'result') return { value: msg.chunks ?? [] }
    return undefined
  }, 'Transcription worker crashed', 'Transcription failed')
}

/** How a run loads the model: as usual, or on one thread when memory is
 *  short (`note` then says so in the progress label). */
interface RunModel {
  language: SpokenLanguage
  note?: string
  /** A lighter load the memory asks for (the worker's safe level). */
  safe?: number
}

/** How long a run waits for memory a run just before it let go (ms). */
const MEMORY_WAIT_MS = 10_000

/** The sizes of a model's ONNX files on disk, or null when one is missing. */
async function onnxSizes(model: WhisperModel, files: readonly string[]): Promise<number[] | null> {
  if (!api) return null
  const sizes = await Promise.all(files.map((file) => api!.modelSize(modelFileUrl(model, file))))
  return sizes.every((size): size is number => typeof size === 'number' && size > 0) ? (sizes as number[]) : null
}

/**
 * Checks the free memory before the model loads (its q8 pair, about 2.2 GB
 * at its peak: subtitles/models.ts planWhisperMemory). Short of the usual
 * room it loads on one thread; with too little for that, the run stops
 * before loading anything, instead of paging the PC to a standstill. No
 * check without the desktop bridge (plain browser dev), nor on a retry (the
 * retry is lighter already).
 */
async function chooseModel(language: SpokenLanguage, safe = 0): Promise<RunModel> {
  if (safe > 0 || !api || typeof api.systemMemory !== 'function') return { language }
  let plan: WhisperMemoryPlan
  try {
    const model = await pickInstalledModel((needle) => api!.modelCount(needle))
    const set = model ? await onnxSizes(model, MODEL_CPU_FILES) : null
    if (!set) return { language }
    plan = planWhisperMemory({ free: (await api.systemMemory()).free, set })
    // A run just over (or the audio mix of one) gives its memory back over a
    // few seconds: waited for, before saying there is none.
    const until = Date.now() + MEMORY_WAIT_MS
    while (plan.use === 'none' && Date.now() < until) {
      throwIfCancelled()
      await new Promise((r) => setTimeout(r, 1000))
      plan = planWhisperMemory({ free: (await api.systemMemory()).free, set })
    }
  } catch (err) {
    if (err instanceof CancelledError) throw err
    // The check itself failed (an old bridge): load as before.
    return { language }
  }
  if (plan.use === 'none') throw new FinalError(plan.error)
  return { language, ...(plan.note ? { note: plan.note } : {}), ...(plan.safe ? { safe: plan.safe } : {}) }
}

/**
 * Runs one transcription: never two at once; the worker ended when it is
 * over, whichever way (its memory back to the OS); its audio mix stopped by
 * cancelTranscription().
 */
async function exclusiveRun<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (running) throw new Error('A transcription is already running.')
  running = true
  cancelled = false
  const abort = new AbortController()
  activeAbort = abort
  try {
    return await job(abort.signal)
  } catch (err) {
    if (cancelled || abort.signal.aborted) throw new Error('Transcription cancelled.')
    throw err
  } finally {
    if (activeAbort === abort) activeAbort = null
    releaseWhisper()
    running = false
  }
}

/** The run's progress with its low-memory note, while the model loads. */
function withNote(onProgress: (p: TranscribeProgress) => void, note?: string): (p: TranscribeProgress) => void {
  return note ? (p) => onProgress({ ...p, label: `${p.label} (${note})` }) : onProgress
}

const SR = 16000

/**
 * Transcribes 16 kHz mono samples in overlapping chunks, reporting real
 * progress and an ETA. Word timestamps come back offset by `baseTime`.
 */
async function transcribeChunked(
  audio: Float32Array,
  baseTime: number,
  onProgress: (p: TranscribeProgress) => void,
  language: SpokenLanguage,
  device: string,
  safe = 0
): Promise<WordChunk[]> {
  const duration = audio.length / SR
  const chunkLen = 25 // seconds fed to Whisper per pass
  const overlap = 3
  const step = chunkLen - overlap
  // Both models: cut in the pauses, never mid-word (subtitles/slices.ts).
  // English used fixed overlapping cuts every 22 s, which kept a word twice
  // or lost it wherever the two pieces timed it on either side of the cut;
  // where there is no pause, the overlapping cut's words are joined so that
  // cannot happen (mergeSliceWords).
  const slices = planVoiceSlices(frameLevels(audio, SR), duration, { maxLen: chunkLen, step, overlap })
  const N = slices.length

  // Words in seconds of `audio`; moved by `baseTime` at the end.
  const merged: WordChunk[] = []
  // The model is pre-warmed before we get here, so chunk 0 is representative:
  // timing from the very start lets an ETA appear after the FIRST chunk rather
  // than the second — on a long video that is the difference between "no idea"
  // and "about 4 minutes left" while you wait.
  const t0 = performance.now()
  let etaSec: number | null = null

  for (let k = 0; k < N; k++) {
    throwIfCancelled()
    const piece = slices[k]
    const slice = audio.slice(
      Math.floor(piece.from * SR),
      Math.min(audio.length, Math.ceil(piece.to * SR))
    )
    onProgress({
      phase: 'transcribe',
      fraction: k / N,
      etaSec,
      // The device on the first part only: the top bar's status is narrow,
      // and the time left goes after the label.
      label: (N > 1 ? `Transcribing… part ${k + 1} of ${N}` : 'Transcribing…') + (device && k === 0 ? ` (${device})` : '')
    })

    const chunks = await runWhisper(slice, (pct, _file, _cached) =>
      onProgress({
        phase: 'download',
        fraction: pct / 100,
        etaSec: null,
        label: `Loading local model… ${pct.toFixed(0)}%`
      }), language, safe
    )
    // Average per-chunk cost so far → estimate for the chunks still to come.
    const done = k + 1
    etaSec = ((performance.now() - t0) / 1000 / done) * (N - done)

    // Each piece's words within its own [keepFrom, keepTo) window, joined
    // to the words before it.
    mergeSliceWords(merged, chunks, piece)
  }
  onProgress({ phase: 'transcribe', fraction: 1, etaSec: 0, label: 'Finishing…' })
  return merged.map((w) => ({
    ...w,
    timestamp: [baseTime + w.timestamp[0], w.timestamp[1] === null ? null : baseTime + w.timestamp[1]]
  }))
}

/**
 * One-click transcription: mixes the timeline audio to 16 kHz mono, runs the
 * local Whisper model in a worker, and returns styled-ready caption lines.
 */
export async function transcribeProject(
  project: Project,
  onProgress: (p: TranscribeProgress) => void,
  maxLineChars: number,
  language: SpokenLanguage = spokenLanguage(project.transcription)
): Promise<Caption[]> {
  return exclusiveRun(async (signal) => {
    const stage = (label: string, fraction = 0) =>
      onProgress({ phase: 'prep', fraction, etaSec: null, label })
    const chunks = await withRetries(onProgress, language, async () => {
      stage('Extracting timeline audio…')
      const audio = await cancellable(projectAudioMono(project, 16000, stage, undefined, signal))
      throwIfCancelled()
      if (audio.every((v) => Math.abs(v) < 1e-4)) throw new FinalError('The timeline has no audible audio to transcribe.')
      return audio
    }, 0)
    return groupWordsIntoCaptions(chunks, {
      maxChars: maxLineChars,
      wordsPerCue: project.captionStyle.wordsPerCue,
      pauseThreshold: project.captionStyle.pauseThreshold
    })
  })
}

/**
 * Picks the run's model (the memory check) and warms it first (see
 * preloadModel), so it isn't loading while the main thread extracts audio:
 * that contention hung the first run.
 */
async function loadForRun(
  onProgress: (p: TranscribeProgress) => void,
  language: SpokenLanguage,
  safe = 0
): Promise<RunModel & { device: string }> {
  const run = await chooseModel(language, safe)
  throwIfCancelled()
  if (run.note) onProgress({ phase: 'download', fraction: 0, etaSec: null, label: `${run.note}…` })
  const device = await preloadModel(withNote(onProgress, run.note), run.language, Math.max(safe, run.safe ?? 0))
  throwIfCancelled()
  return { ...run, device: run.note ? `${run.note}, ${device}` : device }
}

/**
 * Loads the model, gets the audio (once: `getAudio` the first time), and
 * transcribes it, its word starts snapped to the speech; a run that fails
 * (the GPU giving out, the memory running short, the worker dying) tries
 * again lighter — the CPU with half the threads, then one thread — so a
 * transcription gets there whenever it can at all. A failure no retry can
 * help (no audio, no model, a cancel) is said at once.
 */
async function withRetries(
  onProgress: (p: TranscribeProgress) => void,
  language: SpokenLanguage,
  getAudio: () => Promise<Float32Array>,
  baseTime: number
): Promise<WordChunk[]> {
  let audio: Float32Array | null = null
  let last: unknown = null
  for (let safe = 0; safe <= RETRY_LEVELS; safe++) {
    try {
      if (safe > 0) onProgress({ phase: 'download', fraction: 0, etaSec: null, label: retryLabel(safe) })
      const run = await loadForRun(onProgress, language, safe)
      audio ??= await getAudio()
      const chunks = await transcribeChunked(audio, baseTime, onProgress, run.language, run.device, Math.max(safe, run.safe ?? 0))
      // Every word's (and so every cue's) start on its speech onset, from the
      // waveform: Whisper's word times can sit in the pause before a word or
      // a syllable into it.
      return snapChunkStartsToSpeech(chunks, audio, baseTime)
    } catch (err) {
      if (cancelled || err instanceof CancelledError || err instanceof FinalError || FINAL_RE.test(String(err instanceof Error ? err.message : err))) throw err
      last = err
      // Whatever the failed load held goes back to the OS before the next.
      releaseWhisper()
      console.warn(`transcription attempt ${safe + 1} failed:`, err)
    }
  }
  throw last instanceof Error ? new Error(`Transcription failed even on one CPU thread: ${last.message}`) : last
}

/**
 * Re-transcribes just [a, b] seconds of the timeline (e.g. a stretch the
 * first pass missed) and returns captions positioned at absolute times.
 */
export async function transcribeProjectRange(
  project: Project,
  a: number,
  b: number,
  onProgress: (p: TranscribeProgress) => void,
  maxLineChars: number,
  language: SpokenLanguage = spokenLanguage(project.transcription)
): Promise<Caption[]> {
  return exclusiveRun(async (signal) => {
    const stage = (label: string, fraction = 0) =>
      onProgress({ phase: 'prep', fraction, etaSec: null, label })
    // Word timestamps come back offset to absolute timeline time.
    const chunks = await withRetries(onProgress, language, async () => {
      stage('Extracting audio for the marked range…')
      // Mix ONLY the marked window — not the whole project then slice. That
      // makes a short marked range extract in a fraction of the time.
      const audio = await cancellable(projectAudioMono(project, 16000, stage, [a, b], signal))
      throwIfCancelled()
      if (audio.length < 1600 || audio.every((v) => Math.abs(v) < 1e-4)) throw new FinalError('The marked range has no audible audio.')
      return audio
    }, a)
    return groupWordsIntoCaptions(chunks, {
      maxChars: maxLineChars,
      wordsPerCue: project.captionStyle.wordsPerCue,
      pauseThreshold: project.captionStyle.pauseThreshold
    })
  })
}
