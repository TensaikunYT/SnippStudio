// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.2, decision 5 (report D9): from key to key and a key at the
// playhead. The keys of the selected clips and titles (every one when none
// is selected), on their clip; Alt+, / Alt+. (Alt+Left / Alt+Right nudge the
// selection) and Alt+K, under new ids in the shortcut list.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { keyTimes, stepKey } from '../renderer/src/timeline/key-nav'
import { ACTIONS, defaultBindings } from '../renderer/src/shortcuts'
import { STRINGS } from '../renderer/src/ui/strings'

const s = useStore.getState

function project(): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['m'] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: true } as never,
    { id: 'aud', kind: 'audio', name: 'a', url: 'media://a', size: 1, duration: 100 } as never
  ]
  const base = { inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  p.clips.a = { ...base, id: 'a', assetId: 'vid', trackId: 'V1', start: 0, duration: 5, channels: { x: [{ id: 'x0', time: -1, value: 0 }, { id: 'x1', time: 1, value: 1 }, { id: 'x2', time: 4, value: 2 }] }, volumeKeyframes: [{ id: 'v', time: 2.5, value: 1 }] } as Clip
  p.clips.b = { ...base, id: 'b', assetId: 'vid', trackId: 'V1', start: 6, duration: 4, mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 1, h: 1, keyframes: [{ id: 'mk', time: 1, cx: 0, cy: 0, w: 1, h: 1 }] } } as Clip
  p.clips.m = { ...base, id: 'm', assetId: 'aud', trackId: 'A1', start: 0, duration: 10 } as Clip
  p.captions = [{ id: 't', start: 2, end: 8, text: 'T', layer: 1, manual: true, kfs: [{ id: 'k', time: 1.5, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }] }]
  return p
}

test('D9: the key times of the selected clips and titles, on their clip; every one when none is selected', () => {
  const p = project()
  assert.deepEqual(keyTimes(p, ['a']), [1, 2.5, 4], 'channels and volume, not the key off the clip')
  assert.deepEqual(keyTimes(p, ['b']), [7], 'the mask')
  assert.deepEqual(keyTimes(p, [], ['t']), [3.5], 'a title')
  assert.deepEqual(keyTimes(p), [1, 2.5, 3.5, 4, 7])
  assert.equal(stepKey(keyTimes(p), 2.5, 1), 3.5)
  assert.equal(stepKey(keyTimes(p), 2.5, -1), 1)
  assert.equal(stepKey(keyTimes(p), 7, 1), undefined)
})

test('D9: a key at the playhead, and off again, each one undo step', () => {
  s().loadProject(project())
  useStore.setState({ selectedClipIds: ['a', 'm'], selectedCaptionIds: ['t'] })
  s().setTime(3)
  const depth = s().past.length
  assert.equal(s().toggleKeyframeAtPlayhead(), 3)
  assert.equal(s().past.length, depth + 1, 'one step for the clip, the sound and the title')
  assert.deepEqual(s().project.clips.a.channels!.x!.map((k) => k.time), [-1, 1, 3, 4])
  assert.deepEqual(s().project.clips.m.volumeKeyframes!.map((k) => k.time), [3])
  assert.deepEqual(s().project.captions[0].kfs!.map((k) => k.time), [1, 1.5])
  assert.equal(s().toggleKeyframeAtPlayhead(), -3)
  assert.equal(s().past.length, depth + 2)
  assert.deepEqual(s().project.clips.a.channels!.x!.map((k) => k.time), [-1, 1, 4])
  assert.equal(s().project.clips.m.volumeKeyframes, undefined)
  assert.deepEqual(s().project.captions[0].kfs!.map((k) => k.time), [1.5])
  // The playhead on nothing selected: nothing, no step.
  s().setTime(9)
  useStore.setState({ selectedClipIds: ['a'], selectedCaptionIds: [] })
  assert.equal(s().toggleKeyframeAtPlayhead(), 0)
  assert.equal(s().past.length, depth + 2)
})

test('D9: the shortcuts are in the list under new ids, Alt+, / Alt+. / Alt+K, free, named in both languages', () => {
  const ids = ACTIONS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length, 'ids are unique')
  const b = defaultBindings()
  assert.equal(b.prevKeyframe, 'alt+,')
  assert.equal(b.nextKeyframe, 'alt+.')
  assert.equal(b.toggleKeyframe, 'alt+k')
  // (A review's own keys, read only while one is open, may be a global
  // action's too: ONIZLEME-UYGULA-PLAN.md, K1. Among the global ones, none.)
  const keys = ACTIONS.filter((a) => !a.scope).map((a) => b[a.id])
  assert.equal(new Set(keys).size, keys.length, 'no two actions share a default key')
  for (const id of ['prevKeyframe', 'nextKeyframe', 'toggleKeyframe']) {
    const a = ACTIONS.find((x) => x.id === id)!
    const words = STRINGS[a.labelKey!] as { en: string; tr?: string }
    assert.ok(words.en && words.tr, `${id}: en + tr`)
  }
})
