// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A minimal DOM for tests whose imports touch `document` or `localStorage` at
// load time (playback/render.ts makes a scratch canvas when it loads).
// Imported FIRST, so it is in place before those modules load.
const g = globalThis as unknown as Record<string, unknown>
if (typeof g.document === 'undefined') {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
  })
}
if (typeof g.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
}
export {}
