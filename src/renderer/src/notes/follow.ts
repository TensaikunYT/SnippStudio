// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Work notes stay on what they were written about (FAZ1-PLAN.md, K3).
//
// A note marks a moment of the picture, not a second of the timeline: when
// the timeline is cut, time is put in, or the note's clip is moved, trimmed,
// split or sped up, the note goes with it. Three ways, all pure:
//
//   shiftNotesForCut     a stretch taken out of the WHOLE timeline (a ripple
//                        cut, the agent's cut_ranges): every note moves as
//                        the markers do. A note inside the cut is not lost:
//                        it becomes one frame at the join, which is exactly
//                        where a "cut this" note is looked at afterwards.
//   shiftNotesForInsert  time put in (a freeze frame): what is after moves on.
//   followNotes          every other edit. The store's `mutate` calls it with
//                        the project before and after (as it does for the
//                        subtitles, subtitles/follow.ts): a note whose clip
//                        changed is placed again from its clip's own clock.
//
// An edit that moved a note itself (the two shifts above, a drag on the N
// lane) is left where it put it, and its tie to the clip under it is made
// again. Undo is the store's snapshot.

import type { Clip, Project, WorkNote } from '../types'
import { clipsLaidOutSame } from '../subtitles/follow'
import { reanchored, sourceAt, timeOfSource } from './model'
import { sameCurve } from '../timeline/speed-curve'

const EPS = 1e-6

const speedOf = (c: Clip): number => Math.max(0.01, c.speed ?? 1)
const outOf = (c: Clip): number => c.inPoint + c.duration * speedOf(c)
const sameLayout = (a: Clip, b: Clip): boolean =>
  a.start === b.start && a.duration === b.duration && a.inPoint === b.inPoint && (a.speed ?? 1) === (b.speed ?? 1) && a.assetId === b.assetId && sameCurve(a.speedCurve, b.speedCurve)

/** A note with its times mapped (its drawing's frame and the stretches the
 *  agent changed with them). The same object when nothing moved. */
function mapNote(n: WorkNote, at: (t: number) => number, endAt: (t: number) => number = at): WorkNote {
  const start = at(n.start)
  const end = Math.max(start, endAt(n.end))
  const drawn = n.at === undefined ? undefined : at(n.at)
  const touched = n.touched?.map(([a, b]): [number, number] => {
    const x = at(a)
    return [x, Math.max(x, endAt(b))]
  })
  const moved = start !== n.start || end !== n.end || drawn !== n.at || !!touched?.some((r, i) => r[0] !== n.touched![i][0] || r[1] !== n.touched![i][1])
  if (!moved) return n
  return { ...n, start, end, ...(drawn !== undefined ? { at: drawn } : {}), ...(touched ? { touched } : {}) }
}

/** A note on no clip. */
function untied(n: WorkNote): WorkNote {
  const out: WorkNote = { ...n }
  delete out.clip
  return out
}

function mapAll(p: Project, fn: (n: WorkNote) => WorkNote): void {
  if (!p.notes || p.notes.length === 0) return
  let changed = false
  const out = p.notes.map((n) => {
    const m = fn(n)
    if (m !== n) changed = true
    return m
  })
  if (changed) p.notes = out
}

/** [a, b] was taken out of the whole timeline and the gap closed. */
export function shiftNotesForCut(p: Project, a: number, b: number): void {
  const range = b - a
  if (!(range > 0)) return
  const at = (t: number): number => (t >= b ? t - range : t > a ? a : t)
  mapAll(p, (n) => mapNote(n, at))
}

/** `hold` seconds were put in at `t`: what starts at or after it moves on,
 *  and a note running through it grows by the hold. */
export function shiftNotesForInsert(p: Project, t: number, hold: number): void {
  if (!(hold > 0)) return
  mapAll(p, (n) => mapNote(n, (x) => (x >= t ? x + hold : x), (x) => (x > t ? x + hold : x)))
}

/** A note placed again after its clip changed. `was` is its clip before the
 *  edit; `pieces` are the clips that may show that clip's source now: the
 *  clip itself (when it is still there) first, then what the edit made of it. */
function follow(p: Project, n: WorkNote, was: Clip, now: Clip | undefined, pieces: Clip[]): WorkNote {
  const len = n.end - n.start
  const startInside = n.start >= was.start - EPS && n.start <= was.start + was.duration + EPS
  const endInside = n.end >= was.start - EPS && n.end <= was.start + was.duration + EPS
  const mA = sourceAt(was, n.start)
  const mB = sourceAt(was, n.end)
  const holds = (c: Clip, m: number): boolean => m >= c.inPoint - EPS && m <= outOf(c) + EPS
  // A moment on a cut belongs to the piece that starts there when it opens a
  // note, and to the piece that ends there when it closes one.
  const opens = (m: number): Clip | undefined => pieces.find((c) => m >= c.inPoint - EPS && m < outOf(c) - EPS) ?? pieces.find((c) => holds(c, m))
  const closes = (m: number): Clip | undefined => pieces.find((c) => m > c.inPoint + EPS && m <= outOf(c) + EPS) ?? pieces.find((c) => holds(c, m))
  const a = startInside ? opens(mA) : undefined
  const b = endInside ? closes(mB) : undefined

  let start = n.start
  let end = n.end
  let on: Clip | undefined
  if (a && b) {
    start = timeOfSource(a, mA)
    end = timeOfSource(b, mB)
    on = a
  } else if (a) {
    // Its end ran past the clip (it keeps its length), or was cut away (it
    // ends where the picture it is on does).
    start = timeOfSource(a, mA)
    end = endInside ? a.start + a.duration : start + len
    on = a
  } else if (b) {
    end = timeOfSource(b, mB)
    start = startInside ? b.start : end - len
    on = b
  } else if (!startInside && !endInside && now) {
    // Wider than its clip on both sides: it goes where the clip went.
    const d = now.start - was.start
    start = n.start + d
    end = n.end + d
    on = now
  } else if (pieces.length > 0 && (startInside || endInside)) {
    // All of it was trimmed or cut away: one frame at the edge nearest to it.
    let best = pieces[0]
    let bestAt = pieces[0].start
    let bestD = Infinity
    for (const c of pieces) {
      for (const [m, t] of [[c.inPoint, c.start], [outOf(c), c.start + c.duration]] as [number, number][]) {
        const d = Math.min(Math.abs(m - mA), Math.abs(m - mB))
        if (d < bestD) {
          bestD = d
          best = c
          bestAt = t
        }
      }
    }
    start = bestAt
    end = bestAt
    on = best
  } else {
    // Its clip is gone: it stays at its place on the timeline, on no clip
    // (or on whatever is under it now).
    return reanchored(p, untied(n))
  }
  start = Math.max(0, start)
  end = Math.max(start, end)
  const out: WorkNote = { ...n, start, end, clip: { id: on.id, assetId: on.assetId, from: sourceAt(on, start), to: sourceAt(on, end) } }
  if (n.at !== undefined) out.at = Math.max(0, n.at + (start - n.start))
  return out
}

/**
 * Brings the notes along with an edit (in place on `next`; `prev` is the
 * project before it). Idempotent: called again with nothing changed, it
 * changes nothing.
 */
export function followNotes(prev: Project, next: Project): void {
  const notes = next.notes
  if (!notes || notes.length === 0) return
  const before = new Map((prev.notes ?? []).map((n) => [n.id, n]))
  const laidOutSame = clipsLaidOutSame(prev, next)
  let changed = false
  const out = notes.map((n) => {
    const was = before.get(n.id)
    // New in this edit: tied when it was made.
    if (!was) return n
    // Moved by the edit itself: its tie is made again where it is now.
    if (was.start !== n.start || was.end !== n.end) {
      const r = reanchored(next, n)
      if (r !== n) changed = true
      return r
    }
    if (laidOutSame || !n.clip) return n
    const wasClip = prev.clips[n.clip.id]
    if (!wasClip) {
      changed = true
      return reanchored(next, untied(n))
    }
    const nowClip = next.clips[wasClip.id]
    if (nowClip && sameLayout(wasClip, nowClip)) return n
    const same = nowClip && nowClip.assetId === wasClip.assetId ? nowClip : undefined
    // What the edit made of it: clips of the same source that were not there
    // before (a split's right piece, the far side of a cut), its own track first.
    const born = Object.values(next.clips)
      .filter((c) => !prev.clips[c.id] && c.assetId === wasClip.assetId && !c.nested === !wasClip.nested)
      .sort((x, y) => Number(y.trackId === wasClip.trackId) - Number(x.trackId === wasClip.trackId) || x.start - y.start)
    const r = follow(next, n, wasClip, same, same ? [same, ...born] : born)
    changed = true
    return r
  })
  if (!changed) return
  next.notes = out.sort((x, y) => x.start - y.start || x.num - y.num)
}
