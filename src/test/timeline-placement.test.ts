// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { NEW_AUDIO_TRACK, planTimelinePlacement } from '../renderer/src/timeline/placement'
import { defaultProject, type Clip } from '../renderer/src/types'

const makeClip = (id: string, trackId: string, start: number, duration: number, linkId?: string): Clip => ({
  id,
  assetId: `asset-${id}`,
  trackId,
  start,
  duration,
  inPoint: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  volume: 1,
  linkId
})

test('with auto-pack off, dropping inside a clip inserts there and previews the ripple', () => {
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = makeClip('a', track.id, 0, 10)
  project.clips.b = makeClip('b', track.id, 12, 4)
  track.clipIds = ['a', 'b']

  const plan = planTimelinePlacement(project, 'b', ['b'], -7, null, null, false)!
  assert.equal(plan.anchorStart, 5)
  assert.deepEqual(plan.trackClipIds[track.id], ['b', 'a'])
  assert.equal(plan.positions.b.start, 5)
  assert.equal(plan.positions.a.start, 9)
  // Planning the ghost must not move the saved timeline before release.
  assert.equal(project.clips.a.start, 0)
  assert.equal(project.clips.b.start, 12)
})

test('with auto-pack off, inserting into a short gap only pushes the following clips', () => {
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = makeClip('a', track.id, 0, 5)
  project.clips.b = makeClip('b', track.id, 10, 5)
  project.clips.c = makeClip('c', track.id, 20, 5)
  track.clipIds = ['a', 'b', 'c']

  const plan = planTimelinePlacement(project, 'c', ['c'], -13, null, null, false)!
  assert.equal(plan.positions.a.start, 0)
  assert.equal(plan.positions.c.start, 7)
  assert.equal(plan.positions.b.start, 12)
  assert.deepEqual(plan.trackClipIds[track.id], ['a', 'c', 'b'])
})

test('a slightly short gap previews an insert at the pointer instead of hiding the image', () => {
  const project = defaultProject()
  const lower = project.tracks[0]
  const upper = { id: 'upper', kind: 'video' as const, name: 'V2', clipIds: ['moving'] }
  project.tracks.unshift(upper)
  project.clips.left = makeClip('left', lower.id, 0, 2)
  project.clips.right = makeClip('right', lower.id, 8, 3)
  project.clips.moving = makeClip('moving', upper.id, 14, 6.05)
  lower.clipIds = ['left', 'right']
  const plan = planTimelinePlacement(project, 'moving', ['moving'], -12, lower.id, null, false)!
  assert.equal(plan.positions.left.start, 0)
  assert.equal(plan.positions.moving.start, 2)
  assert.equal(plan.positions.moving.trackId, lower.id)
  assert.equal(plan.positions.right.start, 8.05)
  assert.deepEqual(plan.trackClipIds[lower.id], ['left', 'moving', 'right'])
  assert.equal(project.clips.moving.start, 14)
})

test('cross-track drop and linked audio show their final positions in the plan', () => {
  const project = defaultProject()
  const video = project.tracks[0]
  const audio = project.tracks[1]
  const overlay = { id: 'overlay', kind: 'video' as const, name: 'V2', clipIds: ['x'] }
  project.tracks.unshift(overlay)
  project.clips.v = makeClip('v', video.id, 20, 4, 'pair')
  project.clips.a = makeClip('a', audio.id, 20, 4, 'pair')
  project.clips.x = makeClip('x', overlay.id, 0, 10)
  video.clipIds = ['v']
  audio.clipIds = ['a']

  const plan = planTimelinePlacement(project, 'v', ['v'], -16, overlay.id, null, true)!
  assert.deepEqual(plan.movedIds.sort(), ['a', 'v'])
  assert.equal(plan.positions.v.start, 4)
  assert.equal(plan.positions.v.trackId, overlay.id)
  assert.equal(plan.positions.x.start, 8)
  assert.equal(plan.positions.a.start, 4)
  assert.equal(plan.positions.a.trackId, audio.id)
  assert.deepEqual(plan.trackClipIds[video.id], [])
})

test('auto-pack position is already visible in the drag plan', () => {
  const project = defaultProject()
  const track = project.tracks[0]
  track.autoPack = true
  project.clips.a = makeClip('a', track.id, 0, 5)
  project.clips.b = makeClip('b', track.id, 5, 5)
  track.clipIds = ['a', 'b']

  const plan = planTimelinePlacement(project, 'b', ['b'], 15, null, null, false)!
  assert.equal(plan.anchorStart, 5)
  assert.equal(plan.changed, false)
})

test('moving a selection preserves its spacing while overlapping neighbours ripple', () => {
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = makeClip('a', track.id, 0, 5)
  project.clips.b = makeClip('b', track.id, 8, 4)
  project.clips.c = makeClip('c', track.id, 20, 3)
  track.clipIds = ['a', 'b', 'c']

  const plan = planTimelinePlacement(project, 'b', ['b', 'c'], -4, null, null, false)!
  assert.equal(plan.positions.b.start, 4)
  assert.equal(plan.positions.c.start, 16)
  assert.equal(plan.positions.a.start, 8)
  assert.deepEqual(plan.trackClipIds[track.id], ['b', 'a', 'c'])
})

test('a locked hover target is ignored instead of silently moving a clip there', () => {
  const project = defaultProject()
  const source = project.tracks[0]
  const locked = { id: 'locked', kind: 'video' as const, name: 'V2', clipIds: [], locked: true }
  project.tracks.unshift(locked)
  project.clips.a = makeClip('a', source.id, 0, 3)
  source.clipIds = ['a']

  const plan = planTimelinePlacement(project, 'a', ['a'], 5, locked.id, null, false)!
  assert.equal(plan.positions.a.trackId, source.id)
  assert.equal(plan.positions.a.start, 5)
  assert.equal(plan.trackClipIds[locked.id], undefined)
})

test('dragging one audio clip below the stack previews its own new layer', () => {
  const project = defaultProject()
  const audio = project.tracks[1]
  project.clips.a = makeClip('a', audio.id, 2, 3)
  audio.clipIds = ['a']

  const plan = planTimelinePlacement(project, 'a', ['a'], 6, null, 'audio', false)!
  assert.equal(plan.newTrack, 'audio')
  assert.equal(plan.anchorStart, 8)
  assert.equal(plan.anchorTrackId, NEW_AUDIO_TRACK)
  assert.deepEqual(plan.trackClipIds[audio.id], [])
  assert.deepEqual(plan.trackClipIds[NEW_AUDIO_TRACK], ['a'])
})

test('dropping between images commits the exact ripple shown during drag', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({}) }
  })
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = makeClip('a', track.id, 0, 5)
  project.clips.b = makeClip('b', track.id, 5, 5)
  project.clips.c = makeClip('c', track.id, 10, 5)
  track.clipIds = ['a', 'b', 'c']
  useStore.getState().loadProject(project)

  const plan = planTimelinePlacement(useStore.getState().project, 'c', ['c'], -5, null, null, false)!
  assert.deepEqual(plan.trackClipIds[track.id], ['a', 'c', 'b'])
  assert.deepEqual(['a', 'c', 'b'].map((id) => plan.positions[id].start), [0, 5, 10])
  useStore.getState().applyTimelinePlacement(plan)
  const committed = useStore.getState().project
  assert.deepEqual(committed.tracks[0].clipIds, plan.trackClipIds[track.id])
  for (const id of track.clipIds) {
    assert.equal(committed.clips[id].start, plan.positions[id].start)
    assert.equal(committed.clips[id].trackId, plan.positions[id].trackId)
  }
})

test('auto-pack toggle closes gaps only when on; off preserves other clips through moves, trims and delete', async () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} }
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({}) }
  })
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = makeClip('a', track.id, 0, 2)
  project.clips.b = makeClip('b', track.id, 5, 2)
  project.clips.c = makeClip('c', track.id, 10, 2)
  track.clipIds = ['a', 'b', 'c']
  project.assets.push({
    id: 'new', name: 'new.png', kind: 'image', url: 'media://new', size: 1,
    duration: 0, width: 1920, height: 1080, hasAudio: false
  })
  useStore.getState().loadProject(project)

  useStore.getState().setTrackFlags(track.id, { autoPack: true })
  useStore.getState().packTrack(track.id)
  assert.deepEqual(['a', 'b', 'c'].map((id) => useStore.getState().project.clips[id].start), [0, 2, 4])

  useStore.getState().setTrackFlags(track.id, { autoPack: false })
  const plan = planTimelinePlacement(useStore.getState().project, 'c', ['c'], 6, null, null, false)!
  useStore.getState().applyTimelinePlacement(plan)
  assert.deepEqual(['a', 'b', 'c'].map((id) => useStore.getState().project.clips[id].start), [0, 2, 10])

  useStore.getState().trimClipEnd('b', 20)
  assert.equal(useStore.getState().project.clips.b.duration, 8)
  assert.equal(useStore.getState().project.clips.c.start, 10)
  useStore.getState().deleteClips(['b'], false)
  assert.equal(useStore.getState().project.clips.c.start, 10)

  useStore.getState().addClipAt('new', track.id, 3)
  const addedId = useStore.getState().project.tracks[0].clipIds.find((id) => !['a', 'c'].includes(id))!
  assert.equal(useStore.getState().project.clips[addedId].start, 3)
  assert.equal(useStore.getState().project.clips.c.start, 10)
  useStore.getState().deleteClips([addedId], false)

  useStore.getState().setTrackFlags(track.id, { autoPack: true })
  useStore.getState().packTrack(track.id)
  assert.equal(useStore.getState().project.clips.c.start, 2)
})
