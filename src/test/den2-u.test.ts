// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-2, worker U: the transitions' pictures are drawn by the renderer
// from a made-up two-clip project (components/inspector/transition-preview.tsx),
// so each kind's picture is the real thing. Here: that project holds the
// kind, the moment shown at rest lies inside the transition and shows both
// frames (or the dip), and every kind of the table has a project.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { previewProject, previewTime, restProgress } from '../renderer/src/components/inspector/transition-preview'
import { renderList, outgoingTransitionWindow } from '../renderer/src/playback/draw/timing'
import { TRANSITION_KINDS, typeOf } from '../renderer/src/timeline/transition-types'

test('every transition kind has a preview project: A → B with that kind, its window round the cut', () => {
  for (const k of TRANSITION_KINDS) {
    const type = typeOf(k.id)
    const p = previewProject(type)
    assert.equal(p.clips.A.transitionOut?.type, type)
    assert.equal(p.clips.A.transitionOut?.to, 'B')
    const w = outgoingTransitionWindow(p, p.clips.A)
    // (A velocity ramp has no window: it cuts at the edit, its blur the few
    // frames either side; the picture shows half a second round the cut.)
    if (type === 'speed-ramp') assert.equal(w.pre + w.post, 0)
    else assert.ok(w.pre + w.post > 0.3, `${k.id}: a window (${w.pre} + ${w.post})`)
    const half = type === 'speed-ramp' ? 0.25 : 0
    const at = previewTime(p, restProgress(type))
    assert.ok(at > 2 - w.pre - half && at < 2 + w.post + half, `${k.id}: the resting moment ${at} is inside the transition`)
  }
})

test('the resting moment shows the transition at work: both clips are drawn (a dip to black: the outgoing one, darkening)', () => {
  for (const k of TRANSITION_KINDS) {
    const type = typeOf(k.id)
    const p = previewProject(type)
    const ids = renderList(p, previewTime(p, restProgress(type))).map((e) => e.clip.id)
    const list = renderList(p, previewTime(p, restProgress(type)))
    if (type === 'speed-ramp') assert.ok(list.some((e) => e.clip.id === 'A' && e.motionBlur), 'speed ramp: A in its blur before the cut')
    else if (type === 'fade') assert.ok(ids.includes('A'), 'fade: A dipping')
    else assert.ok(ids.includes('A') && ids.includes('B'), `${k.id}: both frames at rest (${ids.join(',')})`)
  }
})

test('the loop starts on A alone and ends on B alone', () => {
  const p = previewProject('mix')
  assert.deepEqual(renderList(p, previewTime(p, 0) - 0.01).map((e) => e.clip.id), ['A'])
  assert.deepEqual(renderList(p, previewTime(p, 1) + 0.01).map((e) => e.clip.id), ['B'])
})
