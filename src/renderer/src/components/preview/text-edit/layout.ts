// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where a title's letters are (SnippStudio YAZI2-PLAN.md, D1 and D6): the
// static layout of the drawing engine (playback/draw/captions.ts: paragraphs
// at line breaks, each wrapped by `maxLineChars`, lines centred on the block
// or set to its left or right, the whole shrunk to `fitWidth`) worked out
// again here with one thing more: for every place the caret can be in the
// SOURCE text, where that is in the drawn block. The caret, the selection and
// a click's letter are then drawn and found exactly where the engine draws
// the letters, with no text box laid over the picture.
//
// Pure: text comes in, numbers go out; the font is measured through `measure`.
// Everything is in frame pixels round the block's middle (x right, y down),
// before the title's own scale and turn.

/** What of a title's style its layout depends on. */
export interface TextSpec {
  text: string
  uppercase: boolean
  /** The engine's wrap: a line takes words while it is no longer than this. */
  maxLineChars: number
  align: 'left' | 'center' | 'right'
  /** Frame pixels (the style's size at this frame's height). */
  fontSize: number
  /** Line height as a multiple of the size. */
  lineHeight: number
  /** The widest a line may be, frame pixels (0: no limit): the size shrinks to it. */
  fitWidth: number
  /** The smallest size `fitWidth` shrinks to (the engine's 8 px at 1080). */
  minFontSize: number
}

/** The width of `text` set at `fontSize`. */
export type Measure = (text: string, fontSize: number) => number

export interface LaidLine {
  /** As drawn (upper case when the style says so, one space between words). */
  text: string
  width: number
  /** Its left edge and its middle line, from the block's middle. */
  left: number
  y: number
  /** The source places it holds: `from` … `from + xs.length - 1`. */
  from: number
  /** For each of them, the caret's x from the line's left edge. */
  xs: number[]
}

export interface TextLayout {
  lines: LaidLine[]
  /** The block: its widest line and all its lines. */
  width: number
  height: number
  /** The size it is drawn at (after `fitWidth`) and one line's height. */
  fontSize: number
  lineHeight: number
}

interface Word {
  /** In the source: [s, e). */
  s: number
  e: number
  src: string
  /** As drawn. */
  up: string
}

interface RawLine {
  words: Word[]
  from: number
  to: number
}

/** The engine's wrap (wrapCaption), keeping where each word came from. */
function rawLines(text: string, uppercase: boolean, maxChars: number): RawLine[] {
  const out: RawLine[] = []
  let p0 = 0
  for (const para of text.split('\n')) {
    const p1 = p0 + para.length
    const words: Word[] = []
    for (const m of para.matchAll(/\S+/gu)) {
      const s = p0 + (m.index ?? 0)
      words.push({ s, e: s + m[0].length, src: m[0], up: uppercase ? m[0].toUpperCase() : m[0] })
    }
    if (words.length === 0) out.push({ words: [], from: p0, to: p1 })
    else {
      const groups: Word[][] = []
      let line: Word[] = []
      let chars = 0
      for (const w of words) {
        if (line.length > 0 && chars + 1 + w.up.length > maxChars) {
          groups.push(line)
          line = [w]
          chars = w.up.length
        } else {
          chars = line.length > 0 ? chars + 1 + w.up.length : w.up.length
          line.push(w)
        }
      }
      groups.push(line)
      groups.forEach((g, i) => {
        // A line holds its words, the blanks before its first word (the
        // paragraph's own) and the blanks after its last one, but for the
        // place just before the next line's first word.
        const from = i === 0 ? p0 : g[0].s
        const to = i === groups.length - 1 ? p1 : groups[i + 1][0].s - 1
        out.push({ words: g, from, to })
      })
    }
    p0 = p1 + 1
  }
  return out
}

const drawn = (l: RawLine): string => l.words.map((w) => w.up).join(' ')

/** The lines as the engine draws them (for a width, without the carets). */
export function wrapLines(text: string, uppercase: boolean, maxChars: number): string[] {
  return rawLines(text, uppercase, maxChars).map(drawn)
}

/** The drawn column of place `i` inside word `w` (upper case may be longer:
 *  "ß" is drawn "SS"). */
function colInWord(w: Word, i: number): number {
  if (w.up === w.src) return i
  let col = 0
  let at = 0
  for (const ch of w.src) {
    if (at >= i) break
    col += ch.toUpperCase().length
    at += ch.length
  }
  return col
}

export function layoutText(spec: TextSpec, measure: Measure): TextLayout {
  const raw = rawLines(spec.text, spec.uppercase, spec.maxLineChars)
  const texts = raw.map(drawn)
  let size = spec.fontSize
  if (spec.fitWidth > 0) {
    const widest = Math.max(1, ...texts.map((t) => measure(t, size)))
    if (widest > spec.fitWidth) size = Math.max(spec.minFontSize, size * (spec.fitWidth / widest))
  }
  const lh = size * spec.lineHeight
  const widths = texts.map((t) => measure(t, size))
  const blockW = Math.max(1, ...widths)
  const space = measure(' ', size)
  const top = -(raw.length * lh) / 2 + lh / 2
  const lines = raw.map((l, k): LaidLine => {
    const text = texts[k]
    const width = widths[k]
    const left = spec.align === 'left' ? -blockW / 2 : spec.align === 'right' ? blockW / 2 - width : -width / 2
    // The caret's x after each drawn column, measured as the engine sets the
    // line: the width of what stands before it.
    const at: number[] = [0]
    for (let c = 1; c <= text.length; c++) at.push(measure(text.slice(0, c), size))
    const xs: number[] = []
    let col0 = 0
    let wi = 0
    for (let i = l.from; i <= l.to; i++) {
      // The word this place is in or just before.
      while (wi < l.words.length && i > l.words[wi].e) {
        col0 += l.words[wi].up.length + 1
        wi++
      }
      if (wi >= l.words.length) {
        // After the line's last word: a blank typed there shows as a step.
        xs.push(l.words.length ? width + space : 0)
        continue
      }
      const w = l.words[wi]
      if (i <= w.s) xs.push(wi === 0 ? 0 : at[Math.min(text.length, col0)])
      else xs.push(at[Math.min(text.length, col0 + colInWord(w, i - w.s))])
    }
    return { text, width, left, y: top + k * lh, from: l.from, xs }
  })
  return { lines, width: blockW, height: Math.max(lh, raw.length * lh), fontSize: size, lineHeight: lh }
}

/** The line a source place is on. */
export function lineOf(layout: TextLayout, index: number): number {
  const { lines } = layout
  for (let k = 0; k < lines.length; k++) if (index <= lines[k].from + lines[k].xs.length - 1) return k
  return lines.length - 1
}

/** The caret at a source place: its line, its x and its line's middle. */
export function caretAt(layout: TextLayout, index: number): { line: number; x: number; y: number } {
  const k = lineOf(layout, index)
  const l = layout.lines[k]
  const i = Math.min(l.xs.length - 1, Math.max(0, index - l.from))
  return { line: k, x: l.left + l.xs[i], y: l.y }
}

/** The source place nearest to x on a line. */
function indexOnLine(l: LaidLine, x: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < l.xs.length; i++) {
    const d = Math.abs(l.left + l.xs[i] - x)
    // The first of several places at one x (a run of blanks): where the
    // caret would be seen.
    if (d < bd - 1e-6) {
      bd = d
      best = i
    }
  }
  return l.from + best
}

/** The source place a point of the block is nearest to. */
export function indexAt(layout: TextLayout, x: number, y: number): number {
  const top = layout.lines[0].y - layout.lineHeight / 2
  const k = Math.min(layout.lines.length - 1, Math.max(0, Math.floor((y - top) / layout.lineHeight)))
  return indexOnLine(layout.lines[k], x)
}

/** The caret a line up or down (dir −1 / 1), keeping to `wantX` (where the
 *  run of moves began); at the first line up goes to the start, at the last
 *  down goes to the end. */
export function moveVertical(layout: TextLayout, index: number, dir: -1 | 1, wantX?: number): { index: number; x: number } {
  const c = caretAt(layout, index)
  const x = wantX ?? c.x
  const k = c.line + dir
  if (k < 0) return { index: layout.lines[0].from, x }
  if (k >= layout.lines.length) {
    const last = layout.lines[layout.lines.length - 1]
    return { index: last.from + last.xs.length - 1, x }
  }
  return { index: indexOnLine(layout.lines[k], x), x }
}

/** The start or the end of the line a place is on. */
export function lineEdge(layout: TextLayout, index: number, edge: 'start' | 'end'): number {
  const l = layout.lines[lineOf(layout, index)]
  return edge === 'start' ? l.from : l.from + l.xs.length - 1
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The selection a … b as one box per line it touches. */
export function selectionRects(layout: TextLayout, a: number, b: number): Rect[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (lo === hi) return []
  const out: Rect[] = []
  const first = lineOf(layout, lo)
  const last = lineOf(layout, hi)
  for (let k = first; k <= last; k++) {
    const l = layout.lines[k]
    const end = l.from + l.xs.length - 1
    const x0 = k === first ? l.left + l.xs[Math.max(0, lo - l.from)] : l.left
    // A line the selection runs past is painted to its end, and a little
    // further when it is empty (so a selected empty line shows).
    const x1 = k === last ? l.left + l.xs[Math.min(l.xs.length - 1, Math.max(0, hi - l.from))] : Math.max(l.left + l.width, l.left + l.xs[end - l.from])
    const w = Math.max(k === last ? 0 : layout.fontSize * 0.25, x1 - x0)
    if (w > 0) out.push({ x: x0, y: l.y - layout.lineHeight / 2, w, h: layout.lineHeight })
  }
  return out
}

/** The word at a source place (a double-click's selection): [start, end). */
export function wordAt(text: string, index: number): [number, number] {
  const i = Math.min(text.length, Math.max(0, index))
  const blank = (ch: string | undefined): boolean => ch === undefined || /\s/u.test(ch)
  // On a blank: the word before it, if there is one.
  let p = i
  if (blank(text[p]) && p > 0 && !blank(text[p - 1])) p--
  if (blank(text[p])) return [i, i]
  let s = p
  let e = p
  while (s > 0 && !blank(text[s - 1])) s--
  while (e < text.length && !blank(text[e])) e++
  return [s, e]
}

/** The smallest and the largest wrap a width drag sets (the range the
 *  style's own field has). */
export const WRAP_MIN = 5
export const WRAP_MAX = 200

/** For every wrap from WRAP_MIN to WRAP_MAX: how wide the block is then
 *  (frame pixels at the style's size; `fitWidth` left out: it shrinks the
 *  size, not the wrap). Index 0 is WRAP_MIN. */
export function wrapWidths(spec: Pick<TextSpec, 'text' | 'uppercase' | 'fontSize'>, measure: Measure): number[] {
  const out: number[] = []
  const seen = new Map<string, number>()
  const width = (line: string): number => {
    let w = seen.get(line)
    if (w === undefined) {
      w = measure(line, spec.fontSize)
      seen.set(line, w)
    }
    return w
  }
  let done: number | null = null
  for (let n = WRAP_MIN; n <= WRAP_MAX; n++) {
    if (done !== null) {
      out.push(done)
      continue
    }
    const lines = wrapLines(spec.text, spec.uppercase, n)
    out.push(Math.max(1, ...lines.map(width)))
    // Every paragraph on one line: a wider wrap changes nothing more.
    if (lines.every((l) => l.length <= n) && lines.length === spec.text.split('\n').length) done = out[out.length - 1]
  }
  return out
}

/** The wrap for a block `target` wide: the largest whose block still fits;
 *  when none does (a word alone is wider), the largest among the narrowest. */
export function wrapForWidth(widths: number[], target: number): number {
  const narrowest = Math.min(...widths)
  const limit = Math.max(target, narrowest) + 0.5
  let best = 0
  for (let i = 0; i < widths.length; i++) if (widths[i] <= limit) best = i
  return WRAP_MIN + best
}
