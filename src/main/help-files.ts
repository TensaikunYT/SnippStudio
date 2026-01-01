// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The files the Settings window's Help and About pages open (TERMINAL-YOK-
// PLAN.md): which file each key names, and the folder they sit in. Pure, no
// Electron (the tests load it alone); ipc/help-ipc.ts opens them.
import path from 'node:path'

export const HELP_FILES = ['guide', 'agents', 'license', 'notices', 'licenses'] as const
export type HelpFile = typeof HELP_FILES[number]

/** A file's place relative to the folder beside the program, by language. */
export function helpFileName(which: HelpFile, lang: 'en' | 'tr', packaged: boolean): string {
  switch (which) {
    case 'guide':
      return path.join('docs', lang === 'tr' ? 'kullanim.md' : 'guide.md')
    case 'agents':
      return path.join('docs', lang === 'tr' ? 'ajanlar.md' : 'agents.md')
    case 'license':
      return packaged ? 'LICENSE.txt' : 'LICENSE'
    case 'notices':
      return 'THIRD-PARTY-NOTICES.md'
    case 'licenses':
      return 'licenses'
  }
}

/** The folder the licence files and docs/ sit in: the repository in a source
 *  build; beside the program when packaged (macOS: the .app's Contents,
 *  electron-builder's extraFiles). */
export function besideProgram(packaged: boolean, execPath: string, appPath: string, platform: string = process.platform): string {
  if (!packaged) return appPath
  const dir = path.dirname(execPath)
  return platform === 'darwin' ? path.dirname(dir) : dir
}
