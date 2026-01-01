// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The playback engine itself (playback/engine.ts, its own tick) playing a
// candidate project, in Node with stub media elements (engine-stub.ts):
// the candidate's clips play, switching to live while playing stops them at
// once, and the store's project, history, version and saved state never move.
import { made } from './engine-stub'
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { engine } from '../renderer/src/playback/engine'
import { candidate } from '../renderer/src/playback/candidate'
import { applyBatch } from '../renderer/src/commands'

const S = useStore.getState
type Pools = { videos: Map<string, { paused: boolean; currentTime: number }>; audios: Map<string, { paused: boolean; currentTime: number }>; tick(now: number): void }
const E = engine as unknown as Pools
let now = 10_000
const run = (ms: number): void => {
  for (let t = 0; t < ms; t += 16) {
    now += 16
    E.tick(now)
  }
}
const playingIds = (): string[] => [...E.videos, ...E.audios].filter(([, el]) => !el.paused).map(([id]) => id).sort()

test('the engine plays a candidate\'s own clips; switching to live while playing stops them at once; the store does not move', () => {
  resetWorld()
  S().loadProject(fixture())
  S().setDirty(false)
  const live = S().project
  const before = { h: hash(live), past: S().past.length, future: S().future.length, version: S().projectVersion, dirty: S().dirty }
  // A candidate with a sound only it has.
  const cand = applyBatch(live, [{ name: 'clip.add', params: { assetId: 'aud1', trackId: null, start: 0, id: 'CANDSND' } }]).project
  candidate.set(cand, { show: true, baseVersion: S().projectVersion })
  S().setTime(1)
  run(50)
  S().setPlaying(true)
  run(600)
  assert.ok(S().currentTime > 1.2, `the playhead rolls (${S().currentTime})`)
  assert.ok(playingIds().includes('CANDSND'), `the candidate's own sound plays: ${playingIds()}`)
  assert.ok(made.length > 0)
  // Live again, still playing: the candidate's sound stops on the next tick.
  candidate.show('live')
  run(16)
  assert.ok(!playingIds().includes('CANDSND'), `stopped at once: ${playingIds()}`)
  run(500)
  assert.ok(playingIds().length > 0, 'the live project plays')
  assert.ok(!playingIds().includes('CANDSND'))
  // And back to the candidate while playing.
  candidate.show('candidate')
  run(600)
  assert.ok(playingIds().includes('CANDSND'))
  S().setPlaying(false)
  run(50)
  candidate.clear()
  run(50)
  assert.equal(S().project, live)
  assert.equal(hash(S().project), before.h)
  assert.deepEqual({ past: S().past.length, future: S().future.length, version: S().projectVersion, dirty: S().dirty }, { past: before.past, future: before.future, version: before.version, dirty: before.dirty })
})

test('opening another project drops the candidate', () => {
  resetWorld()
  S().loadProject(fixture())
  candidate.set(applyBatch(S().project, [{ name: 'marker.add', params: { time: 1 } }]).project, { show: true, baseVersion: S().projectVersion, epoch: S().versionEpoch })
  assert.equal(candidate.get().showing, 'candidate')
  S().loadProject(fixture())
  assert.equal(candidate.get().project, null)
  candidate.set(S().project, true)
  S().newProject()
  assert.equal(candidate.get().project, null)
})
