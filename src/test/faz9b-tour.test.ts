// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 2 (FAZ9-PLAN.md "9b"): the first-run tour's five steps
// and where its bubble goes. The tour itself is driven in the app by the e2e
// scenario 99-faz9b-firstrun (start to end, and "Skip").
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { placeBubble, TOUR_STEPS } from '../renderer/src/components/Tour'

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

test('five steps in the order of the work: media, timeline, preview, command box and agent, export', () => {
  assert.deepEqual(TOUR_STEPS.map((s) => s.id), ['media', 'timeline', 'preview', 'agent', 'export'])
})

test('the bubble sits beside its part, inside the window', () => {
  const vw = 1366
  const vh = 768
  for (const r of [rect(10, 60, 80, 28), rect(0, 400, 1366, 368), rect(300, 60, 760, 330), rect(1250, 8, 100, 32), rect(1300, 700, 60, 60)]) {
    const p = placeBubble(r, 150, vw, vh)
    assert.ok(p.x >= 8 && p.x + 300 <= vw - 8, `x inside: ${JSON.stringify(p)}`)
    assert.ok(p.y >= 8 && p.y + 150 <= vh - 8, `y inside: ${JSON.stringify(p)}`)
    assert.ok(p.ring, 'the part is outlined')
  }
  // Below a part when it fits.
  assert.equal(placeBubble(rect(10, 60, 80, 28), 150, vw, vh).y, 98)
  // A part that is not there: the bubble in the middle, no outline.
  const none = placeBubble(null, 150, vw, vh)
  assert.equal(none.ring, null)
  assert.equal(none.x, Math.round((vw - 300) / 2))
})
