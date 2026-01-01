// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { useT } from '../ui'
import type { Clip, Project } from '../types'
import { assetById, flatClipsOfTrack } from '../types'
import { getStripImage, STRIP_CELL } from './Filmstrip'

/**
 * A few frames sampled across a marked range, so a segment list shows WHAT each
 * segment is rather than just when it is. Reuses the filmstrips generated at
 * import — no decoding happens here, it only picks cells out of an image that
 * already exists, which is why it costs nothing to show one per segment.
 */

/**
 * Video lanes, top first, already flattened. Built ONCE per draw: flattening
 * compound clips allocates, and doing it per sampled cell meant hundreds of
 * throwaway arrays every time the project changed — which is every frame of a
 * clip drag.
 */
function videoLanes(project: Project): Clip[][] {
  return project.tracks
    .filter((track) => track.kind === 'video' && !track.hidden)
    .map((track) => flatClipsOfTrack(project, track))
}

/** Topmost visible video clip at a timeline time, with its media time. */
function sampleAt(
  project: Project,
  lanes: Clip[][],
  t: number
): { assetId: string; mediaTime: number } | null {
  // Lanes are ordered top-first, so the first hit is what the viewer sees.
  for (const lane of lanes) {
    for (const clip of lane) {
      if (clip.disabled) continue
      if (t < clip.start || t >= clip.start + clip.duration) continue
      const asset = assetById(project, clip.assetId)
      if (!asset || asset.missing || !asset.filmstrip) continue
      const speed = clip.speed ?? 1
      const local = clip.reversed
        ? clip.inPoint + Math.max(0, clip.duration * speed - (t - clip.start) * speed)
        : clip.inPoint + (t - clip.start) * speed
      return { assetId: asset.id, mediaTime: local }
    }
  }
  return null
}

function SegmentStripInner({
  start,
  end,
  cells = 6,
  height = 26
}: {
  start: number
  end: number
  cells?: number
  height?: number
}): JSX.Element | null {
  const project = useStore((s) => s.project)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Strips are decoded asynchronously; a tick re-runs the draw once they land.
  const [, setTick] = useState(0)

  const cellW = Math.round((height * STRIP_CELL.w) / STRIP_CELL.h)
  const width = cellW * cells

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const bw = Math.max(1, Math.round(width * dpr))
    const bh = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const span = Math.max(0.001, end - start)
    const lanes = videoLanes(project)
    for (let i = 0; i < cells; i++) {
      // Sample the MIDDLE of each cell's slice: the very first and last frame of
      // a range are often a transition, which reads as a black or duplicated box.
      const t = start + (span * (i + 0.5)) / cells
      const hit = sampleAt(project, lanes, t)
      if (!hit) continue
      const asset = assetById(project, hit.assetId)
      if (!asset?.filmstrip) continue
      const img = getStripImage(asset.id, asset.filmstrip, () => setTick((v) => v + 1))
      if (!img) continue
      const cols = asset.filmstripCols ?? 6
      const idx = Math.max(
        0,
        Math.min(cols - 1, Math.floor((hit.mediaTime / Math.max(0.001, asset.duration)) * cols))
      )
      ctx.drawImage(
        img,
        idx * STRIP_CELL.w,
        0,
        STRIP_CELL.w,
        STRIP_CELL.h,
        i * cellW,
        0,
        cellW,
        height
      )
    }
  }, [project, start, end, cells, height, width, cellW])
  const t = useT()

  return (
    <canvas
      ref={canvasRef}
      className="seg-strip"
      style={{ width, height }}
      title={t('preview.seg.span', { start: start.toFixed(1), end: end.toFixed(1) })}
    />
  )
}

export const SegmentStrip = memo(SegmentStripInner)
