// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): the sound along a speed curve. The
// export stretches a curved clip piece by piece with its pitch kept (the
// stretch reads the curve's own map, audio/time-stretch.ts): a tone stays
// its pitch at the slow and at the fast stretches, the output lasts what
// the clip lasts, any window of it is the same samples; heard only where it
// plays between 0.25x and 8x, with a short fade at each limit.
import assert from 'node:assert/strict'
import test from 'node:test'
import { stretch, stretchInputSpan, stretchPlan } from '../renderer/src/audio/time-stretch'
import { localAtMedia, mediaAtLocal } from '../renderer/src/timeline/media-time'
import { AUDIBLE_MAX, AUDIBLE_MIN, audibleGain } from '../renderer/src/timeline/speed'
import { clipAudible, curveDuration } from '../renderer/src/timeline/speed-curve'
import type { Clip, SpeedCurve } from '../renderer/src/types'

const SR = 48000
const plan = stretchPlan(SR)
const sine = (n: number, f: number): Float32Array => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR))
function level(x: Float32Array, f: number): number {
  let re = 0
  let im = 0
  let w = 0
  for (let i = 0; i < x.length; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    re += x[i] * h * Math.cos((2 * Math.PI * f * i) / SR)
    im -= x[i] * h * Math.sin((2 * Math.PI * f * i) / SR)
    w += h
  }
  return (2 * Math.hypot(re, im)) / w
}
function peak(x: Float32Array, lo: number, hi: number): number {
  let best = lo
  let top = -1
  for (let f = lo; f <= hi; f += 1) {
    const l = level(x, f)
    if (l > top) [top, best] = [l, f]
  }
  return best
}

/** A clip over media 0–12 s: 0.5x for its first 3 s of media, 2x from 7 s on. */
const CURVE: SpeedCurve = { keys: [{ m: 3, v: 0.5 }, { m: 7, v: 2 }] }
const clip = (): Clip => {
  const d = curveDuration(CURVE, 0, 12)
  return { id: 'c', assetId: 'a', trackId: 'A1', start: 0, inPoint: 0, duration: d, speed: 12 / d, speedCurve: CURVE, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 } as Clip
}

test('along a curve the tone keeps its pitch at 0.5x and at 2x, and the output lasts what the clip does', () => {
  const c = clip()
  const x = sine(SR * 12, 440)
  const map = (m: number): number => mediaAtLocal(c, m / SR) * SR
  const n = Math.round(c.duration * SR)
  const out = stretch([x], 0, map, 0, n, plan)[0]
  assert.equal(out.length, n)
  // The slow stretch: the clip's first 4 s (media 0–2 s at 0.5x).
  const slow = out.subarray(SR * 1, SR * 2)
  const fast = out.subarray(n - SR * 2, n - SR * 1)
  for (const [part, what] of [[slow, 'at 0.5x'], [fast, 'at 2x']] as const) {
    const f = peak(part, 400, 480)
    assert.ok(Math.abs(f - 440) <= 4.4, `${what}: ${f} Hz`)
    const r = Math.sqrt(part.reduce((q, v) => q + v * v, 0) / part.length) / (0.5 / Math.SQRT2)
    assert.ok(r > 0.85 && r < 1.1, `${what}: its level is kept (${r.toFixed(3)})`)
    assert.ok(level(part, what === 'at 2x' ? 880 : 220) < 0.05, `${what}: no octave`)
  }
  // The map is the clip's: the media of the last output sample is its end.
  assert.ok(Math.abs(map(n) - 12 * SR) < 2, 'it ends on the media end')
  // Any window of the output is the same samples (the export mixes in windows).
  const from = 123457
  const [a, b] = stretchInputSpan(map, from, 50000, plan)
  const lo = Math.max(0, a)
  const part = stretch([x.subarray(lo, Math.min(x.length, b))], lo, map, from, 50000, plan)[0]
  for (let k = 0; k < part.length; k++) if (part[k] !== out[from + k]) assert.fail(`sample ${k}: ${part[k]} is not ${out[from + k]}`)
  // And the way back: the output sample of a media second.
  assert.ok(Math.abs(localAtMedia(c, 5) * SR - (() => {
    let lo2 = 0
    let hi2 = n
    for (let i = 0; i < 60; i++) {
      const mid = (lo2 + hi2) / 2
      if (map(mid) < 5 * SR) lo2 = mid
      else hi2 = mid
    }
    return lo2
  })()) < 1, 'localAtMedia inverts the map')
})

test('heard between 0.25x and 8x: a short fade at each limit; a curve is heard when any stretch of it is', () => {
  assert.equal(audibleGain(1), 1)
  assert.equal(audibleGain(AUDIBLE_MIN), 1)
  assert.equal(audibleGain(AUDIBLE_MAX), 1)
  assert.equal(audibleGain(AUDIBLE_MAX * 1.07), 0)
  assert.equal(audibleGain(AUDIBLE_MIN / 1.07), 0)
  const mid = audibleGain(AUDIBLE_MAX * 1.03)
  assert.ok(mid > 0.4 && mid < 0.6, `half way through the fade: ${mid}`)
  assert.equal(audibleGain(-2), 1)
  assert.equal(audibleGain(0), 0)
  // A curve from 20x down to 4x is heard (its slow end); one wholly at 10x–50x is not.
  const base = { inPoint: 0, duration: 1, speed: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
  const of = (keys: SpeedCurve['keys']): Clip => {
    const d = curveDuration({ keys }, 0, 10)
    return { ...base, duration: d, speed: 10 / d, speedCurve: { keys } } as unknown as Clip
  }
  assert.equal(clipAudible(of([{ m: 0, v: 20 }, { m: 10, v: 4 }])), true)
  assert.equal(clipAudible(of([{ m: 0, v: 10 }, { m: 10, v: 50 }])), false)
  assert.equal(clipAudible(of([{ m: 0, v: 0.1 }, { m: 10, v: 0.2 }])), false)
  assert.equal(clipAudible({ speed: 9 } as Clip), false)
  assert.equal(clipAudible({ speed: 2 } as Clip), true)
})
