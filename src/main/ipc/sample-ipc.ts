// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The sample project (SnippStudio phase 9b, decision 3; FAZ9.md 9b karar 3):
// its material is made by the page itself (coloured test clips with a tone,
// titles, a template, a code template clip); the main process gives it a new
// folder under the profile each time ("opens as a copy": the user's edits
// never reach a shared original) and writes only the clip files it names
// there. Nothing of the user's is read or written, nothing is downloaded.
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from '../safe-write'
import { ipcMain, allowedMediaPaths, knownProjectPaths, normalize, pathToMediaUrl } from '../state'
import { foldKey } from '../platform-path'
import { mt } from '../strings-main'

/** The clip files a sample may hold, and how big one may be. */
export const SAMPLE_FILES = new Set(['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4'])
const MAX_FILE = 8 * 1024 * 1024

export const samplesRoot = (): string => path.join(app.getPath('userData'), 'samples')

/** The sample folder each window is making (by its page's id). */
const making = new Map<number, string>()

export function registerSampleIpc(): void {
  ipcMain.handle('sample:create', async (event) => {
    const root = samplesRoot()
    await fs.mkdir(root, { recursive: true })
    const base = mt('sample.name')
    let dir = ''
    for (let n = 1; n < 1000; n++) {
      const d = path.join(root, `${base} ${n}`)
      if (!(await fs.stat(d).catch(() => null))) {
        dir = d
        break
      }
    }
    if (!dir) return null
    await fs.mkdir(dir, { recursive: true })
    const project = normalize(path.join(dir, `${base}.snipp`))
    // The page saves it like any project it chose (project:save-direct).
    knownProjectPaths.add(project)
    making.set(event.sender.id, dir)
    return { dir, project }
  })

  ipcMain.handle('sample:write', async (event, name: unknown, data: unknown) => {
    const dir = making.get(event.sender.id)
    if (!dir || typeof name !== 'string' || !SAMPLE_FILES.has(name)) return null
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_FILE) return null
    const p = normalize(path.join(dir, name))
    await writeFileAtomic(p, data)
    allowedMediaPaths.add(foldKey(p))
    const st = await fs.stat(p)
    return { path: p, name, size: st.size, mtime: Math.round(st.mtimeMs), url: pathToMediaUrl(p) }
  })
}
