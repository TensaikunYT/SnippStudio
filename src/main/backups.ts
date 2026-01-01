// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Earlier versions of a project file (SnippStudio phase Ç2a.2, decision 4;
// report D8). The autosave writes the user's own file every few minutes, so a
// deliberately saved version could be replaced by an experiment, and a damaged
// file opened repaired could be written over before anyone looked. Before the
// FIRST autosave after an open or an explicit save, the file as it is on disk
// is copied here: <profile>\yedekler\<Project.uid>\<ms>-<rand>.snipp, the last
// five per project. Written and read only here, by names this file made (no
// path from the page is trusted). No Electron: the tests run it.
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './safe-write'

export const BACKUP_DIR = 'yedekler'
/** Copies kept per project. */
export const BACKUP_KEEP = 5
/** A project's identity as a folder name (types.ts newProjectUid: a UUID, or
 *  time and random letters). */
const UID_RE = /^[A-Za-z0-9_-]{1,80}$/
const NAME_RE = /^(\d{13})-[a-z0-9]{6}\.snipp$/

export const isBackupUid = (uid: unknown): uid is string => typeof uid === 'string' && UID_RE.test(uid)
export const isBackupName = (name: unknown): name is string => typeof name === 'string' && NAME_RE.test(name)

/** The folder of a project's copies, or null for an identity that is not one. */
export function backupDirOf(userData: string, uid: unknown): string | null {
  return isBackupUid(uid) ? path.join(userData, BACKUP_DIR, uid) : null
}

export interface BackupInfo {
  name: string
  /** When the copy was taken (ms since 1970). */
  at: number
  size: number
}

/** The copies of a project, newest first. */
export async function listBackups(userData: string, uid: unknown): Promise<BackupInfo[]> {
  const dir = backupDirOf(userData, uid)
  if (!dir) return []
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: BackupInfo[] = []
  for (const name of names) {
    const m = NAME_RE.exec(name)
    if (!m) continue
    const st = await fs.stat(path.join(dir, name)).catch(() => null)
    if (st?.isFile()) out.push({ name, at: Number(m[1]), size: st.size })
  }
  return out.sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1))
}

/** Keeps the newest `keep` copies; only names this file made are removed.
 *  `kept`: the copy just written, never removed whatever its time (a clock
 *  set back would make it the oldest): it counts as one of the `keep`, and the
 *  oldest of the others go (Ç2a patch, item 5). */
export async function pruneBackups(userData: string, uid: unknown, keep = BACKUP_KEEP, kept: string | null = null): Promise<void> {
  const dir = backupDirOf(userData, uid)
  if (!dir) return
  const list = await listBackups(userData, uid)
  const others = list.filter((b) => b.name !== kept)
  const room = Math.max(0, keep - (others.length < list.length ? 1 : 0))
  for (const old of others.slice(room)) await fs.rm(path.join(dir, old.name), { force: true }).catch(() => {})
}

/**
 * Copies the project file `file` as it is on disk now into the copies of
 * project `uid`, then keeps the last five. `ok` with no name: there was no
 * file to copy (nothing can be lost). `ok: false`: the copy could not be
 * written; the caller then writes nothing over the file.
 */
export async function backupProjectFile(userData: string, file: string, uid: unknown, now = Date.now()): Promise<{ ok: boolean; name: string | null }> {
  const dir = backupDirOf(userData, uid)
  if (!dir) return { ok: false, name: null }
  let data: Buffer
  try {
    data = await fs.readFile(file)
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? { ok: true, name: null } : { ok: false, name: null }
  }
  const name = `${String(Math.max(0, Math.floor(now))).padStart(13, '0').slice(-13)}-${randomBytes(4).toString('hex').slice(0, 6)}.snipp`
  try {
    await fs.mkdir(dir, { recursive: true })
    await writeFileAtomic(path.join(dir, name), data)
  } catch {
    return { ok: false, name: null }
  }
  await pruneBackups(userData, uid, BACKUP_KEEP, name)
  return { ok: true, name }
}

/** One copy's text, or null (no such copy, or a name this file did not make). */
export async function readBackup(userData: string, uid: unknown, name: unknown): Promise<string | null> {
  const dir = backupDirOf(userData, uid)
  if (!dir || !isBackupName(name)) return null
  return fs.readFile(path.join(dir, name), 'utf8').catch(() => null)
}
