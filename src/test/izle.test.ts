// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch-and-note mode's pure parts (Desktop\SnippStudio\IZLE-PLAN.md):
// the one primary button, the strip's measure, the place of the note's box,
// the clock, and the keys that still work while watching.
import assert from 'node:assert/strict'
import test from 'node:test'
import { bubblePlace, primaryOf, stripTime, stripX, WATCH_KEYS, watchClock, watchSpan } from '../renderer/src/components/watch/watch-math'
import { ACTIONS, defaultBindings } from '../renderer/src/shortcuts'
import { bindingClashes, presetBindings, PRESETS } from '../renderer/src/shortcuts-presets'

test('one primary button: access, then the draft, then the review, then send', () => {
  assert.equal(primaryOf({ access: false, draft: true, ready: 3 }), 'access')
  assert.equal(primaryOf({ access: true, draft: true, ready: 3 }), 'draft')
  assert.equal(primaryOf({ access: true, draft: false, ready: 2 }), 'review')
  assert.equal(primaryOf({ access: true, draft: false, ready: 0 }), 'send')
})

test('the strip: a second and its x go both ways, clamped to the film', () => {
  const L = 78, W = 900, P = 10
  assert.equal(stripX(0, L, W, P), P)
  assert.equal(stripX(L, L, W, P), W - P)
  assert.equal(stripX(-5, L, W, P), P)
  assert.equal(stripX(L + 9, L, W, P), W - P)
  for (const s of [0, 1.5, 39, 77.9]) assert.ok(Math.abs(stripTime(stripX(s, L, W, P), L, W, P) - s) < 1e-9, String(s))
  assert.equal(stripTime(0, L, W, P), 0)
  assert.equal(stripTime(W + 50, L, W, P), L)
})

test('the clock: whole seconds; a range only when it is half a second or more', () => {
  assert.equal(watchClock(0), '0:00')
  assert.equal(watchClock(47.9), '0:47')
  assert.equal(watchClock(725), '12:05')
  assert.equal(watchClock(3723), '1:02:03')
  assert.equal(watchSpan({ start: 29, end: 34.2 }), '0:29–0:34')
  assert.equal(watchSpan({ start: 11, end: 11 }), '0:11')
})

test('the box: beside its pin, on the left when the right has no room, inside the area', () => {
  const frame = { left: 0, top: 40, w: 1000, h: 562 }
  const area = { w: 1000, h: 640 }
  const a = bubblePlace({ frame, area, pin: [0.5, 0.3], at: 0, bw: 240, bh: 96 })
  assert.equal(a.left, 524)
  const b = bubblePlace({ frame, area, pin: [0.95, 0.3], at: 0, bw: 240, bh: 96 })
  assert.ok(b.left + 240 <= 950 - 24 + 1 && b.left >= 8, JSON.stringify(b))
  const c = bubblePlace({ frame, area, pin: [0.5, 0.99], at: 0, bw: 240, bh: 96 })
  assert.ok(c.top + 96 <= area.h - 8)
  // No pin: on the film's lower edge, at the playhead.
  const d = bubblePlace({ frame, area, pin: null, at: 0.5, bw: 240, bh: 96 })
  assert.equal(d.left, 380)
  assert.equal(d.top, 40 + 562 - 96 - 12)
  const e = bubblePlace({ frame, area, pin: null, at: 1, bw: 240, bh: 96 })
  assert.equal(e.left, 1000 - 240 - 8)
})

test('the keys that still work while watching are actions, and none of them edits', () => {
  const ids = new Set(ACTIONS.map((a) => a.id))
  for (const k of WATCH_KEYS) assert.ok(ids.has(k), k)
  for (const k of ['delete', 'split', 'splitTool', 'trimLeft', 'trimRight', 'closeGap', 'undo', 'redo', 'cutter', 'toggleDisable', 'addTransition']) assert.equal((WATCH_KEYS as readonly string[]).includes(k), false, k)
})

test('Shift+R is the mode\'s key and clashes with nothing, in any preset', () => {
  assert.equal(defaultBindings().watchMode, 'shift+r')
  for (const p of PRESETS) for (const os of ['win32', 'darwin', 'linux'] as const) {
    const b = presetBindings(p.id, os)
    assert.deepEqual(bindingClashes(b), [], `${p.id} ${os}`)
    assert.equal(b.watchMode, 'shift+r', `${p.id} ${os}`)
  }
})
