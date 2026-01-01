// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { MODEL_CORE_FILES, modelRootNeedle, pickInstalledModel, WHISPER_MODELS, type WhisperLanguage } from '../subtitles/models'
/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers'
import { estimateWordsFromSegments, normalizeWhisperWordTiming } from '../subtitles/timing'
// The ONNX runtime WASM. By default transformers.js fetches this from the
// jsdelivr CDN — which the airgap CSP/webRequest block, causing "failed to
// fetch". Import the file so Vite bundles it locally and point the runtime at
// that bundled URL. Now the wasm loads from the app itself, no network.
// Relative path (not the package specifier) so Vite bundles it despite the
// onnxruntime-web exports map not exposing the raw .wasm.
import ortWasmUrl from '../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url'
// Its JS glue as a file of its own, for the CPU threads. ORT's bundled copy
// of the glue starts each thread as a worker of the script it lives in: in the
// packaged app (file://) that is an "ort.bundle.min.mjs" Vite never emits, and
// elsewhere the whole chunk ORT was bundled into, all of transformers.js
// again. Loaded from its own file, the glue starts its threads from itself.
import ortMjsUrl from '../../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import { trimLoops, whisperCpuThreads, whisperTokenCap } from '../subtitles/decode'
import { PRODUCT_NAME } from '../../../shared/product'
import { chooseDevice, gpuAdapterGiven, type AsrDevice } from '../subtitles/device'
import { uiPlatform } from '../os-platform'

// env.backends is deeply typed/partly read-only; set the path through a cast.
// ORT 1.22 reads the `wasm` key; it ignored the file name this used to be
// keyed by. In the build both name the same emitted file.
const wasmEnv: { wasmPaths?: unknown; numThreads?: number } = (() => {
  const be = (env as unknown as { backends: { onnx?: { wasm?: { wasmPaths?: unknown; numThreads?: number } } } }).backends
  be.onnx ??= {}
  be.onnx.wasm ??= {}
  be.onnx.wasm.wasmPaths = { wasm: ortWasmUrl }
  return be.onnx.wasm
})()

/** True when ORT can run threads here: they share memory, which needs
 *  SharedArrayBuffer (main enables it; the page is not cross-origin isolated)
 *  and a way to post one. Mirrors ORT's own check, so it never has to fall
 *  back with a console warning. */
function threadsUsable(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false
  try {
    if (typeof MessageChannel !== 'undefined') new MessageChannel().port1.postMessage(new SharedArrayBuffer(1))
    return true
  } catch {
    return false
  }
}

// transformers.js resolves model URLs as cache keys; the app serves those
// exact, pinned files from disk. Enable its local-only mode so a cache miss
// fails closed rather than attempting any runtime download.
env.allowLocalModels = true
env.allowRemoteModels = false

// ---------------------------------------------------------------------------
// Model cache backed by IndexedDB. The default browser Cache API is not
// available on the file:// origin the packaged app runs on. IndexedDB persists
// everywhere and is used only as a local fallback when the disk store is absent.
// ---------------------------------------------------------------------------
const DB_NAME = 'autocut-model-cache'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const idbCache = {
  async match(key: unknown): Promise<Response | undefined> {
    try {
      const url = String((key as Request)?.url ?? key)
      const db = await openDb()
      const buf = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(url)
        tx.onsuccess = () => resolve(tx.result as ArrayBuffer | undefined)
        tx.onerror = () => reject(tx.error)
      })
      // Its length declared, so transformers.js reads it into one buffer
      // instead of growing one as it goes.
      return buf ? new Response(buf, { headers: { 'Content-Length': String(buf.byteLength) } }) : undefined
    } catch {
      return undefined
    }
  },
  async put(key: unknown, response: Response): Promise<void> {
    try {
      const url = String((key as Request)?.url ?? key)
      const buf = await response.arrayBuffer()
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(buf, url)
        tx.onsuccess = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch {
      /* caching is best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Disk-backed model cache. The model files live as REAL files on disk (via an
// RPC hop through the window, since the sandboxed preload API is unreachable
// inside a Worker) so they survive restarts, new projects, app updates and
// browser-storage eviction. Plain-browser dev falls
// back to IndexedDB.
// ---------------------------------------------------------------------------
let rpcSeq = 0
const rpcPending = new Map<number, (v: unknown) => void>()
self.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; id?: number; value?: unknown }
  if (d && d.type === 'rpc-result' && typeof d.id === 'number' && rpcPending.has(d.id)) {
    rpcPending.get(d.id)!(d.value)
    rpcPending.delete(d.id)
  }
})
function rpc<T>(op: string, args: { key?: string; value?: ArrayBuffer; offset?: number; length?: number } = {}): Promise<T> {
  return new Promise((resolve) => {
    const id = ++rpcSeq
    rpcPending.set(id, resolve as (v: unknown) => void)
    const msg = { type: 'rpc', id, op, ...args }
    if (args.value) (self as unknown as Worker).postMessage(msg, [args.value])
    else (self as unknown as Worker).postMessage(msg)
  })
}
let diskAvailable: boolean | null = null
async function hasDisk(): Promise<boolean> {
  if (diskAvailable === null) diskAvailable = await rpc<boolean>('available')
  return diskAvailable
}

// A model file streams in from disk in pieces into ONE buffer. It used to be
// built whole in the window, wrapped in a Response that copied it and had no
// length, then grown piece by piece by transformers.js: three or four copies
// of 1.2 GB in the editor's own process at once, which paged the PC to a
// standstill on the English model. Now the window reads one 32 MB piece at a
// time and hands it over; the Response declares the file's length, so
// transformers.js allocates the file once and fills it in place (its progress
// is real, too). The big files come one at a time: the next waits until the
// last piece of the one before it has been read.
const READ_PIECE = 32 * 1024 * 1024
let bigFileGate: Promise<void> = Promise.resolve()

async function diskResponse(url: string): Promise<Response | undefined> {
  const size = await rpc<number | null>('size', { key: url })
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) return undefined
  let release = (): void => {}
  if (size > READ_PIECE) {
    const before = bigFileGate
    bigFileGate = new Promise<void>((resolve) => { release = resolve })
    await before
  }
  let off = 0
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    release()
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (off >= size) {
          finish()
          controller.close()
          return
        }
        const part = await rpc<ArrayBuffer | null>('read', { key: url, offset: off, length: Math.min(READ_PIECE, size - off) })
        if (!(part instanceof ArrayBuffer) || part.byteLength === 0) throw new Error(`Could not read the model file ${url.split('/').pop()} from disk.`)
        off += part.byteLength
        controller.enqueue(new Uint8Array(part))
        if (off >= size) {
          finish()
          controller.close()
        }
      } catch (err) {
        finish()
        controller.error(err)
      }
    },
    cancel() {
      finish()
    }
  })
  return new Response(body, { headers: { 'Content-Length': String(size) } })
}

const modelCache = {
  async match(key: unknown): Promise<Response | undefined> {
    const url = String((key as Request)?.url ?? key)
    if (await hasDisk()) return diskResponse(url)
    return idbCache.match(key)
  },
  async put(key: unknown, response: Response): Promise<void> {
    const url = String((key as Request)?.url ?? key)
    if (await hasDisk()) {
      const buf = await response.arrayBuffer()
      await rpc('put', { key: url, value: buf })
      return
    }
    return idbCache.put(key, response)
  }
}

/** One-time move of any model files stuck in IndexedDB onto disk — then DELETE
 *  the IndexedDB copy so it doesn't sit there as dead weight (~2.5 GB) forever.
 *  Older builds migrated but never deleted, which is why disk usage ballooned. */
async function migrateIdbToDisk(): Promise<void> {
  if (!(await hasDisk())) return
  try {
    const db = await openDb()
    const keys = await new Promise<string[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result as string[])
      req.onerror = () => reject(req.error)
    })
    if (keys.length === 0) return
    for (const key of keys) {
      // The full sanitized key doubles as its own existence probe.
      if ((await rpc<number>('count', { key })) === 0) {
        const buf = await new Promise<ArrayBuffer | undefined>((resolve) => {
          const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
          tx.onsuccess = () => resolve(tx.result as ArrayBuffer | undefined)
          tx.onerror = () => resolve(undefined)
        })
        // Read-only packaged models must not cause the legacy copy to be lost.
        if (buf && !(await rpc<boolean>('put', { key, value: buf }))) return
      }
    }
    // Everything now lives on disk — drop the whole IndexedDB store to reclaim it.
    db.close()
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = del.onerror = del.onblocked = () => resolve()
    })
  } catch {
    /* best-effort */
  }
}

env.useBrowserCache = false
env.useCustomCache = true
env.customCache = modelCache as never

interface AsrResult {
  text: string
  chunks?: { text: string; timestamp: [number, number | null] }[]
}

type AsrPipeline = (
  audio: Float32Array,
  options: {
    return_timestamps: 'word' | boolean
    chunk_length_s: number
    stride_length_s: number
    /** The token cap of the window (subtitles/decode.ts whisperTokenCap). */
    max_new_tokens: number
    language?: string
    task?: 'transcribe'
  }
) => Promise<AsrResult>

/** Segment chunks → pseudo-words with linearly interpolated timestamps. */
function segmentsToWords(chunks: NonNullable<AsrResult['chunks']>): NonNullable<AsrResult['chunks']> {
  const out: NonNullable<AsrResult['chunks']> = []
  for (const chunk of chunks) {
    const words = chunk.text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    const start = chunk.timestamp[0] ?? 0
    const end = chunk.timestamp[1] ?? start + words.length * 0.35
    const per = (end - start) / words.length
    words.forEach((w, i) => {
      out.push({ text: w, timestamp: [start + i * per, start + (i + 1) * per] })
    })
  }
  return out
}

// transformers.js's pipeline() overload union is too complex for tsc, so we
// go through a narrow local signature.
const createPipeline = pipeline as unknown as (
  task: string,
  model: string,
  options: Record<string, unknown>
) => Promise<AsrPipeline>

let asr: AsrPipeline | null = null
let loadedDevice: string | null = null

/** The request being served (requests run one at a time): every status,
 *  progress and reply carries its id, so the window never takes a stale
 *  reply for the one it waits on. */
let currentReq: number | undefined
const post = (msg: Record<string, unknown>) => (self as unknown as Worker).postMessage({ ...msg, req: currentReq })

/**
 * Frees the decoder's last key/value cache after each window. With word
 * timing, generate() returns it in its result (the GPU buffers of the last
 * step: 48 tensors of [1, 16, tokens, 64] float32, about 20 MB a window) and
 * nothing disposes it, so on WebGPU every window leaked it until the session
 * ended: about 1 GB of VRAM over a 20-minute video. Disposing twice is
 * harmless (the encoder's entries are already disposed: location 'none').
 */
function freeLastKvCache(pipe: AsrPipeline): void {
  type Kv = { location?: string; dispose?: () => void }
  const model = (pipe as unknown as { model?: { generate?: (args: unknown) => Promise<unknown> } }).model
  if (!model || typeof model.generate !== 'function') return
  const generate = model.generate.bind(model)
  model.generate = async (args: unknown) => {
    const out = (await generate(args)) as { past_key_values?: Record<string, Kv | undefined> } | null
    const kv = out && typeof out === 'object' ? out.past_key_values : undefined
    if (kv && typeof kv === 'object') {
      for (const t of Object.values(kv)) {
        if (t && t.location === 'gpu-buffer' && typeof t.dispose === 'function') t.dispose()
      }
      out!.past_key_values = undefined
    }
    return out
  }
}

/** Where the loaded model runs, for the progress label. Read after the first
 *  session: ORT lowers numThreads to 1 itself if threads fail to start. */
const deviceLabel = (): string =>
  loadedDevice === 'webgpu' ? 'GPU' : (wasmEnv.numThreads ?? 1) > 1 ? `CPU, ${wasmEnv.numThreads} threads` : 'CPU'

/**
 * A window's words with a decoder loop cut to its first copy
 * (subtitles/decode.ts). transformers.js's Whisper generate() drops the
 * `stopping_criteria` it is given, so the loop cannot be stopped while it is
 * decoded; it is trimmed afterwards. The rule counts tokens, so each word is
 * weighed by its token count.
 */
function withoutLoops<T extends { text: string }>(model: AsrPipeline, words: T[]): T[] {
  const tokenizer = (model as unknown as { tokenizer?: { encode: (text: string, options: { add_special_tokens: boolean }) => number[] } }).tokenizer
  const weights = words.map((w) => {
    try {
      return Math.max(1, tokenizer?.encode(w.text, { add_special_tokens: false }).length ?? 1)
    } catch {
      return 1
    }
  })
  return trimLoops(words, words.map((w) => w.text.trim()), weights)
}

/** Counts cached files whose key contains `needle` (e.g. the model name). */
async function cachedFileCount(needle = ''): Promise<number> {
  if (await hasDisk()) return rpc<number>('count', { key: needle })
  try {
    const db = await openDb()
    return await new Promise<number>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () =>
        resolve((req.result as string[]).filter((k) => String(k).includes(needle)).length)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return 0
  }
}

/** How light this worker's one load is (the first request says): 0 as
 *  usual; 1 the CPU only, half the usual threads; 2 the CPU, one thread —
 *  the retries of a run that failed (subtitles/transcribe.ts). */
let safeLevel = 0

async function load(): Promise<AsrPipeline> {
  if (asr) return asr
  // Rescue older cached files before deciding that the model is absent.
  await migrateIdbToDisk()
  // The one model (phase 9a, decision 7): the multilingual Medium's q8 pair
  // (its `_timestamped` export has the cross-attention outputs word-level
  // timestamps need). It runs on the CPU: its fp16 GPU decoder writes
  // invalid word offsets, and the app does not ship it.
  const chosen = await pickInstalledModel(cachedFileCount)
  const modelName = WHISPER_MODELS[0].label
  if (!chosen) {
    if (!(await Promise.all(MODEL_CORE_FILES.map((file) => cachedFileCount(modelRootNeedle(WHISPER_MODELS[0], file))))).every((count) => count > 0) &&
      (await cachedFileCount(WHISPER_MODELS[0].key)) > 0) {
      throw new Error(`${modelName} is incomplete in resources/models (missing configuration or tokenizer files). Reinstall ${PRODUCT_NAME}.`)
    }
    throw new Error(
      'Speech model not found. Everything else works — only making subtitles needs it. ' +
        'This build looks for the model in the app’s resources/models folder ' +
        `(beside ${uiPlatform() === 'win32' ? `${PRODUCT_NAME}.exe` : `the ${PRODUCT_NAME} program`}). Reinstall ${PRODUCT_NAME} to put it back: ` +
        WHISPER_MODELS.map((m) => `${m.label} ${m.size}`).join(', ') + '.'
    )
  }
  const progress_callback = (p: { status?: string; file?: string; progress?: number }) => {
    if (p.status === 'progress' && typeof p.progress === 'number') {
      post({ type: 'download', progress: p.progress, file: p.file ?? '', cached: true })
    }
  }
  // The one model has a CPU build only (phase 9a): the GPU is not even asked
  // for. Decided by chooseDevice so a GPU build can never again be picked on
  // `'gpu' in navigator` alone (phase 10b.2, M4).
  const modelRuns: readonly AsrDevice[] = ['wasm']
  const pick = chooseDevice({ modelRuns, gpuAdapter: modelRuns.includes('webgpu') ? await gpuAdapterGiven(navigator as never) : false })
  if ('error' in pick) throw new Error(pick.error)
  post({ type: 'status', message: `Loading ${modelName} (CPU)…` })
  loadedDevice = pick.device
  // Set before the first session: ORT reads it once, when it starts the
  // WASM runtime. Left unset ORT runs one thread, because the page is not
  // cross-origin isolated; one thread keeps ORT's bundled glue: only
  // threads need it as a file.
  const usual = whisperCpuThreads(navigator.hardwareConcurrency, threadsUsable())
  wasmEnv.numThreads = safeLevel >= 2 ? 1 : safeLevel === 1 ? Math.max(1, Math.floor(usual / 2)) : usual
  if (wasmEnv.numThreads > 1) wasmEnv.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl }
  try {
    // q8 runs on the WASM/CPU backend. local_files_only and
    // allowRemoteModels=false are intentionally redundant: both prevent a
    // missing model file from silently becoming a network fetch.
    const pipe = await createPipeline('automatic-speech-recognition', chosen.id, {
      device: pick.device,
      dtype: 'q8',
      // No arena and no memory pattern: both grow the WASM heap to their
      // high-water mark and keep it (the heap never shrinks), which on a
      // 16 GB PC with the usual programs open left too little for Windows.
      session_options: { enableCpuMemArena: false, enableMemPattern: false },
      local_files_only: true,
      ...(chosen.revision ? { revision: chosen.revision } : {}),
      progress_callback
    })
    freeLastKvCache(pipe)
    asr = pipe
  } catch (err) {
    throw new Error(`The speech model failed to load on the CPU: ${String(err)}`)
  }
  post({ type: 'installed' })
  return asr
}

interface WhisperRequest {
  /** The window's id for this request; every message about it carries it. */
  req?: number
  audio?: Float32Array
  preload?: boolean
  language?: WhisperLanguage
  /** A retry's lighter load (see safeLevel). */
  safe?: number
}

// One request at a time, in the order they came: two loads at once would
// hold the model's gigabytes twice, and their replies could cross.
let requests: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<WhisperRequest>) => {
  const data = e.data
  // Only requests queue. Internal RPC replies are handled by their own
  // listener above (queued, the reply a load waits on would never come).
  if (!data || (data.preload !== true && !(data.audio instanceof Float32Array))) return
  requests = requests.then(() => serve(data))
}

async function serve(data: WhisperRequest): Promise<void> {
  currentReq = typeof data.req === 'number' ? data.req : undefined
  try {
    await handle(data)
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  } finally {
    currentReq = undefined
  }
}

async function handle(data: WhisperRequest): Promise<void> {
  if (!asr && typeof data.safe === 'number') safeLevel = Math.max(0, Math.min(2, Math.floor(data.safe)))
  // Transformers.js 3.x does not implement Whisper language detection: when
  // omitted it silently defaults to English. The window always names the
  // spoken language (subtitles/models.ts spokenLanguage).
  const spoken = data.language && data.language !== 'auto' ? data.language : 'english'
  const multilingualOptions = { task: 'transcribe' as const, language: spoken }
  // Preload: warm the model on its own, BEFORE the main thread starts the
  // heavy audio extraction. Loading the ~2 GB model and decoding audio at the
  // same time contended badly and hung the first "Extracting audio…".
  if (data.preload) {
    try {
      const firstLoad = !asr
      const model = await load()
      // Warm-RUN the model once on a short silent buffer. Merely loading it
      // wasn't enough — the FIRST real inference does extra initialization
      // (GPU kernels, etc.) that contended with the main-thread audio
      // extraction and hung it. Doing that warm-up here, before extraction,
      // is exactly the "run the model once and it works" the user found.
      // Only once per loaded model: after its first inference that extra
      // initialization is done, and another run is just a wasted 30 s window.
      if (firstLoad) {
        post({ type: 'status', message: `Warming up Whisper (first run, ${deviceLabel()})…` })
        try {
          await model(new Float32Array(16000), {
            return_timestamps: false,
            chunk_length_s: 30,
            stride_length_s: 5,
            max_new_tokens: whisperTokenCap(1, spoken),
            ...multilingualOptions
          })
        } catch {
          /* warm-up failures are non-fatal; the real run will surface errors */
        }
      }
      post({ type: 'ready', device: deviceLabel() })
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return
  }
  const audio = data.audio
  if (!(audio instanceof Float32Array)) return
  const duration = audio.length / 16000
  try {
    const model = await load()
    post({ type: 'status', message: `Transcribing (${loadedDevice})…` })
    let result: AsrResult
    try {
      result = await model(audio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5,
        max_new_tokens: whisperTokenCap(duration, spoken),
        ...multilingualOptions
      })
    } catch (err) {
      // Model without cross-attention outputs: fall back to segment-level
      // timestamps and spread them across the words.
      if (!/cross.attention/i.test(String(err))) throw err
      const seg = await model(audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        max_new_tokens: whisperTokenCap(duration, spoken, true),
        ...multilingualOptions
      })
      result = { text: seg.text, chunks: segmentsToWords(seg.chunks ?? []) }
    }
    if (result.chunks) result = { text: result.text, chunks: withoutLoops(model, result.chunks) }
    {
      // The multilingual model's word timing is checked (the one model).
      const words = result.chunks ?? []
      const normalized = normalizeWhisperWordTiming(words, duration)
      if (normalized) result = { text: result.text, chunks: normalized }
      else if (words.length > 0 || result.text.trim()) {
        // The quantized multilingual export occasionally produces plausible
        // Turkish text with collapsed/out-of-range cross-attention alignment.
        // Ask Whisper for its separate phrase timestamp tokens instead of
        // putting corrupt word offsets on the timeline or discarding the run.
        const segments = await model(audio, {
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
          max_new_tokens: whisperTokenCap(duration, spoken, true),
          ...multilingualOptions
        })
        const estimated = estimateWordsFromSegments(segments.chunks ?? [], duration)
        if (estimated.length === 0) {
          throw new Error('The local multilingual model returned unusable word and phrase timing. No subtitles were added; try a shorter audio selection.')
        }
        result = { text: segments.text, chunks: withoutLoops(model, estimated) }
      }
    }
    post({ type: 'result', text: result.text, chunks: result.chunks ?? [] })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
