// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The model checker (model/check.ts, phase Ç2a.1): a sound project has no
// problem; each rule, broken on purpose, is reported under its own code.
import { fixture, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkProject, describeProblems, newProblems, type Problem } from '../renderer/src/model/check'
import { SHAPES, VARIANTS } from './oracle/fixture'
import type { Project } from '../renderer/src/types'
import { commandByName, runCommand } from '../renderer/src/commands'

const codes = (list: Problem[]): string[] => [...new Set(list.map((x) => x.code))].sort()

test('the undo fixture (a bit of everything) breaks no rule', () => {
  resetWorld()
  assert.deepEqual(checkProject(fixture()), [])
})

const BROKEN: [string, (p: Project) => void, Problem['code']][] = [
  ['a track lists a clip that does not exist', (p) => p.tracks[0].clipIds.push('nope'), 'track-clip-missing'],
  ['a clip listed on another track than its own', (p) => { p.tracks[0].clipIds.push('ov'); p.tracks[1].clipIds = [] }, 'track-clip-elsewhere'],
  ['a clip on no track', (p) => void (p.tracks[1].clipIds = []), 'clip-not-on-track'],
  ['a clip on two tracks', (p) => void p.tracks.find((t) => t.id === 'v1')!.clipIds.push('ov'), 'clip-on-two-tracks'],
  ['a clip stored under another key', (p) => { p.clips.other = { ...p.clips.ov, id: 'ov2' } }, 'clip-key'],
  ['a track out of order', (p) => void p.tracks.find((t) => t.id === 'v1')!.clipIds.reverse(), 'track-unsorted'],
  ['two clips overlap', (p) => void (p.clips.cb.start = 9), 'track-overlap'],
  ['two clips with one id at different depths', (p) => { p.clips.cc.nested = { clips: [{ ...p.clips.ca }] } }, 'duplicate-id'],
  ['two tracks with one id', (p) => void (p.tracks[1].id = p.tracks[0].id), 'duplicate-id'],
  ['a clip of an asset that does not exist', (p) => void (p.clips.ov.assetId = 'gone'), 'missing-asset'],
  ['a compound child of an asset that does not exist', (p) => { p.clips.cc.nested = { clips: [{ ...p.clips.ov, id: 'kid', assetId: 'gone' }] } }, 'missing-asset'],
  ['a clip of a track that does not exist', (p) => void (p.clips.ov.trackId = 'v9'), 'missing-track'],
  ['a clip following a tracker that does not exist', (p) => void (p.clips.ov.trackerId = 'tr9'), 'missing-tracker'],
  ['a group of a clip that does not exist', (p) => void p.groups![0].clipIds.push('gone'), 'missing-group-clip'],
  ['a duration of 0', (p) => void (p.clips.ov.duration = 0), 'bad-time'],
  ['a start that is not a number', (p) => void (p.clips.ov.start = null as unknown as number), 'bad-time'],
  ['a speed of 0', (p) => void (p.clips.cb.speed = 0), 'bad-time'],
  ['a caption ending before it starts', (p) => void (p.captions[0].end = -1), 'bad-time'],
  ['a source window past the media end', (p) => void (p.clips.cb.inPoint = 25), 'outside-media'],
  ['a freeze past the media end', (p) => void (p.clips.cb.freeze = 99), 'outside-media'],
  ['a link on one clip only', (p) => void delete p.clips.sa.linkId, 'link-alone'],
  ['keys out of order', (p) => void p.clips.cb.channels!.scale!.reverse(), 'keys-unsorted'],
  ['a key value that is not a number', (p) => void (p.clips.cb.channels!.scale![0].value = NaN), 'bad-key'],
  ['a volume key at no time', (p) => void (p.clips.m1.volumeKeyframes = [{ id: 'v', time: Infinity, value: 1 }]), 'bad-key'],
  ['no track list', (p) => void delete (p as Partial<Project>).tracks, 'shape'],
  ['settings with fps 0', (p) => void (p.settings.fps = 0), 'shape']
]

test('each broken rule is reported under its own code', () => {
  for (const [name, breakIt, code] of BROKEN) {
    resetWorld()
    const p = fixture()
    breakIt(p)
    const got = codes(checkProject(p))
    assert.ok(got.includes(code), `${name}: expected ${code}, got ${got.join(', ') || 'nothing'}`)
  }
})

test('the oracle\'s projects and their variants break no rule (the random runs start from sound projects)', () => {
  for (const make of SHAPES) {
    for (const [name, vary] of [['as made', () => undefined], ...Object.entries(VARIANTS)] as [string, (s: ReturnType<typeof make>) => void][]) {
      const s = make()
      vary(s)
      assert.equal(describeProblems(checkProject(s.project)), '', `${s.name} ${name}`)
    }
  }
})

test('K-4 / P10 (fixed in phase Ç2b.1): clip.move with the A/V link lands the partner where it has room, or moves nothing', () => {
  // Before, the partner moved by the same amount with no look at its track:
  // sa landed on sb (a track-overlap the checker had to let through).
  resetWorld()
  const p = fixture()
  const v1 = p.tracks.find((t) => t.id === 'v1')!
  v1.clipIds = ['ca']
  delete p.clips.cb
  delete p.clips.cc
  delete p.groups
  p.clips.sb = { ...p.clips.sa, id: 'sb', start: 12, duration: 4, inPoint: 20 }
  delete p.clips.sb.linkId
  p.tracks.find((t) => t.id === 'a1')!.clipIds = ['sa', 'sb']
  assert.deepEqual(checkProject(p), [])
  const out = runCommand(p, commandByName('clip.move'), { clipId: 'ca', start: 8, linkAV: true }, { random: () => 0.5, now: () => new Date(0) }).project
  assert.deepEqual(newProblems(p, out), [])
  // The picture went to 8 and its sound with it; sb, in the way, moved on.
  assert.equal(out.clips.ca.start, 8)
  assert.equal(out.clips.sa.start, 8)
  assert.equal(out.clips.sb.start, 18)
})

test('newProblems names only what the edit broke', () => {
  resetWorld()
  const before = fixture()
  before.clips.ov.assetId = 'gone'
  const after: Project = { ...before, clips: { ...before.clips, cb: { ...before.clips.cb, start: 9 } } }
  assert.deepEqual(codes(newProblems(before, after)), ['track-overlap'])
  assert.deepEqual(newProblems(before, before), [])
})
