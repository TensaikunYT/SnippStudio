// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 9 (auditors' "copy animation from a split half…"): a piece
// of a clip carries its whole key list (phase Ç2c.1), so copying its
// animation carried the keys of the half that was cut away, and a longer clip
// it was pasted on moved on with motion the source never showed. The copy is
// now what the source shows: the keys on it, and a key at each edge that has
// keys beyond it, with the value shown there.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { commandByName, runCommand } from '../renderer/src/commands'
import { clipOpacityAt, clipTransformAt } from '../renderer/src/playback/pose'
import { applyAnimation, snapshotAnimation } from '../renderer/src/state/animclip'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

function base(channels: Clip['channels']): Project {
  const p = defaultProject()
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 200, width: 1920, height: 1080, hasAudio: true } as never]
  p.clips.x = { id: 'x', assetId: 'vid', trackId: 'V1', start: 2, inPoint: 30, duration: 10, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1, opacity: 1, channels } as Clip
  p.captions = []
  return p
}
const split = (p: Project, t: number): Project => runCommand(p, commandByName('clip.split'), { clipIds: ['x'], time: t }).project
let n = 0
const ids = (): string => `id${++n}`

test('item 9 (auditors\' probe): the left half of a split pastes no motion after its own end', () => {
  const p = base({ x: [{ id: 'a', time: 1, value: 0 }, { id: 'b', time: 4, value: 300 }, { id: 'c', time: 9, value: 900, easing: 'easeIn' }] })
  const left = split(p, 5).clips.x // 0..3 of the clip
  const target = structuredClone(p.clips.x)
  target.channels = undefined
  applyAnimation(target, snapshotAnimation(left)!, ids)
  const after = [3, 5, 7, 9].map((u) => clipTransformAt(target, u).x)
  assert.equal(new Set(after).size, 1, `after 3 s it holds still: ${after}`)
  // At its keys and at its edges it shows what the source showed.
  for (const u of [0, 1, 3]) assert.ok(Math.abs(clipTransformAt(target, u).x - clipTransformAt(left, u).x) < 1e-9, `at ${u}`)
  assert.deepEqual(target.channels!.x!.map((k) => k.time), [1, 3], 'the key on it, a key at its end')
})

test('item 9: the right half: a key at its start with the value shown there; a linear curve is drawn as it was', () => {
  const p = base({ opacity: [{ id: 'a', time: 1, value: 0, easing: 'linear' }, { id: 'b', time: 4, value: 1, easing: 'linear' }, { id: 'c', time: 9, value: 0.2, easing: 'linear' }] })
  const q = split(p, 5)
  const right = Object.values(q.clips).find((c) => c.id !== 'x')! // 3..10 of the clip: 0..7
  const snap = snapshotAnimation(right)!
  assert.deepEqual(snap.channels!.opacity!.map((k) => +k.time.toFixed(9)), [0, 1, 6], 'an edge key at 0, the keys on it; none past its end')
  const target = structuredClone(p.clips.x)
  target.channels = undefined
  applyAnimation(target, snap, ids)
  for (let i = 0; i <= 28; i++) {
    const u = (7 * i) / 28
    assert.ok(Math.abs(clipOpacityAt(target, u) - clipOpacityAt(right, u)) < 1e-9, `at ${u}`)
  }
})

test('item 9: a clip whose keys all lie on it copies them as they are', () => {
  const p = base({ y: [{ id: 'a', time: 0, value: 0 }, { id: 'b', time: 10, value: 50, easing: 'hold' }] })
  const snap = snapshotAnimation(p.clips.x)!
  assert.deepEqual(snap.channels!.y, p.clips.x.channels!.y)
})
