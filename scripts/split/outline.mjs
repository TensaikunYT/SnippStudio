// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/outline.mjs <file> [minLines]
// The top-level statements of a TS/TSX file: kind, name(s), first line, line count.
// A helper for the phase 2B file splits (SnippStudio FAZ2B-PLAN.md).
import ts from 'typescript'
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const min = Number(process.argv[3] ?? 0)
const text = readFileSync(file, 'utf8')
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1
export function namesOf(st) {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText(sf))
  if (st.name) return [st.name.getText(sf)]
  if (ts.isExportDeclaration(st) || ts.isImportDeclaration(st)) return [st.moduleSpecifier?.getText(sf) ?? '']
  return []
}
let imports = 0
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) { imports++; continue }
  const a = line(st.getStart(sf)), b = line(st.end)
  if (b - a + 1 < min) continue
  console.log(`${String(a).padStart(5)} ${String(b - a + 1).padStart(5)}  ${ts.SyntaxKind[st.kind].replace(/Declaration|Statement/, '')} ${namesOf(st).join(',')}`)
}
console.log(`imports: ${imports}, lines: ${text.split('\n').length}`)
