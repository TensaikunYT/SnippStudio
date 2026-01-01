// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Many sequences, the failing ones shrunk and printed:
// `node out-test/test/oracle/many.js <pure|agent|full> [n] [from] [show]`.
import '../dom-stub'
import { addTo, emptyTally, runSequence, shrink } from './gen'

async function main(): Promise<void> {
  const kind = process.argv[2] ?? 'full'
  const n = Number(process.argv[3] ?? 100)
  const from = Number(process.argv[4] ?? 1)
  const show = Number(process.argv[5] ?? 3)
  const tally = emptyTally()
  let shown = 0
  const kinds = new Set<string>()
  const why = new Map<string, number>()
  for (let seed = from; seed < from + n; seed++) {
    const r = await runSequence({ seed, pure: kind === 'pure', agentOnly: kind === 'agent', two: kind === 'two', keep: kind === 'keep' })
    addTo(tally, r)
    for (const o of r.obs) if (!o.applied && o.classes === '' && !o.afterChoice && !(o.reason ?? '').startsWith('its ids and times')) why.set(`${o.name.split(' ')[0]}: ${(o.reason ?? '?').slice(0, 90)}`, (why.get(`${o.name.split(' ')[0]}: ${(o.reason ?? '?').slice(0, 90)}`) ?? 0) + 1)
    const k = r.violations[0]?.kind
    if (k && !kinds.has(k) && shown < show) {
      kinds.add(k)
      shown++
      const s = await shrink(r)
      console.log(`--- seed ${seed} ${r.shapeName} ${r.mode}: ${s.violations[0]?.kind}: ${s.violations[0]?.detail} ${s.violations[0]?.op ?? ''}`)
      console.log(s.log.length > 9 ? `(${s.log.length} steps: not shown)` : s.log.map((l) => l.slice(0, 260)).join('\n'))
    }
  }
  const { firstFailures: _f, liveness, firstDrops: _d, ...rest } = tally
  console.log(JSON.stringify(rest))
  console.log(JSON.stringify(Object.fromEntries([...why].sort((a, b) => b[1] - a[1]).slice(0, 14))))
  if (kind === 'full') console.log(JSON.stringify(Object.fromEntries(Object.entries(liveness).filter(([k, v]) => !k.includes('+') || v.dropped > 0))))
}
void main()
