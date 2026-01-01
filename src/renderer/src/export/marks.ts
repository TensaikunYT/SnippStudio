// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The export's in and out points (phase Ç3b, decision 9): I and O at the
// playhead (in a Shorts project those keys mark the active Short's bounds, as
// before), drawn on the timeline's ruler, read by the export window's range.
// Like the cut marks, they belong to this sitting: not saved with the
// project, not an edit (no undo step). Pure apart from its listeners.

export interface ExportMarks {
  in: number | null
  out: number | null
}

let marks: ExportMarks = { in: null, out: null }
const listeners = new Set<() => void>()

export function exportMarks(): ExportMarks {
  return marks
}

export function subscribeExportMarks(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Sets the in or the out point (null: clears it). An in after the out (or
 *  an out before the in) moves the other one away: the range is never empty. */
export function setExportMark(which: 'in' | 'out', time: number | null): void {
  const t = time === null || !Number.isFinite(time) ? null : Math.max(0, time)
  const next: ExportMarks = { ...marks, [which]: t }
  if (next.in !== null && next.out !== null && next.out <= next.in) {
    if (which === 'in') next.out = null
    else next.in = null
  }
  marks = next
  for (const fn of [...listeners]) fn()
}

export function clearExportMarks(): void {
  marks = { in: null, out: null }
  for (const fn of [...listeners]) fn()
}

/** The range [a, b] the marks give for a film of `duration` seconds: an in
 *  alone runs to the end, an out alone from the start; null without either. */
export function markedRange(m: ExportMarks, duration: number): [number, number] | null {
  if (m.in === null && m.out === null) return null
  const a = Math.min(duration, m.in ?? 0)
  const b = Math.min(duration, m.out ?? duration)
  return b > a ? [a, b] : null
}
