// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const clip = (id: string, trackId: string, start: number, duration = 5): Clip => ({
  id, assetId: `asset-${id}`, trackId, start, duration, inPoint: 2,
  transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1
})

/** Clips laid on the first video track, each with plenty of media round it. */
function track(project: Project, clips: Clip[]): void {
  const t = project.tracks[0]
  for (const c of clips) {
    project.clips[c.id] = c
    project.assets.push({ id: c.assetId, name: `${c.id}.mp4`, kind: 'video', url: `media://${c.id}`, size: 1, duration: 60, width: 1920, height: 1080, hasAudio: false })
  }
  t.clipIds = clips.map((c) => c.id)
}

test('a short clip with transitions at both ends gives each at most half of itself', async () => {
  const { outgoingTransitionWindow, incomingTransitionInfo } = await import('../renderer/src/playback/render')
  const p = defaultProject()
  const a = clip('a', p.tracks[0].id, 0)
  const b = clip('b', p.tracks[0].id, 5, 0.6)
  const c = clip('c', p.tracks[0].id, 5.6)
  a.transitionOut = { type: 'mix', duration: 1.2 }
  b.transitionOut = { type: 'mix', duration: 1.2 }
  track(p, [a, b, c])
  const ab = outgoingTransitionWindow(p, a)
  const bc = outgoingTransitionWindow(p, b)
  assert.ok(ab.post <= 0.3 + 1e-9, `a→b runs ${ab.post} s into b`)
  assert.ok(bc.pre <= 0.3 + 1e-9, `b→c starts ${bc.pre} s before b ends`)
  assert.ok(Math.abs(ab.duration - (ab.pre + ab.post)) < 1e-9)
  assert.deepEqual(incomingTransitionInfo(p, b), ab)
})

test('a frame of gap still makes one cut: both halves are timed from the same edge', async () => {
  const { outgoingTransitionWindow, incomingTransitionInfo } = await import('../renderer/src/playback/render')
  const p = defaultProject()
  const a = clip('a', p.tracks[0].id, 0)
  const b = clip('b', p.tracks[0].id, 5.033)
  a.transitionOut = { type: 'slide', duration: 1 }
  track(p, [a, b])
  const out = outgoingTransitionWindow(p, a)
  const inc = incomingTransitionInfo(p, b)
  // Same window start on the timeline: a.end - out.pre === b.start - inc.pre.
  assert.ok(Math.abs((a.start + a.duration - out.pre) - (b.start - inc.pre)) < 1e-9)
})

test('a transition with nothing after it is gone, except a fade-out inside the clip', async () => {
  const { outgoingTransitionWindow, renderList } = await import('../renderer/src/playback/render')
  const p = defaultProject()
  const a = clip('a', p.tracks[0].id, 0)
  a.transitionOut = { type: 'wipe', duration: 1 }
  track(p, [a])
  assert.equal(outgoingTransitionWindow(p, a).duration, 0)
  assert.deepEqual(renderList(p, 5.2), [])
  a.transitionOut = { type: 'fade', duration: 1 }
  const w = outgoingTransitionWindow(p, a)
  assert.deepEqual([w.pre, w.post], [1, 0])
  // Black at its end, never a ghost past it.
  const late = renderList(p, 4.99)[0]
  assert.equal(late.alpha, 1)
  assert.ok((late.dip ?? 0) > 0.98)
  assert.deepEqual(renderList(p, 5.2), [])
})

test('fade to black takes the clips down to black instead of showing the track under them', async () => {
  const { renderList } = await import('../renderer/src/playback/render')
  const p = defaultProject()
  const a = clip('a', p.tracks[0].id, 0)
  const b = clip('b', p.tracks[0].id, 5)
  a.transitionOut = { type: 'fade', duration: 1, align: 'center' }
  track(p, [a, b])
  const mid = renderList(p, 4.999)
  const outA = mid.find((e) => e.clip.id === 'a')!
  assert.equal(outA.alpha, 1)
  assert.ok((outA.dip ?? 0) > 0.98)
  const after = renderList(p, 5.25).find((e) => e.clip.id === 'b')!
  assert.equal(after.alpha, 1)
  assert.ok((after.dip ?? 0) > 0.3 && (after.dip ?? 0) < 0.7)
})
