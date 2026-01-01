// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A candidate project (SnippStudio phase 2A.4): a project other than the
// store's that the preview can show and play — picture and sound — while the
// store's project, its undo history and its version stay exactly as they are.
// Phase 4's drafts play through this ("before / after", live). No interface
// yet: `window.__candidate` (main.tsx) is the hook to try it.
import type { Project } from '../types'

export type Showing = 'live' | 'candidate'
/** Before and after at once (ONIZLEME-UYGULA-PLAN.md, K8): side by side, a
 *  wipe (before left of the line, after right of it), or their difference. */
export type CompareMode = 'off' | 'side' | 'wipe' | 'diff'

export interface CandidateState {
  project: Project | null
  showing: Showing
  /** Where it was computed from: the live project's version, the version
   *  log's epoch and the store's project session (store.projectSession()).
   *  adoptCandidate needs the first two; the store clears the candidate
   *  when another project is opened or a new one started. */
  baseVersion?: number
  epoch?: string
  session?: number
  /** Comparing (only with the candidate shown); the wipe's line, 0–1 of the frame. */
  compare?: CompareMode
  wipe?: number
}

export interface CandidateOrigin {
  baseVersion?: number
  epoch?: string
  session?: number
  show?: boolean
}

let state: CandidateState = { project: null, showing: 'live' }
const listeners = new Set<(s: CandidateState) => void>()

function put(next: CandidateState): void {
  if (next.project === state.project && next.showing === state.showing && next.baseVersion === state.baseVersion && next.compare === state.compare && next.wipe === state.wipe) return
  state = next
  for (const fn of listeners) fn(state)
}

export const candidate = {
  get: (): CandidateState => state,
  /** Sets (or replaces) the candidate with where it came from; `show`
   *  switches the preview to it. */
  set(project: Project, origin: boolean | CandidateOrigin = false): void {
    const o: CandidateOrigin = typeof origin === 'boolean' ? { show: origin } : origin
    put({ project, showing: o.show ? 'candidate' : state.showing, baseVersion: o.baseVersion, epoch: o.epoch, session: o.session, compare: state.compare, wipe: state.wipe })
  },
  /** Which one the preview shows. There is nothing to show without a candidate.
   *  Showing one of them alone ends a comparison. */
  show(showing: Showing): void {
    if (showing === 'candidate' && !state.project) return
    put({ ...state, showing, compare: 'off' })
  },
  /** Before and after at once: the candidate is shown (it plays, with its
   *  sound) and the live project is drawn beside, under or against it. */
  compare(mode: CompareMode): void {
    if (mode !== 'off' && !state.project) return
    put({ ...state, showing: mode === 'off' ? state.showing : 'candidate', compare: mode })
  },
  /** The wipe's line, 0 (all after) to 1 (all before). */
  setWipe(at: number): void {
    put({ ...state, wipe: Math.min(1, Math.max(0, Number.isFinite(at) ? at : 0.5)) })
  },
  /** Drops the candidate; the preview shows the live project again. */
  clear(): void {
    put({ project: null, showing: 'live', wipe: state.wipe })
  },
  subscribe(fn: (s: CandidateState) => void): () => void {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  }
}

/** Whether the preview is showing a candidate now. */
export const showingCandidate = (): boolean => state.showing === 'candidate' && !!state.project

/** The project the preview draws and plays: the candidate when it is shown,
 *  the store's otherwise. */
export function shownProject(live: Project): Project {
  return state.showing === 'candidate' && state.project ? state.project : live
}

/** The comparison on screen now ('off' unless a candidate is shown). */
export const compareMode = (): CompareMode => (state.showing === 'candidate' && state.project ? state.compare ?? 'off' : 'off')

/** The wipe's line (0.5 until it is dragged). */
export const wipeAt = (): number => state.wipe ?? 0.5
