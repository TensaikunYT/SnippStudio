// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { RecentEntry } from '../../../preload/index'
import { api } from '../platform'
import type { Project } from '../types'
import { projectDuration } from '../types'

const DB_NAME = 'autocut-model-cache' // must match whisper.worker.ts

export async function loadRecents(): Promise<RecentEntry[]> {
  if (!api) return []
  try {
    const list = await api.recentsRead()
    return Array.isArray(list) ? list.sort((a, b) => b.lastOpened - a.lastOpened) : []
  } catch {
    return []
  }
}

/**
 * Records (or refreshes) a project in the recents index. Called after a save or
 * open, with the freshly-captured playhead thumbnail when there is one.
 *
 * Only this one entry goes over: the main process merges it into the list as
 * it is on disk (recents-store.ts). Sending the whole list from here let two
 * windows write over each other, and a list read back empty for a moment
 * replaced everything with this one project.
 */
export async function upsertRecent(project: Project, filePath: string, thumbnail?: string): Promise<void> {
  if (!api || !filePath) return
  try {
    await api.recentsUpsert({
      path: filePath,
      name: project.name || 'Untitled',
      thumbnail,
      durationSec: projectDuration(project),
      width: project.settings.width,
      height: project.settings.height,
      sizeBytes: project.assets.reduce((s, a) => s + (a.size || 0), 0)
    })
  } catch {
    /* best-effort: the list is a convenience, the save itself happened */
  }
}

export async function removeRecent(filePath: string): Promise<void> {
  try {
    await api?.recentsRemove(filePath)
  } catch {
    /* best-effort */
  }
}

/** Renames a project: rewrites the name inside the file, renames the file on
 *  disk; the main process moves its list entry with it. Returns the new path
 *  (or null on failure) so the caller can re-point the open project. */
export async function renameRecent(filePath: string, newName: string): Promise<string | null> {
  const name = newName.trim()
  if (!api || !name) return null
  const res = await api.renameProject(filePath, name)
  if (!res.ok) return null
  return res.path ?? filePath
}

/** The folder a project sits in, for telling apart the many "Untitled"s. */
export function folderOf(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

/**
 * Grabs the current preview frame as a small JPEG data-URL for the thumbnail.
 * Reads the on-screen preview canvas directly (what the user sees at the
 * playhead). Best-effort: returns undefined if the canvas is blank or tainted.
 */
export function capturePlayheadThumbnail(): string | undefined {
  try {
    // Target the VIDEO canvas specifically: '.preview canvas' would match the
    // volume-meter canvas (it comes first in the DOM), giving a blank thumbnail.
    const src = document.querySelector('.preview-canvas-wrap canvas') as HTMLCanvasElement | null
    if (!src || src.width === 0 || src.height === 0) return undefined
    const w = 320
    const h = Math.max(2, Math.round((w * src.height) / src.width))
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')!.drawImage(src, 0, 0, w, h)
    return out.toDataURL('image/jpeg', 0.6)
  } catch {
    return undefined
  }
}

export interface CacheInfo {
  bytes: number
}

export async function getCacheSize(): Promise<number> {
  if (!api) return 0
  try {
    const { bytes } = await api.cacheSize()
    return bytes
  } catch {
    return 0
  }
}

/** Clears the reclaimable cache: redundant model copies (main) + the IndexedDB
 *  model store (here — same origin as the worker that created it). */
export async function clearCache(): Promise<number> {
  let freed = 0
  if (api) {
    try {
      freed += (await api.cacheClear()).freed
    } catch {
      /* ignore */
    }
  }
  await new Promise<void>((resolve) => {
    try {
      const del = indexedDB.deleteDatabase(DB_NAME)
      del.onsuccess = del.onerror = del.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
  return freed
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
