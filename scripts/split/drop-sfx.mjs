// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/split/drop-sfx.mjs: takes the dead sound recipes out of
// audio/sfx-synth.ts (phase 2B): their switch cases, their names in the kind
// unions, their levels, their entries in LONG / BED. The list is the one
// src/test/sfx-kept.test.ts checks (what nothing in the product asks for:
// scripts/split/sfx-kinds.mjs; the only maker of sound events is
// audio/timeline-sfx.ts). sfx-scale.ts, sfx-shots.ts and sfx-synth2.ts hold
// nothing else and are deleted by hand after this.
import ts from 'typescript'
import { readFileSync, writeFileSync } from 'node:fs'
const FILE = new URL('../../src/renderer/src/audio/sfx-synth.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')
const testSrc = readFileSync(new URL('../../src/test/sfx-kept.test.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), 'utf8')
const DEAD = new Set([...testSrc.slice(testSrc.indexOf('export const DEAD'), testSrc.indexOf(']', testSrc.indexOf('export const DEAD'))).matchAll(/'([\w-]+)'/g)].map((m) => m[1]))
const text = readFileSync(FILE, 'utf8')
const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const edits = []
const del = (a, b) => edits.push([a, b, ''])
const lit = (n) => (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal) ? n.literal.text : ts.isStringLiteral(n) ? n.text : null)
const emptied = new Set()

/** A union's members without the dead ones (and without emptied aliases). */
function rewriteUnion(u) {
  const keep = u.types.filter((t) => { const s = lit(t); if (s !== null) return !DEAD.has(s); if (ts.isTypeReferenceNode(t)) return !emptied.has(t.typeName.getText(sf)); return true })
  if (keep.length === u.types.length) return null
  return keep.map((t) => t.getText(sf)).join(' | ')
}
// 1. Type aliases that are unions of names (the dead ones out; an alias left empty goes).
for (const st of sf.statements) {
  if (ts.isTypeAliasDeclaration(st) && ts.isUnionTypeNode(st.type) && st.type.types.every((t) => lit(t) !== null)) {
    const keep = st.type.types.filter((t) => !DEAD.has(lit(t)))
    if (!keep.length) { emptied.add(st.name.text); del(st.getFullStart(), st.end); continue }
    if (keep.length !== st.type.types.length) edits.push([st.type.getStart(sf), st.type.end, keep.map((t) => t.getText(sf)).join(' | ')])
  }
  if (ts.isImportDeclaration(st) && /sfx-(scale|shots|synth2)'$/.test(st.moduleSpecifier.getText(sf))) del(st.getFullStart(), st.end)
  if (ts.isExportDeclaration(st) && st.moduleSpecifier && /sfx-synth2'$/.test(st.moduleSpecifier.getText(sf))) del(st.getFullStart(), st.end)
}
const visit = (n) => {
  // 2. SfxEvent's kind union.
  if (ts.isPropertySignature(n) && n.name.getText(sf) === 'kind' && n.type && ts.isUnionTypeNode(n.type)) {
    const r = rewriteUnion(n.type)
    if (r) edits.push([n.type.getStart(sf), n.type.end, r])
  }
  // 3. The switch's cases (a run of labels sharing one body goes when all are dead).
  if (ts.isCaseBlock(n)) {
    let run = []
    for (const cl of n.clauses) {
      run.push(cl)
      if (cl.statements.length === 0 && ts.isCaseClause(cl)) continue
      const labels = run.filter(ts.isCaseClause).map((c) => lit(c.expression))
      if (run.every(ts.isCaseClause) && labels.every((l) => l && DEAD.has(l))) del(run[0].getFullStart(), run[run.length - 1].end)
      else if (labels.some((l) => l && DEAD.has(l))) {
        // Some labels of a shared body are dead: those labels go, the body stays.
        for (const c of run) if (ts.isCaseClause(c) && DEAD.has(lit(c.expression)) && c.statements.length === 0) del(c.getFullStart(), c.end)
        const last = run[run.length - 1]
        // The body's own label is dead: the label goes, the body stays under the live ones.
        if (ts.isCaseClause(last) && DEAD.has(lit(last.expression))) { del(last.getStart(sf), text.indexOf(':', last.expression.end) + 1); console.log('  shared body kept under live labels, its own label dead: ' + lit(last.expression)) }
      }
      run = []
    }
  }
  // 4. LEVEL's entries and the LONG / BED lists.
  if (ts.isPropertyAssignment(n) && ts.isObjectLiteralExpression(n.parent) && DEAD.has(n.name.getText(sf).replace(/['"]/g, ''))) {
    const list = n.parent.properties
    const i = list.indexOf(n)
    del(i === 0 ? n.getFullStart() : list[i - 1].end, i === 0 && list.length > 1 ? list[1].getFullStart() : n.end)
  }
  if (ts.isSpreadAssignment(n) && /^(SHOT_LEVEL|LEVEL2)$/.test(n.expression.getText(sf))) {
    const list = n.parent.properties, i = list.indexOf(n)
    del(list[i - 1].end, n.end)
  }
  if (ts.isArrayLiteralExpression(n) && n.elements.length && n.elements.every((e) => ts.isStringLiteral(e))) {
    const keep = n.elements.filter((e) => !DEAD.has(e.text))
    if (keep.length !== n.elements.length) edits.push([n.getStart(sf), n.end, `[${keep.map((e) => e.getText(sf)).join(', ')}]`])
  }
  ts.forEachChild(n, visit)
}
visit(sf)
// The new-sounds branch (all of them dead) and its helper.
for (const m of text.matchAll(/\n[ \t]*\/\/ The craft run's round 6 sounds[^\n]*\n[^\n]*\n[^\n]*\n[ \t]*if \(isNew\(kind\)\) return levelled\(synth2\(kind, sr, seed\)\)/g)) del(m.index, m.index + m[0].length)
for (const m of text.matchAll(/\nconst isNew = [^\n]*/g)) del(m.index, m.index + m[0].length)
// An edit inside a range that goes anyway is dropped; the rest, back to front.
const outer = edits.filter((e) => !edits.some((o) => o !== e && o[0] <= e[0] && o[1] >= e[1] && (o[0] < e[0] || o[1] > e[1])))
outer.sort((a, b) => b[0] - a[0])
let out = text
for (const [a, b, s] of outer) out = out.slice(0, a) + s + out.slice(b)
writeFileSync(FILE, out)
console.log(`${DEAD.size} dead kinds; ${edits.length} edits; ${text.split('\n').length} -> ${out.split('\n').length} lines; emptied types: ${[...emptied].join(', ')}`)
