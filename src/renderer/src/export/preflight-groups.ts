// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export check's findings as the export window shows them (DENEME-4,
// worker W): one calm line ("21 warnings · 18 sudden loud peaks · 3 other")
// and, opened, a list grouped by kind. Pure: export/preflight.ts finds them,
// components/Preflight.tsx draws them.
import type { PreflightIssue, PreflightKind } from './preflight'

export interface PreflightGroup {
  kind: PreflightKind
  items: PreflightIssue[]
}

/** The kinds' order when their counts are equal: what breaks the film first. */
const RANK: Record<PreflightKind, number> = { missing: 0, gap: 1, still: 2, repeat: 3, loud: 4 }

/** The findings by kind, the biggest group first; each group in time order. */
export function groupIssues(issues: readonly PreflightIssue[]): PreflightGroup[] {
  const by = new Map<PreflightKind, PreflightIssue[]>()
  for (const it of issues) {
    const list = by.get(it.kind)
    if (list) list.push(it)
    else by.set(it.kind, [it])
  }
  return [...by.entries()]
    .map(([kind, items]) => ({ kind, items: [...items].sort((a, b) => a.at - b.at) }))
    .sort((a, b) => b.items.length - a.items.length || RANK[a.kind] - RANK[b.kind])
}

/** The one line: the total, the biggest kind, and how many others. */
export function summaryOf(groups: readonly PreflightGroup[]): { total: number; top: { kind: PreflightKind; n: number } | null; other: number } {
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const top = groups[0] ? { kind: groups[0].kind, n: groups[0].items.length } : null
  return { total, top, other: total - (top?.n ?? 0) }
}

/** A kind whose findings are only a moment (the loud peaks): shown as times,
 *  each a way there, not as a row of words each. */
export function shownAsTimes(kind: PreflightKind): boolean {
  return kind === 'loud'
}
