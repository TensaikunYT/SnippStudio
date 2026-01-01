// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Versions, the shift table and "what changed" after the 2A.5 review
// (SnippStudio phase 2A.5 D).
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { applyBatch } from '../renderer/src/commands'
import type { Changes } from '../renderer/src/history/versions'
import type { Project } from '../renderer/src/types'

const S = useStore.getState
const v = (): number => S().projectVersion
function fresh(p: Project = fixture()): void {
  resetWorld()
  S().loadProject(p)
}
const changes = (from: number): Changes => {
  const c = S().changesSince(from)
  if ('tooOld' in c || 'otherEpoch' in c) throw new Error('expected changes')
  return c
}

test('snapping, the project name and a track lock are not the film: no new version', () => {
  fresh()
  const v0 = v()
  S().setSnap({ enabled: false, distance: 20 })
  S().setProjectName('Another name')
  S().setTrackFlags('a2', { locked: true })
  assert.equal(v(), v0)
  S().setTrackFlags('a2', { muted: true }) // heard: the film
  assert.equal(v(), v0 + 1)
})

test('undo and redo make a new version only when the film changed', () => {
  fresh()
  S().startNoteDraft({ start: 1, end: 2 })
  S().patchNoteDraft({ text: 'a note' })
  S().saveNoteDraft() // an undoable step, but only a note
  const v0 = v()
  S().undo()
  assert.equal(v(), v0, 'a note undone')
  S().redo()
  assert.equal(v(), v0)
  S().addMarkerAtPlayhead()
  S().undo()
  assert.equal(v(), v0 + 2, 'the marker and its undo')
})

test('a cut does not move the clips of a locked track: the shift table and the changes say which tracks stayed', () => {
  const p = fixture()
  p.tracks.find((t) => t.id === 'a2')!.locked = true
  fresh(p)
  const v0 = v()
  S().rippleDeleteMany([[5, 10]])
  const t = S().shiftTable(v0)
  assert.ok(t.table)
  assert.deepEqual(t.table!.fixedTracks, ['a2'])
  assert.equal(S().project.clips.m1.start, 0, 'the music did not move')
  assert.deepEqual(changes(v0).fixedTracks, ['a2'])
  // Locked V3's still ends at 5: the cut starts there, nothing of it moves either way.
})

test('a version number of another epoch (the page reloaded) is refused', () => {
  fresh()
  const v0 = v()
  S().addMarkerAtPlayhead()
  assert.match((S().shiftTable(v0, 'other') as { reason: string }).reason, /another session/)
  assert.deepEqual(S().changesSince(v0, 'other'), { from: v0, to: v(), otherEpoch: true })
  assert.ok(!('otherEpoch' in S().changesSince(v0, S().versionEpoch)))
})

test('what changed: moved (times only), changed (content), words changed (the word addresses are stale); lists are capped', () => {
  fresh()
  const v0 = v()
  S().rippleDeleteMany([[1.4, 2.2]])
  const c = changes(v0)
  assert.deepEqual(c.captions.wordsChanged.ids, ['c1'])
  assert.ok(!c.captions.changed.ids.includes('c1'))
  for (const id of ['c2', 'c3', 't1', 's1']) assert.ok(c.captions.moved.ids.includes(id), `${id} only moved`)
  assert.ok(c.clips.moved.ids.includes('cc'), 'a clip after the cut only moved')
  assert.ok(c.markers.moved.ids.includes('mk1'))
  // A style change is a change, not a move.
  const v1 = v()
  S().setCaptionOwnStyle('t1', { color: '#ff0000' })
  assert.deepEqual(changes(v1).captions.changed.ids, ['t1'])
  // Two hundred lines after a cut: counted, fifty named, truncated.
  const many = fixture()
  for (let i = 0; i < 200; i++) many.captions.push({ id: `L${i}`, text: 'w', start: 30 + i, end: 30.5 + i })
  fresh(many)
  const v2 = v()
  S().rippleDeleteMany([[20, 21]])
  const m = changes(v2).captions.moved
  assert.equal(m.count, 200)
  assert.equal(m.ids.length, 50)
  assert.equal(m.truncated, true)
})

test('a cut through a line keeps its marked words on the same words', () => {
  const p = fixture()
  const c2 = p.captions.find((c) => c.id === 'c2')!
  // "this is a test": mark "a" (2) and "test" (3); cut out "is" (1).
  c2.marks = [2, 3]
  const is = c2.words![1]
  const { project } = applyBatch(p, [{ name: 'timeline.cutRanges', params: { ranges: [[is.start + 0.01, is.end - 0.01]] } }])
  const after = project.captions.find((c) => c.id === 'c2')!
  assert.equal(after.text, 'this a test')
  assert.deepEqual(after.marks, [1, 2])
  assert.deepEqual(after.marks!.map((i) => after.words![i].text), ['a', 'test'])
})
