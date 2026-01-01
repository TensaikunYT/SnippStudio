// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline search (KOLAY-PLAN.md, item 2): clips by their media's name,
// subtitles and texts by their words, markers, notes; letter case, accents
// and Turkish's dotted / dotless i do not count; timeline order; nothing for
// an empty query; the project is not changed.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fold, searchTimeline, SEARCH_MAX } from '../renderer/src/timeline/search'
import type { Project } from '../renderer/src/types'

function project(): Project {
  const T = { x: 960, y: 540, scale: 1, rotation: 0 }
  return {
    assets: [
      { id: 'a1', kind: 'video', name: 'İstanbul köprü.mp4', path: 'C:\\m\\a1.mp4', url: 'media://a1', size: 1, duration: 30, width: 1920, height: 1080, hasAudio: true },
      { id: 'a2', kind: 'audio', name: 'music bed.wav', path: 'C:\\m\\a2.wav', url: 'media://a2', size: 1, duration: 30, hasAudio: true }
    ],
    tracks: [
      { id: 'V1', kind: 'video', name: 'V1', clipIds: ['c2', 'c1'] },
      { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['c3'] }
    ],
    clips: {
      c1: { id: 'c1', assetId: 'a1', trackId: 'V1', start: 0, inPoint: 0, duration: 5, transform: T, volume: 1 },
      c2: { id: 'c2', assetId: 'a1', trackId: 'V1', start: 12, inPoint: 5, duration: 5, transform: T, volume: 1 },
      c3: { id: 'c3', assetId: 'a2', trackId: 'A1', start: 0, inPoint: 0, duration: 20, transform: T, volume: 1 }
    },
    captions: [
      { id: 's1', start: 2, end: 4, text: 'Köprünün üstünde ISTANBUL vardı' },
      { id: 't1', start: 6, end: 8, text: 'Bölüm iki', manual: true, layer: 1 },
      { id: 'sh', start: 1, end: 2, text: 'istanbul', shape: { type: 'rect' } as never, layer: 1 }
    ],
    markers: [{ id: 'm1', time: 9, color: '#ff0000', note: 'music drop here', label: 'Drop' }],
    notes: [{ id: 'n1', num: 3, start: 15, end: 16, kind: 'fix', text: 'Make the bridge shot brighter', status: 'open' } as never],
    settings: { width: 1920, height: 1080, fps: 30 }
  } as unknown as Project
}

test('search: fold drops case and accents, ı and İ are i', () => {
  assert.equal(fold('İSTANBUL'), 'istanbul')
  assert.equal(fold('Istanbul'), 'istanbul')
  assert.equal(fold('Köprü  Üstü'), 'kopru ustu')
})

test('search: clips by name, lines by words, markers, notes; in timeline order', () => {
  const p = project()
  const before = JSON.stringify(p)
  const hits = searchTimeline(p, 'istanbul')
  assert.deepEqual(hits.map((h) => [h.kind, h.id, h.at]), [['clip', 'c1', 0], ['subtitle', 's1', 2], ['clip', 'c2', 12]])
  assert.equal(hits[0].media, 'video')
  assert.equal(hits[0].trackId, 'V1')
  assert.deepEqual(searchTimeline(p, 'BÖLÜM').map((h) => [h.kind, h.id]), [['text', 't1']])
  assert.deepEqual(searchTimeline(p, 'drop').map((h) => [h.kind, h.id, h.name]), [['marker', 'm1', 'Drop · music drop here']])
  assert.deepEqual(searchTimeline(p, 'music').map((h) => [h.kind, h.id]), [['clip', 'c3'], ['marker', 'm1']])
  assert.deepEqual(searchTimeline(p, 'bridge').map((h) => [h.kind, h.id, h.name]), [['note', 'n1', '#3 Make the bridge shot brighter']])
  assert.deepEqual(searchTimeline(p, '   '), [])
  assert.deepEqual(searchTimeline(p, 'nothing like it'), [])
  assert.equal(JSON.stringify(p), before, 'the project is not changed')
})

test('search: a long line is shown around its match; at most SEARCH_MAX hits', () => {
  const p = project()
  p.captions = [{ id: 'long', start: 1, end: 2, text: `${'word '.repeat(40)}needle ${'more '.repeat(40)}` }]
  const [h] = searchTimeline(p, 'needle')
  assert.ok(h.name.includes('needle') && h.name.startsWith('…') && h.name.endsWith('…') && h.name.length <= 62, h.name)
  p.captions = Array.from({ length: SEARCH_MAX + 50 }, (_, i) => ({ id: `c${i}`, start: i, end: i + 0.5, text: 'same words' }))
  assert.equal(searchTimeline(p, 'same').length, SEARCH_MAX)
})
