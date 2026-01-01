// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How each kind of value is read from a page's text and written back into it.
//
// THE RULE THAT KEEPS A PAGE'S CODE THE PAGE'S OWN (CILA-K-PLAN.md, "Güvenlik"):
// whatever the user typed, what is written into a file is made only of
// characters that cannot end or open anything, in ANY of the languages the
// place could be read as (HTML, CSS, JS):
//   colour  #hex digits · rgb(n,n,n) / rgba(n,n,n,n) · 0xRRGGBB
//   text    letters, digits, spaces; every other character as a numeric
//           escape of the place's language (&#N; in HTML, \xNN / \uNNNN in JS)
//   font    letters, digits, space, - and _ (quotes only where the scanner
//           says a quote mark is free)
//   time    a number and s / ms
// So no value can close a string, a tag, a script or a rule, even if the
// scanner misread where it is. `emit` is the only writer; `EMITTED` are the
// shapes it may produce (tested against every hostile value).
import type { Slot } from './types'
import { VALUE_MAX } from './types'

// ---- colours -------------------------------------------------------------------

/** CSS colour names (CSS Color 4), without `transparent` and `currentcolor`. */
export const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000',
  blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00',
  chocolate: 'd2691e', coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff', darkblue: '00008b',
  darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b',
  darkolivegreen: '556b2f', darkorange: 'ff8c00', darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
  darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493',
  deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff', firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22',
  fuchsia: 'ff00ff', gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000',
  greenyellow: 'adff2f', grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0', khaki: 'f0e68c',
  lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
  lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a', lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899', lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa',
  mediumblue: '0000cd', mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa', mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500',
  orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5',
  peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000',
  rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072', sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee',
  sienna: 'a0522d', silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347', turquoise: '40e0d0', violet: 'ee82ee',
  wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32'
}

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)'
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = new RegExp(`^rgba?\\(\\s*(${NUM})(%?)\\s*[,\\s]\\s*(${NUM})(%?)\\s*[,\\s]\\s*(${NUM})(%?)\\s*(?:[,/]\\s*(${NUM})(%?)\\s*)?\\)$`, 'i')
const HSL = new RegExp(`^hsla?\\(\\s*(${NUM})(?:deg)?\\s*[,\\s]\\s*(${NUM})%\\s*[,\\s]\\s*(${NUM})%\\s*(?:[,/]\\s*(${NUM})(%?)\\s*)?\\)$`, 'i')

const withAlpha = (rgb: string, a: number): string => {
  const aa = hex2(Math.max(0, Math.min(1, a)) * 255)
  return '#' + rgb + (aa === 'ff' ? '' : aa)
}

/** A colour as "#rrggbb" or "#rrggbbaa" (lower case; alpha left out when
 *  it is 1), or null when the text is not one colour and nothing else. */
export function parseColor(raw: string): string | null {
  const s = raw.trim()
  let m = HEX.exec(s)
  if (m) {
    let h = m[1].toLowerCase()
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    return '#' + (h.length === 8 && h.endsWith('ff') ? h.slice(0, 6) : h)
  }
  if (s.length > 80) return null
  m = RGB.exec(s)
  if (m) {
    const ch = (v: string, pct: string): number => (pct ? (parseFloat(v) * 255) / 100 : parseFloat(v))
    const a = m[7] === undefined ? 1 : m[8] ? parseFloat(m[7]) / 100 : parseFloat(m[7])
    return withAlpha(hex2(ch(m[1], m[2])) + hex2(ch(m[3], m[4])) + hex2(ch(m[5], m[6])), a)
  }
  m = HSL.exec(s)
  if (m) {
    const h = (((parseFloat(m[1]) % 360) + 360) % 360) / 360
    const sat = Math.max(0, Math.min(1, parseFloat(m[2]) / 100))
    const l = Math.max(0, Math.min(1, parseFloat(m[3]) / 100))
    const a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
    const p = 2 * l - q
    const hue = (t: number): number => {
      t = t < 0 ? t + 1 : t > 1 ? t - 1 : t
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    }
    return withAlpha(hex2(hue(h + 1 / 3) * 255) + hex2(hue(h) * 255) + hex2(hue(h - 1 / 3) * 255), a)
  }
  return null
}

/** A colour name as "#rrggbb", or null. */
export function namedColor(name: string): string | null {
  const h = NAMED[name.toLowerCase()]
  return h ? '#' + h : null
}

/** The user's colour as kept in an edit: "#rrggbb" or "#rrggbbaa", or null. */
export function cleanColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v.trim())
  if (!m) return null
  const a = (m[2] ?? 'ff').toLowerCase()
  return '#' + m[1].toLowerCase() + (a === 'ff' ? '' : a)
}

// ---- text ------------------------------------------------------------------------

/** The named character references a text node may hold and still be shown
 *  (with their semicolon); a node with any other is left alone. */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', plusmn: '±',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', check: '✓', star: '☆',
  hearts: '♥', infin: '∞', ne: '≠', le: '≤', ge: '≥', asymp: '≈', micro: 'µ', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', thinsp: '\u2009',
  ensp: '\u2002', emsp: '\u2003', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c', prime: '′', Prime: '″', minus: '−', lowast: '∗', dagger: '†'
}

/** An HTML text node's text as it is read, or null when it holds a
 *  character reference this module does not know for sure (then the node is
 *  not offered: what the browser would show there is not certain). */
export function decodeHtmlText(raw: string): string | null {
  if (!raw.includes('&')) return raw
  let out = ''
  let i = 0
  while (i < raw.length) {
    const c = raw[i]
    if (c !== '&') {
      out += c
      i++
      continue
    }
    const next = raw[i + 1] ?? ''
    // (A bare & before a blank, a digit, punctuation or the end stays an &.)
    if (!/[A-Za-z#]/.test(next)) {
      out += '&'
      i++
      continue
    }
    if (next === '#') {
      const m = /^&#(?:[xX]([0-9a-fA-F]{1,6})|(\d{1,7}));/.exec(raw.slice(i, i + 12))
      if (!m) return null
      const cp = m[1] ? parseInt(m[1], 16) : parseInt(m[2], 10)
      // (0, the C1 block, surrogates and beyond Unicode are remapped by browsers: not offered.)
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || (cp >= 0x80 && cp <= 0x9f) || cp === 0x0d) return null
      out += String.fromCodePoint(cp)
      i += m[0].length
      continue
    }
    const m = /^&([A-Za-z][A-Za-z0-9]*)(;?)/.exec(raw.slice(i, i + 40))!
    if (m[2] === ';') {
      const ch = Object.prototype.hasOwnProperty.call(ENTITIES, m[1]) ? ENTITIES[m[1]] : undefined
      if (ch === undefined) return null
      out += ch
      i += m[0].length
      continue
    }
    // No semicolon: the browser still reads the old names (&amp, &copy…),
    // even at the start of a longer word. One of those: not certain, the
    // node is left alone. Anything else ("R&D", "AT&T") is an & and letters.
    if (LEGACY.some((name) => m[1].startsWith(name))) return null
    out += '&'
    i++
  }
  return out
}

/** The names a browser reads without their semicolon. */
const LEGACY =
  'AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml'.split(
    ' '
  )

/** A JS string literal's inside as it is read, or null when it holds an
 *  escape this module does not undo for sure (legacy octal, a bad one). */
export function decodeJsString(raw: string): string | null {
  if (!raw.includes('\\')) return raw
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (c !== '\\') {
      out += c
      continue
    }
    const e = raw[++i]
    if (e === undefined) return null
    if (e === 'n') out += '\n'
    else if (e === 't') out += '\t'
    else if (e === 'r') out += '\r'
    else if (e === 'b') out += '\b'
    else if (e === 'f') out += '\f'
    else if (e === 'v') out += '\v'
    else if (e === '0' && !/\d/.test(raw[i + 1] ?? '')) out += '\0'
    else if (e === 'x') {
      const h = raw.slice(i + 1, i + 3)
      if (!/^[0-9a-fA-F]{2}$/.test(h)) return null
      out += String.fromCharCode(parseInt(h, 16))
      i += 2
    } else if (e === 'u') {
      if (raw[i + 1] === '{') {
        const close = raw.indexOf('}', i + 2)
        const h = close < 0 ? '' : raw.slice(i + 2, close)
        if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) return null
        out += String.fromCodePoint(parseInt(h, 16))
        i = close
      } else {
        const h = raw.slice(i + 1, i + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(h)) return null
        out += String.fromCharCode(parseInt(h, 16))
        i += 4
      }
    } else if (e === '\r') {
      // A line continuation: nothing.
      if (raw[i + 1] === '\n') i++
    } else if (e === '\n' || e === '\u2028' || e === '\u2029') {
      /* a line continuation */
    } else if (/\d/.test(e)) return null
    else out += e
  }
  return out
}

/** Characters written as they are in a text: ASCII letters and digits, the
 *  space, and letters / marks / digits beyond ASCII. Everything else is
 *  written as a numeric escape. */
const PLAIN = /^(?:[A-Za-z0-9 ]|[^\u0000-\u00a0\p{C}\p{Z}\p{P}\p{S}])$/u

/** Lone halves of a pair become U+FFFD (they have no numeric escape in HTML). */
const whole = (s: string): string => s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')

/** Characters a browser does not keep as written in a text node's numeric
 *  reference: NUL and the C1 controls. */
const NOT_KEPT = new RegExp('[' + String.fromCharCode(0) + String.fromCharCode(0x80) + '-' + String.fromCharCode(0x9f) + ']', 'g')
const CR_LF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10) + '?', 'g')

/** A text for an HTML text node: plain characters, the rest as &#N; (a
 *  line break as &#10;, what a browser would not keep as U+FFFD). */
export function htmlText(v: string): string {
  let out = ''
  const kept = whole(v).replace(NOT_KEPT, String.fromCharCode(0xfffd)).replace(CR_LF, String.fromCharCode(10))
  for (const ch of kept) out += PLAIN.test(ch) ? ch : `&#${ch.codePointAt(0)};`
  return out
}

/** A text for the inside of a JS string literal ('…', "…" or a template's
 *  fixed part): plain characters, the rest as \xNN or \uNNNN. */
export function jsText(v: string): string {
  let out = ''
  for (const ch of whole(v)) {
    if (PLAIN.test(ch)) {
      out += ch
      continue
    }
    for (let i = 0; i < ch.length; i++) {
      const u = ch.charCodeAt(i)
      out += u < 0x100 ? '\\x' + u.toString(16).toUpperCase().padStart(2, '0') : '\\u' + u.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

// ---- fonts -----------------------------------------------------------------------

/** Family names that are not a font of the user's choosing. */
export const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math',
  'fangsong', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default', '-apple-system', 'blinkmacsystemfont'
])

const FONT_NAME = /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u
/** A word that may stand bare in a CSS family name (an identifier). */
const FONT_WORD = /^(?:-?[A-Za-z_]|[^\u0000-\u00a0])[A-Za-z0-9_\-¡-\uffff]*$/

/** The user's font name as kept: letters, digits, - and _, single spaces,
 *  at most 80 characters; or null. */
export function cleanFont(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s.length > 0 && s.length <= 80 && FONT_NAME.test(s) ? s : null
}

// ---- times -----------------------------------------------------------------------

const TIME = /^(-?)(\d{1,6}(?:\.\d{1,4})?|\.\d{1,4})(ms|s)$/i

/** A CSS time as it is kept ("1.5s", "300ms", "0.3s" for ".3s"), or null. */
export function cleanTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = TIME.exec(v.trim().replace(/^\+/, ''))
  if (!m) return null
  const n = parseFloat(m[2])
  if (!Number.isFinite(n)) return null
  return (m[1] && n !== 0 ? '-' : '') + String(n) + m[3].toLowerCase()
}

// ---- writing ---------------------------------------------------------------------

/** The user's value for a kind, as an edit keeps it; null when it is not one. */
export function cleanValue(kind: Slot['kind'], v: unknown): string | null {
  if (kind === 'color') return cleanColor(v)
  if (kind === 'font') return cleanFont(v)
  if (kind === 'time') return cleanTime(v)
  return typeof v === 'string' && v.length <= VALUE_MAX ? v : null
}

/** The shapes `emit` may write (the whole of what can reach a file). */
export const EMITTED: Record<Slot['form'], RegExp> = {
  hex: /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/,
  name: /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/,
  func: /^(?:rgb\(\d{1,3},\d{1,3},\d{1,3}\)|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0|1|0\.\d{1,3})\))$/,
  num: /^0x[0-9a-f]{6}$/,
  html: /^(?:[A-Za-z0-9 ]|[^\u0000-\u00a0\p{C}\p{Z}\p{P}\p{S}]|&#\d{1,7};)*$/u,
  js: /^(?:[A-Za-z0-9 ]|[^\u0000-\u00a0\p{C}\p{Z}\p{P}\p{S}]|\\x[0-9A-F]{2}|\\u[0-9A-F]{4})*$/u,
  fontq: /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u,
  font: /^(["']?)[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*\1$/u,
  time: /^-?(?:\d{1,6}(?:\.\d{1,4})?)(?:ms|s)$/
}

/** What is written into the file at `slot` for the user's `value`, or null
 *  when the value cannot stand there (not a colour, a transparency where a
 *  number colour has none, a font name that needs quotes where none are
 *  free, a negative length of time…). Never anything outside EMITTED. */
export function emit(slot: Pick<Slot, 'kind' | 'form' | 'fq' | 'delay'>, value: unknown): string | null {
  let out: string | null = null
  if (slot.kind === 'color') {
    const c = cleanColor(value)
    if (!c) return null
    const rgb = c.slice(1, 7)
    const aa = c.length === 9 ? c.slice(7) : 'ff'
    if (slot.form === 'num') out = aa === 'ff' ? '0x' + rgb : null
    else if (slot.form === 'func') {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16))
      const a = Math.round((parseInt(aa, 16) / 255) * 1000) / 1000
      out = aa === 'ff' ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a === 0 ? '0' : String(a)})`
    } else if (slot.form === 'hex' || slot.form === 'name') out = c
  } else if (slot.kind === 'text') {
    if (typeof value !== 'string' || value.length > VALUE_MAX) return null
    if (slot.form === 'html') out = htmlText(value)
    else if (slot.form === 'js') out = jsText(value)
  } else if (slot.kind === 'font') {
    const f = cleanFont(value)
    if (!f) return null
    if (slot.form === 'fontq') out = f
    else if (slot.form === 'font') {
      const bare = f.split(' ').every((w) => FONT_WORD.test(w))
      out = bare ? f : slot.fq ? slot.fq + f + slot.fq : null
    }
  } else if (slot.kind === 'time') {
    const t = cleanTime(value)
    if (!t || slot.form !== 'time') return null
    out = t.startsWith('-') && !slot.delay ? null : t
  }
  // (The last gate: whatever the code above did, only these shapes leave.)
  return out !== null && EMITTED[slot.form].test(out) ? out : null
}
