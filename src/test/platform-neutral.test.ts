// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.7 (FAZ10-PLAN.md; report section 5.10): code that only holds on
// Windows does not come back. The main process, the preload, the renderer
// and the e2e harness are scanned (platform-neutral-scan.ts); a deliberate
// finding is in fixtures/platform-exempt.json with its reason and its exact
// count. The list only shrinks: a fixed finding must leave it, a new one is
// fixed or argued for (and MAX_EXEMPT raised in the same commit, with the
// reason in the plan).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { PLATFORM_HOMES, ROOT, importCaseMismatch, scanAll, scanFile, scannedFiles, type Finding, type Rule } from './platform-neutral-scan'

interface Exempt {
  rule: Rule
  file: string
  count: number
  reason: string
}
const EXEMPT: Exempt[] = JSON.parse(readFileSync(join(ROOT, 'src', 'test', 'fixtures', 'platform-exempt.json'), 'utf8'))
/** The number of exempt entries when phase 10 closed: it may only go down. */
const MAX_EXEMPT = 23

const findings = scanAll()
const groups = new Map<string, Finding[]>()
for (const f of findings) {
  const k = `${f.rule}|${f.file}`
  groups.set(k, [...(groups.get(k) ?? []), f])
}

test('the scan looks where it should', () => {
  const files = scannedFiles()
  assert.ok(files.length > 300, `${files.length} files`)
  for (const f of ['src/main/index.ts', 'src/preload/index.ts', 'src/renderer/src/App.tsx', 'scripts/e2e/run.mjs']) assert.ok(files.includes(f), f)
  for (const f of PLATFORM_HOMES) assert.ok(files.includes(f), `platform home ${f} exists`)
})

test('no finding outside the exempt list, and each exempt entry is exactly what is found', () => {
  const unexplained: string[] = []
  for (const [k, list] of groups) {
    const e = EXEMPT.find((x) => `${x.rule}|${x.file}` === k)
    if (!e) unexplained.push(...list.map((f) => `${f.rule} ${f.file}:${f.line} ${f.what}`))
    else if (e.count !== list.length) unexplained.push(`${k}: ${list.length} found, ${e.count} exempt (${list.map((f) => f.line).join(', ')})`)
  }
  assert.deepEqual(unexplained, [])
  const stale = EXEMPT.filter((e) => !groups.has(`${e.rule}|${e.file}`)).map((e) => `${e.rule}|${e.file}`)
  assert.deepEqual(stale, [], 'fixed: take it off the list')
})

test('the exempt list only shrinks, and every entry says why', () => {
  assert.ok(EXEMPT.length <= MAX_EXEMPT, `${EXEMPT.length} entries > ${MAX_EXEMPT}`)
  const keys = EXEMPT.map((e) => `${e.rule}|${e.file}`)
  assert.equal(new Set(keys).size, keys.length, 'one entry per rule and file')
  for (const e of EXEMPT) assert.ok(e.reason.length >= 40 && e.count > 0, `${e.rule} ${e.file}`)
  // Nothing in the main process's path layer or the renderer's key labels is exempt.
  assert.equal(EXEMPT.some((e) => e.rule === 'path-lowercase' || e.rule === 'ctrl-label' || e.rule === 'import-case'), false)
})

test('the scanner catches what it should and lets the rest pass', () => {
  const rules = (file: string, src: string): string[] => scanFile(file, src).map((f) => f.rule).sort()
  // Caught.
  assert.deepEqual(rules('src/main/x.ts', "import path from 'node:path'\nexport const a = path.win32.join('a', 'b')"), ['path-win32'])
  assert.deepEqual(rules('src/main/x.ts', "export const w = process.platform === 'darwin' ? 1 : 2"), ['process-platform'])
  assert.deepEqual(rules('src/main/x.ts', 'export const k = (filePath: string) => filePath.toLowerCase()'), ['path-lowercase'])
  assert.deepEqual(rules('src/main/x.ts', "export const e = 'C:\\\\Windows\\\\notepad.exe'"), ['windows-literal'])
  assert.deepEqual(rules('src/main/x.ts', "export const t = 'taskkill'\nexport const d = process.env.LOCALAPPDATA"), ['windows-tool', 'windows-tool'])
  assert.deepEqual(rules('src/renderer/src/x.ts', "export const f = '12px \"Segoe UI\", sans-serif'"), ['windows-font'])
  assert.deepEqual(rules('src/renderer/src/x.tsx', "export const A = (): JSX.Element => <b title={'Ctrl+S'} />"), ['ctrl-label'])
  assert.deepEqual(rules('src/renderer/src/x.ts', 'export const on = (e: MouseEvent) => e.ctrlKey'), ['ctrl-without-meta'])
  // Let through.
  assert.deepEqual(rules('src/main/x.ts', "// path.win32, process.platform === 'win32', taskkill, Segoe UI\nexport const a = 1"), [], 'comments')
  assert.deepEqual(rules('src/main/x.ts', 'export const f = (p = process.platform) => g(process.platform)\nfunction g(x: string) { return x }'), [], 'a platform handed on')
  assert.deepEqual(rules('src/main/x.ts', "import path from 'node:path'\nexport const x = (p: string, platform: string) => (platform === 'win32' ? path.win32 : path.posix).isAbsolute(p)"), [], 'a platform choice')
  assert.deepEqual(rules('src/main/x.ts', "export function f(platform: string, env: Record<string, string>) {\n  if (platform !== 'win32') return []\n  const a = 1\n  const b = 2\n  return [env.LOCALAPPDATA, 'powershell']\n}"), [], 'after a Windows guard in the same function')
  assert.deepEqual(rules('src/main/x.ts', "import path from 'node:path'\nexport const ext = (filePath: string) => path.extname(filePath).toLowerCase()"), [], 'an extension')
  assert.deepEqual(rules('src/main/x.ts', 'export const k = (filePath: string) => foldKey(filePath.toLowerCase())\nfunction foldKey(s: string) { return s }'), [], 'through foldKey')
  assert.deepEqual(rules('src/renderer/src/x.ts', "export const f = '12px \"Inter\", \"Segoe UI\", sans-serif'"), [], 'a bundled face first')
  assert.deepEqual(rules('src/renderer/src/x.ts', 'export const on = (e: MouseEvent) => e.ctrlKey || e.metaKey'), [])
  assert.deepEqual(rules('src/test/x.ts', "export const p = 'C:\\\\Users\\\\u\\\\a.exe'"), [], 'tests may name Windows paths')
})

test('import case: every relative import is spelled as the file on disk (Linux is case-sensitive)', () => {
  assert.deepEqual(findings.filter((f) => f.rule === 'import-case').map((f) => `${f.file}:${f.line} ${f.what}`), [])
  // The checker itself.
  assert.equal(importCaseMismatch('src/main/index.ts', './platform-path'), null)
  assert.equal(importCaseMismatch('src/main/index.ts', './Platform-Path'), 'platform-path.ts')
  assert.equal(importCaseMismatch('src/main/index.ts', './no-such-module'), null)
})

test('the counts the plan reports', () => {
  const by: Record<string, number> = {}
  for (const f of findings) by[f.rule] = (by[f.rule] ?? 0) + 1
  const exempted = EXEMPT.reduce((n, e) => n + e.count, 0)
  assert.equal(exempted, findings.length, 'every finding is an exempt one')
  // (FAZ10-PLAN.md writes these numbers.)
  console.log(`platform-neutral: ${findings.length} findings in ${EXEMPT.length} exempt entries; by rule ${JSON.stringify(by)}`)
})
