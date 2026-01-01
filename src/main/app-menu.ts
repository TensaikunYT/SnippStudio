// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The application menu and the window's own keys, per platform (SnippStudio
// phase 10a, step 3; haritalar\cekirdek-platform.md W1, W4, W5). Pure: no
// Electron objects, only the template Electron's Menu.buildFromTemplate takes.
//
// Windows and Linux: no application menu (null), as before: Electron's default
// one reloaded the editor on Ctrl+R past the unsaved-changes check, zoomed the
// whole interface and closed the window on Ctrl+W. Copy, paste and undo in
// text fields work without it there.
// macOS: those keys reach text fields only through Edit menu items with
// roles, and an app without an app menu has no Quit (Cmd+Q). So a small menu:
// the app menu, Edit's roles, and Window; still no reload, force reload, zoom
// or developer tools items.

export interface MenuItem {
  role?: string
  label?: string
  type?: 'separator'
  submenu?: MenuItem[]
}

/** The roles never put in the menu (the reason the other platforms have none). */
export const FORBIDDEN_ROLES = ['reload', 'forceReload', 'zoomIn', 'zoomOut', 'resetZoom', 'toggleDevTools'] as const

export function menuTemplate(platform: NodeJS.Platform, appName: string): MenuItem[] | null {
  if (platform !== 'darwin') return null
  const sep: MenuItem = { type: 'separator' }
  return [
    { label: appName, submenu: [{ role: 'about' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }] },
    { role: 'editMenu', label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }] },
    { role: 'windowMenu', label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, sep, { role: 'front' }, sep, { role: 'close' }] }
  ]
}

/** Every role a template holds (for the tests). */
export function rolesOf(items: MenuItem[] | null): string[] {
  const out: string[] = []
  const walk = (list: MenuItem[]): void => {
    for (const i of list) {
      if (i.role) out.push(i.role)
      if (i.submenu) walk(i.submenu)
    }
  }
  if (items) walk(items)
  return out
}

export interface KeyInput {
  type: string
  key: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  isAutoRepeat: boolean
}

/** What a key in the editor window does by itself: the developer tools (F12,
 *  Ctrl+Shift+I; on macOS also Cmd+Opt+I), full screen (F11; on macOS also
 *  Ctrl+Cmd+F), or nothing. Windows' answers are the code it replaced. */
export function windowKey(input: KeyInput, platform: NodeJS.Platform): 'devtools' | 'fullscreen' | null {
  if (input.type !== 'keyDown') return null
  const k = input.key.toLowerCase()
  if (input.key === 'F12' || (input.control && input.shift && k === 'i')) return 'devtools'
  if (platform === 'darwin' && input.meta && input.alt && k === 'i') return 'devtools'
  if (input.key === 'F11' && !input.control && !input.shift && !input.alt && !input.isAutoRepeat) return 'fullscreen'
  if (platform === 'darwin' && input.control && input.meta && k === 'f' && !input.isAutoRepeat) return 'fullscreen'
  return null
}

/** A render worker (a hidden second copy of the app drawing part of an
 *  export) shows no Dock icon on macOS. */
export const hideFromDock = (platform: NodeJS.Platform, isRenderWorker: boolean): boolean => platform === 'darwin' && isRenderWorker
