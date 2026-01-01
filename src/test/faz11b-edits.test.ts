// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b: edits of the store that 11a's random run and the limits list
// found wanting. KF6 (skip ahead is one undo step), B2 (skip ahead on a
// backwards clip goes forward in what is seen), KF7 (a compound of a
// selection that holds a clip twice).
import './dom-stub'
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import type { Clip } from '../renderer/src/types'

const S = useStore.getState
const near = (a: number, b: number, msg: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≈ ${b}`)

/** The media second a clip shows at timeline `t` (no curve). */
function shown(c: Clip, t: number): number {
  const local = t - c.start
  const speed = c.speed ?? 1
  return c.reversed ? c.inPoint + (c.duration - local) * speed : c.inPoint + local * speed
}

function load(change?: (p: ReturnType<typeof fixture>) => void): void {
  resetWorld()
  const p = fixture()
  change?.(p)
  S().loadProject(p)
}

test('KF6: skip ahead is one undo step; one Ctrl+Z gives the clip back whole', () => {
  load()
  const before = JSON.stringify(S().project.clips)
  S().skipAhead('cb', 14, 2)
  assert.equal(Object.keys(S().project.clips).length, Object.keys(JSON.parse(before)).length + 1, 'split')
  S().undo()
  assert.equal(JSON.stringify(S().project.clips), before, 'one undo: as before')
})

test('B2: skip ahead on a backwards clip shows what comes 2 s later in its playing, not 2 s earlier', () => {
  load((p) => {
    p.clips.cb.reversed = true
  })
  const cb = S().project.clips.cb
  const at14 = shown(cb, 14) // 2 + (10 - 4) = 8: it plays 12 → 2 of vid2
  near(at14, 8, 'before')
  S().skipAhead('cb', 14, 2)
  const right = Object.values(S().project.clips).find((c) => c.trackId === 'v1' && Math.abs(c.start - 14) < 1e-6)!
  assert.ok(right && right.reversed)
  near(shown(right, 14), 6, 'right after the cut: 2 s further on, backwards')
  near(right.duration, 6, 'its length kept')
  near(shown(right, 20), 0, 'it ends at the file\'s start')
  assert.equal(describeProblems(checkProject(S().project)), '')
  // Too little left before the file's start: it plays shorter, never past it.
  load((p) => {
    p.clips.cb.reversed = true
  })
  S().skipAhead('cb', 14, 3)
  const r2 = Object.values(S().project.clips).find((c) => c.trackId === 'v1' && Math.abs(c.start - 14) < 1e-6)!
  near(shown(r2, 14), 5, 'three seconds on')
  near(r2.inPoint, 0, 'down to the start of the file')
  near(r2.duration, 5, 'one second shorter')
  assert.equal(describeProblems(checkProject(S().project)), '')
})

test('B2: skip ahead on a forward clip is as before', () => {
  load()
  S().skipAhead('cb', 14, 2)
  const right = Object.values(S().project.clips).find((c) => c.trackId === 'v1' && Math.abs(c.start - 14) < 1e-6)!
  near(shown(right, 14), shown(S().project.clips.cb, 14 - 1e-9) + 2, 'two seconds on')
})

test('KF7: a selection that holds a clip twice makes one child of it', () => {
  load()
  S().selectClips(['ov', 'ov', 'cc'])
  S().compoundSelection()
  const compound = Object.values(S().project.clips).find((c) => c.nested)
  assert.ok(compound, 'a compound')
  assert.equal(compound!.nested!.clips.length, 2)
  assert.equal(new Set(compound!.nested!.clips.map((c) => c.id)).size, 2)
  assert.equal(describeProblems(checkProject(S().project)), '')
})

// (K7's re-run after KF7: a held frame in a compound left two compounds whose
// children had one id, the model check's "duplicate-id"; the pieces' children
// get ids of their own now, as a split's. A cut out of the middle was already
// right: kept as a guard.)
for (const [what, edit] of [
  ['a ripple cut out of its middle', () => S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[8, 9]] } }] as never)],
  ['a held frame in it', () => {
    const comp = Object.values(S().project.clips).find((c) => c.nested)!
    S().selectClips([comp.id])
    S().setTime(comp.start + 3)
    S().insertFreezeFrame(1)
  }]
] as const) {
  test(`K7 / KF7: ${what} of a compound gives each piece children of their own ids`, () => {
    load()
    S().selectClips(['ov', 'cc'])
    S().compoundSelection()
    const before = Object.keys(S().project.clips).length
    edit()
    const compounds = Object.values(S().project.clips).filter((c) => c.nested)
    assert.ok(compounds.length >= 2 || Object.keys(S().project.clips).length > before, `${what}: pieces`)
    const ids = compounds.flatMap((c) => c.nested!.clips.map((k) => k.id))
    assert.equal(new Set(ids).size, ids.length, 'no child id twice')
    assert.equal(describeProblems(checkProject(S().project)), '')
  })
}
