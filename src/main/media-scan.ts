// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * The media inside a folder (a folder dropped on the editor, "Add numbered
 * image folders"), bounded so that a folder near a drive root cannot turn into
 * a scan of the whole disk.
 *
 * Each folder's names are put in numbered order BEFORE the limit cuts.
 * Windows lists a folder as 1, 10, 100, 101 … 11, 110 …, and a cut in that
 * order left gaps all through a numbered still set (6–9, 60–99, most of the
 * 500s): the film had pictures missing everywhere and nothing said so. Now a
 * cut only ever drops the end of the set, and says it did.
 *
 * No Electron: the tests run it.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface MediaScanOptions {
  /** Lower-case extensions with the dot ('.png'). */
  extensions: Set<string>
  /** Files taken at most. */
  maxFiles: number
  /** Folder levels below the root that are looked into (default 4). */
  maxDepth?: number
  /** Folders and directory entries looked at, at most. */
  maxDirs?: number
  maxEntries?: number
}

export interface MediaScan {
  /** In numbered name order. */
  files: { path: string; name: string; size: number; mtime: number }[]
  /** Not everything was taken: more files than maxFiles, or folders left unread. */
  truncated: boolean
  /** Media files seen (taken or not). */
  total: number
}

export const byNumberedName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

export async function scanMediaTree(root: string, opts: MediaScanOptions): Promise<MediaScan> {
  const maxDepth = opts.maxDepth ?? 4
  const maxDirs = opts.maxDirs ?? 2000
  const maxEntries = opts.maxEntries ?? 100_000
  const files: MediaScan['files'] = []
  let total = 0
  let dirs = 0
  let entriesSeen = 0
  let truncated = false
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    if (dirs >= maxDirs || entriesSeen >= maxEntries) {
      truncated = true
      return
    }
    dirs++
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    entriesSeen += entries.length
    const names = entries
      .filter((e) => !e.isSymbolicLink() && !e.isDirectory() && opts.extensions.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort(byNumberedName)
    for (const name of names) {
      if (files.length >= opts.maxFiles) {
        total++
        truncated = true
        continue
      }
      const full = path.join(dir, name)
      const st = await fs.stat(full).catch(() => null)
      if (!st?.isFile()) continue
      total++
      files.push({ path: full, name, size: st.size, mtime: Math.round(st.mtimeMs) })
    }
    const subdirs = entries
      .filter((e) => !e.isSymbolicLink() && e.isDirectory())
      .map((e) => e.name)
      .sort(byNumberedName)
    for (const sub of subdirs) await walk(path.join(dir, sub), depth + 1)
  }
  await walk(root, 0)
  files.sort((a, b) => byNumberedName(a.name, b.name))
  return { files, truncated, total }
}
