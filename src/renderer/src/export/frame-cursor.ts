// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's forward cursor over one clip's footage, and the rules it
// picks frames by. Kept apart from exporter.ts, with no DOM, canvas or
// decoder of its own (the sink is handed in), so a test can drive it with a
// stand-in decoder.

import type { WrappedCanvas } from 'mediabunny'
import { cancellable } from './cancel'

/** What of a clip the cursor reads (a Clip is one). */
export interface CursorClip {
  inPoint: number
  duration: number
  speed?: number
  transitionOut?: { duration: number }
}

/**
 * The slack frame times are compared with (seconds). An export frame's media
 * time is `inPoint + (rangeStart + i / fps - start) * speed`, and that sum
 * often comes out a few ulps UNDER the frame it lands on exactly (k / fps,
 * which is what the decoder gives as that frame's timestamp). Compared bare,
 * frame k - 1 was shown again and the next frame skipped: a scattered
 * stutter in every trimmed clip of frame-aligned footage, which the preview
 * does not have. A microsecond is far below any frame's length and far above
 * the float error, even at hour-long times; a frame that starts a microsecond
 * after the asked time is as right as one that starts on it.
 */
export const FRAME_EPS = 1e-6

/** Whether a frame starting at `frameStart` is the one to show at `at` (both
 *  in the decoder's time). */
export function frameDue(frameStart: number, at: number): boolean {
  return frameStart <= at + FRAME_EPS
}

/**
 * The media time (seconds, before the track's offset) a clip's cursor
 * decodes up to: the clip's end, its outgoing transition's tail, half a
 * second to spare. The tail is timeline time, so it runs at the clip's speed
 * as the rest does (clipMediaAt: inPoint + local * speed): unscaled, a clip
 * sped up past about 1.5x ran out of frames halfway through its outgoing
 * slide or wipe and froze there in the export while the preview kept
 * playing. The transition's whole duration is never less than its tail
 * after the cut (its window's `post`), so this covers every alignment.
 */
export function cursorEnd(clip: CursorClip, assetDuration: number): number {
  const speed = Math.max(0.01, clip.speed ?? 1)
  const tail = clip.transitionOut?.duration ?? 0
  return Math.min(assetDuration, clip.inPoint + (clip.duration + tail) * speed + 0.5)
}

/** What the cursor reads frames from: a CanvasSink (each `canvases` call has
 *  its own decoder). */
export interface FrameSource {
  canvases(startTimestamp: number, endTimestamp: number): AsyncGenerator<WrappedCanvas, void, unknown>
}

/**
 * Frame-accurate cursor over one clip's video frames. Output frames advance
 * monotonically, so a sequential async iterator per clip lets mediabunny
 * decode each packet exactly once.
 *
 * Its sink must be its own: a CanvasSink hands its frames out on a small pool
 * of canvases that belongs to the SINK, so two cursors on one sink paint
 * over each other's frames (frameDrawer gives every clip its own).
 */
export class ClipFrameCursor {
  private iter: AsyncGenerator<WrappedCanvas, void, unknown> | null = null
  current: WrappedCanvas | null = null
  private next: WrappedCanvas | null = null
  private done = false

  constructor(
    private readonly sink: FrameSource,
    private readonly clip: CursorClip,
    private readonly assetDuration: number,
    /** Where this track's timestamps sit relative to presentation time zero.
     *  Clip times are in ELEMENT time; the decoder speaks its own. Zero for a
     *  file with no offset, which is nearly all of them. */
    private readonly offset = 0
  ) {}

  async seekTo(localTime: number, signal?: AbortSignal): Promise<void> {
    if (!this.iter) {
      // Start at the first frame actually requested, including an incoming
      // dissolve's lead. Ranged renders can seek straight to a late clip
      // instead of decoding all the earlier footage. CanvasSink yields the
      // frame containing `from` before advancing to the following frames.
      const from = Math.max(0, Math.min(localTime, this.assetDuration)) + this.offset + FRAME_EPS
      const to = cursorEnd(this.clip, this.assetDuration) + this.offset
      this.iter = this.sink.canvases(from, to)
      const first = await cancellable(this.iter.next(), signal, () => this.close())
      this.current = first.done ? null : first.value
      if (!first.done) {
        const second = await cancellable(this.iter.next(), signal, () => this.close())
        this.next = second.done ? null : second.value
        this.done = !!second.done
      } else {
        this.done = true
      }
    }
    while (!this.done && this.next && frameDue(this.next.timestamp, localTime + this.offset)) {
      this.current = this.next
      const n = await cancellable(this.iter!.next(), signal, () => this.close())
      this.next = n.done ? null : n.value
      if (n.done) this.done = true
    }
  }

  close(): void {
    if (this.iter) {
      void this.iter.return().catch(() => {})
      this.iter = null
    }
  }
}

/** How long (timeline seconds) a clip may be off screen before its decoder
 *  is let go. A clip that drops out of the list for a frame or two keeps its
 *  place; one that comes back later gets
 *  a new cursor, seeked to where it is then. */
export const CURSOR_GRACE = 0.5

/**
 * The clips whose decoders an export can let go at time `t`: those last
 * drawn more than `grace` seconds before it (`lastSeen`: each clip's last
 * drawn time; the ones returned are forgotten there). An export only moves
 * forward, so a finished cut's decoder (and its frames, and its canvases)
 * was only holding memory: a long edit of hundreds of cuts from one
 * recording held hundreds of open decoders until the export ended.
 */
export function staleClips(lastSeen: Map<string, number>, t: number, grace = CURSOR_GRACE): string[] {
  const out: string[] = []
  for (const [id, seen] of lastSeen) if (t - seen > grace) out.push(id)
  for (const id of out) lastSeen.delete(id)
  return out
}

/**
 * A reversed clip's frames (phase Ç3a, decision 7; report R7). Each output
 * frame used to decode from the key frame before it on its own (a fresh
 * decoder per `getCanvas`): on 4K long-GOP footage a reversed clip exported
 * at a tenth of a forward one's speed. This decodes a stretch forward once,
 * keeps the last `keep` frames before the time asked (copies: the sink's own
 * canvases are a pool of two), and hands them out backwards; when the asked
 * time passes below the stretch, the stretch before it is decoded.
 */
export class ReverseCursor<T> {
  /** The kept frames, oldest first: their start times and copies. */
  private frames: { ts: number; copy: T }[] = []
  /** Times at or above this (and under the next kept frame's) are the last
   *  kept frame's; the stretch reaches up to `top` (what was asked). */
  private top = -Infinity
  /** Stretches decoded (for the measurements and the tests). */
  decodes = 0

  constructor(
    private readonly sink: FrameSource,
    /** How many frames a stretch keeps. */
    private readonly keep: number,
    /** A frame's length, a first guess (1 / the source's rate). */
    private readonly frameLength: number,
    /** Copies a decoded frame into kept slot `slot` (0 … keep − 1). */
    private readonly copy: (src: WrappedCanvas, slot: number) => T
  ) {}

  /** The frame showing at decoder time `at` (the last starting at or before
   *  it), or null before the file's first frame. */
  async frameAt(at: number, signal?: AbortSignal): Promise<T | null> {
    const hit = this.lookup(at)
    if (hit !== undefined) return hit
    await this.fill(at, signal)
    return this.lookup(at) ?? null
  }

  private lookup(at: number): T | null | undefined {
    if (!this.frames.length || at > this.top + FRAME_EPS || !frameDue(this.frames[0].ts, at)) return undefined
    for (let i = this.frames.length - 1; i >= 0; i--) if (frameDue(this.frames[i].ts, at)) return this.frames[i].copy
    return undefined
  }

  /** Decodes the stretch that ends at `at`, keeping its last `keep` frames. */
  private async fill(at: number, signal?: AbortSignal): Promise<void> {
    this.decodes++
    const from = Math.max(0, at - this.keep * this.frameLength)
    const ring: { ts: number; slot: number }[] = []
    const kept = new Map<number, T>()
    let slot = 0
    // (The first frame yielded is the one showing at `from`; the last, the
    // one showing at `at`.)
    const iter = this.sink.canvases(from, at + FRAME_EPS * 2)
    try {
      for (;;) {
        const n = await cancellable(iter.next(), signal, () => void iter.return().catch(() => {}))
        if (n.done) break
        if (!frameDue(n.value.timestamp, at)) break
        if (ring.length === this.keep) slot = ring.shift()!.slot
        else slot = ring.length
        kept.set(slot, this.copy(n.value, slot))
        ring.push({ ts: n.value.timestamp, slot })
      }
    } finally {
      void iter.return().catch(() => {})
    }
    this.frames = ring.map((r) => ({ ts: r.ts, copy: kept.get(r.slot)! }))
    this.top = at
  }
}
