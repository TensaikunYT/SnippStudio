// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What ui-text.test.ts looks for (SnippStudio phase 3a.3), with TypeScript's own
// parser (comments are not nodes, so a comment is never caught):
//  - plain text: words a person reads written straight into the interface
//    instead of coming from ui/strings.ts through t();
//  - glyphs: emoji and Unicode signs used as icons (the icon set is ui/Icon).
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

export const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')

/** The files looked at: every .tsx of the renderer, and the .ts files of
 *  components/, ui/ and notes/ (whose toasts the editor shows; phase 3c.4b).
 *  Paths are relative to src/renderer/src, with '/'. */
export function uiFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  return walk(SRC)
    .map((f) => relative(SRC, f).replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.tsx') || (/^(components|ui|notes)\//.test(f) && f.endsWith('.ts') && !f.endsWith('.d.ts')))
    .sort()
}

/** Attributes whose value a person reads (or a screen reader says). */
export const TEXT_ATTRS = new Set([
  'title', 'aria-label', 'aria-description', 'aria-valuetext', 'placeholder', 'alt',
  'label', 'tooltip', 'hint', 'description', 'heading', 'ariaLabel', 'confirmLabel', 'cancelLabel', 'emptyText'
])
/** Calls that show a toast. */
export const TOAST_CALLS = new Set(['toast', 'showToast', 'notify'])

const hasWords = (s: string): boolean => /\p{L}/u.test(s)

/** A literal text with words in it, anywhere a value could come from in this
 *  expression (both sides of `? :`, `&&`, `||`, `??`, `+`, template parts). */
function literalWords(e: ts.Node | undefined): boolean {
  if (!e) return false
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return hasWords(e.text)
  if (ts.isTemplateExpression(e)) return hasWords(e.head.text) || e.templateSpans.some((s) => hasWords(s.literal.text) || literalWords(s.expression))
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return literalWords(e.expression)
  if (ts.isConditionalExpression(e)) return literalWords(e.whenTrue) || literalWords(e.whenFalse)
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) return literalWords(e.right)
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.PlusToken) return literalWords(e.left) || literalWords(e.right)
  }
  return false
}

/** An object literal given to a toast: its `text` and `label` values. */
function objectWords(e: ts.Node | undefined): boolean {
  if (!e || !ts.isObjectLiteralExpression(e)) return false
  return e.properties.some((p) => {
    if (!ts.isPropertyAssignment(p)) return false
    const name = p.name.getText()
    if (name === 'text' || name === 'label') return literalWords(p.initializer)
    return objectWords(p.initializer)
  })
}

export interface Finding {
  file: string
  line: number
  what: string
}

/** A file of the renderer, or `source` given as its text (the scanner's own test). */
const parse = (file: string, source?: string): ts.SourceFile =>
  ts.createSourceFile(file, source ?? readFileSync(join(SRC, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** Plain text in one file. */
export function plainText(file: string, source?: string): Finding[] {
  const sf = parse(file, source)
  const out: Finding[] = []
  const at = (n: ts.Node, what: string): void => {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what: what.replace(/\s+/g, ' ').slice(0, 80) })
  }
  const visit = (n: ts.Node): void => {
    if (ts.isJsxText(n) && hasWords(n.text)) at(n, `text "${n.text.trim()}"`)
    else if (ts.isJsxExpression(n) && n.expression && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent)) && literalWords(n.expression)) at(n, `text ${n.expression.getText(sf)}`)
    else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(sf)) && n.initializer) {
      const v = n.initializer
      if (ts.isStringLiteral(v) ? hasWords(v.text) : ts.isJsxExpression(v) && literalWords(v.expression)) at(n, `${n.name.getText(sf)}=${v.getText(sf)}`)
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
      if (TOAST_CALLS.has(name) && n.arguments.some((a) => literalWords(a) || objectWords(a))) at(n, `${name}(${n.arguments.map((a) => a.getText(sf)).join(', ')})`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Signs used as icons: emoji, and the arrows, technical signs, shapes, symbols
 *  and dingbats blocks (and ＋ ☰ ≡ ⋯). Typography stays free: · — … − × →. */
export const GLYPH = /[\p{Extended_Pictographic}←↑↓-⇿≡⋯⌀-⏿■-◿☀-➿⤀-⥿⧀-⧿⬀-⯿＋]/u

/** Glyphs in one file's texts (strings, templates, JSX text; not comments). */
export function glyphs(file: string, source?: string): Finding[] {
  const sf = parse(file, source)
  const out: Finding[] = []
  const visit = (n: ts.Node): void => {
    let text: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) text = n.text
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text
    const m = text === null ? null : GLYPH.exec(text)
    if (m) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what: `${m[0]} U+${m[0].codePointAt(0)!.toString(16).toUpperCase()}` })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** Every key a file asks t() for with a literal (t('a.b'), useT's t too). */
export function keysAsked(file: string): Finding[] {
  const sf = parse(file)
  const out: Finding[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 't' && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what: n.arguments[0].text })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** "Ctrl+" written into a text of the interface outside ui/strings*.ts
 *  (phase 10a.5): a key name has to come through t(), which writes it as the
 *  platform does (Cmd on a Mac), or through shortcutLabel. Strings,
 *  templates and JSX text; not comments. */
export function ctrlLiterals(file: string, source?: string): Finding[] {
  if (/^ui\/strings[\w-]*\.ts$/.test(file)) return []
  const sf = parse(file, source)
  const out: Finding[] = []
  const visit = (n: ts.Node): void => {
    let text: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) text = n.text
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text
    if (text !== null && /\bCtrl\s*\+/.test(text)) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, what: text.slice(0, 80) })
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}
