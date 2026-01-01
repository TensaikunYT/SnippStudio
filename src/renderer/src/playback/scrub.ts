// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { CanvasSink } from 'mediabunny'
import { getVideoSink, playbackUrlFor, videoPresentationOffset } from '../media/sources'
import type { Asset } from '../types'

/**
 * Decoder-fed frames for everything that is NOT live playback: trim handles
 * and the paused/scrubbing preview.
 *
 * Why this exists: seeking a <video> element is how the preview used to show
 * a paused frame, but every `el.currentTime = t` on long-GOP 4K costs tens to
 * hundreds of milliseconds, and dragging the playhead issued one per tick —
 * a seek storm that froze the UI. Pulling the exact frame from the mediabunny
 * decoder instead (the same path the exporter uses) has no such cost.
 *
 * Two quality tiers: a cheap 640px decode keeps scrubbing real-time, then
 * once the playhead settles the frame is re-decoded sharp so a still frame
 * doesn't look soft. Only ONE decode runs at a time; while it runs, new
 * requests just replace the target, so a fast drag skips intermediate frames
 * instead of queueing them.
 */

const FAST_W = 640
const SHARP_W = 1920
/** Sharp re-decode only after the playhead has been still this long (ms). */
const SETTLE_MS = 160

/**
 * Whether the cheap tier is used at all. Off by default, and tied to the same
 * Adaptive switch as the canvas: a preview that turns to mud the moment you
 * touch the playhead and clears up when you let go is the single most visible
 * thing this editor did, and on a machine that can decode at full size there
 * was never a reason for it. Turn Adaptive on and the fast tier comes back.
 */
let scrubAdaptive = false
export function setScrubAdaptive(on: boolean): void {
  if (on === scrubAdaptive) return
  scrubAdaptive = on
  // The frames on screen are the wrong sharpness, not wrong — keep showing
  // them and let the pump re-decode. Dropping them blanked the preview for as
  // long as the first decode took, on a switch that is about picture quality.
  for (const [id, h] of have) have.set(id, { ...h, sharp: false })
  // Settled by definition: there is no drag in progress when a toolbar button
  // is clicked, so the re-decode should not wait out the settle window. And
  // the pump has to be nudged — nothing else will ask, since the playhead
  // hasn't moved.
  lastChange = 0
  if (!running) void pump(generation)
  ahead.assetId = ''
  ahead.frames = []
  trimGen++
}

/** Decoder sinks, keyed by asset AND the file it plays from: switching proxies
 *  on or off must not keep reading whichever file was opened first. */
const fastSinks = new Map<string, Promise<CanvasSink | null>>()
const sharpSinks = new Map<string, Promise<CanvasSink | null>>()
/** When a sink could not be made (asset+file key): it is tried again after a
 *  while — a file still being written can open later — not on every request. */
const sinkFailedAt = new Map<string, number>()
const SINK_RETRY_MS = 3000

const sinkKey = (asset: Asset): string => `${asset.id}|${playbackUrlFor(asset)}`
const keyAsset = (key: string): string => key.slice(0, key.indexOf('|'))

/** Whether each video's frames were decoded with alpha. A project saved
 *  before 5b says nothing of a WebM's alpha until it is read after opening,
 *  and a relinked file may have alpha the old one had not: when the flag
 *  changes, its decoders and frames go and are made again (5a/5b patch,
 *  audit S-3; the sink was kept, opaque, for the whole session). */
const decodedAlpha = new Map<string, boolean>()
function alphaKnown(asset: Asset): void {
  const a = asset.alpha === true
  const was = decodedAlpha.get(asset.id)
  decodedAlpha.set(asset.id, a)
  if (was !== undefined && was !== a) {
    dropCachedFrames(asset.id)
    bumpFramesVersion()
  }
}

function sinkFor(asset: Asset, sharp: boolean): Promise<CanvasSink | null> {
  alphaKnown(asset)
  const pool = sharp ? sharpSinks : fastSinks
  const key = sinkKey(asset)
  let p = pool.get(key)
  if (!p) {
    const failedAt = sinkFailedAt.get(key)
    if (failedAt !== undefined && performance.now() - failedAt < SINK_RETRY_MS) return Promise.resolve(null)
    // The other file's sink (a proxy toggled): let it go.
    for (const k of [...pool.keys()]) if (keyAsset(k) === asset.id) pool.delete(k)
    const made = getVideoSink(asset, sharp ? SHARP_W : FAST_W).catch(() => null)
    p = made
    pool.set(key, made)
    // A sink that could not be made is not kept for good: it is asked for
    // again later (relinked, or finished writing).
    void made.then((s) => {
      if (s || pool.get(key) !== made) return
      pool.delete(key)
      sinkFailedAt.set(key, performance.now())
    })
  }
  return p
}

interface Want {
  asset: Asset
  time: number
}
interface Have {
  canvas: HTMLCanvasElement
  time: number
  sharp: boolean
}

const want = new Map<string, Want>()
const have = new Map<string, Have>()
/**
 * Decodes that came back empty, per clip: the asset and time that failed.
 * While that same frame is wanted the decoder has nothing to show, so nothing
 * is shown from it — the engine's <video> element takes over — and the pump
 * does not try it again (it would spin: a missing sink answers at once).
 * Storing a blank canvas instead put an empty (or a stale) frame in front of
 * a working element.
 */
const failed = new Map<string, { assetId: string; time: number }>()
const failedHere = (clipId: string, w: Want): boolean => {
  const f = failed.get(clipId)
  return !!f && f.assetId === w.asset.id && Math.abs(f.time - w.time) <= 1e-4
}
/**
 * Bumped whenever a newly decoded frame lands. The preview uses it to know that
 * something changed even though no store state did — without it, skipping
 * redundant redraws while paused would freeze on the first blurry frame.
 */
let framesVersion = 0
export const getFramesVersion = (): number => framesVersion
/** Something the paused preview draws has just become available (an image
 *  finished decoding): redraw, even though nothing in the project changed. */
export const bumpFramesVersion = (): void => {
  framesVersion++
}
const canvases = new Map<string, HTMLCanvasElement>()
let running = false
let generation = 0
let lastChange = 0

/**
 * LRU cache of already-decoded FAST frames, keyed by asset + quantised time.
 * Jumping back and forth on the timeline used to re-decode the same frames over
 * and over, and on long-GOP 4K each of those decodes blocks for hundreds of ms
 * — that is what made navigation feel like it froze. Only the cheap 640px tier
 * is cached, so the memory stays bounded (~36 MB at the cap).
 */
const CACHE_PIXEL_BUDGET = 24e6
const frameCache = new Map<string, HTMLCanvasElement>()
let cachePixels = 0

const cacheKey = (assetId: string, time: number, sharp: boolean): string =>
  `${assetId}|${sharp ? 's' : 'f'}|${time.toFixed(2)}`

function cacheGet(assetId: string, time: number, sharp: boolean): HTMLCanvasElement | undefined {
  const key = cacheKey(assetId, time, sharp)
  const hit = frameCache.get(key)
  if (hit) {
    // Refresh recency.
    frameCache.delete(key)
    frameCache.set(key, hit)
  }
  return hit
}

function cachePut(assetId: string, time: number, sharp: boolean, src: HTMLCanvasElement): void {
  const key = cacheKey(assetId, time, sharp)
  if (frameCache.has(key)) return
  const copy = document.createElement('canvas')
  copy.width = src.width
  copy.height = src.height
  const ctx = copy.getContext('2d')
  if (!ctx) return
  ctx.drawImage(src, 0, 0)
  frameCache.set(key, copy)
  cachePixels += copy.width * copy.height
  // Budgeted in pixels, not frames: sixty 640px frames and sixty 1920px frames
  // are the same count and ten times apart in memory.
  while (cachePixels > CACHE_PIXEL_BUDGET && frameCache.size > 1) {
    const oldest = frameCache.keys().next().value
    if (oldest === undefined) break
    const dropped = frameCache.get(oldest)
    if (dropped) cachePixels -= dropped.width * dropped.height
    frameCache.delete(oldest)
  }
}

/**
 * Ask for `asset`'s frame at clip-local `time` for this clip. Returns the
 * best frame decoded so far (or null on the very first call), and schedules a
 * decode when the request differs from what we already have.
 */
export function requestClipFrame(clipId: string, asset: Asset, time: number): HTMLCanvasElement | null {
  if (asset.kind !== 'video' || asset.missing) return null
  alphaKnown(asset)
  const w = want.get(clipId)
  if (!w || w.asset.id !== asset.id || Math.abs(w.time - time) > 1e-4) {
    want.set(clipId, { asset, time })
    // A new frame is asked for: whatever failed before may well work here.
    failed.delete(clipId)
    lastChange = performance.now()
    if (!running) void pump(generation)
  }
  // The decoder could not give this frame: null, so the element is shown.
  if (failed.has(clipId)) return null
  return have.get(clipId)?.canvas ?? null
}

/** The key a clip's frame is asked under for the "before" side of a
 *  comparison (ONIZLEME-UYGULA-PLAN.md, K8): the engine plays the other side,
 *  so its sweep leaves these alone; releaseCompareFrames lets them go. */
export const COMPARE_KEY = 'cmp:'

/** Forget clips that are no longer on screen. */
export function releaseClipFrames(keep: Set<string>): void {
  for (const id of [...want.keys()]) {
    if (!keep.has(id) && !id.startsWith(COMPARE_KEY)) {
      want.delete(id)
      have.delete(id)
      canvases.delete(id)
      failed.delete(id)
    }
  }
}

/** Forget the comparison's frames but those in `keep` (none: all of them). */
export function releaseCompareFrames(keep: ReadonlySet<string> = new Set()): void {
  for (const id of [...want.keys()]) {
    if (id.startsWith(COMPARE_KEY) && !keep.has(id)) {
      want.delete(id)
      have.delete(id)
      canvases.delete(id)
      failed.delete(id)
    }
  }
}

/** Drop every pending/So-far frame (e.g. when playback starts). */
export function resetClipFrames(): void {
  want.clear()
  have.clear()
  canvases.clear()
  failed.clear()
  // The frame cache is asset-keyed, not clip-keyed, so it deliberately SURVIVES
  // a reset: coming back from playback to the same spot stays instant.
  generation++
}

/** Drops cached frames for an asset (call when its media is replaced/removed). */
export function dropCachedFrames(assetId: string): void {
  for (const key of [...frameCache.keys()]) {
    if (key.startsWith(`${assetId}|`)) {
      const dropped = frameCache.get(key)
      if (dropped) cachePixels -= dropped.width * dropped.height
      frameCache.delete(key)
    }
  }
  if (ahead.assetId === assetId) {
    ahead.assetId = ''
    ahead.frames = []
  }
  // Its decoders too (a relinked file is a different file), and anything
  // that failed on the old one; the frames on screen are decoded again.
  dropSinks((id) => id === assetId)
  for (const [clipId, w] of [...want]) {
    if (w.asset.id !== assetId) continue
    want.delete(clipId)
    have.delete(clipId)
    failed.delete(clipId)
  }
}

function dropSinks(gone: (assetId: string) => boolean): void {
  for (const pool of [fastSinks, sharpSinks]) for (const k of [...pool.keys()]) if (gone(keyAsset(k))) pool.delete(k)
  for (const k of [...sinkFailedAt.keys()]) if (gone(keyAsset(k))) sinkFailedAt.delete(k)
}

/**
 * Lets go of the decoders (and cached frames) of media that is no longer in
 * the project: a deleted asset, or a project closed for another. Called now
 * and then by the engine with the ids of the project's assets.
 */
export function pruneScrubSinks(alive: Set<string>): void {
  dropSinks((id) => !alive.has(id))
  for (const key of [...frameCache.keys()]) {
    if (alive.has(key.slice(0, key.indexOf('|')))) continue
    const dropped = frameCache.get(key)
    if (dropped) cachePixels -= dropped.width * dropped.height
    frameCache.delete(key)
  }
  if (ahead.assetId && !alive.has(ahead.assetId)) {
    ahead.assetId = ''
    ahead.frames = []
  }
}

/** Is any wanted frame neither decoded nor known to fail? */
function unmet(): boolean {
  for (const [clipId, w] of want) {
    const h = have.get(clipId)
    if ((!h || Math.abs(h.time - w.time) > 1e-4) && !failedHere(clipId, w)) return true
  }
  return false
}

async function pump(gen: number): Promise<void> {
  running = true
  try {
    for (;;) {
      if (gen !== generation) return

      // 1) Any clip whose decoded frame doesn't match the requested time?
      // (Not one that already failed at that time: it would be picked again
      // and again.)
      let job: [string, Want] | null = null
      for (const [clipId, w] of want) {
        const h = have.get(clipId)
        if ((!h || Math.abs(h.time - w.time) > 1e-4) && !failedHere(clipId, w)) {
          job = [clipId, w]
          break
        }
      }
      if (job) {
        const [clipId, w] = job
        // Already decoded this exact frame recently? Blit it instead of paying
        // for another decode — this is what makes jumping around feel instant.
        // Adaptive off means there is no cheap tier: decode it sharp the
        // first time and there is nothing left to upgrade afterwards.
        const wantSharp = !scrubAdaptive
        const cached = cacheGet(w.asset.id, w.time, wantSharp)
        if (cached) {
          const cv = canvasFor(clipId)
          if (cv.width !== cached.width || cv.height !== cached.height) {
            cv.width = cached.width
            cv.height = cached.height
          }
          // (Cleared first: a frame with alpha must not lie over the last one.)
          const cg = cv.getContext('2d')
          cg?.clearRect(0, 0, cv.width, cv.height)
          cg?.drawImage(cached, 0, 0)
          have.set(clipId, { canvas: cv, time: w.time, sharp: wantSharp })
          framesVersion++
          continue
        }
        const cv = await decodeInto(clipId, w.asset, w.time, wantSharp)
        if (gen !== generation) return
        if (cv) {
          cachePut(w.asset.id, w.time, wantSharp, cv)
          have.set(clipId, { canvas: cv, time: w.time, sharp: wantSharp })
        } else {
          // Nothing decoded: say so, and let the element show the frame.
          have.delete(clipId)
          failed.set(clipId, { assetId: w.asset.id, time: w.time })
        }
        framesVersion++
        continue
      }

      // 2) Everything matches. Upgrade fast frames to sharp once settled.
      let upgrade: [string, Want] | null = null
      for (const [clipId, w] of want) {
        const h = have.get(clipId)
        if (h && !h.sharp) {
          upgrade = [clipId, w]
          break
        }
      }
      if (!upgrade) return
      if (performance.now() - lastChange < SETTLE_MS) {
        await new Promise((r) => setTimeout(r, 60))
        continue
      }
      const [clipId, w] = upgrade
      const cv = await decodeInto(clipId, w.asset, w.time, true)
      if (gen !== generation) return
      if (cv) cachePut(w.asset.id, w.time, true, cv)
      have.set(clipId, { canvas: cv ?? canvasFor(clipId), time: w.time, sharp: true })
      framesVersion++
    }
  } finally {
    running = false
    // Reset while this pump was mid-decode: new requests found it "running"
    // and did not start one, and this one is quitting — so the frames asked
    // for since would wait for the next playhead move. Start one for them.
    if (gen !== generation && unmet()) void pump(generation)
  }
}

function canvasFor(clipId: string): HTMLCanvasElement {
  let cv = canvases.get(clipId)
  if (!cv) {
    cv = document.createElement('canvas')
    canvases.set(clipId, cv)
  }
  return cv
}

async function decodeInto(
  clipId: string,
  asset: Asset,
  localTime: number,
  sharp: boolean
): Promise<HTMLCanvasElement | null> {
  const sink = await sinkFor(asset, sharp)
  if (!sink) return null
  // Element time in, decoder time out — see videoPresentationOffset.
  const off = await videoPresentationOffset(asset)
  const t = Math.max(0, Math.min(asset.duration - 0.05, localTime)) + off
  let wrapped
  try {
    wrapped = await sink.getCanvas(t)
  } catch {
    return null
  }
  if (!wrapped) return null
  const src = wrapped.canvas
  const w = src.width
  const h = src.height
  if (!w || !h) return null
  const cv = canvasFor(clipId)
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  // Cleared first: a video with alpha (phase 5b) must not lie over the frame
  // before it on this reused canvas.
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(src as CanvasImageSource, 0, 0)
  return cv
}

// ---------------------------------------------------------------------------
// Trim-handle scrub (single frame, always fast tier).
// ---------------------------------------------------------------------------

let trimScratch: HTMLCanvasElement | null = null
let trimQueued: { asset: Asset; localTime: number; onFrame: (f: CanvasImageSource) => void } | null = null
let trimRunning = false
let trimGen = 0
/** Media time served last, so the pump can tell which way the handle is going. */
let trimLast = -1

/**
 * Frames decoded AROUND the trim edge, in presentation order.
 *
 * Dragging a handle backwards is the expensive direction: video is decoded
 * forwards, so every step to an earlier time makes the decoder seek back to the
 * preceding keyframe and decode the whole run again — which is why pulling an
 * edge left crawled while pushing it right was instant. So after a backwards
 * step the pump decodes the half second BEFORE the edge in a single forward
 * pass and keeps those frames; the next few dozen steps are then served from
 * memory. Frames carry their own duration, so a lookup returns exactly the
 * frame `getCanvas` would have — never a neighbouring one.
 */
const ahead: { assetId: string; frames: { t: number; end: number; cv: HTMLCanvasElement }[] } = {
  assetId: '',
  frames: []
}
let trimPrefetch: { asset: Asset; from: number; to: number } | null = null
/** Seconds decoded ahead of a backwards drag, and the cap on retained frames. */
const PREFETCH_SPAN = 0.5
const PREFETCH_MAX = 20

function aheadGet(assetId: string, t: number): HTMLCanvasElement | null {
  if (ahead.assetId !== assetId) return null
  for (const f of ahead.frames) if (t >= f.t - 1e-4 && t < f.end) return f.cv
  return null
}

export function requestFrame(asset: Asset, localTime: number, onFrame: (f: CanvasImageSource) => void): void {
  if (asset.kind !== 'video' || asset.missing) return
  trimQueued = { asset, localTime, onFrame }
  if (!trimRunning) void trimPump(trimGen)
}

async function trimPump(gen: number): Promise<void> {
  trimRunning = true
  try {
    for (;;) {
      if (gen !== trimGen) return
      if (!trimQueued) {
        // Idle between mouse moves: spend it decoding where the drag is headed.
        if (!trimPrefetch) return
        const pf = trimPrefetch
        trimPrefetch = null
        await runPrefetch(pf, gen)
        continue
      }
      const job = trimQueued
      trimQueued = null
      const off = await videoPresentationOffset(job.asset)
      const t = Math.max(0, Math.min(job.asset.duration - 0.05, job.localTime)) + off
      const hit = aheadGet(job.asset.id, t)
      if (hit) {
        framesVersion++
        job.onFrame(hit)
        // Nearly out of decoded material? Extend the window before it's needed.
        if (t < trimLast && t - ahead.frames[0].t < 0.15) {
          trimPrefetch = { asset: job.asset, from: Math.max(0, ahead.frames[0].t - PREFETCH_SPAN), to: ahead.frames[0].t }
        }
        trimLast = t
        continue
      }
      // Trimming answers to the same switch as scrubbing does.
      const sink = await sinkFor(job.asset, !scrubAdaptive)
      if (gen !== trimGen) return
      if (!sink) continue
      let wrapped
      try {
        wrapped = await sink.getCanvas(t)
      } catch {
        continue
      }
      if (gen !== trimGen) return
      if (!wrapped) continue
      const src = wrapped.canvas
      if (!src.width || !src.height) continue
      if (!trimScratch) trimScratch = document.createElement('canvas')
      if (trimScratch.width !== src.width || trimScratch.height !== src.height) {
        trimScratch.width = src.width
        trimScratch.height = src.height
      }
      const ctx = trimScratch.getContext('2d')
      if (!ctx) continue
      ctx.clearRect(0, 0, trimScratch.width, trimScratch.height)
      ctx.drawImage(src as CanvasImageSource, 0, 0)
      // The trim scrub feeds the preview too, so it must advance the same
      // counter — otherwise the paused skip-redraw would freeze mid-drag.
      framesVersion++
      job.onFrame(trimScratch)
      // Moving backwards (or starting fresh): queue the stretch just before the
      // edge, which is what the next moves will ask for.
      if (trimLast < 0 || t <= trimLast) {
        trimPrefetch = { asset: job.asset, from: Math.max(0, t - PREFETCH_SPAN), to: t }
      }
      trimLast = t
    }
  } finally {
    trimRunning = false
  }
}

/** Decodes [from, to) in one forward pass and keeps the frames. Best-effort:
 *  it yields the moment the pointer moves again so the drag never waits on it. */
async function runPrefetch(pf: { asset: Asset; from: number; to: number }, gen: number): Promise<void> {
  if (pf.to - pf.from < 0.02) return
  const sink = await sinkFor(pf.asset, !scrubAdaptive)
  if (!sink || gen !== trimGen) return
  if (ahead.assetId !== pf.asset.id) {
    ahead.assetId = pf.asset.id
    ahead.frames = []
  }
  try {
    for await (const w of sink.canvases(pf.from, pf.to)) {
      if (gen !== trimGen || trimQueued) return
      const src = w.canvas
      if (!src.width || !src.height) continue
      const cv = document.createElement('canvas')
      cv.width = src.width
      cv.height = src.height
      cv.getContext('2d')?.drawImage(src as CanvasImageSource, 0, 0)
      ahead.frames.push({ t: w.timestamp, end: w.timestamp + Math.max(w.duration, 1 / 240), cv })
    }
  } catch {
    /* prefetch is an optimisation; a failure just means a normal decode */
  }
  // Keep the frames just BEFORE the edge — the ones a backwards drag asks for
  // next — and drop what it has already gone past.
  ahead.frames.sort((a, b) => a.t - b.t)
  const edge = trimLast < 0 ? Infinity : trimLast
  const keep = ahead.frames.filter((f) => f.t <= edge + 1e-3)
  ahead.frames = (keep.length ? keep : ahead.frames).slice(-PREFETCH_MAX)
}

/** Abandon any pending/in-flight trim decode (call when a trim gesture ends). */
export function cancelScrub(): void {
  trimQueued = null
  trimPrefetch = null
  trimLast = -1
  ahead.assetId = ''
  ahead.frames = []
  trimGen++
}
