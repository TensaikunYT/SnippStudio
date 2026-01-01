// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 2 (FAZ9-PLAN.md "9b"): the main process's system dialogs
// and its crash and quit boxes speak the page's language (strings-main.ts,
// told over app:set-lang). Every entry in both languages with the same
// parameters; no dialog in the main process written as plain English.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { MAIN_STRINGS, filterName, mt, setMainLang } from '../main/strings-main'

const MAIN = join(__dirname, '..', '..', 'src', 'main')
const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

test('every main-process text in both languages, the same parameters', () => {
  for (const [k, e] of Object.entries(MAIN_STRINGS)) {
    assert.ok(e.en.trim() && e.tr.trim(), k)
    assert.equal(params(e.tr), params(e.en), k)
  }
})

test('the page’s language decides; anything but Turkish is English', () => {
  setMainLang('tr')
  assert.equal(mt('quit.discard'), 'Kaydetmeden çık')
  assert.equal(mt('crash.message', { reason: 'oom' }), 'Düzenleyici durdu (oom).')
  assert.equal(filterName('MP4 video'), 'MP4 videosu')
  assert.equal(filterName('SubRip subtitles'), 'SubRip altyazısı')
  assert.equal(filterName('SnippStudio project'), 'SnippStudio projesi')
  setMainLang('de')
  assert.equal(mt('quit.discard'), 'Quit without saving')
  assert.equal(filterName('MP4 video'), 'MP4 video')
  setMainLang('en')
})

test('no system dialog in the main process is written as plain English', () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const found: string[] = []
  for (const f of walk(MAIN).filter((x) => x.endsWith('.ts') && !x.endsWith('e2e-hooks.ts'))) {
    const src = readFileSync(f, 'utf8')
    // Only inside a dialog call: from showXxxDialog / showMessageBox to the end of its options.
    for (const m of src.matchAll(/dialog\s*\.\s*show(?:Open|Save|Message)\w*\(([\s\S]*?)\n\s*\}\)/g)) {
      for (const p of m[1].matchAll(/\b(title|buttonLabel|message|detail|name)\s*:\s*(['"`])([^'"`]*[A-Za-z]{3}[^'"`]*)\2/g)) found.push(`${f.slice(MAIN.length + 1)}: ${p[1]}: ${p[3]}`)
      for (const p of m[1].matchAll(/\bbuttons\s*:\s*\[\s*(['"`])/g)) found.push(`${f.slice(MAIN.length + 1)}: buttons: ${p[0]}`)
    }
  }
  assert.deepEqual(found, [])
})
