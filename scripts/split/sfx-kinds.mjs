// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/sfx-kinds.mjs: every sound kind the synthesizer knows
// (the unions in audio/sfx-synth.ts, sfx-synth2.ts, sfx-scale.ts,
// sfx-shots.ts), and whether anything outside the synthesizer names it — the
// dead Stage recipes are the ones nothing names (phase 2B).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const SRC = new URL('../../src/renderer/src/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
// (sfx-synth2, sfx-scale and sfx-shots held only dead recipes: gone in phase 2B.)
const synthFiles = ['audio/sfx-synth.ts', 'audio/sfx-synth2.ts', 'audio/sfx-scale.ts', 'audio/sfx-shots.ts'].filter((f) => existsSync(join(SRC, f)))
const kinds = new Map()
for (const f of synthFiles) {
  const t = readFileSync(join(SRC, f), 'utf8')
  for (const m of t.matchAll(/export type (\w+)\s*=\s*((?:\s*\|?\s*'[\w-]+')+)/g)) for (const k of m[2].matchAll(/'([\w-]+)'/g)) kinds.set(k[1], `${f}:${m[1]}`)
}
const files = []
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e) && files.push(p) } }
walk(SRC)
const outside = files.filter((f) => !/audio[\\/]sfx-(synth|synth2|scale|shots|dsp)\.ts$/.test(f))
const texts = outside.map((f) => [relative(SRC, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')])
const used = [], dead = []
for (const [k, from] of kinds) {
  const where = texts.filter(([, t]) => t.includes(`'${k}'`) || t.includes(`"${k}"`)).map(([f]) => f)
  ;(where.length ? used : dead).push({ k, from, where })
}
console.log(`${kinds.size} kinds: ${used.length} named outside the synthesizer, ${dead.length} not`)
for (const d of dead) console.log(`dead ${d.k.padEnd(12)} ${d.from}`)
if (process.argv.includes('--used')) for (const u of used) console.log(`used ${u.k.padEnd(12)} ${u.where.slice(0, 3).join(', ')}`)
