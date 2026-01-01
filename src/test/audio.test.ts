// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { automationGainAt, envelopeAt, volumeAt } from '../renderer/src/audio/envelope'
import { detectSpeechActivity, planDuckingKeyframes } from '../renderer/src/audio/ducking'
import type { Clip } from '../renderer/src/types'

const clip = (over: Partial<Clip>): Clip =>
  ({
    id: 'c',
    assetId: 'a',
    trackId: 't',
    start: 0,
    duration: 10,
    inPoint: 0,
    volume: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    ...over
  }) as Clip

test('mute wins over everything, including keyframes', () => {
  const c = clip({ muted: true, volumeKeyframes: [{ id: 'k', time: 0, value: 1 }] })
  assert.equal(volumeAt(c, 0), 0)
  // …but the waveform still needs to see the shape of the sound.
  assert.equal(envelopeAt(c, 0), 1)
})

test('fades ramp from silence and back to it', () => {
  const c = clip({ duration: 10, fadeIn: 2, fadeOut: 2 })
  assert.equal(volumeAt(c, 0), 0)
  assert.ok(Math.abs(volumeAt(c, 1) - 0.5) < 1e-6)
  assert.equal(volumeAt(c, 5), 1)
  assert.ok(Math.abs(volumeAt(c, 9) - 0.5) < 1e-6)
  assert.ok(volumeAt(c, 10) < 1e-6)
})

test('volume keyframes interpolate between points and hold outside them', () => {
  const c = clip({
    volumeKeyframes: [
      { id: 'a', time: 2, value: 0.2 },
      { id: 'b', time: 4, value: 0.8 }
    ]
  })
  assert.equal(volumeAt(c, 0), 0.2)
  assert.ok(Math.abs(volumeAt(c, 3) - 0.5) < 1e-6)
  assert.equal(volumeAt(c, 9), 0.8)
  assert.ok(Math.abs(automationGainAt(c, 3) - 0.5) < 1e-6)
})

test('raw keyframe value stays independent from fades for slider display', () => {
  const c = clip({
    duration: 10,
    fadeIn: 4,
    volumeKeyframes: [
      { id: 'a', time: 0, value: 0.4 },
      { id: 'b', time: 4, value: 0.8 }
    ]
  })
  assert.ok(Math.abs(automationGainAt(c, 2) - 0.6) < 1e-6)
  assert.ok(Math.abs(envelopeAt(c, 2) - 0.3) < 1e-6)
})

test('a fade still applies on top of keyframes', () => {
  const c = clip({ duration: 10, fadeIn: 2, volumeKeyframes: [{ id: 'a', time: 0, value: 0.5 }] })
  assert.equal(volumeAt(c, 0), 0)
  assert.ok(Math.abs(volumeAt(c, 1) - 0.25) < 1e-6)
})

test('speech detection adapts to a quiet dialogue recording and ignores room tone', () => {
  const sampleRate = 100
  const cells = [0.001, 0.001, 0.012, 0.016, 0.001, 0.014, 0.013, 0.001]
  const samples = new Float32Array(cells.flatMap((level) => Array(10).fill(level)))
  assert.deepEqual(detectSpeechActivity(samples, sampleRate, 0.1), [false, false, true, true, true, true, true, false])

  const roomTone = new Float32Array(100).fill(0.008)
  assert.equal(detectSpeechActivity(roomTone, sampleRate, 0.1).some(Boolean), false)

  const sparse = new Float32Array(1000).fill(0.0002)
  sparse.fill(0.02, 500, 520)
  assert.equal(detectSpeechActivity(sparse, sampleRate, 0.1).slice(50, 52).every(Boolean), true)
})

test('ducking multiplies the existing music level and ramps around speech', () => {
  const music = clip({
    start: 0,
    duration: 8,
    volume: 0.4,
    volumeKeyframes: [
      { id: 'a', time: 0, value: 0.4 },
      { id: 'b', time: 8, value: 0.8 }
    ]
  })
  // Speech from 2.0 through 3.0 seconds.
  const activity = Array.from({ length: 80 }, (_, index) => index >= 20 && index < 30)
  const points = planDuckingKeyframes(music, activity, {
    cell: 0.1,
    duckRatio: 0.25,
    attack: 0.2,
    hold: 0.3,
    release: 0.5
  })!
  const at = (time: number) => points.find((point) => Math.abs(point.time - time) < 1e-6)!.value
  assert.ok(Math.abs(at(1.8) - 0.49) < 1e-6) // original envelope before the fade-down
  assert.ok(Math.abs(at(2) - 0.125) < 1e-6) // 25% of 50%, not 25% absolute
  assert.ok(Math.abs(at(3.3) - 0.14125) < 1e-6)
  assert.ok(Math.abs(at(3.8) - 0.59) < 1e-6)
})

test('ducking leaves a music clip alone when it does not overlap speech', () => {
  const music = clip({ start: 10, duration: 5, volume: 0.6 })
  const activity = Array.from({ length: 30 }, (_, index) => index >= 5 && index < 10)
  assert.equal(
    planDuckingKeyframes(music, activity, { cell: 0.1, duckRatio: 0.2, attack: 0.2, hold: 0.3, release: 0.5 }),
    null
  )
})
