// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A draft as the review strip goes through it (D22, worker C;
// YOL-HARITASI.md, part 4): one item per op the draft applies — a move of
// several clips is one item, a cut of several ranges is one — each with what
// it does (agent/draft-words.ts, from the project the op met and the one it
// left) and the ranges it cuts in live seconds. The strip says an item's
// sentence, the timeline draws its marks (agent/marks.ts), and the user
// accepts or rejects it by itself (drafts.ts). Pure.
import type { Project } from '../types'
import { draftChanges, type DraftChange } from './draft-words'
import { MARK_OF, MARK_OF_CHANGE, type MarkKind } from './marks'

export interface ReviewItem {
  /** The op: its call and its place in the call. */
  seq: number
  index: number
  /** "seq:index". */
  key: string
  /** The worker that wrote it (EKIP-PLAN.md: its group). */
  as?: string
  /** The command it is. */
  command: string
  /** What it does, in the seconds of the project it met. */
  changes: DraftChange[]
  /** The ranges it cuts, in LIVE seconds. */
  cuts?: [number, number][]
  /** A cut of two ranges or more: each as the agent wrote it (seconds of the
   *  version it read), in the order sent — the user may take one out
   *  (drafts.ts removeRange). */
  ranges?: [number, number][]
  /** The marks it leaves (the usual one of its command first). */
  kinds: MarkKind[]
}

export interface TraceStep {
  seq: number
  index: number
  before: Project
  after: Project
}

/** The marks an item leaves: those of its changes; of its command when the
 *  difference shows nothing the timeline can mark. */
export function kindsOf(command: string, changes: readonly DraftChange[]): MarkKind[] {
  const seen = [...new Set(changes.filter((c) => c.kind !== 'lines').map((c) => MARK_OF_CHANGE[c.kind]))]
  const usual = MARK_OF[command] ?? []
  const first = usual.find((k) => seen.includes(k))
  return first ? [first, ...seen.filter((k) => k !== first)] : seen.length ? seen : [...usual.slice(0, 1)]
}

/** One item of an applied op. `cuts`: what it cut in the seconds of the
 *  project it met; `liveCuts`: the same ranges in live seconds. */
export function itemOf(step: TraceStep, command: string, cuts: readonly [number, number][] = [], liveCuts?: readonly [number, number][]): ReviewItem {
  let changes: DraftChange[] = []
  try {
    changes = draftChanges(step.before, step.after, cuts)
  } catch {
    /* an item without words still has its command's mark */
  }
  return { seq: step.seq, index: step.index, key: `${step.seq}:${step.index}`, command, changes, ...(liveCuts?.length ? { cuts: liveCuts.map(([a, b]): [number, number] => [a, b]) } : {}), kinds: kindsOf(command, changes) }
}
