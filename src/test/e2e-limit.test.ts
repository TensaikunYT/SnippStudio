// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The e2e rig's time limit (scripts/e2e/limit.mjs; FAZ5-PLAN.md, "rig"): a
// scenario that never comes back is failed within its limit, its window is
// let go, and the next scenario still runs.
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// (The rig is ES modules; this test is compiled to CommonJS.)
const load = new Function('u', 'return import(u)') as (u: string) => Promise<any>
const rig = () => load(pathToFileURL(path.resolve(__dirname, '..', '..', 'scripts', 'e2e', 'limit.mjs')).href)

test('a scenario that never ends is failed within its limit and the next one runs', async () => {
  const { runScenarioList, DEFAULT_SCENARIO_MS, SCREENSHOT_MS, REFERENCE_FRAMES_MS } = await rig()
  assert.equal(DEFAULT_SCENARIO_MS, 120_000)
  assert.equal(SCREENSHOT_MS, 15_000)
  assert.ok(REFERENCE_FRAMES_MS >= 3 * 38_760)
  const ran: string[] = []
  const recovered: string[] = []
  let step = ''
  const t0 = Date.now()
  const results = await runScenarioList(
    [
      { name: 'hangs', limit: 150, run: () => { step = 'waiting for a screenshot'; return new Promise(() => {}) } },
      { name: 'throws', limit: 1000, run: async () => { throw new Error('boom') } },
      { name: 'passes', limit: 1000, run: async () => { ran.push('passes') } }
    ],
    {
      limitOf: (s: { limit: number }) => s.limit,
      run: (s: { run: () => Promise<void> }) => s.run(),
      where: () => step,
      recover: async (s: { name: string }) => { recovered.push(s.name) },
      report: () => {}
    }
  )
  assert.ok(Date.now() - t0 < 1000, 'the hang cost its limit, not more')
  assert.deepEqual(results.map((r: { name: string; ok: boolean; timedOut: boolean }) => [r.name, r.ok, r.timedOut]), [['hangs', false, true], ['throws', false, false], ['passes', true, false]])
  assert.match(results[0].error, /timed out after 0 s \(last step: waiting for a screenshot\)/)
  assert.ok(results[0].ms >= 140 && results[0].ms < 800, String(results[0].ms))
  assert.deepEqual(recovered, ['hangs', 'throws'], 'a fresh app after each failure')
  assert.deepEqual(ran, ['passes'])
})

test('a recovery that fails is written into the result, the list goes on', async () => {
  const { runScenarioList } = await rig()
  const results = await runScenarioList(
    [{ name: 'a', run: () => new Promise(() => {}) }, { name: 'b', run: async () => {} }],
    { limitOf: () => 50, run: (s: { run: () => Promise<void> }) => s.run(), recover: async () => { throw new Error('no app') } }
  )
  assert.equal(results[0].ok, false)
  assert.match(results[0].error, /relaunch failed: Error: no app/)
  assert.equal(results[1].ok, true)
})
