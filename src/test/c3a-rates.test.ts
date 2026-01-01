// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decision 4 (report R14): 25 / 50 and the exact NTSC rates; the
// file format 6 (a decimal NTSC rate snapped to its fraction); an empty
// project takes its first video's rate.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { FRAME_RATES, firstVideoRate, fpsLabel, frameTime, listedRate, rationalFps, snapFps } from '../renderer/src/timeline/rates'
import { onFrameGrid } from '../renderer/src/timeline/key-grid'
import { readProjectToOpen, serializeProject } from '../renderer/src/media/projectio'
import { CONVERSIONS, CURRENT_FORMAT } from '../renderer/src/model/format'
import { useStore } from '../renderer/src/state/store'
import type { Asset } from '../renderer/src/types'

test('the rates offered, NTSC as exact fractions', () => {
  assert.deepEqual(FRAME_RATES.map(fpsLabel), ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'])
  assert.deepEqual(rationalFps(30000 / 1001), { num: 30000, den: 1001 })
  assert.deepEqual(rationalFps(24000 / 1001), { num: 24000, den: 1001 })
  assert.deepEqual(rationalFps(60000 / 1001), { num: 60000, den: 1001 })
  assert.deepEqual(rationalFps(25), { num: 25, den: 1 })
  assert.deepEqual(rationalFps(50), { num: 50, den: 1 })
})

test('frame i of 29.97 is at i × 1001 / 30000 exactly, with no drift over 30 minutes', () => {
  const f = 30000 / 1001
  assert.equal(frameTime(0, f), 0)
  assert.equal(frameTime(30000, f), 1001)
  // 30 minutes: frame 53946 is at 1800 s (53946 × 1001 / 30000 = 1800.0…).
  assert.equal(frameTime(53946, f), (53946 * 1001) / 30000)
  // Whole rates: i / fps, as the export always did.
  for (const fps of [24, 25, 30, 50, 60]) for (const i of [0, 1, 7, 1799, 108000]) assert.equal(frameTime(i, fps), i / fps)
})

test('a rate written as a decimal means the NTSC one; others stay', () => {
  assert.equal(snapFps(29.97), 30000 / 1001)
  assert.equal(snapFps(23.976), 24000 / 1001)
  assert.equal(snapFps(59.94), 60000 / 1001)
  assert.equal(snapFps(30000 / 1001), 30000 / 1001)
  assert.equal(snapFps(30.0000001), 30)
  assert.equal(snapFps(25), 25)
  assert.equal(snapFps(12.5), 12.5)
})

test('a measured source rate is a listed one only when it is near (29.97 is not 30)', () => {
  assert.equal(listedRate(29.97002), 30000 / 1001)
  assert.equal(listedRate(30), 30)
  assert.equal(listedRate(29.999), 30)
  assert.equal(listedRate(25.0004), 25)
  assert.equal(listedRate(59.94), 60000 / 1001)
  assert.equal(listedRate(27.3), null, 'a variable-rate phone file: the project keeps its rate')
  assert.equal(listedRate(undefined), null)
})

test('the frame grid is the export\'s own frame time (NTSC exact)', () => {
  const f = 30000 / 1001
  for (const t of [0.5, 3.3, 61.2, 1799.9]) {
    const g = onFrameGrid(t, f)
    const i = Math.round(t * f)
    assert.equal(g, (i * 1001) / 30000)
  }
  assert.equal(onFrameGrid(1.01, 30), 30 / 30)
})

const projectAt = (fps: number): string => {
  useStore.getState().newProject('16:9')
  const p = structuredClone(useStore.getState().project)
  p.settings.fps = fps
  const raw = JSON.parse(serializeProject(p))
  raw.formatVersion = 5
  return JSON.stringify(raw)
}

test('format 6: a format-5 file at "29.97" opens at 30000/1001; whole rates as they were; twice = once', () => {
  // (Format 7 since DENEME-3, V item 2: a transition's sound.)
  assert.ok(CURRENT_FORMAT >= 6)
  for (const [written, opened] of [[29.97, 30000 / 1001], [23.976, 24000 / 1001], [59.94, 60000 / 1001], [30, 30], [25, 25], [60, 60]] as const) {
    const read = readProjectToOpen(projectAt(written))
    assert.equal(read.project.settings.fps, opened, `${written}`)
  }
  const six = CONVERSIONS.find((c) => c.to === 6)!
  const once = JSON.parse(projectAt(29.97))
  six.run(once)
  const twice = structuredClone(once)
  six.run(twice)
  assert.deepEqual(twice, once)
  // Written by this build and read back: the exact rate, unchanged.
  const p = readProjectToOpen(projectAt(29.97)).project
  const again = readProjectToOpen(serializeProject(p)).project
  assert.equal(again.settings.fps, 30000 / 1001)
  assert.equal(JSON.parse(serializeProject(p)).formatVersion, CURRENT_FORMAT)
})

const video = (id: string, fps?: number): Asset => ({ id, kind: 'video', name: `${id}.mp4`, url: `file:///${id}.mp4`, size: 1, duration: 10, width: 1920, height: 1080, hasAudio: true, ...(fps !== undefined ? { fps } : {}) })

test('an empty project takes its first video\'s rate when it is listed, in the same step', () => {
  const s = useStore.getState
  s().newProject('16:9')
  assert.equal(s().project.settings.fps, 60)
  const before = s().past.length
  s().addAssets([video('a', 30000 / 1001)])
  assert.equal(s().project.settings.fps, 30000 / 1001)
  assert.equal(s().past.length, before + 1, 'one undo step')
  s().undo()
  assert.equal(s().project.settings.fps, 60)
  assert.equal(s().project.assets.length, 0)
  // A second video does not change it again.
  s().redo()
  s().addAssets([video('b', 25)])
  assert.equal(s().project.settings.fps, 30000 / 1001)
  // An unlisted rate (variable): the project keeps its own.
  s().newProject('16:9')
  s().addAssets([video('c', 27.3)])
  assert.equal(s().project.settings.fps, 60)
  // A project with clips keeps its rate.
  assert.equal(firstVideoRate({ clips: { x: {} }, assets: [] }, [video('d', 25)]), null)
  assert.equal(firstVideoRate({ clips: {}, assets: [] }, [video('d', 25)]), 25)
  assert.equal(firstVideoRate({ clips: {}, assets: [] }, [video('e')]), null, 'an older asset without a rate')
})
