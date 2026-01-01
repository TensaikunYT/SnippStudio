// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A transition names the clip it goes into (phase Ç2b.2, decision 1; report
// G2): `transitionOut.to`. It was a property of the outgoing clip whose
// partner was found at draw time (whatever touched its end), and only Delete
// kept it right: a ripple or silence cut re-aimed a dissolve at another shot,
// a move or a paste turned it into a fade-out the timeline did not show.
//
// The rule, after every edit (commands/core.ts produceEdit, the store's
// mutate): a transition whose clip is no longer the one right after it goes;
// one with no `to` yet (just set, pasted as an attribute) takes the clip after
// it, or null (a fade-out) when nothing meets it. The draw follows `to` the
// same way (playback/draw/timing.ts). Pure: no DOM.
import type { Clip, Project } from '../types'
import { JOIN_EPS } from './eps'
import { produce } from '../state/cow'

/** The clip right after each clip of the lists that meets it (null: none). */
function afterOf(lists: readonly Clip[][], want: (c: Clip) => boolean): Map<string, string | null> {
  const out = new Map<string, string | null>()
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!want(c)) continue
      const nx = list[i + 1]
      out.set(c.id, nx && Math.abs(nx.start - (c.start + c.duration)) < JOIN_EPS ? nx.id : null)
    }
  }
  return out
}

/** How long a transition may be, in seconds: the one rule of the command
 *  schema, the presets, the inspector and the timeline's junction (phase
 *  Ç2b.2, report G8: they said 0.05–5, 0.2–2, 0.2–2 and 0.1–1.9 × the
 *  shorter clip). The render takes what the clips allow of it. */
export const TRANSITION_LIMITS = { min: 0.05, max: 5 } as const

/** What a list of clips (one track's, or a compound's children) needs: id →
 *  the partner to write in (null: a fade-out), or 'drop', for the clips whose
 *  transition must be filled or dropped. A transition with no partner yet
 *  takes the one it had before the edit (`before`: a project of an older
 *  build, a test's), else the clip after it now. */
function pending(lists: readonly Clip[][], before?: ReadonlyMap<string, string | null>): Map<string, string | null | 'drop'> {
  const out = new Map<string, string | null | 'drop'>()
  const now = afterOf(lists, (c) => !!c.transitionOut)
  for (const list of lists) {
    for (const c of list) {
      const t = c.transitionOut
      if (!t) continue
      const after = now.get(c.id) ?? null
      const to = t.to === undefined ? (before?.has(c.id) ? before.get(c.id)! : after) : t.to
      if (to !== null && to !== after) out.set(c.id, 'drop')
      else if (t.to === undefined) out.set(c.id, to)
    }
  }
  return out
}

/** A compound's children by the track they came from, each in time order. */
function childLists(children: readonly Clip[]): Clip[][] {
  const by = new Map<string, Clip[]>()
  for (const c of children) by.set(c.trackId, [...(by.get(c.trackId) ?? []), c])
  return [...by.values()].map((l) => [...l].sort((a, b) => a.start - b.start))
}

/** Does a compound (at any depth) hold a transition to fill or drop? */
function nestedPending(c: Clip): boolean {
  if (!c.nested) return false
  return pending(childLists(c.nested.clips)).size > 0 || c.nested.clips.some(nestedPending)
}

function settleList(list: Clip[], todo: Map<string, string | null | 'drop'>): void {
  for (const c of list) {
    const what = todo.get(c.id)
    if (what === undefined || !c.transitionOut) continue
    if (what === 'drop') delete c.transitionOut
    else c.transitionOut.to = what
  }
}

function settleChildren(c: Clip): void {
  if (!c.nested) return
  settleList(c.nested.clips, pending(childLists(c.nested.clips)))
  for (const ch of c.nested.clips) if (nestedPending(ch)) settleChildren(ch)
}

/**
 * `p` with every transition true to its partner: dropped when the clip it
 * names is not the one right after it any more, filled when it names none
 * yet (`base`: the project before the edit). The same object when nothing needed it (the common case: a plain read
 * of the finished edit, no draft).
 */
export function settleTransitions(p: Project, base?: Project): Project {
  const lists = p.tracks.map((t) => t.clipIds.map((id) => p.clips[id]).filter(Boolean))
  // (Partners the edit's project had for transitions that named none.)
  const unnamed = (c: Clip): boolean => !!c.transitionOut && c.transitionOut.to === undefined
  const before = base && Object.values(p.clips).some(unnamed) ? afterOf(base.tracks.map((t) => t.clipIds.map((id) => base.clips[id]).filter(Boolean)), unnamed) : undefined
  const todo = pending(lists, before)
  const deep = Object.values(p.clips).filter(nestedPending).map((c) => c.id)
  if (todo.size === 0 && deep.length === 0) return p
  return produce(p, (d) => {
    for (const [id, what] of todo) {
      const c = d.clips[id]
      if (!c?.transitionOut) continue
      if (what === 'drop') delete c.transitionOut
      else c.transitionOut.to = what
    }
    for (const id of deep) settleChildren(d.clips[id])
  })
}

/** The same rule on a plain project in place (a file being read: model/format.ts). */
export function linkTransitionsInPlace(p: Project): void {
  const tracks = Array.isArray(p.tracks) ? p.tracks : []
  const clips = p.clips && typeof p.clips === 'object' ? p.clips : {}
  // (A file's clip lists may be out of order: by time, as the draw sorted them.)
  const lists = tracks.map((t) => (Array.isArray(t?.clipIds) ? t.clipIds : []).map((id) => clips[id]).filter((c) => c && typeof c === 'object').sort((a, b) => a.start - b.start))
  settleList(Object.values(clips).filter((c) => c && typeof c === 'object'), pending(lists))
  const walk = (c: Clip): void => {
    if (!c?.nested || !Array.isArray(c.nested.clips)) return
    settleList(c.nested.clips, pending(childLists(c.nested.clips)))
    c.nested.clips.forEach(walk)
  }
  Object.values(clips).forEach(walk)
}

/** A copy of a clip (paste, duplicate, Alt-drag) comes without its
 *  transition (decision 1). (A compound's children keep theirs: their new
 *  ids are given in timeline/slice.ts freshNestedIds, which re-aims them.) */
export function transitionsOfCopy(c: Clip): void {
  delete c.transitionOut
}
