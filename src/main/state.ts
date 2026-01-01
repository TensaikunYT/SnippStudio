// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The main process's shared state and helpers: our page and its trusted IPC,
// the media and project paths a window may reach, each editor window's own
// state, the awake holds, paths and media URLs, the page loader. Moved out of
// src/main/index.ts in SnippStudio phase 2B (no change).
import { app, BrowserWindow, ipcMain as rawIpcMain, powerSaveBlocker } from 'electron'
import type { WebContents, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { developmentOrigin, isTrustedDocument } from './network'
import { isLocalFilePath } from './security'
import { isRenderWorkerProcess } from './render-workers'
import { AwakeHolds } from './awake'
import { readDiskStamp, stampKey, type DiskStamp } from './safe-write'
import { foldKey } from './platform-path'

export const devUrl = developmentOrigin(app.isPackaged, process.env.ELECTRON_RENDERER_URL)
export const rendererEntry = pathToFileURL(path.join(import.meta.dirname, '../renderer/index.html')).href
export const ourPage = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
  !!event.senderFrame && isTrustedDocument(event.senderFrame.url, rendererEntry, devUrl)
export const trustedSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
  editorWindows.has(event.sender.id) && event.senderFrame === event.sender.mainFrame && ourPage(event)
/** This copy of the app is a render worker of another's parallel export
 *  (render-workers.ts): no editor, one hidden window. */
export const renderWorker = isRenderWorkerProcess()
// Every bridge operation is restricted to our own top-level editor document.
export const ipcMain = {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
    rawIpcMain.handle(channel, (event, ...args) => {
      if (!trustedSender(event)) throw new Error('Untrusted IPC sender')
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    rawIpcMain.on(channel, (event, ...args) => {
      if (trustedSender(event)) {
        try { listener(event, ...args) } catch { /* Invalid untrusted input must not crash main. */ }
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Security model:
// - The renderer is fully sandboxed (sandbox: true, contextIsolation: true,
//   nodeIntegration: false). It can only reach the OS through the small IPC
//   surface defined below.
// - Media files are served over the custom `media://` protocol, which only
//   serves paths that were previously put on an allowlist by a native file
//   dialog, by opening a project file, or by a file the user dropped on the
//   window. The renderer can never register paths itself: for a drop the
//   preload takes the path from the dropped File object (webUtils), never
//   from text the page sends (22 Nov, K4).
// ---------------------------------------------------------------------------

export const allowedMediaPaths = new Set<string>()
/** Project file paths the user picked via dialogs; direct saves must match. */
export const knownProjectPaths = new Set<string>()

/** Mutable state that must belong to one editor window. Keeping any of these
 * process-global makes two projects interfere: one window's save dialog can
 * authorize the other's path, one export can replace the other's folder, and
 * closing either window can use the other project's dirty flag. */
export interface EditorWindowState {
  dirty: boolean
  forceClose: boolean
  batchExportDir: string | null
  chosenSavePaths: Set<string>
  pendingOpenPath: string | null
  currentProjectPath: string | null
  /** This window's own crash-recovery snapshot (written every few minutes;
   *  removed when the window closes cleanly). */
  recoveryPath: string | null
  /** A crash snapshot offered to this window and not answered yet. It is not
   *  this window's own: nothing writes over it or removes it until the user
   *  picks Recover (it becomes the own one) or Discard. Later, Esc, or closing
   *  the window lets go of it, so the next window or launch offers it again. */
  pendingRecoveryPath: string | null
  /** The editor page died (out of memory, a GPU fault): its last snapshot
   *  is the only copy of the unsaved work, so it is kept, not removed. */
  crashed: boolean
  /** Each project file as this window last read or wrote it (stampKey →
   *  stamp): a file another program wrote since is never saved over unasked. */
  diskStamps: Map<string, DiskStamp>
  /** A film folder this window was opened for (VideoHub's "Snipp'te aç") and
   *  the project file it is saved to, claimed once by the page. */
  pendingFilm: { folder: string; project: string } | null
  /** Code film folders this window was not allowed to run yet and waits for
   *  the user's answer about (security patch, item 6; film-trust.ts): path
   *  key → the folder, why it was met, and who waits for the answer. */
  trustAsks: Map<string, { folder: string; why: 'project' | 'launch'; waiting: ((run: boolean) => void)[] }>
}

export const editorWindows = new Map<number, EditorWindowState>()
export const claimedRecoveryPaths = new Set<string>()

/** The PC stays awake while any page holds it (an export, a transcription). */
export const awakeHolds = new AwakeHolds(
  () => powerSaveBlocker.start('prevent-app-suspension'),
  (id) => powerSaveBlocker.stop(id)
)
/** The pages whose going away already releases their holds. */
export const awakeWatched = new Set<number>()

export function newEditorWindowState(initialProjectPath: string | null = null): EditorWindowState {
  return {
    dirty: false,
    forceClose: false,
    batchExportDir: null,
    chosenSavePaths: new Set(),
    pendingOpenPath: initialProjectPath,
    currentProjectPath: initialProjectPath,
    recoveryPath: null,
    pendingRecoveryPath: null,
    crashed: false,
    diskStamps: new Map(),
    pendingFilm: null,
    trustAsks: new Map()
  }
}

/** Remembers the project file as it is on disk now (after this window read
 *  or wrote it). */
export async function rememberDiskStamp(state: EditorWindowState, p: string): Promise<void> {
  const stamp = await readDiskStamp(p)
  if (stamp) state.diskStamps.set(stampKey(p), stamp)
  else state.diskStamps.delete(stampKey(p))
}

export function editorState(contents: WebContents): EditorWindowState {
  let state = editorWindows.get(contents.id)
  if (!state) {
    state = newEditorWindowState()
    editorWindows.set(contents.id, state)
  }
  return state
}

export function ownerWindow(contents: WebContents): BrowserWindow | null {
  return BrowserWindow.fromWebContents(contents)
}

export function windowUsingProject(projectPath: string, exceptContentsId?: number): BrowserWindow | null {
  const key = foldKey(normalize(projectPath))
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.id === exceptContentsId) continue
    if (foldKey(editorWindows.get(win.webContents.id)?.currentProjectPath) === key) return win
  }
  return null
}

export const normalize = (p: string) => {
  if (!isLocalFilePath(p)) throw new Error('Only local drive paths are supported in offline mode')
  return path.normalize(p)
}

/** JSON.parse chokes on a byte-order mark, and every editor on Windows is
 *  happy to add one. A project file that opens everywhere else should open
 *  here, and "Project file is not valid JSON" is not a thing anyone can act
 *  on. */
export const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
export const parseJsonFile = (text: string): unknown => JSON.parse(stripBom(text))

export const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'
])
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'])
export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'])

export const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif'
}

export function pathToMediaUrl(p: string): string {
  return 'media://local/' + encodeURIComponent(normalize(p))
}

export function mediaUrlToPath(url: string): string | null {
  const prefix = 'media://local/'
  if (!url.startsWith(prefix)) return null
  try {
    return normalize(decodeURIComponent(url.slice(prefix.length).split('?')[0]))
  } catch {
    return null
  }
}

export const preloadPath = (): string => path.join(import.meta.dirname, '../preload/index.js')
export const loadPage = (win: BrowserWindow, hash: string): void => {
  if (devUrl) void win.loadURL(`${devUrl}/#${hash}`)
  else void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'), { hash })
}

/** Allowlists a path so the renderer may open it: choosing a file in Explorer
 *  is the same kind of consent as choosing one in the open dialog, and
 *  project:open-path only reads files it has been told about. */
export function allowProjectPath(p: string): string {
  const n = normalize(p)
  knownProjectPaths.add(n)
  return n
}

export function focusEditorWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
