// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { flattenClips, projectDuration } from '../renderer/src/types'
import type { Clip, Project } from '../renderer/src/types'

/** A plain video clip. Only the fields the functions under test read. */
function clip(over: Partial<Clip> & { id: string }): Clip {
  return {
    assetId: 'a1',
    trackId: 't1',
    start: 0,
    duration: 5,
    inPoint: 0,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    ...over
  } as Clip
}

/**
 * Media time a clip shows at timeline time `t` — the mapping the renderer, the
 * engine and the exporter all use. Clipping a compound's children must not
 * change it for any frame that survives, or the picture and the sound stop
 * agreeing with each other and with the export.
 */
const mediaTimeAt = (c: Clip, t: number): number => (t - c.start) * (c.speed ?? 1) + c.inPoint

test('flattenClips leaves ordinary clips alone', () => {
  const a = clip({ id: 'a', start: 2, duration: 3 })
  assert.deepEqual(flattenClips([a]), [a])
})

test('flattenClips clips compound children to the compound window', () => {
  // A compound covering 10 → 14 whose children run 10 → 12 and 12 → 18: the
  // second one hangs 4s past the end of the box it lives in.
  const parent = clip({
    id: 'p',
    start: 10,
    duration: 4,
    nested: { clips: [clip({ id: 'c1', start: 0, duration: 2 }), clip({ id: 'c2', start: 2, duration: 6 })] }
  } as Partial<Clip> & { id: string })

  const out = flattenClips([parent])
  assert.equal(out.length, 2)
  const [c1, c2] = out
  assert.equal(c1.start, 10)
  assert.equal(c1.duration, 2)
  // Trimmed to the parent's end, not left running past it.
  assert.equal(c2.start, 12)
  assert.equal(c2.duration, 2)
})

test('flattenClips drops children that fall entirely outside', () => {
  const parent = clip({
    id: 'p',
    start: 10,
    duration: 2,
    nested: { clips: [clip({ id: 'inside', start: 0, duration: 1 }), clip({ id: 'after', start: 5, duration: 2 })] }
  } as Partial<Clip> & { id: string })
  const ids = flattenClips([parent]).map((c) => c.id)
  assert.deepEqual(ids, ['inside'])
})

test('a head-trimmed compound advances its children in point by the same amount', () => {
  // The compound was trimmed 1.5s off its head: its children still describe
  // themselves relative to the ORIGINAL start, so the first 1.5s of the first
  // child is outside the box now.
  const child = clip({ id: 'c', start: -1.5, duration: 4, inPoint: 3, speed: 2 })
  const parent = clip({ id: 'p', start: 10, duration: 4, nested: { clips: [child] } } as Partial<Clip> & {
    id: string
  })

  const [out] = flattenClips([parent])
  assert.equal(out.start, 10)
  assert.equal(out.duration, 2.5)
  // 1.5s of timeline at speed 2 = 3s of media.
  assert.equal(out.inPoint, 6)

  // The invariant that matters: every frame that survived still shows the same
  // media it did before the clipping.
  const original = { ...child, start: parent.start + child.start }
  for (const t of [10, 11, 12, 12.4]) {
    assert.ok(
      Math.abs(mediaTimeAt(out, t) - mediaTimeAt(original as Clip, t)) < 1e-9,
      `media time drifted at t=${t}`
    )
  }
})

test('a disabled compound disables everything inside it', () => {
  const parent = clip({
    id: 'p',
    start: 0,
    duration: 5,
    disabled: true,
    nested: { clips: [clip({ id: 'c', start: 0, duration: 5 })] }
  } as Partial<Clip> & { id: string })
  assert.equal(flattenClips([parent])[0].disabled, true)
})

test('projectDuration counts captions, not just clips', () => {
  const project = {
    clips: { a: clip({ id: 'a', start: 0, duration: 3 }) },
    captions: [{ id: 'c', start: 0, end: 9, text: 'hi' }],
    tracks: []
  } as unknown as Project
  assert.equal(projectDuration(project), 9)
})
