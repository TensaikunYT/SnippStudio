// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a slice of the store's actions is made with (state/store.ts spreads the
// slices into useStore): zustand's set and get, and the store's own `mutate`
// (the one way an edit reaches the project: copy-on-write, undo step, version).
// SnippStudio phase 2B.
import type { StateCreator } from 'zustand'
import type { Project } from '../../types'
import type { EditorState } from '../editor-state'

export type SetState = Parameters<StateCreator<EditorState>>[0]
export type GetState = Parameters<StateCreator<EditorState>>[1]
/** `snapshot` (phase Ç2a.1, report D2): with no window open every change is
 *  an undo step, whatever it says. `false`: join the open window (a drag, a
 *  slider) if there is one. `'outside'`: not part of the undo history at all
 *  (a row's height, the snapping, a note's status, where a media file lives):
 *  join an open window, else no step and the redo stack is kept. */
export type Mutate = (
  fn: (p: Project) => void,
  snapshot?: boolean | 'outside',
  mergeKey?: string,
  /** `media`: only where a media file lives or what was read from it
   *  changed (a relink, a file read again: phase Ç2a.2) — no edit, so the
   *  model check does not take it for one (its clips may now run past a
   *  shorter file's end: the user is told). */
  /** `fixed`: tracks a whole-timeline cut left as they are (a kept music
   *  bed: çekirdek cila S), for the version log like the locked ones. */
  meta?: { cuts?: [number, number][][]; next?: Project; media?: boolean; fixed?: readonly string[] }
) => void
