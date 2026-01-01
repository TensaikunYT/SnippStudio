// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where media dragged over the timeline would land: the time under the
// pointer, snapped as a clip's move snaps, the row under it, a "+" strip.
// One reading of the pointer for the drop indicator while dragging, the
// media bin's drop and a file dropped from the file manager.

import { useStore } from '../state/store'
import type { Project } from '../types'
import { planMediaDrop, type MediaDropItem, type MediaDropPlan } from './placement'
import { dropTimeAt, type DragSnapTarget } from './snapping'

export interface TimelineDropPoint {
  /** The first clip's start: the pointer's time, snapped unless Shift. */
  time: number
  /** The track row under the pointer, if any. */
  trackId: string | null
  /** The "+" strip under the pointer, if any. */
  newTrack: 'video' | 'audio' | null
  snap: DragSnapTarget | null
}

/** The timeline's reading of a drag at (clientX, clientY); null off it. */
export function timelineDropAt(clientX: number, clientY: number, shift: boolean, duration: number): TimelineDropPoint | null {
  const scroller = document.querySelector<HTMLElement>('.tl-scroll')
  if (!scroller) return null
  const rect = scroller.getBoundingClientRect()
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null
  const stack = document.elementsFromPoint(clientX, clientY)
  const row = stack.find((el) => el instanceof HTMLElement && el.classList.contains('tl-track')) as HTMLElement | undefined
  const strip = stack.find((el) => el instanceof HTMLElement && el.classList.contains('tl-addtrack')) as HTMLElement | undefined
  const kind = strip?.dataset.newTrackKind
  const s = useStore.getState()
  const trackId = row?.dataset.trackId ?? null
  const { time, snap } = dropTimeAt(s.project, clientX - rect.left, scroller.scrollLeft, s.pxPerSec, trackId, s.currentTime, duration, shift)
  return { time, trackId, newTrack: kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : null, snap }
}

/** The media items for assets of the project (an image is 4 s). */
export function dropItemsOf(project: Project, assetIds: readonly string[]): MediaDropItem[] {
  const out: MediaDropItem[] = []
  for (const id of assetIds) {
    const asset = project.assets.find((a) => a.id === id)
    if (!asset || asset.missing) continue
    out.push({ assetId: id, kind: asset.kind === 'audio' ? 'audio' : 'video', duration: asset.kind === 'image' ? 4 : asset.duration })
  }
  return out
}

/** Where dropping these assets at this point would put them. */
export function planDropAt(project: Project, assetIds: readonly string[], at: TimelineDropPoint): MediaDropPlan | null {
  return planMediaDrop(project, dropItemsOf(project, assetIds), at.time, at.trackId, at.newTrack)
}

// An HTML5 drag's data can't be read until the drop, so the media bin says
// here what it is dragging, for the indicator while it is over the timeline.
let dragged: string[] | null = null
export const setDraggedAssets = (ids: string[] | null): void => {
  dragged = ids
}
export const draggedAssets = (): string[] | null => dragged
