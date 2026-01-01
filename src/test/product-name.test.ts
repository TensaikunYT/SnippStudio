// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The product's name in one place (SnippStudio phase 9a, decision 1): the
// window, the profile folder, the package and every message read it from
// src/shared/product.json. No other source file writes it out, nor the old
// name ("Snipp"): renaming the app is one line.
//
// What is looked at: every string a source file under src/ holds (string and
// template literals, JSX text; comments are not names), the page's HTML, and
// the package configuration. Allowed: names that are not the product's name
// (the bundled "Snipp Display" type face, which old projects name; the
// "X-Snipp-Terminal" header). No file is exempt: the interface's words name the
// product with t()'s {app} parameter (phase 9a, FAZ9-PLAN.md; the temporary
// list lane B kept for phase 3c's files is gone).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { APP_ID, PRODUCT_NAME, productNameFor } from '../shared/product'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')

/** Not the product's name, though they hold the old word. */
const ALLOWED = [/Snipp Display/g, /X-Snipp-Terminal/g]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      if (e !== 'test') sourceFiles(p, out)
    } else if (/\.(ts|tsx)$/.test(e)) out.push(p)
  }
  return out
}

const rel = (p: string): string => relative(SRC, p).replace(/\\/g, '/')

/** The product's name written out in a text: the current name, its id, or the old one. */
export function namesIn(text: string): string[] {
  let t = text
  for (const a of ALLOWED) t = t.replace(a, '')
  const found: string[] = []
  for (const re of [new RegExp(PRODUCT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), new RegExp(APP_ID.replace(/\./g, '\\.'), 'g'), /\bSnipp\b/g]) {
    for (const m of t.match(re) ?? []) found.push(m)
  }
  return found
}

/** Every string of a TypeScript file that names the product: "file:line text". */
export function namedStrings(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (n: ts.Node): void => {
    let s: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) s = n.text
    else if (ts.isJsxText(n)) s = n.getText()
    if (s !== null && namesIn(s).length) hits.push(`${rel(file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${s.trim().slice(0, 100)}`)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

const files = sourceFiles(SRC)

test('the name is one line: product.json holds it, and the copies are named from it', () => {
  const json = JSON.parse(readFileSync(join(SRC, 'shared', 'product.json'), 'utf8'))
  assert.equal(json.name, PRODUCT_NAME)
  assert.equal(json.appId, APP_ID)
  assert.equal(productNameFor('release'), PRODUCT_NAME)
  assert.equal(productNameFor('dev'), `${PRODUCT_NAME} Dev`)
  // The package takes it from there (electron-builder.config.cjs).
  const cfg = require(join(ROOT, 'electron-builder.config.cjs'))
  assert.equal(cfg.productName, PRODUCT_NAME)
  assert.equal(cfg.appId, APP_ID)
})

test('no source string writes the name out', () => {
  assert.ok(files.length > 300, `${files.length} files looked at`)
  const found = files.flatMap(namedStrings)
  assert.deepEqual(found, [])
})

test('the page, the package configuration and the e2e harness do not write it either', () => {
  const html = readFileSync(join(SRC, 'renderer', 'index.html'), 'utf8')
  assert.deepEqual(namesIn(html.replace(/<!--[\s\S]*?-->/g, '')), [])
  const cfg = readFileSync(join(ROOT, 'electron-builder.config.cjs'), 'utf8')
  assert.deepEqual(namesIn(cfg.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')), [])
  // One package configuration (decision 5): none left in package.json.
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).build, undefined)
  for (const f of readdirSync(join(ROOT, 'scripts', 'e2e')).filter((n) => n.endsWith('.mjs'))) {
    const code = readFileSync(join(ROOT, 'scripts', 'e2e', f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
    assert.doesNotMatch(code, /Snipp\.exe|SnippStudio\.exe/, f)
  }
})

test('the interface names the product through t(): {app} is the name', () => {
  const { t, STRINGS } = require('../renderer/src/ui/strings') as typeof import('../renderer/src/ui/strings')
  assert.equal(t('top.logo'), PRODUCT_NAME)
  assert.equal(t('crash.app'), `${PRODUCT_NAME} hit an error`)
  // A caller's own parameters still win, and every text naming the app uses {app}.
  const named = Object.entries(STRINGS as Record<string, { en: string; tr?: string }>).filter(([, e]) => /{app}/.test(e.en))
  assert.ok(named.length >= 20, `${named.length} texts name the app`)
  for (const [k, e] of named) {
    assert.ok(e.tr?.includes('{app}'), k)
    // Turkish puts no suffix on the name: it would depend on the name's last vowel.
    assert.doesNotMatch(e.tr!, /{app}['’]/, `${k}: no suffix after {app} in Turkish`)
  }
})

test('the scan finds what it should', () => {
  assert.deepEqual(namesIn('This project is open in another Snipp window.'), ['Snipp'])
  assert.deepEqual(namesIn(`made by ${PRODUCT_NAME}`), [PRODUCT_NAME])
  assert.deepEqual(namesIn('fontFamily: "Snipp Display"'), [])
  assert.deepEqual(namesIn('a .snipp project; snippfilm://x'), [])
})
