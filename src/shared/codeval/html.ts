// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// HTML: a tokenizer that follows the browser's own rules for where text,
// tags, comments, style sheets and scripts begin and end, and what is found
// in them: text nodes, colours in style="…" and in SVG attributes, and the
// values of the page's <style> and <script> elements (css.ts, js.ts).
//
// Where the browser's reading of the rest of the file is not certain here
// (a script that holds "<!--", a <script> inside <svg>, CDATA, <plaintext>,
// <select>, <math>…) the scan STOPS: what was found before that point stays,
// nothing after it is offered.
import { ORIG_MAX } from './types'
import { scanCss, type Found } from './css'
import { scanJs } from './js'
import { decodeHtmlText, namedColor, parseColor } from './values'

interface Attr {
  name: string
  /** The value's place in the text (-1: no value) and its quote mark. */
  at: number
  end: number
  q: '"' | "'" | ''
}
interface Tag {
  name: string
  attrs: Attr[]
  /** Just past its ">". */
  end: number
  selfClose: boolean
}

const WS = /[\t\n\f\r ]/

/** The tag whose name starts at `at`, or null when the file ends inside it. */
function parseTag(text: string, at: number): Tag | null {
  const n = text.length
  let j = at
  while (j < n && !WS.test(text[j]) && text[j] !== '/' && text[j] !== '>') j++
  const name = text.slice(at, j).toLowerCase()
  const attrs: Attr[] = []
  const seen = new Set<string>()
  let slash = false
  for (;;) {
    while (j < n && (WS.test(text[j]) || text[j] === '/')) {
      slash = text[j] === '/'
      j++
    }
    if (j >= n) return null
    if (text[j] === '>') return { name, attrs, end: j + 1, selfClose: slash }
    slash = false
    const ns = j
    if (text[j] === '=') j++
    while (j < n && !WS.test(text[j]) && text[j] !== '/' && text[j] !== '>' && text[j] !== '=') j++
    const an = text.slice(ns, j).toLowerCase()
    while (j < n && WS.test(text[j])) j++
    let a: Attr = { name: an, at: -1, end: -1, q: '' }
    if (text[j] === '=') {
      j++
      while (j < n && WS.test(text[j])) j++
      if (j >= n) return null
      const q = text[j]
      if (q === '"' || q === "'") {
        const close = text.indexOf(q, j + 1)
        if (close < 0) return null
        a = { name: an, at: j + 1, end: close, q }
        j = close + 1
      } else if (q !== '>') {
        const vs = j
        while (j < n && !WS.test(text[j]) && text[j] !== '>') j++
        a = { name: an, at: vs, end: j, q: '' }
      }
    }
    // (The first attribute of a name is the one the browser keeps.)
    if (!seen.has(an)) {
      seen.add(an)
      attrs.push(a)
    }
  }
}

/** Elements whose content is not markup (raw text, or text with character
 *  references): read up to their own end tag. */
const RAW = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'textarea', 'title'])
/** Inside <svg>: elements after which the content may be read as HTML again. */
const SVG_TURNS = new Set([
  'foreignobject', 'desc', 'title', 'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike', 'sub', 'sup',
  'table', 'tt', 'u', 'ul', 'var', 'font'
])
/** Attributes that hold one colour. */
const COLOR_ATTR = new Set(['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'])
const JS_TYPE = /^(?:|module|(?:text|application)\/(?:javascript|ecmascript|x-javascript))$/

/** Where `</name` (followed by a blank, "/" or ">") starts at or after `from`; -1 when nowhere. */
function closeOf(text: string, name: string, from: number): number {
  let i = from
  for (;;) {
    i = text.indexOf('</', i)
    if (i < 0) return -1
    const after = text[i + 2 + name.length]
    if (text.slice(i + 2, i + 2 + name.length).toLowerCase() === name && (after === undefined || after === '>' || after === '/' || WS.test(after))) return i
    i += 2
  }
}

/** The values of an HTML page. */
export function scanHtml(text: string, out: Found[]): void {
  const n = text.length
  let pos = 0
  let textFrom = 0
  /** How deep inside <svg> we are, and whether the reading there (or from
   *  here on) is no longer certain. */
  let svg = 0
  let unsureSvg = false
  let unsure = false

  const emitText = (a: number, b: number): void => {
    while (a < b && WS.test(text[a])) a++
    while (b > a && WS.test(text[b - 1])) b--
    if (b <= a || b - a > ORIG_MAX) return
    const raw = text.slice(a, b)
    if (raw.includes('\0')) return
    const decoded = decodeHtmlText(raw)
    if (decoded === null) return
    // (Line breaks of the source's own layout read as one space.)
    const value = decoded.replace(/[\t\f\r ]*\n[\t\n\f\r ]*/g, ' ')
    out.push({ at: a, end: b, raw, kind: 'text', form: 'html', value, where: 'html' })
  }

  const attributes = (tag: Tag): void => {
    for (const a of tag.attrs) {
      if (a.at < 0 || a.end <= a.at) continue
      const v = text.slice(a.at, a.end)
      // (A character reference inside a value: what the browser reads there
      // is not the text as written; left alone.)
      if (v.includes('&') || v.includes('\0')) continue
      if (a.name === 'style') {
        const found: Found[] = []
        scanCss(v, a.at, 'decls', { fq: a.q === '"' ? "'" : a.q === "'" ? '"' : '', where: 'style' }, found)
        // (A value without quote marks ends at a blank: no font name there.)
        for (const f of found) if (a.q !== '' || f.kind !== 'font') out.push(f)
      } else if (COLOR_ATTR.has(a.name)) {
        let from = a.at
        let to = a.end
        while (from < to && WS.test(text[from])) from++
        while (to > from && WS.test(text[to - 1])) to--
        const raw = text.slice(from, to)
        const c = parseColor(raw)
        if (c) out.push({ at: from, end: to, raw, kind: 'color', form: raw[0] === '#' ? 'hex' : 'func', value: c, where: 'attr' })
        else {
          const named = namedColor(raw)
          if (named) out.push({ at: from, end: to, raw, kind: 'color', form: 'name', value: named, where: 'attr' })
        }
      }
    }
  }

  while (pos < n) {
    const lt = text.indexOf('<', pos)
    if (lt < 0) break
    const c = text[lt + 1] ?? ''
    if (/[A-Za-z]/.test(c)) {
      emitText(textFrom, lt)
      const tag = parseTag(text, lt + 1)
      if (!tag) return
      attributes(tag)
      pos = textFrom = tag.end
      const name = tag.name
      if (name === 'plaintext') return
      if (name === 'math' || name === 'select' || name === 'frameset') unsure = true
      const foreign = svg > 0
      if (RAW.has(name)) {
        if (foreign || unsure) {
          if (unsure || unsureSvg) return
          // Inside <svg> these are ordinary elements: their content is
          // markup. A <style> there is read only when it is plain CSS up to
          // its own end tag.
          if (name === 'style' && !tag.selfClose) {
            const next = text.indexOf('<', pos)
            if (next < 0 || text.slice(next, next + 7).toLowerCase() !== '</style') return
            const css = text.slice(pos, next)
            if (css.includes('&')) return
            scanCss(css, pos, 'sheet', { fq: '"', where: 'css' }, out)
            pos = textFrom = next
          } else if (name === 'title') unsureSvg = true
          else if (!tag.selfClose) return
          continue
        }
        const close = closeOf(text, name, pos)
        const end = close < 0 ? n : close
        const attr = (k: string): string | null => {
          const a = tag.attrs.find((x) => x.name === k)
          return a ? (a.at < 0 ? '' : text.slice(a.at, a.end).trim().toLowerCase()) : null
        }
        if (name === 'style') {
          const type = attr('type')
          if (type === null || type === '' || type === 'text/css') scanCss(text.slice(pos, end), pos, 'sheet', { fq: '"', where: 'css' }, out)
        } else if (name === 'script') {
          const body = text.slice(pos, end)
          // ("<!--" in a script changes where the browser ends it.)
          if (body.includes('<!--')) return
          if (attr('src') === null && JS_TYPE.test(attr('type') ?? '') && attr('language') === null) scanJs(body, pos, out)
        }
        if (close < 0) return
        const endTag = parseTag(text, close + 2)
        if (!endTag) return
        pos = textFrom = endTag.end
        continue
      }
      if (name === 'svg') {
        if (!tag.selfClose) svg++
      } else if (foreign && SVG_TURNS.has(name)) unsureSvg = true
      continue
    }
    if (c === '/') {
      const d = text[lt + 2] ?? ''
      if (/[A-Za-z]/.test(d)) {
        emitText(textFrom, lt)
        const tag = parseTag(text, lt + 2)
        if (!tag) return
        if (tag.name === 'svg' && svg > 0 && --svg === 0) unsureSvg = false
        else if (svg > 0 && (tag.name === 'p' || tag.name === 'br')) unsureSvg = true
        pos = textFrom = tag.end
      } else if (d === '>') {
        emitText(textFrom, lt)
        pos = textFrom = lt + 3
      } else {
        // "</" before anything else: a comment up to ">".
        emitText(textFrom, lt)
        const gt = text.indexOf('>', lt + 2)
        if (gt < 0) return
        pos = textFrom = gt + 1
      }
      continue
    }
    if (c === '!') {
      emitText(textFrom, lt)
      if (text.startsWith('<!--', lt)) {
        const j = lt + 4
        let end: number
        if (text[j] === '>') end = j + 1
        else if (text.startsWith('->', j)) end = j + 2
        else {
          const a = text.indexOf('-->', j)
          const b = text.indexOf('--!>', j)
          if (a < 0 && b < 0) return
          end = b >= 0 && (a < 0 || b < a) ? b + 4 : a + 3
        }
        pos = textFrom = end
      } else {
        if (text.startsWith('<![CDATA[', lt) && (svg > 0 || unsure)) return
        const gt = text.indexOf('>', lt + 2)
        if (gt < 0) return
        pos = textFrom = gt + 1
      }
      continue
    }
    if (c === '?') {
      emitText(textFrom, lt)
      const gt = text.indexOf('>', lt + 2)
      if (gt < 0) return
      pos = textFrom = gt + 1
      continue
    }
    // A "<" that starts nothing: text.
    pos = lt + 1
  }
  emitText(textFrom, n)
}
