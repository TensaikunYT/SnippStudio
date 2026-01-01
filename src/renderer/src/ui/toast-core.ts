// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The toasts' state and notify() without React (phase Ç2b.1): the store
// tells the user things (a locked track left out of a cut) and the store is
// loaded in Node tests that have no DOM; <ToastStack /> (Toasts.tsx) shows it.
import { toastTimeout, toastsAfter, type ToastAction, type ToastEvent, type ToastItem } from './logic'

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<() => void>()
function emit(e: ToastEvent): void {
  items = toastsAfter(items, e)
  for (const fn of [...listeners]) fn()
}
export const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const snapshot = (): ToastItem[] => items

export interface NotifyOptions {
  /** Already in words (t()). */
  text: string
  kind?: 'info' | 'error'
  action?: ToastAction
  /** Milliseconds; 0 keeps it until closed. Default 5 s, 8 s with an action or an error. */
  timeout?: number
}

/** Shows a toast; returns its id (for dismissToast). */
export function notify(o: NotifyOptions): number {
  const id = ++seq
  emit({ type: 'push', toast: { id, text: o.text, kind: o.kind ?? 'info', action: o.action, timeout: o.timeout ?? toastTimeout(o) } })
  return id
}
export const dismissToast = (id: number): void => emit({ type: 'dismiss', id })
export const clearToasts = (): void => emit({ type: 'clear' })
/** The toasts now (for tests). */
export const currentToasts = (): readonly ToastItem[] => items

