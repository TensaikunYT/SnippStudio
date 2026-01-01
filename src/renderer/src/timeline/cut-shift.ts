// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where a time lands when a stretch of the timeline is taken out (phase
// Ç2c.2, decision 3: the register of timed lists, timeline/timed-lists.ts,
// and the templates' own ripple use it). Pure.

/** A timeline time after [a, b] was taken out (one inside lands on a). */
export const cutShift = (a: number, b: number) => (t: number): number => (t >= b ? t - (b - a) : t > a ? a : t)

/**
 * The time of a key `rel` seconds from its span's start, after [a, b] was
 * taken out: relative to where the span starts now (`newStart`). A key
 * inside the cut is kept where the span lost that side (its head: before the
 * new start; its tail: after the new end — as a clip keeps its keys off the
 * clip, phase Ç2c.1) and dropped (null) when the cut went through the middle
 * of the span.
 */
export function cutSpanKey(rel: number, span: { start: number; end: number }, newStart: number, a: number, b: number): number | null {
  const at = span.start + rel
  let to: number
  if (at >= b) to = at - (b - a)
  else if (at <= a) to = at
  else if (span.start >= a) to = at - (b - a)
  else if (span.end <= b) to = at
  else return null
  return to - newStart
}
