// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Faz 9 audit patch, worker P (package, licences, release scripts): the
// package carries the licences of what it ships, the font table says what
// the font files say, the scan refuses a missing name list, the public
// commit's author cannot be anybody's account, the release files come from
// one script.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(__dirname, '..', '..')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cfg = require(join(ROOT, 'electron-builder.config.cjs')) as Record<string, any>

/** An ES module's exports, through a small child (the tests are CommonJS). */
function evalModule(file: string, expr: string): unknown {
  const url = 'file:///' + join(ROOT, file).replace(/\\/g, '/')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(await (${expr})))`], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop()!)
}

test('P1: the package carries LICENSE, THIRD-PARTY-NOTICES.md and licenses/ beside the program', () => {
  const extra: { from: string; to: string }[] = cfg.extraFiles ?? []
  assert.ok(extra.some((e) => e.from === 'LICENSE' && e.to === 'LICENSE.txt'), 'LICENSE')
  assert.ok(extra.some((e) => e.from === 'THIRD-PARTY-NOTICES.md' && e.to === 'THIRD-PARTY-NOTICES.md'), 'notices')
  assert.ok(extra.some((e) => e.from === 'licenses' && e.to === 'licenses'), 'licenses/')
  // The standard texts the notices point at are in the repository.
  const lic = readdirSync(join(ROOT, 'licenses'))
  for (const f of ['Apache-2.0.txt', 'MPL-2.0.txt', 'LGPL-2.1.txt', 'OFL-1.1.txt', 'node-packages.txt']) assert.ok(lic.includes(f), f)
  assert.match(readFileSync(join(ROOT, 'licenses', 'Apache-2.0.txt'), 'utf8'), /Apache License\s+Version 2\.0, January 2004[\s\S]*END OF TERMS AND CONDITIONS/)
  assert.match(readFileSync(join(ROOT, 'licenses', 'MPL-2.0.txt'), 'utf8'), /^Mozilla Public License Version 2\.0/)
  assert.match(readFileSync(join(ROOT, 'licenses', 'LGPL-2.1.txt'), 'utf8'), /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1, February 1999[\s\S]*END OF TERMS AND CONDITIONS/)
  assert.match(readFileSync(join(ROOT, 'licenses', 'OFL-1.1.txt'), 'utf8'), /SIL OPEN FONT LICENSE Version 1\.1/)
})

test('P1: check.mjs refuses a package without the licence files, and passes one with them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lic-'))
  try {
    const url = JSON.stringify(dir)
    const missing = evalModule('scripts/package/check.mjs', `m.licenceProblems(${url})`) as string[]
    for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.md', 'licenses/Apache-2.0.txt', 'licenses/node-packages.txt']) assert.ok(missing.some((p) => p.includes(f)), `${f}: ${missing.join(' | ')}`)
    writeFileSync(join(dir, 'LICENSE.txt'), readFileSync(join(ROOT, 'LICENSE')))
    writeFileSync(join(dir, 'THIRD-PARTY-NOTICES.md'), readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md')))
    mkdirSync(join(dir, 'licenses'))
    for (const f of readdirSync(join(ROOT, 'licenses'))) writeFileSync(join(dir, 'licenses', f), readFileSync(join(ROOT, 'licenses', f)))
    assert.deepEqual(evalModule('scripts/package/check.mjs', `m.licenceProblems(${url})`), [])
    // A LICENSE.txt that is not the GPL is refused too.
    writeFileSync(join(dir, 'LICENSE.txt'), 'MIT')
    assert.equal((evalModule('scripts/package/check.mjs', `m.licenceProblems(${url})`) as string[]).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('P13: no source maps in the package (the check finds them; node-pty, which carried some, went: TERMINAL-YOK-PLAN.md)', () => {
  assert.equal((cfg.files as string[]).some((f) => f.includes('node-pty')), false)
  assert.deepEqual(evalModule('scripts/package/check.mjs', "m.mapFiles(['/out/main/index.js', '/node_modules/node-pty/lib/index.js.map', '/node_modules/node-pty/lib/a.test.js.map'])"), ['/node_modules/node-pty/lib/index.js.map', '/node_modules/node-pty/lib/a.test.js.map'])
})

test('P1: licenses/node-packages.txt holds a licence for every package the code imports', () => {
  const shipped = evalModule('scripts/yayin/notices.mjs', 'm.shippedPackages().map((p) => p.name)') as string[]
  // Every bare import of the program's code is a shipped package.
  const imports = new Set<string>()
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (/\.(ts|tsx)$/.test(e.name)) for (const m of readFileSync(join(d, e.name), 'utf8').matchAll(/(?:from |import\()\s*'([^'./][^']*)'/g)) imports.add(m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0])
    }
  }
  for (const d of ['main', 'preload', 'renderer', 'shared']) walk(join(ROOT, 'src', d))
  const outside = [...imports].filter((n) => !n.startsWith('node:') && !['electron', 'fs', 'path', 'crypto', 'os', 'url', 'http', 'stream', 'child_process', 'events', 'util', 'zlib'].includes(n) && !shipped.includes(n))
  assert.deepEqual(outside, [], 'imported but not in the licence texts')
  for (const n of ['react', 'react-dom', 'scheduler', 'zustand', 'mediabunny', '@mediabunny/mp3-encoder', '@huggingface/transformers', 'onnxruntime-web']) assert.ok(shipped.includes(n), n)
  for (const n of ['onnxruntime-node', 'sharp', '@types/react', 'node-pty', '@xterm/xterm', 'node-addon-api']) assert.ok(!shipped.includes(n), n)
  const text = readFileSync(join(ROOT, 'licenses', 'node-packages.txt'), 'utf8')
  for (const n of shipped) assert.match(text, new RegExp(`^${n.replace(/[/.]/g, '\\$&')} \\S+ \\(`, 'm'), n)
  assert.match(text, /^@huggingface\/transformers .*\n=+\n\nLICENSE: the text of licenses\/Apache-2\.0\.txt$/m)
})

/** A TrueType file's name records (id → text, Windows records first). */
function fontNames(file: string): Record<number, string> {
  const b = readFileSync(file)
  let name = -1
  for (let i = 0; i < b.readUInt16BE(4); i++) if (b.toString('latin1', 12 + i * 16, 16 + i * 16) === 'name') name = b.readUInt32BE(12 + i * 16 + 8)
  const out: Record<number, string> = {}
  const strings = name + b.readUInt16BE(name + 4)
  for (let i = 0; i < b.readUInt16BE(name + 2); i++) {
    const r = name + 6 + i * 12
    const platform = b.readUInt16BE(r), id = b.readUInt16BE(r + 6), len = b.readUInt16BE(r + 8), off = b.readUInt16BE(r + 10)
    const raw = b.subarray(strings + off, strings + off + len)
    const s = platform === 3 || platform === 0 ? Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(raw.readUInt16BE(j * 2))).join('') : raw.toString('latin1')
    if (out[id] === undefined || platform === 3) out[id] = s
  }
  return out
}

test('P2: the font table says the licence each font file says (Luckiest Guy is Apache-2.0)', () => {
  const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const rows = new Map([...notices.matchAll(/^\| ([A-Z][^|]+?) \| (OFL-1\.1|Apache-2\.0) \| https:\/\/fonts\.google\.com/gm)].map((m) => [m[1], m[2]]))
  assert.equal(rows.get('Luckiest Guy'), 'Apache-2.0')
  const dir = join(ROOT, 'src', 'renderer', 'src', 'assets', 'fonts')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ttf'))) {
    const n = fontNames(join(dir, f))
    if (n[1] === 'Snipp Display') continue // the project's own, drawn in code
    const family = n[1].replace(/ Light$/, '')
    const says = /SIL Open Font License, Version 1\.1/.test(n[13] ?? '') ? 'OFL-1.1' : /Apache License, Version 2\.0/.test(n[13] ?? '') ? 'Apache-2.0' : n[13]
    assert.equal(rows.get(family), says, `${f} (${family})`)
  }
})

test('P3: the scan refuses a name list that is missing or empty (no quiet "name 0")', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tara-names-'))
  try {
    // (The lists sit beside the scanned tree, not in it.)
    mkdirSync(join(dir, 'tree'))
    writeFileSync(join(dir, 'tree', 'a.ts'), 'const a = 1\n')
    writeFileSync(join(dir, 'empty.txt'), '\n  \n')
    writeFileSync(join(dir, 'names.txt'), 'kirmizifilm\n')
    const run = (...a: string[]): { status: number | null; out: string } => {
      const r = spawnSync(process.execPath, ['scripts/yayin/tara.mjs', `--tree=${join(dir, 'tree')}`, ...a], { cwd: ROOT, encoding: 'utf8' })
      return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
    }
    for (const args of [[`--names=${join(dir, 'nothere.txt')}`], [`--names=${join(dir, 'empty.txt')}`], [], [`--names=${join(dir, 'names.txt')}`, `--allow=${join(dir, 'nothere.txt')}`]]) {
      const r = run(...args)
      assert.equal(r.status, 2, `${args.join(' ') || '(no list)'}: ${r.out}`)
      assert.match(r.out, /name list|allow list/)
    }
    assert.equal(run(`--names=${join(dir, 'names.txt')}`).status, 0)
    // A deliberate run without names says so in its report.
    const r = run('--no-names')
    assert.equal(r.status, 0, r.out)
    assert.match(r.out, /name: not checked/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('P5: the release files come from the package run: zip with its folder, SHA256SUMS.txt, SOURCE.txt', { skip: process.platform !== 'win32' && spawnSync('zip', ['-v']).status !== 0 && 'no zip program' }, () => {
  const out = mkdtempSync(join(tmpdir(), 'rel-'))
  try {
    mkdirSync(join(out, 'win-unpacked', 'resources'), { recursive: true })
    writeFileSync(join(out, 'win-unpacked', 'App.exe'), 'program')
    writeFileSync(join(out, 'win-unpacked', 'resources', 'app.asar'), 'archive')
    writeFileSync(join(out, 'App Setup 1.2.3.exe'), 'installer')
    writeFileSync(join(out, 'App Setup 1.2.2.exe'), 'an older one')
    const source = { commit: 'a'.repeat(40), branch: 'public', dirty: false }
    const r = evalModule('scripts/package/release-files.mjs', `m.writeReleaseFiles(${JSON.stringify(out)}, { name: 'App', version: '1.2.3', unpacked: 'win-unpacked', source: ${JSON.stringify(source)}, platform: 'win32', arch: 'x64', date: new Date('2026-11-20') })`) as { zip: string; installers: string[] }
    assert.equal(r.zip, 'App-1.2.3-win-x64.zip')
    assert.deepEqual(r.installers, ['App Setup 1.2.3.exe'])
    assert.ok(readdirSync(out).includes('win-unpacked'), 'the folder keeps its name')
    // The zip's entries are under App-1.2.3/.
    const list = spawnSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'unzip', process.platform === 'win32' ? ['-tf', join(out, r.zip)] : ['-Z1', join(out, r.zip)], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean)
    assert.ok(list.some((l) => l.replace(/\\/g, '/') === 'App-1.2.3/resources/app.asar'), list.join(' | '))
    assert.ok(list.every((l) => l.replace(/\\/g, '/').startsWith('App-1.2.3/')), list.join(' | '))
    // sha256sum's format, right hashes.
    const sums = readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8')
    const hash = (f: string): string => (require('node:crypto') as typeof import('node:crypto')).createHash('sha256').update(readFileSync(join(out, f))).digest('hex')
    assert.equal(sums, `${hash('App Setup 1.2.3.exe')}  App Setup 1.2.3.exe\n${hash(r.zip)}  ${r.zip}\n`)
    assert.match(readFileSync(join(out, 'SOURCE.txt'), 'utf8'), new RegExp(`^App 1\\.2\\.3\\nBuilt from commit ${'a'.repeat(40)} \\(public\\)\\.\\n`))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('P5: dist.mjs --release makes them after the checks, and refuses a tree with changes', () => {
  const dist = readFileSync(join(ROOT, 'scripts', 'package', 'dist.mjs'), 'utf8')
  assert.match(dist, /args\.release/)
  assert.match(dist, /writeReleaseFiles\(/)
  assert.ok(dist.indexOf("run('package checks'") < dist.indexOf('writeReleaseFiles('), 'after the checks')
  assert.match(dist, /allow-dirty/)
  // The model folder can be given (the clean clone of the public branch has none).
  assert.match(readFileSync(join(ROOT, 'scripts', 'package', 'models.mjs'), 'utf8'), /SNIPP_MODELS_DIR/)
})

test('P6: the speech model\'s licence is written, with where it was read', () => {
  const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const model = notices.slice(notices.indexOf('## Speech model'), notices.indexOf('## Media codecs'))
  assert.doesNotMatch(model, /not verified/i)
  assert.match(model, /whisper-medium_timestamped\/blob\/9fe933aaa6b0244316eb961f36d33dfedf0c0b0c\/README\.md/)
  assert.match(model, /\bMIT\b/)
  assert.match(model, /openai\/whisper-medium[\s\S]*Apache-2\.0/)
  assert.match(model, /licenses\/Apache-2\.0\.txt/)
})

test('lows: package description and author, SECURITY.md on the test hooks, README on Node and Fit to voice', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  // The installer's file description: no window that is gone (Automation, one-click motion).
  assert.doesNotMatch(pkg.description, /automation|one-click/i)
  assert.match(pkg.description, /local video editor/i)
  assert.equal(pkg.author, 'SnippStudio contributors')
  const sec = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8')
  assert.doesNotMatch(sec, /carries no DevTools or test hooks/)
  assert.match(sec, /e2e-test-hooks/)
  for (const f of ['README.md', 'README.tr.md']) {
    const t = readFileSync(join(ROOT, f), 'utf8')
    assert.match(t, /22\.12/, f)
    assert.doesNotMatch(t, /20\.19/, `${f}: Electron 43 needs Node 22.12`)
  }
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), /Fit to voice/)
  assert.match(readFileSync(join(ROOT, 'README.tr.md'), 'utf8'), /Sese diz/)
})

test('P14: the notices name every licence of what ships', () => {
  const notices = readFileSync(join(ROOT, 'THIRD-PARTY-NOTICES.md'), 'utf8')
  const intro = notices.slice(0, notices.indexOf('\n## '))
  const ids = new Set((evalModule('scripts/yayin/notices.mjs', 'm.shippedPackages().map((p) => p.license)') as string[]).flatMap((l) => l.replace(/[()]/g, '').split(/ (?:AND|OR) /)))
  for (const id of [...ids, 'OFL-1.1', 'LGPL-2.0-or-later']) assert.ok(intro.includes(id), `${id} not named in the introduction`)
})
