// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Drops with no user step since the read, by reason: `node out-test/test/oracle/why.js <pure|agent|full> <n> <text in the reason> [how many]`.
import '../dom-stub'
import { runSequence } from './gen'

async function main(): Promise<void> {
  const kind = process.argv[2] ?? 'agent'
  const n = Number(process.argv[3] ?? 100)
  const text = process.argv[4] ?? ''
  let left = Number(process.argv[5] ?? 3)
  for (let seed = 1; seed <= n && left > 0; seed++) {
    const r = await runSequence({ seed, pure: kind === 'pure', agentOnly: kind === 'agent' })
    const hit = r.obs.find((o) => !o.applied && !o.afterChoice && (kind === 'full' || o.classes === '') && (o.reason ?? '').includes(text) && !(o.reason ?? '').startsWith('its ids and times'))
    if (!hit) continue
    left--
    console.log(`--- seed ${seed} ${r.shapeName} ${r.mode}: step ${hit.step} ${hit.name} [${hit.classes}]: ${hit.reason}`)
    console.log(r.log.filter((l) => Number(l.split(' ')[0]) <= hit.step).join('\n').slice(-1800))
  }
}
void main()
