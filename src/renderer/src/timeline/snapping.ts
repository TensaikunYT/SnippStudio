// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { isSubtitle, TIMELINE_HEADER_W, type Project } from '../types'
import { EPS } from './eps'

export type DragSnapKind = 'image' | 'video' | 'audio' | 'subtitle' | 'text' | 'marker' | 'segment' | 'playhead' | 'start'

export interface DragSnapTarget {
  time: number
  kind: DragSnapKind
  /** In English (the interface shows timeline/snap-name.ts's words). */
  label: string
  /** Which end of the clip, caption or segment it is (phase 9 audit patch D6). */
  edge?: 'start' | 'end'
  trackName?: string
  clipId?: string
  captionId?: string
  trackId?: string
}

export interface DragSnapResult {
  /** Clip start after snapping either its left or right edge. */
  start: number
  movingEdge: 'start' | 'end'
  target: DragSnapTarget
}

/**
 * Image/video edges win over nearby subtitle cuts while a clip is dragged on
 * the video timeline. Distances are measured in screen pixels, not seconds:
 * the same gesture therefore feels consistent at every zoom level.
 */
export function findDragSnap(
  project: Project,
  desiredStart: number,
  duration: number,
  pxPerSec: number,
  targetTrackId: string,
  excludedClipIds: ReadonlySet<string>,
  playhead: number,
  thresholdPx = 8
): DragSnapResult | null {
  if (!(pxPerSec > 0) || !(duration > 0)) return null
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const candidates: { target: DragSnapTarget; priority: number }[] = []
  const add = (time: number, kind: DragSnapKind, label: string, priority: number, extra: Partial<DragSnapTarget> = {}): void => {
    if (Number.isFinite(time) && time >= 0) candidates.push({ target: { time, kind, label, ...extra }, priority })
  }
  for (const track of project.tracks) {
    for (const id of track.clipIds) {
      const clip = project.clips[id]
      if (!clip || excludedClipIds.has(id)) continue
      const asset = assets.get(clip.assetId)
      const kind: DragSnapKind = track.kind === 'audio' ? 'audio' : asset?.kind === 'image' || clip.automationMissing ? 'image' : 'video'
      const priority = track.id === targetTrackId ? 0 : track.kind === 'video' ? 1 : 3
      const name = kind === 'image' ? 'Image' : kind === 'audio' ? 'Audio' : 'Video'
      const extra = { clipId: id, trackId: track.id, trackName: track.name }
      add(clip.start, kind, `${name} · ${track.name} start`, priority, { ...extra, edge: 'start' })
      add(clip.start + clip.duration, kind, `${name} · ${track.name} end`, priority, { ...extra, edge: 'end' })
    }
  }
  for (const caption of project.captions) {
    const subtitle = isSubtitle(caption)
    const kind: DragSnapKind = subtitle ? 'subtitle' : 'text'
    const name = subtitle ? 'Subtitle' : 'Text'
    const extra = { captionId: caption.id }
    add(caption.start, kind, `${name} start`, subtitle ? 2 : 4, { ...extra, edge: 'start' })
    add(caption.end, kind, `${name} end`, subtitle ? 2 : 4, { ...extra, edge: 'end' })
  }
  for (const marker of project.markers ?? []) add(marker.time, 'marker', 'Marker', 5)
  for (const segment of project.shortSegments ?? []) {
    add(segment.start, 'segment', 'Segment start', 5, { edge: 'start' })
    add(segment.end, 'segment', 'Segment end', 5, { edge: 'end' })
  }
  add(playhead, 'playhead', 'Playhead', 6)
  add(0, 'start', 'Timeline start', 7)

  let best: (DragSnapResult & { priority: number; distancePx: number }) | null = null
  for (const { target, priority } of candidates) {
    for (const [movingEdge, offset] of [['start', 0], ['end', duration]] as const) {
      const distancePx = Math.abs(target.time - desiredStart - offset) * pxPerSec
      if (distancePx > thresholdPx + EPS) continue
      const start = target.time - offset
      if (start < -EPS) continue
      if (!best || priority < best.priority ||
        (priority === best.priority && distancePx < best.distancePx - EPS)) {
        best = { start: Math.max(0, start), movingEdge, target, priority, distancePx }
      }
    }
  }
  return best && { start: best.start, movingEdge: best.movingEdge, target: best.target }
}

/**
 * Where a drop lands in time: the pointer's x in the scroll area (x from its
 * left edge, `scrollLeft` its scroll), snapped to clip edges, captions,
 * markers and the playhead within 8 px, as a clip's move snaps (Shift:
 * exactly where it is). `duration`: the first clip's length, so its end can
 * snap too (0: its start only).
 */
export function dropTimeAt(
  project: Project,
  x: number,
  scrollLeft: number,
  pxPerSec: number,
  trackId: string | null,
  playhead: number,
  duration: number,
  shift: boolean
): { time: number; snap: DragSnapTarget | null } {
  const raw = Math.max(0, (x + scrollLeft - TIMELINE_HEADER_W) / pxPerSec)
  if (shift || !(pxPerSec > 0)) return { time: raw, snap: null }
  const snap = findDragSnap(project, raw, duration > 0 ? duration : EPS, pxPerSec, trackId ?? '', new Set(), playhead)
  return snap ? { time: snap.start, snap: snap.target } : { time: raw, snap: null }
}

/**
 * What a press on a clip does to the selection: at once, and on release when
 * it turned out to be a click. Ctrl/Shift on a clip already selected is a
 * click (let go of it on release) or a drag of the selection that keeps it:
 * Shift is also a trim's and a move's "no snapping". (Alt on a move copies
 * the selection; that path selects for itself.)
 */
export function clipPressSelection(o: { selected: boolean; additive: boolean; copying: boolean; kind: 'move' | 'trim-l' | 'trim-r' | 'slip' }): {
  now: 'select' | 'add' | 'keep'
  onClick: 'toggle-off' | 'none'
} {
  if (o.copying) return { now: 'keep', onClick: 'none' }
  if (o.additive && o.selected) return { now: 'keep', onClick: o.kind === 'move' ? 'toggle-off' : 'none' }
  return { now: o.additive ? 'add' : 'select', onClick: 'none' }
}

/**
 * How far (px; − left, + right) a clip drag scrolls the timeline this step:
 * in the 60 px margin at either edge of the visible rows (the left one right
 * of the header column), faster the deeper in, and only toward the edge the
 * pointer has moved to since the press (`moved`: its x now minus at the
 * press). A clip grabbed just right of the header and dragged right used to
 * scroll the view LEFT while the pointer crossed that margin: the clip went
 * the wrong way, or fell behind the pointer.
 */
export function edgeScrollStep(left: number, right: number, clientX: number, moved: number): number {
  const zone = 60
  const maxStep = 28
  if (clientX > right - zone && moved > 0) return maxStep * Math.min(1, (clientX - (right - zone)) / zone)
  const inner = left + TIMELINE_HEADER_W + zone
  if (clientX < inner && moved < 0) return -maxStep * Math.min(1, (inner - clientX) / zone)
  return 0
}
