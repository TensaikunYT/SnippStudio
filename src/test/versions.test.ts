// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The project's version, the shift table and "what changed" (SnippStudio
// phase 2A.3).
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { setNoteStatus, updateNote } from '../renderer/src/notes/model'
import { mapTime, VersionLog, type Changes, type ShiftTable } from '../renderer/src/history/versions'
import { runCommand, commandByName, seededRandom } from '../renderer/src/commands'

const S = useStore.getState
const v = (): number => S().projectVersion

function fresh(): void {
  resetWorld()
  S().loadProject(fixture())
}

test('every edit of the film is a new version; notes, selection, playhead, view and edits that change nothing are not', () => {
  fresh()
  const v0 = v()
  S().addMarkerAtPlayhead()
  assert.equal(v(), v0 + 1)
  S().setClipOpacity('ov', 0.5) // a slider's change (no undo step of its own) is still an edit
  assert.equal(v(), v0 + 2)
  const noteId = S().project.notes![0].id
  S().editNotes((p) => void setNoteStatus(p, noteId, 'agent'), false)
  S().editNotes((p) => void updateNote(p, noteId, { text: 'changed words' }))
  S().setTrackHeight('v1', 120)
  S().selectClips(['ov'])
  S().setTime(12)
  S().setPreviewView({ zoom: 2 })
  S().setPxPerSec(90)
  S().setClipTransform('ov', { x: 1400 }) // the same value
  S().setMode('frame') // the same mode
  assert.equal(v(), v0 + 2)
  // Undo and redo are new states of the film: new numbers, never old ones —
  // but undoing only a note (the text edit above) is not (2A.5).
  S().undo()
  assert.equal(v(), v0 + 2)
  S().undo()
  assert.equal(v(), v0 + 3)
  S().redo()
  assert.equal(v(), v0 + 4)
  // Opening a project too.
  S().loadProject(fixture())
  assert.equal(v(), v0 + 5)
})

test('one batch or one drag step can be several versions; the number only grows', () => {
  fresh()
  const v0 = v()
  S().runBatch([{ name: 'marker.add', params: { time: 1 } }, { name: 'track.add', params: { kind: 'video' } }])
  assert.equal(v(), v0 + 1, 'a batch is one edit')
  S().armGesture()
  for (let i = 1; i <= 5; i++) S().moveClip('ov', 2 + i, false)
  S().endGesture()
  assert.equal(v(), v0 + 6, 'each change of a drag is seen')
})

test('the shift table: old times to new after cuts, composed over several cuts, refused after any other edit', () => {
  fresh()
  const v0 = v()
  S().rippleDeleteMany([[5, 6], [1, 2]])
  const t1 = S().shiftTable(v0)
  assert.ok(t1.table)
  const table = t1.table as ShiftTable
  assert.deepEqual(table.cuts, [[1, 2], [5, 6]])
  assert.deepEqual(mapTime(table, 0.5), { time: 0.5, removed: false })
  assert.deepEqual(mapTime(table, 3), { time: 2, removed: false })
  assert.deepEqual(mapTime(table, 7), { time: 5, removed: false })
  assert.deepEqual(mapTime(table, 1.5), { time: 1, removed: true })
  // A second cut, given in the new times (3..4 of the new = 4..5 of the old),
  // through a batch.
  S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[3, 4]] } }])
  const t2 = S().shiftTable(v0).table!
  assert.deepEqual(t2.cuts, [[1, 2], [4, 6]])
  assert.deepEqual(mapTime(t2, 7), { time: 4, removed: false })
  assert.deepEqual(mapTime(t2, 4.5), { time: 3, removed: true })
  // From the middle version: only the second cut.
  const t3 = S().shiftTable(v0 + 1).table!
  assert.deepEqual(t3.cuts, [[3, 4]])
  // Today: nothing to move.
  assert.deepEqual(S().shiftTable(v()).table!.cuts, [])
  // A cut on the subtitles only, or one track only, is not a timeline cut.
  S().addCutMark(1, 'captions')
  S().addCutMark(2, 'captions')
  S().deleteBetweenCuts()
  const refused = S().shiftTable(v0)
  assert.equal(refused.table, null)
  assert.match((refused as { reason: string }).reason, /was an edit, not a cut/)
  assert.match((S().shiftTable(v() + 5) as { reason: string }).reason, /newer than the project/)
})

test('the shift table moves times exactly as the timeline moved them (markers as witnesses)', () => {
  const rand = seededRandom(5)
  for (let round = 0; round < 25; round++) {
    fresh()
    // Markers every 0.37 s: each is an old time whose new place we know.
    const times = Array.from({ length: 60 }, (_, i) => +(0.2 + i * 0.37).toFixed(3))
    useStore.setState({ project: { ...S().project, markers: times.map((t, i) => ({ id: `m${i}`, time: t, color: '#fff', note: '' })) } })
    const v0 = v()
    for (let k = 0; k < 3; k++) {
      const ranges = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const a = +(rand() * 18).toFixed(2)
        return [a, +(a + 0.1 + rand() * 1.5).toFixed(2)] as [number, number]
      })
      if (rand() < 0.5) S().rippleDeleteMany(ranges)
      else S().runBatch([{ name: 'timeline.cutRanges', params: { ranges } }])
    }
    const table = S().shiftTable(v0).table!
    const now = new Map((S().project.markers ?? []).map((m) => [m.id, m.time]))
    times.forEach((t, i) => {
      const m = mapTime(table, t)
      if (m.removed) assert.ok(!now.has(`m${i}`), `round ${round}: marker at ${t} should be gone`)
      else assert.ok(Math.abs(now.get(`m${i}`)! - m.time) < 1e-6, `round ${round}: ${t} → ${m.time}, timeline has ${now.get(`m${i}`)}`)
    })
  }
})

const ch = (from: number): Changes => {
  const c = S().changesSince(from)
  if ('tooOld' in c || 'otherEpoch' in c) throw new Error('expected changes')
  return c
}
const NONE = { added: { count: 0, ids: [] }, removed: { count: 0, ids: [] }, moved: { count: 0, ids: [] }, changed: { count: 0, ids: [] } }

test('what changed: cuts, clips, lines, tracks, markers and templates by id', () => {
  fresh()
  const v0 = v()
  S().rippleDeleteMany([[1.4, 2.2]])
  const c1 = ch(v0)
  assert.deepEqual(c1.cuts, [[1.4, 2.2]])
  // The line the cut ran through lost words; none removed.
  assert.deepEqual(c1.captions.wordsChanged.ids, ['c1'])
  assert.equal(c1.captions.removed.count, 0)
  assert.ok(c1.clips.added.count >= 1, 'the clips the cut ran through were split')
  // The Shorts band the cut ran through got shorter.
  assert.deepEqual(c1.other, ['shortSegments'])
  const v1 = v()
  S().deleteClips(['cc'], false)
  S().addCaptionAtPlayhead('New')
  S().addVideoTrack()
  S().deleteMarker('mk1')
  const c2 = ch(v1)
  assert.equal(c2.cuts, undefined)
  assert.deepEqual(c2.clips.removed.ids, ['cc'])
  assert.equal(c2.captions.added.count, 1)
  assert.equal(c2.tracks.added.count, 1)
  assert.deepEqual(c2.markers.removed.ids, ['mk1'])
  // A note's status and a row height are not changes of the film.
  const v2 = v()
  S().editNotes((p) => void setNoteStatus(p, p.notes![0].id, 'ready'), false)
  S().setTrackHeight('v2', 140)
  const c3 = ch(v2)
  assert.deepEqual([c3.clips, c3.tracks, c3.other], [NONE, NONE, []])
  assert.deepEqual(c3.captions, { ...NONE, wordsChanged: { count: 0, ids: [] } })
  // Settings show under "other".
  S().setSettings({ fps: 30 })
  assert.deepEqual(ch(v2).other, ['settings'])
})

test('an old version: too old once its project is no longer kept, unless a reader pinned it', () => {
  fresh()
  const vA = v()
  S().addMarkerAtPlayhead()
  const vB = v()
  S().pinVersion(vB)
  for (let i = 0; i < 120; i++) S().setClipOpacity('ov', 0.5 + (i % 2) * 0.1)
  assert.deepEqual(S().changesSince(vA), { from: vA, to: v(), tooOld: true })
  const kept = S().changesSince(vB)
  assert.ok(!('tooOld' in kept))
  if (!('tooOld' in kept) && !('otherEpoch' in kept)) assert.deepEqual(kept.clips.changed.ids, ['ov'])
  // The numbers are still known: the shift table can say why it cannot help.
  assert.match((S().shiftTable(vA) as { reason: string }).reason, /an edit, not a cut/)
})

test('the version log in a pure use: a command result recorded by hand', () => {
  const log = new VersionLog()
  const p0 = fixture()
  const v0 = log.record('load', p0)
  const { project: p1 } = runCommand(p0, commandByName('timeline.cutRanges'), { ranges: [[2, 3]] })
  log.record('cut', p1, [[[2, 3]]])
  const ch = log.changesSince(v0, p1)
  assert.ok(!('tooOld' in ch) && !('otherEpoch' in ch) && ch.cuts && ch.cuts[0][0] === 2)
})
