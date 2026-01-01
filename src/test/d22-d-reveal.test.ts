// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 22 November, L1: the window never scrolls. A row is brought into view by
// its own panel's scrollTop (ui/reveal.ts); no product code calls the
// browser's scrollIntoView, which scrolls every ancestor up to the window.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { revealScrollTop } from '../renderer/src/ui/reveal'

const SRC = resolve(process.cwd(), 'src', 'renderer', 'src')
const filesIn = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? filesIn(p, ext) : ext.test(f) ? [p] : []
  })
const codeOf = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('no product code calls scrollIntoView (it scrolls the window too)', () => {
  const hits = filesIn(SRC, /\.tsx?$/).filter((f) => /\.scrollIntoView\s*\(/.test(codeOf(f))).map((f) => relative(SRC, f))
  assert.deepEqual(hits, [])
})

test('the page clips what leaves it and places its body', () => {
  const css = readFileSync(join(SRC, 'ui', 'base.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.match(css, /\bbody\s*\{[^}]*position:\s*relative[^}]*overflow:\s*clip/)
  assert.match(css, /#root\s*\{[^}]*overflow:\s*clip/)
})

test('revealScrollTop: start puts the row at the panel\'s top', () => {
  assert.equal(revealScrollTop('start', { scrollTop: 100, viewTop: 50, viewHeight: 400, rowTop: 350, rowHeight: 40 }), 400)
  assert.equal(revealScrollTop('start', { scrollTop: 100, viewTop: 50, viewHeight: 400, rowTop: 10, rowHeight: 40 }), 60)
})

test('revealScrollTop: nearest moves only as far as needed', () => {
  const at = { scrollTop: 100, viewTop: 50, viewHeight: 400 }
  // wholly in view: stays
  assert.equal(revealScrollTop('nearest', { ...at, rowTop: 200, rowHeight: 40 }), 100)
  // above the view: its top to the panel's top
  assert.equal(revealScrollTop('nearest', { ...at, rowTop: 20, rowHeight: 40 }), 70)
  // below the view: its bottom to the panel's bottom
  assert.equal(revealScrollTop('nearest', { ...at, rowTop: 430, rowHeight: 40 }), 120)
  // taller than the panel: its top wins
  assert.equal(revealScrollTop('nearest', { ...at, rowTop: 100, rowHeight: 900 }), 150)
})

test('revealScrollTop: center', () => {
  assert.equal(revealScrollTop('center', { scrollTop: 0, viewTop: 0, viewHeight: 400, rowTop: 600, rowHeight: 20 }), 410)
})
