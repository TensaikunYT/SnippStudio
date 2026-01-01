// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useViewport } from '../playback/viewport'
import { useStore } from '../state/store'
import { heldBox, heldNeed } from '../timeline/view-math'
import { hasCurve } from '../timeline/speed-curve'
import { mediaAtLocal } from '../timeline/media-time'
import { drawingHeight, useLaneHeight, useTimelineView } from './timeline/view-state'
import type { Asset, Clip } from '../types'
import { TIMELINE_HEADER_W as HEADER_W } from '../types'

/** Source cell size written by computeFilmstrip. */
const CELL_W = 96
const CELL_H = 54

/**
 * Decoded strip images, ONE per asset. Keyed by asset id rather than by the
 * data URL: the strip is republished several times while it is still being
 * generated, and a URL-keyed cache would keep every superseded version alive.
 */
const images = new Map<string, { src: string; img: HTMLImageElement }>()
/**
 * Cap on retained strips (~1 MB decoded each). Entries are only ever dropped
 * when their asset is deleted, so opening several projects in one session kept
 * every strip from every project alive — nothing else evicts them.
 */
const MAX_IMAGES = 32
/** Everyone waiting on an image that is still decoding. Without this, only the
 *  FIRST clip to ask got an onload callback — any other clip sharing the asset
 *  was left with a blank strip until something unrelated re-rendered it. */
const waiters = new Map<string, Set<() => void>>()

/** Source cell geometry, shared with anything else that samples a strip. */
export const STRIP_CELL = { w: CELL_W, h: CELL_H }

export function getStripImage(
  assetId: string,
  src: string,
  onReady: () => void
): HTMLImageElement | null {
  return getImage(assetId, src, onReady)
}

function getImage(assetId: string, src: string, onReady: () => void): HTMLImageElement | null {
  const hit = images.get(assetId)
  if (hit && hit.src === src) {
    // Re-insert so the Map stays ordered least-recently-used first.
    images.delete(assetId)
    images.set(assetId, hit)
    return hit.img.complete ? hit.img : null
  }
  let set = waiters.get(assetId)
  if (!set) {
    set = new Set()
    waiters.set(assetId, set)
  }
  set.add(onReady)
  const img = new Image()
  const wake = (): void => {
    for (const fn of waiters.get(assetId) ?? []) fn()
    waiters.delete(assetId)
  }
  img.onload = wake
  // A failed decode has to wake the waiters too, or every clip on this asset
  // sits waiting for a callback that will never come.
  img.onerror = wake
  img.src = src
  // Replaces (and so releases) the previous, now-stale strip for this asset.
  images.delete(assetId)
  images.set(assetId, { src, img })
  while (images.size > MAX_IMAGES) {
    const oldest = images.keys().next().value
    if (oldest === undefined || oldest === assetId) break
    images.delete(oldest)
  }
  return null
}

/** Frees an asset's strip image (media removed or relinked). */
export function dropStripImage(assetId: string): void {
  images.delete(assetId)
  waiters.delete(assetId)
}

/**
 * Timeline thumbnails drawn per cell instead of as a stretched CSS background.
 *
 * The background-image approaches both failed in their own way: sized to its
 * natural width the strip ran out before the clip ended (bare blue tail), and
 * stretched to the asset's duration the frames were smeared horizontally.
 * Drawing each cell explicitly keeps every frame at its true aspect ratio AND
 * at its true time — the cell simply shows whichever source frame is nearest to
 * the moment under it, so zooming repeats frames rather than distorting them.
 */
function FilmstripInner({ clip, asset }: { clip: Clip; asset: Asset }): JSX.Element | null {
  const pxPerSec = useStore((s) => s.pxPerSec)
  // In steps of 256 px: the drawing reaches 600 px past the view on either
  // side, so a scroll draws it again every few frames, not on every one
  // (it used to follow the view in 32 px steps; phase 3c.T).
  const viewLeft = useViewport((s) => Math.floor(s.left / 256) * 256)
  const viewWidth = useViewport((s) => s.width)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The lane's height (its own, at the timeline's height step): the drawing
  // is made again when it changes (phase 3c.T).
  const laneH = useLaneHeight(clip.trackId)
  // While a zoom is under way the strip is stretched, not drawn again on
  // every step; it is drawn again when the zoom has settled.
  const zooming = useTimelineView((v) => v.zooming)
  const drawn = useRef<{ from: number; w: number; px: number } | null>(null)
  const [, setTick] = useState(0)
  const src = asset.filmstrip ?? ''
  const cols = asset.filmstripCols ?? 6

  // Kick off / await the strip image decode.
  useEffect(() => {
    if (!src) return
    if (!getImage(asset.id, src, () => setTick((t) => t + 1))) return
    setTick((t) => t + 1)
  }, [src, asset.id])

  const W = Math.max(8, clip.duration * pxPerSec)
  const clipLeftPx = HEADER_W + clip.start * pxPerSec
  const margin = 600
  const visFrom = Math.max(0, Math.min(W, viewLeft - clipLeftPx - margin))
  const visTo = Math.max(visFrom, Math.min(W, viewLeft + viewWidth - clipLeftPx + margin))
  const visW = Math.max(0, Math.round(visTo - visFrom))
  const held = heldBox(zooming, drawn.current, pxPerSec, heldNeed(visFrom, visTo))

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const entry = src ? images.get(asset.id) : undefined
    const img = entry && entry.src === src ? entry.img : undefined
    if (!canvas || !img || !img.complete || visW <= 0) return
    if (held) return
    drawn.current = { from: visFrom, w: visW, px: pxPerSec }
    const h = drawingHeight(canvas, laneH)
    if (h <= 0) return
    const dpr = window.devicePixelRatio || 1
    const bw = Math.max(1, Math.round(visW * dpr))
    const bh = Math.max(1, Math.round(h * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, visW, h)

    // Cells keep the source aspect ratio, so nothing is ever squashed.
    const cellW = Math.max(8, (h * CELL_W) / CELL_H)
    const D = Math.max(0.001, asset.duration)
    // A retimed clip covers `speed` seconds of media per timeline second.
    const spd = clip.speed ?? 1

    // The cell grid is anchored to MEDIA time, not to the clip's left edge.
    // Anchoring it to the clip meant that splitting one re-based the right
    // half's grid at the cut, so every thumbnail in it slid sideways and the
    // strip looked like a completely different piece of footage — you couldn't
    // see where the cut had landed. Pinned to the media, a cut changes nothing
    // about what is drawn: the two halves stay exactly as they looked, with the
    // join falling between them.
    const mediaPerCell = (cellW / pxPerSec) * spd
    const xOf = (mediaT: number): number => ((mediaT - clip.inPoint) / spd) * pxPerSec
    const mediaAt = (x: number): number => clip.inPoint + (x / pxPerSec) * spd
    // Along a speed curve (core polish T) the media does not run evenly under
    // the clip: the cells are laid evenly on the clip instead, each showing
    // the media the curve puts under its middle (timeline/media-time.ts).
    if (hasCurve(clip)) {
      const first = Math.floor(visFrom / cellW)
      const last = Math.ceil(visTo / cellW)
      for (let c = first; c < last; c++) {
        const x = c * cellW
        const t = mediaAtLocal(clip, (x + cellW / 2) / pxPerSec)
        const idx = Math.max(0, Math.min(cols - 1, Math.floor((t / D) * cols)))
        ctx.drawImage(img, idx * CELL_W, 0, CELL_W, CELL_H, x - visFrom, 0, cellW, h)
      }
      return
    }
    const firstCell = Math.floor(mediaAt(visFrom) / mediaPerCell)
    const lastCell = Math.ceil(mediaAt(visTo) / mediaPerCell)
    for (let c = firstCell; c < lastCell; c++) {
      const cellStart = c * mediaPerCell
      const x = xOf(cellStart)
      // Media time under the middle of this cell.
      const t = cellStart + mediaPerCell / 2
      const idx = Math.max(0, Math.min(cols - 1, Math.floor((t / D) * cols)))
      ctx.drawImage(img, idx * CELL_W, 0, CELL_W, CELL_H, x - visFrom, 0, cellW, h)
    }
  }, [src, asset.id, cols, visFrom, visTo, visW, pxPerSec, clip.inPoint, clip.speed, clip.speedCurve, clip.reversed, clip.duration, asset.duration, laneH, zooming])

  if (!src || visW <= 0) return null

  return (
    <canvas
      ref={canvasRef}
      className="thumb strip"
      style={{ position: 'absolute', left: held ? held.left : visFrom, width: held ? held.width : visW, top: 0, bottom: 0, height: '100%' }}
    />
  )
}

export const Filmstrip = memo(FilmstripInner)
