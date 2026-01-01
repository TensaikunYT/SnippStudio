// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The rules of a code film's drawing window (phase 5d.1, film-window.ts),
// without Electron: tested in Node (src/test/film-window.test.ts).

/** A drawing window's process may hold this much memory (working set); past
 *  it the window is let go and its clip marked failed (decision 3). */
export const PAGE_MEMORY_LIMIT_KB = 2 * 1024 * 1024

/** How often the windows' memory is looked at (a page can take a gigabyte
 *  in a second or two: the limit is where it is stopped, not a cap). */
export const PAGE_MEMORY_CHECK_MS = 2000

/** A frame asked of a drawing window that brought no picture carrying its
 *  number in this long is given up on (the ask fails, the page goes on). */
export const PAGE_FRAME_TIMEOUT_MS = 6000

/** While a frame is waited for and no picture comes, the page is asked for a
 *  new one this often (a changed pixel: invalidate() brings no texture). */
export const PAGE_NUDGE_MS = 250

/** May a drawing window's page ask for this address? Only its own film's
 *  folder (snippfilm://<id>/…), and what never leaves the page: data:, blob:,
 *  about:blank / about:srcdoc. Never media://, another film, the network,
 *  a file. */
export function pageMayAsk(url: string, id: string): boolean {
  if (!/^[a-f0-9]{16}$/.test(id)) return false
  if (/^(data|blob):/i.test(url)) return true
  if (/^about:(blank|srcdoc)(?:[?#]|$)/i.test(url)) return true
  const m = /^snippfilm:\/\/([^/?#]*)(?:[/?#]|$)/i.exec(url)
  return !!m && m[1].toLowerCase() === id
}

export function overMemory(workingSetKb: number, limitKb: number = PAGE_MEMORY_LIMIT_KB): boolean {
  return Number.isFinite(workingSetKb) && workingSetKb > limitKb
}

export interface PageWindowSize {
  /** The film's size in CSS pixels. */
  width: number
  height: number
  /** The window's output scale (device pixels per CSS pixel). */
  scale: number
  /** The marker row's height in CSS pixels: at least one device pixel. */
  row: number
  /** The marker row's height in device pixels. */
  rows: number
}

/** The size of a film's drawing window: the film's size clamped (64…7680 a
 *  side), the scale 0.25…2 (1 when not said), and a marker row at least one
 *  device pixel high under it. */
export function pageWindowSize(width: unknown, height: unknown, scale?: unknown): PageWindowSize {
  const side = (v: unknown, d: number): number => {
    const n = Math.round(+(v as number))
    return Number.isFinite(n) && n > 0 ? Math.max(64, Math.min(7680, n)) : d
  }
  const s0 = +(scale as number)
  const s = Number.isFinite(s0) && s0 > 0 ? Math.max(0.25, Math.min(2, s0)) : 1
  const row = Math.max(1, Math.ceil(1 / s - 1e-9))
  return { width: side(width, 1920), height: side(height, 1080), scale: s, row, rows: Math.max(1, Math.round(row * s)) }
}

/** The address a film's drawing window loads: the app's host page as the
 *  whole document, told it is one and how high its marker row is. */
export function pageWindowUrl(id: string, row: number): string {
  return `snippfilm://${id}/__snipp/host.html?win=1&row=${Math.max(1, Math.round(row))}`
}
