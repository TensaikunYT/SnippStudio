// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cila A (editing in the preview): the rules behind the handles (their reach,
// the drag threshold, the cursors, a resize from the middle, the crop's box),
// the one write per pointer move (setPropValues), the arrow nudge as one undo
// step, and Esc taking a drag back. The same in a real window, with a real
// pointer: scripts/e2e/scenarios/92-preview-feel.mjs, 93-preview-crop.mjs,
// 94-preview-mask.mjs.
import { fixture, hash, resetWorld, tick } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'
import { t } from '../renderer/src/ui/strings'
import { DRAG_THRESHOLD, HANDLE_HIT, HANDLE_SIZE, handleReach, nearestHandle, nearestOnSegment, pastThreshold, resizeBox, resizeCursor, turnCursor } from '../renderer/src/ui/handles'
import { scaleClipFromCentre, scaleClipFromCorner } from '../renderer/src/playback/clip-grip'
import { CROP_MAX, cropBox, cropFromHandle, cropMoved, cropOfBox } from '../renderer/src/components/preview/crop'
import { gestureMark, takeBackGesture } from '../renderer/src/components/preview/gesture'

const S = useStore.getState
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

function world(time = 2.5): void {
  resetWorld()
  S().loadProject(fixture())
  useStore.setState({ dirty: false, currentTime: time, selectedClipIds: [], selectedCaptionIds: [] })
}

// ---- the handles ------------------------------------------------------------------

test('a handle is 12 px, takes a press 16 px round it, and less on a small box', () => {
  assert.equal(HANDLE_SIZE, 12)
  assert.equal(HANDLE_HIT, 16)
  assert.equal(handleReach(400), 16)
  // A 30 px box keeps its middle third for picking it up.
  assert.equal(handleReach(30), 10)
  assert.equal(handleReach(6), 8)
})

test('the nearest handle within reach takes the press, not the first in the list', () => {
  const pts: [number, number][] = [[0, 0], [20, 0], [20, 20], [0, 20]]
  // 3 px from the second, 17 from the first: both within a 16 px square of… the second only.
  assert.equal(nearestHandle(pts, 17, 2), 1)
  // Between two (9 and 11 px away): the nearer.
  assert.equal(nearestHandle(pts, 9, 0), 0)
  assert.equal(nearestHandle(pts, 11, 0), 1)
  assert.equal(nearestHandle(pts, 60, 60), -1)
  assert.equal(nearestHandle(pts, 16, 16, 3), -1)
})

test('a drag starts 4 px from the press', () => {
  assert.equal(DRAG_THRESHOLD, 4)
  assert.equal(pastThreshold(100, 100, 102, 102), false)
  assert.equal(pastThreshold(100, 100, 103, 103), true)
  assert.equal(pastThreshold(100, 100, 104, 100), true)
  assert.equal(pastThreshold(100, 100, 100, 96.5), false)
})

test('the resize cursor lies along the pull, on a turned box too', () => {
  const deg = (d: number): number => (d * Math.PI) / 180
  assert.equal(resizeCursor(0), 'ew-resize')
  assert.equal(resizeCursor(deg(45)), 'nwse-resize') // right and down
  assert.equal(resizeCursor(deg(90)), 'ns-resize')
  assert.equal(resizeCursor(deg(135)), 'nesw-resize')
  assert.equal(resizeCursor(deg(-135)), 'nwse-resize') // the opposite corner: the same line
  assert.equal(resizeCursor(deg(180)), 'ew-resize')
  // A bottom-right corner on a box turned 45°: it now pulls straight down.
  assert.equal(resizeCursor(deg(45) + deg(45)), 'ns-resize')
  // …and turned 90°, along the other diagonal.
  assert.equal(resizeCursor(deg(45) + deg(90)), 'nesw-resize')
})

test('the turn cursor is a drawn arrow, turned with the box in 15° steps', () => {
  const up = turnCursor(0)
  assert.match(up, /^url\("data:image\/svg\+xml,/)
  assert.match(up, / 12 12, grab$/)
  assert.equal(turnCursor(0.05), up, 'within the same step: the same cursor')
  assert.notEqual(turnCursor(Math.PI / 2), up)
  assert.equal(turnCursor(Math.PI * 2), up, 'a whole turn is the same way')
  assert.match(decodeURIComponent(turnCursor(Math.PI / 2)), /rotate\(90 12 12\)/)
})

test('the nearest point of a segment', () => {
  assert.deepEqual(nearestOnSegment([0, 0], [10, 0], [4, 3]), { x: 4, y: 0, d: 3 })
  assert.deepEqual(nearestOnSegment([0, 0], [10, 0], [-5, 0]), { x: 0, y: 0, d: 5 })
  assert.deepEqual(nearestOnSegment([2, 2], [2, 2], [5, 6]), { x: 2, y: 2, d: 5 })
})

test('a box resized from its middle (Alt): the opposite side moves the same way out', () => {
  const box = { l: -50, r: 50, t: -20, b: 20 }
  assert.deepEqual(resizeBox(box, 'e', 80, 0, false, 4, true), { l: -80, r: 80, t: -20, b: 20 })
  assert.deepEqual(resizeBox(box, 'nw', -60, -30, false, 4, true), { l: -60, r: 60, t: -30, b: 30 })
  // With Shift it keeps its shape too.
  assert.deepEqual(resizeBox(box, 'se', 100, 0, true, 4, true), { l: -100, r: 100, t: -40, b: 40 })
  assert.deepEqual(resizeBox(box, 's', 0, 40, true, 4, true), { l: -100, r: 100, t: -40, b: 40 })
  // Never smaller than the least size, and the same as before without it.
  assert.deepEqual(resizeBox(box, 'e', -500, 0, false, 4, true), { l: -2, r: 2, t: -20, b: 20 })
  assert.deepEqual(resizeBox(box, 'e', 80, 0, false, 4), { l: -50, r: 80, t: -20, b: 20 })
})

test('a clip sized from its middle (Alt): the middle stays, the held corner follows the pointer', () => {
  const start = { x: 500, y: 300, scale: 1, rotation: 0 }
  const out = scaleClipFromCentre(start, 100, 50, 1, 1, { x: 600, y: 350 }, { x: 700, y: 400 })
  assert.ok(near(out.x, 500) && near(out.y, 300), 'the middle stays')
  assert.ok(near(out.scale, 2), `twice the size (${out.scale})`)
  // The corner pull keeps the opposite corner instead, and grows half as fast.
  const corner = scaleClipFromCorner(start, 100, 50, 1, 1, { x: 600, y: 350 }, { x: 700, y: 400 })
  assert.ok(near(corner.scale, 1.5))
  assert.ok(near(corner.x - 100 * corner.scale, 400), 'the opposite corner stays')
  // No jump at the press, whichever corner, turned or not.
  for (const rot of [0, 0.7, -2.1]) for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const still = scaleClipFromCentre({ ...start, rotation: rot }, 100, 50, qx, qy, { x: 7, y: 9 }, { x: 7, y: 9 })
    assert.ok(near(still.scale, 1) && near(still.x, 500) && near(still.y, 300))
  }
  // Pushed through the middle it never turns inside out.
  assert.ok(scaleClipFromCentre(start, 100, 50, 1, 1, { x: 600, y: 350 }, { x: 0, y: 0 }).scale > 0)
})

// ---- the crop ---------------------------------------------------------------------

test('the crop box and back: the Inspector\'s four numbers, a flipped clip mirrored', () => {
  const crop = { l: 0.1, t: 0.2, r: 0.3, b: 0.05 }
  const box = cropBox(crop, 1000, 500)
  assert.deepEqual(box, { l: -400, r: 200, t: -150, b: 225 })
  assert.deepEqual(cropOfBox(box, 1000, 500), crop)
  // Flipped sideways: what is cut from the media's left shows on the right.
  const flipped = cropBox(crop, 1000, 500, true, false)
  assert.deepEqual(flipped, { l: -200, r: 400, t: -150, b: 225 })
  assert.deepEqual(cropOfBox(flipped, 1000, 500, true, false), crop)
  assert.deepEqual(cropBox(undefined, 1000, 500), { l: -500, r: 500, t: -250, b: 250 })
})

test('a crop handle moves its side; the opposite side stays; never past the media or 45 %', () => {
  const W = 1000, H = 500
  // The right side pulled in by 200 px: 20 % off the right.
  assert.deepEqual(cropFromHandle(undefined, 'e', 300, 0, W, H), { l: 0, t: 0, r: 0.2, b: 0 })
  // A corner: two sides.
  assert.deepEqual(cropFromHandle(undefined, 'nw', -400, -200, W, H), { l: 0.1, t: 0.1, r: 0, b: 0 })
  // Out of the media: no crop; too far in: 45 %.
  assert.deepEqual(cropFromHandle({ l: 0.1, t: 0, r: 0, b: 0 }, 'w', -900, 0, W, H), { l: 0, t: 0, r: 0, b: 0 })
  assert.equal(cropFromHandle(undefined, 'e', -400, 0, W, H).r, CROP_MAX)
  // On a flipped clip the drawn right side is the media's left.
  assert.deepEqual(cropFromHandle(undefined, 'e', 300, 0, W, H, { flipH: true }), { l: 0.2, t: 0, r: 0, b: 0 })
})

test('Shift keeps the crop\'s shape, Alt works from its middle', () => {
  const W = 1000, H = 500
  // From the full picture (2 : 1): the bottom right corner pulled in, more
  // across than down (the larger pull counts, as on every box: resizeBox).
  const kept = cropFromHandle(undefined, 'se', 400, 180, W, H, { keepRatio: true })
  const box = cropBox(kept, W, H)
  assert.ok(near((box.r - box.l) / (box.b - box.t), 2, 1e-2), `2 : 1 kept (${JSON.stringify(kept)})`)
  assert.deepEqual([kept.l, kept.t], [0, 0], 'the opposite corner stays')
  assert.deepEqual([kept.r, kept.b], [0.1, 0.1])
  // Alt: both sides alike.
  assert.deepEqual(cropFromHandle(undefined, 'e', 400, 0, W, H, { centre: true }), { l: 0.1, t: 0, r: 0.1, b: 0 })
  assert.deepEqual(cropFromHandle(undefined, 'se', 400, 200, W, H, { centre: true }), { l: 0.1, t: 0.1, r: 0.1, b: 0.1 })
})

test('the crop window slides inside the media and keeps its size', () => {
  const W = 1000, H = 500
  const crop = { l: 0.1, t: 0.1, r: 0.2, b: 0.1 }
  assert.deepEqual(cropMoved(crop, 100, 0, W, H), { l: 0.2, t: 0.1, r: 0.1, b: 0.1 })
  // Never past the media's edge: the right inset ends at 0.
  assert.deepEqual(cropMoved(crop, 900, -900, W, H), { l: 0.3, t: 0, r: 0, b: 0.2 })
  // Nothing cropped: nowhere to slide.
  assert.deepEqual(cropMoved(undefined, 300, 300, W, H), { l: 0, t: 0, r: 0, b: 0 })
  // A flipped clip: the drawn way round.
  assert.deepEqual(cropMoved(crop, 100, 0, W, H, true), { l: 0, t: 0.1, r: 0.3, b: 0.1 })
})

// ---- one write per move ------------------------------------------------------------

test('setPropValues writes the channels as one change, each the way setPropValue writes it', () => {
  // Not keyed: the base values.
  world()
  S().setPropValue('ov', 'x', 700)
  S().setPropValue('ov', 'y', 250)
  S().setPropValue('ov', 'scale', 0.8)
  const want = hash(S().project)
  world()
  const seq = S().editSeq
  S().setPropValues('ov', { x: 700, y: 250, scale: 0.8 })
  assert.equal(hash(S().project), want)
  assert.equal(S().editSeq, seq + 1, 'one write, not three')
  assert.equal(S().past.length, 1, 'one undo step')

  // Keyed (cb's scale has keys; the playhead on it): a key for scale, the base for x.
  world(12)
  S().setPropValue('cb', 'scale', 1.1)
  S().setPropValue('cb', 'x', 333)
  const wantKeyed = hash(S().project)
  world(12)
  S().setPropValues('cb', { scale: 1.1, x: 333 })
  assert.equal(hash(S().project), wantKeyed)
  assert.equal(S().project.clips.cb.channels!.scale!.length, 3, 'a key at the playhead')
  assert.equal(S().project.clips.cb.transform.x, 333)
})

test('setPropValues with the playhead off a keyed clip: no key, said once, the channels without keys still written', () => {
  world(2.5)
  clearToasts()
  const keys = JSON.stringify(S().project.clips.cb.channels)
  S().setPropValues('cb', { scale: 2, x: 444 })
  S().setPropValues('cb', { scale: 2.5, x: 445 })
  assert.equal(JSON.stringify(S().project.clips.cb.channels), keys, 'no key written')
  assert.equal(S().project.clips.cb.transform.x, 445, 'x has no keys: written')
  assert.equal(currentToasts().filter((x) => x.text === t('keyframe.offClip')).length, 1, 'told once')
  // Nothing to write at all: nothing happens.
  const seq = S().editSeq
  S().setPropValues('cb', { scale: 3 })
  S().setPropValues('nobody', { x: 1 })
  S().setPropValues('ov', {})
  assert.equal(S().editSeq, seq)
})

test('a drag in the preview is one undo step: armed at the press, a write per frame, closed at the release', () => {
  world()
  const before = hash(S().project)
  S().armGesture()
  for (let k = 1; k <= 30; k++) S().setPropValues('ov', { x: 1400 - k * 10, y: 300 + k * 4 }, false)
  S().endGesture()
  assert.equal(S().past.length, 1)
  assert.deepEqual([S().project.clips.ov.transform.x, S().project.clips.ov.transform.y], [1100, 420])
  S().undo()
  assert.equal(hash(S().project), before)
  // A press released without a move: no step.
  S().armGesture()
  S().endGesture()
  assert.equal(S().past.length, 0)
})

test('arrow nudges that follow each other are one undo step; another edit or a pause ends the run', () => {
  world()
  const before = hash(S().project)
  const key = 'nudge:ov'
  for (let k = 1; k <= 5; k++) {
    const x = S().project.clips.ov.transform.x
    S().setPropValues('ov', { x: x + 1, y: 300 }, true, key)
    tick(120)
  }
  assert.equal(S().project.clips.ov.transform.x, 1405)
  assert.equal(S().past.length, 1, 'five presses, one step')
  S().undo()
  assert.equal(hash(S().project), before, 'one undo takes all five back')
  S().redo()
  // After a pause the next press is its own step.
  tick(2000)
  S().setPropValues('ov', { x: 1415, y: 300 }, true, key)
  assert.equal(S().past.length, 2)
  // Another edit in between ends the run as well.
  tick(100)
  S().setClipVolume('ca', 0.5)
  tick(100)
  S().setPropValues('ov', { x: 1416, y: 300 }, true, key)
  assert.equal(S().past.length, 4)
})

// ---- Esc takes a drag back ---------------------------------------------------------

test('Esc: the drag is taken back, no undo step is left and the redo steps are as they were', () => {
  world()
  // A redo step waiting: an edit made and undone.
  S().setClipVolume('ca', 0.4)
  S().undo()
  assert.equal(S().future.length, 1)
  const before = hash(S().project)
  const past0 = S().past.length

  useStore.setState({ selectedClipIds: ['ov'] })
  const mark = gestureMark()
  S().armGesture()
  for (let k = 1; k <= 8; k++) S().setPropValues('ov', { x: 1400 - k * 20, y: 300 + k * 5, scale: 0.4 + k * 0.01 }, false)
  assert.notEqual(hash(S().project), before)
  assert.equal(S().future.length, 0, 'an edit clears the redo steps…')
  assert.equal(takeBackGesture(mark), true)

  assert.equal(hash(S().project), before, 'the project as it was at the press')
  assert.equal(S().past.length, past0, 'no undo step')
  assert.equal(S().future.length, 1, '…and Esc gives them back')
  assert.deepEqual(S().selectedClipIds, ['ov'], 'what was picked stays picked (undo alone would drop it)')
  S().redo()
  assert.equal(S().project.clips.ca.volume, 0.4, 'redo still redoes the edit before the drag')

  // The next edit is a step of its own (the window closed).
  S().setClipVolume('ca', 0.9)
  assert.equal(S().past.length, past0 + 2)
})

test('Esc on a press that moved nothing takes nothing back', () => {
  world()
  S().setClipVolume('ca', 0.4)
  const past0 = S().past.length
  const before = hash(S().project)
  const mark = gestureMark()
  S().armGesture()
  assert.equal(takeBackGesture(mark), false)
  assert.equal(S().past.length, past0, 'the edit before the press is not undone')
  assert.equal(hash(S().project), before)
  assert.equal(takeBackGesture(undefined), false)
})
