// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The production dependencies in THIRD-PARTY-NOTICES.md (SnippStudio phase
// 9c, decision 2): every package package-lock.json installs for production,
// with its version, licence and source, written between the two markers of
// the file; the hand-written parts around them (fonts, icons, three.js, the
// terminal, the speech model, codecs) stay as they are.
//
// A licence that is not known to be compatible with GPL-3.0-or-later is
// reported by name and fails the run: it is never passed over quietly.
//
// It also writes licenses/node-packages.txt: the licence files of the packages
// whose code ships (below).
//
//   node scripts/yayin/notices.mjs           rewrite the section and the texts
//   node scripts/yayin/notices.mjs --check   exit 1 if either is stale or a
//                                            licence is unknown / incompatible
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const FILE = join(APP, 'THIRD-PARTY-NOTICES.md')
export const START = '<!-- generated:dependencies:start (scripts/yayin/notices.mjs) -->'
export const END = '<!-- generated:dependencies:end -->'

/** Licences that may be combined with GPL-3.0-or-later (SPDX ids). BlueOak-1.0.0
 *  is a permissive licence (OSI-approved) whose terms ask only for the notice. */
export const COMPATIBLE = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'MPL-2.0', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later', 'LGPL-2.0-or-later', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Zlib', 'Python-2.0', 'GPL-3.0-or-later', 'GPL-3.0-only'])

/** True when every way of reading an SPDX expression ends in compatible ids:
 *  "A AND B" needs both, "A OR B" one of them. */
export function compatible(expr) {
  if (!expr) return false
  const e = expr.trim().replace(/^\((.*)\)$/, '$1')
  if (/\bOR\b/.test(e)) return e.split(/\s+OR\s+/).some(compatible)
  if (/\bAND\b/.test(e)) return e.split(/\s+AND\s+/).every(compatible)
  return COMPATIBLE.has(e.replace(/[()]/g, '').trim())
}

function repoOf(pkgJson) {
  let r = pkgJson?.repository
  if (r && typeof r === 'object') r = r.url
  if (typeof r !== 'string') return pkgJson?.homepage ?? ''
  r = r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/')
  if (/^[\w.-]+\/[\w.-]+$/.test(r)) r = 'https://github.com/' + r
  return r
}

/** The production packages of the lock file: name, version, licence, source,
 *  whether this checkout has it installed (platform-only packages may not be). */
export function productionPackages(lock = JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8'))) {
  const out = []
  for (const [key, v] of Object.entries(lock.packages ?? {})) {
    if (!key || v.dev || v.link) continue
    const name = v.name ?? key.replace(/^.*node_modules\//, '')
    const dir = join(APP, key)
    const installed = existsSync(join(dir, 'package.json'))
    const pj = installed ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) : null
    const license = v.license ?? (typeof pj?.license === 'string' ? pj.license : pj?.license?.type) ?? null
    out.push({ name, version: v.version ?? '', license, source: repoOf(pj) || `https://www.npmjs.com/package/${name}`, installed, optional: !!v.optional })
  }
  const seen = new Set()
  return out.filter((p) => { const k = p.name + '@' + p.version; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

export function section(pkgs) {
  const rows = pkgs.map((p) => `| ${p.name} | ${p.version} | ${p.license ?? 'unknown'} | ${p.source}${p.installed ? '' : ' (platform package; not installed on Windows x64)'} |`)
  return [
    START,
    '',
    `Every package \`package-lock.json\` installs for production (${pkgs.length}), made by \`scripts/yayin/notices.mjs\`. The packaged app carries no module of its own (\`electron-builder.config.cjs\`); the interface's libraries (React, Zustand, mediabunny, transformers.js with onnxruntime-web) are bundled into its code. \`onnxruntime-node\` and \`sharp\` with its \`@img\` binaries are installed by transformers.js but never shipped.`,
    '',
    '| Package | Version | Licence | Source |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    END
  ].join('\n')
}

// ---- The licence texts the package carries (Faz 9 audit patch P, P1) -------
// licenses/node-packages.txt: the licence file of every package whose code
// ships (bundled into out/ by vite), word for word; a
// file that is exactly one of the standard texts in licenses/ is named
// instead of repeated. electron-builder.config.cjs puts licenses/, LICENSE
// and THIRD-PARTY-NOTICES.md beside the program; scripts/package/check.mjs
// checks they are there.
export const PACKAGES_FILE = join(APP, 'licenses', 'node-packages.txt')
/** The code the app imports (src/): the production dependencies, and the
 *  development packages vite bundles into the interface (none since the
 *  terminal view went: TERMINAL-YOK-PLAN.md). */
export const BUNDLED_DEV = []
/** Installed for production by transformers.js, never shipped (the app runs
 *  onnxruntime-web; electron-builder.config.cjs leaves node_modules out). */
export const NEVER_SHIPPED = ['onnxruntime-node', 'sharp']
/** Type declarations only: no code of theirs reaches the program. */
const TYPES_ONLY = (n) => n.startsWith('@types/') || n === 'csstype' || n === 'undici-types'
/** Packages without a licence file of their own: the holder named by their
 *  project's licence. */
const NO_FILE = {
  'onnxruntime-web': 'Microsoft Corporation (https://github.com/microsoft/onnxruntime)',
  'onnxruntime-common': 'Microsoft Corporation (https://github.com/microsoft/onnxruntime)'
}
const MIT_TEXT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
const ISC_TEXT = `Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`

const norm = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '')

/** The standard licence texts kept in licenses/ (file name → normalised text). */
export function standardTexts(dir = join(APP, 'licenses')) {
  const out = new Map()
  for (const n of existsSync(dir) ? readdirSync(dir).sort() : []) if (/\.txt$/.test(n) && n !== 'node-packages.txt') out.set(n, norm(readFileSync(join(dir, n), 'utf8')))
  return out
}

/** The packages whose code ships: the closure of the app's imports through
 *  package-lock.json, without platform-only, type-only and never-shipped
 *  packages. [{ key, name, version, license }] sorted by name. */
export function shippedPackages(lock = JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8')), pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))) {
  const P = lock.packages ?? {}
  const find = (from, name) => {
    let base = from
    for (;;) {
      const k = (base ? base + '/' : '') + 'node_modules/' + name
      if (P[k]) return k
      if (!base) return null
      const i = base.lastIndexOf('/node_modules/')
      base = i < 0 ? '' : base.slice(0, i)
    }
  }
  const seen = new Set()
  const todo = [...Object.keys(pkg.dependencies ?? {}), ...BUNDLED_DEV].map((n) => find('', n)).filter(Boolean)
  while (todo.length) {
    const k = todo.pop()
    if (seen.has(k)) continue
    seen.add(k)
    const v = P[k]
    for (const d of Object.keys({ ...v.dependencies, ...v.optionalDependencies })) {
      if (NEVER_SHIPPED.includes(d) || TYPES_ONLY(d)) continue
      const kk = find(k, d)
      if (kk && !P[kk].os && !P[kk].cpu) todo.push(kk)
    }
  }
  return [...seen].map((k) => ({ key: k, name: P[k].name ?? k.replace(/^.*node_modules\//, ''), version: P[k].version ?? '', license: P[k].license ?? null }))
    .filter((p) => !TYPES_ONLY(p.name))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

/** licenses/node-packages.txt for these packages (read from node_modules). */
export function packagesText(pkgs = shippedPackages(), std = standardTexts()) {
  const parts = [
    'Licences of the packages whose code ships with SnippStudio',
    '',
    'Made by scripts/yayin/notices.mjs from package-lock.json and node_modules:',
    "every package the program's code imports (bundled into it), with its",
    'licence file word for word. A licence file that is',
    'exactly one of the standard texts in this folder is named, not repeated.',
    'All production packages, the fonts, the icons, three.js and the speech',
    'model are listed in THIRD-PARTY-NOTICES.md.'
  ]
  for (const p of pkgs) {
    const dir = join(APP, p.key)
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`${p.name} is not installed (npm ci first)`)
    const files = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(f)).sort()
    parts.push('', '='.repeat(78), `${p.name} ${p.version} (${p.license ?? 'unknown'})`, '='.repeat(78))
    if (!files.length) {
      const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      const author = typeof j.author === 'string' ? j.author : j.author?.name
      const holder = NO_FILE[p.name] ?? ([author, repoOf(j) && `(${repoOf(j)})`].filter(Boolean).join(' ') || 'its authors')
      const text = p.license === 'MIT' ? MIT_TEXT : p.license === 'ISC' ? ISC_TEXT : null
      if (!text) throw new Error(`${p.name}: no licence file and no standard text for ${p.license}`)
      parts.push('', `The package holds no licence file; package.json says ${p.license}.`, '', `Copyright (c) ${holder}`, '', text)
      continue
    }
    for (const f of files) {
      const text = norm(readFileSync(join(dir, f), 'utf8'))
      const same = [...std].find(([, t]) => t === text)
      parts.push('', same ? `${f}: the text of licenses/${same[0]}` : text)
    }
  }
  return parts.join('\n') + '\n'
}

function main() {
  const check = process.argv.includes('--check')
  const pkgs = productionPackages()
  const bad = pkgs.filter((p) => !compatible(p.license))
  for (const p of bad) console.error(`licence ${p.license ?? 'unknown'} of ${p.name}@${p.version} is not known to be compatible with GPL-3.0-or-later`)
  const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')
  const want = section(pkgs)
  let next
  if (text.includes(START) && text.includes(END)) next = text.slice(0, text.indexOf(START)) + want + text.slice(text.indexOf(END) + END.length)
  else next = text.replace('\n## Interface icons', `\n### Every production package\n\n${want}\n\n## Interface icons`)
  const texts = packagesText()
  const had = existsSync(PACKAGES_FILE) ? readFileSync(PACKAGES_FILE, 'utf8').replace(/\r\n/g, '\n') : null
  if (check) {
    if (next !== text) console.error('THIRD-PARTY-NOTICES.md is stale: run node scripts/yayin/notices.mjs')
    if (had !== texts) console.error('licenses/node-packages.txt is stale: run node scripts/yayin/notices.mjs')
    process.exit(bad.length || next !== text || had !== texts ? 1 : 0)
  }
  writeFileSync(FILE, next)
  writeFileSync(PACKAGES_FILE, texts)
  console.log(`${pkgs.length} production packages written; ${shippedPackages().length} licence texts; ${bad.length} licence problems`)
  process.exit(bad.length ? 1 : 0)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
