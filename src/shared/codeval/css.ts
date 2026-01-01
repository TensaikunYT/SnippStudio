// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// CSS: the declarations of a style sheet (or of a style="…" attribute), and
// in their values the colours, the font families and the times. Selectors,
// at-rule preludes, comments, strings and url(…) are never looked into.
import type { Slot } from './types'
import { cleanTime, GENERIC_FONTS, namedColor, parseColor } from './values'

/** A place found in one text (its file and line are added by the caller). */
export type Found = Omit<Slot, 'file' | 'line'>

interface VTok {
  t: 'id' | 'hash' | 'fn' | 'str' | 'num' | 'comma' | 'slash' | 'other'
  at: number
  end: number
  /** fn: its name (lower case) and where its inside is. */
  name?: string
  inner?: [number, number]
}

const NAME_CHAR = /[A-Za-z0-9_\-\u0080-\uffff]/
const NAME_START = /[A-Za-z_\u0080-\uffff]/
const digit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9'

/** The tokens of a declaration's value ([from, to) of `s`), or null when it
 *  holds what this module does not read for sure (an escape, a string that
 *  never ends, brackets that do not close). */
function valueTokens(s: string, from: number, to: number): VTok[] | null {
  const out: VTok[] = []
  let i = from
  while (i < to) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      i++
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2)
      if (e < 0 || e + 2 > to) return null
      i = e + 2
      continue
    }
    if (c === '\\') return null
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < to && s[j] !== c) {
        if (s[j] === '\\' || s[j] === '\n' || s[j] === '\r') return null
        j++
      }
      if (j >= to) return null
      out.push({ t: 'str', at: i, end: j + 1 })
      i = j + 1
      continue
    }
    if (c === '#') {
      let j = i + 1
      while (j < to && NAME_CHAR.test(s[j])) j++
      out.push({ t: 'hash', at: i, end: j })
      i = j
      continue
    }
    const numAt = digit(c) || (c === '.' && digit(s[i + 1])) || ((c === '+' || c === '-') && (digit(s[i + 1]) || (s[i + 1] === '.' && digit(s[i + 2]))))
    if (numAt) {
      let j = i + 1
      while (j < to && (digit(s[j]) || s[j] === '.')) j++
      if ((s[j] === 'e' || s[j] === 'E') && (digit(s[j + 1]) || ((s[j + 1] === '+' || s[j + 1] === '-') && digit(s[j + 2])))) {
        j += 2
        while (j < to && digit(s[j])) j++
      }
      if (s[j] === '%') j++
      else while (j < to && NAME_CHAR.test(s[j])) j++
      out.push({ t: 'num', at: i, end: j })
      i = j
      continue
    }
    if (NAME_START.test(c) || (c === '-' && (NAME_START.test(s[i + 1] ?? '') || s[i + 1] === '-'))) {
      let j = i + 1
      while (j < to && NAME_CHAR.test(s[j])) j++
      if (s[j] !== '(') {
        out.push({ t: 'id', at: i, end: j })
        i = j
        continue
      }
      const name = s.slice(i, j).toLowerCase()
      const close = closing(s, j, to, name === 'url')
      if (close < 0) return null
      out.push({ t: 'fn', at: i, end: close + 1, name, inner: [j + 1, close] })
      i = close + 1
      continue
    }
    if (c === '(') {
      const close = closing(s, i, to, false)
      if (close < 0) return null
      out.push({ t: 'fn', at: i, end: close + 1, name: '', inner: [i + 1, close] })
      i = close + 1
      continue
    }
    out.push({ t: c === ',' ? 'comma' : c === '/' ? 'slash' : 'other', at: i, end: i + 1 })
    i++
  }
  return out
}

/** The ")" that closes the "(" at `open`, or -1. */
function closing(s: string, open: number, to: number, url: boolean): number {
  let depth = 0
  for (let j = open; j < to; j++) {
    const c = s[j]
    if (c === '\\') return -1
    if (c === '"' || c === "'") {
      let k = j + 1
      while (k < to && s[k] !== c) {
        if (s[k] === '\\' || s[k] === '\n') return -1
        k++
      }
      if (k >= to) return -1
      j = k
      continue
    }
    if (url) {
      // (A bare url(…) holds anything up to its ")".)
      if (c === ')') return j
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j
  }
  return -1
}

/** Properties whose value may hold a colour NAME (a #hex or rgb() is a colour
 *  in any value). */
const COLOR_PROP =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|text-emphasis(?:-color)?|stop-color|flood-color|lighting-color|scrollbar-color|-webkit-text-stroke(?:-color)?|-webkit-text-fill-color)$/
const COLOR_FN = new Set(['rgb', 'rgba', 'hsl', 'hsla'])
/** Functions whose inside is not looked into. */
const OPAQUE_FN = new Set(['url', 'attr', 'env', 'counter', 'counters', 'format', 'local', 'image-set', 'element'])
const TIME_PROP = /^(?:-webkit-)?(?:animation|transition)(?:-duration|-delay)?$/
const SIZE_UNIT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|pt|em|rem|%|vh|vw|vmin|vmax|ex|ch|cm|mm|in|pc|q)$/i
const SIZE_WORD = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'larger', 'smaller'])
const SIZE_FN = new Set(['calc', 'clamp', 'min', 'max'])

interface Env {
  /** The quote mark free for a bare font name here ('' none). */
  fq: '"' | "'" | ''
  where: Slot['where']
}

function colors(s: string, toks: VTok[], named: boolean, env: Env, out: Found[]): void {
  for (const t of toks) {
    if (t.t === 'hash') {
      const raw = s.slice(t.at, t.end)
      const c = parseColor(raw)
      if (c) out.push({ at: t.at, end: t.end, raw, kind: 'color', form: 'hex', value: c, where: env.where })
    } else if (t.t === 'fn' && COLOR_FN.has(t.name!)) {
      const raw = s.slice(t.at, t.end)
      const c = parseColor(raw)
      if (c) out.push({ at: t.at, end: t.end, raw, kind: 'color', form: 'func', value: c, where: env.where })
    } else if (t.t === 'fn' && !OPAQUE_FN.has(t.name!)) {
      const inner = valueTokens(s, t.inner![0], t.inner![1])
      if (inner) colors(s, inner, named, env, out)
    } else if (t.t === 'id' && named) {
      const raw = s.slice(t.at, t.end)
      const c = namedColor(raw)
      if (c) out.push({ at: t.at, end: t.end, raw, kind: 'color', form: 'name', value: c, where: env.where })
    }
  }
}

/** The family names of a list of families (`toks`, comma separated). */
function families(s: string, toks: VTok[], env: Env, out: Found[]): void {
  let group: VTok[] = []
  const flush = (): void => {
    const g = group
    group = []
    if (!g.length) return
    if (g.length === 1 && g[0].t === 'str') {
      const at = g[0].at + 1
      const end = g[0].end - 1
      const raw = s.slice(at, end)
      const name = raw.replace(/\s+/g, ' ').trim()
      if (name && !GENERIC_FONTS.has(name.toLowerCase()) && !/["'\\]/.test(raw)) out.push({ at, end, raw, kind: 'font', form: 'fontq', value: name, where: env.where })
      return
    }
    if (!g.every((t) => t.t === 'id')) return
    const name = g.map((t) => s.slice(t.at, t.end)).join(' ')
    if (GENERIC_FONTS.has(name.toLowerCase())) return
    const at = g[0].at
    const end = g[g.length - 1].end
    out.push({ at, end, raw: s.slice(at, end), kind: 'font', form: 'font', fq: env.fq, value: name, where: env.where })
  }
  for (const t of toks) {
    if (t.t === 'comma') flush()
    else group.push(t)
  }
  flush()
}

/** The families of a `font` shorthand (CSS, or a canvas font string): what
 *  follows its size (and line height). Nothing when no size is found. */
function shorthandFamilies(s: string, toks: VTok[], env: Env, out: Found[]): void {
  let k = toks.findIndex((t) => (t.t === 'num' && SIZE_UNIT.test(s.slice(t.at, t.end))) || (t.t === 'id' && SIZE_WORD.has(s.slice(t.at, t.end).toLowerCase())) || (t.t === 'fn' && SIZE_FN.has(t.name!)))
  if (k < 0) return
  // (Nothing this module cannot place may come before the size.)
  if (toks.slice(0, k).some((t) => t.t === 'fn' || t.t === 'str' || t.t === 'comma')) return
  k++
  if (toks[k]?.t === 'slash') k += 2
  families(s, toks.slice(k), env, out)
}

/** A font's family names in a text that is a font value: a canvas font
 *  string's inside (`familiesOnly`: only the list of families). */
export function fontSlots(text: string, base: number, fq: Env['fq'], where: Slot['where'], out: Found[], familiesOnly = false): void {
  const toks = valueTokens(text, 0, text.length)
  if (!toks) return
  const found: Found[] = []
  if (familiesOnly) families(text, toks, { fq, where }, found)
  else shorthandFamilies(text, toks, { fq, where }, found)
  for (const f of found) out.push({ ...f, at: f.at + base, end: f.end + base })
}

function times(s: string, toks: VTok[], prop: string, env: Env, out: Found[]): void {
  const long = /-(duration|delay)$/.exec(prop)
  let seen = 0
  for (const t of toks) {
    if (t.t === 'comma') {
      seen = 0
      continue
    }
    if (t.t !== 'num') continue
    const raw = s.slice(t.at, t.end)
    const v = /(?:ms|s)$/i.test(raw) ? cleanTime(raw) : null
    if (!v) continue
    const delay = long ? long[1] === 'delay' : seen > 0
    seen++
    out.push({ at: t.at, end: t.end, raw, kind: 'time', form: 'time', value: v, where: env.where, ...(delay ? { delay: true } : {}) })
  }
}

/** One declaration: `prop` and its value at [from, to) of `s`. */
function declaration(s: string, prop: string, from: number, to: number, fontFace: boolean, env: Env, out: Found[]): void {
  const toks = valueTokens(s, from, to)
  if (!toks || !toks.length) return
  const custom = prop.startsWith('--')
  colors(s, toks, COLOR_PROP.test(prop) || (custom && toks.length === 1), env, out)
  if (prop === 'font-family' && !fontFace) families(s, toks, env, out)
  else if (prop === 'font' && !fontFace) shorthandFamilies(s, toks, env, out)
  else if (TIME_PROP.test(prop)) times(s, toks, prop, env, out)
}

const PROP = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/

/**
 * The values of a style sheet (`sheet`) or of a list of declarations
 * (`decls`: a style attribute). `text` is the CSS, `base` where it starts in
 * its file. Stops at what it does not read for sure (a string that never
 * ends); what it found before that stays.
 */
export function scanCss(text: string, base: number, mode: 'sheet' | 'decls', env: Env, out: Found[]): void {
  const n = text.length
  const found: Found[] = []
  /** Open blocks: is each an @font-face (its font-family names a file)? */
  const blocks: boolean[] = []
  let start = 0
  let colon = -1
  let paren = 0
  const decl = (end: number): void => {
    if (colon < 0 || (mode === 'sheet' && !blocks.length)) return
    const prop = text.slice(start, colon).trim().toLowerCase()
    if (PROP.test(prop)) declaration(text, prop, colon + 1, end, blocks.some(Boolean), env, found)
  }
  let i = 0
  scan: while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2)
      if (e < 0) {
        i = n
        break
      }
      // (A comment before a declaration's colon: that declaration is skipped by PROP.)
      i = e + 2
      continue
    }
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      for (;;) {
        if (j >= n || text[j] === '\n' || text[j] === '\r') break scan
        if (text[j] === '\\') j += 2
        else if (text[j] === c) break
        else j++
      }
      i = j + 1
      continue
    }
    if (c === '(') {
      // A bare url(…): anything up to its ")".
      if (/url$/i.test(text.slice(Math.max(0, i - 3), i)) && !/^\s*["']/.test(text.slice(i + 1, i + 40))) {
        const e = text.indexOf(')', i + 1)
        if (e < 0) break
        i = e + 1
        continue
      }
      paren++
    } else if (c === ')') paren = Math.max(0, paren - 1)
    else if (paren === 0) {
      if (c === ':' && colon < 0) colon = i
      else if (c === '{') {
        blocks.push(/^\s*@font-face\b/i.test(text.slice(start, i)))
        start = i + 1
        colon = -1
      } else if (c === ';' || c === '}') {
        decl(i)
        if (c === '}') blocks.pop()
        start = i + 1
        colon = -1
      }
    }
    i++
  }
  // (The last declaration needs no ";" — when the text was read to its end.)
  if (i >= n && paren === 0) decl(n)
  for (const f of found) out.push({ ...f, at: f.at + base, end: f.end + base })
}
