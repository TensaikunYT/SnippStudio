// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Trusted code film folders (security patch, item 6; S1, B-G7).
//
// A code film is a web page of a folder, run inside the editor. Until this
// patch a project file could name ANY local folder holding an index.html and
// the app ran it on open, unasked: a project from somewhere else could point
// at a folder of the user's own (their Downloads, with a page a browser
// saved there) and have that page run with every file of that folder in
// reach. `--code-film=<folder>` from another program did the same.
//
// Now a folder runs unasked only when
//   - it lies strictly inside the open project's own folder (the project and
//     what it brought with it are one thing; a film there reads only its
//     own subfolder), or
//   - the user brought it in by their own hand on this computer (the folder
//     dialog, a drop, the "Code film" button, a template, the agent's
//     code_clip create), or once said "run the code in this folder": those
//     are kept in the profile, in trusted-folders.json.
// Every other folder waits: the clip stays empty and the user is asked once.
//
// Folders are compared as the disk resolves them (links followed): a junction
// inside the project folder that leads elsewhere is "elsewhere".
//
// No Electron here (tested in Node).
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isInside, isLocalFilePath, pathKey } from './platform-path'

export const TRUSTED_FILE = 'trusted-folders.json'
/** More than anyone brings in; past it the oldest go. */
export const TRUSTED_MAX = 2000

/** A folder as the disk resolves it, or null (it is not there). */
export function realFolder(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

/** The list as read from a file's text: local folder paths, one per folder, bounded. */
export function cleanTrusted(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { folders?: unknown })?.folders) ? (raw as { folders: unknown[] }).folders : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of list) {
    if (!isLocalFilePath(x)) continue
    const key = pathKey(x)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(path.normalize(x))
  }
  return out.slice(-TRUSTED_MAX)
}

/** The profile's list of trusted folders. Read once, written whole (a
 *  temporary file, then a rename) at every change. */
export class TrustedFolders {
  private list: string[] | null = null

  constructor(private readonly profileDir: () => string) {}

  private file(): string {
    return path.join(this.profileDir(), TRUSTED_FILE)
  }

  private load(): string[] {
    if (this.list) return this.list
    try {
      this.list = cleanTrusted(JSON.parse(readFileSync(this.file(), 'utf8')))
    } catch {
      this.list = []
    }
    return this.list
  }

  /** The folders, oldest first (a copy). */
  all(): string[] {
    return [...this.load()]
  }

  /** Is this folder (as the disk resolves it) one of the trusted ones, or inside one? */
  has(folder: string): boolean {
    const real = realFolder(folder)
    if (!real) return false
    return this.load().some((t) => isInside(t, real))
  }

  /** Trusts the folder (as the disk resolves it). False when it is not there
   *  or the list could not be written (then it is trusted for this run only). */
  add(folder: string): boolean {
    const real = realFolder(folder)
    if (!real || !isLocalFilePath(real)) return false
    const list = this.load()
    if (list.some((t) => isInside(t, real))) return true
    list.push(real)
    if (list.length > TRUSTED_MAX) list.splice(0, list.length - TRUSTED_MAX)
    try {
      mkdirSync(this.profileDir(), { recursive: true })
      const tmp = this.file() + '.tmp'
      writeFileSync(tmp, JSON.stringify({ folders: list }, null, 1) + '\n', 'utf8')
      renameSync(tmp, this.file())
      return true
    } catch {
      return false
    }
  }
}

/** A project folder so wide that "inside it" says nothing: a drive's root or
 *  the user's home folder itself. */
function tooWide(realDir: string, home: string | null): boolean {
  if (path.parse(realDir).root === realDir || path.dirname(realDir) === realDir) return true
  return !!home && pathKey(home) === pathKey(realDir)
}

/**
 * May this code film folder run without asking? 'project': it lies strictly
 * inside the folder of the project file (not that folder itself: a project
 * file dropped into a folder must not make the whole folder its film, and
 * not when that folder is a drive's root or the home folder); 'list': the
 * user trusted it; null: ask first.
 */
export function filmTrust(folder: string, projectFile: string | null, trusted: Pick<TrustedFolders, 'has'>, home: string | null = os.homedir()): 'project' | 'list' | null {
  const real = realFolder(folder)
  if (!real) return null
  if (projectFile) {
    const dir = realFolder(path.dirname(projectFile))
    const realHome = home ? realFolder(home) ?? home : null
    if (dir && !tooWide(dir, realHome) && pathKey(dir) !== pathKey(real) && isInside(dir, real)) return 'project'
  }
  return trusted.has(folder) ? 'list' : null
}
