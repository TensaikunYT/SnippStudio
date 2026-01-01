// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The speech models' folders and their IPC (read, write, append, commit,
// count). Moved out of src/main/index.ts in SnippStudio phase 2B (no change).
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { freemem, totalmem } from 'node:os'
import path from 'node:path'
import { isModelStoreFile } from './security'
import { ipcMain, allowedMediaPaths, pathToMediaUrl } from './state'
import { foldKey } from './platform-path'
import { availableMemory, mayWriteInsideApp, readVmStat } from './platform-system'
import { execFileSync } from 'node:child_process'
import { systemToolCwd } from './system-tool'

// ---------------------------------------------------------------------------
// Whisper model store: model files live as REAL files on disk so they are
// downloaded exactly once and survive app restarts, new projects, updates and
// browser-storage eviction. A `models` folder shipped next to the app
// resources is also honored, so the model can be bundled with the program.
// ---------------------------------------------------------------------------
// Preferred store: a `models` folder INSIDE the program (next to the app
// resources) so copying the program folder to another PC carries the model —
// nothing ever downloads again. Falls back to per-user data when the install
// location is read-only (e.g. Program Files).
const vmStatText = (): string | null => readVmStat(process.platform, (cmd) => { try { return execFileSync(cmd, { cwd: systemToolCwd(), encoding: 'utf8', timeout: 2000, windowsHide: true }) } catch { return null } })

export const userModelDir = () => path.join(app.getPath('userData'), 'whisper-models')
export const bundledModelDir = () => path.join(process.resourcesPath ?? '', 'models')
export let resolvedModelDir: string | null = null
export async function modelWriteDir(): Promise<string> {
  if (resolvedModelDir) return resolvedModelDir
  // (Only on Windows: on macOS / Linux the program's folder is never written,
  // platform-system.ts modelWriteDirFor; phase 10a, P8.)
  if (mayWriteInsideApp(process.platform, app.isPackaged)) {
    const inApp = bundledModelDir()
    try {
      await fs.mkdir(inApp, { recursive: true })
      const probe = path.join(inApp, '.write-probe')
      await fs.writeFile(probe, 'x')
      await fs.rm(probe, { force: true })
      resolvedModelDir = inApp
      return inApp
    } catch {
      /* read-only install location */
    }
  }
  resolvedModelDir = userModelDir()
  return resolvedModelDir
}
/** Run from the source folder (not packaged), the models are the checkout's
 *  own `models\` (what a build packs into resources): a fresh profile, such as
 *  a dev copy's, finds them with nothing copied. */
export const sourceModelDir = () => path.join(app.getAppPath(), 'models')
export const modelReadDirs = () => [bundledModelDir(), ...(app.isPackaged ? [] : [sourceModelDir()]), userModelDir()]

/** Rescues any model files that an OLD build left in the per-user store into
 *  the program-folder store (which ships bundled with the app). We deliberately
 *  do NOT copy the other way any more: the model is bundled in resources, so a
 *  second ~2 GB copy under userData was pure waste that also regrew after the
 *  "Clear cache" button deleted it. Best-effort, runs once at startup. */
export async function relocateModelsIntoApp(): Promise<void> {
  const appDir = await modelWriteDir()
  if (appDir !== bundledModelDir()) return
  const userDir = userModelDir()
  const names = await fs.readdir(userDir).catch(() => [] as string[])
  for (const n of names) {
    if (!isModelStoreFile(n)) continue
    const dest = path.join(appDir, n)
    if (await fs.stat(dest).catch(() => null)) continue
    try {
      await fs.mkdir(appDir, { recursive: true })
      await fs.copyFile(path.join(userDir, n), dest)
    } catch {
      /* best-effort */
    }
  }
}

/** URL → safe flat filename (keeps readable substrings for lookups). */
export function modelKeyToFile(key: string): string | null {
  if (typeof key !== 'string' || key.length === 0 || key.length > 1024) return null
  const name = key.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  if (!isModelStoreFile(name)) return null
  return name
}

export function registerModelIpc() {
  void relocateModelsIntoApp()
  ipcMain.handle('model:get', async (_e, key: string) => {
    const name = modelKeyToFile(key)
    if (!name) return null
    for (const dir of modelReadDirs()) {
      try {
        const buf = await fs.readFile(path.join(dir, name))
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      } catch {
        /* try next location */
      }
    }
    return null
  })

  ipcMain.handle('model:put', async (_e, key: string, data: ArrayBuffer) => {
    if (app.isPackaged) return false
    const name = modelKeyToFile(key)
    if (!name || !(data instanceof ArrayBuffer) || data.byteLength > 4 * 1024 ** 3) return false
    const dir = await modelWriteDir()
    // Write via temp + rename so a crash never leaves a truncated model file.
    const dest = path.join(dir, name)
    const tmp = dest + '.part'
    await fs.writeFile(tmp, Buffer.from(data))
    await fs.rename(tmp, dest)
    return true
  })

  // ---- chunked transfer: Electron IPC rejects messages over ~256 MB, so
  // the gigabyte-scale onnx files move in slices. --------------------------
  ipcMain.handle('model:size', async (_e, key: string) => {
    const name = modelKeyToFile(key)
    if (!name) return null
    for (const dir of modelReadDirs()) {
      const stat = await fs.stat(path.join(dir, name)).catch(() => null)
      if (stat?.isFile()) return stat.size
    }
    return null
  })

  ipcMain.handle('model:read', async (_e, key: string, offset: number, length: number) => {
    const name = modelKeyToFile(key)
    if (!name || typeof offset !== 'number' || typeof length !== 'number') return null
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > 64 * 1024 * 1024) return null
    for (const dir of modelReadDirs()) {
      try {
        const fh = await fs.open(path.join(dir, name), 'r')
        try {
          // A buffer of its own (byteOffset 0, not from the pool), returned as
          // it is: no second 32 MB copy per piece. Only a short read at the
          // end of the file is cut down to what was read.
          const buf = Buffer.allocUnsafeSlow(length)
          const { bytesRead } = await fh.read(buf, 0, length, offset)
          const own = buf.byteOffset === 0 && buf.buffer.byteLength === length
          if (own && bytesRead === length) return buf.buffer
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead)
        } finally {
          await fh.close()
        }
      } catch {
        /* try next location */
      }
    }
    return null
  })

  ipcMain.handle('model:append', async (_e, key: string, chunk: ArrayBuffer, first: boolean) => {
    if (app.isPackaged) return false
    const name = modelKeyToFile(key)
    if (!name || !(chunk instanceof ArrayBuffer) || chunk.byteLength > 64 * 1024 * 1024) return false
    const dir = await modelWriteDir()
    const tmp = path.join(dir, name) + '.part'
    if (first) await fs.writeFile(tmp, Buffer.from(chunk))
    else await fs.appendFile(tmp, Buffer.from(chunk))
    return true
  })

  // ---- processed audio (a cleaned voice): a WAV written in pieces into the
  // app's own folder, its sizes patched at the end, then usable as media. ----
  const processedDir = () => path.join(app.getPath('userData'), 'processed-audio')
  ipcMain.handle('media:processed', async (_e, args: { id: string; chunk: ArrayBuffer; first: boolean; last: boolean; name: string }) => {
    if (!args || typeof args.id !== 'string' || !/^[a-z0-9]{8,40}$/.test(args.id)) return null
    if (!(args.chunk instanceof ArrayBuffer) || args.chunk.byteLength > 64 * 1024 * 1024) return null
    await fs.mkdir(processedDir(), { recursive: true })
    const part = path.join(processedDir(), args.id + '.part')
    if (args.first) await fs.writeFile(part, Buffer.from(args.chunk))
    else await fs.appendFile(part, Buffer.from(args.chunk))
    if (!args.last) return { ok: true }
    // The RIFF and data sizes, now that the length is known.
    const size = (await fs.stat(part)).size
    const fh = await fs.open(part, 'r+')
    try {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(Math.max(0, size - 8), 0)
      await fh.write(b, 0, 4, 4)
      b.writeUInt32LE(Math.max(0, size - 44), 0)
      await fh.write(b, 0, 4, 40)
    } finally {
      await fh.close()
    }
    const target = path.join(processedDir(), args.id + '.wav')
    await fs.rename(part, target)
    allowedMediaPaths.add(foldKey(target))
    const base = path.basename(String(args.name || 'cleaned')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
    return { path: target, name: base.toLowerCase().endsWith('.wav') ? base : base + '.wav', size, url: pathToMediaUrl(target) }
  })

  ipcMain.handle('model:commit', async (_e, key: string) => {
    if (app.isPackaged) return false
    const name = modelKeyToFile(key)
    if (!name) return false
    const dest = path.join(await modelWriteDir(), name)
    try {
      await fs.rename(dest + '.part', dest)
      return true
    } catch {
      return false
    }
  })

  // Counts stored model files whose name contains `needle`.
  ipcMain.handle('model:count', async (_e, needle: string) => {
    if (typeof needle !== 'string' || needle.length > 256) return 0
    const seen = new Set<string>()
    for (const dir of modelReadDirs()) {
      const names = await fs.readdir(dir).catch(() => [] as string[])
      for (const n of names) {
        if (!n.endsWith('.part') && n.includes(needle.replace(/[^a-zA-Z0-9._-]/g, '_'))) seen.add(n)
      }
    }
    return seen.size
  })

  // The machine's memory in bytes (free = what Windows can hand out now),
  // checked before a speech model that needs gigabytes is loaded.
  ipcMain.handle('sys:memory', () => ({ free: availableMemory(process.platform, freemem(), vmStatText()), total: totalmem() }))
}
