// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The must-stay-alive drops, by reason: `node out-test/test/oracle/live.js <n> [from] [seeds per reason]`.
// (A cut or a placement whose content is still there, dropped after user
// changes that should never drop it: A8.)
import '../dom-stub'
import { ALWAYS_ALIVE, runSequence } from './gen'

async function main(): Promise<void> {
  const n = Number(process.argv[2] ?? 100)
  const from = Number(process.argv[3] ?? 1)
  const per = Number(process.argv[4] ?? 4)
  const why = new Map<string, { n: number; seeds: string[] }>()
  for (let seed = from; seed < from + n; seed++) {
    const r = await runSequence({ seed })
    for (const o of r.obs) {
      if (o.applied || o.afterChoice || (o.fam !== 'cut' && o.fam !== 'place')) continue
      if (!o.classes.split('+').every((c) => ALWAYS_ALIVE.includes(c))) continue
      const key = `${o.name.split(' ')[0]}: ${(o.reason ?? '?').replace(/[0-9a-f]{8}-[0-9a-f]{4}|\d+(\.\d+)?/g, 'N').slice(0, 110)}`
      const row = why.get(key) ?? { n: 0, seeds: [] }
      row.n++
      if (row.seeds.length < per) row.seeds.push(`${seed}@${o.step}[${o.classes}]`)
      why.set(key, row)
    }
  }
  for (const [k, v] of [...why].sort((a, b) => b[1].n - a[1].n)) console.log(`${v.n}  ${k}  ${v.seeds.join(' ')}`)
}
void main()
