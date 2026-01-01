// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where an agent may write (KAPSAM-AJAN-PLAN.md §3; agent/scope.ts): the
// program keeps the user's limits, not the agent. An op on a clip the user
// locked against agents is not applied (the user's own edit is); a note the
// user limited bounds what an agent changes while it is out with the agent:
// inside it applies, outside it is dropped with its reason; the stretch rides
// the agent's own cuts; the limit holds when the draft is accepted later.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import type { Project } from '../renderer/src/types'
import { acceptDraft, currentDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { addNote, sanitizeNotes, setNoteStatus } from '../renderer/src/notes/model'
import { scopeOf, scopeBreach } from '../renderer/src/agent/scope'
import { dropKind } from '../renderer/src/agent/drop-words'
import { clipOf, draftCalls, directCalls, open, talk } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})

/** A talk (c1, source 0–20 s on V1) with a note over [a, b], out with the
 *  agent, limited to its stretch (or to `clips`). */
function limited(a: number, b: number, clips?: string[], p: Project = talk(20, true)): Project {
  const n = addNote(p, { start: a, end: b, kind: 'fix', text: 'here', only: clips ? { clips } : {} })
  setNoteStatus(p, n.id, 'agent')
  return p
}
type Out = { name: string; applied: boolean; reason?: string }
/** One call of the agent's into the draft: what became of each op. */
const call = (calls: { name: string; params: unknown }[]): Out[] => draftCalls('s1', 'test', calls).outcomes

test('lock: an agent op on a locked clip is not applied and says why; the user edits it freely', () => {
  const p = talk(20)
  p.clips.c1.agentLock = true
  open(p)
  const got = call([{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.2 } }])
  const o = got[0]
  assert.equal(o.applied, false)
  assert.match(o.reason!, /the user locked clip c1 against agents/)
  assert.equal(dropKind(o.reason!), 'clipLock')
  rejectDraft()
  S().runBatch([{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.2 } }] as never)
  assert.equal(S().project.clips.c1.volume, 0.2)
})

test('lock: a cut elsewhere may carry a locked clip along; a cut through it, or a move of it, is not applied', () => {
  const p = talk(20)
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'a1', 'V2', 12, 30, 4, { agentLock: true })
  open(p)
  const a = call([{ name: 'timeline.cutRanges', params: { ranges: [[2, 4]] } }])[0]
  assert.equal(a.applied, true, String(a.reason))
  assert.equal(currentDraft()!.project.clips.b1.start, 10)
  rejectDraft()
  const b = call([{ name: 'timeline.cutRanges', params: { ranges: [[13, 14]] } }])[0]
  assert.equal(b.applied, false)
  assert.equal(dropKind(b.reason!), 'clipLock', String(b.reason))
  rejectDraft()
  const c = call([{ name: 'clip.move', params: { clipId: 'b1', start: 15 } }])[0]
  assert.equal(c.applied, false)
  assert.equal(dropKind(c.reason!), 'clipLock')
  rejectDraft()
})

test('scope: an op inside the limited stretch is applied, one outside it is dropped with its reason (one call, one each)', () => {
  open(limited(5, 10))
  assert.equal(scopeOf(S().project)?.length, 1)
  const [inside, outside] = call([
    { name: 'marker.add', params: { time: 7 } },
    { name: 'marker.add', params: { time: 15 } }
  ])
  assert.equal(inside.applied, true, String(inside.reason))
  assert.equal(outside.applied, false)
  assert.match(outside.reason!, /outside what the user limited this work to \(note #1: 5\.00–10\.00 s\)/)
  assert.equal(dropKind(outside.reason!), 'scope')
  // (A setting of the talk's clip, which runs over the whole film, changes
  // more than the stretch; so does a setting of the whole film.)
  assert.equal(call([{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.5 } }])[0].applied, false)
  const style = call([{ name: 'caption.setStyle', params: { patch: { fontSize: 80 } } }])[0]
  assert.equal(style.applied, false)
  assert.match(style.reason!, /whole film/)
  rejectDraft()
})

test('scope: a cut inside the stretch is applied and carries what lies after it; a cut outside is dropped', () => {
  open(limited(5, 10))
  const a = call([{ name: 'timeline.cutRanges', params: { ranges: [[6, 7]] } }])[0]
  assert.equal(a.applied, true, String(a.reason))
  const b = call([{ name: 'timeline.cutRanges', params: { ranges: [[12, 13]] } }])[0]
  assert.equal(b.applied, false)
  assert.equal(dropKind(b.reason!), 'scope')
  rejectDraft()
})

test('scope: the stretch rides the agent\'s own cut — after 1 s cut out of 5–10, it is 5–9 in the draft', () => {
  open(limited(5, 10))
  assert.equal(call([{ name: 'timeline.cutRanges', params: { ranges: [[6, 7]] } }])[0].applied, true)
  const note = currentDraft()!.project.notes![0]
  assert.deepEqual([note.start, note.end], [5, 9])
  // (Written on the draft: 9.5 lay inside before the cut, it is outside now.)
  assert.equal(call([{ name: 'marker.add', params: { time: 9.5 } }])[0].applied, false)
  const ok = call([{ name: 'marker.add', params: { time: 8.5 } }])[0]
  assert.equal(ok.applied, true, String(ok.reason))
  rejectDraft()
})

test('scope: the limit holds when the draft is accepted after the note is done', () => {
  open(limited(5, 10))
  call([
    { name: 'marker.add', params: { time: 7 } },
    { name: 'marker.add', params: { time: 15 } }
  ])
  S().editNotes((p) => void setNoteStatus(p, p.notes![0].id, 'ready'), false)
  acceptDraft(undefined, 'now')
  assert.deepEqual((S().project.markers ?? []).map((m) => m.time), [7])
})

test('scope: limited to clips — a setting of the named clip is applied, of another clip in the same stretch dropped', () => {
  const p = talk(20)
  const v1 = p.tracks[0]
  p.clips.c1.duration = 10
  p.clips.c2 = clipOf('c2', 'a1', v1.id, 10, 10, 10)
  v1.clipIds = ['c1', 'c2']
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'a1', 'V2', 12, 40, 3)
  open(limited(10, 20, ['c2'], p))
  const [named, other, outside] = call([
    { name: 'clip.setVolume', params: { clipId: 'c2', volume: 0.5 } },
    { name: 'clip.setVolume', params: { clipId: 'b1', volume: 0.5 } },
    { name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.5 } }
  ])
  assert.equal(named.applied, true, String(named.reason))
  assert.equal(other.applied, false)
  assert.match(other.reason!, /clip b1/)
  assert.equal(outside.applied, false)
  rejectDraft()
})

test('scope: a note not yet with the agent, or not limited, limits nothing; straight onto the timeline it holds too', () => {
  const p = talk(20)
  addNote(p, { start: 5, end: 10, kind: 'fix', text: 'open, limited', only: {} })
  const q = addNote(p, { start: 12, end: 14, kind: 'fix', text: 'with the agent, not limited' })
  setNoteStatus(p, q.id, 'agent')
  assert.equal(scopeOf(p), undefined)
  open(limited(5, 10), 'direct')
  const r = directCalls('test', [{ name: 'marker.add', params: { time: 15 } }, { name: 'marker.add', params: { time: 6 } }])
  assert.deepEqual(r.outcomes.map((o) => o.applied), [false, true])
  assert.deepEqual((S().project.markers ?? []).map((m) => m.time), [6])
})

test('scopeBreach: shifts are no change; a new track is allowed; a trim inside the stretch is', () => {
  const p = talk(20)
  const q: Project = { ...p, clips: { ...p.clips, c1: { ...p.clips.c1, start: 2 } } }
  const scope = [{ id: 'x', num: 1, start: 5, end: 10 }]
  assert.equal(scopeBreach(p, q, { name: 'marker.add', params: { time: 6 }, scope }), null)
  const t: Project = { ...p, clips: { ...p.clips, c1: { ...p.clips.c1, duration: 8 } } }
  assert.match(scopeBreach(p, t, { name: 'clip.trimEnd', params: { clipId: 'c1' }, scope }) ?? '', /changes clip c1 at 8\.00–20\.00 s/)
  const u: Project = { ...p, clips: { ...p.clips, c1: { ...p.clips.c1, start: 6, inPoint: 6, duration: 14 } } }
  assert.equal(scopeBreach(p, { ...u, clips: { ...u.clips, c1: { ...u.clips.c1, start: 6 } } }, { name: 'clip.trimHead', params: { clipId: 'c1' }, scope: [{ id: 'x', num: 1, start: 0, end: 10 }] }), null)
  const w: Project = { ...p, tracks: [...p.tracks, { id: 'V9', kind: 'video', name: 'V9', clipIds: [] }] }
  assert.equal(scopeBreach(p, w, { name: 'track.add', params: {}, scope }), null)
})

test('a note\'s limit is kept through the file and made safe when read', () => {
  const p = talk(20)
  ;(p as { notes?: unknown }).notes = [
    { id: 'n1', num: 1, start: 1, end: 2, kind: 'fix', text: 'a', status: 'open', created: '2026-11-22T00:00:00.000Z', only: {} },
    { id: 'n2', num: 2, start: 3, end: 4, kind: 'fix', text: 'b', status: 'open', created: '2026-11-22T00:00:00.000Z', only: { clips: ['c1', 'c1', 7] } },
    { id: 'n3', num: 3, start: 5, end: 6, kind: 'fix', text: 'c', status: 'open', created: '2026-11-22T00:00:00.000Z', only: 'yes' }
  ]
  sanitizeNotes(p)
  assert.deepEqual(p.notes!.map((n) => n.only), [{}, { clips: ['c1'] }, undefined])
})
