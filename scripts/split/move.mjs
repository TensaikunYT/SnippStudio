// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/move.mjs <plan.json>
// Moves top-level declarations from one TS/TSX file to another, as text (the
// code itself is not touched): the phase 2B splits (SnippStudio FAZ2B-PLAN.md).
//
// plan.json: [{ "from": "src/…/x.ts", "to": "src/…/x/part.ts", "names": ["a", "B"],
//               "header": "// what this file is", "reexport": true }, …]
// Each step, in order:
//  - the statements declaring the names (with their comments) go to `to`
//    (created, or appended to), each marked `export`;
//  - `to` imports what they use: the same imports `from` had (paths
//    re-aimed), and `from`'s own top-level names (which become exported);
//  - `from` imports from `to` the moved names it still uses, and with
//    `reexport` re-exports the moved names it used to export (its importers
//    stay as they were); imports it no longer uses are dropped.
// It prints, per step, the names `to` takes from `from`: a cycle to look at.
import ts from 'typescript'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve, posix, sep } from 'node:path'

const APP = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'))
const kindOf = (f) => (f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kindOf(file))
const modPath = (fromFile, toFile) => {
  let r = relative(dirname(fromFile), toFile).split(sep).join('/').replace(/\.(tsx?|mjs|js)$/, '')
  if (!r.startsWith('.')) r = './' + r
  return r
}

function namesOf(st, sf) {
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
  if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) return [st.name.text]
  return []
}
const isTypeDecl = (st) => ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)
const isExported = (st) => !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

/** Identifiers a piece of code refers to (not property names or keys). */
function usedNames(node) {
  const out = new Set()
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent
      const skip =
        (p && ts.isPropertyAccessExpression(p) && p.name === n) ||
        (p && ts.isQualifiedName(p) && p.right === n) ||
        (p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) ||
        (p && ts.isJsxAttribute(p) && p.name === n) ||
        (p && ts.isBindingElement(p) && p.propertyName === n)
      if (!skip) out.add(n.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return out
}

function importsOf(sf) {
  const list = []
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue
    const spec = st.moduleSpecifier.text
    const clause = st.importClause
    const entry = { st, spec, typeOnly: !!clause?.isTypeOnly, def: clause?.name?.text ?? null, ns: null, named: [] }
    const nb = clause?.namedBindings
    if (nb && ts.isNamespaceImport(nb)) entry.ns = nb.name.text
    if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) entry.named.push({ local: el.name.text, imported: el.propertyName?.text ?? el.name.text, typeOnly: el.isTypeOnly })
    list.push(entry)
  }
  return list
}

function importText(entry, keep, specOut) {
  // An import for its side effects (a stylesheet) stays where it is.
  if (!entry.st?.importClause && !entry.def && !entry.ns && !entry.named.length) return entry.keepBare ? `import '${specOut}'` : null
  const def = entry.def && keep.has(entry.def) ? entry.def : null
  const ns = entry.ns && keep.has(entry.ns) ? entry.ns : null
  const named = entry.named.filter((n) => keep.has(n.local))
  if (!def && !ns && !named.length) return null
  const parts = []
  if (def) parts.push(def)
  if (ns) parts.push(`* as ${ns}`)
  if (named.length) parts.push(`{ ${named.map((n) => `${!entry.typeOnly && n.typeOnly ? 'type ' : ''}${n.imported === n.local ? n.local : `${n.imported} as ${n.local}`}`).join(', ')} }`)
  return `import ${entry.typeOnly ? 'type ' : ''}${parts.join(', ')} from '${specOut}'`
}
const reaim = (spec, fromFile, toFile) => (spec.startsWith('.') ? modPath(toFile, resolve(dirname(fromFile), spec)) : spec)

function step({ from, to, names, header, reexport = true }) {
  const fromFile = resolve(APP, from), toFile = resolve(APP, to)
  const text = readFileSync(fromFile, 'utf8')
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const sf = parse(fromFile, text)
  const imports = importsOf(sf)
  const importLocals = new Map()
  for (const e of imports) for (const l of [e.def, e.ns, ...e.named.map((n) => n.local)].filter(Boolean)) importLocals.set(l, e)
  const top = new Map()
  for (const st of sf.statements) for (const n of namesOf(st, sf)) top.set(n, st)
  const want = new Set(names)
  const moved = sf.statements.filter((st) => namesOf(st, sf).some((n) => want.has(n)))
  const missing = names.filter((n) => !top.has(n))
  if (missing.length) throw new Error(`${from}: no top-level ${missing.join(', ')}`)
  const movedNames = new Set(moved.flatMap((st) => namesOf(st, sf)))
  const extra = [...movedNames].filter((n) => !want.has(n))
  if (extra.length) console.log(`  (also moves ${extra.join(', ')}: declared in the same statement)`)
  const remaining = sf.statements.filter((st) => !moved.includes(st) && !ts.isImportDeclaration(st))

  // What the moved code uses.
  const used = new Set()
  for (const st of moved) for (const n of usedNames(st)) used.add(n)
  const fromSource = [...used].filter((n) => top.has(n) && !movedNames.has(n))
  const fromImports = [...used].filter((n) => importLocals.has(n) && !movedNames.has(n))

  // What the remaining code still uses.
  const usedLeft = new Set()
  for (const st of remaining) for (const n of usedNames(st)) usedLeft.add(n)
  const backNames = [...movedNames].filter((n) => usedLeft.has(n))
  const exportedBefore = moved.filter(isExported).flatMap((st) => namesOf(st, sf))

  // ---- the target --------------------------------------------------------
  const movedText = moved.map((st) => {
    const full = text.slice(st.getFullStart(), st.end)
    if (isExported(st)) return full
    const lead = st.getStart(sf) - st.getFullStart()
    return full.slice(0, lead) + 'export ' + full.slice(lead)
  }).join('').replace(/^\s*\n/, '')
    // A dynamic import('./x') (or a type import('./x').T) inside the code moves with it.
    .replace(/import\((['"])(\.{1,2}\/[^'"]+)\1\)/g, (_m, q, spec) => `import(${q}${reaim(spec, fromFile, toFile)}${q})`)
  const keepImp = new Set(fromImports)
  const tImports = []
  for (const e of imports) {
    const t = importText(e, keepImp, reaim(e.spec, fromFile, toFile))
    if (t) tImports.push(t)
  }
  if (fromSource.length) {
    const types = fromSource.filter((n) => isTypeDecl(top.get(n)))
    const values = fromSource.filter((n) => !isTypeDecl(top.get(n)))
    const p = modPath(toFile, fromFile)
    if (values.length) tImports.push(`import { ${values.join(', ')} } from '${p}'`)
    if (types.length) tImports.push(`import type { ${types.join(', ')} } from '${p}'`)
  }
  mkdirSync(dirname(toFile), { recursive: true })
  if (existsSync(toFile)) {
    // Appended: its own imports merged as plain lines (duplicates removed after).
    const old = readFileSync(toFile, 'utf8')
    const osf = parse(toFile, old)
    const lastImp = [...osf.statements].filter(ts.isImportDeclaration).pop()
    const cut = lastImp ? lastImp.end : 0
    const merged = mergeImports(old.slice(0, cut) + nl + tImports.join(nl), toFile)
    writeFileSync(toFile, merged + old.slice(cut) + nl + movedText.trimEnd() + nl)
  } else {
    writeFileSync(toFile, (header ? header.trimEnd() + nl : '') + mergeImports(tImports.join(nl), toFile) + nl + nl + movedText.trimStart().trimEnd() + nl)
  }

  // ---- the source --------------------------------------------------------
  let out = text
  // Remove moved statements (back to front), export what the target needs.
  const edits = []
  for (const st of moved) edits.push([st.getFullStart(), st.end, ''])
  for (const n of fromSource) {
    const st = top.get(n)
    if (!isExported(st) && !edits.some((e) => e[0] === st.getStart(sf) && e[2] === 'export ')) edits.push([st.getStart(sf), st.getStart(sf), 'export '])
  }
  edits.sort((a, b) => b[0] - a[0])
  for (const [a, b, s] of edits) out = out.slice(0, a) + s + out.slice(b)
  // Imports: the source's own, minus what nothing left uses; plus the target's.
  const osf = parse(fromFile, out)
  const leftUsed = new Set()
  for (const st of osf.statements) if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) for (const n of usedNames(st)) leftUsed.add(n)
  // A re-export keeps the name reachable but is not a use.
  const newImports = []
  for (const e of importsOf(osf)) {
    const keep = new Set([e.def, e.ns, ...e.named.map((x) => x.local)].filter((l) => l && leftUsed.has(l)))
    const t = importText({ ...e, keepBare: true }, keep, e.spec)
    newImports.push(t)
  }
  const p = modPath(fromFile, toFile)
  const backVals = backNames.filter((n) => !isTypeDecl(top.get(n))), backTypes = backNames.filter((n) => isTypeDecl(top.get(n)))
  if (backVals.length) newImports.push(`import { ${backVals.join(', ')} } from '${p}'`)
  if (backTypes.length) newImports.push(`import type { ${backTypes.join(', ')} } from '${p}'`)
  const impStmts = importsOf(osf).map((e) => e.st)
  const lastImp = impStmts[impStmts.length - 1]
  const firstImp = impStmts[0]
  const head = firstImp ? out.slice(0, firstImp.getStart(osf)) : ''
  // Statements standing between the imports (a re-export with its comment)
  // are kept, after the rewritten imports.
  const between = lastImp ? osf.statements.filter((st) => !ts.isImportDeclaration(st) && st.getStart(osf) < lastImp.end) : []
  const betweenText = between.map((st) => out.slice(st.getFullStart(), st.end)).join('')
  for (const st of impStmts.slice(1)) {
    const lead = out.slice(st.getFullStart(), st.getStart(osf))
    if (/\/\/|\/\*/.test(lead)) console.log(`  !! a comment above an import in ${from} is not kept: ${lead.trim().slice(0, 80)}`)
  }
  const body = (betweenText ? betweenText : '') + (lastImp ? out.slice(lastImp.end) : out)
  let reexp = ''
  if (reexport && exportedBefore.length) {
    const vals = exportedBefore.filter((n) => !isTypeDecl(top.get(n))), types = exportedBefore.filter((n) => isTypeDecl(top.get(n)))
    if (vals.length) reexp += `${nl}export { ${vals.join(', ')} } from '${p}'`
    if (types.length) reexp += `${nl}export type { ${types.join(', ')} } from '${p}'`
  }
  out = head + mergeImports(newImports.filter(Boolean).join(nl), fromFile) + reexp + body.replace(/^(\r?\n){3,}/, nl + nl)
  out = out.replace(/(\r?\n){4,}/g, nl + nl + nl)
  writeFileSync(fromFile, out)
  return { moved: [...movedNames], takesFromSource: fromSource, backNames }
}

/** One import line per module (named lists joined). */
function mergeImports(block, file) {
  const nl = block.includes('\r\n') ? '\r\n' : '\n'
  const sf = parse(file, block)
  const by = new Map()
  const order = []
  for (const e of importsOf(sf)) {
    const key = e.spec + (e.typeOnly ? '|type' : '')
    if (!by.has(key)) { by.set(key, { ...e, named: [] }); order.push(key) }
    const m = by.get(key)
    m.def ??= e.def
    m.ns ??= e.ns
    for (const n of e.named) if (!m.named.some((x) => x.local === n.local)) m.named.push(n)
  }
  return order.map((k) => { const m = by.get(k); return importText({ ...m, keepBare: true }, new Set([m.def, m.ns, ...m.named.map((x) => x.local)].filter(Boolean)), m.spec) }).filter(Boolean).join(nl)
}

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'))
for (const s of plan) {
  const r = step(s)
  console.log(`${s.from} → ${s.to}: ${r.moved.length} moved${r.takesFromSource.length ? `; takes from the source: ${r.takesFromSource.join(', ')}` : ''}${r.backNames.length ? `; the source imports back: ${r.backNames.join(', ')}` : ''}`)
}
