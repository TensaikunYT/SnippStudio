// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Whether the heavy parts are made ahead (see prerender.ts): on unless you
// turned it off, remembered on this machine.

const KEY = 'snipp-prerender'
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
})()

export const prerenderOn = (): boolean => on
export function setPrerenderOn(v: boolean): void {
  on = v
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off')
  } catch {
    /* a convenience */
  }
}
