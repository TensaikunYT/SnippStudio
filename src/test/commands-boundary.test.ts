// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The commands as an agent calls them, by name (SnippStudio phase 2A.5 C):
// an id that is not there, a locked track, a field that is not allowed, an
// overlap — an error and no change, for the whole batch. Ids can be given,
// and an id made earlier in a batch can be used later in it; a seed makes
// the whole result repeatable. A candidate computed from the live version is
// adopted as one undo step.
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { AGENT_COMMANDS, COMMANDS, CommandError, applyBatch, commandByName, runCommand, seededRandom, type CommandCall, type CommandEnv } from '../renderer/src/commands'
import { placeClips } from '../renderer/src/commands/clips'
import type { Project } from '../renderer/src/types'

const env = (seed = 1): CommandEnv => ({ random: seededRandom(seed), now: () => new Date(0) })
const S = useStore.getState

function refused(calls: CommandCall[], message: RegExp, p: Project = fixture()): void {
  const before = hash(p)
  assert.throws(() => applyBatch(p, calls, env()), (e: unknown) => e instanceof CommandError && message.test(e.message), JSON.stringify(calls))
  assert.equal(hash(p), before)
}

test('an id that is not there is an error, and nothing of the batch is applied', () => {
  const ok: CommandCall = { name: 'marker.add', params: { time: 1 } }
  const cases: [CommandCall, RegExp][] = [
    [{ name: 'clip.move', params: { clipId: 'nope', start: 3 } }, /no clip "nope"/],
    [{ name: 'clip.trimEnd', params: { clipId: 'nope', delta: 1 } }, /no clip "nope"/],
    [{ name: 'clip.split', params: { clipIds: ['cb', 'nope'], time: 15 } }, /no clip "nope"/],
    [{ name: 'clip.delete', params: { ids: ['nope'] } }, /no clip "nope"/],
    [{ name: 'clip.setOpacity', params: { clipId: 'nope', opacity: 1 } }, /no clip "nope"/],
    [{ name: 'clip.moveToTrack', params: { clipId: 'ov', trackId: 'nope' } }, /no track "nope"/],
    [{ name: 'clip.add', params: { assetId: 'nope', trackId: null, start: 0 } }, /no media, clip or file name "nope"/],
    [{ name: 'timeline.cutRangeOnTrack', params: { trackId: 'nope', range: [1, 2] } }, /no track "nope"/],
    [{ name: 'transitions.mix', params: { duration: 0.5, trackId: 'nope' } }, /no track "nope"/],
    [{ name: 'caption.update', params: { id: 'nope', patch: { text: 'x' } } }, /no subtitle, title or shape "nope"/],
    [{ name: 'caption.setShape', params: { id: 't1', patch: { w: 0.4 } } }, /"t1" is not a shape/],
    [{ name: 'marker.delete', params: { id: 'nope' } }, /no marker "nope"/],
    [{ name: 'track.move', params: { trackId: 'nope', dir: 1 } }, /no track "nope"/],
    [{ name: 'track.delete', params: { trackId: 'a2' } }, null as unknown as RegExp]
  ]
  for (const [call, message] of cases) {
    if (!message) continue
    refused([ok, call], message)
  }
  // The last track of a kind cannot go.
  const one = applyBatch(fixture(), [{ name: 'track.delete', params: { trackId: 'a2' } }], env()).project
  refused([{ name: 'track.delete', params: { trackId: 'a1' } }], /last audio track/, one)
  refused([{ name: 'track.move', params: { trackId: 'v1', dir: 1 } }], /cannot move/)
})

test('a clip on a locked track cannot be edited by name (move, trim, slip, speed, settings, split, delete, onto it)', () => {
  const calls: CommandCall[] = [
    { name: 'clip.move', params: { clipId: 'cl', start: 3 } },
    { name: 'clip.trimHead', params: { clipId: 'cl', edge: 1 } },
    { name: 'clip.trimEnd', params: { clipId: 'cl', delta: -1 } },
    { name: 'clip.setSpeed', params: { clipId: 'cl', speed: 2 } },
    { name: 'clip.set', params: { clipId: 'cl', opacity: 0.5 } },
    { name: 'clip.setTransform', params: { clipId: 'cl', transform: { x: 1 } } },
    { name: 'clip.split', params: { clipIds: ['cl'], time: 2 } },
    { name: 'clip.delete', params: { ids: ['cl'] } },
    { name: 'clip.moveToTrack', params: { clipId: 'ov', trackId: 'v3' } },
    { name: 'timeline.cutRangeOnTrack', params: { trackId: 'v3', range: [1, 2] } }
  ]
  for (const call of calls) refused([call], /locked/)
})

test('object parameters are checked field by field; internal fields and commands are not reachable by name', () => {
  refused([{ name: 'caption.update', params: { id: 'c1', patch: { id: 'c2' } } }], /patch\.id: not a known field/)
  refused([{ name: 'caption.update', params: { id: 'c1', patch: { start: 'x' } } }], /patch\.start: expected a number/)
  refused([{ name: 'caption.update', params: { id: 'c1', patch: { words: 5 } } }], /patch\.words: not a known field/)
  refused([{ name: 'caption.setStyle', params: { patch: { fontSize: 'huge' } } }], /patch\.fontSize: expected a number/)
  refused([{ name: 'caption.setStyle', params: { patch: { color: 'red' } } }], /patch\.color: .*#rrggbb/)
  refused([{ name: 'caption.setOwnStyle', params: { id: 't1', patch: { bgOpacity: 3 } } }], /patch\.bgOpacity: must be at most 1/)
  refused([{ name: 'caption.setShape', params: { id: 's1', patch: { w: -1 } } }], /patch\.w: must be at least/)
  refused([{ name: 'clip.trimHead', params: { clipId: 'cb', edge: 12, base: {} } }], /base: not a known field/)
  refused([{ name: 'clip.addMedia', params: { assetIds: ['img2'], trackId: 'v2', start: 8, assets: [{}] } }], /assets: not a known field/)
  refused([{ name: 'clip.place', params: { plan: { positions: {}, trackClipIds: { v1: [] } } } }], /internal/)
  refused([{ name: 'automation.placeImages', params: { placements: [{ captionIds: ['c1'], text: 'x', start: 0.5, end: 3, assetId: 'img1', assetName: 'i', duration: 2.5 }], target: 'new', finish: { suggestions: [{ kind: 'stat', start: 1, duration: -3, items: [] }] } } }], /duration: must be at least/)
  assert.ok(COMMANDS['clip.place'] && !AGENT_COMMANDS['clip.place'])
  assert.ok(!JSON.stringify(AGENT_COMMANDS['clip.trimHead'].params.json).includes('"base"'))
  // The JSON Schema of the style lists its fields (the agent sees them).
  assert.ok(JSON.stringify(AGENT_COMMANDS['caption.setStyle'].params.json).includes('"fontSize"'))
  // The store still calls the internal ones directly.
  const p = fixture()
  assert.doesNotThrow(() => runCommand(p, placeClips, { plan: { changed: true, positions: { ov: { start: 30, trackId: 'v2' } }, trackClipIds: { v2: ['ov'] } } }))
})

test('B-roll that overlaps or comes out of order is refused (no negative-length clips)', () => {
  refused([{ name: 'broll.place', params: { placements: [{ assetId: 'img1', start: 0, end: 5 }, { assetId: 'img2', start: 2, end: 3 }], look: 'full' } }], /overlap|order/)
  refused([{ name: 'broll.place', params: { placements: [{ assetId: 'img1', start: 4, end: 5 }, { assetId: 'img2', start: 0, end: 3 }], look: 'full' } }], /overlap|order/)
})

test('ids: a creating command takes an id (refused when taken), and a batch uses what it made earlier', () => {
  const { project, results } = applyBatch(fixture(), [
    { name: 'track.add', params: { kind: 'video', id: 'TR' } },
    { name: 'clip.add', params: { assetId: 'img1', trackId: 'TR', start: 1, id: 'CL' } },
    { name: 'text.add', params: { time: 2, text: 'Hi', id: 'T1' } },
    { name: 'caption.setOwnStyle', params: { id: 'T1', patch: { color: '#ff0000' } } },
    { name: 'marker.add', params: { time: 3, id: 'M1' } },
    { name: 'template.place', params: { kind: 'stat', time: 4, id: 'G1' } },
    { name: 'shape.add', params: { time: 5, kind: 'rect', id: 'S2' } },
    { name: 'clip.append', params: { assetId: 'img3', trackId: 'v2', id: 'AP' } }
  ], env())
  assert.deepEqual(results.slice(0, 3), ['TR', ['CL'], 'T1'])
  assert.equal(project.clips.CL.trackId, 'TR')
  assert.ok(project.tracks.find((t) => t.id === 'TR')!.clipIds.includes('CL'))
  assert.equal(project.captions.find((c) => c.id === 'T1')!.style!.color, '#ff0000')
  assert.ok(project.markers!.some((m) => m.id === 'M1'))
  assert.ok(project.templates!.some((t) => t.id === 'G1'))
  assert.equal(project.captions.find((c) => c.id === 'S2')!.shape!.kind, 'rect')
  assert.equal(results[7], 'AP')
  assert.equal(project.clips.AP.trackId, 'v2')
  refused([{ name: 'text.add', params: { time: 1, id: 'c1' } }], /id "c1" is taken/)
  refused([{ name: 'clip.add', params: { assetId: 'img1', trackId: null, start: 1, id: 'ov' } }], /id "ov" is taken/)
})

test('a seed makes a batch repeatable: ids, template seeds and random choices', () => {
  const calls: CommandCall[] = [
    { name: 'template.place', params: { kind: 'stat', time: 3 } },
    { name: 'clip.split', params: { clipIds: ['cb'], time: 15 } },
    { name: 'motion.cinematize', params: { intensity: 0.5 } },
    { name: 'text.add', params: { time: 1 } }
  ]
  resetWorld()
  const a = applyBatch(fixture(), calls, { ...env(7), newId: seededIdsFor(7) })
  resetWorld()
  const b = applyBatch(fixture(), calls, { ...env(7), newId: seededIdsFor(7) })
  assert.equal(hash(a.project), hash(b.project))
  assert.deepEqual(a.results, b.results)
  // Through the store, the seed alone does it.
  resetWorld()
  S().loadProject(fixture())
  const r1 = S().runBatch(calls, { seed: 7 })
  const h1 = hash(S().project)
  resetWorld()
  S().loadProject(fixture())
  const r2 = S().runBatch(calls, { seed: 7 })
  assert.equal(hash(S().project), h1)
  assert.deepEqual(r1, r2)
})

function seededIdsFor(seed: number): () => string {
  const r = seededRandom(seed * 7919)
  return () => Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0') + '-' + Math.floor(r() * 0xffff).toString(16).padStart(4, '0')
}

test('a candidate computed from the live version is adopted as one undo step; a stale one is refused', () => {
  resetWorld()
  S().loadProject(fixture())
  const base = S().projectVersion
  const cand = applyBatch(S().project, [{ name: 'timeline.cutRanges', params: { ranges: [[1, 2]] } }, { name: 'text.add', params: { time: 1, id: 'X' } }], env()).project
  const v = S().adoptCandidate(cand, { baseVersion: base })
  assert.equal(S().project, cand)
  assert.equal(S().past.length, 1)
  assert.equal(v, S().projectVersion)
  S().undo()
  assert.equal(S().project.captions.some((c) => c.id === 'X'), false)
  // The live project moved on since the candidate was made: refused.
  const base2 = S().projectVersion
  const cand2 = applyBatch(S().project, [{ name: 'marker.add', params: { time: 9 } }], env()).project
  S().addVideoTrack()
  assert.throws(() => S().adoptCandidate(cand2, { baseVersion: base2 }), /changed since/)
  assert.throws(() => S().adoptCandidate(cand2, { baseVersion: S().projectVersion, epoch: 'another' }), /another session/)
})

test('commandByName gives only what an agent may call', () => {
  assert.throws(() => commandByName('clip.place'), /internal/)
  assert.ok(Object.keys(AGENT_COMMANDS).length >= 50)
})
