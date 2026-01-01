// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Batches and the undo traps (SnippStudio phase 2A.2): several commands are
// one undo step; a failing one applies nothing; windows nest; an edit that
// changes nothing makes no step; a slow batch is not split by the idle timer;
// a batch during a drag does not mix with the drag's step.
import { fixture, hash, resetWorld, tick } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { CommandError } from '../renderer/src/commands'

const S = useStore.getState

function fresh(): string {
  resetWorld()
  S().loadProject(fixture())
  return hash(S().project)
}

test('a batch is one undo step, and undo / redo take it back and forth whole', () => {
  const h0 = fresh()
  const results = S().runBatch([
    { name: 'timeline.cutRanges', params: { ranges: [[1, 2]] } },
    { name: 'text.add', params: { time: 3, text: 'After the cut' } },
    { name: 'marker.add', params: { time: 4 } },
    { name: 'clip.set', params: { clipId: 'ov', opacity: 0.5, volume: 0 } }
  ])
  assert.equal(results.length, 4)
  assert.equal(S().past.length, 1)
  assert.equal(S().dirty, true)
  const h1 = hash(S().project)
  S().undo()
  assert.equal(hash(S().project), h0)
  S().redo()
  assert.equal(hash(S().project), h1)
})

test('a batch with a bad call, or one that fails while running, applies nothing and makes no step', () => {
  const h0 = fresh()
  assert.throws(() => S().runBatch([{ name: 'marker.add', params: { time: 4 } }, { name: 'clip.move', params: { clipId: 'ov', start: 'later' } }]), CommandError)
  assert.throws(() => S().runBatch([{ name: 'marker.add', params: { time: 4 } }, { name: 'note.delete', params: { id: 'nope' } }]), /#2 note.delete failed/)
  assert.equal(hash(S().project), h0)
  assert.equal(S().past.length, 0)
  assert.equal(S().dirty, false)
  // And the store still works normally afterwards (no window left open).
  S().addVideoTrack()
  S().addAudioTrack()
  assert.equal(S().past.length, 2)
})

test('nested windows: batches and actions inside one undoable are one step; an inner end does not close the outer', () => {
  fresh()
  S().setTime(7)
  S().undoable(() => {
    S().runBatch([{ name: 'track.add', params: { kind: 'video' } }])
    S().undoable(() => {
      S().addMarkerAtPlayhead()
      S().runBatch([{ name: 'marker.add', params: { time: 9 } }])
    })
    S().endGesture() // an inner close: ignored inside the window
    S().addAudioTrack()
    S().nudgeSelection(0.1) // an action that opens its own window inside
  })
  assert.equal(S().past.length, 1)
  assert.equal(S().project.markers!.length, 4)
  S().undo()
  assert.equal(S().project.markers!.length, 2)
})

test('an edit that changes nothing makes no step, keeps redo, and leaves the project saved', () => {
  const h0 = fresh()
  S().addMarkerAtPlayhead()
  S().undo()
  S().setDirty(false)
  assert.equal(S().future.length, 1)
  S().runBatch([{ name: 'marker.update', params: { id: 'mk1', patch: { note: 'first' } } }])
  S().setClipTransform('ov', { x: 1400 })
  S().updateCaption('t1', { text: 'Title' })
  S().moveTrack('v1', 1)
  assert.equal(S().past.length, 0)
  assert.equal(S().future.length, 1)
  assert.equal(S().dirty, false)
  assert.equal(hash(S().project), h0)
})

test('a slow batch is not split by the idle timer; a UI gesture still is', () => {
  fresh()
  S().undoable(() => {
    S().addVideoTrack()
    tick(5000)
    S().runBatch([{ name: 'marker.add', params: { time: 1 } }])
    tick(5000)
    S().addAudioTrack()
  })
  assert.equal(S().past.length, 1)
  // The UI gesture's idle close is unchanged (a drag held for seconds): the
  // move after it is outside the window, and since phase Ç2a.1 (decision 4)
  // a change outside any window is a step of its own (it used to ride on the
  // drag's step without being recorded).
  fresh()
  S().armGesture()
  S().moveClip('ov', 3, false)
  tick(1600)
  S().moveClip('ov', 4, false)
  S().endGesture()
  assert.equal(S().past.length, 2)
})

test('a batch during a drag: its own step, between the two halves of the drag; undo takes them back one by one', () => {
  const h0 = fresh()
  S().armGesture()
  S().moveClip('ov', 3, false)
  const hDrag1 = hash(S().project)
  S().runBatch([{ name: 'marker.add', params: { time: 8 } }, { name: 'track.add', params: { kind: 'audio' } }])
  const hBatch = hash(S().project)
  S().moveClip('ov', 4, false)
  S().moveClip('ov', 5, false)
  S().endGesture()
  assert.equal(S().past.length, 3)
  S().undo()
  assert.equal(hash(S().project), hBatch, 'first undo: the rest of the drag')
  S().undo()
  assert.equal(hash(S().project), hDrag1, 'second: the batch')
  S().undo()
  assert.equal(hash(S().project), h0, 'third: the start of the drag')
  // A drag armed but not moved yet when the batch comes: batch, then drag.
  fresh()
  S().armGesture()
  S().runBatch([{ name: 'marker.add', params: { time: 8 } }])
  S().moveClip('ov', 4, false)
  S().endGesture()
  assert.equal(S().past.length, 2)
})

test('a seeded batch makes the same random choices every time', () => {
  fresh()
  S().runBatch([{ name: 'motion.cinematize', params: { intensity: 0.5 } }], { seed: 11 })
  const a = hash(S().project)
  fresh()
  S().runBatch([{ name: 'motion.cinematize', params: { intensity: 0.5 } }], { seed: 11 })
  assert.equal(hash(S().project), a)
})

test('a batch during a trim drag (beginGesture, as the timeline runs it): its own step between the two halves', () => {
  const h0 = fresh()
  const c = S().project.clips.cb
  const b = { start: c.start, inPoint: c.inPoint, duration: c.duration }
  S().beginGesture()
  S().setClipHead('cb', 10.4, b)
  const hHalf = hash(S().project)
  S().runBatch([{ name: 'marker.add', params: { time: 8 } }])
  const hBatch = hash(S().project)
  S().setClipHead('cb', 11, b)
  S().endGesture()
  assert.equal(S().past.length, 3)
  S().undo()
  assert.equal(hash(S().project), hBatch)
  S().undo()
  assert.equal(hash(S().project), hHalf)
  S().undo()
  assert.equal(hash(S().project), h0)
})

test('a failed batch inside a drag leaves the drag one step; a pending silence preview goes when a batch moves clips', () => {
  fresh()
  S().armGesture()
  S().moveClip('ov', 3, false)
  assert.throws(() => S().runBatch([{ name: 'clip.move', params: { clipId: 'ov' } }]))
  S().moveClip('ov', 4, false)
  S().endGesture()
  assert.equal(S().past.length, 1)
  fresh()
  S().setSilencePreview([{ clipId: 'sa', start: 2, end: 3 }])
  S().runBatch([{ name: 'marker.add', params: { time: 1 } }])
  assert.notEqual(S().silencePreview, null, 'a marker does not move clips')
  S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[5, 6]] } }])
  assert.equal(S().silencePreview, null)
})
