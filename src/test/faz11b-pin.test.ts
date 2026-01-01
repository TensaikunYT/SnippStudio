// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, the user's request (tarifler/FAZ11B-EK.md): one click points at a
// place on the frame with a numbered pin (1, 2, 3 … in the note's order,
// counted when drawn, renumbered when one is rubbed out); a click with any
// drawing tool is a pin; the agent reads the pins and sees them numbered on
// the note's frame. No circle (the user did not want one).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLICK_SLOP, bbox, hit, paintShapes, pinNumbers, shapeOfStroke, worthKeeping, type PaintContext } from '../renderer/src/notes/shapes'
import { addNote, sanitizeNotes } from '../renderer/src/notes/model'
import { notesText } from '../renderer/src/notes/agent'
import { parseProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type NoteShape, type Project } from '../renderer/src/types'

const pin = (x: number, y: number, color = '#ff4d4d'): NoteShape => ({ type: 'pin', pts: [[x, y]], color })
const box: NoteShape = { type: 'rect', pts: [[0.1, 0.1], [0.3, 0.3]], color: '#ffffff' }

function recorder(): PaintContext & { texts: string[] } {
  const texts: string[] = []
  const noop = (): void => undefined
  return {
    texts,
    save: noop,
    restore: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    rect: noop,
    stroke: noop,
    closePath: noop,
    arc: noop,
    fill: noop,
    fillText: (t: string) => void texts.push(t),
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: ''
  }
}

test('pin: numbered by its place among the note\'s pins; rubbing one out renumbers the rest', () => {
  const shapes = [pin(0.2, 0.3), box, pin(0.5, 0.5), pin(0.8, 0.6)]
  assert.deepEqual(pinNumbers(shapes), [1, null, 2, 3])
  const c = recorder()
  paintShapes(c, shapes, 1920, 1080)
  assert.deepEqual(c.texts, ['1', '2', '3'])
  // The second pin rubbed out (as the eraser picks it): the third is 2 now.
  const i = hit(shapes, [0.5, 0.5])
  assert.equal(i, 2)
  const left = shapes.filter((_, k) => k !== i)
  assert.deepEqual(pinNumbers(left), [1, null, 2])
  const c2 = recorder()
  paintShapes(c2, left, 1920, 1080)
  assert.deepEqual(c2.texts, ['1', '2'])
})

test('pin: picked by its point or its head above it; kept; its head is inside the drawing\'s box', () => {
  const shapes = [pin(0.5, 0.5)]
  assert.equal(hit(shapes, [0.5, 0.5]), 0)
  assert.equal(hit(shapes, [0.5, 0.46]), 0, 'the head')
  assert.equal(hit(shapes, [0.7, 0.7]), -1)
  assert.equal(worthKeeping(pin(0.5, 0.5)), true)
  const [, y0, , y1] = bbox(shapes)
  assert.ok(y0 < 0.5 && y1 === 0.5)
})

test('pin: a press that hardly moved is a pin whatever the tool; a real drag is the tool\'s shape', () => {
  for (const type of ['rect', 'arrow', 'pen', 'pin'] as const) {
    const pressed: NoteShape = { type, pts: [[0.4, 0.6], [0.4005, 0.6]], color: '#5aa9ff' }
    assert.deepEqual(shapeOfStroke(pressed, CLICK_SLOP - 1), { type: 'pin', pts: [[0.4, 0.6]], color: '#5aa9ff' }, type)
  }
  const dragged: NoteShape = { type: 'rect', pts: [[0.1, 0.1], [0.4, 0.5]], color: '#5aa9ff' }
  assert.deepEqual(shapeOfStroke(dragged, 40), dragged)
  assert.equal(shapeOfStroke({ type: 'pen', pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]], color: '#fff' }, 40).type, 'pen')
  assert.equal(shapeOfStroke({ type: 'pin', pts: [[0.1, 0.1]], color: '#fff' }, 40).type, 'pin', 'the pin tool dragged is still a pin')
})

function noted(): Project {
  const p = defaultProject()
  p.name = 'Pins'
  addNote(p, { start: 2, end: 2, kind: 'fix', text: 'these two', at: 2, shapes: [pin(0.42, 0.31), box, pin(0.7, 0.555)] }, new Date('2026-11-20T20:00:00Z'))
  return p
}

test('pin: the agent reads each pin with its number and place', () => {
  const lines = notesText(noted(), null, 'open').split('\n')
  assert.ok(lines.includes('   drawn on the frame at 2.00 s: notes {"image": 1}'), lines.join('\n'))
  assert.ok(lines.includes('   pin 1 at (0.42, 0.31), pin 2 at (0.70, 0.56) (x, y of the frame, 0..1 from the top left)'), lines.join('\n'))
})

test('pin: saved and opened as it was; a file\'s pin without a point is dropped, older files unchanged', () => {
  const p = noted()
  const back = parseProjectFile(serializeProject(p))
  assert.deepEqual(back.notes?.[0].shapes, p.notes?.[0].shapes)
  // A damaged pin: no point goes, extra points are cut to the one.
  const raw = structuredClone(p)
  raw.notes![0].shapes = [{ type: 'pin', pts: [], color: '#ff4d4d' }, { type: 'pin', pts: [[0.1, 0.2], [0.9, 0.9]], color: '#ff4d4d' }] as NoteShape[]
  sanitizeNotes(raw, new Date('2026-11-20T20:00:00Z'))
  assert.deepEqual(raw.notes![0].shapes, [{ type: 'pin', pts: [[0.1, 0.2]], color: '#ff4d4d' }])
  // A file of before 11b (box, arrow, pen) reads as it did.
  const old = structuredClone(p)
  old.notes![0].shapes = [box, { type: 'arrow', pts: [[0.1, 0.1], [0.2, 0.2]], color: '#ffffff' }, { type: 'pen', pts: [[0.5, 0.5]], color: '#ffffff' }]
  const oldBack = parseProjectFile(serializeProject(old))
  assert.deepEqual(oldBack.notes?.[0].shapes, old.notes![0].shapes)
})

test('pin: a note drawn with pins is one undo step and goes back as it was', () => {
  const S = useStore.getState
  S().loadProject(defaultProject())
  S().setTime(3)
  S().startNoteDraft()
  S().patchNoteDraft({ shapes: [pin(0.3, 0.3), pin(0.6, 0.6)], at: 3 })
  const before = S().project.notes?.length ?? 0
  const id = S().saveNoteDraft()
  assert.ok(id)
  assert.deepEqual(pinNumbers(S().project.notes!.find((n) => n.id === id)!.shapes!), [1, 2])
  S().undo()
  assert.equal(S().project.notes?.length ?? 0, before)
  S().redo()
  assert.deepEqual(S().project.notes!.find((n) => n.id === id)!.shapes!.map((s) => s.type), ['pin', 'pin'])
})
