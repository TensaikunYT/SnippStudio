// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Code values: one file's text → the places whose value can be changed.
// (types.ts says what this is; values.ts holds the rule that keeps a page's
// code the page's own.)
import { scanCss, type Found } from './css'
import { scanHtml } from './html'
import { scanJs } from './js'
import { FILE_MAX, SCANNED, type Slot } from './types'

export * from './types'
export { cleanEdit, cleanEdits, editId, editsKey, groupKey, isEditsKey, patchText, resolveEdits, type EditState, type Resolved } from './edits'
export { cleanColor, cleanFont, cleanTime, cleanValue, emit, EMITTED, parseColor } from './values'

/** The most places kept of one file (a file with more is a data file). */
export const SLOTS_MAX = 6000

/** May a file of this name be scanned at all? (Its extension; never a
 *  minified library.) */
export function isScanned(file: string): boolean {
  return SCANNED.test(file) && !/\.min\.[a-z]+$/i.test(file)
}

/** The places of one file, in file order. `file`: its path in the film's
 *  folder with "/" (decides how it is read: a page, a style sheet, a script). */
export function scanFile(file: string, text: string): Slot[] {
  if (!isScanned(file) || text.length > FILE_MAX) return []
  const found: Found[] = []
  if (/\.html?$/i.test(file)) scanHtml(text, found)
  else if (/\.css$/i.test(file)) scanCss(text, 0, 'sheet', { fq: '"', where: 'css' }, found)
  else scanJs(text, 0, found)
  found.sort((a, b) => a.at - b.at)
  // Line numbers, in one pass.
  const out: Slot[] = []
  let line = 1
  let from = 0
  let last = -1
  for (const f of found) {
    // (Never two places over the same text.)
    if (f.at < last || f.end <= f.at || text.slice(f.at, f.end) !== f.raw) continue
    for (let i = text.indexOf('\n', from); i >= 0 && i < f.at; i = text.indexOf('\n', i + 1)) {
      line++
      from = i + 1
    }
    out.push({ ...f, file, line })
    last = f.end
    if (out.length >= SLOTS_MAX) break
  }
  return out
}
