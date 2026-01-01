// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4B.5 (b) and (c), and "no store write per frame" (4B.4): a ready
// command (Cut silences) is done here — not one tool call — and comes as the
// same draft card, and the box says it was done here ("did not go to the
// agent"). A typed request that is exactly a ready job's words ("cut
// silences") is done here too, never sent (GONDER-PLAN.md, 12). Then, while the timeline shows the agent reading (a
// scripted agent's analyze call), the stores are written only at the call's
// start and end: none per frame.
import { connectAgent } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'agent-ready-commands-local'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('direct'))
  await accessOn(c)
  const calls = () => c.run(() => window.__agent.store.getState().events.length)
  const calls0 = await calls()

  // (b) The button: a draft (even with "apply directly"), 0 tool calls.
  await c.click('agent.ready.silences')
  await c.waitId('agent.draft', 15000)
  assert.equal(await calls(), calls0, 'no tool call')
  assert.match(await c.ev(`document.querySelector('[data-testid="agent.draft"]').textContent`), /Ready command/)
  assert.ok((await c.ev(`document.querySelectorAll('[data-testid="agent.mark"][data-kind="cut"]').length`)) >= 2)
  assert.equal(await c.attr('agent.box.status', 'data-state'), 'local')
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')

  assert.match(await c.ev(`document.querySelector('[data-testid="agent.box.status"]').textContent`), /did not go to the agent/)

  // (c) Typed: exactly a ready job's words: done here, nothing in the agent's inbox.
  await c.fill('agent.box.text', 'Cut the silences!')
  await c.key('Enter', ['ctrl'])
  await c.waitId('agent.draft', 15000)
  assert.equal(await calls(), calls0, 'no tool call')
  assert.equal(await c.attr('agent.box.status', 'data-state'), 'local')
  assert.equal(await c.ev(`document.querySelector('[data-testid="agent.box.text"]').value`), '', 'the box is empty again')
  await c.click('inspector.tab.agent')
  assert.equal(await c.has('agent.inbox.queued'), false, 'nothing in line for the agent')
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')

  // No store write per frame: an analysis call whose sweep shows for >= 600 ms.
  await c.run(() => {
    window.__writes = { agent: 0, main: 0, session: 0 }
    window.__unsub = [
      window.__agent.store.subscribe(() => window.__writes.agent++),
      window.__store.subscribe(() => window.__writes.main++)
    ]
    return true
  })
  const ag = await connectAgent({ c, app, assert, client: 'writes' })
  await ag.call('transcript')
  await c.waitId('agent.reading')
  await c.sleep(1500)
  const w = await c.run(() => {
    window.__unsub.forEach((f) => f())
    return window.__writes
  })
  console.log(`     store writes during one read and its 1.5 s sweep: agent ${w.agent}, main ${w.main}`)
  assert.ok(w.agent <= 2, `agent store written ${w.agent} times (start and end only)`)
  assert.equal(w.main, 0, 'the project store not written')
  await c.waitGone('agent.reading', 5000)
}
