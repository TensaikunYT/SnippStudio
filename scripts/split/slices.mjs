// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/slices.mjs <store.ts> --report
// node scripts/split/slices.mjs <plan.json>
// The store's actions out of its one object literal into slice files, as text
// (phase 2B; SnippStudio FAZ2B-PLAN.md). A slice is
//   export function xActions(set, get, mutate): Pick<EditorState, …> { return { …the same properties… } }
// and the store spreads it back: return { …the rest…, ...xActions(set, get, mutate) }.
// Only an action that uses nothing of the store's own module state (its `let`
// variables, the callback's locals other than `mutate`, its top-level
// functions) can move: --report says which and why not.
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
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
        (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isShorthandPropertyAssignment(p) === false && false) && p.name === n) ||
        (p && ts.isBindingElement(p) && p.propertyName === n)
      if (!skip) out.add(n.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

function analyse(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const top = new Map(), lets = new Set()
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) { top.set(d.name.text, st); if (st.declarationList.flags & ts.NodeFlags.Let) lets.add(d.name.text) }
    if ((ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name) top.set(st.name.text, st)
  }
  const imports = []
  for (const st of sf.statements) if (ts.isImportDeclaration(st)) imports.push(st)
  const importLocal = new Map()
  for (const st of imports) {
    const c = st.importClause
    if (!c) continue
    if (c.name) importLocal.set(c.name.text, st)
    const nb = c.namedBindings
    if (nb && ts.isNamespaceImport(nb)) importLocal.set(nb.name.text, st)
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) importLocal.set(el.name.text, st)
  }
  const decl = top.get('useStore').declarationList.declarations[0]
  const call = decl.initializer
  const arrow = call.arguments[0]
  const body = arrow.body
  const ret = body.statements.find(ts.isReturnStatement)
  const obj = ret.expression
  const locals = new Set()
  for (const st of body.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) locals.add(d.name.text)
    if (ts.isFunctionDeclaration(st) && st.name) locals.add(st.name.text)
  }
  const props = obj.properties.map((p) => {
    const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
    const value = ts.isPropertyAssignment(p) ? p.initializer : null
    const isFn = ts.isMethodDeclaration(p) || (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)))
    const used = usedNames(ts.isPropertyAssignment(p) ? p.initializer : p)
    const why = []
    if (!key) why.push('no plain key')
    if (!isFn) why.push('a value, not an action')
    for (const n of used) {
      if (lets.has(n)) why.push('module let ' + n)
      else if (locals.has(n) && n !== 'mutate') why.push('callback local ' + n)
      else if (top.has(n) && n !== 'useStore' && !importLocal.has(n)) why.push('store top-level ' + n)
    }
    return { p, key, used, why: [...new Set(why)], lines: sf.getLineAndCharacterOfPosition(p.end).line - sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1 }
  })
  return { text, sf, obj, props, imports, importLocal, top }
}

const arg = process.argv[2]
if (process.argv.includes('--report')) {
  const { props } = analyse(resolve(APP, arg))
  let movable = 0, ml = 0
  for (const x of props) {
    if (!x.why.length) { movable++; ml += x.lines }
    console.log(`${x.why.length ? 'stay' : 'move'} ${String(x.lines).padStart(4)} ${x.key}${x.why.length ? '  (' + x.why.join(', ') + ')' : ''}`)
  }
  console.log(`${movable} of ${props.length} can move (${ml} lines)`)
  process.exit(0)
}

const plan = JSON.parse(readFileSync(arg, 'utf8'))
const file = resolve(APP, plan.file)
const { text, sf, obj, props, imports, importLocal } = analyse(file)
const nl = text.includes('\r\n') ? '\r\n' : '\n'
const byKey = new Map(props.map((x) => [x.key, x]))
const taken = new Set()
const spreads = []
for (const s of plan.slices) {
  const to = resolve(APP, s.to)
  const mine = s.keys.map((k) => {
    const x = byKey.get(k)
    if (!x) throw new Error('no action ' + k)
    if (x.why.length) throw new Error(`${k} cannot move: ${x.why.join(', ')}`)
    if (taken.has(k)) throw new Error(k + ' twice')
    taken.add(k)
    return x
  })
  const used = new Set(mine.flatMap((x) => [...x.used]))
  // Imports: the store's own, for what these use (paths re-aimed).
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
  lines.push(`import type { EditorState } from '${modPath(to, resolve(dirname(file), 'editor-state.ts'))}'`)
  lines.push(`import type { GetState, Mutate, SetState } from '${modPath(to, resolve(dirname(file), 'slices', 'types.ts'))}'`)
  // Each property with its own leading comments and line break, as it stood.
  const bodyText = mine.map((x) => text.slice(x.p.getFullStart(), x.p.end)).join(',').replace(/^\s*\r?\n/, '')
  const keys = mine.map((x) => `'${x.key}'`)
  const keyType = keys.length > 6 ? `${nl}  | ${keys.join(`${nl}  | `)}${nl}` : keys.join(' | ')
  const src = `${s.header.trimEnd()}${nl}${lines.join(nl)}${nl}${nl}export type ${s.type} = Pick<EditorState, ${keyType}>${nl}${nl}export function ${s.fn}(set: SetState, get: GetState, mutate: Mutate): ${s.type} {${nl}  return {${nl}${bodyText.replace(/\r?\n/g, nl)}${nl}  }${nl}}${nl}`
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, src)
  spreads.push({ fn: s.fn, path: modPath(file, to) })
  console.log(`${s.to}: ${mine.length} actions, ${mine.reduce((n, x) => n + x.lines, 0)} lines`)
}
// The store: the object keeps the rest, spreads the slices.
const kept = props.filter((x) => !taken.has(x.key))
const objText = `{${kept.map((x) => text.slice(x.p.getFullStart(), x.p.end)).join(',')},${nl}${spreads.map((s) => `    ...${s.fn}(set, get, mutate)`).join(`,${nl}`)}${nl}  }`
let out = text.slice(0, obj.getStart(sf)) + objText + text.slice(obj.end)
// Imports for the slices; imports nothing uses any more are dropped.
const osf = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const left = new Set()
for (const st of osf.statements) if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) for (const n of usedNames(st)) left.add(n)
const edits = []
for (const st of osf.statements) {
  if (!ts.isImportDeclaration(st) || !st.importClause) continue
  const c = st.importClause
  const els = c.namedBindings && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : []
  const keepEls = els.filter((el) => left.has(el.name.text))
  const keepDef = c.name && left.has(c.name.text)
  const keepNs = c.namedBindings && ts.isNamespaceImport(c.namedBindings) && left.has(c.namedBindings.name.text)
  if (keepEls.length === els.length && (!c.name || keepDef) && (!(c.namedBindings && ts.isNamespaceImport(c.namedBindings)) || keepNs)) continue
  const parts = []
  if (keepDef) parts.push(c.name.text)
  if (keepNs) parts.push(`* as ${c.namedBindings.name.text}`)
  if (keepEls.length) parts.push(`{ ${keepEls.map((el) => `${!c.isTypeOnly && el.isTypeOnly ? 'type ' : ''}${el.propertyName ? el.propertyName.text + ' as ' : ''}${el.name.text}`).join(', ')} }`)
  edits.push([st.getStart(osf), st.end, parts.length ? `import ${c.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from '${st.moduleSpecifier.text}'` : ''])
}
edits.sort((a, b) => b[0] - a[0])
for (const [a, b, s] of edits) out = out.slice(0, a) + s + out.slice(b)
const lastImp = [...ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS).statements].filter(ts.isImportDeclaration).pop()
out = out.slice(0, lastImp.end) + nl + spreads.map((s) => `import { ${s.fn} } from '${s.path}'`).join(nl) + out.slice(lastImp.end)
out = out.replace(/(\r?\n)\s*(\r?\n)\s*(\r?\n)(\s*\r?\n)+/g, '$1$2$3')
writeFileSync(file, out)
