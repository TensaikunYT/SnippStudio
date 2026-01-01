// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * Files the user cannot lose: project files, autosaves and crash-recovery
 * snapshots (the 2026-10-16 audit).
 *
 * fs.writeFile opens with truncate and writes in place. A full disk (a
 * multi-GB export filling C:) left the .snipp empty, and a hard reset while
 * Windows had not flushed it yet (the PC freezing during an English
 * transcription) left it full of zero bytes: "Project file is not valid
 * JSON", the only copy gone. Here the new text goes to a temp file beside
 * it, is flushed to the disk, and is then renamed over the old one, so the
 * file on disk is always the old version or the new one, whole.
 *
 * Also here: one write at a time per file (Ctrl+S and the autosave cannot
 * interleave), the stamp a window keeps of the project file as it last read
 * or wrote it (another program writing it since is never written over
 * unasked), and the rename a finished streamed export ends with.
 *
 * No Electron: the tests run it.
 */
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import { PRODUCT_NAME } from '../shared/product'
import { pathApi, pathKey } from './platform-path'

/** Refusals that pass: Windows refuses a rename for a moment while a reader,
 *  a scanner or the antivirus holds the file. */
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES'])
export const isBusyError = (err: unknown): boolean => BUSY.has((err as NodeJS.ErrnoException)?.code ?? '')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let seq = 0
/** A temp name beside the file. It ends in .tmp, so neither the crash-recovery
 *  scan (recovery-*.autocut) nor Find projects (*.snipp) takes it for one. */
export function tempPathFor(target: string): string {
  return `${target}.${process.pid}.${Date.now().toString(36)}.${++seq}.tmp`
}

export interface RetryOptions {
  /** Attempts in all (default 7, about 1.4 s of waiting). */
  tries?: number
  /** The first wait; each next one is longer (default 50 ms). */
  delayMs?: number
  /** The rename itself (the tests stand in a refusing one). */
  rename?: (from: string, to: string) => Promise<void>
}

/** fs.rename, tried again while Windows refuses it for a moment. On Windows it
 *  replaces an existing target (MoveFileEx with REPLACE_EXISTING): no delete
 *  first, so there is never a moment with no file at all. */
export async function renameWithRetry(from: string, to: string, opts: RetryOptions = {}): Promise<void> {
  const tries = Math.max(1, opts.tries ?? 7)
  const delay = opts.delayMs ?? 50
  const rename = opts.rename ?? ((a: string, b: string) => fs.rename(a, b))
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (err) {
      if (!isBusyError(err) || attempt >= tries) throw err
      await sleep(delay * attempt)
    }
  }
}

/** Writes the whole file or nothing: temp file, flushed to the disk, renamed
 *  over the old one. On a failure the temp file goes and the old file is left
 *  exactly as it was; the error is thrown. */
export async function writeFileAtomic(target: string, data: string | Uint8Array, opts: RetryOptions = {}): Promise<void> {
  const tmp = tempPathFor(target)
  let fh: FileHandle | null = null
  try {
    fh = await fs.open(tmp, 'w')
    if (typeof data === 'string') await fh.writeFile(data, 'utf-8')
    else await fh.writeFile(data)
    // On the disk before it replaces anything: a reset straight after the
    // rename must not find the new name pointing at unwritten blocks.
    await fh.sync()
    await fh.close()
    fh = null
    await renameWithRetry(tmp, target, opts)
  } catch (err) {
    if (fh) await fh.close().catch(() => {})
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * A whole export file (the sound alone, a frame, a batch's file) written the
 * way a streamed video is (phase Ç3 patch, R-2): into `<target>.part`,
 * flushed, then renamed over the target. It was written straight onto the
 * target (fs.writeFile truncates first): a full disk left the user's old
 * file of that name emptied. On a failed write the .part goes and the old
 * file is left exactly as it was. A read-only old file that refuses the
 * rename is removed first, as the streamed export does; if the new file
 * still cannot be put in place, it stays as the .part and the error says so.
 */
export async function writeViaPart(target: string, data: Uint8Array, opts: RetryOptions & { write?: (fh: FileHandle, data: Uint8Array) => Promise<void> } = {}): Promise<void> {
  const part = `${target}.part`
  let fh: FileHandle | null = null
  try {
    fh = await fs.open(part, 'w')
    if (opts.write) await opts.write(fh, data)
    else await fh.writeFile(data)
    await fh.sync()
    await fh.close()
    fh = null
  } catch (err) {
    if (fh) await fh.close().catch(() => {})
    await fs.rm(part, { force: true }).catch(() => {})
    throw err
  }
  try {
    await renameWithRetry(part, target, opts).catch(async () => {
      await fs.rm(target, { force: true })
      await renameWithRetry(part, target, opts)
    })
  } catch {
    if (await fs.stat(target).catch(() => null)) {
      // The old file is still there: the new one goes.
      await fs.rm(part, { force: true }).catch(() => {})
      throw new Error(`${pathApi().basename(target)} could not be replaced (it is open in another program?). Close it there, then export again.`)
    }
    throw new Error(`The file is written, but ${pathApi().basename(target)} could not be put in place. It is saved as ${part}: rename it, or export again.`)
  }
}

/** A copy that is all there or not there at all. The libraries (sounds,
 *  sound effects) skip a file that already exists, so a copy cut off half
 *  way must never sit under the final name. */
export async function copyFileAtomic(source: string, target: string, opts: RetryOptions = {}): Promise<void> {
  const tmp = tempPathFor(target)
  try {
    await fs.copyFile(source, tmp)
    const fh = await fs.open(tmp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    await renameWithRetry(tmp, target, opts)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

const queues = new Map<string, Promise<unknown>>()
/** One job at a time per file (Windows names: case-insensitive, either
 *  slash), in the order they were asked for. A failed job does not stop the
 *  next one. */
export function onePerPath<T>(target: string, job: () => Promise<T>): Promise<T> {
  const key = pathKey(target)
  const before = queues.get(key) ?? Promise.resolve()
  const run = before.then(job)
  const tail = run.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

// -- the disk stamp --------------------------------------------------------------
// What a window last read from or wrote to its project file. Another program
// (a script, another tool) may write a .snipp file the app has open; a save that finds the file changed since is
// refused ('changed-on-disk') until the user says to overwrite it.

export interface DiskStamp {
  mtimeMs: number
  size: number
}

export const diskStampOf = (st: { mtimeMs: number; size: number }): DiskStamp => ({ mtimeMs: st.mtimeMs, size: st.size })

/** The key a stamp is kept under: one per file, as Windows names them. */
export const stampKey = (p: string): string => pathKey(p)

/** The file's stamp now, or null when there is no such file. */
export async function readDiskStamp(p: string): Promise<DiskStamp | null> {
  const st = await fs.stat(p).catch(() => null)
  return st?.isFile() ? diskStampOf(st) : null
}

/** True when the file is not the one this window last read or wrote: another
 *  program wrote it since. No stamp (never opened or saved here) or no file
 *  (deleted or moved: writing it again loses nothing) is not a change. */
export function changedOnDisk(stamp: DiskStamp | null | undefined, now: DiskStamp | null | undefined): boolean {
  if (!stamp || !now) return false
  return now.mtimeMs !== stamp.mtimeMs || now.size !== stamp.size
}

// -- a finished streamed export ------------------------------------------------------

/** Can `target` be replaced now? Replacing a file needs the same delete access
 *  a rename does, and a player holding it without sharing delete refuses
 *  both: so it is renamed to a name beside it and straight back. Checked
 *  before an export starts, so a film open in a player fails in a second, not
 *  after an hour of rendering. */
export async function checkReplaceable(target: string, opts: RetryOptions = {}): Promise<'ok' | 'busy'> {
  if (!(await fs.stat(target).catch(() => null))) return 'ok'
  const rename = opts.rename ?? ((a: string, b: string) => fs.rename(a, b))
  const probe = `${target}.snipp-check-${process.pid}-${++seq}`
  try {
    await rename(target, probe)
  } catch (err) {
    // Anything else (a read-only file, a folder) the real rename reports itself.
    return isBusyError(err) ? 'busy' : 'ok'
  }
  try {
    await renameWithRetry(probe, target, opts)
  } catch {
    throw new Error(`${PRODUCT_NAME} could not put ${pathApi().basename(target)} back after checking it; it is now ${pathApi().basename(probe)}.`)
  }
  return 'ok'
}
