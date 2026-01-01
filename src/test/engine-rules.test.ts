// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { aliveClipIds, clockStep, playheadJumped, tickSeconds, transitionGain } from '../renderer/src/playback/engine-rules'
import type { Clip } from '../renderer/src/types'

test('a dissolve\'s sound always adds up to full: the outgoing holds until the cut, both cross after it', () => {
  // A: 0..10, B: 10..20, window pre 0.5 / post 0.5 at the cut 10.
  const w = { duration: 1, post: 0.5 }
  const none = { duration: 0, post: 0 }
  const a = (t: number) => transitionGain(t, 0, 10, none, w)
  const b = (t: number) => transitionGain(t, 10, 20, w, none)
  assert.equal(a(9.7), 1)
  assert.equal(b(9.7), 0)
  for (const t of [10, 10.1, 10.25, 10.4, 10.5]) assert.ok(Math.abs(a(t) + b(t) - 1) < 1e-9, `sum at ${t}`)
  assert.equal(a(10.6), 0)
  assert.equal(b(10.6), 1)
})

test('with no part after the cut, the sound simply cuts there', () => {
  const w = { duration: 1, post: 0 }
  const none = { duration: 0, post: 0 }
  assert.equal(transitionGain(9.99, 0, 10, none, w), 1)
  assert.equal(transitionGain(10.01, 0, 10, none, w), 0)
  assert.equal(transitionGain(10.01, 10, 20, w, none), 1)
})

test('compound children count as alive clips, at depth', () => {
  const child = { id: 'kid', nested: { clips: [{ id: 'grandkid' }] } } as unknown as Clip
  const ids = aliveClipIds({ clips: { top: { id: 'top', nested: { clips: [child] } } as unknown as Clip } })
  assert.deepEqual([...ids].sort(), ['grandkid', 'kid', 'top'])
  assert.equal(playheadJumped(5, 5.03), false)
  assert.equal(playheadJumped(5, 6), true)
})

test('the hand-over tick after a hold moves the playhead nowhere, whatever time passed', () => {
  // A long frame between the hold's end and the tick that tells the elements
  // to play: 118 ms the elements never played are not counted.
  assert.equal(clockStep(0.118, 1, true), 0)
  assert.equal(clockStep(0.25, 2, true), 0)
  // Rolling: the tick's time at the play speed, as before.
  assert.equal(clockStep(0.016, 1, false), 0.016)
  assert.equal(clockStep(0.016, 0.5, false), 0.008)
  assert.equal(clockStep(0.016, 2, false), 0.032)
})

test('a tick never counts backwards, nor more than a quarter second', () => {
  assert.equal(tickSeconds(1016, 1000), 0.016)
  // The hand-over set the clock to the moment (1130); the next frame's own
  // time (1125) is older.
  assert.equal(tickSeconds(1125, 1130), 0)
  assert.equal(tickSeconds(3000, 1000), 0.25)
})

/** The clock as the engine runs it, tick by tick: each tick has its frame's
 *  own time (`stamp`) and the moment it really ran (`ran`); the hold ends
 *  before the first one. An element told to play in the hand-over tick plays
 *  from the moment that tick ran. Returns how far the element is behind the
 *  playhead after the last tick (seconds), with the hand-over or as it was. */
function lagAfterHold(ticks: { stamp: number; ran: number }[], holdEndedAt: number, handOverRule: boolean): number {
  let last = holdEndedAt
  let handOver = handOverRule
  let playhead = 0
  let playedFrom: number | null = null
  for (const t of ticks) {
    const dt = handOverRule ? tickSeconds(t.stamp, last) : Math.min(0.25, (t.stamp - last) / 1000)
    if (!handOverRule || t.stamp > last) last = t.stamp
    playhead += clockStep(dt, 1, handOver)
    // (Parked until the first rolling tick: told to play as it runs.)
    if (playedFrom === null) playedFrom = t.ran
    if (handOver) {
      handOver = false
      last = Math.max(last, t.ran)
    }
  }
  const end = ticks[ticks.length - 1]
  return playhead - (end.ran - (playedFrom ?? end.ran)) / 1000
}

test('after a hold the playhead is where an element told to play in the hand-over tick is', () => {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9
  // An even 144 Hz: the old clock was one tick ahead of the element.
  const even = [1007, 1014, 1021, 1028].map((t) => ({ stamp: t, ran: t }))
  assert.ok(near(lagAfterHold(even, 1000, false), 0.007))
  assert.ok(near(lagAfterHold(even, 1000, true), 0))
  // Measured: the page busy 111 ms, so the tick of the frame at 1007 ran at
  // 1118 and the next frame followed at once. The old clock counted those
  // 111 ms no element had played (the sound stayed 0.118 s behind).
  const late = [{ stamp: 1007, ran: 1118 }, { stamp: 1119, ran: 1119 }, { stamp: 1126, ran: 1126 }]
  assert.ok(near(lagAfterHold(late, 1000, false), 0.118))
  assert.ok(near(lagAfterHold(late, 1000, true), 0))
  // Measured: a long frame between the hold's end and the first rolling
  // tick, 49 ms: under the 50 ms that made the old code seek again.
  const long = [{ stamp: 1049, ran: 1049 }, { stamp: 1056, ran: 1056 }]
  assert.ok(near(lagAfterHold(long, 1000, false), 0.049))
  assert.ok(near(lagAfterHold(long, 1000, true), 0))
  // The next frame's own time older than the moment the hand-over ran: no
  // time is counted twice, none backwards.
  const stale = [{ stamp: 1007, ran: 1130 }, { stamp: 1125, ran: 1131 }, { stamp: 1138, ran: 1138 }]
  assert.ok(near(lagAfterHold(stale, 1000, true), 0))
})
