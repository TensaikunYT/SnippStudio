// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, items 1 and 2 (auditors' probes A and B, `key-drag.ts`): only
// the diamond the user grabbed may take the place of a key on the frame it is
// dropped on. The other keys a ripple drag carries along stop before they
// would land on a key (the delta is held, frame by frame, towards the press);
// an Alt copy never removes or moves an original key.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { dragKeys } from '../renderer/src/timeline/key-drag'
import type { ClipChannels } from '../renderer/src/types'

const span = { start: 0, duration: 10 }
const fps = 30
const rows = (c: ClipChannels): [string, number][] => (c.x ?? []).map((k) => [k.id, +k.time.toFixed(6)])
function noTwins(c: ClipChannels): void {
  const ts = (c.x ?? []).map((k) => k.time).sort((a, b) => a - b)
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] - ts[i - 1] >= 0.5 / fps, `two keys on one frame at ${ts[i]}`)
}

test('item 1 (probe A): a ripple drag never deletes a key the grabbed diamond was not dropped on', () => {
  const base: ClipChannels = { x: [{ id: 'still', time: 1.5, value: 7 }, { id: 'drag', time: 2, value: 1 }, { id: 'tail', time: 2.5, value: 2 }] }
  const out = dragKeys({ base, keys: [{ ch: 'x', id: 'drag' }], from: 2, ripple: true }, 1, span, fps)
  assert.ok(out.x!.some((k) => k.id === 'still' && k.time === 1.5), 'the key at 1.5 s stays where it was')
  noTwins(out)
  // The delta stops one frame short: the carried key would have landed on 1.5.
  assert.deepEqual(rows(out), [['drag', 1.033333], ['still', 1.5], ['tail', 1.533333]])
})

test('item 1: the grabbed diamond still takes the place of the key it is dropped on (ripple and plain)', () => {
  const base: ClipChannels = { x: [{ id: 'still', time: 1, value: 7 }, { id: 'drag', time: 2, value: 1 }, { id: 'tail', time: 4, value: 2 }] }
  const ripple = dragKeys({ base, keys: [{ ch: 'x', id: 'drag' }], from: 2, ripple: true }, 1, span, fps)
  assert.deepEqual(rows(ripple), [['drag', 1], ['tail', 3]], 'dropped on 1 s: the grabbed key replaces it; the carried key lands on no key')
  const plain = dragKeys({ base, keys: [{ ch: 'x', id: 'drag' }], from: 2 }, 4, span, fps)
  assert.deepEqual(rows(plain), [['still', 1], ['drag', 4]])
})

test('item 1: the old ripple action (no grabbed keys) deletes nothing either', () => {
  const base: ClipChannels = { x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 2, value: 1 }, { id: 'c', time: 3, value: 2 }] }
  const out = dragKeys({ base, keys: [], from: 2, ripple: true }, 1, span, fps)
  assert.equal(out.x!.length, 3, 'no key lost')
  noTwins(out)
})

test('item 2 (probe B): an Alt+Ctrl ripple copy keeps every original where it was', () => {
  const base: ClipChannels = { x: [{ id: 'k2', time: 2, value: 1 }, { id: 'k3', time: 3, value: 2 }, { id: 'k4', time: 4, value: 3 }] }
  const out = dragKeys({ base, keys: [{ ch: 'x', id: 'k2' }], from: 2, ripple: true, copies: { ids: { k2: 'c2', k3: 'c3', k4: 'c4' } } }, 3, span, fps)
  for (const o of base.x!) assert.ok(out.x!.some((k) => k.id === o.id && k.time === o.time && k.value === o.value), `the original ${o.id} stays at ${o.time}`)
  noTwins(out)
  assert.deepEqual(out.x!.filter((k) => k.id.startsWith('c')).map((k) => k.id).sort(), ['c2', 'c3', 'c4'], 'the copies are made')
})

test('item 2: an Alt copy dropped on an original of its own does not remove it', () => {
  const base: ClipChannels = { x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 2, value: 1 }] }
  const out = dragKeys({ base, keys: [{ ch: 'x', id: 'a' }, { ch: 'x', id: 'b' }], from: 1, copies: { ids: { a: 'a2', b: 'b2' } } }, 2, span, fps)
  assert.ok(out.x!.some((k) => k.id === 'a' && k.time === 1))
  assert.ok(out.x!.some((k) => k.id === 'b' && k.time === 2))
  noTwins(out)
})
