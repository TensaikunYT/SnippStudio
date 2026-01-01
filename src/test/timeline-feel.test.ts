// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.T (the timeline's feel): the arithmetic of the view. The lane
// height steps, zooming about a fixed point, fitting the film, when a press
// becomes a drag, how a drag at the edge scrolls.
import assert from 'node:assert/strict'
import test from 'node:test'
import { DRAG_START_PX, ZOOM_MAX, ZOOM_MIN, clampZoom, dragStarted, edgeScrollSpeed, fitZoom, heldBox, heldNeed, laneHeight, nextTrackScale, ownHeightFor, timeAtViewX, trackScaleOf, trimDelta, wheelZoom, zoomBetween, zoomScrollLeft } from '../renderer/src/timeline/view-math'
import { TIMELINE_HEADER_W, defaultTrackHeight } from '../renderer/src/types'

test('lane heights: medium is the geometry as it was; large is 1.5 and 1.4 times; small fits more lanes', () => {
  assert.equal(laneHeight('video', undefined, 'medium'), defaultTrackHeight('video'))
  assert.equal(laneHeight('audio', undefined, 'medium'), defaultTrackHeight('audio'))
  assert.equal(laneHeight('video', undefined, 'large'), Math.round(defaultTrackHeight('video') * 1.5))
  assert.equal(laneHeight('audio', undefined, 'large'), Math.round(defaultTrackHeight('audio') * 1.4))
  assert.equal(laneHeight('video', undefined, 'small'), 42)
  assert.equal(laneHeight('audio', undefined, 'small'), 34)
  // A lane dragged to its own height keeps it at medium and scales with the step.
  assert.equal(laneHeight('video', 100, 'medium'), 100)
  assert.equal(laneHeight('video', 100, 'large'), 150)
  // Never too thin to hold a clip.
  assert.equal(laneHeight('audio', 30, 'small'), 24)
})

test('lane heights: the resize grip sets the height the lane is drawn at, at any step', () => {
  for (const scale of ['small', 'medium', 'large'] as const) {
    for (const kind of ['video', 'audio'] as const) {
      const own = ownHeightFor(kind, 90, scale)
      assert.equal(laneHeight(kind, own, scale), 90, `${kind} at ${scale}`)
    }
  }
})

test('lane heights: the steps stop at their ends; a saved word that is none of them is medium', () => {
  assert.equal(nextTrackScale('small', -1), 'small')
  assert.equal(nextTrackScale('small', 1), 'medium')
  assert.equal(nextTrackScale('medium', 1), 'large')
  assert.equal(nextTrackScale('large', 1), 'large')
  assert.equal(nextTrackScale('large', -1), 'medium')
  assert.equal(trackScaleOf('large'), 'large')
  assert.equal(trackScaleOf('small'), 'small')
  assert.equal(trackScaleOf('medium'), 'medium', 'a height chosen before is kept')
  assert.equal(trackScaleOf(null), 'small', 'a new profile starts small (DENEME-3)')
  assert.equal(trackScaleOf('huge'), 'small')
})

test('zoom: the time under the pointer stays under it', () => {
  const viewX = 700
  for (const [px, scroll, next] of [[60, 0, 72], [60, 4000, 30], [5, 120, 600], [600, 90000, 1]] as const) {
    const time = timeAtViewX(viewX, scroll, px, TIMELINE_HEADER_W)
    const left = zoomScrollLeft(time, viewX, next, TIMELINE_HEADER_W)
    // Where the scroll is not held at 0, the same time is under the same x.
    if (left > 0) assert.ok(Math.abs(timeAtViewX(viewX, left, next, TIMELINE_HEADER_W) - time) < 1e-9, `${px} -> ${next}`)
    else assert.ok(time * next + TIMELINE_HEADER_W <= viewX + 1e-9)
  }
})

test('zoom: one range for the wheel, the slider and the keys; the wheel is continuous', () => {
  assert.equal(clampZoom(9000), ZOOM_MAX)
  assert.equal(clampZoom(0), ZOOM_MIN)
  assert.equal(wheelZoom(590, -400), ZOOM_MAX)
  assert.equal(wheelZoom(1.2, 4000), ZOOM_MIN)
  // Two small steps are one of twice the travel (a trackpad's many events).
  assert.ok(Math.abs(wheelZoom(wheelZoom(60, -10), -10) - wheelZoom(60, -20)) < 1e-9)
  // In and out by the same travel comes back.
  assert.ok(Math.abs(wheelZoom(wheelZoom(60, -100), 100) - 60) < 1e-9)
})

test('zoom: fit shows the whole film; the glide starts where it was and ends where it goes', () => {
  const px = fitZoom(600, 1810, TIMELINE_HEADER_W)
  assert.ok(600 * px <= 1810 - TIMELINE_HEADER_W)
  assert.ok(600 * px > 1810 - TIMELINE_HEADER_W - 30)
  assert.equal(fitZoom(0.01, 1810, TIMELINE_HEADER_W), ZOOM_MAX)
  assert.equal(zoomBetween(40, 160, 0), 40)
  assert.equal(zoomBetween(40, 160, 1), 160)
  let last = 40
  for (let i = 1; i <= 10; i++) {
    const z = zoomBetween(40, 160, i / 10)
    assert.ok(z > last && z <= 160, `step ${i}`)
    last = z
  }
})

test('a press is a drag after 4 px of travel, in either direction', () => {
  assert.equal(DRAG_START_PX, 4)
  assert.equal(dragStarted(3, 3), false)
  assert.equal(dragStarted(4, 0), true)
  assert.equal(dragStarted(-4, 0), true)
  assert.equal(dragStarted(0, -5), true)
  assert.equal(dragStarted(0, 0), false)
})

test('edge scrolling: none outside the zone, faster deeper in, faster the longer it is held, by time not by event', () => {
  assert.equal(edgeScrollSpeed(0, 60, 500, 16), 0)
  assert.equal(edgeScrollSpeed(-5, 60, 500, 16), 0)
  const shallow = edgeScrollSpeed(10, 60, 0, 16)
  const deep = edgeScrollSpeed(60, 60, 0, 16)
  assert.ok(shallow > 0 && deep > shallow * 3)
  assert.ok(edgeScrollSpeed(60, 60, 1200, 16) > deep * 2)
  // Past the edge is the edge; a long hold stops growing.
  assert.equal(edgeScrollSpeed(300, 60, 0, 16), deep)
  assert.equal(edgeScrollSpeed(60, 60, 5000, 16), edgeScrollSpeed(60, 60, 1200, 16))
  // Two frames of 8 ms scroll as far as one of 16 ms.
  assert.ok(Math.abs(edgeScrollSpeed(30, 60, 300, 8) * 2 - edgeScrollSpeed(30, 60, 300, 16)) < 1e-9)
  // A stalled frame does not throw the view across the film.
  assert.equal(edgeScrollSpeed(60, 60, 0, 900), edgeScrollSpeed(60, 60, 0, 50))
})

test("a trim's label: which way and how far", () => {
  assert.deepEqual(trimDelta(0.5), { sign: '+', abs: '0.50' })
  assert.deepEqual(trimDelta(-1.234), { sign: '−', abs: '1.23' })
  assert.deepEqual(trimDelta(0), { sign: '+', abs: '0.00' })
})

test('while a zoom is under way a drawing is stretched in place; else it is drawn', () => {
  const drawn = { from: 300, w: 2000, px: 60 }
  const all = { from: 700, to: 700 }
  // Twice the zoom: the same stretch of the clip is twice as far in and twice as wide.
  assert.deepEqual(heldBox(true, drawn, 120, all), { left: 600, width: 4000 })
  assert.deepEqual(heldBox(true, drawn, 30, all), { left: 150, width: 1000 })
  // No zoom under way, nothing drawn yet, or the zoom it was drawn at: draw.
  assert.equal(heldBox(false, drawn, 120, all), null)
  assert.equal(heldBox(true, null, 120, all), null)
  assert.equal(heldBox(true, drawn, 60, all), null)
  // Zoomed so far out that the old drawing no longer covers what is in view: draw.
  assert.equal(heldBox(true, drawn, 30, { from: 100, to: 900 }), null)
  assert.equal(heldBox(true, drawn, 30, { from: 200, to: 1400 }), null)
  assert.deepEqual(heldBox(true, drawn, 30, { from: 200, to: 1100 }), { left: 150, width: 1000 })
  // What must be covered: the drawn stretch less most of its margin; a short clip, all of it.
  assert.deepEqual(heldNeed(1000, 4000), { from: 1344, to: 3656 })
  assert.deepEqual(heldNeed(0, 300), { from: 150, to: 150 })
})
