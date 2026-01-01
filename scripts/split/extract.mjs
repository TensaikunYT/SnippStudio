// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/extract.mjs <plan.json>
// Runs of statements in one function's body move, as text, into a function of
// their own in another file; the original body calls it where they stood, so
// they still run in the same order (phase 2B: src/main/index.ts registerIpc,
// whose ipcMain handlers are independent statements).
// plan: { "file", "function", "groups": [{ "to", "fn", "header", "first", "last" }] }
// first / last: the starting lines of the first and last statement of a run.
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const APP = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const modPath = (fromFile, toFile) => {
  let r = relative(dirname(fromFile), toFile).split(sep).join('/').replace(/\.(tsx?)$/, '')
  return r.startsWith('.') ? r : './' + r
}
const usedNames = (node) => {
  const out = new Set()
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent
      const skip = (p && ts.isPropertyAccessExpression(p) && p.name === n) || (p && ts.isQualifiedName(p) && p.right === n) ||
        (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && p.name === n) || (p && ts.isBindingElement(p) && p.propertyName === n)
      if (!skip) out.add(n.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const file = resolve(APP, plan.file)
let text = readFileSync(file, 'utf8')
const nl = text.includes('\r\n') ? '\r\n' : '\n'
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const line = (p) => sf.getLineAndCharacterOfPosition(p).line + 1
const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === plan.function)
const top = new Map()
for (const st of sf.statements) {
  if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) top.set(d.name.text, st)
  if ((ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name) top.set(st.name.text, st)
}
const imports = sf.statements.filter(ts.isImportDeclaration)
const edits = []
const calls = []
for (const g of plan.groups) {
  const to = resolve(APP, g.to)
  const run = fn.body.statements.filter((st) => line(st.getStart(sf)) >= g.first && line(st.getStart(sf)) <= g.last)
  if (!run.length) throw new Error('no statements for ' + g.fn)
  const used = new Set(run.flatMap((st) => [...usedNames(st)]))
  const fromTop = [...used].filter((n) => top.has(n) && n !== plan.function)
  if (fromTop.length) throw new Error(`${g.fn} uses ${plan.file}'s own ${fromTop.join(', ')} (a cycle): move those first or leave these statements`)
  const lines = []
  for (const st of imports) {
    const c = st.importClause
    if (!c) continue
    const spec = st.moduleSpecifier.text
    const out = spec.startsWith('.') ? modPath(to, resolve(dirname(file), spec)) : spec
    const named = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements.filter((el) => used.has(el.name.text)) : []
    const def = c.name && used.has(c.name.text) ? c.name.text : null
    const ns = c.namedBindings && ts.isNamespaceImport(c.namedBindings) && used.has(c.namedBindings.name.text) ? c.namedBindings.name.text : null
    if (!def && !ns && !named.length) continue
    const parts = []
    if (def) parts.push(def)
    if (ns) parts.push(`* as ${ns}`)
    if (named.length) parts.push(`{ ${named.map((el) => `${!c.isTypeOnly && el.isTypeOnly ? 'type ' : ''}${el.propertyName ? el.propertyName.text + ' as ' : ''}${el.name.text}`).join(', ')} }`)
    lines.push(`import ${c.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from '${out}'`)
  }
  const body = text.slice(run[0].getFullStart(), run[run.length - 1].end).replace(/^\s*\r?\n/, '')
  const src = `${g.header.trimEnd()}${nl}${lines.join(nl)}${nl}${nl}export function ${g.fn}(): void {${nl}${body}${nl}}${nl}`
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, src)
  edits.push([run[0].getFullStart(), run[run.length - 1].end, `${nl}  ${g.fn}()`])
  calls.push({ fn: g.fn, path: modPath(file, to) })
  console.log(`${g.to}: ${run.length} statements, ${line(run[run.length - 1].end) - line(run[0].getStart(sf)) + 1} lines`)
}
edits.sort((a, b) => b[0] - a[0])
for (const [a, b, s] of edits) text = text.slice(0, a) + s + text.slice(b)
// The calls' imports; imports nothing uses any more are dropped.
let osf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const left = new Set()
for (const st of osf.statements) if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) for (const n of usedNames(st)) left.add(n)
const iedits = []
for (const st of osf.statements) {
  if (!ts.isImportDeclaration(st) || !st.importClause) continue
  const c = st.importClause
  const els = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : []
  const keepEls = els.filter((el) => left.has(el.name.text))
  const keepDef = c.name && left.has(c.name.text)
  const isNs = c.namedBindings && ts.isNamespaceImport(c.namedBindings)
  const keepNs = isNs && left.has(c.namedBindings.name.text)
  if (keepEls.length === els.length && (!c.name || keepDef) && (!isNs || keepNs)) continue
  const parts = []
  if (keepDef) parts.push(c.name.text)
  if (keepNs) parts.push(`* as ${c.namedBindings.name.text}`)
  if (keepEls.length) parts.push(`{ ${keepEls.map((el) => `${!c.isTypeOnly && el.isTypeOnly ? 'type ' : ''}${el.propertyName ? el.propertyName.text + ' as ' : ''}${el.name.text}`).join(', ')} }`)
  iedits.push([st.getStart(osf), st.end, parts.length ? `import ${c.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from '${st.moduleSpecifier.text}'` : ''])
}
iedits.sort((a, b) => b[0] - a[0])
for (const [a, b, s] of iedits) text = text.slice(0, a) + s + text.slice(b)
osf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const lastImp = osf.statements.filter(ts.isImportDeclaration).pop()
text = text.slice(0, lastImp.end) + nl + calls.map((c) => `import { ${c.fn} } from '${c.path}'`).join(nl) + text.slice(lastImp.end)
text = text.replace(/(\r?\n)\s*(\r?\n)\s*(\r?\n)(\s*\r?\n)+/g, '$1$2$3')
writeFileSync(file, text)
