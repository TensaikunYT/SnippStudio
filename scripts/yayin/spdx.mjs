// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The licence header of every source file (SnippStudio phase 9c, decision 1):
// the first line of each file under src/ and scripts/ is
//   // SPDX-License-Identifier: GPL-3.0-or-later
// followed by the copyright line (no person's name):
//   // Copyright (C) 2026 SnippStudio contributors
// (After a "#!" line when a script has one, and after the "<!doctype html>"
// line of a page, which has to stay first; a byte order mark stays the first
// character. `#` comments for .py / .sh / .ps1, `<!-- -->` for .html.)
//
// Written once in phase 9c; src/test/yayin.test.ts keeps every source file so.
//
//   node scripts/yayin/spdx.mjs --check   list the files without the header (exit 1 if any)
//   node scripts/yayin/spdx.mjs --write   add it where it is missing
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
export const SPDX = 'SPDX-License-Identifier: GPL-3.0-or-later'
export const COPYRIGHT = 'Copyright (C) 2026 SnippStudio contributors'

const STYLE = {
  '.ts': ['// ', ''], '.tsx': ['// ', ''], '.mts': ['// ', ''], '.js': ['// ', ''], '.mjs': ['// ', ''], '.cjs': ['// ', ''],
  '.css': ['/* ', ' */'],
  '.py': ['# ', ''], '.sh': ['# ', ''], '.ps1': ['# ', ''],
  '.html': ['<!-- ', ' -->']
}
/** Not source: data, generated files, third-party copies. */
const SKIP = [/\/fixtures\//, /\.json$/, /\.md$/, /\/ui\/icons\/lucide\.ts$/, /\.d\.ts$/]

export function sourceFiles(root = APP) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p); continue }
      const rel = relative(root, p).replace(/\\/g, '/')
      if (!STYLE[extname(e)] || SKIP.some((r) => r.test('/' + rel))) continue
      out.push(rel)
    }
  }
  for (const top of ['src', 'scripts']) walk(join(root, top))
  return out.sort()
}

export function headerFor(file) {
  const [a, b] = STYLE[extname(file)]
  return [`${a}${SPDX}${b}`, `${a}${COPYRIGHT}${b}`]
}

const BOM = '﻿'
/** The line the header goes on: after a "#!" or "<!doctype" first line. */
const headerLine = (first = '') => (/^(#!|<!doctype)/i.test(first) ? 1 : 0)

/** Has the file the header (first line, or the line after "#!" / "<!doctype")? */
export function hasHeader(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const i = headerLine(lines[0])
  return (lines[i] ?? '').includes(SPDX) && (lines[i + 1] ?? '').includes(COPYRIGHT)
}

export function withHeader(file, text) {
  if (hasHeader(text)) return text
  const bom = text.startsWith(BOM) ? BOM : ''
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.slice(bom.length).split(/\r?\n/)
  lines.splice(headerLine(lines[0]), 0, ...headerFor(file))
  return bom + lines.join(eol)
}

function main() {
  const write = process.argv.includes('--write')
  const files = sourceFiles()
  const missing = files.filter((f) => !hasHeader(readFileSync(join(APP, f), 'utf8')))
  if (write) {
    for (const f of missing) writeFileSync(join(APP, f), withHeader(f, readFileSync(join(APP, f), 'utf8')))
    console.log(`${missing.length} of ${files.length} files given the header`)
    return
  }
  for (const f of missing.slice(0, 20)) console.log(`no header: ${f}`)
  console.log(`${missing.length} of ${files.length} source files without the header`)
  process.exit(missing.length ? 1 : 0)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
