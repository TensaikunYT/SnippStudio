// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode (EKIP-PLAN.md; YOL-HARITASI.md part 3, steps 1 and 2): the
// subagents of one agent program call through ONE session; each call may
// carry a short worker label, `as`. The page takes the label off the call
// before the tool runs (the tool never sees it: an analysis asked twice is
// the same question), keeps it on the call's event and on the draft's entry,
// and the interface shows the workers one by one. Nothing of it reaches the
// agent. Pure.
import type { ToolEvent } from './store'

/** At most this many characters (letters of any language, digits, '-'). */
export const LABEL_MAX = 12

/** A label as given, cleaned: other characters go, 12 at most; empty: none.
 *  (Never an error: a mistyped label must not cost the agent its call.) */
export function cleanLabel(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.normalize('NFC').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, LABEL_MAX)
  return s || undefined
}

/** The call's arguments without the label, and the label. With no `as`, the
 *  very same object comes back (the call runs exactly as before). */
export function takeLabel(args: Record<string, unknown>): { as?: string; args: Record<string, unknown> } {
  if (!Object.hasOwn(args, 'as')) return { args }
  const rest = { ...args }
  delete rest.as
  const as = cleanLabel(args.as)
  return as ? { as, args: rest } : { args: rest }
}

/** The workers of `order` (labels in the order first seen) with the new one. */
export const withWorker = (order: readonly string[], as: string | undefined): string[] => (!as || order.includes(as) ? [...order] : [...order, as].slice(-64))

/** The labelled workers of a run of calls, in the order of `order` (the
 *  colours' order); empty: no team (the interface is the single agent's). */
export function workersOf(events: readonly Pick<ToolEvent, 'as'>[], order: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const e of events) if (e.as) seen.add(e.as)
  const known = order.filter((w) => seen.has(w))
  return [...known, ...[...seen].filter((w) => !known.includes(w))]
}

/** The latest call of each worker ('' for the unlabelled ones), oldest first. */
export function lastByWorker<E extends Pick<ToolEvent, 'as'>>(events: readonly E[]): Map<string, E[]> {
  const out = new Map<string, E[]>()
  for (const e of events) {
    const k = e.as ?? ''
    out.set(k, [...(out.get(k) ?? []), e])
  }
  return out
}

// ---- the flags on the ruler, one per worker ---------------------------------

export interface FlagIn {
  key: string
  /** Its left edge (px) and its width (px). */
  x: number
  w: number
}

export interface FlagOut extends FlagIn {
  row: 0 | 1
}

export interface FlagMore {
  /** Where "+N" stands (px), on the second row; the flags it stands for. */
  x: number
  keys: string[]
}

/** A flag's width as drawn: the icon, the gap, the name at 11 px. */
export const flagWidth = (name: string): number => 26 + Math.ceil(name.length * 6.6)

/** Flags that would overlap go to a second row; what fits on neither is
 *  counted as "+N" right of the second-row flag in its way. */
export function placeFlags(flags: readonly FlagIn[], gap = 4): { placed: FlagOut[]; more: FlagMore[] } {
  const sorted = [...flags].sort((a, b) => a.x - b.x || a.key.localeCompare(b.key))
  const ends: number[] = [-Infinity, -Infinity]
  const lastOf: (FlagOut | null)[] = [null, null]
  const placed: FlagOut[] = []
  const more: FlagMore[] = []
  for (const f of sorted) {
    const row = f.x >= ends[0] + gap ? 0 : f.x >= ends[1] + gap ? 1 : -1
    if (row >= 0) {
      const p: FlagOut = { ...f, row: row as 0 | 1 }
      placed.push(p)
      ends[row] = f.x + f.w
      lastOf[row] = p
      continue
    }
    const by = lastOf[1]
    const at = by ? by.x + by.w + 2 : f.x
    const m = more.find((x) => x.x === at)
    if (m) m.keys.push(f.key)
    else more.push({ x: at, keys: [f.key] })
  }
  return { placed, more }
}

// ---- tokens per worker ---------------------------------------------------------

/** The answers' tokens of a job's finished calls, per worker ('' for the
 *  unlabelled), largest first. Their sum is the card's text + frames. */
export function tokensByWorker(events: readonly Pick<ToolEvent, 'as' | 'tokens' | 'done'>[]): { as: string; tokens: number }[] {
  const by = new Map<string, number>()
  for (const e of events) {
    if (!e.done) continue
    by.set(e.as ?? '', (by.get(e.as ?? '') ?? 0) + (e.tokens ?? 0))
  }
  return [...by].map(([as, tokens]) => ({ as, tokens })).sort((a, b) => b.tokens - a.tokens || a.as.localeCompare(b.as))
}

/** Rounded rows whose sum is exactly `total` (largest remainder). */
export function roundedTo(values: readonly number[], total: number): number[] {
  const floor = values.map((v) => Math.floor(v))
  let left = total - floor.reduce((a, b) => a + b, 0)
  const order = values.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
  const out = [...floor]
  for (const [, i] of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  if (left < 0 && out.length) out[0] += left
  return out
}

// ---- a draft's groups --------------------------------------------------------

export interface Group {
  /** The worker ('' for the unlabelled ops). */
  as: string
  keys: string[]
}

/** The groups of a draft's items, in the colours' order. */
export function groupsOf(items: readonly { key: string; as?: string }[], order: readonly string[]): Group[] {
  const by = new Map<string, string[]>()
  for (const i of items) by.set(i.as ?? '', [...(by.get(i.as ?? '') ?? []), i.key])
  const rank = (as: string): number => (as === '' ? -1 : order.indexOf(as) < 0 ? 1e6 : order.indexOf(as))
  return [...by].map(([as, keys]) => ({ as, keys })).sort((a, b) => rank(a.as) - rank(b.as))
}
