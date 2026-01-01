// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 5 (auditors' probe F): Alt+K on a video clip only adds the
// keys "Keyframe all" adds, so it only looks at (and deletes) those: a volume
// key on the playhead's frame stays. On an audio clip it toggles the volume key.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState

function film(extra: Partial<Clip> = {}): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true } as never]
  p.clips.v = { inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, id: 'v', assetId: 'vid', trackId: 'V1', start: 2, duration: 10, ...extra } as Clip
  return p
}

test('item 5 (probe F): Alt+K on a video clip with a volume key on the playhead keys the picture and keeps the volume key', () => {
  S().loadProject(film({ volumeKeyframes: [{ id: 'vk', time: 3, value: 0.3 }, { id: 'vk2', time: 6, value: 1 }] }))
  S().setTime(5)
  useStore.setState({ selectedClipIds: ['v'], selectedCaptionIds: [] })
  const r = S().toggleKeyframeAtPlayhead()
  const c = S().project.clips.v
  assert.ok(r > 0, 'it added keys')
  assert.deepEqual(c.volumeKeyframes!.map((k) => k.id), ['vk', 'vk2'], 'the volume key stays')
  assert.equal(c.channels?.x?.length, 1, '"Keyframe all" keys')
  // Pressed again: those keys go, the volume key stays.
  assert.ok(S().toggleKeyframeAtPlayhead() < 0)
  assert.equal(S().project.clips.v.channels, undefined)
  assert.deepEqual(S().project.clips.v.volumeKeyframes!.map((k) => k.id), ['vk', 'vk2'])
})

test('item 5: on an audio clip Alt+K still toggles its volume key', () => {
  const p = film()
  p.tracks = [{ id: 'A1', kind: 'audio', name: 'A1', clipIds: ['v'] }]
  p.clips.v.trackId = 'A1'
  p.clips.v.volumeKeyframes = [{ id: 'vk', time: 3, value: 0.3 }]
  S().loadProject(p)
  S().setTime(5)
  useStore.setState({ selectedClipIds: ['v'], selectedCaptionIds: [] })
  assert.ok(S().toggleKeyframeAtPlayhead() < 0)
  assert.equal(S().project.clips.v.volumeKeyframes, undefined)
})
