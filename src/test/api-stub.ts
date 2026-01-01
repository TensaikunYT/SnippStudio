// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A stand-in for the main process's bridge (`window.api`, preload/index.ts)
// for tests of the renderer's file handling (phase Ç2a.2). Imported FIRST,
// before anything that reads `window.api` when it loads (platform.ts). Each
// test fills `bridge` with the calls it needs; a call nobody filled throws.
const bridge: Record<string, (...args: never[]) => unknown> = {}
const api = new Proxy(bridge, {
  get(target, key: string) {
    if (key in target) return target[key]
    if (key === 'then') return undefined
    return () => {
      throw new Error(`api.${key} is not stubbed in this test`)
    }
  }
})
const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { api, addEventListener: () => {}, removeEventListener: () => {}, setTimeout, clearTimeout }
  })
}
// What a stubbed call may answer with.
export type Bridge = Record<string, (...args: any[]) => unknown>
export const stubApi = (calls: Bridge): void => {
  for (const k of Object.keys(bridge)) delete bridge[k]
  Object.assign(bridge, calls)
}
