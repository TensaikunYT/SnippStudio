// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Çekirdek cila S: the oracle with the ripple's keepTracks. `npm run fuzz`
// runs a "keep" kind (the full run, the user's cuts leaving the music bed
// alone where the project has one); this is a small fixed slice of it, so
// the suite itself notices when a kept-bed cut breaks the model or an
// agent's waiting op.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { runSequence } from './oracle/gen'

test('the oracle, 40 sequences in which the user\'s cuts keep the music bed: no violation, and such cuts are really made', async () => {
  let kept = 0
  for (let seed = 1; seed <= 40; seed++) {
    const r = await runSequence({ seed, keep: true })
    assert.deepEqual(r.violations.map((v) => `${v.kind}: ${v.detail}`), [], `seed ${seed}`)
    kept += r.steps.filter((s) => s.k === 'user' && s.act.t === 'cutKeep').length
  }
  assert.ok(kept >= 5, `${kept} cuts kept the bed`)
})

test('the other kinds draw the same sequences as before (the keep kind takes nothing from the random stream)', async () => {
  for (const seed of [3, 17, 41]) {
    const a = await runSequence({ seed })
    const b = await runSequence({ seed, keep: true })
    // Same steps up to the first cut that keeps the bed.
    const at = b.steps.findIndex((s) => s.k === 'user' && s.act.t === 'cutKeep')
    const n = at < 0 ? Math.min(a.steps.length, b.steps.length) : at
    // (Ids of clips made on the way are random: the kinds of the steps are compared.)
    const kinds = (r: typeof a): string => r.steps.slice(0, n).map((s) => (s.k === 'user' ? `user:${s.cls}` : s.k === 'edit' ? `edit:${s.ops.map((x) => x.op).join(',')}` : s.k)).join(' ')
    assert.equal(kinds(b), kinds(a), `seed ${seed}`)
    assert.ok(!a.steps.some((s) => s.k === 'user' && s.act.t === 'cutKeep'))
  }
})
