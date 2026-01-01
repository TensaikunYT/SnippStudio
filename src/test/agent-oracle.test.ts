// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (A8): random sequences of agent and user steps over
// the draft core, judged by an oracle written apart from the core's own
// checks (src/test/oracle/). 40 fixed seeds run here; `npm run fuzz` runs the
// full set in shards (scripts/fuzz.mjs).
import './dom-stub'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { livenessBreaks, replaySteps, runMany } from './oracle/gen'
import { VARIANTS } from './oracle/fixture'
import { KNOWN } from './oracle/known'
import { FIXED } from './oracle/cases'

/** The core under test: 'old' is 57b03ed's (the oracle must SEE its faults),
 *  'new' the rebuilt one (it must have none). */
const CORE = 'new' as 'old' | 'new'
/** Phase 4A.10: the oracle was made to see more BEFORE the core was fixed
 *  (FAZ4A-DUZELTME-2.md F). While this is true the random runs must find
 *  violations on the core of this tree (the oracle is red on it); it goes
 *  to false with the core's fixes (plan 8.0, step A), and the runs must then
 *  find none. */
const RED = false as boolean

const N = Number(process.env.ORACLE_N ?? 40)
const FROM = Number(process.env.ORACLE_FROM ?? 1)
const seeds = (n: number, from = FROM): number[] => Array.from({ length: n }, (_, i) => from + i)
const show = (t: Awaited<ReturnType<typeof runMany>>): string => {
  const { failed: _f, firstDrops: _d, ...rest } = t
  return JSON.stringify({ ...rest, firstFailures: rest.firstFailures.slice(0, 4) })
}

test('the oracle imports nothing of the agent core', () => {
  // Every file of the oracle but the driver (the one door to the core): the
  // judgement in run.ts (contextOk, wrote, putInside, meant…) and the
  // generator included. Every way of importing counts.
  const dir = join(__dirname, '..', '..', 'src', 'test', 'oracle')
  const pure = ['oracle.ts', 'sample.ts', 'fixture.ts']
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'driver.ts')
  assert.ok(files.includes('run.ts') && files.includes('gen.ts') && files.includes('oracle.ts'))
  for (const f of files) {
    const src = readFileSync(join(dir, f), 'utf8')
    const imports = [...src.matchAll(/(?:from\s+|import\s*\(?\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
    assert.ok(imports.length > 0, `${f}: its imports are read`)
    for (const i of imports) {
      assert.ok(!i.includes('/agent/') && !i.includes('renderer/src/agent'), `${f} imports ${i}`)
      if (pure.includes(f)) assert.ok(i === './fixture' || i === './sample' || i.endsWith('/renderer/src/types'), `${f} imports ${i}`)
      if (i === './driver') assert.ok(f === 'run.ts', `${f} imports the driver`)
    }
  }
  // The driver, for its part, is where the core comes in.
  assert.match(readFileSync(join(dir, 'driver.ts'), 'utf8'), /renderer\/src\/agent\/edit/)
})

test('oracle: the command layer alone is clean (one op per call, each on a fresh read)', async () => {
  const t = await runMany(seeds(N), { pure: true })
  assert.equal(t.failing, 0, show(t))
  assert.deepEqual(t.agentDrops, {}, 'nothing is dropped')
})

test('oracle: a cut through a clip that plays backwards keeps the media the range showed (plan 7.4 K-2, fixed in phase Ç2b.1)', async () => {
  const reversed = await runMany(seeds(20), { pure: true, vary: VARIANTS.reversed })
  assert.equal(reversed.failing, 0, show(reversed))
})

test('oracle: voice edits over a music bed keep the subtitles on their sound (plan 7.4 K-1, fixed in phase Ç2b.1: the command-layer faults are no longer seen)', async () => {
  const bed = await runMany([94, 114, 134], { pure: true, vary: VARIANTS.bedEdits, ops: ['cut', 'cut', 'delete', 'trimHead', 'trimEnd'] })
  assert.equal(bed.failing, 0, show(bed))
  assert.equal(bed.byKind['caption-off-sound'] ?? 0, 0)
})

for (const k of KNOWN) {
  test(`oracle: ${k.ids}: ${k.what}`, async () => {
    const found = await k.run()
    if (CORE === 'old') assert.equal(found.length > 0, k.old, k.old ? 'the oracle sees it on the old core' : 'the old core dropped it')
    else if (k.red) assert.ok(found.some((v) => v.kind === k.red), `the oracle sees it (${k.red}) while it is not fixed: ${JSON.stringify(found)}`)
    else assert.deepEqual(found, [], 'no silent wrong on the rebuilt core')
  })
}

for (const c of FIXED) {
  test(`oracle: kept from the random runs: ${c.what}`, async () => {
    const r = await replaySteps(c)
    assert.equal(r.steps.length, c.steps.length, 'every step of the kept sequence still runs')
    if (c.red) assert.ok(r.violations.some((v) => v.kind === c.red), `the oracle sees it (${c.red}) while it is not fixed: ${JSON.stringify(r.violations)}`)
    else assert.deepEqual(r.violations, [])
  })
}

test('oracle: the agent alone (drafts, old versions, two calls on one read; no user)', async () => {
  const t = await runMany(seeds(N), { agentOnly: true })
  console.log('ORACLE agentOnly', show(t))
  if (RED) assert.ok(t.failing > 0, 'the oracle sees the faults of the 4A.9 core with the agent alone')
  else if (CORE === 'new') {
    assert.equal(t.failing, 0, show(t))
    assert.deepEqual(t.agentDrops, {}, 'with no user step, no op is dropped')
  }
})

test('oracle: the two residuals of Ç2b.1\'s fuzz are judged by their own narrow rule (phase Ç2b, E3)', async () => {
  // Seed 2903: 0.02 s of a range left between the first op's cut and the
  // end of the piece in L (the core does not cut a span under 0.02 s).
  const a = await runMany([2903])
  assert.equal(a.failing, 0, show(a))
  // Seed 1437: the user's undo gave a clip of another track back its tail,
  // 0.02 s of it inside a range the agent cut: the core leaves that range
  // (footage put there after the read), a drop of class "inside", not a
  // must-stay-alive one.
  const b = await runMany([1437])
  assert.equal(b.failing, 0, show(b))
  assert.deepEqual(livenessBreaks(b), [], show(b))
})

test('oracle: agent and user', async () => {
  const t = await runMany(seeds(N))
  console.log('ORACLE full', show(t))
  if (RED) assert.ok(t.failing > 0, 'the oracle sees the faults of the 4A.9 core with agent and user')
  else if (CORE === 'new') {
    assert.equal(t.failing, 0, show(t))
    assert.deepEqual(livenessBreaks(t), [], 'cuts and placements whose content is still there stay alive')
  }
})
