// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How close two clips on a track must be to count as one cut: the render
// links them as neighbours (a transition between them), and the timeline's
// junction button and the one-click transition presets use the very same
// tolerance, so a junction you can see is always a junction that renders. A
// pure module of its own: the render touches the DOM when it is imported,
// and the tests read this in node.

import { JOIN_EPS } from '../timeline/eps'

/** Seconds: |next.start − (clip.start + clip.duration)| below this is a cut
 *  (its value lives in timeline/eps.ts since phase Ç2b.2). */
export { JOIN_EPS }

/** Whether `next` starts where `clip` ends (within JOIN_EPS). */
export function clipsJoin(clip: { start: number; duration: number }, next: { start: number }): boolean {
  return Math.abs(next.start - (clip.start + clip.duration)) < JOIN_EPS
}
