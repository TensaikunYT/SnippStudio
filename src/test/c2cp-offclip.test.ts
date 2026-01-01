// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 6: the volume fader on a keyed clip with the playhead off
// the clip still unmutes; a keyed edit that writes nothing because the
// playhead is off the clip (or line) says so once instead of doing nothing
// silently (Fit / Fill / Center, the Inspector slider, the preview drag, the
// caption motion slider, the mask geometry, the fader).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'
import { STRINGS, t } from '../renderer/src/ui/strings'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'

const S = useStore.getState

function film(extra: Partial<Clip> = {}): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true } as never]
  p.clips.v = { inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, id: 'v', assetId: 'vid', trackId: 'V1', start: 2, duration: 10, ...extra } as Clip
  return p
}

const offClipText = (): number => currentToasts().filter((x) => x.text === t('keyframe.offClip')).length

test('item 6: the fader on a keyed, muted clip with the playhead off the clip unmutes it and says once that no key was written', () => {
  clearToasts()
  S().loadProject(film({ muted: true, volumeKeyframes: [{ id: 'vk', time: 1, value: 0.3 }, { id: 'vk2', time: 6, value: 1 }] }))
  S().setTime(0.5)
  S().dragVolumeKeyframe('v', 0.5)
  S().dragVolumeKeyframe('v', 0.6)
  const c = S().project.clips.v
  assert.equal(c.muted, undefined, 'unmuted')
  assert.deepEqual(c.volumeKeyframes!.map((k) => k.value), [0.3, 1], 'no key written')
  assert.equal(offClipText(), 1, 'told once')
})

test('item 6: Fit / Fill / Center, the Inspector slider, the preview drag, the caption motion slider and the mask geometry say so too', () => {
  const keyed = film({
    channels: { x: [{ id: 'x0', time: 1, value: 10 }, { id: 'x1', time: 5, value: 90 }], scale: [{ id: 's0', time: 1, value: 1 }] },
    mask: { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 100, h: 100, keyframes: [{ id: 'm0', time: 1, cx: 0, cy: 0, w: 100, h: 100 }] }
  } as Partial<Clip>)
  keyed.captions = [{ id: 'title', start: 2, end: 4, text: 'T', layer: 1, manual: true, kfs: [{ id: 'k', time: 0.5, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }] } as Caption]
  const runs: [string, () => void][] = [
    ['fitFrame', () => S().fitFrame('v')],
    ['fillFrame', () => S().fillFrame('v')],
    ['centerClip', () => S().centerClip('v')],
    ['setPropValue', () => S().setPropValue('v', 'x', 50)],
    ['dragClipKeyframe', () => S().dragClipKeyframe('v', { x: 50 })],
    ['setCaptionMotion', () => S().setCaptionMotion('title', { x: 50 })],
    ['editMaskGeom', () => S().editMaskGeom('v', { cx: 50 })]
  ]
  for (const [name, run] of runs) {
    clearToasts()
    S().loadProject(structuredClone(keyed))
    S().setTime(0.5)
    const before = JSON.stringify(S().project)
    run()
    run()
    assert.equal(JSON.stringify(S().project.clips.v.channels), JSON.stringify(JSON.parse(before).clips.v.channels), `${name}: no key written`)
    assert.equal(offClipText(), 1, `${name}: told once`)
  }
  // On the clip: a key, no word.
  clearToasts()
  S().loadProject(structuredClone(keyed))
  S().setTime(5)
  S().setPropValue('v', 'x', 50)
  assert.equal(offClipText(), 0)
  // An unkeyed clip off the playhead: its base changes, no word.
  S().loadProject(film())
  S().setTime(0.5)
  S().centerClip('v')
  assert.equal(offClipText(), 0)
  assert.equal(S().project.clips.v.transform.x, S().project.settings.width / 2)
})

test('item 6: the words are in English and Turkish', () => {
  const s = STRINGS['keyframe.offClip' as keyof typeof STRINGS] as { en: string; tr?: string }
  assert.ok(s.en && s.tr)
})
