// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Crash containment, the parts that need no window: which window errors are
// real failures, and how often one may write a recovery snapshot. The error
// boundary (components/ErrorBoundary.tsx) and the window listeners (main.tsx)
// use these; they are kept here so a node test can check them.

/**
 * Window errors the browser raises that are not failures of the app. Chromium
 * reports a ResizeObserver whose callback changed the layout it observes as a
 * window error ("loop completed with undelivered notifications"); it is
 * harmless and can come many times a second, so it must not write snapshots.
 */
export function isBenignWindowError(message: string): boolean {
  return /ResizeObserver loop/i.test(message)
}

/**
 * A gate that lets one call through per `gapMs`: a burst of errors (several
 * panels failing on the same bad state, an error in a loop) writes one
 * snapshot, not one each.
 */
export function rateGate(gapMs: number): (now: number) => boolean {
  let last = -Infinity
  return (now: number): boolean => {
    if (now - last < gapMs) return false
    last = now
    return true
  }
}

/** The message of whatever was thrown, short enough for a panel's box. */
export function failureText(err: unknown, max = 160): string {
  const raw = err instanceof Error ? err.message || err.name : typeof err === 'string' ? err : String(err)
  const one = raw.replace(/\s+/g, ' ').trim() || 'Unknown error'
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}
