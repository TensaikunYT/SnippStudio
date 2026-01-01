// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ready to publish (SnippStudio phase 9c, decisions 1, 2, 4 and 5, without
// the interface): the licence, the notices made from package-lock.json, the
// scan and the public branch's rules, and the SPDX header on every source file.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(__dirname, '..', '..')
const node = (args: string[]): { status: number | null; out: string } => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}
/** An ES module's exports, through a small child (the tests are CommonJS). */
function evalModule(file: string, expr: string): unknown {
  const url = 'file:///' + join(ROOT, file).replace(/\\/g, '/')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(${expr}))`], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop()!)
}

test('licence: GPL-3.0 text, package.json says GPL-3.0-or-later', () => {
  const lic = readFileSync(join(ROOT, 'LICENSE'), 'utf8')
  assert.match(lic, /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/)
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).license, 'GPL-3.0-or-later')
})

test('THIRD-PARTY-NOTICES.md lists every production package, each with a GPL-compatible licence', () => {
  const r = node(['scripts/yayin/notices.mjs', '--check'])
  assert.equal(r.status, 0, r.out)
  const text = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  assert.match(text, /\| zustand \| [\d.]+ \| MIT \|/)
  assert.doesNotMatch(text, /node-pty|xterm/, 'the embedded terminal went (TERMINAL-YOK-PLAN.md)')
  assert.doesNotMatch(text, /\| unknown \|/)
  // The licence check itself: AND needs both, OR one of them.
  assert.deepEqual(evalModule('scripts/yayin/notices.mjs', "['MIT', '(MIT OR CC0-1.0)', 'Apache-2.0 AND LGPL-3.0-or-later', 'SSPL-1.0', 'MIT AND SSPL-1.0', 'SSPL-1.0 OR MIT', null].map(m.compatible)"), [true, true, true, false, false, true, false])
})

test('the scan finds each kind and copies nothing it found into the report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tara-'))
  try {
    const user = 'Zeynepxq'
    // (Each made from parts, so the scan of this repository does not find this test.)
    const users = ['C:', 'Users'].join('\\\\')
    writeFileSync(join(dir, 'a.ts'), [`const p = '${users}\\\\${user}\\\\Desktop\\\\x'`, `const q = '${['', 'home', user, 'f'].join('/')}'`, `const ok = '${users}\\\\u\\\\x' // placeholder`, `mail: ${['someone', 'realmail.com'].join('@')}, ok: x@users.noreply.github.com`, `key ${['sk', 'abcdefghijklmnopqrstuvwxyz0123'].join('-')}`, 'film kirmizifilm here'].join('\n'))
    writeFileSync(join(dir, 'photo.jpg'), 'x')
    writeFileSync(join(dir, 'names.txt'), 'kirmizifilm\n')
    // Not findings: a third-party author's address in vendor/, git's SSH address
    // form, and a listed word where the allow list says it is an ordinary word.
    mkdirSync(join(dir, 'vendor'))
    writeFileSync(join(dir, 'vendor', 'lib.js'), `// by ${['author', 'lib.org'].join('@')}\n`)
    writeFileSync(join(dir, 'b.md'), `| x | ${['git', 'github.com'].join('@')}:owner/repo |\n`)
    writeFileSync(join(dir, 'map.ts'), "['kirmizifilm', 1, 2]\n")
    writeFileSync(join(dir, 'allow.txt'), '# path prefix, word\nmap.ts kirmizifilm\n')
    const out = join(dir, 'report.md')
    const r = node(['scripts/yayin/tara.mjs', `--tree=${dir}`, `--names=${join(dir, 'names.txt')}`, `--allow=${join(dir, 'allow.txt')}`, `--out=${out}`])
    assert.equal(r.status, 1, 'findings in a tree fail the run')
    const totals = JSON.parse(r.out.trim().split('\n').pop()!)
    assert.equal(totals.tree.path, 2)
    assert.equal(totals.tree.email, 1)
    assert.equal(totals.tree.secret, 1)
    assert.equal(totals.tree.name, 3) // a.ts, names.txt and allow.txt themselves
    assert.equal(totals.tree.allowed, 1) // map.ts
    assert.equal(totals.tree.media, 1)
    assert.match(readFileSync(out, 'utf8'), /\| allowed \| 1 \| `map\.ts:1` \|/)
    const report = readFileSync(out, 'utf8')
    for (const secret of [user, 'realmail', 'sk-abc', 'kirmizifilm']) assert.ok(!report.includes(secret), `${secret} copied into the report`)
    assert.match(report, /`a\.ts:1`/)
    assert.ok(!report.includes(dir), 'the scanned folder (a user path) is not written out')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the public branch leaves out the internal notes and keeps the code', () => {
  const r = evalModule('scripts/yayin/dal.mjs', "['CLAUDE.md', 'CODE-FILM-CLIP-PLAN.md', 'CODE-FILM-CLIP-REVIEW.md', 'UI-DESIGN.md', 'SECURITY-REVIEW.md', 'src/main/index.ts', 'README.md', 'LICENSE', 'scripts/split/plans/main.json', 'scripts/testdata/make.mjs', 'scripts/testdata/check.mjs', 'README.tr.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/images/editor.png'].map(m.goesPublic)")
  assert.deepEqual(r, [false, false, false, false, true, true, true, true, false, false, true, true, true, true, true])
  // The author can be nobody's account (Faz 9 audit patch P, P4): a GitHub
  // noreply address names a user; a .invalid domain can never be registered.
  const author = evalModule('scripts/yayin/dal.mjs', 'm.AUTHOR') as { name: string; email: string }
  assert.deepEqual(author, { name: 'SnippStudio contributors', email: 'noreply@snippstudio.invalid' })
  assert.match(author.email, /\.invalid$/)
})

test('SPDX header on every source file', () => {
  const r = node(['scripts/yayin/spdx.mjs', '--check'])
  assert.equal(r.status, 0, r.out)
})

test('the SPDX tool: the header it writes is the one it checks', () => {
  const r = evalModule('scripts/yayin/spdx.mjs', "(() => { const a = m.withHeader('x.ts', 'const a = 1\\n'); const b = m.withHeader('x.mjs', '#!/usr/bin/env node\\nrun()\\n'); return [m.hasHeader(a), a.split('\\n')[0], m.hasHeader(b), b.split('\\n')[0], m.withHeader('x.ts', a) === a, m.sourceFiles().length > 300] })()")
  assert.deepEqual(r, [true, '// SPDX-License-Identifier: GPL-3.0-or-later', true, '#!/usr/bin/env node', true, true])
  // A page keeps its doctype first; a byte order mark stays the first character.
  const p = evalModule('scripts/yayin/spdx.mjs', "(() => { const h = m.withHeader('x.html', '<!doctype html>\\r\\n<html></html>\\r\\n'); const t = m.withHeader('x.ts', '\\uFEFFconst a = 1\\n'); return [h.split('\\r\\n').slice(0, 2), m.hasHeader(h), t.charCodeAt(0) === 0xfeff, t.slice(1).split('\\n')[0], m.hasHeader(t)] })()")
  assert.deepEqual(p, [['<!doctype html>', '<!-- SPDX-License-Identifier: GPL-3.0-or-later -->'], true, true, '// SPDX-License-Identifier: GPL-3.0-or-later', true])
})
