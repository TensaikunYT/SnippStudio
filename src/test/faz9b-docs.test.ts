// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 6 (FAZ9-PLAN.md "9b"): the guides in docs\, two
// languages. Their shortcut tables are the app's (scripts/docs/kisayollar.mjs);
// they tell only what is in the product: none of the removed parts, no model
// choice (the product has one speech model), the agents the chooser offers.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const APP = join(__dirname, '..', '..')
const DOCS = ['guide.md', 'kullanim.md', 'agents.md', 'ajanlar.md']
const read = (f: string): string => readFileSync(join(APP, 'docs', f), 'utf8')

test('every shortcut in the guides is the app’s (shortcuts.ts), in both languages', () => {
  const r = spawnSync(process.execPath, [join(APP, 'scripts', 'docs', 'kisayollar.mjs'), '--json'], { encoding: 'utf8', cwd: APP })
  const out = JSON.parse(r.stdout) as { actions: number; differ: { lang: string; problem: string }[] }
  assert.ok(out.actions >= 40, `actions: ${out.actions}`)
  assert.deepEqual(out.differ, [])
  assert.equal(r.status, 0)
})

test('the guides tell only what is in the product', () => {
  for (const f of DOCS) {
    const s = read(f)
    // The removed parts (KAPSAM.md), a model choice (one model ships), a style told to the agent.
    assert.doesNotMatch(s, /narrator|hands? mode|cut-?out character|\bStage\b|B-roll (window|panel)|Automation (window|panel)|anlatıcı el|kesme karakter/i, `${f}: a removed part`)
    assert.doesNotMatch(s, /medium\.en|English[- ]only model|yalnız İngilizce model|choose (the|a) (speech )?model|model seç/i, `${f}: a model choice`)
    // Antigravity (phase 9a, worker I) only as an experimental, unverified row, if at all.
    for (const line of s.split(/\r?\n/).filter((l) => /Antigravity/.test(l))) assert.match(line, /experimental|deneysel/i, `${f}: Antigravity only as experimental (${line})`)
  }
  // Each guide links its other language.
  assert.match(read('guide.md'), /\(kullanim\.md\)/)
  assert.match(read('kullanim.md'), /\(guide\.md\)/)
  assert.match(read('agents.md'), /\(ajanlar\.md\)/)
  assert.match(read('ajanlar.md'), /\(agents\.md\)/)
})

test('the agent guides name the tools the server declares, and say their answers are English', async () => {
  const src = readFileSync(join(APP, 'src', 'renderer', 'src', 'agent', 'tools.ts'), 'utf8')
  const names = [...src.matchAll(/^\s{6}name: '([a-z_]+)',$/gm)].map((m) => m[1])
  assert.ok(names.length >= 8, names.join(' '))
  for (const f of ['agents.md', 'ajanlar.md']) {
    const s = read(f)
    for (const n of names) assert.match(s, new RegExp('`' + n + '`'), `${f}: the ${n} tool`)
  }
  assert.match(read('agents.md'), /answers are in \*\*English\*\*/)
  assert.match(read('ajanlar.md'), /\*\*İngilizcedir\*\*/)
})
