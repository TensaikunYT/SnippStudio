// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Back to here" for each step of the Agent tab's list (SnippStudio phase
// 4B.3, ANA-PLAN.md §3): undo is linear, so one step cannot be pulled out
// from the middle; instead the live project goes back to how it was right
// after that step — as ONE undo step (Ctrl+Z brings the rest back). The
// project as it was at the end of each tool call is kept by reference (the
// project is never changed in place), for the calls the list shows.
import type { Project } from '../types'
import { projectSession, useStore } from '../state/store'
import { carryMedia } from '../state/history'

const MAX = 500
const after = new Map<string, { project: Project; ps: number }>()

/** A tool call ended: the live project then is what "back to here" gives. */
export function recordStep(callId: string): void {
  after.set(callId, { project: useStore.getState().project, ps: projectSession() })
  while (after.size > MAX) after.delete(after.keys().next().value as string)
}

/** Can this step be gone back to (it ended in the project open now)? */
export const canGoBack = (callId: string): boolean => after.get(callId)?.ps === projectSession()

/** Puts the live project back to how it was right after this step: one
 *  undo step. False when the step is not of the project open now. */
export function backTo(callId: string): boolean {
  const s = after.get(callId)
  if (!s || s.ps !== projectSession()) return false
  const st = useStore.getState()
  if (st.project === s.project) return true
  // (Where the media lives now is the open project's: phase Ç2a.2, P4.)
  st.adoptCandidate(carryMedia(st.project, s.project), { baseVersion: st.projectVersion, epoch: st.versionEpoch })
  return true
}
