// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Project files in the main process: the recents index and inbox, which paths
// are the user's projects, the derived-analysis folder and its pruning, crash
// recovery snapshots. Moved out of src/main/index.ts in SnippStudio phase 2B
// (no change).
import { createHash } from 'crypto'
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath } from './security'
import { markPresence, type RecentRecord } from './recents-store'
import { CHANNEL } from './channel'
import { LEGACY_PROFILES } from '../shared/product'
import { knownProjectPaths, editorWindows, claimedRecoveryPaths, normalize, parseJsonFile } from './state'
import { foldKey } from './platform-path'

export function recentsPath(): string {
  return path.join(app.getPath('userData'), 'recents.json')
}

/**
 * Where other programs drop the projects they saved, for the list (recents-store.ts, "The inbox"). The packaged app reads
 * ~/.snipp/inbox; a dev build only the folder SNIPP_INBOX names, so Claude's
 * dev apps (their own profiles) leave the user's inbox alone.
 */
export function inboxDir(): string | null {
  // (A packaged dev copy is not the user's Snipp either: channel.ts.)
  if (app.isPackaged && CHANNEL !== 'dev') return path.join(app.getPath('home'), '.snipp', 'inbox')
  const dir = process.env.SNIPP_INBOX
  return dir && isLocalFilePath(dir) ? path.normalize(dir) : null
}

/** The drive questions still out (recents-store.ts markPresence): a drive that
 *  hangs is asked once, however often the Projects home opens meanwhile. */
export const drivePresenceProbes = new Map<string, Promise<boolean>>()

/** Marks entries whose file is not there now. A drive that does not answer
 *  within a moment is left unmarked (it may be slow, not gone). One question
 *  per drive and a couple of files at a time: a stat per entry all at once,
 *  on a sleeping disk or a lost network drive, held every one of main's file
 *  threads, and playback and saves waited behind them. */
export async function withPresence(list: RecentRecord[]): Promise<(RecentRecord & { missing?: boolean })[]> {
  return markPresence(list, { stat: (p) => fs.stat(p), timeoutMs: 1500, concurrency: 2, probes: drivePresenceProbes })
}

/** Project paths listed in the user's own recents index. Together with
 *  `knownProjectPaths` (dialog picks) this is the full set of files the
 *  project-file handlers may touch — so a compromised renderer can't hand us an
 *  arbitrary path to read, rename or bin. */
export const recentProjectPaths = new Set<string>()

export function rememberRecentPaths(entries: unknown): void {
  if (!Array.isArray(entries)) return
  for (const e of entries) {
    const p = (e as { path?: unknown })?.path
    if (isLocalFilePath(p) && /\.(snipp|autocut|json)$/i.test(p)) {
      recentProjectPaths.add(foldKey(normalize(p)))
    }
  }
}

export function isUserProjectPath(p: string): boolean {
  const key = foldKey(p)
  if (recentProjectPaths.has(key)) return true
  for (const known of knownProjectPaths) if (foldKey(known) === key) return true
  return false
}

/** The current userData dir plus the legacy app-name sibling next to it, so a
 *  build that changed productName/name doesn't leave orphaned model copies. */
export function userDataSiblings(): string[] {
  const cur = app.getPath('userData')
  // A dev copy clears only its own folder: the release copy's profile beside
  // it is live, not a leftover.
  if (CHANNEL === 'dev') return [cur]
  const parent = path.dirname(cur)
  // Current folder plus legacy app-name folders (the app was renamed), so the
  // cache cleanup still reclaims model copies orphaned by old builds. Never
  // the folders the first start copies settings from (phase 9a, decision 3:
  // shared/product.ts inheritFrom): those belong to the older app and are
  // never written.
  return [...new Set([cur, ...LEGACY_PROFILES.map((n) => path.join(parent, n))])]
}

/** Ceiling for the derived-analysis folder. Peaks run a few MB per hour of
 *  audio, so this is still hundreds of clips — and without a cap it would grow
 *  for ever, which is exactly the disk bloat this app has had to clean up
 *  before. */
export const ANALYSIS_MAX_BYTES = 500 * 1024 * 1024
/** Every derived kind, so a file's whole analysis set can be dropped at once. */
export const ANALYSIS_KINDS = ['peaks', 'strip'] as const
export let pruning = false

/** Where a media file's derived analysis of `kind` lives, or null if the media
 *  is gone (the key includes size+mtime, so it can't be built without it). */
export async function analysisFileFor(mediaPath: string, kind: string): Promise<string | null> {
  if (!isLocalFilePath(mediaPath) || !ANALYSIS_KINDS.includes(kind as typeof ANALYSIS_KINDS[number])) return null
  const p = normalize(String(mediaPath))
  const stat = await fs.stat(p).catch(() => null)
  if (!stat?.isFile()) return null
  const h = createHash('sha1')
    .update(`${p}|${stat.size}|${Math.round(stat.mtimeMs)}|${kind}`)
    .digest('hex')
  return path.join(app.getPath('userData'), 'analysis', `${h}.bin`)
}

/** Media paths a project file references (read before the file is binned). */
export async function projectMediaPaths(projectPath: string): Promise<string[]> {
  const raw = await fs.readFile(projectPath, 'utf8').catch(() => null)
  if (!raw) return []
  try {
    const assets = (parseJsonFile(raw) as { assets?: { path?: unknown }[] })?.assets
    if (!Array.isArray(assets)) return []
    return assets.filter((a) => typeof a?.path === 'string').map((a) => a.path as string)
  } catch {
    return []
  }
}

/**
 * Drops the derived analysis for these media files. Called when a project is
 * binned: its waveform and filmstrip data is dead weight from that moment on.
 * If another project still uses the same footage it simply gets re-analysed —
 * cheap, and far better than an ever-growing folder of orphaned caches.
 */
export async function forgetAnalysis(mediaPaths: string[]): Promise<void> {
  for (const media of mediaPaths) {
    for (const kind of ANALYSIS_KINDS) {
      const file = await analysisFileFor(media, kind)
      if (file) await fs.rm(file, { force: true }).catch(() => {})
    }
  }
}

/** Trims the analysis folder back under the cap, oldest file first. */
export async function pruneAnalysis(): Promise<void> {
  if (pruning) return
  pruning = true
  try {
    const dir = path.join(app.getPath('userData'), 'analysis')
    const names = await fs.readdir(dir).catch(() => [] as string[])
    const files: { full: string; size: number; mtime: number }[] = []
    let total = 0
    for (const name of names) {
      const full = path.join(dir, name)
      const st = await fs.stat(full).catch(() => null)
      if (!st?.isFile()) continue
      files.push({ full, size: st.size, mtime: st.mtimeMs })
      total += st.size
    }
    if (total <= ANALYSIS_MAX_BYTES) return
    files.sort((a, b) => a.mtime - b.mtime)
    for (const f of files) {
      if (total <= ANALYSIS_MAX_BYTES) break
      await fs.rm(f.full, { force: true }).catch(() => {})
      total -= f.size
    }
  } finally {
    pruning = false
  }
}

export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[])
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) total += await dirSize(full)
    else {
      const st = await fs.stat(full).catch(() => null)
      if (st) total += st.size
    }
  }
  return total
}

export function windowRecoveryPath(contentsId: number, suffix?: string): string {
  return path.join(app.getPath('userData'), `recovery-${process.pid}-${contentsId}${suffix ? `-${suffix}` : ''}.autocut`)
}

/** Claims the newest crash snapshot not already owned by another live window.
 * More windows can be opened to recover further snapshots after a multi-window
 * crash, while a newly opened window never mistakes a live window's autosave
 * for crashed work. */
export async function claimPendingRecovery(contentsId: number): Promise<string | null> {
  const dir = app.getPath('userData')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const candidates = names.filter((name) => name === 'recovery.autocut' || /^recovery-.*\.autocut$/i.test(name))
  const active = new Set(
    [...editorWindows.entries()]
      .filter(([id]) => id !== contentsId)
      .flatMap(([, state]) => [foldKey(state.recoveryPath), foldKey(state.pendingRecoveryPath)])
      .filter((value): value is string => !!value)
  )
  const files: { path: string; mtime: number }[] = []
  for (const name of candidates) {
    const candidate = path.join(dir, name)
    const key = foldKey(candidate)
    if (active.has(key) || claimedRecoveryPaths.has(key)) continue
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat?.isFile()) files.push({ path: candidate, mtime: stat.mtimeMs })
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const chosen = files[0]?.path ?? null
  if (chosen) claimedRecoveryPaths.add(foldKey(chosen))
  return chosen
}
