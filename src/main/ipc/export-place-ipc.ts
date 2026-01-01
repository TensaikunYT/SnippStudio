// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export window's name and place (REF-AB item 11, REF-AB-PLAN-P.md; the
// security rule of DENEME-4's dialog:choose-save kept in another form). The
// page cannot name a path of its own: it names FILES, in a FOLDER the user
// chose in a system window. Those folders (the folder window here, and the
// folder of a file chosen in dialog:choose-save) are kept in the profile
// (export-folders.json, the last 20). `export:approve` lets the window write
// its files there only when the folder is one of them, each name is a plain
// export file name (shared/export-place.ts) and, for a file already there,
// the page says the user agreed to replace it; then, and only then, the
// paths become writable (chosenSavePaths), as a save dialog's path would.
import { app, dialog } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath, isSafeOutput } from '../security'
import { foldKey } from '../platform-path'
import { ipcMain, editorState, ownerWindow, normalize } from '../state'
import { exportFileList } from '../../shared/export-place'

const FILE = 'export-folders.json'
const KEEP = 20

let folders: string[] | null = null

async function load(): Promise<string[]> {
  if (folders) return folders
  try {
    const raw = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), FILE), 'utf8')) as { dirs?: unknown }
    folders = Array.isArray(raw.dirs) ? raw.dirs.filter((d): d is string => isLocalFilePath(d)).slice(0, KEEP) : []
  } catch {
    folders = []
  }
  return folders
}

async function save(): Promise<void> {
  try {
    await fs.writeFile(path.join(app.getPath('userData'), FILE), JSON.stringify({ dirs: folders ?? [] }))
  } catch {
    /* not kept: asked again next time */
  }
}

/** A folder the user chose in a system window: first in the list. */
export async function rememberExportFolder(dir: string): Promise<void> {
  if (!isLocalFilePath(dir)) return
  const d = normalize(dir)
  const list = await load()
  folders = [d, ...list.filter((x) => foldKey(x) !== foldKey(d))].slice(0, KEEP)
  await save()
}

async function known(dir: unknown): Promise<string | null> {
  if (!isLocalFilePath(dir)) return null
  const d = normalize(dir)
  if (!(await load()).some((x) => foldKey(x) === foldKey(d))) return null
  const st = await fs.stat(d).catch(() => null)
  return st?.isDirectory() ? d : null
}

export function registerExportPlaceIpc(): void {
  /** Whether the page's remembered folder is still one the user chose (and
   *  is there): the window shows it as the place, or asks. */
  ipcMain.handle('export:place-known', async (_e, dir: unknown) => known(dir))

  /** The folder button: the system's folder window. */
  ipcMain.handle('dialog:choose-export-folder', async (event, at: unknown) => {
    const win = ownerWindow(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      ...(isLocalFilePath(at) ? { defaultPath: at } : {})
    })
    const dir = result.canceled ? undefined : result.filePaths?.[0]
    if (!dir || !isLocalFilePath(dir)) return null
    await rememberExportFolder(dir)
    return normalize(dir)
  })

  /** The window's files in a chosen folder: writable when all is well. */
  ipcMain.handle('export:approve', async (event, raw: unknown) => {
    const args = (raw ?? {}) as { dir?: unknown; files?: unknown; replace?: unknown }
    const dir = await known(args.dir)
    if (!dir) return { ok: false, error: 'folder not chosen' }
    const files = exportFileList(args.files)
    if (!files) return { ok: false, error: 'bad file name' }
    const paths = files.map((f) => path.join(dir, f))
    if (!paths.every((p) => isSafeOutput(p) && path.dirname(p) === dir)) return { ok: false, error: 'bad file name' }
    const there: string[] = []
    for (const [i, p] of paths.entries()) {
      const st = await fs.stat(p).catch(() => null)
      if (st?.isDirectory()) return { ok: false, error: 'a folder has that name' }
      if (st) there.push(files[i])
    }
    if (there.length && args.replace !== true) return { ok: false, exists: there }
    const chosen = editorState(event.sender).chosenSavePaths
    for (const p of paths) chosen.add(normalize(p))
    await rememberExportFolder(dir)
    return { ok: true, paths }
  })
}
