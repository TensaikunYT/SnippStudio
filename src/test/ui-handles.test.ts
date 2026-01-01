// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Round 10: the canvas handles, one set of rules for the editor's preview
// (src/renderer/src/ui/handles.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { degLabel, knobAt, resizeBox, snapAngle, turnFrom } from '../renderer/src/ui/handles'
import { scaleClipFromCorner } from '../renderer/src/playback/clip-grip'

const DEG = Math.PI / 180
const near = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('a turn snaps: Shift to 15° steps, right angles catch within 4°, the rest is free', () => {
  near(snapAngle(40 * DEG, true), 45 * DEG)
  near(snapAngle(-52 * DEG, true), -45 * DEG)
  near(snapAngle(3 * DEG, false), 0)
  near(snapAngle(88 * DEG, false), 90 * DEG)
  near(snapAngle(-183 * DEG, false), -180 * DEG)
  near(snapAngle(40 * DEG, false), 40 * DEG)
  near(snapAngle(5 * DEG, false), 5 * DEG)
})

test('a turn goes round the middle: no jump on grab, no jump across the left side', () => {
  const c: [number, number] = [100, 100]
  // Grabbed at the knob above the middle: still there, the angle is as it was.
  near(turnFrom(c, [100, 50], [100, 50], 0.3), 0.3)
  // Grabbed anywhere (the knob's rim): only how far round counts.
  near(turnFrom(c, [104, 50], [104, 50], 0.3), 0.3)
  // A quarter turn clockwise (screen y is down): from above to the right.
  near(turnFrom(c, [100, 50], [150, 100], 0), 90 * DEG)
  // Dragged across the left side (170° → −170°): +20°, not −340°.
  const a = (deg: number): [number, number] => [100 + 50 * Math.cos(deg * DEG), 100 + 50 * Math.sin(deg * DEG)]
  near(turnFrom(c, a(170), a(-170), 0), 20 * DEG)
  // The distance from the middle does not matter.
  near(turnFrom(c, [100, 90], [300, 100], 0), 90 * DEG)
})

test('the angle shown: whole degrees between −180° and 180°', () => {
  assert.equal(degLabel(0), '0°')
  assert.equal(degLabel(-0.0001), '0°')
  assert.equal(degLabel(30 * DEG), '30°')
  assert.equal(degLabel(-45 * DEG), '−45°')
  assert.equal(degLabel(190 * DEG), '−170°')
  assert.equal(degLabel(180 * DEG), '180°')
  assert.equal(degLabel(-180 * DEG), '180°')
  assert.equal(degLabel(725 * DEG), '5°')
})

test('the knob sits over the top edge, turns with the box, goes under it at the top of the preview', () => {
  // Upright: 26 px over the top edge's middle.
  const up = knobAt(200, 200, 50, 0)
  assert.deepEqual(up.base, [200, 150])
  assert.deepEqual(up.knob, [200, 124])
  assert.equal(up.below, false)
  // Turned a quarter clockwise: the box's top faces right.
  const right = knobAt(200, 200, 50, 90 * DEG)
  near(right.knob[0], 276)
  near(right.knob[1], 200)
  // Near the preview's top: under the bottom edge instead.
  const low = knobAt(200, 60, 50, 0)
  assert.equal(low.below, true)
  assert.deepEqual(low.knob, [200, 136])
  // Filling the preview (neither fits): just inside the top edge.
  const full = knobAt(200, 200, 195, 0, 8, 26, 392)
  assert.equal(full.inside, true)
  assert.deepEqual(full.knob, [200, 31])
})

test('a box resized from a handle: the opposite side stays, Shift keeps its shape', () => {
  const box = { l: -100, t: -50, r: 100, b: 50 }
  // The south-east corner dragged out: the north-west corner stays.
  assert.deepEqual(resizeBox(box, 'se', 140, 90, false), { l: -100, t: -50, r: 140, b: 90 })
  // An edge: only that side moves.
  assert.deepEqual(resizeBox(box, 'w', -160, 999, false), { l: -160, t: -50, r: 100, b: 50 })
  // Shift on a corner: both sides grow by the larger pull (2:1 kept).
  const k = resizeBox(box, 'se', 140, 60, true)
  assert.deepEqual(k, { l: -100, t: -50, r: 140, b: 70 })
  assert.equal((k.r - k.l) / (k.b - k.t), 2)
  // Shift on the north-west corner: grown from the south-east one.
  const nw = resizeBox(box, 'nw', -300, -50, true)
  assert.deepEqual(nw, { l: -300, t: -150, r: 100, b: 50 })
  // Shift on an edge: the other side grows round the middle.
  assert.deepEqual(resizeBox(box, 'e', 300, 0, true), { l: -100, r: 300, t: -100, b: 100 })
  assert.deepEqual(resizeBox(box, 'n', 0, -150, true), { t: -150, b: 50, l: -200, r: 200 })
  // Never smaller than the minimum, and never turned inside out.
  const tiny = resizeBox(box, 'e', -500, 0, false, 4)
  assert.equal(tiny.r - tiny.l, 4)
})

test('a picture sized from its corner keeps the grab: no jump on the first move', () => {
  const start = { x: 100, y: 100, scale: 1, rotation: 0.4 }
  // Pressed 3 px off the corner and not moved yet: nothing changes.
  const still = scaleClipFromCorner(start, 50, 30, 1, 1, { x: 160, y: 140 }, { x: 160, y: 140 })
  near(still.scale, 1)
  near(still.x, 100)
  near(still.y, 100)
})

