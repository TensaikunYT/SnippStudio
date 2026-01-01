// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The first start's settings copy in the running app (phase 9a, decision 3;
// the rules are profile-inherit.ts). index.ts calls inheritOnFirstStart as soon
// as the profile folder is known; the first editor window asks once whether
// anything was copied (profile:inherited) and says so in one notice.
import { INHERIT_FROM } from '../shared/product'
import { inheritProfile, type InheritResult } from './profile-inherit'
import { ipcMain } from './state'

let result: InheritResult | null = null
let told = false

export function inheritOnFirstStart(profile: string, appData: string): void {
  try {
    result = inheritProfile(profile, appData, INHERIT_FROM)
  } catch (err) {
    // A start must never fail over a settings copy.
    console.error('[profile] the first-start copy failed:', String(err))
    result = null
  }
}

/** The answer is the same for every window, and only the first one that asks
 *  gets it (null afterwards, and when nothing was copied). */
export function registerProfileIpc(): void {
  ipcMain.handle('profile:inherited', () => {
    if (told || !result) return null
    told = true
    return { from: result.from, copied: [...result.copied] }
  })
}
