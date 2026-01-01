// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 1 (FAZ9-PLAN.md "9b"): one Turkish word per glossary term
// (scripts/i18n/terimler.mjs, which holds a copy of the glossary,
// SOZLUK.md). The script finds no text that breaks a term; where the glossary
// file is beside the repository (the working copy, not a clone), every term
// the script checks says what the glossary says.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const APP = join(__dirname, '..', '..')
const run = (): { code: number | null; out: { texts: number; terms: number; found: { term: string; key: string }[] } } => {
  const r = spawnSync(process.execPath, [join(APP, 'scripts', 'i18n', 'terimler.mjs'), '--json'], { encoding: 'utf8', cwd: APP })
  return { code: r.status, out: JSON.parse(r.stdout) }
}

test('no interface text breaks a glossary term', () => {
  const { code, out } = run()
  assert.ok(out.texts > 2000 && out.terms >= 40, `${out.texts} texts, ${out.terms} terms`)
  assert.deepEqual(out.found.map((f) => `${f.term}: ${f.key}`), [])
  assert.equal(code, 0)
})

test('the script’s terms are the glossary’s (when the glossary is here)', (t) => {
  const glossary = join(APP, '..', 'tasarim', 'SOZLUK.md')
  if (!existsSync(glossary)) {
    t.skip('the glossary is not beside this copy (a clone of the public branch)')
    return
  }
  const rows = readFileSync(glossary, 'utf8').split('\n').filter((l) => /^\| [a-z]/.test(l)).map((l) => l.split('|').map((c) => c.trim()))
  const turkish = new Map(rows.map((r) => [r[1].replace(/ \(.*\)$/, ''), r[2]]))
  const src = readFileSync(join(APP, 'scripts', 'i18n', 'terimler.mjs'), 'utf8')
  const terms = [...src.matchAll(/^\s*\['([^']+)', \[[^\]]*\], '([^']+)'\],?$/gm)].map((m) => [m[1], m[2]])
  assert.ok(terms.length >= 40)
  const differ: string[] = []
  for (const [en, tr] of terms) {
    const first = en.split('|')[0]
    const g = turkish.get(first) ?? [...turkish.entries()].find(([k]) => k.split(' / ').includes(first) || k.startsWith(first))?.[1]
    if (!g || !g.toLocaleLowerCase('tr').includes(tr.toLocaleLowerCase('tr').split(' ')[0])) differ.push(`${en}: script "${tr}", glossary "${g ?? '(none)'}"`)
  }
  assert.deepEqual(differ, [])
})
