// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for the derived analysis (waveform peaks, film strips) and the cache.
// Moved out of registerIpc (src/main/index.ts) in SnippStudio phase 2B;
// registerIpc calls it where these stood.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { ipcMain } from '../state'
import { bundledModelDir } from '../models-ipc'
import { userDataSiblings, analysisFileFor, pruneAnalysis, dirSize } from '../project-files'

export function registerAnalysisIpc(): void {
  // ---- Analysis cache -----------------------------------------------------
  // Waveform peaks and filmstrips are expensive to derive but deterministic for
  // a given file, so they're kept on disk. The key includes size and mtime, so
  // an edited or replaced file simply misses and is re-analysed.
  const analysisKey = analysisFileFor

  ipcMain.handle('analysis:get', async (_e, mediaPath: string, kind: string) => {
    const file = await analysisKey(mediaPath, kind)
    if (!file) return null
    const buf = await fs.readFile(file).catch(() => null)
    return buf ? new Uint8Array(buf) : null
  })

  ipcMain.handle('analysis:put', async (_e, mediaPath: string, kind: string, data: Uint8Array) => {
    const file = await analysisKey(mediaPath, kind)
    if (!file || !(data instanceof Uint8Array) || data.byteLength > 256 * 1024 * 1024) return false
    try {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, Buffer.from(data))
      void pruneAnalysis()
      return true
    } catch {
      return false
    }
  })

  // ---- Cache size / clear -------------------------------------------------
  // Reclaimable = the redundant per-user copies of the ~2 GB Whisper model
  // (bundled with the app, so these are duplicates) and the derived-analysis
  // folder. Both this app-name folder AND the legacy one are counted. The
  // IndexedDB folder is NOT: it also holds the user's imported fonts
  // ('autocut-fonts') and LUTs ('autocut-luts'), whose only copy it is, and
  // the renderer clears just the model store in it (recents.ts clearCache).
  ipcMain.handle('cache:size', async () => {
    let bytes = 0
    for (const dir of userDataSiblings()) {
      bytes += await dirSize(path.join(dir, 'whisper-models'))
      bytes += await dirSize(path.join(dir, 'analysis'))
    }
    return { bytes }
  })

  ipcMain.handle('cache:clear', async () => {
    let freed = 0
    // Never touch the bundled model in resources — only the redundant userData
    // copies. Guard: only delete if the bundled set looks present.
    const bundledOk = (await fs.readdir(bundledModelDir()).catch(() => [])).length > 0
    for (const dir of userDataSiblings()) {
      if (bundledOk) {
        const wm = path.join(dir, 'whisper-models')
        freed += await dirSize(wm)
        await fs.rm(wm, { recursive: true, force: true }).catch(() => {})
      }
      // Derived data: re-created on demand the next time a clip is opened.
      const an = path.join(dir, 'analysis')
      freed += await dirSize(an)
      await fs.rm(an, { recursive: true, force: true }).catch(() => {})
    }
    // No clearStorageData here: wiping the session's IndexedDB took the
    // user's imported fonts and LUTs with it (captions then drew in another
    // font, LUT clips without their look, with no word). The renderer deletes
    // only the model store ('autocut-model-cache').
    return { freed }
  })
}
