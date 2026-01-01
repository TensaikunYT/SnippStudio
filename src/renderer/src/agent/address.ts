// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// An edit's fields, walked by the command's own schema (SnippStudio phase 4A,
// ANA-PLAN.md §2 rule 4: lasting addresses). Pure.
//
// - Word addresses: where the schema says "a time", the agent may write
//   "<line id>#i" (the start of word i of that subtitle line) or "#i>" (its
//   end); where it says "a range", "<line id>#i-j" (words i to j), "<line id>#i"
//   (one word) or "<line id>" (the whole line), or a pair of word times. They
//   become seconds here, on the project the edit is applied to.
//   Phase 4A.9: on the project the agent READ (its `base`): a word number
//   means the word it was in that version.
import type { Caption, Project } from '../types'
import type { Schema } from '../commands'

type Walk = (x: Schema<unknown>, v: unknown, path: string) => unknown

/** Rebuilds `value` by the schema, giving `leaf` every time, range and id. */
function walk(schema: Schema<unknown>, value: unknown, leaf: Walk, path = ''): unknown {
  const m = schema.meta
  if (value === undefined || value === null) return value
  if (m?.kind) return leaf(schema, value, path)
  if (m?.inner) return walk(m.inner, value, leaf, path)
  if (m?.shape && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sub = m.shape[k]
      const r = sub ? walk(sub, v, leaf, path ? `${path}.${k}` : k) : v
      if (r !== DROP) out[k] = r
    }
    return out
  }
  if (m?.item && Array.isArray(value)) {
    const out: unknown[] = []
    value.forEach((v, i) => {
      const r = walk(m.item!, v, leaf, `${path}[${i}]`)
      if (r !== DROP) out.push(r)
    })
    return out
  }
  if (m?.values && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(m.values, v, leaf, `${path}.${k}`)
    return out
  }
  return value
}

/** Returned by a leaf to drop a list item (a range cut away). */
const DROP = Symbol('drop')

// ---- word addresses ---------------------------------------------------------

const TIME_RE = /^(.+?)#(\d+)(>)?$/
const RANGE_RE = /^(.+?)#(\d+)-(\d+)$/

function wordOf(p: Project, id: string, i: number, where: string): { start: number; end: number } {
  const c: Caption | undefined = p.captions.find((x) => x.id === id)
  if (!c) throw new Error(`${where}: there is no subtitle line "${id}"`)
  const w = c.words?.[i]
  if (!c.words?.length) throw new Error(`${where}: line "${id}" has no word times; use seconds`)
  if (!w) throw new Error(`${where}: line "${id}" has words 0–${c.words.length - 1}, not ${i}`)
  return w
}

/** A time that was given by a word: where in the call, which word, and
 *  whether its start or its end. */
export interface WordTime {
  path: string
  line: string
  i: number
  end: boolean
}
type Seen = (w: WordTime) => void

function timeOf(p: Project, v: unknown, where: string, seen?: Seen): unknown {
  if (typeof v !== 'string') return v
  const m = TIME_RE.exec(v.trim())
  if (!m) throw new Error(`${where}: "${v}" is not a time (seconds, or "<line id>#i" / "#i>")`)
  const w = wordOf(p, m[1], Number(m[2]), where)
  seen?.({ path: where, line: m[1], i: Number(m[2]), end: !!m[3] })
  return m[3] ? w.end : w.start
}

function rangeOf(p: Project, v: unknown, where: string, seen?: Seen): unknown {
  if (Array.isArray(v)) {
    if (v.length !== 2) return v
    const a = typeof v[0] === 'string' ? timeOf(p, v[0], `${where}[0]`, seen) : v[0]
    // An end given as a word means the word's end unless it says otherwise.
    const plain = typeof v[1] === 'string' && !/[>]$/.test(v[1]) && TIME_RE.test(v[1].trim()) ? TIME_RE.exec(v[1].trim())! : null
    if (plain) seen?.({ path: `${where}[1]`, line: plain[1], i: Number(plain[2]), end: true })
    const b = plain ? wordOf(p, plain[1], Number(plain[2]), where).end : typeof v[1] === 'string' ? timeOf(p, v[1], `${where}[1]`, seen) : v[1]
    return [a, b]
  }
  if (typeof v !== 'string') return v
  const s = v.trim()
  const r = RANGE_RE.exec(s)
  if (r) {
    const a = wordOf(p, r[1], Number(r[2]), where)
    const b = wordOf(p, r[1], Number(r[3]), where)
    if (a.start <= b.start) {
      seen?.({ path: `${where}[0]`, line: r[1], i: Number(r[2]), end: false })
      seen?.({ path: `${where}[1]`, line: r[1], i: Number(r[3]), end: true })
    }
    return [Math.min(a.start, b.start), Math.max(a.end, b.end)]
  }
  const one = /^(.+?)#(\d+)$/.exec(s)
  if (one) {
    const w = wordOf(p, one[1], Number(one[2]), where)
    seen?.({ path: `${where}[0]`, line: one[1], i: Number(one[2]), end: false })
    seen?.({ path: `${where}[1]`, line: one[1], i: Number(one[2]), end: true })
    return [w.start, w.end]
  }
  const line = p.captions.find((c) => c.id === s)
  if (line) return [line.start, line.end]
  throw new Error(`${where}: "${v}" is not a range ([start, end], "<line id>#i-j" or "<line id>")`)
}

/** The call's word addresses as seconds on `project`. Throws with the field's path. */
export function resolveAddresses(schema: Schema<unknown>, params: unknown, project: Project, seen?: Seen): unknown {
  return walk(schema, params, (x, v, path) => {
    if (x.meta?.kind === 'time') return timeOf(project, v, path, seen)
    if (x.meta?.kind === 'range') return rangeOf(project, v, path, seen)
    return v
  })
}

/** How many times a call carries (a range: two). */
export function countTimes(schema: Schema<unknown>, params: unknown): number {
  let n = 0
  walk(schema, params, (x, v) => {
    if (x.meta?.kind === 'time') n++
    else if (x.meta?.kind === 'range') n += 2
    return v
  })
  return n
}

/** `params` with the value at `path` ("a.b[2].c[0]") set (a copy). */
export function setAt(params: unknown, path: string, value: unknown): unknown {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  const go = (node: unknown, i: number): unknown => {
    if (i === keys.length) return value
    const k = keys[i]
    if (Array.isArray(node)) return node.map((x, n) => (String(n) === k ? go(x, i + 1) : x))
    const o = (node ?? {}) as Record<string, unknown>
    return { ...o, [k]: go(o[k], i + 1) }
  }
  return go(params, 0)
}

/** Does the call carry any time or range? */
export function hasTimes(schema: Schema<unknown>, params: unknown): boolean {
  let found = false
  walk(schema, params, (x, v) => {
    if (x.meta?.kind === 'time' || x.meta?.kind === 'range') found = true
    return v
  })
  return found
}

/** The record ids a call names (`skip`: fields left out, by their path). */
export function idsIn(schema: Schema<unknown>, params: unknown, skip?: (path: string) => boolean): string[] {
  const out: string[] = []
  walk(schema, params, (x, v, path) => {
    if (x.meta?.kind === 'id' && typeof v === 'string' && !skip?.(path)) out.push(v)
    return v
  })
  return out
}

/** The call with every id it names put through `fn`. */
export function mapIds(schema: Schema<unknown>, params: unknown, fn: (id: string) => string): unknown {
  return walk(schema, params, (x, v) => (x.meta?.kind === 'id' && typeof v === 'string' ? fn(v) : v))
}

/** A media item or a track named by id is the same thing in every version
 *  of a project (it does not move, and it is not cut in two): such an id
 *  does not tie an op to the version it was read in (phase 4A.10, C2). */
export const lastingId = (path: string): boolean => /(^|\.)(assetId|trackId)$|(^|\.)assetIds\[\d+\]$/.test(path)

/** Every time a call carries, in order (a range: its two). */
export function timesIn(schema: Schema<unknown>, params: unknown): unknown[] {
  const out: unknown[] = []
  walk(schema, params, (x, v) => {
    if (x.meta?.kind === 'time') out.push(v)
    else if (x.meta?.kind === 'range') out.push(...(Array.isArray(v) ? v : [v]))
    return v
  })
  return out
}

/** The call with every time it carries (seconds) put through `fn`. */
export function mapTimes(schema: Schema<unknown>, params: unknown, fn: (t: number) => number): unknown {
  const at = (v: unknown): unknown => (typeof v === 'number' ? fn(v) : v)
  return walk(schema, params, (x, v) => (x.meta?.kind === 'time' ? at(v) : x.meta?.kind === 'range' && Array.isArray(v) ? v.map(at) : v))
}
