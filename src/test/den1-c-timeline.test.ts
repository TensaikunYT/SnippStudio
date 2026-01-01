// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-1 (DENEME-1-PLAN-C.md), items 3 and 4: two touching clips meet on
// the timeline (no lane between them; a lane between two clips is a real gap
// of time), and what moves a clip shows on its block.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { joinedEdges, motionMarks } from '../renderer/src/components/timeline/shared'
import type { Clip } from '../renderer/src/types'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const clip = (id: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, assetId: 'a', trackId: 'V1', start, inPoint: 0, duration, transform: { ...T0 }, volume: 1, ...extra }) as Clip

test('item 3: touching clips join on that side; a real gap, however small, does not', () => {
  const j = joinedEdges([clip('c', 10, 5), clip('a', 0, 4), clip('b', 4, 6), clip('d', 15.01, 2)])
  assert.deepEqual([...j.right].sort(), ['a', 'b'])
  assert.deepEqual([...j.left].sort(), ['b', 'c'])
  // d starts 0.01 s after c ends: a gap, shown as lane.
  assert.equal(j.left.has('d'), false)
  assert.equal(j.right.has('c'), false)
})

test('item 3: overlapping clips count as touching; one clip alone joins nothing', () => {
  const j = joinedEdges([clip('a', 0, 5), clip('b', 4.5, 2)])
  assert.ok(j.right.has('a') && j.left.has('b'))
  const one = joinedEdges([clip('a', 0, 5)])
  assert.equal(one.left.size + one.right.size, 0)
})

test('item 3: the block is drawn where it lies (no inset channel) and the joined sides lose their border', () => {
  const src = readFileSync(join(__dirname, '../../src/renderer/src/components/timeline/clip-block.tsx'), 'utf8')
  assert.match(src, /const drawLeft = left\n/)
  assert.doesNotMatch(src, /left \+ 1/)
  const css = readFileSync(join(__dirname, '../../src/renderer/src/components/timeline/timeline.css'), 'utf8')
  assert.match(css, /\.tl-clip\.join-l \{[^}]*border-left-width: 0/)
  assert.match(css, /\.tl-clip\.join-r \{[^}]*border-right-width: 0/)
})

test('item 4: picture moves are spans on the clip; effect and mask keys are marks, one per time, off-clip ones left out', () => {
  const c = clip('c', 0, 10, {
    moves: { actions: [{ id: 'm1', kind: 'enter', time: 1, dur: 0.8 } as never, { id: 'm2', kind: 'hop', time: 9.8, dur: 0.6 } as never] },
    fxKeys: { bloom: [{ id: 'k1', time: 2, value: 0 } as never, { id: 'k2', time: 12, value: 1 } as never], mosaic: [{ id: 'k3', time: 2, value: 0 } as never] },
    mask: { keyframes: [{ id: 'q', time: 5 } as never] } as never
  })
  const m = motionMarks(c)
  assert.deepEqual(m.moves, [{ id: 'm1', kind: 'enter', from: 1, to: 1.8 }, { id: 'm2', kind: 'hop', from: 9.8, to: 10 }])
  assert.deepEqual(m.keys, [{ time: 2, what: 'fx' }, { time: 5, what: 'mask' }])
  assert.deepEqual(motionMarks(clip('plain', 0, 3)), { moves: [], keys: [] })
})
