// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What platform-neutral.test.ts looks for (phase 10b.7; report section 5.10):
// code that only holds on Windows. With TypeScript's own parser, so comments
// are never read. Each finding is a rule, a file and a line; the deliberate
// ones are in fixtures/platform-exempt.json, each with its reason.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

export const ROOT = join(__dirname, '..', '..')
/** The folders scanned (relative to the repository, '/' separated). */
export const SCANNED = ['src/main', 'src/preload', 'src/renderer/src', 'scripts/e2e']

export type Rule =
  | 'path-win32'
  | 'process-platform'
  | 'path-lowercase'
  | 'windows-literal'
  | 'windows-tool'
  | 'windows-font'
  | 'ctrl-label'
  | 'ctrl-without-meta'
  | 'import-case'

export interface Finding {
  rule: Rule
  /** Relative to the repository, '/' separated. */
  file: string
  line: number
  what: string
}

/** The files scanned: .ts, .tsx, .mjs, .js under SCANNED (no .d.ts). */
export function scannedFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  return SCANNED.flatMap((d) => walk(join(ROOT, d)))
    .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.endsWith('.d.ts'))
    .sort()
}

/** Where a platform branch is meant to live: the platform modules, and the
 *  places that must ask the system which it is. */
export const PLATFORM_HOMES = new Set([
  'src/main/platform-path.ts',
  'src/main/platform-system.ts',
  'src/main/app-menu.ts',
  'src/main/system-tool.ts',
  'src/renderer/src/os-platform.ts',
  'scripts/e2e/harness-paths.mjs'
])

const WINDOWS_FONTS = /\b(Segoe UI|Consolas|Cascadia (Mono|Code)|Bahnschrift|Candara)\b/
const BUNDLED_FONTS = /\b(Inter|Inter UI|JetBrains Mono|Snipp Display)\b/
const WINDOWS_TOOLS = /\b(taskkill|powershell)\b|\bcmd(\.exe)? \/[cCkK]\b|%APPDATA%|%LOCALAPPDATA%|%USERPROFILE%/i
const WINDOWS_ENV = new Set(['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramFiles', 'SystemRoot', 'windir', 'COMSPEC', 'ComSpec'])
const PATHISH = /path|file|dir|root|folder/i

const parse = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS)

/** Is the node behind a Windows guard: 'win32' on its line or the one
 *  before, or earlier in the function it is in (an early return for the
 *  other platforms, an `if (platform === 'win32')` around it)? */
function guarded(sf: ts.SourceFile, lines: string[], n: ts.Node, line: number): boolean {
  if ([lines[line - 1], lines[line - 2]].some((l) => l !== undefined && /['"]win32['"]/.test(l))) return true
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p) && p.getStart(sf) < n.getStart(sf)) return /['"]win32['"]/.test(sf.text.slice(p.getStart(sf), n.getStart(sf)))
  }
  return false
}

/** `process.platform` handed to a function (an argument, a parameter's
 *  default): the pure-function-with-a-platform pattern, which is the point. */
function handedOn(n: ts.Node): boolean {
  const p = n.parent
  if (!p) return false
  if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression)) return true
  if (ts.isParameter(p) && p.initializer === n) return true
  return false
}

/** Every finding in one file (`text`: its source, for the scanner's own test). */
export function scanFile(file: string, text?: string): Finding[] {
  const src = text ?? readFileSync(join(ROOT, file), 'utf8')
  const sf = parse(file, src)
  const lines = src.split(/\r?\n/)
  const out: Finding[] = []
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const add = (rule: Rule, n: ts.Node, what: string): void => {
    out.push({ rule, file, line: lineOf(n), what: what.replace(/\s+/g, ' ').slice(0, 90) })
  }
  const isTest = file.startsWith('src/test/')
  const home = PLATFORM_HOMES.has(file)
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      const name = n.name.text
      const left = n.expression.getText(sf)
      // (path.win32 picked by a platform test, or in a Windows-only branch, is the point.)
      if (name === 'win32' && /path$/i.test(left) && !home && !guarded(sf, lines, n, lineOf(n))) add('path-win32', n, n.getText(sf))
      if (name === 'platform' && left === 'process' && !home && !handedOn(n)) add('process-platform', n, lines[lineOf(n) - 1].trim())
      if (WINDOWS_ENV.has(name) && /env$/i.test(left) && !home && !guarded(sf, lines, n, lineOf(n))) add('windows-tool', n, n.getText(sf))
      if (name === 'ctrlKey' && !/metaKey|addModHeld|zoomWheelHeld/.test(lines[lineOf(n) - 1])) add('ctrl-without-meta', n, lines[lineOf(n) - 1].trim())
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'toLowerCase' && file.startsWith('src/main/')) {
      const recv = n.expression.expression.getText(sf)
      const line = lines[lineOf(n) - 1]
      // (A file's extension is compared without case everywhere: ".MP4".)
      if (PATHISH.test(recv) && !/extname\(/.test(recv) && !/pathKey|foldKey/.test(line)) add('path-lowercase', n, n.getText(sf))
    }
    let s: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) s = n.text
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) s = n.text
    if (s !== null) {
      if (!isTest && (/\.exe\b/i.test(s) || /^[A-Za-z]:[\\/]/.test(s) || /\b[Cc]:\\\\?/.test(s)) && !home && !guarded(sf, lines, n, lineOf(n))) add('windows-literal', n, s)
      if (WINDOWS_TOOLS.test(s) && !home && !guarded(sf, lines, n, lineOf(n))) add('windows-tool', n, s)
      const face = WINDOWS_FONTS.exec(s)
      if (face && !home && !(BUNDLED_FONTS.test(s) && s.search(BUNDLED_FONTS) < face.index)) add('windows-font', n, s)
      if (file.endsWith('.tsx') && /\bCtrl\s*\+/.test(s)) add('ctrl-label', n, s)
    }
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text
      if (spec.startsWith('.')) {
        const bad = importCaseMismatch(file, spec)
        if (bad) add('import-case', n, `${spec} (on disk: ${bad})`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** A relative import whose spelling differs from the files' own names on
 *  disk (Windows and macOS forgive it, Linux does not): the name on disk,
 *  or null when it matches (or cannot be found). */
export function importCaseMismatch(file: string, spec: string): string | null {
  const base = resolve(ROOT, dirname(file), spec.split('?')[0])
  const tries = [base, ...['.ts', '.tsx', '.mjs', '.js', '.json', '.css'].map((e) => base + e), ...['index.ts', 'index.tsx'].map((i) => join(base, i))]
  const hit = tries.find((p) => existsSync(p) && statSync(p).isFile())
  if (!hit) return null
  // Walk up from the file, comparing each part with its folder's listing.
  const rel = relative(ROOT, hit).split(/[\\/]/)
  let dir = ROOT
  for (const part of rel) {
    const names = readdirSync(dir)
    if (!names.includes(part)) return names.find((x) => x.toLowerCase() === part.toLowerCase()) ?? part
    dir = join(dir, part)
  }
  return null
}

/** Every finding in the scanned folders. */
export function scanAll(): Finding[] {
  return scannedFiles().flatMap((f) => scanFile(f))
}
