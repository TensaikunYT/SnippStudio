// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/qa/ui-counters.mjs [--json]
// The counters of phase 3c (the interface moved onto the building blocks):
// measured at the start and the end of each 3c session and written into
// that phase's plan (not published). Read-only.
//   exempt        files on src/test/fixtures/ui-text-exempt.json (text / glyph)
//   styles.css    its lines
//   colours       literal colours in the stylesheets (ui/tokens.css aside, where
//                 the values are defined): #hex and rgba(
//   font sizes    distinct font-size values in the stylesheets (var(--fs-N) = N px)
//   z-index       distinct z-index values in the stylesheets (var(--z-*) resolved)
//   raw <button   in .tsx files outside ui/
//   old controls  JSX uses of the old Slider / SliderNum / NumberBox (controls.tsx),
//                 MenuButton (components/Menu.tsx), Section / SubSection
//                 (components/Section.tsx)
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(APP, 'src', 'renderer', 'src')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk(SRC)
const rel = (f) => relative(SRC, f).split('\\').join('/')
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

// (The exempt list went in phase 3c.4b: ui-text.test.ts takes no list.)
const LIST = join(APP, 'src', 'test', 'fixtures', 'ui-text-exempt.json')
const exempt = existsSync(LIST) ? JSON.parse(readFileSync(LIST, 'utf8')).exempt : { text: [], glyph: [] }
const sheets = files.filter((f) => f.endsWith('.css'))
const tokens = noComments(readFileSync(join(SRC, 'ui', 'tokens.css'), 'utf8'))
const root = tokens.slice(0, tokens.indexOf('@media'))
const vars = new Map([...root.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const resolve = (v, n = 0) => {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(v.trim())
  if (!m || n > 10) return v.trim()
  return vars.has(m[1]) ? resolve(vars.get(m[1]), n + 1) : v.trim()
}

let hex = 0
let rgba = 0
const sizes = new Set()
const zs = new Set()
const perSheet = {}
for (const f of sheets) {
  const css = noComments(readFileSync(f, 'utf8'))
  const r = rel(f)
  if (r !== 'ui/tokens.css') {
    const h = (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length
    const a = (css.match(/rgba?\(/g) ?? []).length
    hex += h
    rgba += a
    if (h || a) perSheet[r] = { hex: h, rgba: a }
  }
  for (const m of css.matchAll(/font-size\s*:\s*([^;}!]+)/g)) sizes.add(resolve(m[1]))
  for (const m of css.matchAll(/(?:^|[^-])font\s*:\s*([^;}]+)/g)) {
    const s = /(\d+(?:\.\d+)?px)/.exec(m[1])
    if (s) sizes.add(s[1])
  }
  for (const m of css.matchAll(/z-index\s*:\s*([^;}!]+)/g)) zs.add(resolve(m[1]))
}
const tsx = files.filter((f) => f.endsWith('.tsx') && !rel(f).startsWith('ui/'))
let buttons = 0
const buttonsPer = {}
const old = { Slider: 0, SliderNum: 0, NumberBox: 0, MenuButton: 0, Section: 0, SubSection: 0 }
for (const f of tsx) {
  const s = readFileSync(f, 'utf8')
  const b = (s.match(/<button\b/g) ?? []).length
  buttons += b
  if (b) buttonsPer[rel(f)] = b
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!/(^|\/)(controls|Section|Menu)$/.test(m[2]) || /\/ui(\/|$)/.test(m[2])) continue
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()
      const orig = raw.trim().split(/\s+as\s+/)[0]
      if (orig in old) old[orig] += (s.match(new RegExp(`<${name}\\b`, 'g')) ?? []).length
    }
  }
}
// (styles.css went in phase 3c.4b: no file, no lines.)
const lines = existsSync(join(SRC, 'styles.css')) ? readFileSync(join(SRC, 'styles.css'), 'utf8').split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length : 0
const out = {
  exemptText: exempt.text.length,
  exemptGlyph: exempt.glyph.length,
  stylesCssLines: lines,
  hex,
  rgba,
  fontSizes: sizes.size,
  zIndex: zs.size,
  rawButtons: buttons,
  old
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ ...out, perSheet, buttonsPer, sizes: [...sizes].sort(), zs: [...zs].sort() }, null, 1))
else {
  console.log(`exempt text / glyph   ${out.exemptText} / ${out.exemptGlyph}`)
  console.log(`styles.css lines      ${out.stylesCssLines}`)
  console.log(`literal colours       #hex ${hex} · rgba( ${rgba}`)
  console.log(`font sizes            ${out.fontSizes}`)
  console.log(`z-index values        ${out.zIndex}`)
  console.log(`raw <button (not ui/) ${buttons}`)
  console.log(`old controls          ${Object.entries(old).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
}
