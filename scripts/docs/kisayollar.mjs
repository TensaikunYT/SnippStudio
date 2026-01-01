// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/docs/kisayollar.mjs [--print en|tr]: the guides' shortcut
// tables are the app's own (SnippStudio phase 9b, FAZ9.md 9b "kılavuzdaki
// kısayollar = shortcuts.ts"). The table is made from src/renderer/src/
// shortcuts.ts (every action, its default key) and the interface's words
// (each action's labelKey, the key names: what the Keyboard shortcuts window
// shows), and must stand word for word between the markers
//   <!-- shortcuts:start --> … <!-- shortcuts:end -->
// in docs/guide.md (English) and docs/kullanim.md (Turkish).
// --print en|tr prints the table to paste. Exit code 1 when a guide differs.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SRC = join(APP, 'src', 'renderer', 'src')
export const GUIDES = { en: join(APP, 'docs', 'guide.md'), tr: join(APP, 'docs', 'kullanim.md') }
const START = '<!-- shortcuts:start -->'
const END = '<!-- shortcuts:end -->'

/** Every action of shortcuts.ts: id, labelKey, default binding. */
export function actions() {
  const src = readFileSync(join(SRC, 'shortcuts.ts'), 'utf8')
  // (The list ends at its own line's "]": a key may be "[" or "]". A review's
  // keys carry their scope.)
  const start = src.indexOf('export const ACTIONS: ActionDef[] = [')
  const body = src.slice(start, src.indexOf('\n]', start))
  return [...body.matchAll(/\{ id: '(\w+)', label: '((?:\\'|[^'])*)', labelKey: '([\w.]+)', default: '([^']+)'(?:, scope: '\w+')? \}/g)].map((m) => ({ id: m[1], label: m[2], labelKey: m[3], key: m[4] }))
}

/** The interface's words: key → { en, tr }. */
function strings() {
  const ui = join(SRC, 'ui')
  const out = new Map()
  for (const f of readdirSync(ui).filter((x) => /^strings(-[a-z0-9-]+)?\.ts$/.test(x))) {
    const sf = ts.createSourceFile(f, readFileSync(join(ui, f), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const text = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined)
    const visit = (n) => {
      if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name) && ts.isObjectLiteralExpression(n.initializer)) {
        const props = new Map(n.initializer.properties.filter(ts.isPropertyAssignment).map((p) => [p.name.getText(sf), p.initializer]))
        if (props.has('en')) out.set(n.name.text, { en: text(props.get('en')), tr: text(props.get('tr')) })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

const NAMED = ['space', 'left', 'right', 'up', 'down']
/** A binding as the Keyboard shortcuts window writes it (shortcuts.ts bindingLabel). */
function keyLabel(binding, words, lang) {
  return binding
    .split('+')
    .map((p) => (p.startsWith('arrow') ? p.replace('arrow', '') : p))
    .map((p) => (NAMED.includes(p) ? words.get(`keys.name.${p}`)[lang] : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' + ')
}

/** The table, one row per action, in the app's order. */
export function table(lang) {
  const words = strings()
  const head = lang === 'tr' ? '| Eylem | Tuş |\n|---|---|' : '| Action | Key |\n|---|---|'
  const rows = actions().map((a) => `| ${words.get(a.labelKey)?.[lang] ?? a.label} | \`${keyLabel(a.key, words, lang)}\` |`)
  return [head, ...rows].join('\n')
}

/** Each guide's table against the app's: the lines that differ. */
export function check() {
  const out = []
  for (const [lang, file] of Object.entries(GUIDES)) {
    let doc
    try {
      doc = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      out.push({ lang, file, problem: 'missing guide' })
      continue
    }
    const a = doc.indexOf(START)
    const b = doc.indexOf(END)
    if (a < 0 || b < a) {
      out.push({ lang, file, problem: 'no shortcut markers' })
      continue
    }
    const got = doc.slice(a + START.length, b).trim().split('\n')
    const want = table(lang).split('\n')
    for (let i = 0; i < Math.max(got.length, want.length); i++) if (got[i] !== want[i]) out.push({ lang, file, problem: `line ${i + 1}: "${got[i] ?? ''}" should be "${want[i] ?? ''}"` })
  }
  return { actions: actions().length, differ: out }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--print')
  if (i > 0) console.log(table(process.argv[i + 1] === 'tr' ? 'tr' : 'en'))
  else {
    const r = check()
    if (process.argv.includes('--json')) console.log(JSON.stringify(r))
    else {
      console.log(`${r.actions} actions; ${r.differ.length} lines differ`)
      for (const d of r.differ) console.log(`  ${d.lang} ${d.problem}`)
    }
    process.exitCode = r.differ.length ? 1 : 0
  }
}
