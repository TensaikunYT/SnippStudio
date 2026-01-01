// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/unused-strings.mjs [--json]
// Text keys that nothing reads (SnippStudio phase 3c.4b). A key is read when
// the code outside the strings files writes it whole in quotes ('a.b.c'), or
// when it starts with a prefix the code builds keys from: a template
// (`a.b.${x}`, t(`a.${k}.hint`)) or a joined string ('a.b.' + x). Tests count
// apart: a key only a test reads is listed with "(tests only)". Read-only: it
// lists, a person deletes (a key may be built in a way this cannot see).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(APP, 'src')
const UI = join(SRC, 'renderer', 'src', 'ui')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const isStrings = (f) => /[\\/]ui[\\/]strings(-[a-z0-9-]+)?\.ts$/.test(f)
const all = walk(SRC).filter((f) => /\.(ts|tsx|mjs)$/.test(f))
const tests = all.filter((f) => /[\\/]src[\\/]test[\\/]/.test(f))
const app = all.filter((f) => !isStrings(f) && !tests.includes(f))

// The keys, in the order the files write them.
const keys = []
for (const f of readdirSync(UI).filter((x) => /^strings(-[a-z0-9-]+)?\.ts$/.test(x))) {
  const s = readFileSync(join(UI, f), 'utf8')
  for (const m of s.matchAll(/^\s*'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)':\s*\{/gm)) keys.push({ key: m[1], file: f })
}

function reader(files) {
  const text = files.map((f) => readFileSync(f, 'utf8')).join('\n')
  const whole = new Set([...text.matchAll(/['"`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"`]/g)].map((m) => m[1]))
  // Prefixes: `abc.${`, `abc.def${`, 'abc.' + …
  const prefixes = new Set([
    ...[...text.matchAll(/`([a-z][a-zA-Z0-9.]*)\$\{/g)].map((m) => m[1]),
    ...[...text.matchAll(/['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]*)*\.)['"]\s*\+/g)].map((m) => m[1])
  ].filter((p) => p.includes('.') && p.length >= 3))
  // Suffix-built keys: `${x}.hint` with a known head is rare; keep the tail pattern too.
  const tails = new Set([...text.matchAll(/\}(\.[a-zA-Z0-9.]+)`/g)].map((m) => m[1]))
  return (k) => whole.has(k) || [...prefixes].some((p) => k.startsWith(p)) || false
  void tails
}
const inApp = reader(app)
const inTests = reader(tests)
const unused = keys.filter((k) => !inApp(k.key)).map((k) => ({ ...k, testsOnly: inTests(k.key) }))
if (process.argv.includes('--json')) console.log(JSON.stringify(unused, null, 1))
else {
  for (const u of unused) console.log(`${u.file}  ${u.key}${u.testsOnly ? '  (tests only)' : ''}`)
  console.log(`${unused.length} of ${keys.length} keys read nowhere in the app`)
}
