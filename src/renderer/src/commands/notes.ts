// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Work notes as commands (the rules live in notes/model.ts). A note's status
// is not an edit of the film: the store keeps it out of the undo history and
// out of the version count (FAZ1-PLAN.md K6, FAZ2A-PLAN.md K7).
import type { NoteShape } from '../types'
import { NOTE_KINDS, NOTE_STATUSES } from '../types'
import { addNote as addNoteTo, deleteNote as deleteNoteFrom, findNote, setNoteStatus as setStatusOf, updateNote as updateNoteOf } from '../notes/model'
import { CommandError, defineCommand } from './core'
import { requireFreshId } from './require'
import { s } from './schema'

export const addNote = defineCommand({
  name: 'note.add',
  summary: 'Write a work note on a stretch of the timeline. Returns its id.',
  params: s.object({
    start: s.time(),
    end: s.time(),
    kind: s.enum(NOTE_KINDS),
    text: s.string({ max: 2000 }),
    at: s.optional(s.time()),
    shapes: s.optional(s.array(s.object_any('A NoteShape'))),
    prefer: s.optional(s.array(s.id(), { description: 'Clips to prefer as the one it is about' })),
    only: s.optional(s.object({ clips: s.optional(s.array(s.id(), { max: 200 })) })),
    id: s.optional(s.id('An id for the new note'))
  }),
  check(p, { id }) {
    requireFreshId(p, id, 'note.add')
  },
  apply(p, a, env): string {
    const note = addNoteTo(p, { start: a.start, end: a.end, kind: a.kind, text: a.text, at: a.at, shapes: (a.shapes ?? []) as unknown as NoteShape[], prefer: a.prefer, ...(a.only ? { only: a.only } : {}) }, env.now())
    if (a.id) note.id = a.id
    return note.id
  }
})

export const updateNote = defineCommand({
  name: 'note.update',
  summary: 'Change what a note says, its kind, or where it is.',
  params: s.object({ id: s.id(), patch: s.object({ start: s.optional(s.time()), end: s.optional(s.time()), kind: s.optional(s.enum(NOTE_KINDS)), text: s.optional(s.string({ max: 2000 })) }) }),
  apply(p, { id, patch }): void {
    if (!updateNoteOf(p, id, patch)) throw new CommandError('note.update', `there is no note ${id}`)
  }
})

export const setNoteStatus = defineCommand({
  name: 'note.setStatus',
  summary: 'Set where a note stands (open, agent, ready, approved, still), with a reply and the ranges the work touched.',
  params: s.object({
    id: s.id(),
    status: s.enum(NOTE_STATUSES),
    reply: s.optional(s.string({ max: 2000 })),
    touched: s.optional(s.array(s.range(), { max: 50 }))
  }),
  apply(p, { id, status, reply, touched }): void {
    if (!setStatusOf(p, id, status, { reply, touched })) throw new CommandError('note.setStatus', `there is no note ${id}`)
  }
})

export const deleteNote = defineCommand({
  name: 'note.delete',
  summary: 'Remove a work note from the list.',
  params: s.object({ id: s.id() }),
  apply(p, { id }): void {
    if (!findNote(p, id)) throw new CommandError('note.delete', `there is no note ${id}`)
    deleteNoteFrom(p, id)
  }
})
