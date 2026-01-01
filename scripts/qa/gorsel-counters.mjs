// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/gorsel-counters.mjs [--json]
// The visual polish's counters in the sources ("az, çok": SnippStudio
// GORSEL-PLAN.md), measured before and after. Read-only.
//   lines        border declarations that draw a line (border / border-top…left;
//                not 0, none or transparent), every renderer stylesheet but tokens.css
//   shorthand    of those, the `border:` shorthand alone
//   accent uses  var(--accent…) in the stylesheets (the accent, its text, soft and line)
//   off-scale    literal px in padding / margin / gap that are not 0 4 8 12 16 24
//   variants     <Button / <IconButton / <MenuTrigger / <ToolButton calls by variant
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(APP, 'src', 'renderer', 'src')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk(SRC)
const rel = (f) => relative(SRC, f).split('\\').join('/')
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const per = {}
let lines = 0
let shorthand = 0
let accent = 0
let offScale = 0
const SCALE = new Set([0, 4, 8, 12, 16, 24])
for (const f of files.filter((x) => x.endsWith('.css') && rel(x) !== 'ui/tokens.css')) {
  const css = noComments(readFileSync(f, 'utf8'))
  let n = 0
  let s = 0
  for (const m of css.matchAll(/(?:^|[^-\w])border(-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/g)) {
    const v = m[2].trim()
    if (/^(0|none|0px)$/.test(v) || /\btransparent\b/.test(v)) continue
    n++
    if (!m[1]) s++
  }
  const a = (css.match(/var\(--accent/g) ?? []).length
  let o = 0
  for (const m of css.matchAll(/(?:^|[^-\w])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left))?\s*:\s*([^;}]+)/g)) {
    for (const px of m[2].matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)px/g)) if (!SCALE.has(Number(px[1]))) o++
  }
  lines += n
  shorthand += s
  accent += a
  offScale += o
  if (n || a || o) per[rel(f)] = { lines: n, shorthand: s, accent: a, offScale: o }
}

const variants = {}
for (const f of files.filter((x) => x.endsWith('.tsx'))) {
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/<(Button|IconButton|MenuTrigger|ToolButton)\b([^>]*?)(\/?)>/gs)) {
    const v = /variant=["']([a-z]+)["']/.exec(m[2])?.[1] ?? (/variant=\{/.test(m[2]) ? 'expr' : 'default')
    const k = `${m[1]}:${v}`
    variants[k] = (variants[k] ?? 0) + 1
  }
}

const out = { lines, shorthand, accent, offScale, variants }
if (process.argv.includes('--json')) console.log(JSON.stringify({ ...out, per }, null, 1))
else {
  console.log(`border lines          ${lines} (shorthand ${shorthand})`)
  console.log(`accent uses in css    ${accent}`)
  console.log(`off-scale px spacing  ${offScale}`)
  console.log(`variants              ${Object.entries(variants).sort().map(([k, v]) => `${k} ${v}`).join(' · ')}`)
}
