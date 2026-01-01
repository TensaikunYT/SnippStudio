// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Bringing a row into view inside ITS panel (22 November, L1). The browser's
// own scrollIntoView scrolls every scrollable ancestor up to the window: with
// anything taller than the window in the document, the whole app slid up and
// stayed there (the top bar out of reach). Here only the element's nearest
// scrolling panel moves, by its own scrollTop.

export type RevealBlock = 'start' | 'nearest' | 'center'

/** Where a panel's scrollTop goes so the row shows (pure: the numbers are the
 *  boxes' tops against the window and their heights). `nearest` moves only as
 *  far as needed, and not at all when the row already shows whole. */
export function revealScrollTop(block: RevealBlock, at: { scrollTop: number; viewTop: number; viewHeight: number; rowTop: number; rowHeight: number }, margin = 0): number {
  const top = at.rowTop - at.viewTop
  if (block === 'start') return at.scrollTop + top - margin
  if (block === 'center') return at.scrollTop + top - (at.viewHeight - at.rowHeight) / 2
  if (top < margin) return at.scrollTop + top - margin
  const over = top + at.rowHeight - (at.viewHeight - margin)
  // (A row taller than the panel: its top wins.)
  return over > 0 ? at.scrollTop + Math.min(over, top - margin) : at.scrollTop
}

/** The nearest ancestor that scrolls up and down (null: none; never the window). */
export function scrollerOf(el: Element): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

/** Scrolls the element's own panel (and nothing else) so it shows. */
export function revealIn(el: Element | null | undefined, block: RevealBlock = 'nearest', opts: { smooth?: boolean; margin?: number } = {}): void {
  if (!el) return
  const panel = scrollerOf(el)
  if (!panel) return
  const view = panel.getBoundingClientRect()
  const row = el.getBoundingClientRect()
  const top = revealScrollTop(block, { scrollTop: panel.scrollTop, viewTop: view.top + panel.clientTop, viewHeight: panel.clientHeight, rowTop: row.top, rowHeight: row.height }, opts.margin ?? 0)
  const to = Math.max(0, Math.min(panel.scrollHeight - panel.clientHeight, top))
  if (Math.abs(to - panel.scrollTop) < 0.5) return
  if (opts.smooth) panel.scrollTo({ top: to, behavior: 'smooth' })
  else panel.scrollTop = to
}
