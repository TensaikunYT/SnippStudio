// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The oracle's subtitle-line invariants (audit patch yama-c, Y1), by brute
// force from the project alone:
//   - a line lasts the floor (0.05 s) or more;
//   - lines do not overlap;
//   - a line's first and last words (a line without words: its start and
//     end) lie on a clip of its own sound (the file its hint names: a hint
//     is a hint, the piece it names may be the one beside it);
//   - a line holds its words, and ends with its last word (`tail`: when no
//     one set a line's end by hand, the fixture's lines have none past it);
//   - the film does not run on for a line (projectDuration counts them)
//     further than a line may hang over its clip.
// A word may hang over the edge of its clip (subtitles/follow.ts keeps a word
// whose middle is kept, and a line that hangs 0.25 s over its clip is still
// its): a word is on its clip by its middle, give or take EDGE, and two lines
// may overlap by twice that (each hanging toward the other). A line AT a
// floor (0.05 s; a cut's rebuilt line 0.1 s) is longer than its sound (its
// words were played faster than that): its sound ends with its last word
// (one without words: at its start). Nothing here is shared with
// subtitles/follow.ts.
import type { Caption, Project } from '../../renderer/src/types'
import { isSubtitle, projectDuration } from '../../renderer/src/types'

export const LINE_FLOOR = 0.05
/** The longest floor an edit gives a line. */
const FLOOR_MAX = 0.1
/** How far a word may hang over the edge of its sound. */
const EDGE = 0.25
const EPS = 1e-6

export interface LineProblem {
  /** The line (or '' for the film). */
  id: string
  what: 'short' | 'overlap' | 'off-clip' | 'tail' | 'word-outside' | 'film-longer'
  detail: string
}

const iv = (c: Caption): string => `${c.start.toFixed(3)}–${c.end.toFixed(3)}`

export function lineProblems(p: Project, opts: { tail?: boolean } = {}): LineProblem[] {
  const out: LineProblem[] = []
  const subs = p.captions.filter(isSubtitle).sort((x, y) => x.start - y.start)
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
  const floored = (c: Caption): boolean => c.end - c.start <= FLOOR_MAX + EPS
  /** Where a line's sound ends. */
  const soundEnd = (c: Caption): number => {
    if (!floored(c)) return c.end
    const last = c.words?.[c.words.length - 1]
    return last ? Math.max(c.start, last.end) : c.start
  }
  subs.forEach((c, i) => {
    if (c.end - c.start < LINE_FLOOR - EPS) out.push({ id: c.id, what: 'short', detail: `line ${c.id} ${iv(c)} lasts ${c.end - c.start} s, under the floor` })
    const next = subs[i + 1]
    // (Each of two lines may hang over its clip's edge toward the other:
    // around a piece taken to 100x between them, both do; full seed 1265.)
    if (next && Math.min(soundEnd(c), soundEnd(next)) - next.start > 2 * EDGE + EPS) out.push({ id: c.id, what: 'overlap', detail: `line ${c.id} ${iv(c)} overlaps line ${next.id} ${iv(next)}` })
    const named = c.soundClip ? p.clips[c.soundClip] : undefined
    // (Not a line whose sound lies on a locked track: a cut moves the lines
    // and leaves that track where it is, by design.)
    if (named && !locked.has(named.trackId)) {
      const own = Object.values(p.clips).filter((k) => k.assetId === named.assetId)
      const on = (t: number): boolean => own.some((k) => t >= k.start - EDGE - EPS && t <= k.start + k.duration + EDGE + EPS)
      const w = c.words ?? []
      const mid = (k: number): number => (w[k].start + w[k].end) / 2
      const [a, b] = w.length ? [mid(0), mid(w.length - 1)] : [c.start, soundEnd(c)]
      if (!on(a) || !on(b)) out.push({ id: c.id, what: 'off-clip', detail: `line ${c.id} ${iv(c)} is not on its sound (${named.assetId}: ${own.sort((x, y) => x.start - y.start).map((k) => `${k.start.toFixed(3)}–${(k.start + k.duration).toFixed(3)}`).join(', ')})` })
    }
    const words = c.words ?? []
    for (const w of words) if (w.start < c.start - EPS || w.end > c.end + EPS) out.push({ id: c.id, what: 'word-outside', detail: `line ${c.id} ${iv(c)}: word "${w.text}" ${w.start}–${w.end} lies outside it` })
    const last = words[words.length - 1]
    if (opts.tail && last && !floored(c) && c.end > last.end + EDGE + EPS) out.push({ id: c.id, what: 'tail', detail: `line ${c.id} ${iv(c)} runs ${(c.end - last.end).toFixed(3)} s past its last word (${last.end.toFixed(3)})` })
  })
  const clipsOnly = projectDuration({ ...p, captions: p.captions.filter((c) => !isSubtitle(c)) })
  const film = projectDuration(p)
  // (A line may hang over the end of the last clip by EDGE, as over any.)
  if (film > clipsOnly + EDGE + EPS) out.push({ id: '', what: 'film-longer', detail: `the film runs to ${film} s for a subtitle line; without the lines it ends at ${clipsOnly} s` })
  return out
}

/** The problems of `after` that `before` did not have (by line and kind). */
export function newLineProblems(before: Project, after: Project, opts: { tail?: boolean } = {}): LineProblem[] {
  if (before.captions === after.captions && before.clips === after.clips && before.tracks === after.tracks) return []
  const had = new Set(lineProblems(before, opts).map((x) => `${x.id} ${x.what}`))
  return lineProblems(after, opts).filter((x) => !had.has(`${x.id} ${x.what}`))
}
