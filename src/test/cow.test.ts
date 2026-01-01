// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { isDraft, produce } from '../renderer/src/state/cow'

const base = () => ({
  clips: { a: { id: 'a', start: 0, fx: { k: [1, 2, 3] } }, b: { id: 'b', start: 5, fx: { k: [4] } } },
  tracks: [{ id: 't1', clipIds: ['a', 'b'] }, { id: 't2', clipIds: [] as string[] }],
  captions: [{ id: 'c1', text: 'hi' }]
})

test('an edit that writes nothing gives back the very same project', () => {
  const b = base()
  const out = produce(b, (d) => {
    void d.clips.a.fx.k[0]
    void d.tracks.map((t) => t.id)
    void JSON.stringify(d)
  })
  assert.equal(out, b)
})

test('only the path written to is copied; everything else is shared, the base untouched', () => {
  const b = base()
  const snap = JSON.stringify(b)
  const out = produce(b, (d) => {
    d.clips.a.start = 2
  })
  assert.notEqual(out, b)
  assert.notEqual(out.clips, b.clips)
  assert.notEqual(out.clips.a, b.clips.a)
  assert.equal(out.clips.a.fx, b.clips.a.fx)
  assert.equal(out.clips.b, b.clips.b)
  assert.equal(out.tracks, b.tracks)
  assert.equal(out.captions, b.captions)
  assert.equal(out.clips.a.start, 2)
  assert.equal(JSON.stringify(b), snap)
  assert.equal(isDraft(out.clips.a), false)
})

test('arrays: push, splice, sort, filter-and-assign, length', () => {
  const b = base()
  const out = produce(b, (d) => {
    d.tracks[1].clipIds.push('x', 'y')
    d.tracks[0].clipIds.splice(0, 1)
    d.tracks.sort((p, q) => (p.id < q.id ? 1 : -1))
    d.captions = d.captions.filter((c) => c.id !== 'c1')
    d.clips.a.fx.k.length = 1
  })
  assert.deepEqual(out.tracks.map((t) => t.id), ['t2', 't1'])
  assert.deepEqual(out.tracks[0].clipIds, ['x', 'y'])
  assert.deepEqual(out.tracks[1].clipIds, ['b'])
  assert.deepEqual(out.captions, [])
  assert.deepEqual(out.clips.a.fx.k, [1])
  assert.deepEqual(b.tracks.map((t) => t.id), ['t1', 't2'])
  assert.deepEqual(b.clips.a.fx.k, [1, 2, 3])
  assert.ok(Array.isArray(out.tracks) && !isDraft(out.tracks[0]))
})

test('new objects holding drafts, deletes, moves and structuredClone inside an edit', () => {
  const b = base()
  const out = produce(b, (d) => {
    const copy = { ...d.clips.a, id: 'c', start: 9 }
    ;(d.clips as Record<string, unknown>).c = copy
    ;(d.clips as Record<string, unknown>).deep = structuredClone(d.clips.b)
    delete (d.clips as Record<string, unknown>).b
    d.clips.a.fx.k.push(7)
  })
  const clips = out.clips as Record<string, { id: string; start: number; fx: { k: number[] } }>
  assert.equal(clips.b, undefined)
  assert.equal(clips.c.start, 9)
  assert.equal(isDraft(clips.c.fx), false)
  // The spread copy shares the fx it was spread from, as written then.
  assert.deepEqual(clips.deep, { id: 'b', start: 5, fx: { k: [4] } })
  assert.notEqual(clips.deep.fx, b.clips.b.fx)
  assert.deepEqual(clips.a.fx.k, [1, 2, 3, 7])
  assert.deepEqual(b.clips.a.fx.k, [1, 2, 3])
  assert.ok('b' in b.clips)
})

test('a store edit keeps every part it did not touch', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const { defaultProject } = await import('../renderer/src/types')
  const p = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  p.assets.push({ id: 'x', kind: 'video', name: 'x.mp4', url: '', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true })
  for (const id of ['a', 'b']) {
    p.clips[id] = { id, assetId: 'x', trackId: v1.id, start: id === 'a' ? 0 : 10, duration: 10, inPoint: 0, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 } }
    v1.clipIds.push(id)
  }
  p.captions.push({ id: 'c', start: 1, end: 2, text: 'one' })
  useStore.getState().loadProject(p)
  const before = useStore.getState().project
  useStore.getState().setClipVolume('a', 0.5)
  const after = useStore.getState().project
  assert.notEqual(after, before)
  assert.equal(after.clips.a.volume, 0.5)
  assert.equal(before.clips.a.volume, 1)
  assert.equal(after.clips.b, before.clips.b)
  assert.equal(after.captions, before.captions)
  assert.equal(after.tracks, before.tracks)
  assert.equal(after.assets, before.assets)
})
