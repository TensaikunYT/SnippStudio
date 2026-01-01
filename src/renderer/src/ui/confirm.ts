// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The app's one question box for "are you sure?" (audit G9): drawn by the
// building blocks' Dialog in the app's look and language, where the page's
// own window.confirm / alert drew a white system slab in English. Ask with
// confirmDialog(); it answers with a promise (true: the main button). The box
// itself is drawn by ConfirmHost (components/app/dialogs.tsx), mounted once in
// the editor; this module holds only the queue, so it stays free of React.
//
// A test window (--e2e) answers it the way it answers the page's own confirm
// (main/e2e-hooks.ts: window.__e2eConfirm, listed in window.__e2eDialogs),
// unless a scenario asks to see the box (window.__e2eShowConfirms = true).

import type { IconName } from './Icon'

export interface ConfirmOptions {
  title: string
  message: string
  /** The main button's words ("Delete", "Open"). */
  confirm: string
  /** The other button's words; null: a notice with one button. */
  cancel?: string | null
  /** The main button deletes or loses something. */
  danger?: boolean
  icon?: IconName
  /** A line under the message (a path, a reassurance). */
  note?: string
}

export interface PendingConfirm {
  id: number
  options: ConfirmOptions
}

let seq = 0
let queue: (PendingConfirm & { resolve: (yes: boolean) => void })[] = []
const listeners = new Set<() => void>()
const tell = (): void => {
  for (const fn of [...listeners]) fn()
}

interface TestWindow {
  __e2eConfirm?: (message: string) => unknown
  __e2eShowConfirms?: boolean
}

/** Asks; resolves true when the main button is pressed, false otherwise
 *  (the other button, Escape, the close button, a press outside). */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const w = globalThis as unknown as TestWindow
  if (typeof w.__e2eConfirm === 'function' && !w.__e2eShowConfirms) {
    return Promise.resolve(!!w.__e2eConfirm(`${options.title}\n${options.message}`))
  }
  return new Promise((resolve) => {
    queue = [...queue, { id: ++seq, options, resolve }]
    tell()
  })
}

/** The question shown now (the first asked), or null. */
export const currentConfirm = (): PendingConfirm | null => queue[0] ?? null

/** The answer to a question (the host calls it). */
export function answerConfirm(id: number, yes: boolean): void {
  const q = queue.find((x) => x.id === id)
  if (!q) return
  queue = queue.filter((x) => x.id !== id)
  q.resolve(yes)
  tell()
}

export function subscribeConfirm(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
