// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Every strings file of the interface in one test (SnippStudio phase 3c.4b):
// ui/strings.ts and each ui/strings-*.ts it spreads into STRINGS. Every key in
// both languages with the same parameters, no key twice in a file, and a key
// written in two files says the same thing in both (a later spread silently
// wins otherwise). The files stay separate: no need to merge them.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { STRINGS, type Entry } from '../renderer/src/ui/strings'

const UI = join(__dirname, '..', '..', 'src', 'renderer', 'src', 'ui')
const FILES = readdirSync(UI).filter((f) => /^strings(-[a-z0-9-]+)?\.ts$/.test(f)).sort()

interface Found { file: string; key: string; en?: string; tr?: string }

/** The keys a strings file writes ('a.b': { en: '…', tr: '…' }), read with TypeScript's parser. */
function entries(file: string): Found[] {
  const sf = ts.createSourceFile(file, readFileSync(join(UI, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out: Found[] = []
  const text = (e: ts.Expression | undefined): string | undefined => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined)
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name) && ts.isObjectLiteralExpression(n.initializer)) {
      const props = new Map(n.initializer.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sf), p.initializer]))
      if (props.has('en')) out.push({ file, key: n.name.text, en: text(props.get('en')), tr: text(props.get('tr')) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const all = FILES.flatMap(entries)
// (A word in two forms by a count, `{n|was|were}`, reads its parameter too; a text needs each parameter once.)
const params = (s: string): string => [...new Set([...s.matchAll(/\{(\w+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]))].sort().join(',')

test('the strings files are all here and all spread into STRINGS', () => {
  assert.ok(FILES.length >= 15, FILES.join(' '))
  const main = readFileSync(join(UI, 'strings.ts'), 'utf8')
  for (const f of FILES.filter((x) => x !== 'strings.ts')) assert.match(main, new RegExp(`from '\\./${f.replace(/\.ts$/, '')}'`), `${f} is imported by strings.ts`)
  // Every key read from the files is in STRINGS, and STRINGS has nothing else.
  assert.deepEqual([...new Set(all.map((x) => x.key))].sort(), Object.keys(STRINGS).sort())
})

test('every key in both languages, with the same parameters', () => {
  const missing = all.filter((x) => !x.en?.trim() || !x.tr?.trim()).map((x) => `${x.file}: ${x.key}`)
  assert.deepEqual(missing, [], 'a key without its English or its Turkish')
  for (const [k, e] of Object.entries(STRINGS) as [string, Entry][]) {
    assert.ok(e.tr && e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr!), params(e.en), `${k}: the same parameters`)
  }
})

test('every key is read by the app (scripts/qa/unused-strings.mjs has the same rules)', () => {
  // Read: written whole in quotes outside the strings files and the tests, or
  // starting with a prefix the code builds keys from (`a.b.${x}`, 'a.b.' + x).
  const SRC = join(UI, '..', '..', '..')
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const code = walk(SRC)
    .filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !/[\\/]ui[\\/]strings(-[a-z0-9-]+)?\.ts$/.test(f) && !/[\\/]src[\\/]test[\\/]/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  const whole = new Set([...code.matchAll(/['"`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)['"`]/g)].map((m) => m[1]))
  const prefixes = [
    ...[...code.matchAll(/`([a-z][a-zA-Z0-9.]*)\$\{/g)].map((m) => m[1]),
    ...[...code.matchAll(/['"]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]*)*\.)['"]\s*\+/g)].map((m) => m[1])
  ].filter((p) => p.includes('.') && p.length >= 3)
  const unread = Object.keys(STRINGS).filter((k) => !whole.has(k) && !prefixes.some((p) => k.startsWith(p)))
  assert.deepEqual(unread, [], 'keys nothing reads: delete them')
})

test('no key twice in a file, and no key with two different texts across files', () => {
  const seen = new Map<string, Found>()
  const twice: string[] = []
  const differ: string[] = []
  for (const x of all) {
    const before = seen.get(x.key)
    if (!before) seen.set(x.key, x)
    else if (before.file === x.file) twice.push(`${x.file}: ${x.key}`)
    else if (before.en !== x.en || before.tr !== x.tr) differ.push(`${x.key}: ${before.file} / ${x.file}`)
  }
  assert.deepEqual(twice, [])
  assert.deepEqual(differ, [])
})
