// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Small polish, worker cila3 (SnippStudio haritalar/_cila3-rapor.md): the
// watch mode's pin numbers and its Ctrl+Z / Ctrl+Y, the range band changed
// by hand, the band's several lines.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { addNote, nextNoteNum } from '../renderer/src/notes/model'
import { notePinLabels } from '../renderer/src/notes/shapes'
import { onlyNotesDiffer, watchTimeTravel } from '../renderer/src/components/watch/watch-undo'
import { dragBand } from '../renderer/src/components/agent/scope-drag'
import { noteOf } from '../renderer/src/agent/scope-band'
import type { NoteShape } from '../renderer/src/types'
import { talk } from './agent-kit'

const S = useStore.getState
const pin = (x: number): NoteShape => ({ type: 'pin', pts: [[x, 0.5]], color: '#ff4d4d' })
const box: NoteShape = { type: 'rect', pts: [[0, 0], [1, 1]], color: '#ff4d4d' }

test('the pin says the number the note gets in the list', () => {
  const p = talk(20)
  assert.equal(nextNoteNum(p), 1)
  for (let i = 0; i < 7; i++) addNote(p, { start: 19 - i, end: 19 - i, kind: 'fix', text: String(i) })
  assert.equal(nextNoteNum(p), 8)
  // A note deleted does not give its number back (as addNote counts).
  p.notes = p.notes!.filter((n) => n.num !== 7)
  assert.equal(nextNoteNum(p), 8)
  const n = addNote(p, { start: 0, end: 0, kind: 'fix', text: 'first in the list' })
  assert.equal(n.num, 8)
  assert.deepEqual(notePinLabels([pin(0.2)], 8), ['8'])
  assert.deepEqual(notePinLabels([box, pin(0.2), pin(0.4)], 12), [null, '12.1', '12.2'])
  assert.deepEqual(notePinLabels([box], 3), [null])
})

test('Ctrl+Z while watching: a note step is taken back and brought again; a film step waits for the editor', () => {
  S().loadProject(talk(20))
  S().editNotes((p) => void addNote(p, { start: 2, end: 2, kind: 'fix', text: 'a' }))
  assert.equal(S().project.notes?.length, 1)
  assert.equal(watchTimeTravel(S(), true), 'done')
  assert.equal(S().project.notes?.length ?? 0, 0)
  assert.equal(watchTimeTravel(S(), false), 'done')
  assert.equal(S().project.notes?.length, 1)
  S().setClipVolume('c1', 0.5)
  assert.equal(watchTimeTravel(S(), true), 'film', 'the film edit is not taken back')
  assert.equal(S().project.clips.c1.volume, 0.5)
  S().undo()
  assert.equal(watchTimeTravel(S(), false), 'film', 'nor brought again')
  assert.equal(watchTimeTravel(S(), true), 'done', 'under it, the note step')
  assert.equal(S().project.notes?.length ?? 0, 0)
  S().loadProject(talk(20))
  assert.equal(watchTimeTravel(S(), true), 'none')
})

test('only the notes differ: name, snapping or a clip are more than notes', () => {
  const a = talk(20)
  assert.ok(onlyNotesDiffer(a, { ...a, notes: [], noteSeq: 3 }))
  assert.ok(!onlyNotesDiffer(a, { ...a, name: 'Other' }))
  assert.ok(!onlyNotesDiffer(a, { ...a, clips: { ...a.clips, c1: { ...a.clips.c1, start: 1 } } }))
})

test('the band by hand: an edge snaps, never past the other; the body moves whole, snapping its nearer edge', () => {
  const snap = (t: number): number => (Math.abs(t - 5) < 0.2 ? 5 : Math.abs(t - 12) < 0.2 ? 12 : t)
  const base = { start: 2, end: 6, min: 0.1, snap }
  assert.deepEqual(dragBand({ ...base, grip: 'start', dt: 2.5 }), { start: 4.5, end: 6, guide: null })
  assert.deepEqual(dragBand({ ...base, grip: 'start', dt: 3.1 }), { start: 5, end: 6, guide: 5 })
  assert.equal(dragBand({ ...base, grip: 'start', dt: 9 }).start, 5.9, 'not past the end')
  assert.equal(dragBand({ ...base, grip: 'start', dt: -9 }).start, 0, 'not before 0')
  assert.deepEqual(dragBand({ ...base, grip: 'end', dt: 6.1 }), { start: 2, end: 12, guide: 12 })
  assert.equal(dragBand({ ...base, grip: 'end', dt: -9 }).end, 2.1, 'not before the start')
  assert.deepEqual(dragBand({ ...base, grip: 'move', dt: 1 }), { start: 3, end: 7, guide: null })
  assert.deepEqual(dragBand({ ...base, grip: 'move', dt: 2.9 }), { start: 5, end: 9, guide: 5 })
  assert.deepEqual(dragBand({ ...base, grip: 'move', dt: 6.1 }), { start: 8, end: 12, guide: 12 })
  assert.deepEqual(dragBand({ ...base, grip: 'move', dt: -5 }), { start: 0, end: 4, guide: null })
})

test('the band\'s words keep their lines', () => {
  assert.deepEqual(noteOf({ text: ' first  line \n\n second\n', chip: null }, (c) => c), { kind: 'fix', text: 'first line\nsecond' })
})
