// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ctrl+Z / Ctrl+Y in the watch mode (cila3, 1b): they take back and redo the
// steps that only changed the work notes (a note added, deleted, its words);
// a step that changed anything else (the film, its name, the snapping) waits
// for the editor, where it can be seen. Pure: src/test/cila3.test.ts.
import type { Project } from '../../types'
import { sameValue } from '../../history/equal'
import { carryMedia, carryView, restoreSnapshot, type HistoryEntry } from '../../state/history'

const NOTES = new Set(['notes', 'noteSeq'])

/** Whether `b` differs from `a` in nothing but its notes. */
export function onlyNotesDiffer(a: Project, b: Project): boolean {
  if (a === b) return true
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (NOTES.has(k)) continue
    const x = (a as unknown as Record<string, unknown>)[k]
    const y = (b as unknown as Record<string, unknown>)[k]
    if (x !== y && !sameValue(x, y)) return false
  }
  return true
}

/** Whether going from `now` to the history step `entry` (as undo and redo
 *  restore it) changes only the notes. */
export function notesOnlyStep(now: Project, entry: HistoryEntry | undefined): boolean {
  if (!entry) return false
  return onlyNotesDiffer(now, carryMedia(now, carryView(now, restoreSnapshot(entry))))
}

export type WatchUndo = 'done' | 'film' | 'none'

/** What Ctrl+Z (or Ctrl+Y) does while watching: the step when it is a note
 *  step, else nothing ('film': the editor has it; 'none': nothing to do). */
export function watchTimeTravel(s: { project: Project; past: HistoryEntry[]; future: HistoryEntry[]; undo: () => void; redo: () => void }, back: boolean): WatchUndo {
  const list = back ? s.past : s.future
  const entry = list[list.length - 1]
  if (!entry) return 'none'
  if (!notesOnlyStep(s.project, entry)) return 'film'
  if (back) s.undo()
  else s.redo()
  return 'done'
}
