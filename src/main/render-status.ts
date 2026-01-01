// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/**
 * The Renders panel's folder: <project>\cikti\.renders, one <name>.json per
 * export (its shape: src/renderer/src/export/renders.ts) and, while a Cancel
 * is asked, <name>.cancel beside it. Whoever runs the export writes the
 * JSON and watches for the .cancel; every Snipp with the panel open reads
 * them. Files rather than IPC because the export may run in another process
 * than the panel (a script driving a dev app; the user watching in another
 * window).
 *
 * No Electron and no relative imports: the tests run it directly.
 */
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

/** A status file's name (without .json): no path, nothing Windows refuses. */
export function safeRenderId(id: unknown): id is string {
  return typeof id === 'string' && /^[^<>:"/\\|?*\u0000-\u001f]{1,80}$/.test(id) && !/^[\s.]|[\s.]$/.test(id)
}

/**
 * Where the status files go: SNIPP_RENDERS_DIR when set; the dev app's own
 * folder's cikti\.renders; else a folder in Snipp's own data.
 */
export function rendersDirFor(o: { env: Record<string, string | undefined>; isPackaged: boolean; appPath: string; userData: string }): string {
  if (o.env.SNIPP_RENDERS_DIR) return path.resolve(o.env.SNIPP_RENDERS_DIR)
  if (!o.isPackaged) return path.join(o.appPath, 'cikti', '.renders')
  return path.join(o.userData, 'renders')
}

/** Writes a status atomically (a temp file, then a rename): a reader never sees half a file. */
export async function writeRenderFile(dir: string, id: string, json: string): Promise<string> {
  if (!safeRenderId(id)) throw new Error('bad render id')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `${id}.json`)
  const tmp = path.join(dir, `.${id}.${process.pid}.tmp`)
  await fs.writeFile(tmp, json, 'utf-8')
  // A reader holding the file open for a moment (Windows) refuses the
  // rename: a few tries.
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, target)
      return target
    } catch (err) {
      if (i >= 5) {
        await fs.unlink(tmp).catch(() => {})
        throw err
      }
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
}

/** Every status file's text (unread or odd ones left out). */
export async function readRenderFiles(dir: string): Promise<string[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: string[] = []
  for (const n of names) {
    if (!n.endsWith('.json') || n.startsWith('.')) continue
    const text = await fs.readFile(path.join(dir, n), 'utf-8').catch(() => null)
    if (text && text.length < 512 * 1024) out.push(text)
  }
  return out
}

/** The output named in a status file (for Open), or null. */
export async function renderOutput(dir: string, id: string): Promise<string | null> {
  if (!safeRenderId(id)) return null
  const text = await fs.readFile(path.join(dir, `${id}.json`), 'utf-8').catch(() => null)
  if (!text) return null
  try {
    const o = JSON.parse(text)
    return typeof o?.output === 'string' && path.isAbsolute(o.output) ? path.normalize(o.output) : null
  } catch {
    return null
  }
}

/** Cancel asked (the panel): the writer sees the file and stops. */
export async function askRenderCancel(dir: string, id: string): Promise<boolean> {
  if (!safeRenderId(id) || !existsSync(path.join(dir, `${id}.json`))) return false
  await fs.writeFile(path.join(dir, `${id}.cancel`), String(Date.now()), 'utf-8')
  return true
}

export function renderCancelAsked(dir: string, id: string): boolean {
  return safeRenderId(id) && existsSync(path.join(dir, `${id}.cancel`))
}

export async function clearRenderCancel(dir: string, id: string): Promise<void> {
  if (safeRenderId(id)) await fs.unlink(path.join(dir, `${id}.cancel`)).catch(() => {})
}

/** A finished job taken off the list (its file and any cancel left). */
export async function removeRenderFile(dir: string, id: string): Promise<boolean> {
  if (!safeRenderId(id)) return false
  await clearRenderCancel(dir, id)
  try {
    await fs.unlink(path.join(dir, `${id}.json`))
    return true
  } catch {
    return false
  }
}
