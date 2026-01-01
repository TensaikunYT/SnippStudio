// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One shard of the full run (scripts/fuzz.mjs starts several):
// `node out-test/test/oracle/shard.js <from> <count> <pure|agent|full|two|keep|wild> [noshrink]`.
// Prints one JSON line: the tally and, for the first failing sequences, the
// shrunk steps (ready to be kept as a fixed case).
import '../dom-stub'
import { addTo, emptyTally, runSequence, shrink, type SequenceResult } from './gen'

async function main(): Promise<void> {
  const from = Number(process.argv[2] ?? 1)
  const count = Number(process.argv[3] ?? 100)
  const kind = process.argv[4] ?? 'full'
  const t0 = Date.now()
  const tally = emptyTally()
  const failed: SequenceResult[] = []
  for (let seed = from; seed < from + count; seed++) {
    const r = await runSequence({ seed, pure: kind === 'pure', agentOnly: kind === 'agent', two: kind === 'two', keep: kind === 'keep' || kind === 'wild', wild: kind === 'wild' })
    addTo(tally, r)
    if (r.violations.length && failed.length < 3) failed.push(r)
  }
  tally.ms = Date.now() - t0
  const cases = []
  // (The mutation run only counts: it does not wait for the shrinking.)
  for (const r of process.argv[5] === 'noshrink' ? [] : failed) {
    const s = await shrink(r)
    cases.push({ seed: s.seed, shape: s.shape, mode: s.mode, kind: s.violations[0]?.kind, detail: s.violations[0]?.detail, steps: s.steps })
  }
  process.stdout.write(JSON.stringify({ kind, from, count, tally, cases }) + '\n')
}
void main()
