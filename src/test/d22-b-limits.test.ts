// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, worker B, K9 and K10 (D22-PLAN-B.md).
// K9: a command takes no time the file reader would drop: the parameters'
// own rule and the reader's repair read one constant (model/limits.ts), and
// a command called by name may not leave a clip beyond it either.
// K10: undo's "the clips the jump changed" selection has a ceiling.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { selectionAfterTimeTravel } from '../renderer/src/state/history'
import { COMMANDS, applyBatch, runCommand, s, validate } from '../renderer/src/commands'
import { PROJECT_LIMITS } from '../renderer/src/model/limits'
import { PROJECT_LIMITS as REPAIR_LIMITS } from '../renderer/src/model/repair'
import { readProjectFile, serializeProject } from '../renderer/src/media/projectio'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState
const MAX = PROJECT_LIMITS.maxTime

function project(n = 2): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', path: 'C:\\vid.mp4', size: 1, duration: 1000, width: 1920, height: 1080, hasAudio: true }] as Project['assets']
  for (let i = 0; i < n; i++) {
    const id = 'c' + i
    p.clips[id] = { id, assetId: 'vid', trackId: 'V1', start: i * 4, inPoint: 10, duration: 4, transform: { ...T0 }, volume: 1 } as Clip
    p.tracks[0].clipIds.push(id)
  }
  return p
}

test('K9: one constant: the reader\'s repair and the commands read the same limits', () => {
  assert.equal(REPAIR_LIMITS, PROJECT_LIMITS)
  assert.equal(MAX, 360_000)
  assert.deepEqual(validate(s.time(), MAX), [])
  assert.match(validate(s.time(), MAX + 1).join(), /must be at most 360000/)
  assert.deepEqual(validate(s.range(), [MAX - 1, MAX]), [])
  assert.match(validate(s.range(), [10, MAX + 5]).join(), /end must be at most 360000/)
})

test('K9: clip.move to a time past the limit is refused, by a time given and by one worked out', () => {
  const p = project()
  assert.throws(() => runCommand(p, COMMANDS['clip.move'], { clipId: 'c1', start: 400_000 }), /start: must be at most 360000/)
  // `by` is a distance, not a time: its own rule cannot know where it ends.
  assert.throws(() => runCommand(p, COMMANDS['clip.move'], { clipId: 'c1', by: 1e12 }), /would lie outside the timeline a project can hold/)
  assert.throws(() => applyBatch(p, [{ name: 'clip.move', params: { clipId: 'c1', by: 400_000 } }]), /nothing was applied[\s\S]*would lie outside the timeline/)
  // Inside the limit: made, and the file reader keeps it.
  const ok = runCommand(p, COMMANDS['clip.move'], { clipId: 'c1', start: MAX - 100 }).project
  assert.equal(ok.clips.c1.start, MAX - 100)
  const back = readProjectFile(serializeProject(ok))
  assert.ok(back.project.clips.c1, 'the clip is there after save and open')
  assert.equal(back.project.clips.c1.start, MAX - 100)
  assert.deepEqual((back.repaired ?? []).filter((r) => /time/.test(r.code)), [])
})

test('K9: a clip that already lay beyond the limit does not stop other commands', () => {
  const p = project()
  p.clips.c1.start = MAX + 50
  const out = runCommand(p, COMMANDS['clip.setVolume'], { clipId: 'c0', volume: 0.5 })
  assert.equal(out.project.clips.c0.volume, 0.5)
})

test('K10: a split taken back with its right half picked still picks the left half', () => {
  S().loadProject(project(4))
  const before = Object.keys(S().project.clips)
  S().splitClipAt('c1', 6)
  const piece = Object.keys(S().project.clips).find((id) => !before.includes(id))!
  useStore.setState({ selectedClipIds: [piece] })
  S().undo()
  assert.deepEqual(S().selectedClipIds, ['c1'])
})

test('K10: a jump that changed many clips does not select them all for one stale pick', () => {
  S().loadProject(project(8))
  useStore.setState({ selectedClipIds: ['c0'], currentTime: 2 })
  S().rippleTrimToPlayhead('right', true) // c0 shortened, c1…c7 move up
  useStore.setState({ selectedClipIds: ['gone'] }) // a pick of a clip that is not there
  S().undo()
  assert.deepEqual(S().selectedClipIds, [], 'not the whole timeline')
  // The rule itself: two changed clips for each thing picked, no more.
  const a = project(8)
  const b = structuredClone(a)
  for (const id of ['c1', 'c2']) b.clips[id] = { ...b.clips[id], start: b.clips[id].start + 0.5 }
  for (const id of Object.keys(a.clips)) if (!['c1', 'c2'].includes(id)) b.clips[id] = a.clips[id]
  assert.deepEqual(selectionAfterTimeTravel(a, b, ['gone'], []).selectedClipIds, ['c1', 'c2'])
  b.clips.c3 = { ...b.clips.c3, start: b.clips.c3.start + 0.5 }
  assert.deepEqual(selectionAfterTimeTravel(a, b, ['gone'], []).selectedClipIds, [])
  assert.deepEqual(selectionAfterTimeTravel(a, b, ['gone', 'gone2'], []).selectedClipIds, ['c1', 'c2', 'c3'])
})
