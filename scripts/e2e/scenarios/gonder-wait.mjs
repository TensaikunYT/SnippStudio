// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// GONDER-PLAN.md: sending to the agent from the app. A scripted agent from
// outside calls `wait` and waits (the Agent tab says so); a job typed in the
// command box comes back in that call at once. A second wait with nothing
// sent ends at its time with "nothing yet". Notes sent with nobody waiting
// stay in line (the button says so) and the next wait brings them, now
// "with agent". The user's answer on the draft card (Reject and a word) comes
// back in a wait. A wait the agent cancels (notifications/cancelled) stops in
// the page: the tab no longer says it waits. The recent list shows what went.
import { versionOf } from '../agent-client.mjs'
import { outsideAgent, textOf } from '../session.mjs'
export const name = 'gonder-wait'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await outsideAgent({ c, app, assert, client: 'gonder-wait' })
  assert.ok(ag.tools.some((t) => t.name === 'wait'), 'the wait tool is offered')
  await c.click('inspector.tab.agent')
  await c.waitId('agent.wait')
  assert.equal(await c.attr('agent.wait', 'data-state'), 'not-waiting')

  // 1. The agent waits; a job typed in the box comes back in that call at once.
  const t0 = Date.now()
  const first = ag.call('wait', { seconds: 60 })
  await c.waitFor('the tab says the agent waits', async () => (await c.attr('agent.wait', 'data-state')) === 'waiting', 8000)
  assert.equal(await textOf(c, 'agent.wait'), 'The agent is waiting for you: it gets what you send at once')
  if ((await c.attr('agent.box', 'data-folded')) === 'true') await c.click('agent.box.open')
  await c.fill('agent.box.text', 'tighten the intro')
  await c.click('agent.box.send')
  const got = await first
  assert.ok(Date.now() - t0 < 30_000, 'it came back when sent, not at its time')
  assert.match(got.text, /^From the user in .+:$/m)
  assert.match(got.text, /^Task: "tighten the intro"$/m)
  assert.match(got.text, /When done, call wait again\.$/)
  await c.waitFor('the box says the agent has it', async () => (await c.attr('agent.box.status', 'data-state')) === 'taken')
  assert.equal(await c.ev(`document.querySelector('[data-testid="agent.box.text"]').value`), '', 'the box is empty again')

  // 2. Nothing sent: the next wait ends at its time with the right answer.
  const t1 = Date.now()
  const none = await ag.call('wait', { seconds: 5 })
  assert.equal(none.text, 'Nothing from the user yet; call wait again.')
  assert.ok(Date.now() - t1 >= 4500, `waited its time (${Date.now() - t1} ms)`)
  await c.waitFor('not waiting any more (after the grace)', async () => (await c.attr('agent.wait', 'data-state')) === 'not-waiting', 8000)

  // 3. Notes sent with nobody waiting stay in line; the next wait brings them.
  await c.run(() => {
    const s = window.__store.getState()
    s.startNoteDraft({ start: 1, end: 2 })
    s.patchNoteDraft({ text: 'shorter here', kind: 'fix' })
    s.saveNoteDraft()
  })
  await c.click('inspector.tab.notes')
  assert.equal(await textOf(c, 'notes.send'), 'Send to agent (1)')
  await c.click('notes.send')
  await c.waitFor('the button says it is in line', async () => (await textOf(c, 'notes.send')) === 'In line for the agent (1)')
  const notes = await ag.call('wait', { seconds: 30 })
  assert.match(notes.text, /1 note sent, now "with agent"/)
  assert.match(notes.text, /"shorter here"/)
  assert.equal(await c.st((s) => s.project.notes[0].status), 'agent', 'taken as the notes tool takes it')
  await c.waitFor('nothing left to send', async () => (await c.attr('notes.send', 'disabled')) !== null)

  // 4. The user's answer on the draft card comes back in a wait.
  const p = await ag.call('project')
  await ag.call('edit', { ops: [{ op: 'text.add', time: 0.5, text: 'Agent title' }], base: versionOf(p.text) })
  await c.click('inspector.tab.agent')
  await c.waitId('agent.draft')
  const answer = ag.call('wait', { seconds: 60 })
  await c.waitFor('waiting again', async () => (await c.attr('agent.wait', 'data-state')) === 'waiting', 8000)
  // (D22, worker C: "reject and say why" is in the review strip's menu.)
  await c.click('agent.draft.more')
  await c.click('agent.draft.rejectWhy')
  await c.fill('agent.draft.why', 'not now')
  await c.click('agent.draft.whyReject')
  const ans = await answer
  assert.match(ans.text, /^The user REJECTED your draft\. In their words: "not now"$/m)

  // 5. A wait the agent cancels stops in the page.
  const rid = 9001
  const post = (body) => fetch(ag.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ag.token}`, 'mcp-session-id': ag.session }, body: JSON.stringify(body) })
  const held = post({ jsonrpc: '2.0', id: rid, method: 'tools/call', params: { name: 'wait', arguments: { seconds: 60 } } })
  await c.waitFor('waiting', async () => (await c.attr('agent.wait', 'data-state')) === 'waiting', 8000)
  const n = await post({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: rid, reason: 'the user pressed Esc' } })
  assert.equal(n.status, 202)
  await held
  await c.waitFor('the page stopped waiting', async () => (await c.attr('agent.wait', 'data-state')) === 'not-waiting', 8000)
  // What is sent now waits in line for the next wait (nothing was lost to the cancelled one).
  await c.fill('agent.box.text', 'after the cancel')
  await c.click('agent.box.send')
  await c.waitFor('in line', async () => (await c.attr('agent.box.status', 'data-state')) === 'queued')
  assert.match(await textOf(c, 'agent.inbox.queued'), /^1 in line$/)
  const after = await ag.call('wait', { seconds: 10 })
  assert.match(after.text, /^Task: "after the cancel"$/m)

  // The recent list: what went, newest first.
  await c.waitFor('four sent', async () => (await c.ids('agent.inbox.sent.')).length === 4)
  // Only waits that brought something are steps of the activity list.
  const steps = await c.run(() => window.__agent.store.getState().events.filter((e) => e.tool === 'wait').length)
  assert.equal(steps, 4)
}
