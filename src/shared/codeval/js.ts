// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// JavaScript: a real tokenizer (strings, template literals with their nested
// code, comments, regular expressions, numbers) and what is found in its
// tokens: colours that are a whole string or a 0xRRGGBB number, the text
// handed straight to fillText / strokeText / textContent / innerText, the
// family in a canvas font. Nothing is looked for inside comments or
// template literals (a canvas font's family at a template's end apart).
import { parseColor, decodeJsString } from './values'
import { fontSlots, type Found } from './css'

export interface JsTok {
  /** str: '…' or "…" · tpl: a whole template literal · num · id (a name or
   *  keyword) · p (punctuation) · re (a regular expression). */
  t: 'str' | 'tpl' | 'num' | 'id' | 'p' | 're'
  at: number
  end: number
  /** A line break stood between the token before and this one. */
  nl: boolean
  /** tpl: its fixed parts ([from, to) in the text), in order. */
  parts?: [number, number][]
}

/** Longer punctuation, by its first character (longest first). */
const PUNCT: Record<string, string[]> = {
  '>': ['>>>=', '>>=', '>>>', '>=', '>>'],
  '.': ['...'],
  '=': ['===', '=>', '=='],
  '!': ['!==', '!='],
  '*': ['**=', '*=', '**'],
  '<': ['<<=', '<=', '<<'],
  '&': ['&&=', '&&', '&='],
  '|': ['||=', '||', '|='],
  '?': ['??=', '??', '?.'],
  '+': ['++', '+='],
  '-': ['--', '-='],
  '/': ['/='],
  '%': ['%='],
  '^': ['^=']
}
/** Character classes of ASCII: 1 a name's first character, 2 a name's
 *  later character, 4 a digit, 8 a blank, 16 a hex digit. */
const CLS = new Uint8Array(128)
for (let c = 0; c < 128; c++) {
  const ch = String.fromCharCode(c)
  if (/[A-Za-z_$#]/.test(ch)) CLS[c] |= 1
  if (/[A-Za-z0-9_$]/.test(ch)) CLS[c] |= 2
  if (/[0-9]/.test(ch)) CLS[c] |= 4
  if (ch === ' ' || c === 9 || c === 11 || c === 12) CLS[c] |= 8
  if (/[0-9a-fA-F_]/.test(ch)) CLS[c] |= 16
}
const LF = 10
const CR = 13
const LS = 0x2028
const PS = 0x2029
const isBreak = (c: number): boolean => c === LF || c === CR || c === LS || c === PS
/** Words after which a "/" starts a regular expression. */
const BEFORE_RE = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])

/** The tokens of a script, or null when it does not tokenize to its end (an
 *  open string, template or regular expression: nothing is taken from it). */
export function lexJs(src: string): JsTok[] | null {
  const toks: JsTok[] = []
  const n = src.length
  let i = 0
  let nl = false
  /** Open templates: the token and the depth of { } inside its current ${ }. */
  const open: { tok: JsTok; depth: number }[] = []
  /** The token count when a template last closed (a value ended there). */
  let closedAt = -1
  const regexMayStart = (): boolean => {
    const l = toks[toks.length - 1]
    if (!l) return true
    if (closedAt === toks.length) return false
    if (l.t === 'num' || l.t === 'str' || l.t === 're') return false
    if (l.t === 'tpl') return l.end < 0
    if (l.t === 'id') return BEFORE_RE.has(src.slice(l.at, l.end))
    if (l.end - l.at > 2) return true
    const p = src.slice(l.at, l.end)
    return !(p === ')' || p === ']' || p === '}' || p === '++' || p === '--')
  }
  /** Reads a template's fixed part from `from`; returns where it stopped
   *  (after the closing ` or after a ${), or -1 when it never ends. */
  const quasi = (tok: JsTok, from: number): number => {
    let j = from
    while (j < n) {
      const c = src.charCodeAt(j)
      if (c === 92) j += 2
      else if (c === 96) {
        tok.parts!.push([from, j])
        tok.end = j + 1
        closedAt = toks.length
        return j + 1
      } else if (c === 36 && src.charCodeAt(j + 1) === 123) {
        tok.parts!.push([from, j])
        open.push({ tok, depth: 0 })
        return j + 2
      } else j++
    }
    return -1
  }
  while (i < n) {
    const c = src.charCodeAt(i)
    const cls = c < 128 ? CLS[c] : c === 0xa0 || c === 0xfeff ? 8 : isBreak(c) ? 0 : 3
    if (cls & 8) {
      i++
      continue
    }
    if (isBreak(c)) {
      nl = true
      i++
      continue
    }
    const at = i
    if (c === 47) {
      const d = src.charCodeAt(i + 1)
      if (d === 47) {
        i += 2
        while (i < n && !isBreak(src.charCodeAt(i))) i++
        continue
      }
      if (d === 42) {
        const end = src.indexOf('*/', i + 2)
        if (end < 0) return null
        for (let j = i + 2; j < end && !nl; j++) if (isBreak(src.charCodeAt(j))) nl = true
        i = end + 2
        continue
      }
      if (regexMayStart()) {
        let j = i + 1
        let inClass = false
        for (;;) {
          if (j >= n) return null
          const e = src.charCodeAt(j)
          if (isBreak(e)) return null
          if (e === 92) {
            j += 2
            continue
          }
          if (e === 91) inClass = true
          else if (e === 93) inClass = false
          else if (e === 47 && !inClass) break
          j++
        }
        j++
        while (j < n && src.charCodeAt(j) < 128 && CLS[src.charCodeAt(j)] & 2) j++
        toks.push({ t: 're', at, end: j, nl })
        i = j
        nl = false
        continue
      }
    }
    if (c === 34 || c === 39) {
      let j = i + 1
      for (;;) {
        if (j >= n) return null
        const d = src.charCodeAt(j)
        if (d === 92) {
          // (An escaped line break continues the string: \ + CR LF is one.)
          j += src.charCodeAt(j + 1) === CR && src.charCodeAt(j + 2) === LF ? 3 : 2
          continue
        }
        if (d === c) break
        if (d === LF || d === CR) return null
        j++
      }
      toks.push({ t: 'str', at, end: j + 1, nl })
      i = j + 1
    } else if (c === 96) {
      const tok: JsTok = { t: 'tpl', at, end: -1, nl, parts: [] }
      toks.push(tok)
      i = quasi(tok, i + 1)
      if (i < 0) return null
    } else if (cls & 4 || (c === 46 && CLS[src.charCodeAt(i + 1)] & 4 && src.charCodeAt(i + 1) < 128)) {
      let j = i
      const x = src.charCodeAt(i + 1) | 32
      if (c === 48 && (x === 120 || x === 98 || x === 111)) {
        j += 2
        while (j < n && src.charCodeAt(j) < 128 && CLS[src.charCodeAt(j)] & 16) j++
      } else {
        const digits = (): void => {
          while (j < n && (src.charCodeAt(j) === 95 || (src.charCodeAt(j) < 128 && CLS[src.charCodeAt(j)] & 4))) j++
        }
        digits()
        if (src.charCodeAt(j) === 46) {
          j++
          digits()
        }
        if ((src.charCodeAt(j) | 32) === 101) {
          const s = src.charCodeAt(j + 1)
          if ((s < 128 && CLS[s] & 4) || s === 43 || s === 45) {
            j += 2
            digits()
          }
        }
      }
      if (src.charCodeAt(j) === 110) j++
      toks.push({ t: 'num', at, end: j, nl })
      i = j
    } else if (cls & 1) {
      let j = i + 1
      for (; j < n; j++) {
        const d = src.charCodeAt(j)
        if (d < 128 ? !(CLS[d] & 2) : isBreak(d) || d === 0xa0 || d === 0xfeff) break
      }
      toks.push({ t: 'id', at, end: j, nl })
      i = j
    } else {
      const top = open[open.length - 1]
      if (top && c === 123) top.depth++
      if (top && c === 125) {
        if (top.depth === 0) {
          // The end of a ${ }: the template goes on.
          open.pop()
          i = quasi(top.tok, i + 1)
          if (i < 0) return null
          nl = false
          continue
        }
        top.depth--
      }
      let len = 1
      const longer = PUNCT[src[i]]
      if (longer)
        for (const cand of longer)
          if (src.startsWith(cand, i)) {
            len = cand.length
            break
          }
      toks.push({ t: 'p', at, end: i + len, nl })
      i += len
    }
    nl = false
  }
  return open.length ? null : toks
}

/** Calls whose string is a selector, not a colour ('#add', '#bed'). */
const SELECTOR_CALLS = new Set(['querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById', '$', '$$', 'select', 'selectAll'])
const TEXT_CALLS = new Set(['fillText', 'strokeText'])
const TEXT_PROPS = new Set(['textContent', 'innerText'])
/** What may stand before and after a 0xRRGGBB for it to be taken as a colour
 *  (a value on its own: an argument, a property, an item, a branch), never
 *  beside arithmetic or bit operators. */
const NUM_BEFORE = new Set(['(', ',', ':', '=', '[', '?', '||', '??', '&&', 'return', '=>'])
const NUM_AFTER = new Set([')', ',', ';', '}', ']', ':', '||', '??'])
/** How far a font's size is looked for in a template's last fixed part. */
const TPL_FONT = /^(?:px|pt|em|rem|vh|vw|vmin|vmax|%)(?:\s*\/\s*[\w.%]+)?\s+(?=\S)/

/**
 * The values of a script. `src` is the script's text, `base` where it starts
 * in its file. Nothing when the script does not tokenize to its end.
 */
export function scanJs(src: string, base: number, out: Found[]): void {
  const toks = lexJs(src)
  if (!toks) return
  const word = (k: number): string => (k >= 0 && k < toks.length ? src.slice(toks[k].at, toks[k].end) : '')
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k]
    if (tok.t === 'num') {
      const raw = src.slice(tok.at, tok.end)
      if (!/^0[xX][0-9a-fA-F]{6}$/.test(raw)) continue
      const next = toks[k + 1]
      if (!NUM_BEFORE.has(word(k - 1))) continue
      if (next && !next.nl && !NUM_AFTER.has(word(k + 1))) continue
      out.push({ at: base + tok.at, end: base + tok.end, raw, kind: 'color', form: 'num', value: '#' + raw.slice(2).toLowerCase(), where: 'js' })
      continue
    }
    const assigned = (prop: Set<string> | string): boolean =>
      word(k - 1) === '=' && toks[k - 2]?.t === 'id' && (typeof prop === 'string' ? word(k - 2) === prop : prop.has(word(k - 2))) && (word(k - 3) === '.' || word(k - 3) === '?.')
    if (tok.t === 'tpl') {
      // A canvas font written as a template: `800 ${size}px Mont`. Only the
      // family at its end, after a size that ends the last ${ }.
      if (!assigned('font') || !tok.parts || tok.parts.length < 2) continue
      const [from, to] = tok.parts[tok.parts.length - 1]
      const tail = src.slice(from, to)
      const m = TPL_FONT.exec(tail)
      if (!m || /[\\`$]/.test(tail)) continue
      fontSlots(tail.slice(m[0].length), base + from + m[0].length, '"', 'js', out, true)
      continue
    }
    if (tok.t !== 'str') continue
    const inner = src.slice(tok.at + 1, tok.end - 1)
    const at = base + tok.at + 1
    const end = base + tok.end - 1
    const q = src[tok.at] as '"' | "'"
    // (The quote mark that is free inside this string: the other one.)
    const free = q === '"' ? "'" : '"'
    const next = toks[k + 1]
    const nextWord = word(k + 1)
    // (a) the whole string is one colour
    if (inner.length >= 4 && inner.length <= 80 && !inner.includes('\\')) {
      const c = parseColor(inner)
      const selector = word(k - 1) === '(' && toks[k - 2]?.t === 'id' && SELECTOR_CALLS.has(word(k - 2))
      if (c && !selector) {
        out.push({ at, end, raw: inner, kind: 'color', form: inner[0] === '#' ? 'hex' : 'func', value: c, where: 'js' })
        continue
      }
    }
    // (b) the text handed straight to fillText / strokeText
    const call = word(k - 1) === '(' && toks[k - 2]?.t === 'id' && TEXT_CALLS.has(word(k - 2)) && (word(k - 3) === '.' || word(k - 3) === '?.') && (nextWord === ',' || nextWord === ')')
    // (c) … or set as an element's text, the string being the whole value
    const whole = !next || nextWord === ';' || nextWord === ',' || nextWord === ')' || nextWord === '}' || (next.nl && (next.t === 'id' || nextWord === '}'))
    if (call || (assigned(TEXT_PROPS) && whole)) {
      const text = decodeJsString(inner)
      if (text !== null && text.trim() !== '') out.push({ at, end, raw: inner, kind: 'text', form: 'js', value: text, where: 'js' })
      continue
    }
    // (d) a canvas font: its family names
    if (assigned('font') && whole && !inner.includes('\\')) fontSlots(inner, at, free, 'js', out)
  }
}
