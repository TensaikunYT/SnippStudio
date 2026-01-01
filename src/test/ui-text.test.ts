// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Words come from ui/strings.ts, icons from ui/Icon (SnippStudio phase 3a.3).
// No file of the interface shows plain text (JSX text, title, aria-label,
// placeholder, a toast…) or uses an emoji / Unicode sign as an icon. Since
// phase 3c.4b there is no exempt list: the last old files went, and the test
// takes no list of files to let through.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { STRINGS, fill, getLang, langOf, setLang, subscribeLang, t, type Entry, type StringKey } from '../renderer/src/ui/strings'
import { GLYPH, SRC, ctrlLiterals, glyphs, keysAsked, plainText, uiFiles } from './ui-text-scan'

const files = uiFiles()

test('no exempt list: the old one is gone and nothing reads one', () => {
  assert.equal(existsSync(join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'ui-text-exempt.json')), false)
  assert.equal(/exempt/i.test(readFileSync(join(__dirname, '..', '..', 'src', 'test', 'ui-text-scan.ts'), 'utf8')), false)
})

test('plain text: none in any file of the interface (JSX text, title, aria-label, placeholder, toasts)', () => {
  assert.ok(files.length > 60, `${files.length} files looked at`)
  assert.ok(files.includes('ui/strings.ts') && files.includes('App.tsx') && files.includes('notes/actions.ts'))
  const found = files.flatMap((f) => plainText(f))
  assert.deepEqual(found.map((x) => `${x.file}:${x.line} ${x.what}`), [])
})

test('glyphs: no emoji or sign used as an icon in any file of the interface', () => {
  const found = files.flatMap((f) => glyphs(f))
  assert.deepEqual(found.map((x) => `${x.file}:${x.line} ${x.what}`), [])
})

test('key names: no "Ctrl+" written into a text outside ui/strings (t() writes it as the platform does, phase 10a.5)', () => {
  const found = files.flatMap((f) => ctrlLiterals(f))
  assert.deepEqual(found.map((x) => `${x.file}:${x.line} ${x.what}`), [])
  // The scanner itself: a label in a .tsx is caught, a comment and the strings files are not.
  assert.equal(ctrlLiterals('a.tsx', 'export const A = (): JSX.Element => <kbd title="Save">{"Ctrl+S"}</kbd>').length, 1)
  assert.equal(ctrlLiterals('a.tsx', 'const k = `Ctrl+${key}`').length, 1)
  assert.equal(ctrlLiterals('a.tsx', "const b = 'ctrl+s'").length, 0, 'a binding is not a label')
  assert.equal(ctrlLiterals('a.tsx', ['// Ctrl+S saves', 'export const x = 1'].join('\n')).length, 0)
  assert.equal(ctrlLiterals('ui/strings-3c.ts', "export const S = { a: { en: 'Ctrl+S' } }").length, 0)
})

test('the scanner catches what it should and lets the rest pass', () => {
  // Known findings in a written sample (so a broken scanner cannot pass by finding nothing).
  const sample = [
    'export const A = (): JSX.Element => <button title="Collapse this" aria-label={on ? "Open" : t(\'x.y\')}>▾ Fold</button>',
    'notify({ text: \'Saved.\' })',
    'toast(`Done ${n}`)'
  ].join('\n')
  const words = plainText('sample.tsx', sample).map((x) => x.what)
  assert.ok(words.some((w) => /Collapse/.test(w)), 'a title')
  assert.ok(words.some((w) => /aria-label/.test(w)), 'one side of a ?:')
  assert.ok(words.some((w) => /Fold/.test(w)), 'JSX text')
  assert.ok(words.some((w) => /^notify/.test(w)) && words.some((w) => /^toast/.test(w)), 'toasts')
  assert.ok(glyphs('sample.tsx', sample).some((x) => x.what.startsWith('▾')))
  assert.deepEqual(plainText('ok.tsx', 'export const B = (): JSX.Element => <span title={t(\'a.b\')}>{n} · {t(\'c.d\')}</span>'), [])
  // Typography is not an icon; icons are.
  for (const ok of ['a · b', 'x — y', 'wait…', '−6 dB', '2×', 'File → Open', 'Lucide’dan']) assert.equal(GLYPH.test(ok), false, ok)
  for (const bad of ['💾', '✂', '▶', '⚙', '✕', '＋', '☰', '⬇', '⋯', '←', '⧉', '≡', '✓']) assert.equal(GLYPH.test(bad), true, bad)
})

test('every key the interface asks t() for exists, with the same parameters in each language', () => {
  const keys = new Set(Object.keys(STRINGS))
  const missing = files.flatMap(keysAsked).filter((k) => !keys.has(k.what))
  assert.deepEqual(missing.map((x) => `${x.file}:${x.line} ${x.what}`), [])
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  for (const [k, e] of Object.entries(STRINGS) as [string, Entry][]) {
    assert.ok(e.en.trim().length > 0, `${k}: English text`)
    assert.match(k, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, `${k}: a flat dotted key`)
    if (e.tr !== undefined) assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.equal(GLYPH.test(e.en) || (e.tr !== undefined && GLYPH.test(e.tr)), false, `${k}: no icon glyph in a text`)
  }
})

test('t(): English by default, Turkish when chosen and written, parameters filled, listeners told', () => {
  const k = 'kit.toast.cuts' as StringKey
  setLang('en')
  assert.equal(getLang(), 'en')
  assert.equal(t(k, { n: 14 }), '14 cuts applied')
  let told = 0
  const off = subscribeLang(() => told++)
  setLang('tr')
  assert.equal(told, 1)
  assert.equal(t(k, { n: 14 }), '14 kesim uygulandı')
  setLang('tr')
  assert.equal(told, 1, 'no news when nothing changed')
  off()
  setLang('en')
  assert.equal(told, 1)
  assert.equal(fill('{a} and {b}', { a: 1 }), '1 and {b}')
  assert.equal(langOf('tr'), 'tr')
  assert.equal(langOf('de'), 'en')
  assert.equal(langOf(null), 'en')
})

test('the language is a store preference (uiLang, setUiLang, localStorage)', () => {
  const read = (f: string): string => readFileSync(join(SRC, f), 'utf8')
  assert.match(read('state/editor-state.ts'), /uiLang: Lang/)
  assert.match(read('state/slices/view.ts'), /localStorage\.setItem\('snipp-ui-lang', uiLang\)[\s\S]*setLang\(uiLang\)/)
  assert.match(read('state/store.ts'), /langOf\(localStorage\.getItem\('snipp-ui-lang'\)\)/)
  // strings.ts does not import the store (light for the building blocks and their tests).
  assert.equal(/from ['"][./]*state\//.test(read('ui/strings.ts')), false)
})
