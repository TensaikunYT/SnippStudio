// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, item 4 (the audit's A13): what an agent's edit did is said
// in the user's words — the toast after a change made straight on the
// timeline, the mark it leaves there and the Steps list no longer show the
// command's name ("Agent: clip.move", "Edited: clip.move").
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Project } from '../renderer/src/types'
import { draftChanges } from '../renderer/src/agent/draft-words'
import { rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { changeText, editSaid, saidOf } from '../renderer/src/agent/said'
import { useAgentStore, type ToolEvent } from '../renderer/src/agent/store'
import { stepText } from '../renderer/src/components/agent/AgentTab'
import { STRINGS_D22_A } from '../renderer/src/ui/strings-d22-a'
import { clipOf, ctxOf, open, read, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
  S().setUiLang('en')
})

/** V1: a 0–4 and b 4–8 of talk.mp4, each with its sound on A1; V2: d 2–6 of other.mp4. */
function scene(): Project {
  const p = defaultProject()
  p.assets = [videoAsset('talk', 100), videoAsset('other', 100)]
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: ['d'] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['a', 'b'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: ['as', 'bs'] }
  ]
  p.clips = {
    a: clipOf('a', 'talk', 'V1', 0, 0, 4, { linkId: 'L1', audioExtracted: true }),
    as: clipOf('as', 'talk', 'A1', 0, 0, 4, { linkId: 'L1' }),
    b: clipOf('b', 'talk', 'V1', 4, 4, 4, { linkId: 'L2', audioExtracted: true }),
    bs: clipOf('bs', 'talk', 'A1', 4, 4, 4, { linkId: 'L2' }),
    d: clipOf('d', 'other', 'V2', 2, 0, 4)
  }
  p.captions = []
  return p
}

test('A13: a change made straight on the timeline: the toast and the timeline\'s mark say what changed, not the command', async () => {
  S().setUiLang('en')
  open(scene(), 'direct')
  const told: string[] = []
  const ctx = ctxOf({ told: (what) => void told.push(what), words: editSaid })
  const answer = await editTool({ ops: [{ op: 'clip.move', clipId: 'd', by: 10 }], base: read() }, ctx)
  assert.deepEqual(told, ['other.mp4 moves 10 s later (0:02 → 0:12)'])
  assert.equal(useAgentStore.getState().flash?.label, told[0], 'the mark on the timeline says the same')
  assert.match(answer, /^Applied \(one undo step\): clip\.move\./, 'the agent still reads the command it sent')
  // Several changes: the first, and how many more (a linked pair is one change).
  await editTool({ ops: [{ op: 'clip.move', clipIds: ['a', 'b', 'd'], by: 20 }], base: read() }, ctx)
  assert.equal(told[1], 'talk.mp4 moves 20 s later (0:00 → 0:20), with its sound, and 2 more')
  for (const said of told) assert.doesNotMatch(said, /clip\.|\bop\b/)
  // In Turkish, the same sentence the draft card says.
  S().setUiLang('tr')
  await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'd', volume: 0.5 }], base: read() }, ctx)
  // (D22, worker C: a setting names what was set, the audit's A4.)
  assert.equal(told[2], 'other.mp4: ses %100 → %50')
  S().setUiLang('en')
  // Without the words (a ready job's own context): the label, as before.
  const plain: string[] = []
  await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'd', volume: 0.8 }], base: read() }, ctxOf({ told: (what) => void plain.push(what) }))
  assert.deepEqual(plain, ['clip.setVolume (1 clip, 32.00–36.00 s)'])
})

test('A13: a draft\'s call is given its words too (the Steps list), and nothing is said of a call that applied nothing', async () => {
  open(scene(), 'draft')
  const said: string[] = []
  const ctx = ctxOf({ words: (before, after, cuts) => { const s = editSaid(before, after, cuts); said.push(s); return s } })
  await editTool({ ops: [{ op: 'marker.add', time: 3, note: 'here' }, { op: 'text.add', time: 1, text: 'Hello' }], base: read() }, ctx)
  assert.deepEqual(said, ['A title "Hello" is added at 0:01, and 1 more'])
  const no = await editTool({ ops: [{ op: 'clip.move', clipId: 'a', by: 2 }], base: read() }, ctx)
  assert.match(no, /^Nothing applied/)
  assert.equal(said.length, 1)
  rejectDraft()
})

test('A13: the sentences: one per change, a partner\'s row is not one; a change with nothing to show', () => {
  const live = scene()
  const after = structuredClone(live)
  after.clips.a.start = 10
  after.clips.as.start = 10
  const ch = draftChanges(live, after, [])
  assert.deepEqual(ch.map(changeText), ['talk.mp4 moves 10 s later (0:00 → 0:10), with its sound', ''])
  assert.equal(saidOf(ch), 'talk.mp4 moves 10 s later (0:00 → 0:10), with its sound')
  assert.equal(editSaid(live, live, []), 'a change that does not show on the timeline')
  for (const [k, v] of Object.entries(STRINGS_D22_A)) {
    assert.ok(v.en && v.tr, k)
    assert.deepEqual([...v.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...v.tr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${k}: the same parameters in both languages`)
  }
})

test('A13: the Steps list: "Edited: <what changed>"; an edit of which nothing was applied names no command', () => {
  const ev = (extra: Partial<ToolEvent>): ToolEvent => ({ id: '1', session: 's', tool: 'edit', kind: 'clip.move', started: 0, done: true, ...extra })
  assert.equal(stepText(ev({ said: 'other.mp4 moves 10 s later (0:02 → 0:12)' })), 'Edited: other.mp4 moves 10 s later (0:02 → 0:12)')
  assert.equal(stepText(ev({ nothing: true })), 'An edit of which nothing was applied')
  // (An event without the words — written before this change — keeps the old line.)
  assert.equal(stepText(ev({})), 'Edited: clip.move')
  // The store keeps the words with the call.
  const st = useAgentStore.getState()
  st.callStarted({ id: 'c-said', session: 's', tool: 'edit', kind: 'clip.move', client: 'test', defsChars: 0 })
  st.callFinished('c-said', { said: 'x moves' })
  assert.equal(useAgentStore.getState().events.find((e) => e.id === 'c-said')?.said, 'x moves')
  st.callStarted({ id: 'c-none', session: 's', tool: 'edit', kind: 'clip.move', client: 'test', defsChars: 0 })
  st.callFinished('c-none', { said: 'x', nothing: true })
  assert.equal(useAgentStore.getState().events.find((e) => e.id === 'c-none')?.said, undefined)
})
