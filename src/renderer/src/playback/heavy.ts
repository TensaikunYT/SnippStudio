// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the preview has the most to draw (see prerender.ts): pure, so it can
// be worked out — and tested — without drawing anything.

import type { Project } from '../types'

/** Templates that are a scene of their own (heavy to draw). */
const HEAVY_TEMPLATES = new Set<string>(['chapter', 'home', 'map', 'atlas', 'news', 'player', 'list', 'store'])
/** Transitions that are heavy to draw. */
const HEAVY_TRANSITIONS = /^(film-burn|light-leak)/
/** At most this much is kept ahead, in seconds. */
export const MAX_SECONDS = 60
/** Frames are made this wide (or the project's width, if smaller). */
export const MAX_W = 960

/**
 * Where the preview is heavy, merged, in project seconds — over still
 * pictures only.
 */
export function heavyRanges(p: Project): [number, number][] {
  const raw: [number, number][] = []
  for (const b of p.templates ?? []) if (HEAVY_TEMPLATES.has(b.kind)) raw.push([b.start, b.start + b.duration])
  for (const t of p.tracks) {
    if (t.kind !== 'video' || t.hidden) continue
    for (const id of t.clipIds) {
      const c = p.clips[id]
      const tr = c?.transitionOut
      if (!c || c.disabled || !tr || !HEAVY_TRANSITIONS.test(tr.type)) continue
      const at = c.start + c.duration
      raw.push([at - tr.duration, at + tr.duration])
    }
  }
  raw.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [a0, b0] of raw) {
    const a = Math.max(0, a0)
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + 0.2) last[1] = Math.max(last[1], b0)
    else if (b0 > a) merged.push([a, b0])
  }
  return merged
}
