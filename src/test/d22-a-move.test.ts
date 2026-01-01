// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, item 1 (the audit's A1 and K8): "move all the videos 10 s
// later". The auditor's scene — three clips in a row on V1, each with its
// sound linked on A1, one clip on V2 — and the five ways an agent says it.
// Each one gives the right timeline, or is refused with what to send
// instead; none leaves a silently wrong timeline. Then the command itself
// (a group move, `push`, a packed track) and the batch (shifts written one
// after another are one move).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBatch, commandByName, CommandError, mergedMove, moveGroups, runCommand } from '../renderer/src/commands'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Project } from '../renderer/src/types'
import { rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { agentTools, opsHelp } from '../renderer/src/agent/tools'
import { clipOf, ctxOf, open, read, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})

/** V1: a 0–4, b 4–8, c 8–12, each with its sound on A1 (as, bs, cs); V2: d 2–6. */
function scene(): Project {
  const p = defaultProject()
  p.name = 'Scene'
  p.assets = [videoAsset('talk', 100), videoAsset('other', 100)]
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b', 'c'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs', 'cs'] }
  ]
  const pair = (id: string, start: number, link: string) => ({ [id]: clipOf(id, 'talk', 'V1', start, start, 4, { linkId: link, audioExtracted: true }), [`${id}s`]: clipOf(`${id}s`, 'talk', 'A1', start, start, 4, { linkId: link }) })
  p.clips = { ...pair('a', 0, 'L1'), ...pair('b', 4, 'L2'), ...pair('c', 8, 'L3'), d: clipOf('d', 'other', 'V2', 2, 0, 4) }
  p.captions = []
  return p
}
const WANT = { a: 10, as: 10, b: 14, bs: 14, c: 18, cs: 18, d: 12 }
const starts = (p: Project = S().project): Record<string, number> => Object.fromEntries(Object.keys(WANT).map((k) => [k, +p.clips[k].start.toFixed(3)]))
const edit = (ops: Record<string, unknown>[]): Promise<string> => editTool({ ops, base: read() }, ctxOf())
const move = commandByName('clip.move')

test('A1 (F): one op, clipIds + by: every clip 10 s later, sounds with them, one undo step', async () => {
  open(scene(), 'direct')
  const depth = S().past.length
  const out = await edit([{ op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10 }])
  assert.deepEqual(starts(), WANT)
  assert.equal(S().past.length, depth + 1, 'one undo step')
  assert.match(out, /^Applied \(one undo step\): clip\.move\. Length 12\.00 → 22\.00 s/)
  assert.doesNotMatch(out, /left in place/)
  S().undo()
  assert.deepEqual(starts(), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8, d: 2 })
})

test('A1 (D): the four moves in one call are one move — nothing is dropped', async () => {
  open(scene(), 'direct')
  const depth = S().past.length
  const out = await edit(['a', 'b', 'c', 'd'].map((id) => ({ op: 'clip.move', clipId: id, by: 10 })))
  assert.deepEqual(starts(), WANT)
  assert.equal(S().past.length, depth + 1)
  assert.doesNotMatch(out, /Dropped/)
  // The same, in a draft: the draft holds the right timeline, the live one is untouched.
  open(scene(), 'draft')
  await edit(['a', 'b', 'c', 'd'].map((id) => ({ op: 'clip.move', clipId: id, by: 10, linkAV: true })))
  assert.deepEqual(starts(), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8, d: 2 })
  const { currentDraft } = await import('../renderer/src/agent/drafts')
  assert.deepEqual(starts(currentDraft()!.project), WANT)
  rejectDraft()
})

test('A1 (A, B): one clip.move per clip in timeline order: the first is refused and says what to send; following it gives the right timeline', async () => {
  for (const extra of [{}, { linkAV: true }]) {
    open(scene(), 'direct')
    const first = await edit([{ op: 'clip.move', clipId: 'a', by: 10, ...extra }])
    assert.match(first, /^Nothing applied/)
    assert.match(first, /it would land on c \(V1 8\.00–12\.00\) and move 2 clips that are not named \(c, cs\)\. To shift several clips and keep their spacing, name them all in ONE op: clipIds:\[…\] with by\. To put it there and move those later, send push:true/)
    assert.deepEqual(starts(), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8, d: 2 }, 'nothing moved')
    // The agent does what the refusal says.
    await edit([{ op: 'clip.move', clipIds: ['a', 'b', 'c', 'd'], by: 10, ...extra }])
    assert.deepEqual(starts(), WANT)
  }
})

test('A1 (C): last to first, one call each: right, and the linked sounds come along without linkAV being sent', async () => {
  open(scene(), 'direct')
  for (const id of ['c', 'b', 'a', 'd']) assert.match(await edit([{ op: 'clip.move', clipId: id, by: 10 }]), /^Applied/)
  assert.deepEqual(starts(), WANT)
})

test('A1 (E): start:10 for each: a and b are refused (they would land on c); no order is turned round silently', async () => {
  open(scene(), 'direct')
  const answers: string[] = []
  for (const id of ['a', 'b']) answers.push(await edit([{ op: 'clip.move', clipId: id, start: 10 }]))
  for (const a of answers) assert.match(a, /^Nothing applied[^]*it would land on c /)
  assert.deepEqual(starts(), { a: 0, as: 0, b: 4, bs: 4, c: 8, cs: 8, d: 2 })
  // push:true is the insert a drag makes: said, and the answer lists every clip that moved.
  const pushed = await edit([{ op: 'clip.move', clipId: 'a', start: 10, push: true }])
  assert.match(pushed, /Moved: [^\n]*a 0\.00→10\.00[^\n]*c 8\.00→14\.00/)
  assert.deepEqual([S().project.clips.a.start, S().project.clips.as.start, S().project.clips.c.start, S().project.clips.cs.start], [10, 10, 14, 14])
})

test('A1: linkAV false moves the picture alone, and the answer says its sound stayed', async () => {
  open(scene(), 'direct')
  const out = await edit([{ op: 'clip.move', clipId: 'c', by: 10, linkAV: false }])
  assert.deepEqual([S().project.clips.c.start, S().project.clips.cs.start], [18, 8])
  assert.match(out, /Linked partner\(s\) left in place, out of step now: cs/)
})

test('A1: shifts of different amounts in one call: the first is applied, the other is dropped with its number and what to do', async () => {
  open(scene(), 'direct')
  const out = await edit([{ op: 'clip.move', clipId: 'c', by: 10 }, { op: 'clip.move', clipId: 'd', by: 5 }, { op: 'clip.move', clipId: 'b', by: 10 }])
  // (#1 and #3 are one move; #2 is another amount.)
  assert.deepEqual([S().project.clips.b.start, S().project.clips.c.start, S().project.clips.d.start], [14, 18, 2])
  assert.match(out, /Dropped \(the rest was applied\):\n#2 clip\.move: [^\n]*send it in a call of its own/)
  // A merged move that is dropped names every op it was.
  open(scene(), 'direct')
  const no = await edit([{ op: 'clip.move', clipId: 'a', by: 2 }, { op: 'clip.move', clipId: 'd', by: 2 }])
  assert.match(no, /^Nothing applied[^]*\n#1 #2 clip\.move: it would land on b /)
})

test('clip.move by name: a group keeps its spacing; push false refuses, the default pushes (the editor\'s drag)', () => {
  const p = scene()
  const g = runCommand(p, move, { clipIds: ['a', 'b', 'c'], by: 10, linkAV: true }).project
  assert.deepEqual([g.clips.a.start, g.clips.b.start, g.clips.c.start, g.clips.as.start, g.clips.cs.start, g.clips.d.start], [10, 14, 18, 10, 18, 2])
  // Without the link the named clips move alone.
  const alone = runCommand(p, move, { clipIds: ['a', 'b', 'c'], by: 10 }).project
  assert.deepEqual([alone.clips.a.start, alone.clips.as.start], [10, 0])
  // The command's own default is the drag's: it pushes.
  const pushed = runCommand(p, move, { clipId: 'a', by: 10 }).project
  assert.deepEqual([pushed.clips.a.start, pushed.clips.c.start], [10, 14])
  assert.throws(() => runCommand(p, move, { clipId: 'a', by: 10, push: false }), /it would land on c /)
  // A part of a row that would land on the rest of it.
  assert.throws(() => runCommand(p, move, { clipIds: ['a', 'b'], by: 2, push: false }), /it would land on c /)
  assert.deepEqual(runCommand(p, move, { clipIds: ['b', 'c'], by: 3, push: false, linkAV: true }).project.clips.bs.start, 7)
  // Wrong shapes, each said.
  assert.throws(() => runCommand(p, move, { by: 1 }), /give one of clipId \(one clip\) or clipIds/)
  assert.throws(() => runCommand(p, move, { clipId: 'a', clipIds: ['b'], by: 1 }), /give one of clipId/)
  assert.throws(() => runCommand(p, move, { clipIds: ['a', 'b'], start: 3 }), /with clipIds give by/)
  assert.throws(() => runCommand(p, move, { clipIds: ['a', 'nope'], by: 1 }), /there is no clip "nope"/)
  // A group is not squeezed against 0.
  assert.throws(() => runCommand(p, move, { clipIds: ['b', 'c', 'd'], by: -3 }), /by -3 would put d before 0 \(it starts at 2\.00 s\): at most -2\.00/)
  // With push a group's clip may land on one that stays, which moves later…
  const ins = runCommand(p, move, { clipIds: ['c', 'd'], by: -2, push: true, linkAV: true }).project
  assert.deepEqual([ins.clips.c.start, ins.clips.cs.start, ins.clips.b.start, ins.clips.bs.start, ins.clips.d.start], [6, 6, 10, 10, 0])
  // …but never so that the group's own clips lose their spacing.
  assert.throws(() => runCommand(p, move, { clipIds: ['b', 'c', 'd'], by: -2, push: true }), /c would not land where asked: a clip that stays is in the way/)
  // A locked track holds its clips.
  const locked = scene()
  locked.tracks[2].locked = true
  assert.throws(() => runCommand(locked, move, { clipIds: ['a', 'b', 'c'], by: 10, linkAV: true }), /linked to "as" on a locked track/)
})

test('clip.move on a packed track (the magnet): a shift that cannot be made is said, with why', () => {
  const p = scene()
  p.tracks[1].autoPack = true
  for (const id of ['as', 'bs', 'cs']) delete p.clips[id].linkId
  for (const id of ['a', 'b', 'c']) delete p.clips[id].linkId
  assert.throws(() => runCommand(p, move, { clipIds: ['a', 'b', 'c'], by: 10 }), /nothing would move: track V1 keeps its clips joined from 0 \(its magnet is on\)/)
  assert.throws(() => runCommand(p, move, { clipId: 'c', start: 0, push: false }), /track V1 keeps its clips joined \(its magnet is on\): this would only change their order and move a, b/)
  const re = runCommand(p, move, { clipId: 'c', start: 0, push: true }).project
  assert.deepEqual([re.clips.c.start, re.clips.a.start, re.clips.b.start], [0, 4, 8])
  // The same with the sounds linked (an agent's default): the pictures are
  // held, so the pairs cannot move together — said as the magnet, too.
  const linked = scene()
  linked.tracks[1].autoPack = true
  // (Never in part: d, on a free track, does not move alone.)
  assert.throws(() => runCommand(linked, move, { clipIds: ['a', 'b', 'c', 'd'], by: 10, linkAV: true, push: false }), /a, b, c, as \+2 would not move: track V1 keeps its clips joined from 0 \(its magnet is on\), so they cannot be shifted\. Switch it off first with track\.setMagnet\{trackId:"V1",on:false\}/)
  assert.throws(() => runCommand(linked, move, { clipIds: ['a', 'b', 'c'], by: 10, linkAV: true }), /nothing would move: track V1 keeps its clips joined from 0/)
  // A clip there sent somewhere the track will not put it.
  assert.throws(() => runCommand(linked, move, { clipId: 'c', by: 10, push: false }), /nothing would move: track V1 keeps its clips joined from 0/)
})

test('K8: in a batch, shifts written one after another are one move (in either order); other calls keep their sequence', () => {
  for (const order of [['a', 'b', 'c'], ['c', 'b', 'a']]) {
    const { project, results } = applyBatch(scene(), order.map((id) => ({ name: 'clip.move', params: { clipId: id, by: 10 } })))
    assert.deepEqual([project.clips.a.start, project.clips.b.start, project.clips.c.start], [10, 14, 18], order.join())
    assert.equal(results.length, 3, 'one result per call, as before')
  }
  // The store's batch: one undo step.
  S().loadProject(scene())
  const depth = S().past.length
  S().runBatch(['a', 'b', 'c'].map((id) => ({ name: 'clip.move', params: { clipId: id, by: 10 } })))
  assert.deepEqual([S().project.clips.a.start, S().project.clips.c.start], [10, 18])
  assert.equal(S().past.length, depth + 1)
  // What is one move, and what is not.
  const calls = (list: Record<string, unknown>[]) => list.map((params) => ({ name: 'clip.move', params }))
  assert.deepEqual(moveGroups(calls([{ clipId: 'a', by: 10 }, { clipId: 'b', by: 10 }, { clipIds: ['c', 'd'], by: 10 }]), true), [[0, 1, 2]])
  assert.deepEqual(mergedMove([{ clipId: 'a', by: 10, push: false }, { clipIds: ['b', 'a'], by: 10, push: false }]), { by: 10, push: false, clipIds: ['a', 'b'] })
  assert.deepEqual(moveGroups(calls([{ clipId: 'a', by: 10 }, { clipId: 'b', by: 5 }, { clipId: 'c', by: 10 }]), true), [], 'another amount between them: a sequence')
  assert.deepEqual(moveGroups(calls([{ clipId: 'a', by: 10 }, { clipId: 'b', by: 5 }, { clipId: 'c', by: 10 }]), false), [[0, 2]], 'an agent\'s call: all in one version\'s times')
  assert.deepEqual(moveGroups(calls([{ clipId: 'a', by: 10 }, { clipId: 'a', by: 10 }]), true), [], 'the same clip twice is two shifts of it')
  assert.deepEqual(moveGroups(calls([{ clipId: 'a', by: 10 }, { clipId: 'b', start: 10 }, { clipId: 'c', by: 10, linkAV: true }]), false), [], 'a start, another link')
  assert.deepEqual(moveGroups([{ name: 'clip.move', params: { clipId: 'a', by: 1 } }, { name: 'marker.add', params: { time: 1 } }, { name: 'clip.move', params: { clipId: 'b', by: 1 } }], true), [])
  // The same clip shifted twice in a batch is still two shifts.
  assert.equal(applyBatch(scene(), calls([{ clipId: 'd', by: 3 }, { clipId: 'd', by: 3 }])).project.clips.d.start, 8)
  // A failing merged move says the first call's number.
  assert.throws(() => applyBatch(scene(), [{ name: 'marker.add', params: { time: 1 } }, ...calls([{ clipId: 'a', by: 2, push: false }, { clipId: 'd', by: 2, push: false }])]), (e: unknown) => e instanceof CommandError && /#2 clip\.move failed/.test(e.message))
})

test('the tool list says it: clipIds, the link, the refusal and push — and no word of how anything should look', () => {
  const desc = agentTools().find((t) => t.name === 'edit')!.description
  assert.match(desc, /^clip\.move\{clipId\|clipIds:\[s\],start:t\|by:n\(s\),linkAV\?:bool,push\?:bool\} to start, or by ± s \(clipIds: all at once, spacing kept\)\. Linked picture\/sound go along \(linkAV false: not\)\. Landing on other clips is refused \(push true: they move later\)$/m)
  // help says the same (the agent's defaults, not the editor's).
  assert.match(opsHelp(['clip.move']), /^clip\.move\{clipId\|clipIds:\[s\],[^\n]*Linked picture\/sound go along \(linkAV false: not\)/)
  // The words an agent reads of a move name no look, colour, font or layout (ANA-PLAN, principle 6).
  assert.doesNotMatch(desc.split('\n').find((l) => l.startsWith('clip.move'))!, /colou?r|font|style|layout|look|design|animat/i)
})
