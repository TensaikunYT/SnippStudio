// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-3, worker V (DENEME-3-PLAN-V.md): the timeline's editing feel.
//  1. Undo and redo keep the selection.
//  2. A transition makes no sound unless given one; older files keep theirs.
//  3. A clip dragged over its neighbour trades places only past the middle.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { useStore } from '../renderer/src/state/store'
import { selectionAfterTimeTravel } from '../renderer/src/state/history'
import { timelineSfxEvents } from '../renderer/src/audio/timeline-sfx'
import { CURRENT_FORMAT } from '../renderer/src/model/format'
import { readProjectFile, serializeProject } from '../renderer/src/media/projectio'
import { planTimelinePlacement } from '../renderer/src/timeline/placement'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

function project(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: false } as never]
  const put = (id: string, start: number, duration: number, extra: Partial<Clip> = {}): void => {
    p.clips[id] = { id, assetId: 'vid', trackId: 'V1', start, inPoint: 10, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks[0].clipIds.push(id)
  }
  put('a', 0, 4)
  put('b', 4, 4)
  put('c', 8, 4)
  p.captions = [
    { id: 'cap1', text: 'one', start: 1, end: 2 } as never,
    { id: 'cap2', text: 'two', start: 3, end: 4 } as never
  ]
  return p
}

// ---- 1. the selection across undo / redo ------------------------------------

test('V1: a scale taken back with Ctrl+Z keeps the clip selected; Ctrl+Y too', () => {
  S().loadProject(project())
  S().selectClips(['b'])
  S().setClipTransform('b', { scale: 1.5 })
  assert.equal(S().project.clips.b.transform.scale, 1.5)
  S().undo()
  assert.equal(S().project.clips.b.transform.scale, 1)
  assert.deepEqual(S().selectedClipIds, ['b'], 'still selected after undo')
  S().redo()
  assert.equal(S().project.clips.b.transform.scale, 1.5)
  assert.deepEqual(S().selectedClipIds, ['b'], 'still selected after redo')
})

test('V1: selecting is no undo step (the selection is not in the history)', () => {
  S().loadProject(project())
  const past = S().past.length
  S().selectClips(['a'])
  S().selectClips(['a', 'c'])
  S().selectCaptions(['cap1'])
  S().selectClip(null)
  assert.equal(S().past.length, past)
  assert.equal(S().future.length, 0)
  assert.equal(S().dirty, false)
})

test('V1: a delete taken back selects what came back; its redo lets go', () => {
  S().loadProject(project())
  S().selectClips(['b'])
  S().deleteClips(['b'], false)
  assert.equal(S().project.clips.b, undefined)
  S().undo()
  assert.ok(S().project.clips.b)
  assert.deepEqual(S().selectedClipIds, ['b'])
  S().redo()
  assert.deepEqual(S().selectedClipIds, [])
})

test('V1: of a multi-selection, the clips still there stay selected', () => {
  const before = project()
  const after = structuredClone(before)
  delete after.clips.c
  assert.deepEqual(selectionAfterTimeTravel(before, after, ['a', 'c'], []), { selectedClipIds: ['a'], selectedCaptionIds: [] })
  // Subtitles the same way; clips win over subtitles.
  assert.deepEqual(selectionAfterTimeTravel(before, after, [], ['cap2']), { selectedClipIds: [], selectedCaptionIds: ['cap2'] })
  // A subtitle taken back by the jump is selected when nothing else is left.
  const noCap = structuredClone(before)
  noCap.captions = noCap.captions.filter((c) => c.id !== 'cap2')
  assert.deepEqual(selectionAfterTimeTravel(noCap, before, [], []), { selectedClipIds: [], selectedCaptionIds: ['cap2'] })
  // Nothing was selected and nothing came back: nothing is selected.
  const moved = { ...before, clips: { ...before.clips, a: { ...before.clips.a, start: 1 } } }
  assert.deepEqual(selectionAfterTimeTravel(before, moved, [], []), { selectedClipIds: [], selectedCaptionIds: [] })
})

test('V1: a split taken back while its right half was selected selects the left half', () => {
  S().loadProject(project())
  S().splitClipAt('b', 6)
  const right = Object.keys(S().project.clips).find((id) => !['a', 'b', 'c'].includes(id))!
  assert.ok(right)
  S().selectClips([right])
  S().undo()
  assert.equal(S().project.clips[right], undefined)
  assert.deepEqual(S().selectedClipIds, ['b'])
})

// ---- 2. a transition's sound ------------------------------------------------

test('V2: a transition makes no sound unless given one', () => {
  S().loadProject(project())
  S().setTransitionOut('a', { type: 'whip', duration: 0.5 })
  assert.equal(S().project.clips.a.transitionOut?.sfx, undefined)
  assert.equal(timelineSfxEvents(S().project).length, 0, 'a new transition is silent')
  // The inspector's sound button writes 1 (transition-section.tsx).
  S().setTransitionOut('a', { ...S().project.clips.a.transitionOut!, sfx: 1 })
  assert.ok(timelineSfxEvents(S().project).length > 0, 'given a sound, it sounds')
  // The project's level still rules over it.
  useStore.setState({ project: { ...S().project, transitionSfx: 0 } })
  assert.equal(timelineSfxEvents(S().project).length, 0)
})

test('V2: an older file keeps its transitions\' sound; a file of this format keeps its silent ones', () => {
  const p = project()
  p.clips.a.transitionOut = { type: 'mix', duration: 0.5, to: 'b' }
  p.clips.b.transitionOut = { type: 'whip', duration: 0.5, to: 'c', sfx: 0.4 }
  const old = JSON.parse(serializeProject(p)) as Record<string, unknown>
  old.formatVersion = 6
  const opened = readProjectFile(JSON.stringify(old)).project
  assert.equal(opened.clips.a.transitionOut?.sfx, 1, 'unset in format 6 meant the full sound: written in')
  assert.equal(opened.clips.b.transitionOut?.sfx, 0.4, 'a sound it said is kept')
  assert.ok(timelineSfxEvents(opened).length > 0)
  // Written now (format 7) and opened again: the silent one stays silent.
  const fresh = project()
  fresh.clips.a.transitionOut = { type: 'mix', duration: 0.5, to: 'b' }
  const text = serializeProject(fresh)
  assert.equal((JSON.parse(text) as { formatVersion: number }).formatVersion, CURRENT_FORMAT)
  const again = readProjectFile(text).project
  assert.equal(again.clips.a.transitionOut?.sfx, undefined)
  assert.equal(timelineSfxEvents(again).length, 0)
})

// ---- 3. trading places past the middle (the timeline's drag) ----------------

const DRAG = { insert: 'middle' } as const
const order = (plan: NonNullable<ReturnType<typeof planTimelinePlacement>>, track = 'V1'): string[] => plan.trackClipIds[track]

function row(packed: boolean): Project {
  const p = project()
  p.tracks[0].autoPack = packed || undefined
  // A gap on the free track: a 0–4, b 6–10, c 13–17.
  if (!packed) {
    p.clips.b.start = 6
    p.clips.c.start = 13
  }
  return p
}

test('V3, magnet on: b dragged over a stays after it until its middle passes a\'s', () => {
  const p = row(true)
  // a 0–4, b 4–8, c 8–12 (equal lengths: the middles meet when b is on a).
  for (const d of [-0.5, -2.1, -3.9]) {
    const plan = planTimelinePlacement(p, 'b', ['b'], d, null, null, false, DRAG)!
    assert.deepEqual(order(plan), ['a', 'b', 'c'], `moved ${d}`)
    assert.equal(plan.changed, false)
  }
  // On top of a (its start at a's: the middles meet): before it.
  const past = planTimelinePlacement(p, 'b', ['b'], -4, null, null, false, DRAG)!
  assert.deepEqual(order(past), ['b', 'a', 'c'])
  assert.equal(past.positions.b.start, 0)
  assert.equal(past.positions.a.start, 4)
  // To the right the same: past c's middle only.
  assert.deepEqual(order(planTimelinePlacement(p, 'b', ['b'], 3.9, null, null, false, DRAG)!), ['a', 'b', 'c'])
  const right = planTimelinePlacement(p, 'b', ['b'], 4.1, null, null, false, DRAG)!
  assert.deepEqual(order(right), ['a', 'c', 'b'])
  assert.equal(right.positions.c.start, 4)
  assert.equal(right.positions.b.start, 8)
  // A short clip goes before a long one once its middle passes the long one's.
  const q = row(true)
  q.clips.a.duration = 10
  q.clips.b.start = 10
  q.clips.c.start = 14
  assert.deepEqual(order(planTimelinePlacement(q, 'b', ['b'], -5.9, null, null, false, DRAG)!), ['a', 'b', 'c'])
  assert.deepEqual(order(planTimelinePlacement(q, 'b', ['b'], -7.1, null, null, false, DRAG)!), ['b', 'a', 'c'])
  // The command's planner (an agent's clip.move) keeps its exact rule: a
  // start inside a goes before it.
  assert.deepEqual(order(planTimelinePlacement(p, 'b', ['b'], -0.5, null, null, false)!), ['b', 'a', 'c'])
})

test('V3, magnet off: a little over a neighbour lands against it, nothing else moves', () => {
  const p = row(false)
  // b (6–10) to 3: over a's tail by 1 → right after a, at 4.
  const tail = planTimelinePlacement(p, 'b', ['b'], -3, null, null, false, DRAG)!
  assert.deepEqual(order(tail), ['a', 'b', 'c'])
  assert.equal(tail.positions.b.start, 4)
  assert.equal(tail.positions.a.start, 0)
  assert.equal(tail.positions.c.start, 13)
  // b to 10 (10–14): over c's head by 1 → right before c, at 9; c stays.
  const head = planTimelinePlacement(p, 'b', ['b'], 4, null, null, false, DRAG)!
  assert.deepEqual(order(head), ['a', 'b', 'c'])
  assert.equal(head.positions.b.start, 9)
  assert.equal(head.positions.c.start, 13)
  // b to 0.5 (0.5–4.5): most of it on a, but its middle (2.5) not past a's
  // (2): after a, at 4.
  const most = planTimelinePlacement(p, 'b', ['b'], -5.5, null, null, false, DRAG)!
  assert.deepEqual(order(most), ['a', 'b', 'c'])
  assert.equal(most.positions.b.start, 4)
  // On top of a: it goes in before a, and a makes room.
  const over = planTimelinePlacement(p, 'b', ['b'], -6, null, null, false, DRAG)!
  assert.deepEqual(order(over), ['b', 'a', 'c'])
  assert.equal(over.positions.b.start, 0)
  assert.equal(over.positions.a.start, 4)
  assert.equal(over.positions.c.start, 13)
  // Too little room to land against c without covering a: c makes room.
  const q = row(false)
  q.clips.c.start = 11 // a 0–4, b 6–10, c 11–15
  const tight = planTimelinePlacement(q, 'c', ['c'], -6.5, null, null, false, DRAG)! // c to 4.5 (4.5–8.5) over b's head
  assert.deepEqual(order(tight), ['a', 'c', 'b'])
  assert.equal(tight.positions.c.start, 4.5)
  assert.equal(tight.positions.b.start, 8.5)
})

test('V3: the drag\'s rule through the store gives the plan it showed, and Ctrl+Z gives it back', () => {
  S().loadProject(row(true))
  const plan = planTimelinePlacement(S().project, 'b', ['b'], -1, null, null, false, DRAG)!
  S().applyTimelinePlacement(plan)
  assert.deepEqual(S().project.tracks[0].clipIds, ['a', 'b', 'c'])
  assert.equal(S().project.clips.b.start, 4)
  const swap = planTimelinePlacement(S().project, 'b', ['b'], -4, null, null, false, DRAG)!
  S().selectClips(['b'])
  S().applyTimelinePlacement(swap)
  assert.equal(S().project.clips.b.start, 0)
  assert.equal(S().project.clips.a.start, 4)
  S().undo()
  assert.equal(S().project.clips.b.start, 4)
  assert.deepEqual(S().selectedClipIds, ['b'])
})
