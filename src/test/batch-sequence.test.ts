// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A batch is the same edit as its calls run one after another (SnippStudio
// phase 2A.5 A): subtitles follow their voice clip and notes their picture
// after EVERY call, not once at the end.
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { applyBatch, commandByName, runCommand, seededIds, seededRandom, type CommandCall, type CommandEnv } from '../renderer/src/commands'
import type { Project } from '../renderer/src/types'
import { checkProject, describeProblems } from '../renderer/src/model/check'

// The store's runBatch with seed 3 uses these two (random choices and new ids).
const env = (): CommandEnv => ({ random: seededRandom(3), now: () => new Date(0), newId: seededIds(3) })

/** The calls one by one, each its own edit (as separate store actions are). */
function sequence(p: Project, calls: CommandCall[], e: CommandEnv): Project {
  let cur = p
  for (const c of calls) cur = runCommand(cur, commandByName(c.name), c.params, e).project
  return cur
}

function both(calls: CommandCall[]): { seq: string; batch: string; store: string } {
  resetWorld()
  const seq = hash(sequence(fixture(), calls, env()))
  resetWorld()
  const batch = hash(applyBatch(fixture(), calls, env()).project)
  resetWorld()
  useStore.getState().loadProject(fixture())
  useStore.getState().runBatch(calls, { seed: 3 })
  const store = hash(useStore.getState().project)
  return { seq, batch, store }
}

const CASES: Record<string, CommandCall[]> = {
  'move the voice, then cut': [
    { name: 'clip.move', params: { clipId: 'sa', start: 30 } },
    { name: 'timeline.cutRanges', params: { ranges: [[0, 5]] } }
  ],
  'cut, then remove a silence from the voice': [
    { name: 'timeline.cutRanges', params: { ranges: [[0, 1]] } },
    { name: 'silence.apply', params: { regions: [{ clipId: 'sa', start: 5, end: 6 }] } }
  ],
  'speed the voice, then cut': [
    { name: 'clip.setSpeed', params: { clipId: 'sa', speed: 2 } },
    { name: 'timeline.cutRanges', params: { ranges: [[1, 2]] } }
  ],
  'cut, then trim the voice head': [
    { name: 'timeline.cutRanges', params: { ranges: [[6, 7]] } },
    { name: 'clip.trimHead', params: { clipId: 'sa', edge: 1 } }
  ],
  'a note on the picture: move its clip, then cut': [
    { name: 'clip.move', params: { clipId: 'ca', start: 40 } },
    { name: 'timeline.cutRanges', params: { ranges: [[2, 4]] } }
  ],
  'split the voice, move the right half, cut': [
    { name: 'clip.split', params: { clipIds: ['sa'], time: 5 } },
    { name: 'clip.move', params: { clipId: 'sa', start: 50 } },
    { name: 'timeline.cutRanges', params: { ranges: [[0.2, 0.4]] } }
  ]
}

test('a batch gives what its calls give one after another (picked cases)', () => {
  for (const [name, calls] of Object.entries(CASES)) {
    const r = both(calls)
    assert.equal(r.batch, r.seq, `${name}: applyBatch`)
    assert.equal(r.store, r.seq, `${name}: runBatch`)
  }
})

test('a batch gives what its calls give one after another (random sequences)', () => {
  const rand = seededRandom(19)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
  const t = () => +(rand() * 20).toFixed(2)
  const makers: (() => CommandCall)[] = [
    () => ({ name: 'timeline.cutRanges', params: { ranges: [[t(), 0]].map(([a]) => [a, +(a + 0.2 + rand()).toFixed(2)]) } }),
    () => ({ name: 'clip.move', params: { clipId: pick(['sa', 'ca', 'ov', 'm1']), start: t() } }),
    () => ({ name: 'clip.setSpeed', params: { clipId: pick(['sa', 'cb', 'm1']), speed: pick([0.5, 1.5, 2]) } }),
    () => ({ name: 'clip.trimEnd', params: { clipId: pick(['sa', 'cb', 'm1']), delta: -rand() * 2 } }),
    () => ({ name: 'silence.apply', params: { regions: [{ clipId: 'sa', start: 1 + rand() * 3, end: 4.5 + rand() }] } }),
    () => ({ name: 'clip.split', params: { clipIds: [pick(['sa', 'ca', 'm1'])], time: 1 + rand() * 8 } })
  ]
  let rounds = 0
  for (let round = 0; round < 40; round++) {
    const calls = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => pick(makers)())
    const r = both(calls)
    assert.equal(r.batch, r.seq, `round ${round}: ${JSON.stringify(calls)}`)
    assert.equal(r.store, r.seq, `round ${round} (store)`)
    // And the model's rules hold after it (phase Ç2a.1; each call is checked
    // on its own by the test hook, src/test/model-check-setup.ts).
    assert.equal(describeProblems(checkProject(useStore.getState().project)), '', `round ${round}: ${JSON.stringify(calls)}`)
    rounds++
  }
  assert.equal(rounds, 40)
})

test('note calls make no undo step: alone none, with film edits only the film\'s one; before a film call they are refused', () => {
  const S = useStore.getState
  resetWorld()
  S().loadProject(fixture())
  const id = S().project.notes![0].id
  S().runBatch([{ name: 'note.setStatus', params: { id, status: 'ready', reply: 'done' } }])
  assert.equal(S().past.length, 0)
  assert.equal(S().project.notes![0].status, 'ready')
  S().runBatch([
    { name: 'marker.add', params: { time: 3 } },
    { name: 'note.setStatus', params: { id, status: 'agent' } },
    { name: 'note.add', params: { start: 1, end: 2, kind: 'fix', text: 'after the marker' } }
  ])
  assert.equal(S().past.length, 1)
  assert.equal(S().project.notes!.length, 2)
  assert.throws(() => S().runBatch([{ name: 'note.setStatus', params: { id, status: 'open' } }, { name: 'marker.add', params: { time: 4 } }]), /note\.\* calls come after/)
})
