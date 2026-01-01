// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Writing a transcription's lines into the project (SnippStudio phase 4A.10,
// E3, safety#6): never into a drag the user is in the middle of. Through a
// plain change the lines rode on the drag's undo step: the agent's notice
// "Undo" then took the user's drag back too, and the user's Ctrl+Z of the
// drag took the lines. Now the lines wait for the drag to end and are
// written as an undo step of their own.
import type { Caption } from '../types'
import { dragInProgress, projectSession, useStore } from '../state/store'

/** How long the lines wait for a drag at most (a pointer-up that never
 *  came): then they are written anyway, still as a step of their own. */
export const DRAG_WAIT_MS = 30_000

/**
 * Writes the lines `make` gives (made when the drag is over, from the
 * project as it is then) as one undo step; `hooks` are told right before
 * and after. False when another project was opened meanwhile (nothing is
 * written).
 */
export async function writeLinesOwnStep(make: () => Caption[], hooks: { beforeWrite?: () => void; afterWrite?: () => void } = {}, poll = 50, maxWait = DRAG_WAIT_MS): Promise<Caption[] | null> {
  const session = projectSession()
  const t0 = Date.now()
  while (dragInProgress() && Date.now() - t0 < maxWait) await new Promise((r) => setTimeout(r, poll))
  if (projectSession() !== session) return null
  const captions = make()
  hooks.beforeWrite?.()
  const st = useStore.getState()
  st.undoable(() => useStore.getState().setSubtitles(captions))
  hooks.afterWrite?.()
  return captions
}
