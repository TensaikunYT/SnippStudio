// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/dead-css.mjs [--json] [sheet …]
// Dead rules in the renderer's stylesheets (SnippStudio phase 3c.4b). A
// selector is dead when one of its class names is written nowhere in the
// renderer's code (.ts, .tsx, index.html): not as a word, and not as the
// start of a built name (`ui-btn-${variant}` keeps every `ui-btn-…` alive).
// A rule is dead when all of its selectors are. Read-only: it lists, a person
// deletes (a class may still be set from somewhere this cannot see).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(APP, 'src', 'renderer', 'src')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const all = walk(SRC)
const rel = (f) => relative(SRC, f).split('\\').join('/')
const code = [...all.filter((f) => /\.(ts|tsx)$/.test(f)), join(SRC, '..', 'index.html')].map((f) => readFileSync(f, 'utf8')).join('\n')

// Every name-like token in the code, and every prefix a template builds on.
const words = new Set(code.match(/[A-Za-z_][\w-]*/g))
const prefixes = [...code.matchAll(/([A-Za-z_][\w-]*-)\$\{/g)].map((m) => m[1])
const alive = (cls) => words.has(cls) || prefixes.some((p) => cls.startsWith(p))

/** The rules of a sheet with their selectors, @media / @container opened up. */
function rules(css) {
  const out = []
  const s = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  let i = 0
  const read = (depth) => {
    while (i < s.length) {
      const open = s.indexOf('{', i)
      const close = s.indexOf('}', i)
      if (close !== -1 && (open === -1 || close < open)) {
        i = close + 1
        return
      }
      if (open === -1) return
      const head = s.slice(i, open).trim()
      const line = s.slice(0, open).split('\n').length
      i = open + 1
      if (/^@(media|container|supports|layer)\b/.test(head)) read(depth + 1)
      else if (/^@/.test(head)) {
        // @keyframes, @font-face: skip the block
        let d = 1
        while (i < s.length && d > 0) {
          if (s[i] === '{') d++
          else if (s[i] === '}') d--
          i++
        }
      } else {
        const end = s.indexOf('}', i)
        out.push({ line, selectors: head.split(',').map((x) => x.trim()).filter(Boolean) })
        i = end + 1
      }
    }
  }
  read(0)
  return out
}

const want = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const sheets = all.filter((f) => f.endsWith('.css')).filter((f) => want.length === 0 || want.some((w) => rel(f).includes(w)))
const report = []
for (const f of sheets) {
  for (const r of rules(readFileSync(f, 'utf8'))) {
    const dead = r.selectors.map((sel) => {
      const missing = [...sel.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]).filter((c) => !alive(c))
      return { sel, missing }
    })
    if (dead.every((d) => d.missing.length > 0)) report.push({ sheet: rel(f), line: r.line, selectors: r.selectors, missing: [...new Set(dead.flatMap((d) => d.missing))] })
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 1))
else {
  for (const r of report) console.log(`${r.sheet}:${r.line}  ${r.selectors.join(', ')}   (${r.missing.join(' ')})`)
  console.log(`${report.length} dead rule(s) in ${sheets.length} sheet(s)`)
}
