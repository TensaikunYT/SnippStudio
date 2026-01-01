// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where an agent may write (KAPSAM-AJAN-PLAN.md §3). Two limits the PROGRAM
// keeps, whatever the agent was told:
//   - a clip the user locked against agents (Clip.agentLock, kept in the
//     project file) is not changed by an agent's op: one that names it, takes
//     it away or changes anything of it but where it lies (a cut elsewhere
//     may still shift it along) is not applied;
//   - a work note the user limited ("only in this stretch" / "only these
//     clips": WorkNote.only) that is out with the agent bounds every op that
//     comes in while it is: what such an op changes lies inside the note's
//     stretch (and of the clips, only those named), or the op is not applied.
// agent/replay.ts `step` asks these two before and after each op, on the
// existing path of a dropped op: the op is rolled back and its reason is said
// to the agent (English, exact) and to the user (agent/drop-words.ts).
// An op's limit is written on it when it comes in (`scopeOf`), with each
// note's id: on a replay the stretch is read off the project the op meets —
// the note rides every edit (notes/follow.ts), the agent's own cuts that
// shortened it included — and off what was written when the note is gone.
// Pure.
import type { Caption, Clip, Project } from '../types'
import { instanceOf } from '../types'
import { commandByName } from '../commands'
import { sameValue } from '../history/equal'
import { idsIn } from './address'

/** A limited note as an op carries it: its stretch (and clips) when the op
 *  came in. */
export interface ScopeNote {
  id: string
  num: number
  start: number
  end: number
  /** The clips (their `instanceOf`) the work is limited to. */
  clips?: string[]
}

/** How far past a stretch's edge a change may reach (a little over a frame:
 *  a clip laid against the edge is inside). */
export const SCOPE_TOL = 0.05
const EPS = 1e-6

/** The cut commands: what they change is said by the ranges they cut. */
const CUTTERS = new Set(['timeline.cutRanges', 'timeline.cutRangeOnTrack', 'silence.apply'])

type Iv = [number, number]

const s2 = (t: number): string => (Math.round(t * 100) / 100).toFixed(2)

/** The limited notes out with the agent in `p`: what an op coming in now is
 *  bound by. None: no limit. */
export function scopeOf(p: Project): ScopeNote[] | undefined {
  const out: ScopeNote[] = []
  for (const n of p.notes ?? []) {
    if (!n.only || n.status !== 'agent') continue
    out.push({ id: n.id, num: n.num, start: n.start, end: n.end, ...(n.only.clips?.length ? { clips: [...n.only.clips] } : {}) })
  }
  return out.length ? out : undefined
}

/** The notes where they lie in `p` (they ride the edits), else as written. */
function where(p: Project, scope: readonly ScopeNote[]): ScopeNote[] {
  return scope.map((s) => {
    const n = p.notes?.find((x) => x.id === s.id)
    return n ? { ...s, start: n.start, end: n.end } : s
  })
}

const isLocked = (c: Clip | undefined): boolean => c?.agentLock === true

/** The ids an op names (clips, lines, markers, tracks…). */
function named(op: { name: string; params: Record<string, unknown> }): Set<string> {
  try {
    return new Set(idsIn(commandByName(op.name).params as never, op.params))
  } catch {
    return new Set()
  }
}

const lockSay = (c: Clip): string => `the user locked clip ${c.id} against agents: not applied, the clip stays as it is`

/** Before an op runs: a locked clip it names. */
export function lockedNamed(p: Project, op: { name: string; params: Record<string, unknown> }): string | null {
  for (const id of named(op)) if (Object.hasOwn(p.clips, id) && isLocked(p.clips[id])) return lockSay(p.clips[id])
  return null
}

const shiftedOnly = (a: Clip, b: Clip): boolean => sameValue({ ...a, start: 0 }, { ...b, start: 0 })

/** After an op ran (from `before` to `after`): a locked clip it changed, or
 *  a change outside the limit it came in with. The reason, or null. */
export function scopeBreach(before: Project, after: Project, op: { name: string; params: Record<string, unknown>; scope?: readonly ScopeNote[] }, cuts?: readonly Iv[]): string | null {
  const names = named(op)
  if (before.clips !== after.clips) {
    for (const c of Object.values(before.clips)) {
      if (!isLocked(c)) continue
      const a = Object.hasOwn(after.clips, c.id) ? after.clips[c.id] : undefined
      if (a === c) continue
      if (!a) return lockSay(c)
      if (sameValue(c, a)) continue
      // (Carried along by a cut or a ripple elsewhere: it shows the same, a
      // little earlier or later. Moved itself, or with its partner: touched.)
      const partner = !!c.linkId && [...names].some((id) => Object.hasOwn(before.clips, id) && before.clips[id].linkId === c.linkId)
      if (shiftedOnly(c, a) && !names.has(c.id) && !partner) continue
      return lockSay(c)
    }
  }
  if (!op.scope?.length) return null
  return outside(before, after, op.name, names, where(before, op.scope), cuts)
}

function merged(list: readonly Iv[]): Iv[] {
  const out: Iv[] = []
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1]
    if (last && a <= last[1] + SCOPE_TOL) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

const inside = (r: Iv, ranges: readonly Iv[]): boolean => ranges.some(([a, b]) => r[0] >= a - SCOPE_TOL && r[1] <= b + SCOPE_TOL)

function outside(before: Project, after: Project, name: string, names: Set<string>, notes: readonly ScopeNote[], cuts?: readonly Iv[]): string | null {
  const all = merged(notes.map((n) => [n.start, n.end]))
  const open = merged(notes.filter((n) => !n.clips).map((n) => [n.start, n.end]))
  const held = merged(notes.filter((n) => n.clips).map((n) => [n.start, n.end]))
  const clipSet = new Set(notes.flatMap((n) => n.clips ?? []))
  const where = notes.map((n) => `#${n.num}: ${s2(n.start)}–${s2(n.end)} s${n.clips ? `, clips ${n.clips.join(', ')}` : ''}`).join('; ')
  const say = (what: string): string => `${what}: outside what the user limited this work to (note ${where}); not applied. Keep your edits inside it`
  const clipOk = (r: Iv, c: Clip): boolean => inside(r, open) || (inside(r, held) && clipSet.has(instanceOf(c)))
  const at = (r: Iv): string => (r[1] - r[0] > 1e-3 ? `${s2(r[0])}–${s2(r[1])} s` : `${s2(r[0])} s`)

  if (CUTTERS.has(name) && cuts) {
    for (const r of cuts) if (!inside(r, all)) return say(`it cuts ${at(r)}`)
    // (Of the clips, a cut changes those it runs through: with clips named,
    // only those.)
    if (held.length) {
      for (const c of Object.values(before.clips)) {
        const a = Object.hasOwn(after.clips, c.id) ? after.clips[c.id] : undefined
        if (a === c || (a && (sameValue(c, a) || shiftedOnly(c, a)))) continue
        const hit = cuts.map(([x, y]): Iv => [Math.max(x, c.start), Math.min(y, c.start + c.duration)]).filter(([x, y]) => y > x + EPS)
        if (hit.some((r) => !clipOk(r, c))) return say(`it cuts clip ${c.id}`)
      }
    }
    return null
  }

  // The whole film: a setting of the project, a track's own setting, the
  // order of the tracks. (A new track is no change of what is there.)
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === 'clips' || k === 'captions' || k === 'markers' || k === 'templates' || k === 'tracks' || k === 'notes' || k === 'noteSeq' || k === 'assets') continue
    const x = (before as unknown as Record<string, unknown>)[k]
    const y = (after as unknown as Record<string, unknown>)[k]
    if (x !== y && !sameValue(x, y)) return say(`it changes the whole film (${k})`)
  }
  if (before.tracks !== after.tracks) {
    const kept = after.tracks.filter((t) => before.tracks.some((b) => b.id === t.id))
    for (const b of before.tracks) {
      const t = after.tracks.find((x) => x.id === b.id)
      if (!t) return say(`it removes track ${b.id}`)
      if (!sameValue({ ...b, clipIds: 0, height: 0 }, { ...t, clipIds: 0, height: 0 })) return say(`it changes track ${b.id}`)
    }
    if (kept.some((t, i) => t.id !== before.tracks[i].id)) return say('it changes the order of the tracks')
  }

  // Every record it added, removed or changed: where the change lies.
  if (before.clips !== after.clips) {
    for (const id of new Set([...Object.keys(before.clips), ...Object.keys(after.clips)])) {
      const c = Object.hasOwn(before.clips, id) ? before.clips[id] : undefined
      const a = Object.hasOwn(after.clips, id) ? after.clips[id] : undefined
      if (c === a) continue
      if (!c) {
        const r: Iv = [a!.start, a!.start + a!.duration]
        if (!inside(r, all)) return say(`it puts clip ${id} at ${at(r)}`)
        continue
      }
      if (!a) {
        const r: Iv = [c.start, c.start + c.duration]
        if (!clipOk(r, c)) return say(`it removes clip ${id} (${at(r)})`)
        continue
      }
      if (sameValue(c, a) || (shiftedOnly(c, a) && !names.has(id))) continue
      for (const r of clipChange(c, a)) if (!clipOk(r, c)) return say(`it changes clip ${id} at ${at(r)}`)
    }
  }
  if (before.captions !== after.captions) {
    const was = new Map(before.captions.map((l) => [l.id, l]))
    const now = new Map(after.captions.map((l) => [l.id, l]))
    for (const id of new Set([...was.keys(), ...now.keys()])) {
      const c = was.get(id)
      const a = now.get(id)
      if (c === a) continue
      const r: Iv = c && a ? [Math.min(c.start, a.start), Math.max(c.end, a.end)] : c ? [c.start, c.end] : [a!.start, a!.end]
      if (c && a && (sameLine(c, a) || (!names.has(id) && lineShifted(c, a)))) continue
      if (!inside(r, all)) return say(`it ${!c ? 'adds' : !a ? 'removes' : 'changes'} the line ${id} at ${at(r)}`)
    }
  }
  const timed = <T extends { id: string }>(kind: string, x: readonly T[] | undefined, y: readonly T[] | undefined, span: (v: T) => Iv): string | null => {
    if (x === y) return null
    const was = new Map((x ?? []).map((v) => [v.id, v]))
    const now = new Map((y ?? []).map((v) => [v.id, v]))
    for (const id of new Set([...was.keys(), ...now.keys()])) {
      const c = was.get(id)
      const a = now.get(id)
      if (c === a || (c && a && sameValue(c, a))) continue
      if (c && a && !names.has(id)) {
        const d = span(a)[0] - span(c)[0]
        if (Math.abs(span(a)[1] - span(c)[1] - d) <= EPS && sameValue({ ...c, ...zero(c) }, { ...a, ...zero(a) })) continue
      }
      const rs = [c && span(c), a && span(a)].filter((r): r is Iv => !!r)
      const r: Iv = [Math.min(...rs.map((v) => v[0])), Math.max(...rs.map((v) => v[1]))]
      if (!inside(r, all)) return say(`it ${!c ? 'adds' : !a ? 'removes' : 'changes'} the ${kind} ${id} at ${at(r)}`)
    }
    return null
  }
  return (
    timed('marker', before.markers, after.markers, (m) => [m.time, m.time]) ??
    timed('G lane item', before.templates, after.templates, (t) => [t.start, t.start + (t.duration ?? 0)])
  )
}

/** A record's time fields set aside (what a shift changes). */
function zero(v: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of ['time', 'start']) if (k in v) out[k] = 0
  return out
}

/** Where a clip's change shows on the timeline: a trim (the same footage at
 *  the same seconds, one edge moved) changes only the stretch between its
 *  old and new edge; any other change, the whole of where it lay and lies. */
function clipChange(c: Clip, a: Clip): Iv[] {
  const ce = c.start + c.duration
  const ae = a.start + a.duration
  const speed = c.speed ?? 1
  const timingOnly = sameValue({ ...c, start: 0, duration: 0, inPoint: 0 }, { ...a, start: 0, duration: 0, inPoint: 0 })
  const aligned = Math.abs(c.inPoint - c.start * speed - (a.inPoint - a.start * speed)) <= 1e-4
  if (timingOnly && aligned) {
    const out: Iv[] = []
    if (Math.abs(a.start - c.start) > EPS) out.push([Math.min(a.start, c.start), Math.max(a.start, c.start)])
    if (Math.abs(ae - ce) > EPS) out.push([Math.min(ae, ce), Math.max(ae, ce)])
    return out
  }
  return [[Math.min(c.start, a.start), Math.max(ce, ae)]]
}

/** The same line (but for the app's note of its voice clip). */
const sameLine = (c: Caption, a: Caption): boolean => sameValue({ ...c, soundClip: 0 }, { ...a, soundClip: 0 })

/** A line moved along whole (a cut or a ripple before it): every time by the
 *  same amount, nothing else. */
function lineShifted(c: Caption, a: Caption): boolean {
  const d = a.start - c.start
  if (Math.abs(a.end - c.end - d) > 1e-4) return false
  const cw = c.words ?? []
  const aw = a.words ?? []
  if (cw.length !== aw.length || cw.some((w, i) => w.text !== aw[i].text || Math.abs(aw[i].start - w.start - d) > 1e-4 || Math.abs(aw[i].end - w.end - d) > 1e-4)) return false
  return sameValue({ ...c, start: 0, end: 0, words: 0, soundClip: 0 }, { ...a, start: 0, end: 0, words: 0, soundClip: 0 })
}
