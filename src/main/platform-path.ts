// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The path layer (SnippStudio phase 10a, step 1; haritalar\cekirdek-platform.md
// P1–P6): what a local file path is, how two paths are compared, which path
// rules apply, and whether one path is inside another, for Windows, macOS and
// Linux. Every function takes the platform as a parameter (default: this
// computer's, or the one a test set with setPlatformForTests), so each branch
// is tested on Windows. The Windows branch is exactly the code it replaced
// (phase 10a, decision 1: Windows behaviour does not change).
//
// No Electron and no relative imports: the main process, its tests and the
// pure helpers all use it.
import path from 'node:path'

export type Platform = NodeJS.Platform

let override: Platform | null = null

/** The platform the path rules follow: this computer's, unless a test set one. */
export const currentPlatform = (): Platform => override ?? process.platform

/** Tests only: run the path rules as another platform's (null: this computer's). */
export function setPlatformForTests(p: Platform | null): void {
  override = p
}

const isWin = (platform: Platform): boolean => platform === 'win32'

/** The path functions of a platform (path.win32 on Windows, path.posix else). */
export function pathApi(platform: Platform = currentPlatform()): typeof path.win32 {
  return isWin(platform) ? path.win32 : path.posix
}

/**
 * A path part Windows takes for a device, not a file: CON, PRN, AUX, NUL,
 * COM0–9 and LPT0–9 (also with the superscript digits ¹ ² ³), the console's
 * CONIN$ / CONOUT$ and the old CLOCK$; alone, before a dot, and with spaces
 * before the dot or the end ("con .txt" is the console too). Security patch,
 * item 10 (S6: CONIN$, CONOUT$ and "con .txt" used to pass).
 */
export const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$|clock\$) *(?:\.|$)/i

/** Folders on Linux / macOS that are devices or the kernel's, never a user's file. */
const POSIX_SYSTEM = /^\/(dev|proc|sys)(\/|$)/

/**
 * A local file path the app may hand to the file system.
 * Windows (unchanged): a drive letter path; no UNC / SMB, device namespaces
 * (\\?\, \\.\), alternate streams or reserved device names (CON, NUL, COM1…),
 * so no file call can start an OS-level network connection.
 * macOS / Linux: an absolute path (/…), not starting with // (a network
 * path on some systems), not under /dev, /proc or /sys. A network mount
 * (/Volumes/x over SMB, /mnt/nfs) cannot be told from its path.
 * All: a string of at most 4096 characters with no control characters.
 */
export function isLocalFilePath(value: unknown, platform: Platform = currentPlatform()): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f]/.test(value)) return false
  if (isWin(platform)) {
    const p = value.replace(/\\/g, '/')
    if (!/^[a-z]:\//i.test(p) || p.slice(2).includes(':')) return false
    return !p.slice(3).split('/').some((part) => WINDOWS_DEVICE_NAME.test(part))
  }
  if (!value.startsWith('/') || value.startsWith('//')) return false
  return !POSIX_SYSTEM.test(path.posix.normalize(value))
}

/**
 * The same key for the same file, as the file system sees "the same":
 * Windows folds case (exactly `.toLowerCase()`, as before); macOS composes
 * Unicode the way its file system stores names (NFC) and keeps case (a
 * case-sensitive volume must not give two files one key); Linux keeps the
 * string as it is (ext4 is case-sensitive). No normalising: for that, pathKey.
 */
export function foldKey(p: string, platform?: Platform): string
export function foldKey(p: string | null | undefined, platform?: Platform): string | undefined
export function foldKey(p: string | null | undefined, platform: Platform = currentPlatform()): string | undefined {
  // (Nothing stays nothing, as `x?.toLowerCase()` did.)
  if (p === null || p === undefined) return undefined
  if (isWin(platform)) return p.toLowerCase()
  if (platform === 'darwin') return p.normalize('NFC')
  return p
}

/** foldKey of the normalised path (Windows: `path.win32.normalize(p).toLowerCase()`, as before). */
export function pathKey(p: string, platform: Platform = currentPlatform()): string {
  return foldKey(pathApi(platform).normalize(p), platform)
}

/**
 * Is `p` the folder `root` itself or inside it? Compared as the platform
 * compares paths (pathKey), after normalising both; `..` cannot climb out,
 * and a sibling that only starts with the same letters (/films/f2 next to
 * /films/f) is outside.
 */
export function isInside(root: string, p: string, platform: Platform = currentPlatform()): boolean {
  const api = pathApi(platform)
  const r = pathKey(root, platform).replace(/[\\/]+$/, '')
  const q = pathKey(p, platform)
  if (q === r) return true
  return q.startsWith(r + api.sep)
}
