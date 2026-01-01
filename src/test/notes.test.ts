// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 1: work notes. The model (numbers, statuses, the tie to
// a clip), how notes ride along with edits, what goes into the project file,
// and what an agent reads and writes of them.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type NoteShape, type Project, type WorkNote } from '../renderer/src/types'
import {
  addNote,
  anchorFor,
  clearNotes,
  clipUnder,
  deleteNote,
  filterNotes,
  isNoteImage,
  noteByNum,
  noteClock,
  noteContext,
  noteSpan,
  notesToSend,
  parseClock,
  reviewLoop,
  reviewQueue,
  reviewRanges,
  sanitizeNotes,
  sendMessage,
  setNoteImage,
  setNoteStatus,
  shownAt,
  updateNote
} from '../renderer/src/notes/model'
import { followNotes, shiftNotesForCut, shiftNotesForInsert } from '../renderer/src/notes/follow'
import { arrowHead, bbox, closeUp, hit, paintShapes, strokeWidth, thin, worthKeeping, type PaintContext } from '../renderer/src/notes/shapes'
import { parseProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { notesFilter, notesText, pickNotes, planNoteUpdate, spokenIn, updateText } from '../renderer/src/notes/agent'
import { AGENT_TOOLS, SERVER_INSTRUCTIONS } from '../main/agent-protocol'
import { decideReview, endReview, goToNote, markNote, newNote, removeNote, replayReview, startReview, stepReview } from '../renderer/src/notes/review'
import { useStore } from '../renderer/src/state/store'
import { PRODUCT_NAME } from '../shared/product'

const near = (a: number, b: number, msg?: string): void => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`)
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD'

/**
 * V2 (top): a still "logo" 20–30.
 * V1: a talking video "talk" 0–40 (source from 5 s), then a code film "film"
 *     40–100 (source from 0).
 * A1: the voice "voice" 0–40.
 */
function project(): Project {
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  const v2 = { id: 'v2', kind: 'video' as const, name: 'V2', clipIds: [] as string[] }
  p.tracks.unshift(v2)
  p.assets.push(
    { id: 'a-talk', kind: 'video', name: 'talk.mp4', url: '', size: 1, duration: 300, width: 1920, height: 1080, hasAudio: false },
    { id: 'a-film', kind: 'code', name: 'demo', path: 'C:\\films\\demo', url: '', size: 0, duration: 120, width: 1920, height: 1080, hasAudio: false, code: { fps: 60 } },
    { id: 'a-logo', kind: 'image', name: 'logo.png', url: '', size: 1, duration: 0, width: 400, height: 400, hasAudio: false },
    { id: 'a-voice', kind: 'audio', name: 'voice.wav', url: '', size: 1, duration: 300, width: 0, height: 0, hasAudio: true }
  )
  const clip = (id: string, assetId: string, trackId: string, start: number, duration: number, inPoint = 0): Clip => ({
    id, assetId, trackId, start, duration, inPoint, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 }
  })
  p.clips.talk = clip('talk', 'a-talk', v1.id, 0, 40, 5)
  p.clips.film = clip('film', 'a-film', v1.id, 40, 60, 0)
  p.clips.logo = clip('logo', 'a-logo', v2.id, 20, 10)
  p.clips.voice = clip('voice', 'a-voice', a1.id, 0, 40)
  v1.clipIds = ['talk', 'film']
  v2.clipIds = ['logo']
  a1.clipIds = ['voice']
  return p
}

const note = (p: Project, num: number): WorkNote => noteByNum(p, num)!

// --- the model ---------------------------------------------------------------

test('a note gets the next number, and a deleted note\'s number is never reused', () => {
  const p = project()
  const a = addNote(p, { start: 3, end: 6, kind: 'fix', text: '  the title is cut off  ' })
  const b = addNote(p, { start: 1, end: 1, kind: 'cut', text: 'second' })
  assert.deepEqual([a.num, b.num], [1, 2])
  assert.equal(a.text, 'the title is cut off')
  assert.equal(a.status, 'open')
  // In timeline order on the list.
  assert.deepEqual(p.notes!.map((n) => n.num), [2, 1])
  deleteNote(p, b.id)
  const c = addNote(p, { start: 9, end: 8, kind: 'animate', text: 'third' })
  assert.equal(c.num, 3)
  // A range given backwards is put in order.
  assert.deepEqual([c.start, c.end], [8, 9])
  deleteNote(p, a.id)
  deleteNote(p, c.id)
  assert.equal(p.notes, undefined)
  assert.equal(addNote(p, { start: 0, end: 0, kind: 'free', text: 'x' }).num, 4)
})

test('a note is tied to the clip under it, by that clip\'s own clock', () => {
  const p = project()
  // Over the talking video alone: its source runs from 5 s.
  const a = addNote(p, { start: 10, end: 12, kind: 'fix', text: 'a' })
  assert.deepEqual(a.clip, { id: 'talk', assetId: 'a-talk', from: 15, to: 17 })
  // Under the logo: the topmost picture is what the user is looking at.
  assert.equal(clipUnder(p, 25)!.id, 'logo')
  // A code clip is preferred over what lies on top of it, and the selection
  // over everything.
  p.clips.logo.start = 45
  assert.equal(clipUnder(p, 50)!.id, 'film')
  assert.equal(clipUnder(p, 50, ['logo'])!.id, 'logo')
  // Over sound only, then over nothing.
  delete p.clips.talk
  p.tracks.find((t) => t.name === 'V1')!.clipIds = ['film']
  assert.equal(clipUnder(p, 10)!.id, 'voice')
  assert.equal(clipUnder(p, 200), undefined)
  assert.equal(anchorFor(p, 200, 210), undefined)
  // A hidden track and a switched-off clip are not what is on screen.
  p.tracks.find((t) => t.id === 'v2')!.hidden = true
  p.clips.film.disabled = true
  assert.equal(clipUnder(p, 50), undefined)
})

test('editing a note: its text and kind, and a move that ties it again', () => {
  const p = project()
  const n = addNote(p, { start: 10, end: 12, kind: 'fix', text: 'a', at: 11, shapes: [{ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.5]], color: '#ff4d4d' }] })
  assert.equal(n.at, 11)
  updateNote(p, n.id, { text: 'b', kind: 'animate' })
  assert.deepEqual([note(p, 1).text, note(p, 1).kind], ['b', 'animate'])
  updateNote(p, n.id, { start: 50, end: 53 })
  const m = note(p, 1)
  assert.deepEqual([m.start, m.end, m.at], [50, 53, 51])
  assert.deepEqual(m.clip, { id: 'film', assetId: 'a-film', from: 10, to: 13 })
  // Off every clip: no tie.
  updateNote(p, n.id, { start: 300, end: 301 })
  assert.equal(note(p, 1).clip, undefined)
  assert.equal(updateNote(p, 'nope', { text: 'x' }), undefined)
})

test('a drawing is kept as clean shapes; a note without one has no frame of its own', () => {
  const p = project()
  const plain = addNote(p, { start: 1, end: 1, kind: 'free', text: 'x', at: 1, shapes: [] })
  assert.equal(plain.shapes, undefined)
  assert.equal(plain.at, undefined)
  const drawn = addNote(p, {
    start: 2, end: 2, kind: 'fix', text: '',
    shapes: [
      { type: 'pen', pts: [[0.1, 0.2], [0.2, 0.3], [5, -1]], color: 'red' },
      { type: 'arrow', pts: [[0, 0], [0.5, 0.5], [1, 1]], color: '#3ee089' },
      { type: 'rect', pts: [[0.5, 0.5]], color: '#ffffff' },
      { type: 'blob', pts: [[0, 0], [1, 1]], color: '#ffffff' } as never
    ]
  })
  assert.equal(drawn.shapes!.length, 2)
  // Out-of-frame points are brought in, an unknown colour becomes the first.
  assert.deepEqual(drawn.shapes![0], { type: 'pen', pts: [[0.1, 0.2], [0.2, 0.3], [1, 0]], color: '#ff4d4d' })
  // An arrow is its two ends.
  assert.deepEqual(drawn.shapes![1].pts, [[0, 0], [1, 1]])
  assert.equal(drawn.at, 2)
  // Its picture goes on once, and only a picture.
  setNoteImage(p, drawn.id, 'javascript:alert(1)')
  assert.equal(note(p, drawn.num).regionImage, undefined)
  setNoteImage(p, plain.id, JPEG)
  assert.equal(note(p, plain.num).regionImage, undefined)
  setNoteImage(p, drawn.id, JPEG)
  assert.equal(note(p, drawn.num).regionImage, JPEG)
  assert.equal(isNoteImage('data:image/svg+xml;base64,AAAA'), false)
  assert.equal(isNoteImage('data:image/png;base64,iVBORw0KGgo'), true)
})

test('statuses: what is sent, what is reviewed, what the lists show', () => {
  const p = project()
  for (let i = 0; i < 5; i++) addNote(p, { start: i * 10, end: i * 10 + 2, kind: 'fix', text: `n${i + 1}` })
  setNoteStatus(p, note(p, 2).id, 'agent')
  setNoteStatus(p, note(p, 3).id, 'ready', { reply: '  moved the title up  ', touched: [[31, 30], [22, 24], [NaN, 2] as [number, number]] })
  setNoteStatus(p, note(p, 4).id, 'approved')
  setNoteStatus(p, note(p, 5).id, 'still')
  assert.deepEqual(notesToSend(p).map((n) => n.num), [1, 5])
  assert.equal(note(p, 3).reply, 'moved the title up')
  // The agent's ranges: put in order, a broken one dropped.
  assert.deepEqual(note(p, 3).touched, [[22, 24], [30, 31]])
  assert.deepEqual(filterNotes(p.notes!, 'open').map((n) => n.num), [1, 2, 5])
  assert.deepEqual(filterNotes(p.notes!, 'ready').map((n) => n.num), [3])
  assert.equal(filterNotes(p.notes!, 'all').length, 5)
  assert.deepEqual(reviewQueue(p).map((n) => n.num), [3])
  // Without ranges from the agent, the note's own stretch is what changed.
  assert.deepEqual(reviewRanges(note(p, 1)), [[0, 2]])
  assert.deepEqual(reviewLoop(note(p, 3), 100), [20.5, 32.5])
  // At the timeline's edges the loop stays inside it.
  assert.deepEqual(reviewLoop(note(p, 1), 100), [0, 3.5])
  assert.deepEqual(reviewLoop({ ...note(p, 1), start: 99, end: 100 }, 100), [97.5, 100])
  // An empty answer takes the old one away; an unknown status changes nothing.
  setNoteStatus(p, note(p, 3).id, 'nonsense' as never, { reply: ' ', touched: [] })
  assert.deepEqual([note(p, 3).status, note(p, 3).reply, note(p, 3).touched], ['ready', undefined, undefined])
  assert.equal(clearNotes(p, 'approved'), 1)
  assert.equal(p.notes!.length, 4)
  assert.equal(setNoteStatus(p, 'nope', 'ready'), undefined)
})

test('a note on a code clip names the film folder and the film\'s own time', () => {
  const p = project()
  const n = addNote(p, { start: 43.5, end: 47, kind: 'animate', text: 'a chart here' })
  const ctx = noteContext(p, n)
  assert.equal(ctx.code, true)
  assert.equal(ctx.folder, 'C:\\films\\demo')
  near(ctx.from!, 3.5)
  near(ctx.to!, 7)
  // On ordinary footage: the source time, no folder.
  const t = noteContext(p, addNote(p, { start: 10, end: 12, kind: 'fix', text: 'x' }))
  assert.deepEqual([t.code, t.folder, t.from, t.to], [false, undefined, 15, 17])
  // A note that runs past its clip reports the clip's own end.
  near(noteContext(p, addNote(p, { start: 95, end: 110, kind: 'fix', text: 'x' })).to!, 60)
  // Sped up, frozen, reversed: what the clip really shows.
  p.clips.film.speed = 2
  near(shownAt(p.clips.film, 45), 10)
  p.clips.film.speed = 1
  p.clips.film.reversed = true
  near(shownAt(p.clips.film, 45), 55)
  p.clips.film.freeze = 12
  near(shownAt(p.clips.film, 45), 12)
  // Its clip gone: nothing to name.
  delete p.clips.film
  assert.deepEqual(noteContext(p, n), { code: false })
})

test('times as a person reads them, and the message for the agent', () => {
  assert.equal(noteClock(0), '0:00.0')
  assert.equal(noteClock(754.34), '12:34.3')
  assert.equal(noteClock(59.96), '1:00.0')
  assert.equal(noteSpan({ start: 12.4, end: 15 }), '0:12.4–0:15.0')
  assert.equal(noteSpan({ start: 12.4, end: 12.4 }), '0:12.4')
  const p = project()
  p.name = 'Demo'
  addNote(p, { start: 5, end: 6, kind: 'fix', text: 'a' })
  addNote(p, { start: 1, end: 2, kind: 'cut', text: 'b' })
  setNoteStatus(p, addNote(p, { start: 8, end: 9, kind: 'cut', text: 'c' }).id, 'approved')
  const msg = sendMessage(p, 'C:\\v\\demo.snipp', 'snipp-dev')
  assert.ok(msg.startsWith(`${PRODUCT_NAME}: 2 work notes waiting in "Demo" (#2, #1).\n`), msg)
  assert.match(msg, /Project file: C:\\v\\demo\.snipp/)
  // How to answer is said once, in the notes tool's description (phase 4A).
  assert.match(msg, /Use the snipp-dev notes tool\.$/)
  assert.match(sendMessage(project(), null, 'snipp'), /0 work notes .*\nProject file: not saved yet/)
})

test('notes read from a file are repaired or dropped, never trusted', () => {
  const p = project() as Project & { notes?: unknown }
  p.noteSeq = 7
  p.notes = [
    { id: 'a', num: 2, start: 9, end: 4, kind: 'cut', text: 'ok', status: 'ready', reply: 'done', touched: [[5, 4], 'x'], created: '2026-11-13T10:00:00.000Z', clip: { id: 'talk', assetId: 'a-talk', from: 9, to: 14 } },
    { id: 'a', num: 2, start: 1, end: 1, kind: 'dance', text: 12, status: 'done', created: 'yesterday', clip: { id: 5 } },
    { num: 'x', start: 3, kind: 'fix', text: 'drawn', status: 'open', shapes: [{ type: 'rect', pts: [[0, 0], [2, 2]], color: '#ffffff' }], regionImage: 'data:text/html;base64,AAAA' },
    { id: 'b', start: 'soon', kind: 'fix', text: 'no time' },
    null,
    'note'
  ] as never
  sanitizeNotes(p, new Date('2026-11-13T12:00:00.000Z'))
  const notes = p.notes as WorkNote[]
  assert.equal(notes.length, 3)
  const [second, third, first] = notes
  // In order, the range the right way round, the agent's ranges cleaned.
  assert.deepEqual([first.start, first.end, first.kind, first.status, first.reply], [4, 9, 'cut', 'ready', 'done'])
  assert.deepEqual(first.touched, [[4, 5]])
  assert.deepEqual(first.clip, { id: 'talk', assetId: 'a-talk', from: 9, to: 14 })
  // A repeated id and number get new ones; unknown kind and status fall back.
  assert.notEqual(second.id, 'a')
  assert.equal(second.num, 8)
  assert.deepEqual([second.kind, second.status, second.text, second.clip, second.created], ['free', 'open', '', undefined, '2026-11-13T12:00:00.000Z'])
  // A picture that is not a picture is dropped; the drawing stays, inside the frame.
  assert.equal(third.num, 9)
  assert.equal(third.regionImage, undefined)
  assert.deepEqual(third.shapes, [{ type: 'rect', pts: [[0, 0], [1, 1]], color: '#ffffff' }])
  assert.equal(third.at, 3)
  assert.equal(p.noteSeq, 9)
  // Not a list at all: gone. No notes: nothing is added.
  const q = project() as Project & { notes?: unknown }
  q.notes = 'many' as never
  sanitizeNotes(q)
  assert.equal('notes' in q, false)
  const old = project()
  sanitizeNotes(old)
  assert.equal('notes' in old, false)
  assert.equal('noteSeq' in old, false)
})

// --- riding along with edits (pure) -------------------------------------------

test('a cut out of the whole timeline moves the notes; one inside it becomes a frame at the join', () => {
  const p = project()
  for (const [a, b] of [[2, 4], [9, 12], [13, 14], [15, 18], [30, 32]] as [number, number][]) addNote(p, { start: a, end: b, kind: 'cut', text: 'x' })
  note(p, 2).at = 11
  note(p, 2).shapes = [{ type: 'rect', pts: [[0, 0], [1, 1]], color: '#ffffff' }]
  note(p, 5).touched = [[11, 13], [29, 31]]
  const before = note(p, 1)
  shiftNotesForCut(p, 10, 16)
  // Before the cut: untouched (the very same object).
  assert.equal(note(p, 1), before)
  // Running into it: ends at the join; its drawing's frame went with the cut.
  assert.deepEqual([note(p, 2).start, note(p, 2).end, note(p, 2).at], [9, 10, 10])
  // Inside it: not lost, one frame at the join.
  assert.deepEqual([note(p, 3).start, note(p, 3).end], [10, 10])
  // Running out of it, and after it.
  assert.deepEqual([note(p, 4).start, note(p, 4).end], [10, 12])
  assert.deepEqual([note(p, 5).start, note(p, 5).end], [24, 26])
  assert.deepEqual(note(p, 5).touched, [[10, 10], [23, 25]])
  // Nothing to cut, no notes: nothing happens.
  shiftNotesForCut(p, 5, 5)
  shiftNotesForCut(project(), 1, 2)
})

test('time put in moves what is after it and stretches a note that runs through it', () => {
  const p = project()
  for (const [a, b] of [[2, 4], [7, 9], [8, 8], [12, 13]] as [number, number][]) addNote(p, { start: a, end: b, kind: 'fix', text: 'x' })
  shiftNotesForInsert(p, 8, 2)
  assert.deepEqual(p.notes!.map((n) => [n.num, n.start, n.end]), [[1, 2, 4], [2, 7, 11], [3, 10, 10], [4, 14, 15]])
})

test('followNotes: nothing changed means nothing touched, and a note moved by hand is tied again', () => {
  const prev = project()
  addNote(prev, { start: 10, end: 12, kind: 'fix', text: 'a' })
  const next = structuredClone(prev)
  followNotes(prev, next)
  assert.deepEqual(next.notes, prev.notes)
  // Dragged along the N lane onto the code clip.
  next.notes![0].start = 50
  next.notes![0].end = 52
  followNotes(prev, next)
  assert.deepEqual(next.notes![0].clip, { id: 'film', assetId: 'a-film', from: 10, to: 12 })
})

// --- riding along with edits (through the store) -------------------------------

function load(...ranges: [number, number][]): void {
  const p = project()
  for (const [a, b] of ranges) addNote(p, { start: a, end: b, kind: 'fix', text: `${a}` })
  useStore.getState().loadProject(p)
}
const now = (): Project => useStore.getState().project
const span = (num: number): [number, number] => [note(now(), num).start, note(now(), num).end]

test('the agent\'s cut moves every note, keeps the one it cut as a frame, and undo brings them back', () => {
  load([2, 4], [12, 14], [45, 48])
  useStore.getState().rippleDeleteMany([[10, 16], [20, 22]])
  assert.deepEqual(span(1), [2, 4])
  assert.deepEqual(span(2), [10, 10])
  assert.deepEqual(span(3), [37, 40])
  // Still on the film, at the same second of it.
  assert.deepEqual(note(now(), 3).clip, { id: 'film', assetId: 'a-film', from: 5, to: 8 })
  // The cut note sits on the talking video's far side of the cut (a new clip).
  const at10 = note(now(), 2).clip!
  assert.equal(at10.assetId, 'a-talk')
  near(at10.from, 21)
  useStore.getState().undo()
  assert.deepEqual([span(1), span(2), span(3)], [[2, 4], [12, 14], [45, 48]])
  useStore.getState().redo()
  assert.deepEqual(span(3), [37, 40])
})

test('a note goes with its clip when the clip is moved, and stays put when another clip is', () => {
  load([45, 48], [10, 12])
  useStore.getState().moveClip('film', 60)
  assert.deepEqual(span(1), [65, 68])
  assert.deepEqual(span(2), [10, 12])
  assert.deepEqual(note(now(), 1).clip, { id: 'film', assetId: 'a-film', from: 5, to: 8 })
  useStore.getState().undo()
  assert.deepEqual(span(1), [45, 48])
})

test('a split sends a note to the piece its picture is on', () => {
  load([45, 48], [70, 75], [58, 62])
  useStore.getState().splitClipAt('film', 60)
  // A split alone moves nothing.
  assert.deepEqual([span(1), span(2), span(3)], [[45, 48], [70, 75], [58, 62]])
  const right = Object.values(now().clips).find((c) => c.assetId === 'a-film' && c.id !== 'film')!
  useStore.getState().moveClip(right.id, 80)
  // The left piece's note stays, the right piece's goes with it.
  assert.deepEqual(span(1), [45, 48])
  assert.deepEqual(span(2), [90, 95])
  assert.equal(note(now(), 2).clip!.id, right.id)
  // One that ran across the cut belongs to the piece it starts on, and keeps
  // its length.
  assert.deepEqual(span(3), [58, 62])
  assert.equal(note(now(), 3).clip!.id, 'film')
})

test('a trim: a note keeps its picture, and one whose picture was trimmed away shrinks to the edge', () => {
  load([41, 43], [50, 52], [43, 47])
  // The film's head trimmed by 5 s (its start moves with its edge).
  useStore.getState().setClipHead('film', 45, { start: 40, duration: 60, inPoint: 0 })
  assert.equal(now().clips.film.start, 45)
  assert.deepEqual(span(2), [50, 52])
  // Wholly inside what was trimmed: one frame at the clip's new start.
  assert.deepEqual(span(1), [45, 45])
  // Half inside: what is left of it.
  assert.deepEqual(span(3), [45, 47])
  // The tail trimmed away under a note.
  load([95, 99])
  useStore.getState().trimClipEnd('film', -10)
  assert.deepEqual(span(1), [90, 90])
})

test('a speed change keeps a note on the same picture', () => {
  load([50, 56])
  useStore.getState().setClipSpeed('film', 2)
  // Film seconds 10–16 are now shown from 45 to 48.
  assert.deepEqual(span(1), [45, 48])
  assert.deepEqual(note(now(), 1).clip, { id: 'film', assetId: 'a-film', from: 10, to: 16 })
})

test('deleting a note\'s clip leaves the note where it was, on whatever is there now', () => {
  load([45, 48], [10, 12])
  useStore.getState().deleteClip('film', false)
  assert.deepEqual(span(1), [45, 48])
  assert.equal(note(now(), 1).clip, undefined)
  // Its clip deleted with ripple: the notes of the clips that slid up go along.
  // (Alt, its own track: with the voice and the logo under it a plain ripple
  // delete leaves the gap, Ç2b patch item 3.)
  load([45, 48])
  useStore.getState().deleteClips(['talk'], true, true)
  assert.equal(now().clips.film.start, 0)
  assert.deepEqual(span(1), [5, 8])
})

test('a freeze frame pushes later notes on', () => {
  load([45, 48], [10, 12], [3, 4])
  useStore.setState({ currentTime: 8, selectedClipIds: ['talk'] })
  useStore.getState().insertFreezeFrame(2)
  assert.deepEqual(span(3), [3, 4])
  assert.deepEqual(span(2), [12, 14])
  assert.deepEqual(span(1), [47, 50])
})

// --- the store's own note actions ----------------------------------------------

test('writing a note: a draft, saved as one undo step; an empty draft is not a note', () => {
  load()
  const S = useStore
  S.setState({ currentTime: 44 })
  S.getState().startNoteDraft()
  assert.deepEqual(S.getState().noteDraft, { start: 44, end: 44, kind: 'fix', text: '', shapes: [] })
  // Nothing written, nothing drawn.
  assert.equal(S.getState().saveNoteDraft(), null)
  assert.equal(now().notes, undefined)
  S.getState().patchNoteDraft({ text: 'bigger title', kind: 'animate' })
  // Marking a range while writing moves the draft, and keeps what was written.
  S.getState().startNoteDraft({ start: 48, end: 42 })
  assert.deepEqual([S.getState().noteDraft!.start, S.getState().noteDraft!.end, S.getState().noteDraft!.text], [42, 48, 'bigger title'])
  const undoSteps = S.getState().past.length
  const id = S.getState().saveNoteDraft()!
  assert.equal(S.getState().noteDraft, null)
  assert.equal(S.getState().noteSel, id)
  assert.equal(S.getState().past.length, undoSteps + 1)
  assert.deepEqual([note(now(), 1).kind, note(now(), 1).clip!.id, S.getState().dirty], ['animate', 'film', true])
  // A status and an answer are not undo steps.
  S.getState().editNotes((p) => void setNoteStatus(p, id, 'ready', { reply: 'done' }), false)
  assert.equal(S.getState().past.length, undoSteps + 1)
  assert.equal(note(now(), 1).status, 'ready')
  S.getState().undo()
  assert.equal(now().notes, undefined)
  assert.equal(S.getState().noteSel, null)
  S.getState().redo()
  assert.equal(note(now(), 1).text, 'bigger title')
  S.getState().startNoteDraft()
  S.getState().cancelNoteDraft()
  assert.equal(S.getState().noteDraft, null)
})

test('a note\'s frame picture is not copied into every undo step, and comes back with the note', () => {
  load()
  const S = useStore
  S.getState().startNoteDraft({ start: 44, end: 44 })
  S.getState().patchNoteDraft({ at: 44, shapes: [{ type: 'arrow', pts: [[0.2, 0.2], [0.6, 0.6]], color: '#ffb02e' }] })
  const id = S.getState().saveNoteDraft()!
  const steps = S.getState().past.length
  S.getState().setNoteImage(id, JPEG)
  // The picture is drawn from the frame: not an edit of its own.
  assert.equal(S.getState().past.length, steps)
  assert.equal(note(now(), 1).regionImage, JPEG)
  const before = now()
  S.getState().moveClip('film', 50)
  // (Phase Ç2a.1: a step is the project itself, by reference, so nothing is
  // copied into it: the step kept is the very project before the move.)
  assert.equal(S.getState().past[S.getState().past.length - 1], before)
  S.getState().undo()
  assert.equal(note(now(), 1).regionImage, JPEG)
  // Undone out of existence and back.
  S.getState().undo()
  assert.equal(now().notes, undefined)
  S.getState().redo()
  assert.equal(note(now(), 1).regionImage, JPEG)
})

// --- the project file -----------------------------------------------------------

test('a project without notes is written as before; one with notes comes back the same', () => {
  const old = project()
  const text = serializeProject(old)
  assert.equal(text.includes('"notes"'), false)
  assert.equal(text.includes('noteSeq'), false)
  const back = parseProjectFile(text)
  assert.equal('notes' in back, false)

  const p = project()
  const a = addNote(p, { start: 10, end: 12, kind: 'fix', text: 'the title is cut off', at: 11, shapes: [{ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.5]], color: '#ff4d4d' }] })
  setNoteImage(p, a.id, JPEG)
  setNoteStatus(p, addNote(p, { start: 45, end: 48, kind: 'animate', text: 'a chart' }).id, 'ready', { reply: 'added a bar chart', touched: [[44, 49]] })
  deleteNote(p, addNote(p, { start: 1, end: 1, kind: 'free', text: 'gone' }).id)
  const again = parseProjectFile(serializeProject(p))
  assert.deepEqual(again.notes, p.notes)
  assert.equal(again.noteSeq, 3)
  // A file from before the notes, opened and saved again, is byte for byte the same.
  assert.equal(serializeProject(parseProjectFile(text)), text)
})

// --- the drawing ----------------------------------------------------------------

/** A 2D context that only records what was asked of it. */
function recorder(): PaintContext & { calls: string[]; strokes: { style: unknown; width: number }[] } {
  const calls: string[] = []
  const strokes: { style: unknown; width: number }[] = []
  const c = {
    calls,
    strokes,
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '' as unknown,
    save: () => void calls.push('save'),
    restore: () => void calls.push('restore'),
    beginPath: () => void calls.push('begin'),
    moveTo: (x: number, y: number) => void calls.push(`M${Math.round(x)},${Math.round(y)}`),
    lineTo: (x: number, y: number) => void calls.push(`L${Math.round(x)},${Math.round(y)}`),
    rect: (x: number, y: number, w: number, h: number) => void calls.push(`R${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`),
    stroke: () => void strokes.push({ style: c.strokeStyle, width: c.lineWidth }),
    fillStyle: '' as unknown,
    font: '',
    textAlign: '',
    textBaseline: '',
    closePath: () => void calls.push('close'),
    arc: (x: number, y: number, r: number) => void calls.push(`A${Math.round(x)},${Math.round(y)},${Math.round(r)}`),
    fill: () => void calls.push(`fill ${String(c.fillStyle)}`),
    fillText: (text: string, x: number, y: number) => void calls.push(`T${text}@${Math.round(x)},${Math.round(y)}`)
  }
  return c
}

test('shapes: the box round a drawing, and the close-up an agent is shown', () => {
  const shapes: NoteShape[] = [
    { type: 'rect', pts: [[0.5, 0.4], [0.3, 0.2]], color: '#ff4d4d' },
    { type: 'pen', pts: [[0.35, 0.25], [0.6, 0.45]], color: '#ffffff' }
  ]
  assert.deepEqual(bbox(shapes), [0.3, 0.2, 0.6, 0.45])
  assert.deepEqual(bbox([]), [0, 0, 1, 1])
  const [x0, y0, x1, y1] = closeUp(shapes)
  near(x0, 0.22)
  near(y0, 0.12)
  near(x1, 0.68)
  near(y1, 0.53)
  // A small mark still gets a readable piece of the frame, kept inside it.
  const tiny = closeUp([{ type: 'pen', pts: [[0.99, 0.01]], color: '#ffffff' }])
  near(tiny[2] - tiny[0], 0.2)
  near(tiny[3] - tiny[1], 0.2)
  assert.ok(tiny[0] >= 0 && tiny[1] >= 0 && tiny[2] <= 1 && tiny[3] <= 1)
  near(tiny[2], 1)
  near(tiny[1], 0)
})

test('shapes: painted the same on any frame size, each stroke over a dark one', () => {
  const shapes: NoteShape[] = [
    { type: 'rect', pts: [[0.5, 0.5], [0.25, 0.25]], color: '#ff4d4d' },
    { type: 'arrow', pts: [[0, 0.5], [0.5, 0.5]], color: '#3ee089' },
    { type: 'pen', pts: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]], color: '#ffffff' }
  ]
  const c = recorder()
  paintShapes(c, shapes, 1000, 500)
  assert.deepEqual(c.calls, [
    'save',
    'begin', 'R250,125,250,125',
    // The arrow's shaft, then the two barbs of its head, 20 px long.
    'begin', 'M0,250', 'L500,250', 'M500,250', 'L482,259', 'M500,250', 'L482,241',
    'begin', 'M100,50', 'L200,100', 'L300,50',
    'restore'
  ])
  assert.equal(c.strokes.length, 6)
  assert.deepEqual(c.strokes.filter((_, i) => i % 2 === 1).map((s) => s.style), ['#ff4d4d', '#3ee089', '#ffffff'])
  // The under-stroke is wider than the stroke; both scale with the frame.
  assert.ok(c.strokes[0].width > c.strokes[1].width)
  near(c.strokes[1].width, 3.5)
  assert.equal(strokeWidth(400), 2.5)
  const head = arrowHead([0, 0], [100, 0], 1000)
  near(head[0][0], head[1][0])
  near(head[0][1], -head[1][1])
  // Nothing to paint: only the save and restore.
  const empty = recorder()
  paintShapes(empty, [], 100, 100)
  assert.deepEqual(empty.calls, ['save', 'restore'])
})

test('shapes: picking one, thinning a pen stroke, dropping an accidental tap', () => {
  const shapes: NoteShape[] = [
    { type: 'rect', pts: [[0.2, 0.2], [0.6, 0.6]], color: '#ff4d4d' },
    { type: 'arrow', pts: [[0.7, 0.1], [0.9, 0.1]], color: '#ff4d4d' },
    { type: 'pen', pts: [[0.1, 0.8], [0.2, 0.9], [0.3, 0.8]], color: '#ff4d4d' }
  ]
  // A box is picked by its edge, not its inside.
  assert.equal(hit(shapes, [0.4, 0.4]), -1)
  assert.equal(hit(shapes, [0.4, 0.21]), 0)
  assert.equal(hit(shapes, [0.8, 0.11]), 1)
  assert.equal(hit(shapes, [0.15, 0.85]), 2)
  assert.equal(hit(shapes, [0.5, 0.95]), -1)
  const dense: [number, number][] = Array.from({ length: 200 }, (_, i) => [0.1 + i * 0.0005, 0.5])
  const thinned = thin(dense)
  assert.ok(thinned.length < 40 && thinned.length > 10)
  assert.deepEqual(thinned[0], dense[0])
  assert.deepEqual(thinned[thinned.length - 1], dense[199])
  assert.equal(worthKeeping({ type: 'rect', pts: [[0.5, 0.5], [0.501, 0.5]], color: '#ffffff' }), false)
  assert.equal(worthKeeping({ type: 'arrow', pts: [[0.5, 0.5], [0.6, 0.5]], color: '#ffffff' }), true)
  assert.equal(worthKeeping({ type: 'pen', pts: [[0.5, 0.5]], color: '#ffffff' }), true)
})

test('a typed time is read as seconds or m:ss, or not at all', () => {
  assert.equal(parseClock('62.5'), 62.5)
  assert.equal(parseClock(' 1:02.5 '), 62.5)
  assert.equal(parseClock('1:02:03'), 3723)
  assert.equal(parseClock('0:07,5'), 7.5)
  for (const bad of ['', 'soon', '1:', '-3', '1:2:3:4', '1e3']) assert.equal(parseClock(bad), null, bad)
})

// --- what an agent reads and writes ----------------------------------------------

test('the agent server offers one notes tool: read, one picture, answers in a batch', () => {
  const t = AGENT_TOOLS.find((x) => x.name === 'notes')!
  const schema = t.inputSchema as { type: string; properties: Record<string, { type?: string; items?: { required?: string[] } }>; additionalProperties: boolean }
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(Object.keys(schema.properties), ['status', 'take', 'image', 'update', 'as']) // (as: the optional worker label every tool has, EKIP-PLAN.md.)
  assert.deepEqual(schema.properties.update.items?.required, ['id'])
  // An answer is neither an edit of the timeline nor destructive.
  assert.equal(t.annotations?.destructiveHint, false)
  // How to answer is said there once: not in the server's instructions.
  assert.match(t.description, /ready = done/)
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /note/)
  for (const old of ['note_image', 'note_update']) assert.ok(!AGENT_TOOLS.some((x) => x.name === old), old)
})

function noted(): Project {
  const p = project()
  p.name = 'Demo'
  p.captions.push(
    { id: 's1', start: 9, end: 13, text: 'The population  grows every year' },
    { id: 's2', start: 44, end: 46, text: 'and here it doubles' },
    { id: 't1', start: 44, end: 46, text: 'A TITLE', manual: true, layer: 1 }
  )
  addNote(p, { start: 10, end: 12, kind: 'fix', text: 'The title\n is cut off' })
  addNote(p, { start: 43.5, end: 47, kind: 'animate', text: 'A bar chart here', at: 45, shapes: [{ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.5]], color: '#ff4d4d' }] })
  addNote(p, { start: 20, end: 20, kind: 'cut', text: '' })
  addNote(p, { start: 200, end: 201, kind: 'free', text: 'credits' })
  setNoteStatus(p, note(p, 2).id, 'still', { reply: 'added a chart' })
  setNoteStatus(p, note(p, 3).id, 'approved')
  setNoteStatus(p, note(p, 4).id, 'ready', { reply: 'done' })
  return p
}

test('notes: which ones a filter picks', () => {
  const p = noted()
  assert.deepEqual(pickNotes(p, 'open').map((n) => n.num), [1, 2])
  assert.deepEqual(pickNotes(p, 'all').map((n) => n.num), [1, 3, 2, 4])
  assert.deepEqual(pickNotes(p, 'ready').map((n) => n.num), [4])
  assert.equal(notesFilter(undefined), 'open')
  assert.equal(notesFilter('still'), 'still')
  assert.throws(() => notesFilter('done'), /status must be one of: open/)
})

test('notes: the text an agent reads', () => {
  const p = noted()
  const text = notesText(p, 'C:\\v\\demo.snipp', 'open', 2)
  assert.deepEqual(text.split('\n'), [
    'Work notes of "Demo" (C:\\v\\demo.snipp): 2 waiting for work, of 4. Times are timeline seconds.',
    '#1 [open] 10.00–12.00 s (2.00 s) · fix (something here is wrong)',
    '   "The title is cut off"',
    '   on "talk.mp4" (clip talk), its source at 15.00–17.00 s',
    '   said there: «The population grows every year»',
    '#2 [STILL THERE: your earlier work on it was not enough] 43.50–47.00 s (3.50 s) · animate (make an animation for this stretch) · canvas 1920x1080',
    '   "A bar chart here"',
    '   on code clip "demo" (clip film): film time 3.50–7.00 s, film folder C:\\films\\demo',
    // Only what is said: a title on the picture is not narration.
    '   said there: «and here it doubles»',
    '   drawn on the frame at 45.00 s: notes {"image": 2}',
    '   your earlier answer: added a chart',
    `2 of these are now marked "with agent" in ${PRODUCT_NAME}.`
  ])
  const all = notesText(p, null, 'all')
  assert.match(all, /\(not saved yet\): 4 in all, of 4\./)
  assert.match(all, /#3 \[approved\] 20\.00 s \(one frame\) · cut \(take this stretch out\)\n {3}\(no text: see the drawing\)\n {3}on "logo\.png" \(clip logo\), its source at 0\.00 s/)
  assert.match(all, /#4 \[ready\] 200\.00–201\.00 s \(1\.00 s\) · free\n {3}"credits"\n {3}on no clip\n {3}your earlier answer: done/)
  // Nothing of the kind asked for, and nothing at all.
  assert.equal(notesText(p, null, 'agent'), '"Demo" has no notes with status agent (4 notes in all: ask with status "all").')
  assert.equal(notesText(project(), null, 'open'), `"Untitled" has no work notes. The user writes them in ${PRODUCT_NAME} (the N lane, the Notes tab).`)
  // A long narration is cut short.
  assert.equal(spokenIn(p, 0, 300, 20), 'The population grow…')
  assert.equal(spokenIn(p, 100, 110), '')
})

test('note_update: checked before anything changes, and said back plainly', () => {
  const p = noted()
  const plan = planNoteUpdate(p, { id: 1, status: 'ready', reply: 'moved the title up', touched: [[12, 9.5], [150, 400], [500, 600], [-9, -1]] })
  assert.equal(plan.note.num, 1)
  assert.equal(plan.status, 'ready')
  // Kept inside the timeline (100 s long: a note past its end does not make it longer).
  assert.deepEqual(plan.touched, [[9.5, 12]])
  assert.deepEqual(plan.remarks, ['3 touched ranges were outside the timeline (0–100.00 s) and left out.'])
  const after = setNoteStatus(p, plan.note.id, plan.status!, { reply: plan.reply, touched: plan.touched })!
  assert.equal(updateText(p, after, plan.remarks), '#1 → ready · moved the title up\nThe user will play 8.00–13.50 s and approve it or send it back.\n3 touched ranges were outside the timeline (0–100.00 s) and left out.')
  // Without ranges: the note's own stretch is what the user looks at.
  const own = planNoteUpdate(p, { id: 2, status: 'ready' })
  assert.equal(own.touched, undefined)
  assert.match(updateText(p, setNoteStatus(p, own.note.id, 'ready')!, []), /The user will play 42\.00–48\.50 s/)
  // A reply alone, and working on it.
  assert.deepEqual(planNoteUpdate(p, { id: 2, reply: 'looking' }).status, undefined)
  assert.equal(updateText(p, setNoteStatus(p, note(p, 2).id, 'agent', { reply: 'looking' })!, []), '#2 → agent · looking')
  // What an agent may not do, each said so it can act on it.
  assert.throws(() => planNoteUpdate(p, { status: 'ready' }), /id is required/)
  assert.throws(() => planNoteUpdate(p, { id: 9, status: 'ready' }), /There is no note #9\. The notes are: #1, #2, #3, #4\./)
  assert.throws(() => planNoteUpdate(p, { id: 1, status: 'approved' }), /Approving is the user's/)
  assert.throws(() => planNoteUpdate(p, { id: 3, status: 'open' }), /The user approved note #3/)
  assert.throws(() => planNoteUpdate(p, { id: 1, reply: 5 }), /reply must be text/)
  assert.throws(() => planNoteUpdate(p, { id: 1, touched: [[1, 'x']] }), /two numbers/)
  assert.throws(() => planNoteUpdate(p, { id: 1, touched: 'all' }), /list of \[start, end\] pairs/)
  assert.throws(() => planNoteUpdate(p, { id: 1 }), /Nothing to update/)
  assert.throws(() => planNoteUpdate(project(), { id: 1, status: 'ready' }), /no work notes/)
  // An approved note may still get a reply (no status change).
  assert.equal(planNoteUpdate(p, { id: 3, reply: 'noted' }).reply, 'noted')
})

// --- going through what the agent changed -----------------------------------------

/** Three answered notes (#1 at 10–12, #2 at 45–48 with its own ranges, #3 a
 *  cut that is now one frame at 30) and one still open. */
function answered(): void {
  load([10, 12], [45, 48], [30, 30], [60, 62])
  const S = useStore.getState()
  S.editNotes((p) => {
    setNoteStatus(p, note(p, 1).id, 'ready', { reply: 'moved the title' })
    setNoteStatus(p, note(p, 2).id, 'ready', { reply: 'added a chart', touched: [[5, 8]] })
    setNoteStatus(p, note(p, 3).id, 'ready', { reply: 'cut it' })
  }, false)
}
const reviewing = (): number | null => {
  const s = useStore.getState()
  return s.noteReview ? note(s.project, s.project.notes!.find((n) => n.id === s.noteReview!.ids[s.noteReview!.index])!.num).num : null
}

test('the review plays each changed stretch in turn; approve or send back moves on', () => {
  answered()
  const S = useStore
  const steps = S.getState().past.length
  startReview()
  // In the order of what changed: #2 changed 5–8 s, though the note sits at 45 s.
  assert.deepEqual(S.getState().noteReview!.ids.map((id) => S.getState().project.notes!.find((n) => n.id === id)!.num), [2, 1, 3])
  assert.equal(reviewing(), 2)
  assert.deepEqual(S.getState().loopRange, [3.5, 9.5])
  assert.deepEqual([S.getState().currentTime, S.getState().playing, S.getState().project.notes!.find((n) => n.id === S.getState().noteSel)!.num], [3.5, true, 2])
  decideReview('approved')
  assert.equal(note(now(), 2).status, 'approved')
  assert.equal(reviewing(), 1)
  assert.deepEqual(S.getState().loopRange, [8.5, 13.5])
  // Back to the one before, and on again without deciding.
  stepReview(-1)
  assert.equal(reviewing(), 2)
  stepReview(-1)
  assert.equal(reviewing(), 2)
  stepReview(1)
  decideReview('still')
  assert.equal(note(now(), 1).status, 'still')
  // A cut note is one frame: the join, with a lead-in and a tail.
  assert.equal(reviewing(), 3)
  assert.deepEqual(S.getState().loopRange, [28.5, 31.5])
  replayReview()
  assert.equal(S.getState().currentTime, 28.5)
  // Past the last one the review is over; the undecided note stays "ready".
  stepReview(1)
  assert.deepEqual([S.getState().noteReview, S.getState().loopRange, S.getState().playing], [null, null, false])
  assert.deepEqual([1, 2, 3, 4].map((n) => note(now(), n).status), ['still', 'approved', 'ready', 'open'])
  // None of it is an undo step, and the note sent back is to be sent again.
  assert.equal(S.getState().past.length, steps)
  assert.deepEqual(notesToSend(now()).map((n) => n.num), [1, 4])
})

test('a review starts at the note asked for, ends by hand, and makes way for a new note', () => {
  answered()
  const S = useStore
  startReview(note(now(), 3).id)
  assert.equal(reviewing(), 3)
  endReview()
  assert.deepEqual([S.getState().noteReview, S.getState().loopRange, S.getState().playing], [null, null, false])
  // Writing a note ends it.
  startReview()
  newNote({ start: 70, end: 72 })
  assert.deepEqual([S.getState().noteReview, S.getState().loopRange, S.getState().playing], [null, null, false])
  assert.deepEqual([S.getState().noteDraft!.start, S.getState().noteDraft!.end], [70, 72])
  S.getState().cancelNoteDraft()
  // An undo that takes the note under review away takes it out of the review.
  S.getState().editNotes((p) => void addNote(p, { start: 80, end: 81, kind: 'fix', text: 'late' }))
  S.getState().editNotes((p) => void setNoteStatus(p, note(p, 5).id, 'ready'), false)
  startReview(note(now(), 5).id)
  assert.equal(reviewing(), 5)
  S.getState().undo()
  assert.equal(note(now(), 5), undefined)
  assert.equal(S.getState().noteReview!.ids.length, 3)
  assert.ok(reviewing() !== null)
  endReview()
  // Nothing answered: nothing to review.
  load([1, 2])
  startReview()
  assert.equal(S.getState().noteReview, null)
})

test('picking a note goes to its drawing; deleting the picked one lets go of it', () => {
  load()
  const S = useStore
  S.getState().editNotes((p) => {
    addNote(p, { start: 44, end: 47, kind: 'fix', text: 'x', at: 46, shapes: [{ type: 'rect', pts: [[0, 0], [1, 1]], color: '#ffffff' }] })
    addNote(p, { start: 10, end: 12, kind: 'fix', text: 'y' })
  })
  goToNote(note(now(), 1).id)
  assert.deepEqual([S.getState().currentTime, S.getState().noteSel], [46, note(now(), 1).id])
  goToNote(note(now(), 2).id)
  assert.equal(S.getState().currentTime, 10)
  markNote(note(now(), 2).id, 'approved')
  assert.equal(note(now(), 2).status, 'approved')
  removeNote(note(now(), 2).id)
  assert.equal(S.getState().noteSel, null)
  assert.equal(now().notes!.length, 1)
})
