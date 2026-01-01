// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K3 (tarifler\FAZ3C-YERLESIM.md): what a press on the empty N
// lane does. A plain drag is the ruler's (the playhead); only Shift + drag
// marks a range for a note; other buttons do nothing on the lane itself.
import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmptyLaneTarget, lanePress, markSnapOff } from '../renderer/src/components/note-lane-gesture'

test('the empty lane: press → what it starts', () => {
  const table: [number, boolean, string][] = [
    [0, false, 'scrub'],
    [0, true, 'mark'],
    [1, false, 'ignore'],
    [1, true, 'ignore'],
    [2, false, 'ignore'],
    [2, true, 'ignore'],
    [3, false, 'ignore'],
    [4, true, 'ignore']
  ]
  for (const [button, shiftKey, want] of table) assert.equal(lanePress({ button, shiftKey }), want, `button ${button}, shift ${shiftKey}`)
})

test('while marking, Alt (not Shift) turns snapping off', () => {
  assert.equal(markSnapOff({ altKey: false }), false)
  assert.equal(markSnapOff({ altKey: true }), true)
})

test('only the empty lane counts for double click and "Note here"', () => {
  const at = (hit: string | null) => ({ closest: (sel: string) => (hit && sel.split(', ').includes(hit) ? {} : null) })
  assert.equal(isEmptyLaneTarget(at(null)), true)
  assert.equal(isEmptyLaneTarget(at('.tl-note-block')), false)
  assert.equal(isEmptyLaneTarget(at('.tl-note-touched')), false)
  assert.equal(isEmptyLaneTarget(at('.tl-track-label')), false)
  assert.equal(isEmptyLaneTarget(null), false)
})
