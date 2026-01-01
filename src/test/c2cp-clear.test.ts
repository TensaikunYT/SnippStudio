// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 7 (auditors' "Clear all keyframes…"): "Clear all keyframes"
// clears what the Inspector counts: the clip's channel keys and every key off
// the clip (volume and mask included); the volume and mask keys on the clip
// belong to their own sections.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { keysOffClip } from '../renderer/src/components/timeline/shared'
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

test('item 7 (auditors\' "Clear all keyframes…"): it clears every key the Inspector counts, off-clip volume and mask keys included', () => {
  S().loadProject(film({
    channels: { x: [{ id: 'x0', time: 1, value: 0 }, { id: 'x1', time: 14, value: 9 }] },
    volumeKeyframes: [{ id: 'v0', time: 0, value: 1 }, { id: 'v1', time: 12, value: 0 }],
    mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 100, h: 100, keyframes: [{ id: 'm0', time: -2, cx: 0, cy: 0, w: 100, h: 100 }, { id: 'm1', time: 5, cx: 500, cy: 0, w: 100, h: 100 }] }
  } as Partial<Clip>))
  assert.deepEqual(keysOffClip(S().project.clips.v), { before: 1, after: 2 })
  S().clearClipKeyframes('v')
  const c = S().project.clips.v
  assert.deepEqual(keysOffClip(c), { before: 0, after: 0 }, 'nothing counted off the clip any more')
  assert.equal(c.channels, undefined)
  assert.deepEqual(c.volumeKeyframes!.map((k) => k.id), ['v0'], 'the volume key on the clip is the Volume section\'s')
  assert.deepEqual(c.mask!.keyframes!.map((k) => k.id), ['m1'], 'the mask key on the clip is the Mask section\'s')
})
