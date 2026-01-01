// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 4 (auditors' probes C, D, E): time put in by a freeze
// frame moves a manual title after it (it stayed behind while the footage,
// the markers and the trackers moved on) and the keys of a title or a map
// block running through it (their keys after the hold stayed, so the motion
// ran ahead of the footage); a ripple moves a template's exit (`cut`) with
// the block it is timed in.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Caption, type Clip, type Project, type TemplateBlock } from '../renderer/src/types'
import { rippleTemplates } from '../renderer/src/templates/model'

const S = useStore.getState

function film(): Project {
  const p = defaultProject()
  p.settings.fps = 30
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['v'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'v', url: 'media://v', size: 1, duration: 100, width: 10, height: 10, hasAudio: false } as never]
  p.clips.v = { inPoint: 0, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, id: 'v', assetId: 'vid', trackId: 'V1', start: 0, duration: 20 } as Clip
  return p
}

test('item 4 (probe C): a freeze frame moves a manual title after the hold with the footage, as the markers', () => {
  const p = film()
  p.captions = [{ id: 'title', start: 15, end: 17, text: 'T', layer: 1, manual: true } as Caption]
  p.markers = [{ id: 'm', time: 15, color: '#fff', note: '' }]
  S().loadProject(p)
  S().setTime(10)
  useStore.setState({ selectedClipIds: ['v'] })
  S().insertFreezeFrame(2)
  const q = S().project
  assert.equal(q.markers![0].time, 17)
  assert.equal(q.captions[0].start, 17, 'the title moves with the footage like the marker')
  assert.equal(q.captions[0].end, 19)
})

test('item 4 (probe E): a freeze frame inside a keyed title and a map block moves their keys after the hold', () => {
  const p = film()
  p.captions = [{ id: 'title', start: 6, end: 16, text: 'T', layer: 1, manual: true, kfs: [{ id: 'k1', time: 3, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }, { id: 'k2', time: 8, x: 600, y: 50, scale: 2, rot: 0, opacity: 1 }] } as Caption]
  p.templates = [{ id: 'map', kind: 'atlas', start: 4, duration: 14, items: [], cut: 13, cams: [{ t: 2, lon: 0, lat: 0, z: 2 }, { t: 12, lon: -20, lat: 40, z: 3 }] } as unknown as TemplateBlock]
  S().loadProject(p)
  S().setTime(13)
  useStore.setState({ selectedClipIds: ['v'] })
  S().insertFreezeFrame(2)
  const q = S().project
  const cap = q.captions[0]
  const map = q.templates![0]
  assert.deepEqual(cap.kfs!.map((k) => cap.start + k.time), [9, 16], 'title keys: the one before the hold stays, the one after (timeline 14) moves on')
  assert.deepEqual([cap.start, cap.end], [6, 18], 'the title is held as long as the footage')
  assert.deepEqual(map.cams!.map((k) => map.start + k.t), [6, 18], 'map keys: timeline 16 → 18')
  assert.deepEqual([map.start, map.duration, map.start + map.cut!], [4, 16, 19], 'the block is held too; its exit (timeline 17) moves on')
})

test('item 4 (probe D): a template cut through its head moves its exit (`cut`) with the content it was timed to', () => {
  const p = defaultProject()
  p.templates = [{ id: 't', kind: 'atlas', start: 4, duration: 14, items: [], cut: 10, cams: [{ t: 10, lon: 0, lat: 0, z: 2 }] } as unknown as TemplateBlock]
  rippleTemplates(p, 2, 6)
  const b = p.templates![0]
  assert.equal(b.cut, b.cams![0].t, 'the exit moves with the content it was timed to')
  assert.equal(b.start + b.cut!, 10, 'timeline 14 → 10')
})

test('item 4: an exit inside the cut lands at the join', () => {
  const p = defaultProject()
  p.templates = [{ id: 't', kind: 'atlas', start: 0, duration: 20, items: [], cut: 9 } as unknown as TemplateBlock]
  rippleTemplates(p, 8, 10)
  assert.equal(p.templates![0].cut, 8)
})
