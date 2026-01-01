// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// D22, worker A, items 2 and 4 (the audit's A2 / K2 and A8): the inbox has a
// recipient. What the user sends goes to the agent working on the project
// (the one that holds it, else the one the user picked), the answer on a
// draft to the draft's owner, and an agent that is neither is told whose the
// project is and takes no notes. The rules, pure (inbox.ts, holder.ts,
// wait.ts, notes-tool.ts); the whole of it with two scripted agent programs
// over real HTTP is scripts/e2e/scenarios/d22-a-two-agents.mjs.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type WorkNote } from '../renderer/src/types'
import { agentDisplayName, checkWriter, chooseAgent, forgetHolderSession, handTo, otherAgent, useHolder, workingAgent } from '../renderer/src/agent/holder'
import { dropItemsTo, emptyInbox, isFor, pushItem, resetInbox, sendToInbox, takeItems, useInbox, waitForItems, watchInboxProject } from '../renderer/src/agent/inbox'
import { notesListText, notesReadOnly } from '../renderer/src/agent/notes-tool'
import { NOTHING_YET, waitedForNothing, withOther } from '../renderer/src/agent/wait'

const CLAUDE = 'claude-code'
const CODEX = 'codex-mcp-client'
const freeHolder = (): void => useHolder.setState({ holder: null, asked: [], handedOff: {}, chosen: null })
const texts = (items: readonly { kind: string; text?: string }[] | null): string[] => (items ?? []).map((i) => (i.kind === 'task' ? i.text ?? '' : i.kind))

test('the rule: an item with a name is that program\'s; another goes to the working agent; with none, to whoever waits', () => {
  assert.equal(isFor({}, CODEX, null), true, 'nobody works on it: the first that waits')
  assert.equal(isFor({}, CODEX, CLAUDE), false)
  assert.equal(isFor({}, CLAUDE, CLAUDE), true)
  assert.equal(isFor({ to: CLAUDE }, CODEX, CODEX), false, 'a named item is not the working agent\'s')
  assert.equal(isFor({ to: CLAUDE }, CLAUDE, CODEX), true)
  const box = emptyInbox()
  pushItem(box, { kind: 'task', text: 'for the working agent' }, 1)
  pushItem(box, { kind: 'draft', outcome: 'rejected', to: CLAUDE }, 2)
  pushItem(box, { kind: 'draft', outcome: 'accepted', to: CODEX }, 3)
  assert.deepEqual(takeItems(box, CODEX, CLAUDE).map((i) => i.id), [3], 'Codex gets only the answer on its own draft')
  assert.deepEqual(box.items.map((i) => i.id), [1, 2], 'the rest stays in line')
  assert.deepEqual(takeItems(box, CLAUDE, CLAUDE).map((i) => i.id), [1, 2])
  assert.deepEqual(takeItems(box, CLAUDE, CLAUDE), [], 'none twice')
  assert.equal(box.delivered, 3)
})

test('the working agent: the holder, else the user\'s pick; a pick decides who may become the holder', () => {
  freeHolder()
  const live = (): boolean => true
  assert.equal(workingAgent(), null)
  // The pick before anyone changed the project: only that program becomes the holder.
  chooseAgent(CODEX)
  assert.equal(workingAgent(), CODEX)
  assert.throws(() => checkWriter('s-claude', CLAUDE, live), /The user chose another agent \(Codex\) to work on this project/)
  assert.deepEqual(useHolder.getState().asked.map((a) => a.client), [CLAUDE], 'listed: the user can hand it over in one click')
  checkWriter('s-codex', CODEX, live)
  assert.deepEqual(useHolder.getState().holder, { client: CODEX, session: 's-codex' })
  // Picking another while one holds it is the hand-over: the old session is told.
  chooseAgent(CLAUDE)
  assert.deepEqual(useHolder.getState().holder, { client: CLAUDE, session: 's-claude' }, 'the session that asked holds it now')
  assert.equal(useHolder.getState().handedOff['s-codex'], CLAUDE)
  assert.equal(useHolder.getState().asked.length, 0)
  assert.equal(workingAgent(), CLAUDE)
  // With a session named, that session holds it.
  chooseAgent(CODEX, 's-codex-2')
  assert.deepEqual(useHolder.getState().holder, { client: CODEX, session: 's-codex-2' })
  // The pick outlives the session; taking it back frees the project.
  forgetHolderSession('s-codex-2')
  assert.equal(workingAgent(), CODEX)
  chooseAgent(null)
  assert.equal(workingAgent(), null)
  // No pick: as before D22 (the first that changes it holds it; handTo makes no pick).
  freeHolder()
  checkWriter('s-claude', CLAUDE, live)
  assert.throws(() => checkWriter('s-codex', CODEX, live), /Another agent \(Claude Code\) is changing this project/)
  assert.ok(handTo(CODEX))
  assert.equal(useHolder.getState().chosen, null)
  assert.equal(workingAgent(), CODEX)
  // A pick goes with the project when it is handed on the old way.
  freeHolder()
  chooseAgent(CLAUDE, 's-claude')
  assert.throws(() => checkWriter('s-codex', CODEX, live), /Another agent \(Claude Code\)/)
  assert.ok(handTo(CODEX))
  assert.equal(useHolder.getState().chosen, CODEX)
  freeHolder()
})

test('a window\'s inbox: a send reaches the working agent\'s wait, not the one that waited first; the tab shows who would get it', async () => {
  resetInbox()
  freeHolder()
  useHolder.setState({ holder: { client: CLAUDE, session: 's-claude' } })
  const until = Date.now() + 4000
  const codex = waitForItems({ call: 'w1', client: CODEX, session: 's-codex', until: Date.now() + 700, stop: () => false })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(useInbox.getState().waiting, null, 'Codex waits, but nothing sent would reach it: not "waiting for you"')
  assert.equal(sendToInbox({ kind: 'task', text: 'shorter intro' }).taken, false, 'in line for Claude')
  assert.equal(useInbox.getState().queued, 1)
  const claude = waitForItems({ call: 'w2', client: CLAUDE, session: 's-claude', until, stop: () => false })
  assert.deepEqual(texts(await claude), ['shorter intro'])
  assert.deepEqual(await codex, [], 'Codex: nothing in its time')
  // The answer on Claude's draft, while only Codex waits: it stays for Claude.
  const codex2 = waitForItems({ call: 'w3', client: CODEX, until: Date.now() + 500, stop: () => false })
  sendToInbox({ kind: 'draft', outcome: 'rejected', text: 'too long', to: CLAUDE })
  assert.deepEqual(await codex2, [])
  assert.deepEqual(texts(await waitForItems({ call: 'w4', client: CLAUDE, until, stop: () => false })), ['draft'])
  // Two chats of the same program wait: the one that holds the project gets it.
  const second = waitForItems({ call: 'w5', client: CLAUDE, session: 's-claude-2', until: Date.now() + 600, stop: () => false })
  const holder = waitForItems({ call: 'w6', client: CLAUDE, session: 's-claude', until, stop: () => false })
  assert.equal(sendToInbox({ kind: 'task', text: 'to the chat that works' }).taken, true)
  assert.deepEqual(texts(await holder), ['to the chat that works'])
  assert.deepEqual(await second, [])
  // Handed on while a task is in line: the new agent's open wait takes it.
  const unwatch = watchInboxProject()
  const w = waitForItems({ call: 'w7', client: CODEX, session: 's-codex', until, stop: () => false })
  assert.equal(sendToInbox({ kind: 'task', text: 'for whoever works on it' }).taken, false)
  useHolder.setState({ holder: { client: CODEX, session: 's-codex' } })
  assert.deepEqual(texts(await w), ['for whoever works on it'])
  // The answer on the draft of an agent that is not the working one is not
  // in the user's line; it stays for that agent — until the project is
  // taken from it (its calls are answered "handed on" from then), or it has
  // no session left.
  sendToInbox({ kind: 'draft', outcome: 'accepted', to: CLAUDE })
  assert.equal(useInbox.getState().queued, 0, 'Codex works on it: nothing is in line for the working agent')
  assert.deepEqual(texts(await waitForItems({ call: 'w8', client: CLAUDE, until, stop: () => false })), ['draft'])
  sendToInbox({ kind: 'draft', outcome: 'rejected', to: CODEX })
  assert.equal(useInbox.getState().queued, 1)
  useHolder.setState({ holder: { client: CLAUDE, session: 's-claude' }, handedOff: { 's-codex': CLAUDE } })
  assert.deepEqual(await waitForItems({ call: 'w9', client: CODEX, until: Date.now() + 300, stop: () => false }), [], 'dropped when the project was taken from Codex')
  unwatch()
  sendToInbox({ kind: 'draft', outcome: 'accepted', to: CLAUDE })
  assert.equal(useInbox.getState().queued, 1)
  dropItemsTo(CLAUDE)
  assert.equal(useInbox.getState().queued, 0)
  // Nobody works on it: the first that waits, as before.
  freeHolder()
  const any = waitForItems({ call: 'w10', client: 'some-agent', until, stop: () => false })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(useInbox.getState().waiting?.client, 'some-agent')
  assert.equal(sendToInbox({ kind: 'task', text: 'x' }).taken, true)
  assert.equal((await any)?.length, 1)
  resetInbox()
})

test('the words of a wait that is not the working agent\'s; it is not a step of work', () => {
  const said = withOther('Claude Code', 'SnippStudio')
  assert.equal(said, 'Nothing for you: this project is with another agent (Claude Code) now, and what the user sends from SnippStudio goes to it. The user can hand the project to you there (Agent tab); until then you can read it. Call wait again to wait for that.')
  assert.ok(waitedForNothing(said))
  assert.ok(waitedForNothing(NOTHING_YET))
  assert.ok(!waitedForNothing('From the user in SnippStudio ("x"):'))
  assert.ok(!waitedForNothing(undefined))
})

test('A8: an agent that is not the working one reads the notes and takes none (the words it is told)', () => {
  freeHolder()
  assert.equal(otherAgent(CODEX), null, 'nobody works on it: it may take them, as before')
  useHolder.setState({ holder: { client: CLAUDE, session: 's-claude' } })
  assert.equal(otherAgent(CODEX), CLAUDE)
  assert.equal(otherAgent(CLAUDE), null)
  useHolder.setState({ holder: null, chosen: CLAUDE })
  assert.equal(otherAgent(CODEX), CLAUDE, 'the user\'s pick, before it changed anything')
  const p = defaultProject()
  p.name = 'Demo'
  p.notes = [{ id: 'n1', num: 1, start: 2, end: 3, kind: 'fix', text: 'too loud', status: 'open', created: '2026-11-22T10:00:00Z' } as unknown as WorkNote]
  const list = notesListText(p, p, null, 'open', 0)
  const said = notesReadOnly(list, agentDisplayName(CLAUDE))
  assert.ok(said.startsWith(list))
  assert.ok(said.endsWith('\nRead only: this project is with another agent (Claude Code) now; the notes stay as they are (none was marked "with agent" for you).'))
  assert.doesNotMatch(said, /now marked "with agent"/)
  freeHolder()
})
