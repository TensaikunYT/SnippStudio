// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The heavy parts, made ahead: where the preview has the most to draw — the
// scene templates, the big transitions — over still pictures only (a video's frames must come from its
// decoder as it plays), frames are rendered while you are not playing or
// editing, kept small (JPEG), and shown during playback instead of being
// drawn live. Any edit lets them go; they are made again once you stop.

import type { Project } from '../types'
import { assetById } from '../types'
import { renderFrame, renderList, type SourceResolver } from './render'
import { heavyRanges, MAX_SECONDS, MAX_W } from './heavy'

/** How many times a frame is made again because a picture it shows had not
 *  loaded yet (a file that never loads must not keep it busy for ever). */
const MAX_RETRIES = 3


/** Is anything moving (a video) on screen at t? Then it is drawn live. */
function videoAt(p: Project, t: number): boolean {
  for (const e of renderList(p, t)) {
    const a = e.clip.nested ? null : assetById(p, e.clip.assetId)
    if (e.clip.nested || a?.kind === 'video' || a?.kind === 'code') return true
  }
  return false
}

interface Store {
  project: Project | null
  fps: number
  /** Frame index → the frame, small. */
  made: Map<number, Blob>
  /** What is still to make. */
  todo: number[]
  /** Decoded for playback, near the playhead. */
  ready: Map<number, ImageBitmap>
  pending: Set<number>
  total: number
  /** Frame index → how often it was put back for a picture still loading. */
  retries: Map<number, number>
}

const S: Store = { project: null, fps: 30, made: new Map(), todo: [], ready: new Map(), pending: new Set(), total: 0, retries: new Map() }

function reset(p: Project): void {
  S.project = p
  S.retries.clear()
  S.fps = Math.max(12, p.settings.fps || 30)
  S.made.clear()
  for (const b of S.ready.values()) b.close()
  S.ready.clear()
  S.pending.clear()
  let budget = MAX_SECONDS * S.fps
  S.todo = []
  for (const [a, b] of heavyRanges(p)) {
    for (let f = Math.floor(a * S.fps); f <= Math.ceil(b * S.fps) && budget > 0; f++, budget--) S.todo.push(f)
  }
  S.total = S.todo.length
}

let canvas: OffscreenCanvas | null = null

/**
 * Some of the work, for about `ms` milliseconds: the next frames to make.
 * Returns whether any work is left.
 */
export async function prerenderSome(p: Project, resolve: SourceResolver, ms = 14): Promise<boolean> {
  if (S.project !== p) reset(p)
  const { width, height } = p.settings
  const q = Math.min(1, MAX_W / width)
  const w = Math.max(2, Math.round(width * q))
  const h = Math.max(2, Math.round(height * q))
  if (!canvas || canvas.width !== w || canvas.height !== h) canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d')!
  const until = performance.now() + ms
  while (S.todo.length && performance.now() < until) {
    const f = S.todo.shift()!
    const t = f / S.fps
    if (videoAt(p, t)) continue
    // A picture the frame shows that has not loaded yet comes back as
    // nothing; drawn so and kept, the transition then played with that
    // layer missing (or black) every time, since nothing made it again.
    let missed = false
    const r: SourceResolver = (clip, asset, time) => {
      const src = resolve(clip, asset, time)
      if (!src && asset.kind === 'image' && !asset.missing) missed = true
      return src
    }
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, w, h)
    renderFrame(g, p, t, r, { scale: q })
    if (S.project !== p) return true
    // A picture was missing: made again a little later (the picture loads
    // meanwhile), a few times at most.
    if (missed) {
      const n = (S.retries.get(f) ?? 0) + 1
      S.retries.set(f, n)
      if (n <= MAX_RETRIES) {
        S.todo.push(f)
        return true
      }
      // Still missing after that (a file that cannot be read): drawn live.
      continue
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 })
    // An edit while it was being made: let it go.
    if (S.project !== p) return true
    S.made.set(f, blob)
  }
  return S.todo.length > 0
}

/**
 * During playback: the frame for t, if it has been made and decoded —
 * and the next few decoded behind the scenes. Null: draw it live.
 */
export function prerenderedFrame(p: Project, t: number): ImageBitmap | null {
  if (S.project !== p || !S.made.size) return null
  const f = Math.round(t * S.fps)
  // Decode a little ahead; let go of what is behind.
  for (let k = f; k < f + 10; k++) {
    if (S.ready.has(k) || S.pending.has(k)) continue
    const blob = S.made.get(k)
    if (!blob) continue
    S.pending.add(k)
    void createImageBitmap(blob)
      .then((bmp) => {
        S.pending.delete(k)
        if (S.project !== p) bmp.close()
        else S.ready.set(k, bmp)
      })
      .catch(() => S.pending.delete(k))
  }
  for (const [k, bmp] of S.ready) {
    if (k < f - 2 || k > f + 30) {
      bmp.close()
      S.ready.delete(k)
    }
  }
  return S.ready.get(f) ?? null
}

/** How far along it is, for the preview's note. */
export function prerenderProgress(p: Project): { made: number; total: number } {
  if (S.project !== p) return { made: 0, total: 0 }
  return { made: S.made.size, total: S.total }
}
