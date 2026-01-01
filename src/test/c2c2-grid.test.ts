// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 1 (report K7, D4): every key writer puts its key on
// the frame grid and merges only with a key on the same frame (half a
// frame), so two neighbouring frames hold two keys.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project, type TemplateBlock } from '../renderer/src/types'
import { setAtlasKey } from '../renderer/src/templates/model'
import { gridLocal, keyLocalAt, keyMergeWindow, onFrameGrid } from '../renderer/src/timeline/key-grid'

const s = useStore.getState

function project(fps: number): Project {
  const p = defaultProject()
  p.settings.fps = fps
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['a'] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: true } as never,
    { id: 'aud', kind: 'audio', name: 'a', url: 'media://a', size: 1, duration: 100 } as never
  ]
  const clip = (id: string, assetId: string, trackId: string): Clip =>
    ({ id, assetId, trackId, start: 0, inPoint: 0, duration: 10, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 }) as Clip
  p.clips.v = { ...clip('v', 'vid', 'V1'), mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 100, h: 100 } }
  p.clips.a = clip('a', 'aud', 'A1')
  p.captions = [{ id: 'cap', start: 0, end: 10, text: 'Title', layer: 1, manual: true }]
  p.mode = 'shorts'
  return p
}

/** Two writes one frame apart (frame 30 and 31) through `write`. */
function twoFrames(fps: number, write: () => void, times: () => number[]): number[] {
  useStore.getState().loadProject(project(fps))
  s().setTime(30 / fps)
  write()
  s().setTime(31 / fps)
  write()
  return times()
}

for (const fps of [24, 25, 30, 60]) {
  const f30 = 30 / fps
  const f31 = 31 / fps
  const near = (got: number[], want: number[]): void => {
    assert.equal(got.length, want.length, `${fps} fps: ${JSON.stringify(got)}`)
    got.forEach((g, i) => assert.ok(Math.abs(g - want[i]) < 1e-9, `${fps} fps: ${g} vs ${want[i]}`))
  }

  test(`K7 (${fps} fps): a clip's channels hold a key on each of two neighbouring frames`, () => {
    near(twoFrames(fps, () => s().addClipKeyframe('v'), () => s().project.clips.v.channels!.scale!.map((k) => k.time)), [f30, f31])
    // A value set on a keyed channel one frame on is a key of its own too.
    s().setTime(32 / fps)
    s().setPropValue('v', 'scale', 2)
    assert.equal(s().project.clips.v.channels!.scale!.length, 3)
  })

  test(`K7 (${fps} fps): a mask holds a key on each of two neighbouring frames`, () => {
    near(twoFrames(fps, () => s().addMaskKeyframe('v'), () => s().project.clips.v.mask!.keyframes!.map((k) => k.time)), [f30, f31])
    // Moving the mask one frame on writes a key there (it overwrote the last).
    s().setTime(32 / fps)
    s().editMaskGeom('v', { cx: 40 })
    assert.equal(s().project.clips.v.mask!.keyframes!.length, 3)
  })

  test(`K7 (${fps} fps): a sound's volume holds a key on each of two neighbouring frames`, () => {
    near(twoFrames(fps, () => s().addVolumeKeyframe('a'), () => s().project.clips.a.volumeKeyframes!.map((k) => k.time)), [f30, f31])
    s().setTime(32 / fps)
    s().dragVolumeKeyframe('a', 0.2)
    assert.equal(s().project.clips.a.volumeKeyframes!.length, 3)
  })

  test(`K7 (${fps} fps): a tracker holds a key on each of two neighbouring frames`, () => {
    useStore.getState().loadProject(project(fps))
    s().setTime(30 / fps)
    const id = s().addTracker()
    s().dragTracker(id, 31 / fps, 10, 10)
    s().dragTracker(id, 32 / fps, 20, 20)
    near(s().project.trackers![0].keyframes.map((k) => k.time), [f30, f31, 32 / fps])
  })

  test(`K7 (${fps} fps): the Shorts pan holds a key on each of two neighbouring frames`, () => {
    near(twoFrames(fps, () => s().addShortsKeyframe(), () => s().project.shorts!.keyframes.map((k) => k.time)), [f30, f31])
    s().setTime(32 / fps)
    s().dragShorts(300)
    assert.equal(s().project.shorts!.keyframes.length, 3)
  })

  test(`K7 (${fps} fps): a title's motion holds a key on each of two neighbouring frames`, () => {
    near(twoFrames(fps, () => s().addCaptionKeyframe('cap'), () => s().project.captions[0].kfs!.map((k) => k.time)), [f30, f31])
    s().setTime(32 / fps)
    s().setCaptionMotion('cap', { x: 40 })
    assert.equal(s().project.captions[0].kfs!.length, 3)
  })

  test(`K7 (${fps} fps): a map camera holds a key on each of two neighbouring frames`, () => {
    const b = { id: 'm', kind: 'atlas', start: 0, duration: 10, items: [], cams: [] } as unknown as TemplateBlock
    setAtlasKey(b, f30, { lon: 0, lat: 0, z: 2 }, fps)
    setAtlasKey(b, f31, { lon: 1, lat: 0, z: 2 }, fps)
    near(b.cams!.map((k) => k.t), [f30, f31])
    setAtlasKey(b, f31 + 0.4 / fps, { lon: 2, lat: 0, z: 2 }, fps)
    assert.equal(b.cams!.length, 2, 'a write on the same frame replaces the key there')
  })
}

test('decision 1: a key is written on the frame the playhead is on, and merges only on that frame', () => {
  useStore.getState().loadProject(project(30))
  // Between frames 30 and 31, nearer 30.
  s().setTime(1.013)
  s().addClipKeyframe('v')
  assert.ok(Math.abs(s().project.clips.v.channels!.x![0].time - 1) < 1e-9, 'on frame 30')
  // Under half a frame from it: the same key.
  s().setTime(1 + 0.4 / 30)
  s().addClipKeyframe('v')
  assert.equal(s().project.clips.v.channels!.x!.length, 1)
  // A clip that starts between frames: its keys lie on the timeline's frames.
  const p = project(30)
  p.clips.v.start = 0.01
  useStore.getState().loadProject(p)
  s().setTime(1.005)
  s().addClipKeyframe('v')
  assert.ok(Math.abs(0.01 + s().project.clips.v.channels!.x![0].time - 1) < 1e-9, 'timeline frame 30')
})

test('the grid helpers', () => {
  assert.equal(keyMergeWindow(30), 0.5 / 30)
  assert.equal(onFrameGrid(1.02, 25), 1.04)
  assert.ok(Math.abs(gridLocal(0.99, 0.01, 30) - 0.99) < 1e-12)
  assert.equal(keyLocalAt({ start: 2, duration: 3 }, 1.9, 30), null, 'the playhead before the clip')
  assert.equal(keyLocalAt({ start: 2, duration: 3 }, 5.1, 30), null, 'after it')
  assert.equal(keyLocalAt({ start: 2, duration: 3 }, 5, 30), 3)
})
