// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/deps.mjs <file> [minLines]: each top-level declaration,
// its size, and the other top-level names of the same file it uses — to cut
// a file into parts with no cycles between them (phase 2B splits).
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const file = process.argv[2]
const min = Number(process.argv[3] ?? 0)
const text = readFileSync(file, 'utf8')
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1
const namesOf = (st) => ts.isVariableStatement(st) ? st.declarationList.declarations.flatMap((d) => ts.isIdentifier(d.name) ? [d.name.text] : []) : st.name && ts.isIdentifier(st.name) ? [st.name.text] : []
const top = new Map()
for (const st of sf.statements) for (const n of namesOf(st)) top.set(n, st)
const used = (node) => { const s = new Set(); const v = (n) => { if (ts.isIdentifier(n) && top.has(n.text)) s.add(n.text); ts.forEachChild(n, v) }; v(node); return s }
for (const st of sf.statements) {
  const names = namesOf(st)
  if (!names.length) continue
  const a = line(st.getStart(sf)), b = line(st.end)
  const d = [...used(st)].filter((n) => !names.includes(n))
  if (b - a + 1 < min && !process.argv.includes('--all')) continue
  console.log(`${String(a).padStart(5)} ${String(b - a + 1).padStart(5)} ${names.join(',')}${d.length ? '  <- ' + d.join(' ') : ''}`)
}
