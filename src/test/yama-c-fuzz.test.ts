// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Audit patch (yama-c), D5: the oracle's "wild" kind (`npm run fuzz` runs
// 1 000): the user's voice clips through a high speed (22x – 100x), a speed
// curve and cuts that leave the music bed alone (a transcript delete, a
// silence cut) in one sequence, and every step checked for the subtitle
// lines (oracle/lines.ts). This is a small fixed slice of it, so the suite
// itself notices. Before the Y1 fix the same 40 seeds broke the line rules.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mixOf, replaySteps, runSequence } from './oracle/gen'
import type { Step } from './oracle/run'

test('the oracle\'s wild kind, 40 sequences: no violation, and the three really come together', async () => {
  let all = 0
  let silence = 0
  let words = 0
  for (let seed = 1; seed <= 40; seed++) {
    const r = await runSequence({ seed, keep: true, wild: true })
    assert.deepEqual(r.violations.map((v) => `${v.kind}: ${v.detail}`), [], `seed ${seed}`)
    const m = mixOf(r.steps)
    if (m.high && m.curve && m.keptCut) all++
    for (const s of r.steps) {
      if (s.k !== 'user') continue
      if (s.act.t === 'silenceKeep' && s.act.keep.length) silence++
      if (s.act.t === 'cutKeep') words++
    }
  }
  assert.ok(all >= 12, `${all} of 40 sequences hold a high speed, a curve and a kept-bed cut`)
  assert.ok(silence >= 5 && words >= 5, `kept-bed silence cuts ${silence}, transcript deletes ${words}`)
})

// Seed 639 of the wild kind, as it ran when found: a word hanging past the end
// of a voice piece taken to 100x was carried as media, and at 0.5x it came
// back 5 s past its piece (line-off-clip). follow.ts: placer().
const SEED_639 = {"seed":639,"shape":3,"mode":"draft","steps":[{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"vo1","speed":22,"linkAV":true}}},{"k":"user","cls":"rippleDelete","act":{"t":"batch","name":"clip.delete","params":{"ids":["i1"],"ripple":true}}},{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"vo1","speed":0.5,"linkAV":true}}},{"k":"user","cls":"silence","act":{"t":"silenceKeep","regions":[{"clipId":"vo1","start":65.15,"end":66.02}],"picked":["vo1"],"keep":[],"end":false}},{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"b5f4ba28-8020","speed":22,"linkAV":true}}},{"k":"user","cls":"cut","act":{"t":"cut","range":[32.8,33.64]}},{"k":"user","cls":"speed","act":{"t":"curve","clipId":"cb6f60ca-e69e","curve":{"points":[{"u":0,"v":1},{"u":0,"v":0.5},{"u":0.81,"v":1},{"u":1,"v":22}]}}},{"k":"user","cls":"trim","act":{"t":"batch","name":"clip.trimEnd","params":{"clipId":"cb6f60ca-e69e","delta":-0.34}}},{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"vo1","speed":1,"linkAV":true}}},{"k":"user","cls":"silence","act":{"t":"silenceKeep","regions":[{"clipId":"cb6f60ca-e69e","start":24.6,"end":24.98}],"picked":["cb6f60ca-e69e"],"keep":[],"end":false}},{"k":"user","cls":"cut","act":{"t":"cut","range":[28.61,29.01]}},{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"071530e4-ef56","speed":100,"linkAV":true}}},{"k":"user","cls":"speed","act":{"t":"batch","name":"clip.setSpeed","params":{"clipId":"071530e4-ef56","speed":0.5,"linkAV":true}}}]} as { seed: number; shape: number; mode: 'draft' | 'direct'; steps: Step[] }

test('the wild kind seed 639: a word hanging over a 100x piece stays by it at 0.5x', async () => {
  const r = await replaySteps(SEED_639)
  assert.deepEqual(r.violations.map((v) => `${v.kind}: ${v.detail}`), [])
  assert.equal(r.steps.length, SEED_639.steps.length)
})
