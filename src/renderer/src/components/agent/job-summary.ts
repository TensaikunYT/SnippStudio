// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What an agent's job changed, for the card under the bar's "Done"
// (KOLAY-PLAN.md, item 4; YOL-HARITASI.md §9, "Oturum özeti"). Nothing new is
// counted here: the changes are the review's own sentences
// (agent/draft-words.ts draftChanges: the project as the job's first call
// found it against the project now), grouped by their kind; the length is
// projectDuration of each; the tokens are the bar's. Pure but for the one
// record of the project at each call's start (below).
import { draftChanges, type ChangeKind, type DraftChange } from '../../agent/draft-words'
import { useAgentStore } from '../../agent/store'
import { useStore } from '../../state/store'
import { projectDuration, type Project } from '../../types'

export type SummaryGroup = 'cut' | 'move' | 'add' | 'remove' | 'set'

/** Each kind of change the sentences know, in the card's five groups. */
export const GROUP_OF: Readonly<Record<ChangeKind, SummaryGroup>> = {
  cut: 'cut', gap: 'cut', split: 'cut', trim: 'cut',
  move: 'move', track: 'move',
  add: 'add',
  remove: 'remove',
  set: 'set', slip: 'set', transition: 'set', title: 'set', line: 'set', lines: 'set', tracks: 'set', markers: 'set', other: 'set'
}
export const GROUPS: readonly SummaryGroup[] = ['cut', 'move', 'add', 'remove', 'set']

export interface JobSummary {
  /** The film's length before the job and now (seconds); before is null when
   *  the project before it is not known (the job began before this window
   *  was there). */
  before: number | null
  after: number
  /** Changes by group (only the ones said: a linked partner is not counted twice). */
  counts: Record<SummaryGroup, number>
  total: number
}

/** The changes counted by group (the rows with a sentence: draft-words' changeCount). */
export function countChanges(changes: readonly DraftChange[]): Record<SummaryGroup, number> {
  const counts: Record<SummaryGroup, number> = { cut: 0, move: 0, add: 0, remove: 0, set: 0 }
  for (const c of changes) if (c.key) counts[GROUP_OF[c.kind]]++
  return counts
}

/** The summary of a job that began on `before` and left `after`. */
export function summaryOf(before: Project | null, after: Project): JobSummary {
  const counts = before ? countChanges(draftChanges(before, after, [])) : { cut: 0, move: 0, add: 0, remove: 0, set: 0 }
  return { before: before ? projectDuration(before) : null, after: projectDuration(after), counts, total: GROUPS.reduce((n, g) => n + counts[g], 0) }
}

// ---- the project at each call's start -------------------------------------------
// A call is recorded the moment it starts, before its edit runs (the store's
// callStarted, then the tool): the project then is the one it met. Kept for
// the newest calls only.
const KEPT = 400
const metAt = new Map<string, Project>()
let watching = false

/** Starts recording (once; the bar's summary calls it). */
export function watchCalls(): void {
  if (watching) return
  watching = true
  useAgentStore.subscribe((s, prev) => {
    if (s.events === prev.events) return
    const known = new Set(prev.events.map((e) => e.id))
    for (const e of s.events) if (!known.has(e.id) && !metAt.has(e.id)) metAt.set(e.id, useStore.getState().project)
    while (metAt.size > KEPT) metAt.delete(metAt.keys().next().value as string)
  })
}

/** The project the call `id` met (null: not seen by this window). */
export const projectMetBy = (id: string | undefined): Project | null => (id ? (metAt.get(id) ?? null) : null)
