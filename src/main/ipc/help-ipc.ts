// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Settings window's Help and About pages (TERMINAL-YOK-PLAN.md): the
// program's version, and the files that sit beside the program — the guide
// and the agents' guide (docs/, in the window's language), the licence, the
// third-party notices and the licence texts — opened with the system's own
// program. Only these fixed files: the page names one by its key, never a path.
import { app, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { besideProgram, helpFileName, HELP_FILES, type HelpFile } from '../help-files'
import { ipcMain } from '../state'
import { CHANNEL } from '../channel'

export function registerHelpIpc(): void {
  ipcMain.handle('help:info', () => ({ version: app.getVersion(), channel: CHANNEL }))
  ipcMain.handle('help:open', async (_e, which: unknown, lang: unknown) => {
    if (!(HELP_FILES as readonly unknown[]).includes(which)) return { ok: false, path: '' }
    const file = path.join(besideProgram(app.isPackaged, process.execPath, app.getAppPath()), helpFileName(which as HelpFile, lang === 'tr' ? 'tr' : 'en', app.isPackaged))
    if (!existsSync(file)) return { ok: false, path: file }
    return { ok: (await shell.openPath(file)) === '', path: file }
  })
}
