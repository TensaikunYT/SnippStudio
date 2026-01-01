// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Time limits of the e2e rig (FAZ5-PLAN.md, "rig"). On 16 Nov 2026 a run hung
// for 1 h 43 min inside one scenario (a screenshot that never came back) and
// the whole acceptance chain stood still. Now each scenario has a limit
// (default DEFAULT_SCENARIO_MS, or the scenario's own `timeoutMs`); past it the
// scenario is failed with where it stood, and the run goes on with a new app.

export const DEFAULT_SCENARIO_MS = 120_000
export const SCREENSHOT_MS = 15_000
/** The reference frames (run.mjs): 39 s on a quiet machine (16 Nov 2026), 103 s
 *  under a mutation run (17 Nov): about × 3 of the slow one. */
export const REFERENCE_FRAMES_MS = 300_000

export class TimedOut extends Error {
  constructor(ms, where) {
    super(`timed out after ${Math.round(ms / 1000)} s${where ? ` (last step: ${where})` : ''}`)
    this.timedOut = true
  }
}

/** `work()` raced against `ms`: its value, or a TimedOut (with `where()`, what
 *  the scenario was doing). The work itself is left to fail on its own (its
 *  window is closed by the caller); its late failure is swallowed. */
export function withLimit(work, ms, where = () => '') {
  let timer
  const p = Promise.resolve().then(work)
  p.catch(() => undefined)
  return Promise.race([
    p,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new TimedOut(ms, where())), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

/** Runs the scenarios one after another, each within its limit.
 *  hooks.limitOf(s) → ms; hooks.run(s) → the scenario's work; hooks.where() →
 *  its last step; hooks.recover(s, err) → a fresh app after a failure (awaited);
 *  hooks.report({ name, ok, ms, error, timedOut }). Never throws for a scenario. */
export async function runScenarioList(list, hooks) {
  const results = []
  for (const s of list) {
    const t0 = Date.now()
    let ok = true
    let error = null
    let timedOut = false
    try {
      await withLimit(() => hooks.run(s), hooks.limitOf(s), hooks.where ?? (() => ''))
    } catch (err) {
      ok = false
      timedOut = !!err?.timedOut
      error = String(err?.stack ?? err).split('\n').slice(0, 6).join('\n')
      try {
        await hooks.recover?.(s, err)
      } catch (e) {
        error += '\n(relaunch failed: ' + e + ')'
      }
    }
    const r = { name: s.name, ok, ms: Date.now() - t0, error, timedOut }
    results.push(r)
    hooks.report?.(r)
  }
  return results
}
