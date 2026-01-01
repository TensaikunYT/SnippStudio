// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { compileMover, evalMover, DEFAULT_PHYSICS, physicsInternals, targetsBefore } from '../renderer/src/motion/physics'
import type { MoveAction, Mover } from '../renderer/src/types'

const env = { aspect: 16 / 9, poseAspect: () => 0.5 }

function character(actions: Omit<MoveAction, 'id'>[], physics = {}): Mover {
  return {
    id: 'c1',
    poses: [
      { id: 'rest', assetId: 'a1', ax: 0.5, faces: 'right' },
      { id: 'point', assetId: 'a2', ax: 0.4, faces: 'right' }
    ],
    restPoseId: 'rest',
    pointPoseId: 'point',
    x: 0.3,
    y: 1,
    size: 0.8,
    physics: { ...DEFAULT_PHYSICS, idle: 0, ...physics },
    actions: actions.map((a, i) => ({ id: 'a' + i, ...a }))
  }
}

const at = (ch: Mover, t: number) => evalMover(ch, compileMover(ch, env), t, env)

test('a move covers most of its way within the block and then settles on the target', () => {
  const ch = character([{ kind: 'move', time: 1, dur: 0.8, x: 0.7 }])
  assert.equal(at(ch, 0.5).x, 0.3)
  const done = (at(ch, 1.8).x - 0.3) / 0.4
  assert.ok(done > 0.8 && done < 1.2, `progress at block end ${done}`)
  assert.ok(Math.abs(at(ch, 6).x - 0.7) < 1e-3)
})

test('motion has no jumps: position is continuous through every action boundary', () => {
  const ch = character([
    { kind: 'enter', time: 0.5, dur: 0.6, side: 'left' },
    { kind: 'dash', time: 2, dur: 0.3 },
    { kind: 'approach', time: 3, dur: 0.7 },
    { kind: 'hop', time: 4, dur: 0.5 }
  ])
  const dt = 1 / 600
  let prev = at(ch, 0.6)
  for (let t = 0.6 + dt; t < 6; t += dt) {
    const cur = at(ch, t)
    assert.ok(Math.abs(cur.x - prev.x) < 0.02, `x jumped at ${t.toFixed(3)}`)
    assert.ok(Math.abs(cur.scale - prev.scale) < 0.02, `scale jumped at ${t.toFixed(3)}`)
    prev = cur
  }
})

test('the same frame comes out whatever order frames are asked for in', () => {
  const ch = character([
    { kind: 'move', time: 0.2, dur: 0.6, x: 0.8 },
    { kind: 'point', time: 1.5, dur: 1 }
  ])
  const forward = [0.3, 0.9, 1.6, 2.7].map((t) => at(ch, t))
  const backward = [2.7, 1.6, 0.9, 0.3].map((t) => at(ch, t)).reverse()
  assert.deepEqual(forward, backward)
})

test('an entrance starts off screen and a first entrance hides the character before it', () => {
  const ch = character([{ kind: 'enter', time: 1, dur: 0.7, side: 'right' }])
  assert.ok(at(ch, 0).x > 1, 'waits off screen on the right')
  assert.ok(Math.abs(at(ch, 5).x - 0.3) < 1e-3)
  const pop = character([{ kind: 'enter', time: 1, dur: 0.5, side: 'pop' }])
  assert.equal(at(pop, 0.5).scale, 0)
  const fade = character([{ kind: 'enter', time: 1, dur: 0.5, side: 'fade' }])
  assert.equal(at(fade, 0.5).opacity, 0)
})

test('an exit leaves the frame and a later move walks back in', () => {
  const ch = character([
    { kind: 'exit', time: 1, dur: 0.6, side: 'left' },
    { kind: 'move', time: 3, dur: 0.6, x: 0.5 }
  ])
  assert.ok(at(ch, 2.5).x < 0)
  assert.ok(Math.abs(at(ch, 6).x - 0.5) < 1e-3)
})

test('bounce decides the overshoot', () => {
  const stiff = character([{ kind: 'move', time: 0, dur: 0.5, x: 0.7 }], { bounce: 0, weight: 0 })
  const springy = character([{ kind: 'move', time: 0, dur: 0.5, x: 0.7 }], { bounce: 1 })
  let maxStiff = 0
  let maxSpringy = 0
  for (let t = 0; t < 4; t += 0.005) {
    maxStiff = Math.max(maxStiff, at(stiff, t).x)
    maxSpringy = Math.max(maxSpringy, at(springy, t).x)
  }
  assert.ok(maxStiff <= 0.7 + 1e-6, `no overshoot without bounce (${maxStiff})`)
  assert.ok(maxSpringy > 0.72, `overshoots with bounce (${maxSpringy})`)
})

test('weight: the upper body lags on the way out and carries on past the stop', () => {
  const ch = character([{ kind: 'move', time: 0, dur: 0.6, x: 0.8 }], { weight: 1, lean: 1, bounce: 0.2 })
  let minRot = 0
  let maxRotLate = 0
  for (let t = 0; t < 0.35; t += 0.005) minRot = Math.min(minRot, at(ch, t).rot)
  for (let t = 0.5; t < 1.4; t += 0.005) maxRotLate = Math.max(maxRotLate, at(ch, t).rot)
  assert.ok(minRot < -0.02, `leans back while speeding up (${minRot})`)
  assert.ok(maxRotLate > 0.02, `pitches forward as it stops (${maxRotLate})`)
  assert.ok(Math.abs(at(ch, 8).rot) < 1e-3, 'comes to rest upright')
})

test('point switches to the pointing pose, mirrors for the other side and switches back', () => {
  const right = character([{ kind: 'point', time: 1, dur: 1, dir: 'right' }])
  assert.equal(at(right, 0.9).pose, 'rest')
  assert.equal(at(right, 1.5).pose, 'point')
  assert.ok(at(right, 1.5).face > 0.99)
  assert.equal(at(right, 3).pose, 'rest')
  const left = character([{ kind: 'point', time: 1, dur: 1, dir: 'left' }])
  assert.ok(at(left, 1.6).face < -0.99, 'points left by mirroring a right-pointing drawing')
  assert.ok(at(left, 3.5).face > 0.99, 'faces the way it did before')
})

test('a whip swap opens the shutter right at the change', () => {
  const ch = character([{ kind: 'pose', time: 1, dur: 0.26, poseId: 'point' }], { blur: 0 })
  const base = at(ch, 0.2).shutter
  const peak = at(ch, 1.13).shutter
  assert.equal(base, 0)
  assert.ok(peak > 0.06, `blur at the swap (${peak})`)
})

test('hop leaves the ground and lands where it started', () => {
  const ch = character([{ kind: 'hop', time: 1, dur: 0.6 }])
  let top = 1
  for (let t = 1; t < 1.6; t += 0.01) top = Math.min(top, at(ch, t).y)
  assert.ok(top < 0.95, `rises (${top})`)
  assert.ok(Math.abs(at(ch, 3).y - 1) < 1e-6)
})

test('new actions start from the targets reached before them', () => {
  const ch = character([
    { kind: 'move', time: 1, dur: 0.5, x: 0.6 },
    { kind: 'approach', time: 2, dur: 0.5, amount: 2 }
  ])
  const t = targetsBefore(ch, 5, env)
  assert.ok(Math.abs(t.scale - 2) < 1e-9)
  assert.ok(Math.abs(t.x - (0.6 + (0.5 - 0.6) * 0.2)) < 1e-9)
  // Closer keeps the eye line: the feet go down by the growth of the body.
  assert.ok(Math.abs(t.y - (1 + (2 - 1) * 0.8 * 0.88)) < 1e-9)
})

test('closer then back returns to the same spot and size', () => {
  const ch = character([
    { kind: 'approach', time: 1, dur: 0.6, amount: 1.5 },
    { kind: 'retreat', time: 3, dur: 0.6, amount: 1 / 1.5 }
  ])
  const end = at(ch, 9)
  assert.ok(Math.abs(end.scale - 1) < 1e-6)
  assert.ok(Math.abs(end.y - 1) < 1e-6)
  assert.ok(Math.abs(end.x - (0.3 + 0.2 * 0.2)) < 1e-6)
})

test('a character edited in place after a compile is not served the stale compile', () => {
  const ch = character([])
  assert.equal(at(ch, 2).x, 0.3)
  ch.actions.push({ id: 'late', kind: 'move', time: 1, dur: 0.5, x: 0.7 })
  assert.ok(Math.abs(at(ch, 5).x - 0.7) < 1e-3)
})

test('the closed-form upper-body swing matches a step-by-step simulation', () => {
  const { pendulumLag, response } = physicsInternals
  const steps = [
    { t: 0.2, d: 0.4, w: 9, z: 0.5 },
    { t: 0.5, d: -0.1, w: 14, z: 1 },
    { t: 1.1, d: 0.25, w: 6, z: 0.3 }
  ]
  const wh = 8
  const zh = 0.35
  const accel = (t: number) => steps.reduce((sum, st) => sum + st.d * response(t - st.t, st.w, st.z)[2], 0)
  // Semi-implicit Euler at 20 kHz: slow, but nothing clever to get wrong.
  let th = 0
  let v = 0
  const dt = 1 / 20000
  let worst = 0
  for (let i = 1; i <= 3 * 20000; i++) {
    const t = i * dt
    v += (-accel(t) - 2 * zh * wh * v - wh * wh * th) * dt
    th += v * dt
    if (i % 2000 === 0) worst = Math.max(worst, Math.abs(th - pendulumLag(steps, t, wh, zh)))
  }
  assert.ok(worst < 2e-4, `closed form is off by ${worst}`)
})
