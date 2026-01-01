// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Build-ups into the big moments: where each rises and how long — into the
// big transitions (on their cut) and into the templates that land a point
// (as they come on). Each no longer than 1.4 s, never reaching back past
// the moment before; one too short to rise is left out.

import type { Project } from '../types'

/** Transitions that are a big moment. */
export const BIG_MOMENTS = new Set<string>(['film-burn', 'light-leak'])
/** Templates that land a point as they come on. */
export const RISER_TEMPLATES = new Set<string>(['count', 'versus', 'stat', 'chapter', 'ranking', 'list', 'store'])

export function riserTimes(project: Project): { t: number; dur: number }[] {
  if (!project.risers || project.risers <= 0) return []
  const hits: number[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const id of track.clipIds) {
      const clip = project.clips[id]
      const tr = clip?.transitionOut
      if (!clip || clip.disabled || !tr || !BIG_MOMENTS.has(tr.type)) continue
      hits.push(clip.start + clip.duration)
    }
  }
  for (const b of project.templates ?? []) if (RISER_TEMPLATES.has(b.kind) || (b.kind === 'words' && b.design === 'punch')) hits.push(b.start + 0.15)
  hits.sort((x, y) => x - y)
  const out: { t: number; dur: number }[] = []
  let last = -Infinity
  for (const at of hits) {
    const dur = Math.min(1.4, at - Math.max(0, last) - 0.2)
    last = at
    if (dur >= 0.5) out.push({ t: at - dur, dur })
  }
  return out
}
