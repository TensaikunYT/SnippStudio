// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The notes tool's seconds (SnippStudio phase 4A.10, G1: table#2, table#5).
// An agent whose draft waits reads its draft: the notes are listed in THAT
// frame (where the draft's cuts moved them), and the ranges it names in an
// update are read in the same frame and carried to the live timeline (the
// note is the live project's). Before, the list printed live seconds and the
// update read draft seconds: an agent that echoed the printed seconds had its
// highlight moved by the draft's cuts. Pure; host.ts calls it.
import type { Project } from '../types'
import { notesText, type NoteUpdate, type NotesFilter } from '../notes/agent'
import { carryRange } from './content'

/** The list as the agent reads it: statuses and replies of the live notes,
 *  times (and what is under them) of `seen` — its draft while one waits. */
export function notesListText(live: Project, seen: Project, projectPath: string | null, filter: NotesFilter, taken = 0): string {
  if (seen === live) return notesText(live, projectPath, filter, taken)
  const there = new Map((seen.notes ?? []).map((n) => [n.id, n]))
  const notes = (live.notes ?? []).map((n) => {
    const d = there.get(n.id)
    return d ? { ...n, start: d.start, end: d.end, ...(d.at !== undefined ? { at: d.at } : {}) } : n
  })
  return notesText({ ...seen, notes }, projectPath, filter, taken).replace('Times are timeline seconds.', 'Times are timeline seconds of your draft.')
}

/** The list as an agent reads it that is not the one working on the project
 *  (D22, the audit's A8): it takes no note — the notes are the working
 *  agent's to take — and is told so. `name`: that agent, as the user knows it. */
export const notesReadOnly = (list: string, name: string): string => `${list}\nRead only: this project is with another agent (${name}) now; the notes stay as they are (none was marked "with agent" for you).`

/** An update's touched ranges, named in `seen`'s seconds, on the live
 *  timeline (a range on footage only the draft has is left out, and said). */
export function touchedToLive(plan: NoteUpdate, seen: Project, live: Project): void {
  if (!plan.touched || seen === live) return
  const carried = plan.touched.map((r) => carryRange(seen, live, r))
  const lost = carried.filter((r) => !r).length
  plan.touched = carried.filter((r): r is [number, number] => !!r)
  if (lost) plan.remarks.push(`${lost} touched range${lost === 1 ? '' : 's'} could not be placed on the live timeline (footage only the draft has, or none under an end) and ${lost === 1 ? 'was' : 'were'} left out.`)
}
