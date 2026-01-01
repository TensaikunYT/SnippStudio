// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// IPC for a project's LUT files (SnippStudio "cila" part D): the text of a
// .cube file the project names by its path.
//
// A LUT is an asset of the project as a media file is (its path, and with
// each save the same file relative to the project file: project-media.ts
// withRelativePaths), but it is no media: media:// does not serve it and the
// media dialogs do not list it. This one handler reads it, found the way a
// media file is found (its own path, then beside the project file the window
// has open), and hands over nothing but a .cube table: the extension, a size
// limit and the table's own header are checked here.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isLocalFilePath } from '../security'
import { ipcMain, editorState, normalize } from '../state'
import { locateMedia } from '../project-media'

/** A 129³ table written out is about 60 MB; nothing larger is a LUT. */
const MAX_BYTES = 64 * 1024 * 1024
const isCube = (p: string): boolean => path.extname(p).toLowerCase() === '.cube'

export function registerLutIpc(): void {
  ipcMain.handle('lut:read', async (event, raw: unknown) => {
    const lut = raw as { path?: unknown; relPath?: unknown; size?: unknown } | null
    if (!lut || typeof lut !== 'object' || !isLocalFilePath(lut.path) || !isCube(normalize(lut.path))) return null
    const found = await locateMedia({ path: normalize(lut.path), relPath: lut.relPath, size: lut.size }, editorState(event.sender).currentProjectPath, { accept: isCube })
    if (!found || found.size > MAX_BYTES) return null
    const text = await fs.readFile(found.path, 'utf8').catch(() => null)
    if (text === null || !/^\s*LUT_3D_SIZE\s+\d+\s*$/m.test(text)) return null
    return { text, path: found.path, size: found.size, mtime: found.mtime, via: found.via }
  })
}
