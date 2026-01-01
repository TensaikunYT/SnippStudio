// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAnimation, applyKeyframeStamp, readKeyframeStamp, snapshotAnimation } from '../renderer/src/state/animclip'
import type { Clip } from '../renderer/src/types'

let n = 0
const ids = (): string => `id${++n}`

const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: 'c1',
    assetId: 'a1',
    trackId: 't1',
    start: 0,
    duration: 5,
    inPoint: 0,
    volume: 1,
    ...over
  }) as Clip

test('copying reads the keyframes, pasting puts them on another clip', () => {
  const src = clip({
    channels: { x: [{ id: 'k1', time: 0, value: 0 }, { id: 'k2', time: 2, value: 400 }] }
  })
  const snap = snapshotAnimation(src)
  assert.ok(snap)
  const dst = clip({ id: 'c2', start: 30, duration: 9 })
  applyAnimation(dst, snap!, ids)
  assert.deepEqual(
    dst.channels?.x?.map((k) => [k.time, k.value]),
    [[0, 0], [2, 400]]
  )
  // Clip-local times: the animation lands the same however far along the
  // timeline the target sits.
  assert.equal(dst.start, 30)
})

test('the pasted keyframes are independent of the ones they came from', () => {
  const src = clip({ channels: { scale: [{ id: 'k1', time: 1, value: 2 }] } })
  const dst = clip({ id: 'c2' })
  applyAnimation(dst, snapshotAnimation(src)!, ids)
  assert.notEqual(dst.channels!.scale![0].id, 'k1')
  dst.channels!.scale![0].value = 9
  assert.equal(src.channels!.scale![0].value, 2)
})

// (A clip saved in the older format — one shared keyframe list — is
// converted when its file is read: phase Ç2c.1, decision 3, format 5;
// tested in c2c1-format.test.ts. The copy no longer reads the old list.)

test('a clip with no animation at all copies nothing', () => {
  assert.equal(snapshotAnimation(clip()), null)
  // Which is the point: an empty snapshot pasted onto a keyframed clip would
  // erase it, and that is worse than the button doing nothing.
})

test('entrance, exit and idle motion travel with the keyframes', () => {
  const src = clip({
    anim: { in: 'slide-up', inDur: 0.4, out: 'fade', outDur: 0.3 },
    idle: { style: 'handheld', amount: 0.5, speed: 1 }
  })
  const dst = clip({ id: 'c2' })
  applyAnimation(dst, snapshotAnimation(src)!, ids)
  assert.equal(dst.anim?.in, 'slide-up')
  assert.equal(dst.idle?.style, 'handheld')
})

test('pasting replaces the target’s animation instead of merging with it', () => {
  const src = clip({ channels: { x: [{ id: 'k1', time: 0, value: 5 }] } })
  const dst = clip({
    id: 'c2',
    channels: { y: [{ id: 'k9', time: 0, value: 99 }] },
    idle: { style: 'sway', amount: 1, speed: 1 }
  })
  applyAnimation(dst, snapshotAnimation(src)!, ids)
  assert.equal(dst.channels?.y, undefined, 'the old channel must not survive')
  assert.equal(dst.channels?.x?.length, 1)
  assert.equal(dst.idle, undefined, 'the source had no idle motion')
})

test('a keyframe is copied as the pose at that instant', () => {
  const src = clip({
    channels: {
      x: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 2, value: 400 }],
      scale: [{ id: 'c', time: 2, value: 1.8 }]
    }
  })
  const stamp = readKeyframeStamp(src, 2, 30)
  assert.ok(stamp)
  assert.deepEqual(stamp!.values, { x: 400, scale: 1.8 })
  // Not every channel — only the ones that actually had a keyframe there.
  assert.equal('opacity' in stamp!.values, false)
  assert.equal(readKeyframeStamp(src, 1, 30), null, 'nothing at an empty instant')
})

test('pasting a keyframe lands at the playhead, not where it came from', () => {
  const src = clip({ channels: { x: [{ id: 'a', time: 2, value: 400 }] } })
  const dst = clip({ id: 'c2', duration: 12 })
  applyKeyframeStamp(dst, 7.5, readKeyframeStamp(src, 2, 30)!, 30, ids)
  assert.deepEqual(dst.channels?.x?.map((k) => [k.time, k.value]), [[7.5, 400]])
})

test('pasting a keyframe ADDS to the clip instead of replacing its animation', () => {
  // The difference that matters: paste-animation is "move like that clip",
  // paste-keyframe is "put that pose here". The second must not cost you the
  // keyframes you already had.
  const src = clip({ channels: { scale: [{ id: 'a', time: 0, value: 2 }] } })
  const dst = clip({
    id: 'c2',
    duration: 10,
    channels: {
      x: [{ id: 'x1', time: 0, value: 0 }, { id: 'x2', time: 4, value: 100 }],
      scale: [{ id: 's1', time: 0, value: 1 }]
    }
  })
  applyKeyframeStamp(dst, 4, readKeyframeStamp(src, 0, 30)!, 30, ids)
  assert.equal(dst.channels?.x?.length, 2, 'the other channel is untouched')
  assert.deepEqual(dst.channels?.scale?.map((k) => [k.time, k.value]), [[0, 1], [4, 2]])
})

test('pasting onto an instant that already has a keyframe replaces its value', () => {
  const src = clip({ channels: { scale: [{ id: 'a', time: 0, value: 3 }] } })
  const dst = clip({ id: 'c2', channels: { scale: [{ id: 's1', time: 1, value: 1 }] } })
  applyKeyframeStamp(dst, 1.01, readKeyframeStamp(src, 0, 30)!, 30, ids)
  assert.equal(dst.channels?.scale?.length, 1, 'two keyframes a hair apart are one keyframe')
  assert.equal(dst.channels?.scale?.[0].value, 3)
})

test('keyframes stay sorted after a paste in the middle', () => {
  const dst = clip({
    id: 'c2',
    duration: 10,
    channels: { x: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 8, value: 80 }] }
  })
  applyKeyframeStamp(dst, 4, { values: { x: 40 }, fromTime: 0 }, 30, ids)
  assert.deepEqual(dst.channels?.x?.map((k) => k.time), [0, 4, 8])
})

test('retiming a clip retimes what is keyed to it', () => {
  // Keyframe times are clip-local TIMELINE seconds, so a clip whose timeline
  // length halves must halve them too — otherwise an animation written for ten
  // seconds sits inside a five second clip and only its first half ever plays.
  const c = clip({
    duration: 10,
    channels: { x: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 10, value: 100 }] },
    volumeKeyframes: [{ id: 'v', time: 8, value: 0.5 }]
  })
  const factor = 0.5
  const scaled = {
    ...c,
    duration: c.duration * factor,
    channels: { x: c.channels!.x!.map((k) => ({ ...k, time: k.time * factor })) },
    volumeKeyframes: c.volumeKeyframes!.map((k) => ({ ...k, time: k.time * factor }))
  }
  assert.deepEqual(scaled.channels.x.map((k) => k.time), [0, 5])
  assert.equal(scaled.volumeKeyframes[0].time, 4)
  // The last keyframe still lands on the clip's last frame, which is the
  // property that matters: it was at the end before and it is at the end now.
  assert.equal(scaled.channels.x[scaled.channels.x.length - 1].time, scaled.duration)
})
