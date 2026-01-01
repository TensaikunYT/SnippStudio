// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's changes (CodeEdit) against what a scan found (Slot): which
// change lands on which place, which no longer has a place, and a file's
// text with its changes written in.
//
// A change is written ONLY at a place the scanner itself found in the file
// as it is now, as the kind of value the scanner says stands there. What a
// project file says about where and how (it may come from anywhere) is used
// to choose among those places, never to write.
import { EDITS_MAX, ORIG_MAX, VALUE_MAX, type CodeEdit, type Slot, type ValueKind } from './types'
import { cleanValue, emit } from './values'

const KINDS: readonly ValueKind[] = ['color', 'text', 'font', 'time']

/** What groups places together, and names a change of all of them: the
 *  value they hold (a font's name whatever its capitals). */
export function groupKey(kind: ValueKind, value: string): string {
  return kind === 'font' ? value.toLowerCase() : value
}

/** A change's name in the list (one per place, one per group). */
export function editId(e: CodeEdit): string {
  return e.file === undefined ? `g|${e.kind}|${e.orig}` : `s|${e.kind}|${e.file}|${e.pos}|${e.orig}`
}

/** One change as it may be kept, or null (unknown kind, a value that is not
 *  one of its kind, strings too long, a path that is not a plain one). */
export function cleanEdit(x: unknown): CodeEdit | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const kind = KINDS.find((k) => k === o.kind)
  if (!kind || typeof o.orig !== 'string' || o.orig.length > ORIG_MAX) return null
  const value = cleanValue(kind, o.value)
  if (value === null || value.length > VALUE_MAX) return null
  if (o.file === undefined || o.file === null) return { kind, orig: o.orig, value }
  if (typeof o.file !== 'string' || o.file.length > 400 || !/^[^\\:*?"<>|\0]+$/.test(o.file) || o.file.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null)
  const pos = int(o.pos)
  if (pos === null) return null
  const n = int(o.n) ?? 0
  const of = int(o.of) ?? 1
  return { kind, orig: o.orig, value, file: o.file, pos, n, of }
}

/** A list of changes as it may be kept: each clean, one per name (the last
 *  said wins), at most EDITS_MAX. */
export function cleanEdits(raw: unknown): CodeEdit[] {
  if (!Array.isArray(raw)) return []
  const by = new Map<string, CodeEdit>()
  for (const x of raw) {
    const e = cleanEdit(x)
    if (!e) continue
    const id = editId(e)
    by.delete(id)
    by.set(id, e)
  }
  return [...by.values()].slice(0, EDITS_MAX)
}

/** A short name for a list of changes (the page's address carries it, so a
 *  page loaded with other changes is another page). '' for none. */
export function editsKey(edits: readonly CodeEdit[] | undefined): string {
  if (!edits || !edits.length) return ''
  const s = JSON.stringify(edits.map((e) => [e.kind, e.orig, e.value, e.file ?? null, e.pos ?? null, e.n ?? null, e.of ?? null]))
  // (cyrb53: two 32-bit halves.)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + edits.length.toString(36)
}

export const isEditsKey = (k: unknown): k is string => typeof k === 'string' && /^[a-z0-9]{1,24}$/.test(k)

/** What became of one change. */
export interface EditState {
  /** How many places it is written at. */
  hits: number
  /** It names a place (or a value) the page holds, but its value cannot be
   *  written at some of them (a font name that needs quotes where none are free…). */
  refused: number
}

export interface Resolved {
  /** Per slot (same order): the change written there and its text, or null. */
  writes: ({ edit: number; text: string } | null)[]
  /** Per change (same order). `hits === 0 && refused === 0`: no longer in the page. */
  states: EditState[]
}

/**
 * Which change lands where. `slots`: the places of the files scanned (any
 * number of files); `edits`: the project's list. For each place, in order:
 * the change of that very place (same file, same start, same text); else a
 * change of that file whose place moved (the file was rewritten): the n-th
 * of the places with its text, when there are still as many as there were;
 * else the change of every place holding its value.
 */
export function resolveEdits(slots: readonly Slot[], edits: readonly CodeEdit[]): Resolved {
  const states: EditState[] = edits.map(() => ({ hits: 0, refused: 0 }))
  const writes: Resolved['writes'] = slots.map(() => null)
  if (!edits.length) return { writes, states }
  const exact = new Map<string, number>()
  const moved = new Map<string, number[]>()
  const group = new Map<string, number>()
  edits.forEach((e, i) => {
    if (e.file === undefined) group.set(`${e.kind}|${e.orig}`, i)
    else {
      exact.set(`${e.kind}|${e.file}|${e.pos}|${e.orig}`, i)
      const k = `${e.kind}|${e.file}|${e.orig}`
      const l = moved.get(k)
      if (l) l.push(i)
      else moved.set(k, [i])
    }
  })
  // The places of each (kind, file, text), in file order: for the moved ones.
  const same = new Map<string, number[]>()
  if (moved.size)
    slots.forEach((s, i) => {
      const k = `${s.kind}|${s.file}|${s.raw}`
      if (!moved.has(k)) return
      const l = same.get(k)
      if (l) l.push(i)
      else same.set(k, [i])
    })
  const take = (si: number, ei: number): void => {
    const text = emit(slots[si], edits[ei].value)
    if (text === null) states[ei].refused++
    else {
      writes[si] = { edit: ei, text }
      states[ei].hits++
    }
  }
  const taken = new Set<number>()
  // 1. the very place
  slots.forEach((s, si) => {
    const ei = exact.get(`${s.kind}|${s.file}|${s.at}|${s.raw}`)
    if (ei === undefined) return
    taken.add(ei)
    take(si, ei)
  })
  // 2. a place that moved
  for (const [k, list] of moved) {
    const places = same.get(k)
    if (!places) continue
    for (const ei of list) {
      if (taken.has(ei)) continue
      const e = edits[ei]
      if (places.length !== (e.of ?? 1)) continue
      const si = places[e.n ?? 0]
      if (si === undefined || writes[si] || slots[si].at === e.pos) continue
      take(si, ei)
    }
  }
  // 3. every place holding the value
  if (group.size)
    slots.forEach((s, si) => {
      if (writes[si]) return
      const ei = group.get(`${s.kind}|${groupKey(s.kind, s.value)}`)
      // (A place whose own change was refused keeps the page's value.)
      if (ei !== undefined && !slotHasOwn(s, exact)) take(si, ei)
    })
  return { writes, states }
}

const slotHasOwn = (s: Slot, exact: Map<string, number>): boolean => exact.has(`${s.kind}|${s.file}|${s.at}|${s.raw}`)

/** A file's text with the changes written in (`slots`: that file's places,
 *  `writes`: resolveEdits' answer for them). The same string when none. */
export function patchText(text: string, slots: readonly Slot[], writes: Resolved['writes']): string {
  const todo: { at: number; end: number; text: string }[] = []
  slots.forEach((s, i) => {
    const w = writes[i]
    // (The file's own text must be there: a scan of another text writes nothing.)
    if (w && text.slice(s.at, s.end) === s.raw) todo.push({ at: s.at, end: s.end, text: w.text })
  })
  if (!todo.length) return text
  todo.sort((a, b) => a.at - b.at)
  let out = ''
  let from = 0
  for (const t of todo) {
    // (Places never overlap; one that would is skipped.)
    if (t.at < from) continue
    out += text.slice(from, t.at) + t.text
    from = t.end
  }
  return out + text.slice(from)
}
