// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateGentlePanMotion,
  generateMotionFx,
  mergeCinematicMotion,
  mergeGentlePanMotion,
  removeMotionLayer,
  generateChainMotion,
  sampleMotionFx
} from '../renderer/src/effects/cinematic'
import { defaultProject } from '../renderer/src/types'

test('one clip can lose only Cinematize or only Gentle Pan', () => {
  const project = defaultProject()
  const both = mergeGentlePanMotion(generateMotionFx(0, 1, project),
    generateGentlePanMotion(0, 'left-to-right', 2.5, project))
  const withoutCinema = removeMotionLayer(both, 'cinematic')!
  assert.equal(withoutCinema.shakeAmp, 0)
  assert.ok((withoutCinema.gentlePanX ?? 0) > 0)
  const withoutPan = removeMotionLayer(both, 'gentle')!
  assert.equal(withoutPan.gentlePanX, undefined)
  assert.equal(withoutPan.shakeAmp, both.shakeAmp)
  assert.equal(removeMotionLayer(withoutCinema, 'gentle'), undefined)
})

test('touching clips use one handheld clock at the cut', () => {
  const project = defaultProject()
  const [a, b] = generateChainMotion([3, 4], 0, 1, project, 9241, 12)
  assert.equal(a.seed, b.seed)
  assert.equal(a.timeOffset, 12)
  assert.equal(b.timeOffset, 15)
  const left = sampleMotionFx(a, 1, 3)
  const right = sampleMotionFx(b, 0, 0)
  assert.ok(Math.abs(left.offsetX - right.offsetX) < 1e-8)
  assert.ok(Math.abs(left.offsetY - right.offsetY) < 1e-8)
  assert.ok(Math.abs(left.rotation - right.rotation) < 1e-8)
})

test('gentle horizontal pan moves left to right without shake or animated zoom', () => {
  const project = defaultProject()
  const fx = generateGentlePanMotion(0, 'left-to-right', 2.5, project)
  const start = sampleMotionFx(fx, 0, 0)
  const middle = sampleMotionFx(fx, 0.5, 2)
  const end = sampleMotionFx(fx, 1, 4)

  assert.ok(start.offsetX < 0)
  assert.ok(Math.abs(middle.offsetX) < 1e-12)
  assert.ok(end.offsetX > 0)
  assert.ok(Math.abs(start.offsetY) < 1e-12)
  assert.ok(Math.abs(end.rotation) < 1e-12)
  assert.equal(fx.zoomFrom, fx.zoomTo)
  assert.ok(fx.zoomFrom > 1 && fx.zoomFrom < 1.1)
  assert.equal(fx.shakeAmp, 0)
  assert.equal(fx.shakeRotAmp, 0)
})

test('gentle vertical pan moves from bottom to top', () => {
  const project = defaultProject()
  const fx = generateGentlePanMotion(0, 'bottom-to-top', 3, project)
  const start = sampleMotionFx(fx, 0, 0)
  const end = sampleMotionFx(fx, 1, 5)

  assert.ok(Math.abs(start.offsetX) < 1e-12)
  assert.ok(start.offsetY > 0)
  assert.ok(end.offsetY < 0)
})

test('alternating gentle pan flips direction on consecutive clips', () => {
  const project = defaultProject()
  const first = generateGentlePanMotion(0, 'alternate-horizontal', 2, project)
  const second = generateGentlePanMotion(1, 'alternate-horizontal', 2, project)
  const verticalA = generateGentlePanMotion(0, 'alternate-vertical', 2, project)
  const verticalB = generateGentlePanMotion(1, 'alternate-vertical', 2, project)

  assert.ok(first.panX > 0)
  assert.ok(second.panX < 0)
  assert.ok(verticalA.panY < 0)
  assert.ok(verticalB.panY > 0)
})

test('mixed gentle pan is varied, deterministic and weighted toward horizontal moves', () => {
  const project = defaultProject()
  const seed = 7419
  const directions = Array.from({ length: 40 }, (_, index) => {
    const fx = generateGentlePanMotion(index, 'mixed', 2, project, seed)
    if (fx.panX > 0) return 'right'
    if (fx.panX < 0) return 'left'
    if (fx.panY > 0) return 'down'
    return 'up'
  })
  const repeated = directions.some((direction, index) => index > 0 && direction === directions[index - 1])
  const horizontalCount = directions.filter((direction) => direction === 'left' || direction === 'right').length

  assert.equal(repeated, false)
  assert.ok(horizontalCount >= 26)
  assert.ok(directions.includes('up'))
  assert.ok(directions.includes('down'))
  assert.deepEqual(
    directions,
    Array.from({ length: 40 }, (_, index) => {
      const fx = generateGentlePanMotion(index, 'mixed', 2, project, seed)
      if (fx.panX > 0) return 'right'
      if (fx.panX < 0) return 'left'
      if (fx.panY > 0) return 'down'
      return 'up'
    })
  )
})

test('gentle pan and Cinematize remain additive in either apply order', () => {
  const project = defaultProject()
  const cinematic = generateMotionFx(0, 1, project)
  const gentle = generateGentlePanMotion(0, 'left-to-right', 3, project)
  const panAfterCinematic = mergeGentlePanMotion(cinematic, gentle)
  const cinematicAfterPan = mergeCinematicMotion(mergeGentlePanMotion(undefined, gentle), cinematic)
  const cinematicStart = sampleMotionFx(cinematic, 0, 0)
  const cinematicEnd = sampleMotionFx(cinematic, 1, 4)

  for (const fx of [panAfterCinematic, cinematicAfterPan]) {
    const start = sampleMotionFx(fx, 0, 0)
    const end = sampleMotionFx(fx, 1, 4)
    assert.notEqual(fx.zoomFrom, fx.zoomTo)
    assert.ok(fx.shakeAmp > 0)
    assert.ok((fx.gentlePanX ?? 0) > 0)
    // Cinematize's randomized pan can point the other way; assert the added
    // gentle layer, not the combined net displacement, to avoid a false fail.
    assert.ok((end.offsetX - start.offsetX) - (cinematicEnd.offsetX - cinematicStart.offsetX) > project.settings.width * 0.02)
  }
})

test('applying Gentle Pan again changes only its own layer', () => {
  const project = defaultProject()
  const cinematic = generateMotionFx(0, 1.2, project)
  const first = mergeGentlePanMotion(cinematic, generateGentlePanMotion(0, 'left-to-right', 2, project))
  const second = mergeGentlePanMotion(first, generateGentlePanMotion(0, 'top-to-bottom', 4, project))

  assert.equal(second.zoomFrom, cinematic.zoomFrom)
  assert.equal(second.zoomTo, cinematic.zoomTo)
  assert.equal(second.shakeAmp, cinematic.shakeAmp)
  assert.equal(second.panX, cinematic.panX)
  assert.equal(second.gentlePanX, 0)
  assert.ok((second.gentlePanY ?? 0) > 0)
})
