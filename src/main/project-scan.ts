// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * "Find projects": walks the folders the user picked for Snipp project files
 * (.snipp, .autocut). Asynchronous all the way (one readdir at a time), so the
 * main process keeps answering while it runs, with progress and a stop.
 *
 * Skipped: folders whose name starts with "." or "$" (hidden ones by
 * convention, the recycle bin), node_modules, release, .git, and the system's
 * own folders (Windows, Program Files, ProgramData, AppData, System Volume
 * Information...); links and junctions are not followed (no loops, no second
 * walk of the same tree). It stops at a depth, a number of folders and a
 * number of finds, and says so.
 *
 * No Electron and no relative imports (the tests run it as it is).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { foldKey } from './platform-path'

export const PROJECT_FILE = /\.(snipp|autocut)$/i
/** Crash-recovery snapshots are not projects. */
const RECOVERY_FILE = /^recovery(?:-[\w-]*)?\.autocut$/i

export const SKIP_DIRS = new Set([
  'node_modules',
  'release',
  '.git',
  'appdata',
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  'recovery',
  'msocache',
  'config.msi',
  'perflogs'
])

export function skipDir(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('.') || n.startsWith('$') || n.startsWith('~') || SKIP_DIRS.has(n)
}

export interface ScanProgress {
  dirs: number
  found: number
  /** The folder being read. */
  current: string
}

export interface ScanOptions {
  maxDepth?: number
  maxDirs?: number
  maxFound?: number
  /** Set `aborted` to stop. */
  signal?: { aborted: boolean }
  onProgress?: (p: ScanProgress) => void
  /** ms between progress calls (the first and the last always come). */
  progressMs?: number
}

export interface ScanResult {
  found: string[]
  dirs: number
  /** A limit was reached: there may be more. */
  truncated: boolean
  cancelled: boolean
}

export const SCAN_LIMITS = { maxDepth: 12, maxDirs: 50_000, maxFound: 2_000 }

export async function scanForProjects(roots: string[], opts: ScanOptions = {}): Promise<ScanResult> {
  const maxDepth = opts.maxDepth ?? SCAN_LIMITS.maxDepth
  const maxDirs = opts.maxDirs ?? SCAN_LIMITS.maxDirs
  const maxFound = opts.maxFound ?? SCAN_LIMITS.maxFound
  const progressMs = opts.progressMs ?? 120
  const seen = new Set<string>()
  const foundKeys = new Set<string>()
  const found: string[] = []
  const queue: { dir: string; depth: number }[] = []
  for (const r of roots) {
    const dir = path.resolve(r)
    const k = foldKey(dir)
    if (seen.has(k)) continue
    seen.add(k)
    queue.push({ dir, depth: 0 })
  }
  let dirs = 0
  let truncated = false
  let lastTick = 0
  const tick = (current: string, force = false): void => {
    const now = Date.now()
    if (!opts.onProgress || (!force && now - lastTick < progressMs)) return
    lastTick = now
    opts.onProgress({ dirs, found: found.length, current })
  }
  // Breadth first: what is near the picked folder is found before the depths.
  for (let i = 0; i < queue.length; i++) {
    if (opts.signal?.aborted) return { found, dirs, truncated, cancelled: true }
    if (dirs >= maxDirs || found.length >= maxFound) {
      truncated = true
      break
    }
    const { dir, depth } = queue[i]
    dirs++
    tick(dir, dirs === 1)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) continue
    for (const d of entries) {
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) {
        if (depth + 1 > maxDepth) {
          truncated = true
          continue
        }
        if (skipDir(d.name)) continue
        const sub = path.join(dir, d.name)
        const k = foldKey(sub)
        if (seen.has(k)) continue
        seen.add(k)
        queue.push({ dir: sub, depth: depth + 1 })
      } else if (d.isFile() && PROJECT_FILE.test(d.name) && !RECOVERY_FILE.test(d.name)) {
        const file = path.join(dir, d.name)
        const k = foldKey(file)
        if (foundKeys.has(k)) continue
        foundKeys.add(k)
        found.push(file)
        if (found.length >= maxFound) break
      }
    }
    // The queue holds every folder still to read; let it go as it is read.
    if (i > 4096) {
      queue.splice(0, i + 1)
      i = -1
    }
  }
  if (opts.onProgress) opts.onProgress({ dirs, found: found.length, current: '' })
  return { found, dirs, truncated, cancelled: false }
}
