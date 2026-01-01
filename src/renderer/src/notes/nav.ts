// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Going from note to note (ONIZLEME-UYGULA-PLAN.md, K6; the idea is
// VideoHub's , / . keys and its timeline's merged note marks). Pure.
import type { WorkNote } from '../types'

/** Where a note is looked at: its drawing's frame, else its start. */
export const noteTime = (n: Pick<WorkNote, 'at' | 'start'>): number => n.at ?? n.start

/** The notes in the order they come on the timeline (then by number). */
export const notesInOrder = <N extends Pick<WorkNote, 'at' | 'start' | 'num'>>(notes: readonly N[]): N[] =>
  [...notes].sort((a, b) => noteTime(a) - noteTime(b) || a.num - b.num)

/**
 * The note before (-1) or after (1) the playhead, or null. A note picked
 * right at the playhead counts as "here": the next press goes past it, also
 * when two notes share one moment.
 */
export function neighbourNote<N extends Pick<WorkNote, 'id' | 'at' | 'start' | 'num'>>(notes: readonly N[], now: number, dir: -1 | 1, picked: string | null = null, eps = 1e-3): N | null {
  const list = notesInOrder(notes)
  const here = picked ? list.findIndex((n) => n.id === picked && Math.abs(noteTime(n) - now) <= eps) : -1
  if (here >= 0) return list[here + dir] ?? null
  if (dir > 0) return list.find((n) => noteTime(n) > now + eps) ?? null
  for (let i = list.length - 1; i >= 0; i--) if (noteTime(list[i]) < now - eps) return list[i]
  return null
}

/** One mark on the notes lane: a note, or several one-frame notes too close
 *  to tell apart at this zoom. */
export interface NoteMark<N> {
  notes: N[]
  /** Where the mark sits (seconds): the first note's start. */
  at: number
}

/**
 * Notes drawn as pins (shorter than `pinPx` at `pxPerSec`) whose pins are
 * less than `gapPx` apart become one mark; a range note is always its own.
 */
export function groupNotes<N extends Pick<WorkNote, 'start' | 'end' | 'num'>>(notes: readonly N[], pxPerSec: number, pinPx = 12, gapPx = 14): NoteMark<N>[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.num - b.num)
  const out: NoteMark<N>[] = []
  let open: NoteMark<N> | null = null
  let lastX = -Infinity
  for (const n of sorted) {
    const pin = (n.end - n.start) * pxPerSec < pinPx
    // A range under the pins does not part them (it is drawn as a block).
    if (!pin) {
      out.push({ notes: [n], at: n.start })
      continue
    }
    const x = n.start * pxPerSec
    if (open && x - lastX < gapPx) open.notes.push(n)
    else {
      open = { notes: [n], at: n.start }
      out.push(open)
    }
    lastX = x
  }
  return out
}

/** The order in which a mark of several notes shows its status: the most
 *  pressing first (DENEME-2-PLAN-N.md, K3). */
const URGENCY: readonly WorkNote['status'][] = ['still', 'ready', 'open', 'agent', 'approved']

/** The status a mark shows: its one note's, or for several notes the most
 *  pressing one among them (sent back, to review, open, with the agent, done). */
export function markStatus(notes: readonly Pick<WorkNote, 'status'>[]): WorkNote['status'] {
  let best = URGENCY.length - 1
  for (const n of notes) best = Math.min(best, Math.max(0, URGENCY.indexOf(n.status)))
  return URGENCY[best]
}

/** The note a click on a mark goes to: the first one, or the one after the
 *  picked one when the picked one is in this mark (it goes round). */
export function markTarget<N extends { id: string }>(mark: NoteMark<N>, picked: string | null): N {
  const i = picked ? mark.notes.findIndex((n) => n.id === picked) : -1
  return mark.notes[i >= 0 ? (i + 1) % mark.notes.length : 0]
}
