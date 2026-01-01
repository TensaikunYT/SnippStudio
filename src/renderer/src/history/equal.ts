// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Is this edit an edit? (SnippStudio phase 2A.2–2A.3.) The store's projects
// are copy-on-write: an edit shares every part it did not touch with the
// project before it, so comparing two of them only walks the parts that were
// written to — and a part written with the same value it had compares equal.
import type { Project } from '../types'
import { sameCurve } from '../timeline/speed-curve'

/** Deep equality as the undo history sees it (JSON): a key holding
 *  `undefined` is the same as no key. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b)
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const y = b as unknown[]
    if (a.length !== y.length) return false
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], y[i])) return false
    return true
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const k in x) if (x[k] !== undefined && !sameValue(x[k], y[k])) return false
  for (const k in y) if (y[k] !== undefined && x[k] === undefined) return false
  return true
}

/** Parts of a project that are not the film: the work notes (their text and
 *  status), the snapping settings, the project's name, of a track how tall
 *  its row is drawn and whether it is locked, and of a clip whether the user
 *  locked it against agents. */
const NOT_THE_FILM = new Set(['notes', 'noteSeq', 'snap', 'name'])

/** Whether `b` differs from `a` in the film itself — what the version number
 *  counts. */
export function filmChanged(a: Project, b: Project): boolean {
  if (a === b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (NOT_THE_FILM.has(k)) continue
    const x = (a as unknown as Record<string, unknown>)[k]
    const y = (b as unknown as Record<string, unknown>)[k]
    if (x === y) continue
    if (k === 'tracks') {
      const ta = a.tracks
      const tb = b.tracks
      if (ta.length !== tb.length) return true
      for (let i = 0; i < ta.length; i++) {
        if (ta[i] === tb[i]) continue
        const { height: _ha, locked: _la, ...ra } = ta[i]
        const { height: _hb, locked: _lb, ...rb } = tb[i]
        if (!sameValue(ra, rb)) return true
      }
      continue
    }
    if (!sameValue(x, y)) {
      // (A clip's lock against agents is not the film: KAPSAM-AJAN-PLAN.md;
      // nor its coloured label: KOLAY-PLAN.md.)
      if (k === 'clips' && sameClipsButLock(a.clips, b.clips)) continue
      return true
    }
  }
  return false
}

/** The same clips but for the user's lock against agents and labels. */
function sameClipsButLock(a: Project['clips'], b: Project['clips']): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const id of ka) {
    const x = a[id]
    const y = b[id]
    if (x === y) continue
    if (!y) return false
    if (!sameValue({ ...x, agentLock: undefined, label: undefined }, { ...y, agentLock: undefined, label: undefined })) return false
  }
  return true
}

/** Whether the clips' timing changed: one added or removed, or one's place,
 *  length, in point, speed or row. A pending silence-cut preview (regions
 *  by clip and time) is stale after such an edit, whichever way it came. */
export function clipTimingChanged(a: Project, b: Project): boolean {
  if (a.clips === b.clips) return false
  const ka = Object.keys(a.clips)
  if (ka.length !== Object.keys(b.clips).length) return true
  for (const id of ka) {
    const x = a.clips[id]
    const y = b.clips[id]
    if (x === y) continue
    if (!y || x.start !== y.start || x.duration !== y.duration || x.inPoint !== y.inPoint || (x.speed ?? 1) !== (y.speed ?? 1) || !sameCurve(x.speedCurve, y.speedCurve) || x.trackId !== y.trackId) return true
  }
  return false
}
