// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One sequence, printed: `node out-test/test/oracle/one.js <seed> [pure|agent|full|keep|wild] [shrink]`.
import '../dom-stub'
import { runSequence, shrink } from './gen'
import { VARIANTS, ownSoundOverMusic } from './fixture'

async function main(): Promise<void> {
  const seed = Number(process.argv[2] ?? 1)
  const kind = process.argv[3] ?? 'full'
  const vary = VARIANTS[process.argv[5] ?? '']
  const make = process.argv[5] === 'ownSound' ? ownSoundOverMusic : undefined
  let r = await runSequence({ seed, pure: kind === 'pure', agentOnly: kind === 'agent', two: kind === 'two', keep: kind === 'keep' || kind === 'wild', wild: kind === 'wild', vary, make })
  if (process.argv[4] === 'shrink') r = await shrink(r, vary, make)
  console.log(`seed ${seed} ${r.shapeName} ${r.mode}`)
  console.log(r.log.join('\n'))
  console.log(JSON.stringify(r.violations, null, 1))
  if (process.argv[4] === 'shrink') console.log(JSON.stringify({ seed: r.seed, shape: r.shape, mode: r.mode, steps: r.steps }))
  if (process.argv[4] === 'obs') console.log(JSON.stringify(r.obs.filter((o) => !o.applied)))
}
void main()
