// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker C, the second pass (the coordinator's notes after the merge):
//   - why an operation is not applied is said to the USER in their own
//     language (agent/drop-words.ts): every reason the replay gives has a
//     sort, every sort a sentence in both languages; the agent's own
//     sentence is not changed;
//   - "After" is read-only: an edit of the film is refused by the film's
//     gate (state/shared.ts), whichever way it comes; notes, undo and an
//     agent's landing are not;
//   - the project answer says which tracks have their magnet on (one word),
//     and the tool definitions are no bigger for it;
//   - a cut of several ranges lists them (one can be taken out); an item's
//     end (the strip's "play this change");
//   - the agent's last direct change is remembered with the version it left
//     (the bar's Undo takes exactly that back).
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { filmGate } from '../renderer/src/state/shared'
import { DROP_KINDS, dropKey, dropKind } from '../renderer/src/agent/drop-words'
import { acceptDraft, draftState, rejectDraft, removeRange, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { projectText } from '../renderer/src/agent/format'
import { itemEnd, itemStart, marksFor } from '../renderer/src/agent/marks'
import { useAgentStore } from '../renderer/src/agent/store'
import { STRINGS } from '../renderer/src/ui/strings'
import { clipOf, ctxOf, open, read, talk, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
  filmGate.refuses = null
})

test('every reason the replay gives has a sort the user is told in their own words', () => {
  const strings = STRINGS as Record<string, { en: string; tr?: string }>
  for (const k of DROP_KINDS) assert.ok(strings[`d22c.drop.${k}`]?.en && strings[`d22c.drop.${k}`]?.tr, `d22c.drop.${k} in both languages`)
  const cases: [string, string][] = [
    ['track V1 is locked: left as it is', 'locked'],
    ['a track was locked or unlocked since you read the project and this edit depends on how everything lies: read again and resend', 'locked'],
    ['the project was changed since you read it (not by you) and this edit depends on how everything lies: read again and resend (an edit like this holds only while no one else changes the film)', 'filmChanged'],
    ['the project is not as it was when this was sent and it depends on how everything lies: read again and resend (an edit like this holds only while no one else changes the film)', 'filmChanged'],
    ['its ids and times are of the version you read, and an earlier edit of yours (#2 clip.setVolume of this call) moved or cut what was there (it also changes subtitles): send it in a call of its own, after reading again (what only ADDS — a clip, a title, a track — does not move anything)', 'ownEarlier'],
    ['volume of this clip was changed after you read it (not by you)', 'youChanged'],
    ['the text of this line was changed after you read it (not by you)', 'youChanged'],
    ['nothing to do: the project already is as this would make it', 'already'],
    ['nothing left to do: the clip already ends there', 'already'],
    ['content was removed: c7 is no longer on the timeline', 'gone'],
    ['the clip was cut in pieces: part of it is in c9 now', 'pieces'],
    ['the footage at its time is on the timeline more than once', 'twice'],
    ['a word one of its times was given by is gone, was changed or is there twice: read again and resend', 'twice'],
    ['a word of line L1 this marks is no longer in it', 'words'],
    ['it would now also change other clips', 'wouldAlso'],
    ['its point is within 0.05 s of a clip edge now', 'edge'],
    ['it would land on c (V1 8.00–12.00) and move 2 clips that are not named (c, cs). To shift several clips and keep their spacing, name them all in ONE op', 'lands'],
    ['the magnet of track V1 is on: its clips stay joined from 0', 'magnet'],
    ['call #1, which it was written on, was not accepted: resend if still wanted (dropped)', 'dependsOn'],
    ['track V1 is locked: left as it is (dropped before your later edit; the user can bring it back)', 'later'],
    ['internal error, not applied (x is not a function)', 'internal'],
    ['no item is chosen (only / except / include leave nothing; uncertain items need "include")', 'noChoice'],
    ['some sentence nobody wrote a sort for', 'other']
  ]
  for (const [reason, kind] of cases) assert.equal(dropKind(reason), kind, reason)
  assert.equal(dropKey('track V1 is locked: left as it is'), 'd22c.drop.locked')
  // What the user reads names no command and no id.
  for (const k of DROP_KINDS) for (const lang of ['en', 'tr'] as const) assert.doesNotMatch(strings[`d22c.drop.${k}`][lang]!, /clip\.|op #|\bv \w+-\d+|resend/)
  // The page shows the sort's sentence, and the agent's own only under "Details".
  const strip = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'components', 'agent', 'ReviewStrip.tsx'), 'utf8')
  assert.match(strip, /t\(dropKey\(d\.reason\)\)/)
  assert.match(strip, /details === i && !d\.rejected && \(\s*<span className="agent-rev-dropped-raw"/)
})

test('"After" is read-only: the film\'s gate refuses an edit of the film, not a note, an undo or a landing', async () => {
  open(talk(20), 'draft')
  const c1 = (): { volume: number; start: number } => S().project.clips.c1
  // No gate: an edit is made.
  S().setClipVolume('c1', 0.8)
  const edited = c1().volume
  let asked = 0
  filmGate.refuses = () => {
    asked++
    return true
  }
  const v0 = S().projectVersion
  const before = S().project
  S().deleteClips(['c1'], false)
  assert.ok(S().project.clips.c1, 'Delete is not made')
  S().moveClip('c1', 5)
  assert.equal(c1().start, 0, 'a move is not made')
  assert.equal(S().projectVersion, v0)
  assert.equal(S().project, before, 'the project is the very same')
  assert.ok(asked >= 1, 'the gate was asked (it tells the user)')
  // Undo is not an edit of this kind.
  assert.equal(edited, 0.8)
  S().undo()
  assert.equal(c1().volume, 1, 'undo goes back while the gate is closed')
  S().redo()
  assert.equal(c1().volume, 0.8, '… and redo')
  // A work note is not the film.
  const asked0 = asked
  S().startNoteDraft({ start: 1, end: 2 })
  S().patchNoteDraft({ text: 'look here', kind: 'fix' })
  S().saveNoteDraft()
  assert.equal((S().project.notes ?? []).length, 1, 'a note is written')
  assert.equal(asked, asked0, 'the gate is not asked for a note')
  // With the gate open again the edit is made.
  filmGate.refuses = null
  S().deleteClips(['c1'], false)
  assert.equal(S().project.clips.c1, undefined)
})

test('the gate lets an agent\'s accepted draft land (the one who sets it says so)', async () => {
  open(talk(20), 'draft')
  await editTool({ ops: [{ op: 'marker.add', time: 3 }], base: read() }, ctxOf())
  // (As components/agent/shown.ts sets it: closed, but for a landing.)
  const { adoptingNow } = await import('../renderer/src/agent/drafts')
  filmGate.refuses = () => !adoptingNow()
  const out = acceptDraft(undefined, 'now')
  filmGate.refuses = null
  assert.ok(out.version !== null)
  assert.equal((S().project.markers ?? []).length, 1)
})

test('the project answer says a track\'s magnet (one word, only when it is on)', () => {
  const p = talk(20)
  const text = (): string => projectText(p, { version: 'x-1', state: 'live' })
  const row = (): string => text().split('\n').find((l) => l.startsWith(`${p.tracks[0].id} `)) ?? ''
  p.tracks[0].autoPack = false
  assert.doesNotMatch(text(), /magnet/)
  const off = text().length
  p.tracks[0].autoPack = true
  assert.match(row(), /\(video,magnet\): 1 clip$/)
  assert.equal(text().length - off, ',magnet'.length, 'seven characters for a track whose magnet is on')
  p.tracks[0].locked = true
  assert.match(row(), /\(video,locked,magnet\)/)
})

test('a cut of several ranges lists them (one can be taken out); where an item ends', async () => {
  const p = talk(20)
  p.assets.push(videoAsset('b1'))
  p.clips.x = clipOf('x', 'b1', p.tracks[0].id, 30, 0, 4)
  p.tracks[0].clipIds.push('x')
  open(p, 'draft')
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[2, 3], [10, 12]] }, { op: 'clip.setVolume', clipId: 'x', volume: 0.5 }], base: read() }, ctxOf())
  let view = useAgentStore.getState().draft!
  assert.deepEqual(view.items![0].ranges, [[2, 3], [10, 12]])
  assert.equal(view.items![1].ranges, undefined, 'only a cut has ranges')
  const d = draftState()!
  const after = marksFor('after', d.on, d.project, view.marks!.cuts, view.items!)
  // The setting: the clip, where the draft has it (30 − 3 s cut = 27), to its end.
  assert.equal(itemStart(after, 1, d.project), 27)
  assert.equal(itemEnd(after, 1, d.project), 31)
  // The cut: after it, a join (its start and its end are one moment).
  assert.deepEqual([itemStart(after, 0, d.project), itemEnd(after, 0, d.project)], [2, 9], 'its two joins: 2 s, and 10 − 1 s')
  // One range taken out: the other stays, the item lists no ranges any more.
  assert.equal(removeRange(1, 0, 1), true)
  view = useAgentStore.getState().draft!
  assert.equal(view.items![0].ranges, undefined)
  assert.deepEqual(view.items![0].cuts, [[2, 3]])
})

test('the agent\'s last direct change is kept with the version it left (the bar\'s Undo)', async () => {
  open(talk(20), 'direct')
  useAgentStore.getState().setLastDirect(null)
  await editTool({ ops: [{ op: 'marker.add', time: 3 }], base: read() }, ctxOf({ words: () => 'a marker' }))
  const last = useAgentStore.getState().lastDirect
  assert.ok(last, 'kept')
  assert.equal(last!.version, S().projectVersion, 'the project stands where that change left it')
  // The user edits: the project has moved on, the bar no longer offers that Undo.
  S().setTime(5)
  S().addMarkerAtPlayhead()
  assert.equal((S().project.markers ?? []).length, 2)
  assert.notEqual(useAgentStore.getState().lastDirect!.version, S().projectVersion)
  // A draft's call does not set it.
  open(talk(20), 'draft')
  useAgentStore.getState().setLastDirect(null)
  await editTool({ ops: [{ op: 'marker.add', time: 3 }], base: read() }, ctxOf())
  assert.equal(useAgentStore.getState().lastDirect, null)
})
