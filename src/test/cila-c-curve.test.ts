// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): the speed curve's own arithmetic —
// timeline/speed-curve.ts and the curved branches of timeline/media-time.ts.
// The time integral and its inverse are inverses; a clip's window is exactly
// its `inPoint + duration × speed`; a part of a curved clip plays exactly
// what that stretch of the whole played; backwards clips; the room outside.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CURVE_MAX_KEYS, curveDuration, curveLocalAt, curveMedia, curveMediaAt, curvePart, curveProblem, curveRange, curveSpeed, curveTime, keysFromPoints, pointsOf, tidyKeys } from '../renderer/src/timeline/speed-curve'
import { headRoom, inPointFor, localAtMedia, mediaAtLocal, partOf, tailRoom } from '../renderer/src/timeline/media-time'
import type { Clip, SpeedCurve } from '../renderer/src/types'

const near = (a: number, b: number, what: string, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b} (± ${eps})`)

/** Three points: 4x at 100 s, 0.25x at 103 s, 2x at 110 s of media. */
const THREE: SpeedCurve = { keys: [{ m: 100, v: 4 }, { m: 103, v: 0.25 }, { m: 110, v: 2 }] }

/** A clip over media 100–110 with `curve`, the duration the curve asks for. */
function curved(curve: SpeedCurve = THREE, extra: Partial<Clip> = {}): Clip {
  const duration = curveDuration(curve, 100, 10)
  return { id: 'c', assetId: 'v', trackId: 'V1', start: 5, inPoint: 100, duration, speed: 10 / duration, speedCurve: curve, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...extra } as Clip
}

test('curve: T and its inverse are inverses, inside the points and outside them', () => {
  for (const curve of [THREE, { ...THREE, linear: true as const }, { keys: [{ m: 0, v: 1 }] }, { keys: [{ m: 5, v: 0.1 }, { m: 5.5, v: 100 }] }]) {
    for (let m = 90; m <= 120; m += 0.137) {
      const t = curveTime(curve, m)
      near(curveMedia(curve, t), m, `m ${m}`, 1e-9 * Math.max(1, Math.abs(m)))
    }
    for (let t = -10; t <= 40; t += 0.093) near(curveTime(curve, curveMedia(curve, t)), t, `t ${t}`, 1e-8)
  }
})

test('curve: T is the integral of 1 / speed (within a hundredth of a frame on a 3-point curve)', () => {
  // Simpson over the table's own speed, and over the eased speed the points
  // describe: the table follows the curve closely.
  const steps = 20000
  let sum = 0
  for (let i = 0; i <= steps; i++) {
    const m = 100 + (10 * i) / steps
    const w = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2
    sum += w / curveSpeed(THREE, m)
  }
  const numeric = (sum * 10) / steps / 3
  near(curveTime(THREE, 110) - curveTime(THREE, 100), numeric, 'T over the window', 1 / 3000)
  // Holding outside: 1 s of media before the first point at 4x is 0.25 s.
  near(curveTime(THREE, 99), -0.25, 'before the first point')
  near(curveTime(THREE, 111) - curveTime(THREE, 110), 0.5, 'after the last point')
  // The speed passes through the points.
  for (const k of THREE.keys) near(curveSpeed(THREE, k.m), k.v, `speed at ${k.m}`)
})

test('curve: a clip shows exactly its window, starts and ends at its points\' speeds', () => {
  const c = curved()
  near(mediaAtLocal(c, 0), 100, 'first frame')
  near(mediaAtLocal(c, c.duration), 110, 'last frame', 1e-9)
  near(c.inPoint + c.duration * (c.speed ?? 1), 110, 'the straight-line window')
  near(curveMediaAt(c, 0)!.rate, 4, 'speed at the start')
  near(curveMediaAt(c, c.duration)!.rate, 2, 'speed at the end', 1e-9)
  // Never backwards, and the speed is the slope.
  let last = -Infinity
  for (let l = 0; l <= c.duration; l += c.duration / 997) {
    const m = mediaAtLocal(c, l)
    assert.ok(m >= last - 1e-12, `forwards at ${l}`)
    last = m
    const h = 1e-5
    const slope = (mediaAtLocal(c, l + h) - mediaAtLocal(c, l - h)) / (2 * h)
    near(curveMediaAt(c, l)!.rate, slope, `slope at ${l}`, 1e-3 * Math.max(1, slope))
    near(localAtMedia(c, m), l, `inverse at ${l}`, 1e-9)
  }
  const [lo, hi] = curveRange(c)!
  near(lo, 0.25, 'slowest')
  near(hi, 4, 'fastest')
})

test('curve: a clip of another length plays the same window, its speeds scaled (k)', () => {
  const c = curved()
  const half = { ...c, duration: c.duration / 2, speed: (c.speed ?? 1) * 2 }
  near(mediaAtLocal(half, half.duration), 110, 'the window end stays put')
  near(curveMediaAt(half, 0)!.rate, 8, 'twice as fast at the start')
  for (let l = 0; l <= half.duration; l += 0.1) near(mediaAtLocal(half, l), mediaAtLocal(c, 2 * l), `same frame at ${l}`, 1e-9)
})

test('curve: the part of a curved clip plays what that stretch of it played (split, trims)', () => {
  const c = curved()
  for (const [a, b] of [[0, 1.3], [1.3, c.duration], [0.7, 2.9], [-1, 2], [3, c.duration + 2]]) {
    const part = curvePart(c, a, b)!
    const piece = { ...c, inPoint: part.inPoint, speed: part.speed, duration: b - a }
    assert.deepEqual(partOf(c, a, b), part)
    near(inPointFor(c, a, b), part.inPoint, `in point ${a}–${b}`)
    for (let l = 0; l <= b - a; l += (b - a) / 101) near(mediaAtLocal(piece, l), mediaAtLocal(c, a + l), `${a}–${b} at ${l}`, 1e-8)
  }
  // Without a curve the part keeps the clip's speed.
  const plain = { ...c, speedCurve: undefined, speed: 2 }
  assert.deepEqual(partOf(plain, 1, 3), { inPoint: 102, speed: 2 })
})

test('curve: backwards, the curve is read in the order the clip plays', () => {
  const c = curved(THREE, { reversed: true })
  near(mediaAtLocal(c, 0), 110, 'first frame is the media end')
  near(mediaAtLocal(c, c.duration), 100, 'last frame is the in point', 1e-9)
  near(curveMediaAt(c, 0)!.rate, -2, 'speed at the start (the media end\'s point)')
  for (let l = 0; l <= c.duration; l += 0.31) near(localAtMedia(c, mediaAtLocal(c, l)), l, `inverse at ${l}`, 1e-9)
  for (const [a, b] of [[0, 2], [2, c.duration]]) {
    const part = curvePart(c, a, b)!
    const piece = { ...c, inPoint: part.inPoint, speed: part.speed, duration: b - a }
    for (let l = 0; l <= b - a; l += (b - a) / 53) near(mediaAtLocal(piece, l), mediaAtLocal(c, a + l), `${a}–${b} at ${l}`, 1e-8)
  }
})

test('curve: head and tail room at the curve\'s speeds', () => {
  const c = curved()
  // 100 s of media before at 4x, 50 s after at 2x.
  near(headRoom(c, 160), 25, 'head room')
  near(tailRoom(c, 160), 25, 'tail room')
  const r = curved(THREE, { reversed: true })
  near(headRoom(r, 160), 25, 'backwards: head room is the media after')
  near(tailRoom(r, 160), 25, 'backwards: tail room is the media before')
})

test('curve: the model\'s rules and the editor\'s points', () => {
  assert.equal(curveProblem(THREE), null)
  assert.match(curveProblem({ keys: [] }) ?? '', /0 points/)
  assert.match(curveProblem({ keys: [{ m: 1, v: 1 }, { m: 1, v: 2 }] }) ?? '', /not after/)
  assert.match(curveProblem({ keys: [{ m: 1, v: 0 }] }) ?? '', /not a number/)
  assert.match(curveProblem({ keys: [{ m: 1, v: 1000 }] }) ?? '', /out of range/)
  assert.match(curveProblem({ keys: Array.from({ length: CURVE_MAX_KEYS + 1 }, (_, i) => ({ m: i, v: 1 })) }) ?? '', /points/)
  assert.deepEqual(tidyKeys([{ m: 2, v: 500 }, { m: 1, v: 0.01 }, { m: 2 + 1e-9, v: 3 }]), [{ m: 1, v: 0.1 }, { m: 2 + 1e-9, v: 3 }])
  const c = curved()
  const pts = pointsOf(c)
  assert.deepEqual(pts.map((p) => +p.u.toFixed(9)), [0, 0.3, 1])
  assert.deepEqual(keysFromPoints(c, pts).map((k) => +k.m.toFixed(9)), [100, 103, 110])
  const r = curved(THREE, { reversed: true })
  assert.deepEqual(pointsOf(r).map((p) => +p.u.toFixed(9)), [0, 0.7, 1])
  assert.deepEqual(pointsOf(r).map((p) => +p.v.toFixed(9)), [2, 0.25, 4])
  void curveLocalAt
})
