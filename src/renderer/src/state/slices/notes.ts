// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's work notes (the draft, its drawing, the review), markers and
// template blocks. Moved out of state/store.ts in SnippStudio phase 2B
// (no change).
import { setNoteImage as putNoteImage } from '../../notes/model'
import { addMarker, deleteMarker, updateMarker } from '../../commands/markers'
import { placeTemplate } from '../../commands/templates'
import { addNote } from '../../commands/notes'
import { noteImages } from '../history'
import { env } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type NoteActions = Pick<EditorState, 
  | 'selectNote'
  | 'startNoteDraft'
  | 'patchNoteDraft'
  | 'cancelNoteDraft'
  | 'saveNoteDraft'
  | 'setNoteTool'
  | 'setNoteColor'
  | 'editNotes'
  | 'setNoteImage'
  | 'setNoteReview'
  | 'addMarkerAtPlayhead'
  | 'updateMarker'
  | 'deleteMarker'
  | 'editTemplates'
  | 'insertTemplate'
>

export function noteActions(set: SetState, get: GetState, mutate: Mutate): NoteActions {
  return {
    selectNote: (noteSel) => set({ noteSel }),
    startNoteDraft: (range) => {
      const s = get()
      const a = Math.max(0, range ? Math.min(range.start, range.end) : s.currentTime)
      const b = Math.max(a, range ? Math.max(range.start, range.end) : s.currentTime)
      if (s.noteDraft) {
        // One note is written at a time: marking again moves its range (its
        // text and its drawing stay).
        set({ noteDraft: { ...s.noteDraft, start: a, end: b } })
        return
      }
      set({ noteDraft: { start: a, end: b, kind: 'fix', text: '', shapes: [] }, noteSel: null, noteReview: null })
    },
    patchNoteDraft: (patch) => set((s) => (s.noteDraft ? { noteDraft: { ...s.noteDraft, ...patch } } : s)),
    cancelNoteDraft: () => set({ noteDraft: null, noteTool: null }),
    saveNoteDraft: () => {
      const s = get()
      const d = s.noteDraft
      if (!d || (!d.text.trim() && d.shapes.length === 0)) return null
      let id: string | null = null
      mutate((p) => {
        id = addNote.apply(p, { start: d.start, end: d.end, kind: d.kind, text: d.text, at: d.at, shapes: d.shapes as unknown as Record<string, unknown>[], prefer: s.selectedClipIds }, env())
      })
      set({ noteDraft: null, noteTool: null, noteSel: id })
      return id
    },
    setNoteTool: (noteTool) => set({ noteTool }),
    setNoteColor: (noteColor) => set({ noteColor }),
    // (A note change with commit off — a status, an agent taking a note —
    // is no undo step; inside a drag it joins the drag's.)
    editNotes: (fn, commit = true, mergeKey) => mutate(fn, commit ? true : 'outside', mergeKey),
    setNoteImage: (id, image) => {
      noteImages.set(id, image)
      // Derived from the frame, not an edit: no undo step of its own.
      mutate((p) => putNoteImage(p, id, image), 'outside')
    },
    setNoteReview: (noteReview) => set({ noteReview }),

    addMarkerAtPlayhead: () => mutate((p) => void addMarker.apply(p, { time: get().currentTime }, env())),

    updateMarker: (id, patch) =>
      mutate((p) => updateMarker.apply(p, { id, patch }, env()), true, `marker:${id}:${Object.keys(patch).join(',')}`),

    deleteMarker: (id) => mutate((p) => deleteMarker.apply(p, { id }, env())),
    editTemplates: (fn, commit = true, mergeKey) => mutate(fn, commit, mergeKey),
    insertTemplate: (kind) => {
      let id = ''
      mutate((p) => {
        id = placeTemplate.apply(p, { kind, time: get().currentTime }, env())
      })
      return id
    }
  }
}
