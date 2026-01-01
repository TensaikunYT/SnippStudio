// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { volumeAt } from '../audio/envelope'
import { TimelineSfxPlayer } from '../audio/timeline-sfx'
import { useStore } from '../state/store'
import type { Asset, Clip } from '../types'
import { playbackUrlFor } from '../media/sources'
import { assetById, flatClipsOfTrack, projectDuration, trackAudible } from '../types'
import { clipMediaAt, incomingTransitionInfo, outgoingTransitionWindow, pruneClipScratch, soundWindows, type SourceResolver } from './render'
import { bumpFramesVersion, pruneScrubSinks, releaseClipFrames, requestClipFrame, resetClipFrames } from './scrub'
import { aliveClipIds, clockStep, playheadJumped, tickSeconds, transitionGain } from './engine-rules'
import { PLAYABLE_MAX, PLAYABLE_MIN, audibleGain, elementPlayable, keepsPitch, speedAudible } from '../timeline/speed'
import { hasCurve } from '../timeline/speed-curve'
import { codeFilms } from '../media/codefilm'
import { candidate, shownProject } from './candidate'
import { playRate } from './play-rate'

/** How far ahead a clip's media element is prepared during playback. Long
 *  enough to absorb a cold element's load+seek, short enough that only the
 *  next shot or two ever holds a decoder early. */
const PREROLL_SEC = 1.2

/** Longest the transport waits for media to be ready before rolling anyway. */
const PRIME_TIMEOUT_MS = 1500

/** Released media elements kept for reuse, per kind. */
const FREE_ELEMENTS_MAX = 16

/**
 * Drives the transport clock and keeps hidden <video>/<audio> elements in
 * sync with the timeline for real-time preview. Drawing itself is delegated
 * to whoever registers `onDraw` (the preview canvas component).
 */
/** One media element's audio path: the tap, its gain, and the effect nodes
 *  when it has effects. Built lazily and re-pointed, never rebuilt —
 *  recreating a MediaElementAudioSourceNode is impossible, and rebuilding the
 *  rest mid-play clicks. The element itself is reused once its clip lets go of
 *  it (see releaseEl), so its source node is too. */
interface FxChain {
  source: MediaElementAudioSourceNode
  /** The clip's volume, envelope and crossfade (0–2, as the export applies
   *  them): an element's own volume stops at 1, so a boost above 100 % was
   *  silent in the preview and loud in the file. */
  gain: GainNode
  /** The value last given to `gain` (so it is only scheduled on a change). */
  level: number
  /** Whether the chain is connected to the meter (a released element's is not). */
  attached: boolean
  nodes: {
    meter: AnalyserNode
    gate: GainNode
    hp: BiquadFilterNode
    lp: BiquadFilterNode
    low: BiquadFilterNode
    mid: BiquadFilterNode
    high: BiquadFilterNode
    comp: DynamicsCompressorNode
    buf: Float32Array<ArrayBuffer>
  } | null
  fxOn: boolean
  gateGain: number
  hold: number
}

export class PreviewEngine {
  onDraw: ((resolve: SourceResolver) => void) | null = null

  private videos = new Map<string, HTMLVideoElement>()
  private audios = new Map<string, HTMLAudioElement>()
  private images = new Map<string, HTMLImageElement>()
  /** Last successfully decoded frame per video clip; shown while seeking so
   *  jumps never flash a black frame. */
  private lastFrames = new Map<string, HTMLCanvasElement>()
  private lastFrameAt = new Map<string, number>()
  /** Decoder-exact frames injected during a trim scrub (clipId → frame). */
  private scrubFrames = new Map<string, CanvasImageSource>()
  /** Decoder frames used while paused/scrubbing instead of <video> seeks. */
  private pausedFrames = new Map<string, CanvasImageSource>()
  /** Clips played beyond what a media element can (above 16x): their
   *  picture comes from the decoder while playing too. */
  private steppedIds = new Set<string>()
  private wasPlaying = false
  /** The timeline's own sounds, scheduled on the Web Audio clock while playing. */
  private timelineSfx = new TimelineSfxPlayer()
  /** Last resort seek timestamps, so a failed decode can't strand the frame. */
  private lastFallbackSeek = new Map<string, number>()
  /** When each clip was last on screen, for releasing idle decoders. */
  private lastActiveAt = new Map<string, number>()
  /** When the playhead last moved, used to detect a settled scrub. */
  private lastTimeChangeAt = 0
  private prevTimeSeen = -1
  /**
   * Priming window after Play is pressed: the clock is HELD while the media
   * elements seek and buffer.
   *
   * Without it the transport started counting immediately while the <video> was
   * still working through a cold seek, so the picture sat frozen for a second
   * or more and then jumped to wherever the clock had got to. It looked like
   * playback "started late"; in fact it had already started — just without a
   * picture. Holding the clock costs the same wall-clock wait but the first
   * frame you see is the frame you asked for, and audio and video begin
   * together. 0 = not priming.
   */
  private primingUntil = 0
  /** The time the engine itself last wrote while rolling. The store's time
   *  differing from it means the playhead was moved during playback (a key,
   *  a marker, "Go there"): that is re-primed like a loop wrap. */
  private lastWritten = 0
  /** A hold has just ended: the next rolling tick tells the parked elements
   *  to play, and the clock starts from that moment (engine-rules.ts,
   *  clockStep). */
  private handOver = false
  /** Released elements, kept (with their audio source node) for the next clip. */
  private freeVideos: HTMLVideoElement[] = []
  private freeAudios: HTMLAudioElement[] = []
  /** Images already handed to decode() ahead of being drawn. */
  private decoding = new WeakSet<HTMLImageElement>()
  /** Throttles how often the audio-drift readout is published. */
  private lastDriftAt = 0
  private raf = 0
  private interval = 0
  private lastNow = 0
  private lastTickAt = 0
  private lastDrawAt = 0
  /** When a redraw last went through, and since when the transport has been
   *  rolling — for the watchdog that says when playback is stuck. */
  private lastDrawnAt = 0
  private playingSince = 0
  private saidStuck = false
  /** The Shorts part this playback loops in: only one it started inside (a
   *  part the playhead was outside of, or one too short to play, made Play
   *  jump back and prime again and again — stuck in place). */
  private segLoop: string | null = null
  /** When the transport last wrapped back (a loop), for the watchdog. */
  private wraps: number[] = []
  private pruneCounter = 0
  private audioCtx: AudioContext | null = null
  /** The candidate shown at the last tick (null: the live project). */
  private shownKey: object | null | undefined = undefined
  /** While true, getAnalyser won't resume the context (see suspendAudio). */
  private audioSuspended = false
  private analyser: AnalyserNode | null = null
  private routed = new WeakSet<HTMLMediaElement>()
  /** Per-element audio FX chain, built once and re-pointed rather than rebuilt. */
  private chains = new WeakMap<HTMLMediaElement, FxChain>()

  readonly resolve: SourceResolver = (clip, asset, localTime) => {
    // A code film: the frame its page drew (exact while still, ahead while
    // playing: media/codefilm.ts).
    if (asset.kind === 'code') return codeFilms.frameFor(clip, asset, localTime)
    if (asset.kind === 'image') {
      const img = this.getImage(asset)
      return img.complete && img.naturalWidth > 0 ? img : null
    }
    if (asset.kind === 'video') {
      // A live trim scrub overrides the <video> element with the exact
      // decoder frame at the trim edge.
      const scrub = this.scrubFrames.get(clip.id)
      if (scrub) return scrub
      // Paused: the decoder frame is authoritative (no <video> seek at all).
      const paused = this.pausedFrames.get(clip.id)
      if (paused) return paused
      const el = this.videos.get(clip.id)
      if (el && el.readyState >= 2 && !el.seeking) {
        this.snapshotFrame(clip.id, el)
        return el
      }
      // Element not ready (mid-seek): fall back to the last good frame.
      return this.lastFrames.get(clip.id) ?? (el && el.readyState >= 2 ? el : null)
    }
    return null
  }

  /** Lets the decoder stills go so the elements take over — but not those
   *  of clips stepped through (above 16x): their element is parked, the
   *  decoder's frame is their only right picture, and the next one replaces
   *  it. */
  private dropPausedFrames(): void {
    for (const id of [...this.pausedFrames.keys()]) if (!this.steppedIds.has(id)) this.pausedFrames.delete(id)
  }

  /** Copies the element's current frame at most every 250 ms. */
  private snapshotFrame(clipId: string, el: HTMLVideoElement): void {
    const now = performance.now()
    if (now - (this.lastFrameAt.get(clipId) ?? 0) < 250) return
    this.lastFrameAt.set(clipId, now)
    let canvas = this.lastFrames.get(clipId)
    const vw = el.videoWidth
    const vh = el.videoHeight
    if (!vw || !vh) return
    // This is only the stand-in shown while a seek is in flight, so cap it at
    // 1080p: 4K sources copy 4x fewer pixels for no visible difference.
    const w = Math.min(1920, vw)
    const h = Math.max(1, Math.round((vh * w) / vw))
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      this.lastFrames.set(clipId, canvas)
    }
    try {
      const g = canvas.getContext('2d')!
      // Cleared first: a video with alpha (phase 5b) must not pile up.
      g.clearRect(0, 0, w, h)
      g.drawImage(el, 0, 0, w, h)
    } catch {
      /* frame not available; keep the previous snapshot */
    }
  }

  /** Show a decoder-exact frame for a clip during a trim drag (null clears). */
  setScrubFrame(clipId: string, frame: CanvasImageSource | null): void {
    if (frame) this.scrubFrames.set(clipId, frame)
    else this.scrubFrames.delete(clipId)
  }

  /** Drop all trim-scrub overrides (call when the gesture ends). */
  clearScrub(): void {
    this.scrubFrames.clear()
  }

  /** Lazily builds the WebAudio meter chain and returns the analyser. */
  getAnalyser(): AnalyserNode | null {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext()
        this.analyser = this.audioCtx.createAnalyser()
        this.analyser.fftSize = 1024
        this.analyser.connect(this.audioCtx.destination)
        for (const el of [...this.videos.values(), ...this.audios.values()]) this.route(el)
      } catch {
        return null
      }
    }
    if (this.audioCtx.state === 'suspended' && !this.audioSuspended) void this.audioCtx.resume()
    return this.analyser
  }

  private route(el: HTMLMediaElement): void {
    if (!this.audioCtx || !this.analyser || this.routed.has(el)) return
    try {
      const ctx = this.audioCtx
      const source = ctx.createMediaElementSource(el)
      const gain = ctx.createGain()
      // Straight to the meter until something actually asks for an effect: an
      // element with no FX must not pay for six nodes it isn't using, and the
      // fewer nodes in the path the fewer ways there are to make it silent.
      source.connect(gain)
      gain.connect(this.analyser)
      this.chains.set(el, { source, gain, level: 1, attached: true, nodes: null, fxOn: false, gateGain: 1, hold: 0 })
      this.routed.add(el)
    } catch {
      /* already connected elsewhere */
    }
  }

  /** Takes a released element's audio path off the meter, so the audio thread
   *  stops pulling it: its source node can never be freed, only disconnected. */
  private detach(el: HTMLMediaElement): void {
    const ch = this.chains.get(el)
    if (!ch || !ch.attached) return
    try {
      ch.source.disconnect()
      ch.gain.disconnect()
      ch.nodes?.comp.disconnect()
    } catch {
      /* already disconnected */
    }
    ch.attached = false
    ch.fxOn = false
    ch.hold = 0
    this.openGate(ch)
  }

  /** Puts an element's audio path back (a reused element), or builds it. */
  private attach(el: HTMLMediaElement): void {
    const ch = this.chains.get(el)
    if (!ch) {
      this.route(el)
      return
    }
    if (ch.attached || !this.analyser) return
    try {
      ch.source.connect(ch.gain)
      ch.gain.connect(this.analyser)
      ch.gain.gain.cancelScheduledValues(0)
      ch.gain.gain.value = 1
      ch.level = 1
      ch.attached = true
    } catch {
      /* the graph is gone (no context): the element plays unrouted */
    }
  }

  /** Opens the gate fully (an effect switched off, a released element): the
   *  gate node keeps its last value otherwise, and a closed one is silence. */
  private openGate(ch: FxChain): void {
    ch.gateGain = 1
    if (!ch.nodes) return
    ch.nodes.gate.gain.cancelScheduledValues(0)
    ch.nodes.gate.gain.value = 1
  }

  /**
   * The clip's level this tick (0–2: volume, keyframes, fades, crossfade). On
   * the Web Audio path the element stays at full volume and the gain node
   * carries the level, so a boost above 100 % is heard as the export writes
   * it. Without a graph (no AudioContext yet) the element's own volume is the
   * only control, and it stops at 1.
   */
  private setLevel(el: HTMLMediaElement, level: number): void {
    const ch = this.chains.get(el)
    const ctx = this.audioCtx
    el.muted = level === 0
    if (!ch || !ch.attached || !ctx) {
      el.volume = Math.max(0, Math.min(1, level))
      return
    }
    if (el.volume !== 1) el.volume = 1
    if (Math.abs(ch.level - level) < 1e-4) return
    ch.level = level
    const g = ch.gain.gain
    if (el.paused) {
      // Not sounding: no reason to glide, and a glide would be heard as the
      // element starts.
      g.cancelScheduledValues(ctx.currentTime)
      g.setValueAtTime(level, ctx.currentTime)
    } else g.setTargetAtTime(level, ctx.currentTime, 0.01)
  }

  /**
   * Lets go of an element whose clip is gone or idle: its decoder and file
   * are released, its audio path is taken off the meter, and it is kept for
   * the next clip. Creating a fresh element (and so a fresh, unfreeable audio
   * source node) for every clip that ever played made the audio graph grow
   * for the whole session.
   */
  private releaseEl(el: HTMLMediaElement): void {
    el.pause()
    el.removeAttribute('src')
    delete el.dataset.src
    el.load()
    this.detach(el)
    if (el instanceof HTMLVideoElement) {
      if (this.freeVideos.length < FREE_ELEMENTS_MAX) this.freeVideos.push(el)
    } else if (el instanceof HTMLAudioElement) {
      if (this.freeAudios.length < FREE_ELEMENTS_MAX) this.freeAudios.push(el)
    }
  }

  /** Whether an image is still on its way: asked for, not loaded, not failed. */
  readonly imagePending = (asset: Asset): boolean => {
    const img = this.images.get(asset.id)
    return !!img && img.dataset.src === asset.url && !img.complete
  }

  /** Starts loading an image (if it isn't yet); resolves once it has loaded
   *  or failed. The caller bounds the wait. */
  readonly warmImage = (asset: Asset): Promise<void> => {
    const img = this.getImage(asset)
    if (img.complete) return Promise.resolve()
    return new Promise<void>((ok) => {
      img.addEventListener('load', () => ok(), { once: true })
      img.addEventListener('error', () => ok(), { once: true })
    })
  }

  /** An image a clip is about to show, loading and decoding ahead of its first
   *  frame (decode() is never awaited: in a hidden window it can wait for
   *  ever; a loaded image draws all the same). */
  private prefetchImage(asset: Asset): HTMLImageElement {
    const img = this.getImage(asset)
    if (!this.decoding.has(img)) {
      this.decoding.add(img)
      if (typeof img.decode === 'function') img.decode().catch(() => {})
    }
    return img
  }

  /**
   * Makes a clip's audio effects AUDIBLE, using the same node types and the
   * same parameters the export mix builds — so what you hear while editing is
   * what gets written, instead of EQ and compression that only existed in the
   * rendered file.
   *
   * The noise gate is the one exception: the export gates the decoded samples
   * with a sample-accurate follower, which WebAudio has no node for. Here it
   * runs at the tick rate against the pre-FX signal, which is close enough to
   * judge a threshold by and is smoothed rather than stepped.
   */
  private applyAudioFx(el: HTMLMediaElement, fx: Clip['audioFx']): void {
    const ctx = this.audioCtx
    const chain = this.chains.get(el)
    if (!ctx || !this.analyser || !chain || !chain.attached) return
    const wanted =
      !!fx &&
      (fx.highpass > 0 ||
        fx.lowpass > 0 ||
        fx.eqLow !== 0 ||
        fx.eqMid !== 0 ||
        fx.eqHigh !== 0 ||
        fx.comp.enabled ||
        !!fx.gate?.enabled)
    if (!wanted) {
      if (chain.fxOn) {
        // The level stays in the path either way: only what follows it moves.
        chain.gain.disconnect()
        chain.gain.connect(this.analyser)
        chain.nodes?.comp.disconnect()
        chain.fxOn = false
        this.openGate(chain)
      }
      return
    }
    if (!chain.nodes) {
      const meter = ctx.createAnalyser()
      meter.fftSize = 512
      const gate = ctx.createGain()
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      const low = ctx.createBiquadFilter()
      low.type = 'lowshelf'
      low.frequency.value = 200
      const mid = ctx.createBiquadFilter()
      mid.type = 'peaking'
      mid.frequency.value = 1000
      mid.Q.value = 0.9
      const high = ctx.createBiquadFilter()
      high.type = 'highshelf'
      high.frequency.value = 6000
      const comp = ctx.createDynamicsCompressor()
      comp.knee.value = 10
      comp.attack.value = 0.003
      comp.release.value = 0.25
      // Gate first, then the filters and the compressor — the same order the
      // export applies them in.
      meter.connect(gate)
      gate.connect(hp)
      hp.connect(lp)
      lp.connect(low)
      low.connect(mid)
      mid.connect(high)
      high.connect(comp)
      chain.nodes = { meter, gate, hp, lp, low, mid, high, comp, buf: new Float32Array(512) as Float32Array<ArrayBuffer> }
    }
    const n = chain.nodes
    if (!chain.fxOn) {
      // The level comes first, where the element's own volume acted before
      // it; then the gate's meter, the filters and the compressor.
      chain.gain.disconnect()
      chain.gain.connect(n.meter)
      n.comp.connect(this.analyser)
      chain.fxOn = true
    }
    // Neutral values where an effect is off: a filter still in the path must
    // not colour anything.
    n.hp.frequency.value = fx!.highpass > 0 ? fx!.highpass : 10
    n.lp.frequency.value = fx!.lowpass > 0 ? fx!.lowpass : 21000
    n.low.gain.value = fx!.eqLow
    n.mid.gain.value = fx!.eqMid
    n.high.gain.value = fx!.eqHigh
    n.comp.threshold.value = fx!.comp.enabled ? fx!.comp.threshold : 0
    n.comp.ratio.value = fx!.comp.enabled ? fx!.comp.ratio : 1
    // Gate follower.
    const g = fx!.gate
    if (!g?.enabled) {
      if (chain.gateGain !== 1) {
        chain.gateGain = 1
        n.gate.gain.setTargetAtTime(1, ctx.currentTime, 0.01)
      }
      return
    }
    n.meter.getFloatTimeDomainData(n.buf)
    let peak = 0
    for (let i = 0; i < n.buf.length; i++) {
      const v = Math.abs(n.buf[i])
      if (v > peak) peak = v
    }
    const thresh = 10 ** (g.threshold / 20)
    if (peak >= thresh) {
      chain.hold = 6 // ticks, ~100 ms
      chain.gateGain = 1
    } else if (chain.hold > 0) {
      chain.hold--
    } else {
      chain.gateGain = 0
    }
    n.gate.gain.setTargetAtTime(
      chain.gateGain,
      ctx.currentTime,
      chain.gateGain === 1 ? 0.004 : Math.max(0.01, g.release / 1000 / 3)
    )
  }

  start(): void {
    if (this.raf || this.interval) return
    this.lastNow = performance.now()
    const loop = (now: number) => {
      // (A frame's time is when the frame began; after a long frame this
      // runs well after it. The hand-over needs to know by how much.)
      this.safeTick(now, Math.max(0, performance.now() - now))
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
    // Safety tick: rAF is throttled to zero when the window is hidden or
    // occluded; this keeps the transport and audio sync alive regardless.
    this.interval = window.setInterval(() => {
      const now = performance.now()
      if (now - this.lastTickAt > 200) this.safeTick(now)
      this.watch(now)
    }, 250)
  }

  /**
   * Playing, yet nothing moving: the playhead standing still (past the
   * priming wait) or the preview not being drawn for a few seconds. Said once,
   * with what it is waiting for, so a stuck playback is never a mystery.
   */
  private watch(now: number): void {
    const st = useStore.getState()
    if (!st.playing) {
      this.playingSince = 0
      this.saidStuck = false
      return
    }
    if (!this.playingSince) this.playingSince = now
    if (now - this.playingSince < 3000 || this.saidStuck) return
    // Wrapping back again and again: say where, and how to stop it.
    this.wraps = this.wraps.filter((w) => now - w < 4000)
    if (this.wraps.length >= 3) {
      this.saidStuck = true
      const seg = st.project.shortSegments?.find((s) => s.id === st.activeShortSegmentId)
      const where = st.loopRange ? `the loop region ${st.loopRange[0].toFixed(1)}–${st.loopRange[1].toFixed(1)} s (Ctrl+L stops it)` : seg ? `the Shorts part ${seg.start.toFixed(1)}–${seg.end.toFixed(1)} s (click it on the timeline to let go)` : 'a loop'
      reportPreviewError('playback', new Error(`it keeps going round ${where}`))
      return
    }
    if (this.primingUntil === 0 && now - this.lastTimeChangeAt > 2500) {
      this.saidStuck = true
      reportPreviewError('playback', new Error(`the playhead has not moved for ${((now - this.lastTimeChangeAt) / 1000).toFixed(1)} s`))
    }
    if (!this.saidStuck && now - this.lastDrawnAt > 2500) {
      this.saidStuck = true
      const waiting = [...this.videos.entries()].filter(([, el]) => !el.paused && (el.readyState < 3 || el.seeking)).map(([id]) => st.project.clips[id]).filter(Boolean)
      const names = waiting.map((c) => st.project.assets.find((a) => a.id === c!.assetId)?.name ?? c!.id).slice(0, 3)
      reportPreviewError('playback', new Error(`the preview has not been drawn for ${((now - this.lastDrawnAt) / 1000).toFixed(1)} s${names.length ? ` (waiting for ${names.join(', ')})` : ''}`))
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    clearInterval(this.interval)
    this.raf = 0
    this.interval = 0
    for (const el of this.videos.values()) el.pause()
    for (const el of this.audios.values()) el.pause()
  }

  /**
   * Suspends the realtime metering AudioContext. An OfflineAudioContext
   * render (used by export + transcription) shares the browser's single audio
   * rendering thread; with the realtime context running it could starve and
   * `startRendering()` would never resolve. Call around audio extraction.
   */
  async suspendAudio(): Promise<void> {
    this.audioSuspended = true
    if (this.audioCtx && this.audioCtx.state === 'running') {
      try {
        await this.audioCtx.suspend()
      } catch {
        /* ignore */
      }
    }
  }

  resumeAudio(): void {
    this.audioSuspended = false
    if (this.audioCtx && this.audioCtx.state === 'suspended') void this.audioCtx.resume()
  }

  private safeTick(now: number, late = 0): void {
    this.lastTickAt = now
    try {
      this.tick(now, late)
    } catch (err) {
      // A draw/sync failure must never kill the loop — and it is said, once,
      // so a frozen preview is never a mystery.
      reportPreviewError('preview', err)
    }
  }

  private getImage(asset: Asset): HTMLImageElement {
    let img = this.images.get(asset.id)
    if (!img || img.dataset.src !== asset.url) {
      // A relinked or replaced picture: let the old one go.
      if (img) {
        img.onload = null
        img.removeAttribute('src')
      }
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.dataset.src = asset.url
      // A paused preview only redraws when something changes; an image that
      // finishes loading a moment after it was first asked for is a change.
      img.onload = bumpFramesVersion
      img.src = asset.url
      this.images.set(asset.id, img)
    }
    return img
  }

  private getMediaEl(clip: Clip, asset: Asset): HTMLMediaElement {
    const pool = asset.kind === 'video' ? this.videos : this.audios
    // Proxies (which carry audio too) swap the playback URL when enabled.
    const url = playbackUrlFor(asset)
    let el = pool.get(clip.id) as HTMLMediaElement | undefined
    if (el && el.dataset.src !== url) {
      // A proxy switched on or off: the same element, pointed at the other
      // file. A new element would need a new audio source node, and those can
      // never be freed.
      el.pause()
      el.dataset.src = url
      el.src = url
      return el
    }
    if (!el) {
      el = (asset.kind === 'video' ? this.freeVideos.pop() : this.freeAudios.pop()) ?? this.makeEl(asset.kind === 'video')
      el.dataset.src = url
      el.src = url
      this.attach(el)
      pool.set(clip.id, el as never)
    }
    return el
  }

  private makeEl(video: boolean): HTMLMediaElement {
    const el = video ? document.createElement('video') : document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    if (el instanceof HTMLVideoElement) el.playsInline = true
    // A frame that a seek lands on while paused (a frozen or reversed clip, or
    // the fallback when the decoder can't give a frame) is a change the paused
    // preview has to redraw for.
    el.addEventListener('seeked', bumpFramesVersion)
    return el
  }

  /** `now`: the tick's own time (a frame's, ms); `late`: how long after it
   *  the tick really runs (ms). */
  private tick(now: number, late = 0): void {
    const began = performance.now()
    const dt = tickSeconds(now, this.lastNow)
    // (Never back: the hand-over sets it to the moment the elements were told
    // to play, which can be later than the next frame's own time.)
    if (now > this.lastNow) this.lastNow = now
    const state = useStore.getState()
    const { playing } = state
    // The candidate project when the preview shows one: its picture and its
    // sound play; the store's project is not touched (playback/candidate.ts).
    const project = shownProject(state.project)
    // Live ↔ candidate (or another candidate): a jump. The other project's
    // elements stop at once, the timeline sounds start again, and playback
    // primes as after a seek.
    const shownKey = project === state.project ? null : project
    const switched = this.shownKey !== undefined && shownKey !== this.shownKey
    this.shownKey = shownKey
    let time = state.currentTime

    // Entering playback: drop the decoder stills so the <video> elements take
    // over cleanly, and start the priming window. Leaving playback: start fresh
    // so the first paused frame is decoded at the exact stopped time.
    if (playing !== this.wasPlaying) {
      this.wasPlaying = playing
      // Build (and resume) the audio graph on Play rather than waiting for the
      // meter to ask for it: the effects hang off that graph, and they should
      // not depend on a widget being on screen.
      if (playing) this.getAnalyser()
      this.lastFallbackSeek.clear()
      if (playing) {
        const seg0 =
          project.mode === 'shorts' && state.activeShortSegmentId ? project.shortSegments?.find((s) => s.id === state.activeShortSegmentId) : undefined
        this.segLoop = seg0 && seg0.end - seg0.start >= 0.5 && time >= seg0.start - 0.05 && time < seg0.end - 0.05 ? seg0.id : null
        this.wraps = []
        // The decoder still is deliberately KEPT for now: it is the exact frame
        // under the playhead, so it holds the picture steady while the elements
        // seek. Clearing it here left the preview on a stale snapshot — or
        // nothing — for the whole wait. It's dropped the instant the elements
        // take over, below, because `resolve` prefers it over the live element.
        // Give them up to this long to be ready before rolling anyway: an
        // unreadable file must never wedge the transport.
        this.primingUntil = now + PRIME_TIMEOUT_MS
      } else {
        this.primingUntil = 0
        this.dropPausedFrames()
        resetClipFrames()
      }
    } else if (playing && this.primingUntil === 0 && playheadJumped(time, this.lastWritten)) {
      // The playhead was moved while rolling (Shift+arrow, Home, a marker,
      // "Go there"). That is a jump like a loop wrap, and is held the same
      // way: the clock waits while the elements seek there. Seeking them under
      // a running clock made a slow seek land behind, get sought again, and
      // chase — a frozen picture and skipping sound for seconds. The last good
      // frames are kept, so the wait shows a picture, not black.
      this.primingUntil = now + PRIME_TIMEOUT_MS
      this.lastFallbackSeek.clear()
    }
    if (switched) {
      this.timelineSfx.reset()
      if (playing) {
        this.primingUntil = now + PRIME_TIMEOUT_MS
        this.lastFallbackSeek.clear()
      }
    }
    const priming = this.primingUntil > 0
    // The clock is held while priming, so wherever the playhead is put then
    // is where it rolls from.
    if (priming) this.lastWritten = time

    // The preview's play speed (ONIZLEME-UYGULA-PLAN.md, K3): the clock and
    // every element run that much faster or slower; the export never reads it.
    const pace = playRate()
    if (playing && !priming) {
      const duration = projectDuration(project)
      // (The first rolling tick after a hold moves it nowhere: the elements
      // are told to play in this tick, from where they were parked.)
      time = time + clockStep(dt, pace, this.handOver)
      // Shorts mode with an active segment: loop inside it so the crop can be
      // adjusted while the stretch repeats.
      const seg =
        project.mode === 'shorts' && state.activeShortSegmentId && state.activeShortSegmentId === this.segLoop
          ? project.shortSegments?.find((s) => s.id === state.activeShortSegmentId)
          : undefined
      const loop = state.loopRange
      // A wrap is a jump, and the elements have to seek back for it — so hold
      // the clock again exactly as Play does. Without this the loop restarted
      // on a frozen picture and only caught up part-way through the cycle. It
      // costs nothing after the first lap, when the media is already buffered
      // there and readiness comes back on the very next tick.
      if (seg && time >= Math.min(seg.end, duration)) {
        time = seg.start
        this.primingUntil = now + PRIME_TIMEOUT_MS
        this.wraps.push(now)
      } else if (loop && time >= loop[1] && loop[1] - loop[0] >= 0.2) {
        // Loop region: wrap back instead of running on.
        time = loop[0]
        this.primingUntil = now + PRIME_TIMEOUT_MS
        this.wraps.push(now)
      } else if (duration > 0 && time >= duration) {
        time = duration
        state.setPlaying(false)
      } else if (duration <= 0 && time >= 600) {
        // Empty timeline: the playhead still runs, so pressing Play tells you
        // the program is alive rather than looking frozen. It stops at the same
        // bound the playhead can be dragged to.
        time = 600
        state.setPlaying(false)
      }
      state.setTime(time)
      // Read back: the store clamps.
      this.lastWritten = useStore.getState().currentTime
    }

    if (time !== this.prevTimeSeen) {
      this.prevTimeSeen = time
      this.lastTimeChangeAt = now
    }
    // Paused, and the playhead has stopped moving: the moment to get what
    // comes next ready, so Play starts at once. Not while dragging, which
    // would open a decoder for every clip passed over.
    const settledPaused = !playing && now - this.lastTimeChangeAt > 150
    // Code films ask for frames ahead while it rolls, exactly while it is still.
    codeFilms.setPlaying(playing && !priming)

    // The transitions' and templates' sounds, while the picture actually rolls.
    // Never at the cost of the picture: a sound that cannot be scheduled is
    // dropped, and the media sync and the redraw below still happen.
    try {
      // (At another play speed they are left out: they are scheduled on the
      // audio clock at 1x and would sound in the wrong place.)
      this.timelineSfx.tick(project, time, playing && !priming && pace === 1, this.audioCtx, this.analyser)
    } catch (err) {
      reportPreviewError('timeline sounds', err)
    }

    // Sync every media element that carries video or audio.
    const activeIds = new Set<string>()
    /** Cleared by any element that isn't ready to roll yet. */
    let allReady = true
    /** Largest gap this tick between a clip's audio and where the playhead says
     *  it should be — surfaced in the transport bar when it becomes audible. */
    let worstDrift = 0
    /** The code films needed now (under the playhead or inside the pre-roll). */
    const filmsNeeded: Asset[] = []
    for (const track of project.tracks) {
      // Compound clips are expanded so nested footage plays and stays in sync.
      for (const clip of flatClipsOfTrack(project, track)) {
        const asset = clip ? assetById(project, clip.assetId) : undefined
        if (!clip || !asset || asset.missing) continue
        if (asset.kind === 'code') {
          // A code film's page is started a little ahead (its boot takes
          // seconds); it has no element here, its sound is its linked clip.
          if (clip.disabled || track.kind !== 'video' || track.hidden) continue
          if (time >= clip.start - PREROLL_SEC - 5 && time < clip.start + clip.duration + 1 && !filmsNeeded.includes(asset)) filmsNeeded.push(asset)
          continue
        }
        if (asset.kind === 'image') {
          // Pictures are loaded ahead too. They used to start loading at the
          // first frame that drew them, so every new picture cut or transition
          // showed a few empty frames and then a decode hitch.
          if (clip.disabled || track.kind !== 'video' || track.hidden || !(playing || settledPaused)) continue
          // Cheap bounds first (a picture timeline holds hundreds of clips),
          // the exact transition window only for the few near the playhead.
          if (clip.start - time > PREROLL_SEC + 10 || time > clip.start + clip.duration + 10) continue
          const from = clip.start - incomingTransitionInfo(project, clip).pre
          const to = clip.start + clip.duration + outgoingTransitionWindow(project, clip).post
          if (time >= to || from - time >= PREROLL_SEC) continue
          const img = this.prefetchImage(asset)
          // Priming waits for it like it waits for footage (bounded the same way).
          if (priming && !img.complete) allReady = false
          continue
        }
        // Being trim-scrubbed: the decoder frame is authoritative, so don't
        // also seek the <video> element (a redundant, competing decode).
        if (this.scrubFrames.has(clip.id)) {
          const el = this.videos.get(clip.id)
          if (el && !el.paused) el.pause()
          continue
        }
        // Mix transitions extend the clip half a transition on each side.
        const end = clip.start + clip.duration
        // The transition window comes from the shared helper, so the element is
        // kept alive over exactly the span the renderer draws it in.
        // (A sound on a track of its own follows its picture's: decision 4.)
        const { out: outWin, in: inWin } = soundWindows(project, clip)
        const dOut = outWin.duration
        const dIn = inWin.duration
        // A disabled clip is inert: don't even keep a decoder running for it.
        const active = !clip.disabled && time >= clip.start - inWin.pre && time < end + outWin.post
        if (!active) {
          const el = (asset.kind === 'video' ? this.videos : this.audios).get(clip.id)
          if (el && !el.paused) el.pause()
          // Pre-roll what's coming up. A clip's <video> used to be created at the
          // very instant it went on screen, so every cut paid for a cold element:
          // load metadata, seek, then start. Behind a hard cut that hitch is
          // mostly hidden, but a transition dissolves the clip in WHILE it's
          // still spinning up, which is what made the incoming shot sit frozen.
          // Warming it a second ahead costs one paused element and removes the
          // stall completely. While paused it is done once the playhead
          // settles, so pressing Play just before a cut finds the next shot
          // already there.
          if (!clip.disabled && (playing || settledPaused)) {
            const until = clip.start - inWin.pre
            if (time < until && until - time < PREROLL_SEC) {
              const warm = this.getMediaEl(clip, asset)
              activeIds.add(clip.id)
              if (!warm.paused) warm.pause()
              // Park it where the clip will FIRST be needed, which with an
              // incoming transition is half a transition before its own start —
              // not at its in point. Warming to the in point meant the element
              // arrived 0.25 s past what the lead asks for, so the moment the
              // dissolve began the engine had to seek it BACKWARDS, and that
              // cold seek is the second clip sitting frozen through the
              // transition.
              const lead = inWin.pre * (clip.speed ?? 1)
              const at = Math.min(
                Math.max(0, clip.inPoint - lead),
                Math.max(0, asset.duration - 0.05)
              )
              if (Math.abs(warm.currentTime - at) > 0.05 && warm.readyState >= 1 && !warm.seeking) {
                warm.currentTime = at
              }
              // Priming waits for what comes next as well as for what is on
              // screen: Play pressed half a second before a dissolve used to
              // roll at once, and the incoming shot was still loading when the
              // dissolve began — missing, or frozen, for its first moments.
              if (priming && (warm.readyState < 2 || warm.seeking || Math.abs(warm.currentTime - at) > 0.08)) {
                allReady = false
              }
            }
          }
          continue
        }
        activeIds.add(clip.id)
        const el = this.getMediaEl(clip, asset)
        const media = clipMediaAt(project, clip, time)
        // Media seconds per timeline second (a compound's speed is in it).
        const rate = (Math.abs(media.rate) || (clip.speed ?? 1)) * pace
        const speed = Math.min(PLAYABLE_MAX, Math.max(PLAYABLE_MIN, rate))
        if (Math.abs(el.playbackRate - speed) > 0.01) el.playbackRate = speed
        // The pitch is kept at another speed unless the clip says it follows
        // (core polish B: "Keep pitch", the export's rule too), and never
        // through a speed ramp at a cut. Sound and picture elements alike.
        // (A speed curve is the clip's own clock: a ramp at its cut does not
        // bend it, the pitch is kept along it — core polish C.)
        const curve = hasCurve(clip)
        const keepPitch = keepsPitch(clip) && (curve || !(asset.kind === 'video' && (outWin.type === 'speed-ramp' || inWin.type === 'speed-ramp')))
        if (el.preservesPitch !== keepPitch) el.preservesPitch = keepPitch
        // Freeze holds one frame; reversed steps backwards via seeks (the
        // preview approximates — the export is frame-exact).
        const still = clip.freeze !== undefined || clip.reversed
        const localRaw = media.time
        const local = Math.min(Math.max(0, localRaw), Math.max(0, asset.duration - 0.05))
        if (still) {
          if (!el.paused) el.pause()
          el.volume = 0
          el.muted = true
          if (Math.abs(el.currentTime - local) > 0.08 && el.readyState >= 1 && !el.seeking) {
            el.currentTime = local
          }
          continue
        }
        // Faster (or slower) than a media element plays at all — above 16x,
        // under a sixteenth: the element stays parked and silent (sound is
        // off beyond 8x anyway) and the picture is stepped through, each
        // draw showing the decoder's exact frame for its moment and skipping
        // the ones between, so playback runs on without waiting for them.
        if (!elementPlayable(rate)) {
          if (!el.paused) el.pause()
          this.setLevel(el, 0)
          if (asset.kind === 'video') {
            const frame = requestClipFrame(clip.id, asset, local)
            if (frame) this.pausedFrames.set(clip.id, frame)
            // (None yet: the element's last picture, or the frame before,
            // stays up until the decoder has it.)
            this.steppedIds.add(clip.id)
          }
          continue
        }
        // Back in the range an element plays: its decoder still must not
        // stay in front of it.
        if (this.steppedIds.delete(clip.id) && playing) this.pausedFrames.delete(clip.id)
        // Audio crossfade under the visual dissolve, by the rule the export mix
        // follows too (transitionGain): the outgoing clip holds full until the
        // cut and fades over the part after it while the incoming one rises
        // over the same span, so the two always add up to full — the old
        // fade-out started half a transition early and left a -6 dB hole at
        // the cut. The incoming clip is silent before its own start: in the
        // lead it plays footage from before its in point, which was trimmed
        // off and which the export never plays.
        let fade = transitionGain(time, clip.start, end, inWin, outWin)
        const rampFade = Math.min(0.14, 5.5 / Math.max(12, project.settings.fps))
        if (outWin.type === 'speed-ramp' && dOut > 0) {
          fade *= Math.min(1, Math.max(0, (end - time) / rampFade))
        }
        if (inWin.type === 'speed-ramp' && dIn > 0) {
          fade *= Math.min(1, Math.max(0, (time - clip.start) / rampFade))
        }
        const envelope = volumeAt(clip, time - clip.start)
        // 0–2, as the export's gain curve: volume, keyframes and fades allow a
        // boost up to 200 %. Slower than 0.25x or faster than 8x a clip is
        // silent, here and in the export (timeline/speed.ts).
        const volume =
          !trackAudible(project, track) || clip.audioExtracted || clip.disabled || (!curve && !speedAudible(clip.speed ?? 1))
            ? 0
            : Math.max(0, Math.min(2, envelope * fade * (curve ? audibleGain(rate) : 1)))
        this.setLevel(el, volume)
        // Effects follow the same values the export mix uses.
        this.applyAudioFx(el, clip.audioFx)
        // Incoming lead of a transition: the clip is ALREADY on screen, dissolving
        // in under the outgoing shot, so it has to be running. It used to be
        // parked on a still for the whole lead and only started at its own start
        // — which is exactly the "next clip freezes for a second or two" during
        // every transition. A dissolve is supposed to play both sides.
        //
        // The one case with nothing to play is a clip trimmed hard to the head of
        // its media (in point 0): there is no earlier footage to show, so it does
        // hold its first frame — but only until its own start, and the element is
        // already primed there, so it picks up without a stall.
        if (time < clip.start && localRaw < 0) {
          if (!el.paused) el.pause()
          if (Math.abs(el.currentTime - local) > 0.05 && el.readyState >= 1 && !el.seeking) {
            el.currentTime = local
          }
          continue
        }
        if (playing && priming) {
          // Priming holds the CLOCK still, so the element must be held still
          // too. Letting it run while the clock waits meant it drifted past the
          // target, got yanked back, and played the same moment again — you
          // heard the audio stutter and repeat at every Play.
          //
          // So: parked and seeked to the exact target, and only counted as
          // ready when it is buffered, settled, AND actually there. A seek can
          // land short of where it was asked (the element rounds to what it can
          // decode from), and starting the clock against media sitting
          // elsewhere is what made the sound stop matching the subtitles after
          // clicking around. Playing from the top has no seek, so it always
          // sounded right.
          if (!el.paused) el.pause()
          if (!el.seeking && el.readyState >= 1 && Math.abs(el.currentTime - local) > 0.05) {
            el.currentTime = local
          }
          if (el.readyState < 3 || el.seeking || Math.abs(el.currentTime - local) > 0.08) {
            allReady = false
          }
        } else if (playing) {
          // Measure how far the media has drifted from the playhead. This is
          // reported in the transport bar when it gets big enough to hear,
          // because "the sound doesn't match the picture" is otherwise
          // impossible to tell from "the file itself is odd".
          if (volume > 0 && el.readyState >= 2 && !el.seeking) {
            worstDrift = Math.max(worstDrift, Math.abs(el.currentTime - local))
          }
          if (el.paused) {
            // Pre-rolled while paused? Then don't seek again — that redundant
            // seek is what made Play stall for about a second. Never touch
            // currentTime mid-seek either: assigning it restarts the seek from
            // scratch, which is how a single Play could pay for two cold seeks.
            if (!el.seeking && Math.abs(el.currentTime - local) > 0.05) el.currentTime = local
            void el.play().catch(() => {})
          } else if (Math.abs(el.currentTime - local) > 0.3) {
            // Re-seeking mid-playback restarts the decoder and audibly clicks.
            // A single long frame can momentarily push the drift over the line,
            // so the tolerance is generous AND a cooldown stops a chain of
            // corrections turning into a seek storm. Small drift is inaudible;
            // repeated seeking is not.
            const lastSeek = this.lastFallbackSeek.get(clip.id) ?? 0
            if (now - lastSeek > 700) {
              this.lastFallbackSeek.set(clip.id, now)
              el.currentTime = local
            }
          }
        } else {
          if (!el.paused) el.pause()
          // Paused / scrubbing: do NOT seek the element. One `currentTime`
          // write per tick on long-GOP 4K is a seek storm that freezes the
          // UI. Pull the exact frame from the decoder instead.
          const frame = requestClipFrame(clip.id, asset, local)
          // No frame (the decoder failed here): the element shows it instead,
          // so a decoder still from somewhere else must not stay in front.
          if (frame) this.pausedFrames.set(clip.id, frame)
          else this.pausedFrames.delete(clip.id)
          // Once the playhead has been still for a moment, quietly bring the
          // element up to the right position. That keeps scrubbing seek-free
          // while making the next Play start instantly instead of stalling a
          // second on a cold seek. Also covers the case where the decoder
          // couldn't produce a frame at all.
          // The wait only has to outlast a DRAG (where the playhead keeps
          // moving and this timer keeps resetting). Once it settles, seeking
          // straight away means the element is usually already in position by
          // the time Space is pressed — the gap between clicking somewhere and
          // reaching for the keyboard is exactly the head start we want.
          const settled = now - this.lastTimeChangeAt > 90
          if (
            (settled || !frame) &&
            Math.abs(el.currentTime - local) > 0.05 &&
            el.readyState >= 1 &&
            !el.seeking &&
            now - (this.lastFallbackSeek.get(clip.id) ?? 0) > 150
          ) {
            this.lastFallbackSeek.set(clip.id, now)
            el.currentTime = local
          }
        }
      }
    }
    // Code films: those needed now get their pages (at most the limit; one
    // needed now is never let go for another: media/codefilm.ts need).
    codeFilms.need(filmsNeeded)

    // A stepped clip the playhead has left: its decoder frame goes (while
    // paused the sweep below does it).
    for (const id of [...this.steppedIds]) {
      if (activeIds.has(id)) continue
      this.steppedIds.delete(id)
      if (playing) this.pausedFrames.delete(id)
    }

    // Publish the drift a few times a second, rounded, so the readout doesn't
    // re-render the transport on every frame.
    if (playing && now - this.lastDriftAt > 250) {
      this.lastDriftAt = now
      const rounded = Math.round(worstDrift * 100) / 100
      if (rounded !== state.audioDrift) state.setAudioDrift(rounded)
    } else if (!playing && state.audioDrift !== 0) {
      state.setAudioDrift(0)
    }

    // Switched: whatever the other project was playing stops now (its clips
    // are not visited above), instead of running on until pruned.
    if (switched) {
      for (const pool of [this.videos, this.audios] as const) {
        for (const [id, el] of pool) if (!activeIds.has(id) && !el.paused) el.pause()
      }
    }

    // Priming is over once every element can roll — or once the deadline
    // passes, so a file that never becomes ready can't freeze the transport.
    // Handing over means dropping the decoder stills: `resolve` prefers them,
    // so leaving them in place would freeze playback on the first frame.
    if (priming && (allReady || now >= this.primingUntil)) {
      this.primingUntil = 0
      this.handOver = playing
      this.dropPausedFrames()
      resetClipFrames()
    } else if (this.handOver && !priming) {
      // The hand-over tick: the elements were told to play in it, so the
      // clock counts from the moment it ends, not from the frame's own time.
      // After a long frame the two are far apart, and the clock used to count
      // time no element had played: the sound stayed that far behind the
      // playhead. (The tick's time, how late it began, how long it took: its
      // end on the ticks' own clock.)
      this.handOver = false
      if (playing) this.lastNow = Math.max(this.lastNow, now + late + (performance.now() - began))
    }

    // Forget decoder stills for clips that scrolled out of view.
    if (!playing) {
      releaseClipFrames(activeIds)
      for (const id of [...this.pausedFrames.keys()]) {
        if (!activeIds.has(id)) this.pausedFrames.delete(id)
      }
    }

    for (const id of activeIds) this.lastActiveAt.set(id, now)

    // Periodically release media elements: ones whose clip is gone, and ones
    // that haven't been on screen for a while. Each live <video> holds a
    // hardware decoder, and Chromium stalls once too many are open — on a long
    // timeline these used to accumulate for the whole session.
    if (++this.pruneCounter % 120 === 0) {
      // Every clip the timeline holds, compound children included (at every
      // depth the engine plays them): a child's element is keyed by its own
      // id, which is only ever inside its compound, never in project.clips.
      // Live and candidate both: switching between them must not throw away
      // the other's decoders and pictures.
      const other = candidate.get().project
      const alive = aliveClipIds(project)
      if (other) for (const id of aliveClipIds(project === other ? state.project : other)) alive.add(id)
      for (const pool of [this.videos, this.audios] as const) {
        for (const [clipId, el] of pool) {
          // Never what this very tick is playing or warming.
          if (activeIds.has(clipId)) continue
          const idle = now - (this.lastActiveAt.get(clipId) ?? now) > 5000
          if (!alive.has(clipId) || idle) {
            pool.delete(clipId)
            this.releaseEl(el)
            this.lastFrames.delete(clipId)
            this.lastFrameAt.delete(clipId)
            this.lastActiveAt.delete(clipId)
            this.lastFallbackSeek.delete(clipId)
          }
        }
      }
      // Free scratch canvases of clips that no longer exist (compound children
      // included), so effect/mask buffers don't accumulate over a session.
      pruneClipScratch(alive)
      // Pictures and decoders of media that is no longer in the project (a
      // deleted asset, or the project closed for another): nothing else lets
      // them go. Undo brings an asset back, and it simply loads again.
      const assetIds = new Set(project.assets.map((a) => a.id))
      if (other) for (const a of (project === other ? state.project : other).assets) assetIds.add(a.id)
      for (const [id, img] of this.images) {
        if (assetIds.has(id)) continue
        img.onload = null
        img.removeAttribute('src')
        this.images.delete(id)
      }
      pruneScrubSinks(assetIds)
      // Code films' pages, and the frames held for clips that are gone.
      codeFilms.release(assetIds)
      codeFilms.releaseClips(alive)
    }

    // Cap preview redraws. During playback the project fps is everything the
    // export will ever contain, so rendering faster than that on a 120/144 Hz
    // display is pure waste — and it makes preview cadence match export
    // exactly. While paused we allow 60 Hz so dragging stays responsive.
    const targetFps = playing ? Math.max(10, project.settings.fps || 30) : 60
    // Due on the film's own beat, not one step after whenever the last draw
    // happened: counted from "now", a 144 Hz screen (a tick every 6.9 ms) let
    // only every third tick through, 48 draws a second for a 60 fps film, a
    // frame held now once, now twice (judder; 2026-11-07). A draw may come up
    // to half a 144 Hz tick early; one far behind starts the beat again.
    const step = 1000 / targetFps
    if (now >= this.lastDrawAt + step - 3.5) {
      this.lastDrawAt = now - this.lastDrawAt > step * 2 ? now : this.lastDrawAt + step
      this.onDraw?.(this.resolve)
      this.lastDrawnAt = now
    }
  }
}

export const engine = new PreviewEngine()

/** What went wrong in the preview, said once per kind of failure (the app
 *  shows it as a toast) and logged. */
const reported = new Set<string>()
export function reportPreviewError(where: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`${where} failed:`, err)
  // The watchdog says each stall itself (once per playback); errors once ever.
  const key = where === 'playback' ? `${where}:${Date.now()}` : `${where}:${msg}`
  if (reported.has(key)) return
  reported.add(key)
  try {
    window.dispatchEvent(new CustomEvent('snipp-preview-error', { detail: `${where}: ${msg}` }))
  } catch {
    /* no window */
  }
}
