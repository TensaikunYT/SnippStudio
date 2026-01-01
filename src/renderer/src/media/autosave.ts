// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One autosave of the project to its own file (App.tsx runs it on a timer;
// the e2e hook `__autosaveNow` runs it at once). Moved out of App.tsx in
// phase Ç2b (E2) so the tests can run it. The caller says what went wrong
// (an error thrown by `save`: the file changed on disk, a newer format, the
// backup copy failed).
import { useStore } from '../state/store'
import type { Project } from '../types'
import { rereadsSettled } from './reread-gate'

export interface AutosaveDeps {
  /** The user's switch (Settings: autosave). */
  enabled: () => boolean
  /** The project's own file, if it has one. */
  path: () => string | null
  /** Writes `project` to its file; true when written. */
  save: (project: Project) => Promise<boolean>
}

/** 'skipped': off, nothing unsaved or no file; 'saved': written and the
 *  project is saved; 'stale': written, but an edit came in meanwhile (the
 *  project stays unsaved); 'not-saved': `save` said no. */
export type AutosaveResult = 'skipped' | 'saved' | 'stale' | 'not-saved'

export async function autosaveOnce(deps: AutosaveDeps): Promise<AutosaveResult> {
  if (!deps.enabled() || !useStore.getState().dirty || !deps.path()) return 'skipped'
  // The media files an open is reading again first: written without them,
  // the re-read landing after the save made the project unsaved again at
  // once (phase Ç2b, E2).
  await rereadsSettled()
  const s = useStore.getState()
  if (!s.dirty || !deps.path()) return 'skipped'
  const seq = s.editSeq
  const saved = await deps.save(s.project)
  if (!saved) return 'not-saved'
  if (useStore.getState().editSeq !== seq) return 'stale'
  useStore.getState().setDirty(false)
  return 'saved'
}
