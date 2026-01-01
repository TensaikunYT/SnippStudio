// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Finding a project's media files on disk (SnippStudio phase Ç2a.2,
// decisions 2 and 3). No Electron: the tests run it. media.ts
// resolveProjectMedia and the save handlers use it.
import { promises as fs } from 'node:fs'

import { currentPlatform, foldKey, isLocalFilePath, pathApi } from './platform-path'

/** A media file as it is on disk now: where, its size and its last-modified
 *  time (ms, rounded) — with the size, the file's fingerprint. */
export interface MediaFound {
  path: string
  size: number
  mtime: number
  /** How it was found: at its own path, by the path relative to the project
   *  file (`relPath`), or by its file name beside the project (Ç2a patch). */
  via: 'path' | 'rel' | 'name'
}

export type StatFn = (p: string) => Promise<{ isFile(): boolean; size: number; mtimeMs: number } | null>
const realStat: StatFn = (p) => fs.stat(p).catch(() => null)

export interface LocateOptions {
  stat?: StatFn
  /** Only paths this accepts are looked at (main: media extensions). */
  accept?: (p: string) => boolean
}

async function fileAt(p: string, o: LocateOptions, via: MediaFound['via']): Promise<MediaFound | null> {
  if (!isLocalFilePath(p) || (o.accept && !o.accept(p))) return null
  const st = await (o.stat ?? realStat)(p)
  return st?.isFile() ? { path: p, size: st.size, mtime: Math.round(st.mtimeMs), via } : null
}

/** The size an asset was saved with, when it has one (an import or relink
 *  stores it; a project from before may not). */
export const storedSize = (size: unknown): number | null => (typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null)

/**
 * Whether a file found away from the asset's own path may stand for it
 * (Ç2a patch, item 1): an unrelated file of the same name beside the project
 * must never replace a missing one silently. The stored size must match (the
 * modified time need not: a zip or a FAT drive changes it). With no stored
 * size, only a match by `relPath` (a project folder moved whole) is taken.
 */
export function mayStandFor(storedSizeOf: unknown, found: { size: number; via: MediaFound['via'] }): boolean {
  if (found.via === 'path') return true
  const size = storedSize(storedSizeOf)
  return size !== null ? found.size === size : found.via === 'rel'
}

/**
 * Where an asset's file is now. Its absolute path first; then, when the
 * project file is known, the path relative to the project's folder written
 * with the last save (`relPath`), `<project folder>\media\<name>` and
 * `<project folder>\<name>` — a project folder moved or copied whole (to
 * another drive, another PC) finds its media again (report P9, D6). `<name>`
 * is the file name of the stored path. Null: none of them is a file.
 */
export async function locateMedia(asset: { path?: unknown; relPath?: unknown; size?: unknown }, projectFile: string | null, o: LocateOptions = {}): Promise<MediaFound | null> {
  const abs = isLocalFilePath(asset.path) ? pathApi().normalize(asset.path) : null
  if (abs) {
    const here = await fileAt(abs, o, 'path')
    if (here) return here
  }
  if (!isLocalFilePath(projectFile)) return null
  const dir = pathApi().dirname(pathApi().normalize(projectFile))
  const tries: [string, MediaFound['via']][] = []
  const rel = typeof asset.relPath === 'string' && asset.relPath && asset.relPath.length <= 4096 && !pathApi().isAbsolute(asset.relPath) ? asset.relPath : null
  if (rel) tries.push([pathApi().join(dir, rel), 'rel'])
  const base = abs ? pathApi().basename(abs) : rel ? pathApi().basename(rel) : ''
  if (base) tries.push([pathApi().join(dir, 'media', base), 'name'], [pathApi().join(dir, base), 'name'])
  for (const [p, via] of tries) {
    const found = await fileAt(p, o, via)
    // One the stored size does not confirm is passed over (Ç2a patch, item 1).
    if (found && mayStandFor(asset.size, found)) return found
  }
  return null
}

/** `file` relative to the folder of `projectFile`, with / between parts;
 *  null when there is none (another drive). */
export function relativeMediaPath(file: string, projectFile: string): string | null {
  if (!isLocalFilePath(file) || !isLocalFilePath(projectFile)) return null
  const from = pathApi().dirname(pathApi().normalize(projectFile))
  const to = pathApi().normalize(file)
  // (Windows: another drive has no relative path.)
  if (currentPlatform() === 'win32' && foldKey(from.slice(0, 2)) !== foldKey(to.slice(0, 2))) return null
  const rel = pathApi().relative(from, to)
  return rel && !pathApi().isAbsolute(rel) ? rel.split('\\').join('/') : null
}

/**
 * A project file's text as it is written to `target`: every asset with an
 * absolute path gets the same file relative to the project's folder
 * (`relPath`, decision 3), or loses one that no longer holds (another drive).
 * Text that is not a project is written as it is.
 */
export function withRelativePaths(json: string, target: string): string {
  let project: unknown
  try {
    project = JSON.parse(json)
  } catch {
    return json
  }
  const assets = (project as { assets?: unknown })?.assets
  if (!Array.isArray(assets)) return json
  // (The project's LUT files too: "cila" part D.)
  const luts = (project as { luts?: unknown })?.luts
  for (const a of [...assets, ...(Array.isArray(luts) ? luts : [])]) {
    if (!a || typeof a !== 'object') continue
    const asset = a as { path?: unknown; relPath?: unknown; kind?: unknown }
    const rel = typeof asset.path === 'string' ? relativeMediaPath(asset.path, target) : null
    if (rel) asset.relPath = rel
    else delete asset.relPath
  }
  return JSON.stringify(project, null, 2)
}

/**
 * "Found one, look for the rest in the same folder" (decision 3): which of
 * `names` (file names only) are files in `folder`.
 */
export async function findInFolder(folder: string, names: readonly unknown[], o: LocateOptions = {}): Promise<Record<string, MediaFound>> {
  const out: Record<string, MediaFound> = {}
  if (!isLocalFilePath(folder)) return out
  for (const n of names.slice(0, 2000)) {
    if (typeof n !== 'string' || !n || n !== pathApi().basename(n) || n === '.' || n === '..') continue
    const found = await fileAt(pathApi().join(folder, n), o, 'name')
    if (found) out[n] = found
  }
  return out
}
