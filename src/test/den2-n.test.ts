// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try, worker N (DENEME-2-PLAN-N.md): a done note leaves no
// pin over the film, the N lane shows each status and hides the done notes
// unless the Notes tab's filter shows them, a merged mark shows its most
// pressing status, and the toolbar's "Note" key clashes with nothing.
import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingShown, isDone, laneNotes } from '../renderer/src/notes/model'
import { markStatus } from '../renderer/src/notes/nav'
import { defaultBindings } from '../renderer/src/shortcuts'
import { PRESETS, RESERVED_KEYS, bindingClashes, presetBindings } from '../renderer/src/shortcuts-presets'
import { STRINGS } from '../renderer/src/ui/strings'
import { NOTE_STATUSES, type NoteStatus } from '../renderer/src/types'

const note = (id: string, status: NoteStatus) => ({ id, status })

test('drawingShown: an open note\'s drawing shows, a done one\'s not, the one under review always', () => {
  for (const s of NOTE_STATUSES) assert.equal(drawingShown(note('a', s)), s !== 'approved', s)
  assert.equal(drawingShown(note('a', 'approved'), 'a'), true)
  assert.equal(drawingShown(note('a', 'approved'), 'b'), false)
  assert.equal(isDone(note('a', 'approved')), true)
  assert.equal(isDone(note('a', 'still')), false)
})

test('laneNotes: done notes only with "All", the note under review always', () => {
  const ns = [note('o', 'open'), note('g', 'agent'), note('r', 'ready'), note('a', 'approved'), note('s', 'still')]
  assert.deepEqual(laneNotes(ns, 'open').map((n) => n.id), ['o', 'g', 'r', 's'])
  assert.deepEqual(laneNotes(ns, 'ready').map((n) => n.id), ['o', 'g', 'r', 's'])
  assert.deepEqual(laneNotes(ns, 'all').map((n) => n.id), ['o', 'g', 'r', 'a', 's'])
  assert.deepEqual(laneNotes(ns, 'open', 'a').map((n) => n.id), ['o', 'g', 'r', 'a', 's'])
})

test('markStatus: one note its own; several the most pressing', () => {
  for (const s of NOTE_STATUSES) assert.equal(markStatus([note('x', s)]), s)
  assert.equal(markStatus([note('a', 'approved'), note('b', 'agent')]), 'agent')
  assert.equal(markStatus([note('a', 'agent'), note('b', 'open')]), 'open')
  assert.equal(markStatus([note('a', 'open'), note('b', 'ready'), note('c', 'approved')]), 'ready')
  assert.equal(markStatus([note('a', 'ready'), note('b', 'still')]), 'still')
  assert.equal(markStatus([]), 'approved')
})

test('the "Note" key: Shift+N, free in every set on every platform, its words in both languages', () => {
  const d = defaultBindings()
  assert.equal(d.pointNote, 'shift+n')
  assert.equal(d.newNote, 'n')
  assert.equal(RESERVED_KEYS.includes('shift+n'), false)
  for (const p of PRESETS) for (const os of ['win32', 'darwin', 'linux'] as const) assert.deepEqual(bindingClashes(presetBindings(p.id, os)), [], `${p.id} ${os}`)
  for (const k of ['pv.point', 'pv.point.label', 'pv.point.hint', 'keys.act.pointNote'] as const) {
    assert.ok(STRINGS[k].en && STRINGS[k].tr, k)
  }
})
