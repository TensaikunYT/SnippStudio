// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The crash-recovery snapshot's life (SnippStudio phase Ç2a.2, decision 5;
// report P3, P17). It used to be written every three minutes while there were
// unsaved changes, only for a project with clips, and never removed by a save
// or an open: a snapshot older than the saved file, or of a project the user
// had discarded, was offered after a crash as "your unsaved work".
//
// Now: written 10 s after the last change while the project is unsaved (and
// at the latest every 60 s during a long run of changes), whatever the project
// holds; and this window's own snapshot is removed when there is nothing
// unsaved any more — the project was saved, another one was opened or a new
// one started (the store's `dirty` going false). A snapshot only OFFERED
// (another window's, a crashed page's) is never touched here (main:
// recovery:clear-own).
import type { Project } from '../types'

export const RECOVERY_QUIET_MS = 10_000
export const RECOVERY_MAX_WAIT_MS = 60_000

interface StoreLike {
  getState(): { dirty: boolean; editSeq: number; project: Project }
  subscribe(fn: (s: { dirty: boolean; editSeq: number; project: Project }, prev: { dirty: boolean; editSeq: number; project: Project }) => void): () => void
}

export interface RecoveryWriterDeps {
  store: StoreLike
  write: (p: Project) => void | Promise<void>
  clear: () => void | Promise<void>
  /** Off: the user turned autosave off. */
  enabled: () => boolean
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

/** Starts the writer; returns its stop. */
export function startRecoveryWriter(d: RecoveryWriterDeps): () => void {
  const now = d.now ?? (() => Date.now())
  const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  /** When the first change not yet in a snapshot was made (0: none). */
  let firstPending = 0
  const cancel = (): void => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }
  const fire = (): void => {
    timer = null
    firstPending = 0
    const s = d.store.getState()
    if (!s.dirty || !d.enabled()) return
    void d.write(s.project)
  }
  const schedule = (): void => {
    const t = now()
    if (firstPending === 0) firstPending = t
    cancel()
    const wait = Math.max(0, Math.min(RECOVERY_QUIET_MS, firstPending + RECOVERY_MAX_WAIT_MS - t))
    timer = setTimer(fire, wait)
  }
  const stop = d.store.subscribe((s, prev) => {
    if (!s.dirty) {
      cancel()
      firstPending = 0
      // Nothing unsaved any more: this window's own snapshot goes.
      if (prev.dirty) void d.clear()
      return
    }
    if (s.editSeq !== prev.editSeq || !prev.dirty) schedule()
  })
  return () => {
    cancel()
    stop()
  }
}
