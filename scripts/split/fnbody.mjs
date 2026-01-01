// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/fnbody.mjs <file> <function>: the statements of a
// top-level function's body: line, size, what it is (an ipcMain.handle /
// on channel, a local declaration), and the body's locals it uses.
import ts from 'typescript'
import { readFileSync } from 'node:fs'
const [file, fname] = process.argv.slice(2)
const text = readFileSync(file, 'utf8')
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === fname)
const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1
const locals = new Set()
for (const st of fn.body.statements) {
  if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) locals.add(d.name.text)
  if (ts.isFunctionDeclaration(st) && st.name) locals.add(st.name.text)
}
for (const st of fn.body.statements) {
  let what = ts.SyntaxKind[st.kind]
  const call = ts.isExpressionStatement(st) && ts.isCallExpression(st.expression) ? st.expression : null
  if (call && call.arguments[0] && ts.isStringLiteral(call.arguments[0])) what = call.expression.getText(sf) + ' ' + call.arguments[0].text
  else if (ts.isVariableStatement(st)) what = 'local ' + st.declarationList.declarations.map((d) => d.name.getText(sf)).join(',')
  else if (ts.isFunctionDeclaration(st)) what = 'local function ' + st.name.text
  else if (ts.isIfStatement(st)) what = 'if ' + st.expression.getText(sf).slice(0, 40)
  const used = new Set()
  const v = (n) => { if (ts.isIdentifier(n) && locals.has(n.text)) used.add(n.text); ts.forEachChild(n, v) }
  v(st)
  console.log(`${String(line(st.getStart(sf))).padStart(5)} ${String(line(st.end) - line(st.getStart(sf)) + 1).padStart(4)} ${what}${used.size ? '  <- ' + [...used].join(' ') : ''}`)
}
