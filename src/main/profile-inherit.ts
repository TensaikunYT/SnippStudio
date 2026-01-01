// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The first start of a new profile folder (SnippStudio phase 9a, decision 3).
//
// The app's profile folder is named after the product (shared/product.ts), so
// a renamed app starts with an empty one. When that folder is new and an older
// app's folder is there (product.json `inheritFrom`: "Snipp Dev", "Snipp"),
// the user's own setup is COPIED over, once:
//   - recents.json       the Projects list (its folders to watch included)
//   - Local Storage/     the interface preferences and the keyboard shortcuts
//                        (the page keeps them in localStorage)
// Nothing else: the agent's secret token (agent.json), the restore points, the
// backups, caches and models stay where they are. The older folder is only
// read, never written (not even a marker): the marker goes into the new one.
//
// No Electron here: the paths and the file system are plain Node, so the unit
// test (src/test/profile-inherit.test.ts) runs it on throw-away folders.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { foldKey } from './platform-path'

/** What is copied, file or folder, relative to the profile. */
export const INHERITED_ITEMS = ['recents.json', 'Local Storage'] as const
/** Written into the NEW profile once it was looked at: it is never asked again. */
export const MARKER = 'inherited.json'
/** Chromium's lock file in a storage folder (a live one belongs to a running app). */
const SKIP = new Set(['LOCK'])

export interface InheritResult {
  /** The older profile folder's name (e.g. "Snipp Dev"). */
  from: string
  /** The items copied (INHERITED_ITEMS that were there). */
  copied: string[]
}

/** A profile folder that holds none of the user's setup yet and was never
 *  looked at: no marker, no recents, no Local Storage. */
export function profileIsNew(dir: string): boolean {
  return !existsSync(path.join(dir, MARKER)) && INHERITED_ITEMS.every((i) => !existsSync(path.join(dir, i)))
}

/** The newest time any inherited item of a profile was changed (0: none there). */
function lastUsed(dir: string): number {
  let t = 0
  for (const i of INHERITED_ITEMS) {
    try {
      const s = statSync(path.join(dir, i))
      t = Math.max(t, s.mtimeMs)
    } catch {
      /* not there */
    }
  }
  return t
}

/** The older profile to copy from: of the named folders beside the new one,
 *  the one used last (the first named on a tie), or null when none is there. */
export function pickSource(appData: string, names: readonly string[], target: string): string | null {
  let best: string | null = null
  let bestT = 0
  for (const n of names) {
    const dir = path.join(appData, n)
    // (Case folded on Windows as before; macOS and Linux compare as they store: phase 10b.7.)
    if (foldKey(path.resolve(dir)) === foldKey(path.resolve(target))) continue
    const t = lastUsed(dir)
    if (t > bestT) {
      best = n
      bestT = t
    }
  }
  return best
}

function copyItem(from: string, to: string): void {
  const s = statSync(from)
  if (s.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const e of readdirSync(from)) {
      if (SKIP.has(e)) continue
      copyItem(path.join(from, e), path.join(to, e))
    }
  } else if (s.isFile()) {
    copyFileSync(from, to)
  }
}

/**
 * Copies the older app's setup into a new profile folder, once. Returns what
 * was copied, or null when nothing was (the folder is not new, or there is no
 * older folder). A copy that fails halfway leaves what was copied (each item
 * is the user's own, readable by itself) and still writes the marker: the
 * first start never runs twice.
 */
export function inheritProfile(target: string, appData: string, names: readonly string[]): InheritResult | null {
  if (!profileIsNew(target)) return null
  const source = pickSource(appData, names, target)
  mkdirSync(target, { recursive: true })
  const copied: string[] = []
  if (source) {
    for (const item of INHERITED_ITEMS) {
      const from = path.join(appData, source, item)
      if (!existsSync(from)) continue
      try {
        copyItem(from, path.join(target, item))
        copied.push(item)
      } catch {
        /* the rest still comes; the marker below keeps this from running again */
      }
    }
  }
  try {
    writeFileSync(path.join(target, MARKER), JSON.stringify({ from: source, copied, at: new Date().toISOString() }) + '\n', { flag: 'wx' })
  } catch {
    /* another start wrote it meanwhile */
  }
  return source && copied.length ? { from: source, copied } : null
}
