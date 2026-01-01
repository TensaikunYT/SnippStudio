// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Renders panel's folder, its watch and its IPC. Moved out of
// src/main/index.ts in SnippStudio phase 2B (no change).
import { app, BrowserWindow, shell } from 'electron'
import { mkdirSync, promises as fs, watch } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath } from './security'
import { askRenderCancel, clearRenderCancel, readRenderFiles, removeRenderFile, renderCancelAsked, renderOutput, rendersDirFor, safeRenderId, writeRenderFile } from './render-status'
import { ipcMain, editorWindows, MEDIA_EXTENSIONS, IMAGE_EXTENSIONS } from './state'

// -- the Renders panel ---------------------------------------------------------
// Every export's status file in <project>\cikti\.renders (render-status.ts):
// written here for this app's own exports, read for the panel, watched so
// the panel follows an export in another process as it goes.
export let rendersDirCache: string | null = null
export function rendersDir(): string {
  rendersDirCache ??= rendersDirFor({ env: process.env, isPackaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData') })
  return rendersDirCache
}
export let rendersWatcher: ReturnType<typeof watch> | null = null
export let rendersPing: ReturnType<typeof setTimeout> | null = null
export function watchRenders(): void {
  if (rendersWatcher) return
  try {
    mkdirSync(rendersDir(), { recursive: true })
    rendersWatcher = watch(rendersDir(), () => {
      // A burst of writes (temp file, rename): one word to the windows.
      if (rendersPing) return
      rendersPing = setTimeout(() => {
        rendersPing = null
        for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && editorWindows.has(w.webContents.id)) w.webContents.send('renders:changed')
      }, 250)
    })
    rendersWatcher.on('error', () => {
      rendersWatcher?.close()
      rendersWatcher = null
    })
  } catch {
    // No watching (a folder that cannot be made): the panel's own slow poll still reads it.
    rendersWatcher = null
  }
}

export function registerRendersIpc(): void {
  ipcMain.handle('renders:list', async () => {
    watchRenders()
    return { dir: rendersDir(), files: await readRenderFiles(rendersDir()) }
  })
  ipcMain.handle('renders:write', async (_e, raw: unknown) => {
    if (typeof raw !== 'string' || raw.length > 256 * 1024) return false
    let o: Record<string, unknown>
    try {
      o = JSON.parse(raw)
    } catch {
      return false
    }
    if (!o || o.v !== 1 || !safeRenderId(o.id)) return false
    o.pid = process.pid
    try {
      await writeRenderFile(rendersDir(), o.id, JSON.stringify(o, null, 1))
      if (o.state !== 'running') await clearRenderCancel(rendersDir(), o.id)
      return true
    } catch {
      return false
    }
  })
  ipcMain.handle('renders:cancel', async (_e, id: unknown) => (safeRenderId(id) ? askRenderCancel(rendersDir(), id) : false))
  ipcMain.handle('renders:cancel-asked', (_e, id: unknown) => safeRenderId(id) && renderCancelAsked(rendersDir(), id))
  ipcMain.handle('renders:remove', async (_e, id: unknown) => (safeRenderId(id) ? removeRenderFile(rendersDir(), id) : false))
  // Open / show the finished video: the path is the one in the status file
  // (never one the page names), a video or a sound, and there.
  const finishedOutput = async (id: unknown): Promise<string | null> => {
    if (!safeRenderId(id)) return null
    const p = await renderOutput(rendersDir(), id)
    if (!p || !isLocalFilePath(p) || !MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase()) || IMAGE_EXTENSIONS.has(path.extname(p).toLowerCase())) return null
    return (await fs.stat(p).catch(() => null))?.isFile() ? p : null
  }
  ipcMain.handle('renders:open', async (_e, id: unknown) => {
    const p = await finishedOutput(id)
    return p ? (await shell.openPath(p)) === '' : false
  })
  ipcMain.handle('renders:reveal', async (_e, id: unknown) => {
    const p = await finishedOutput(id)
    if (p) shell.showItemInFolder(p)
    return !!p
  })
}
