// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4B.5 (g): every tool call is a step in the Agent tab; "back to here"
// puts the project back to how it was right after that step (one undo step),
// "back to before the agent" (asks first) to how it was before the agent's
// first change. With "apply directly" the agent's two titles land one by one.
// (The agent: a scripted one from outside, TERMINAL-YOK-PLAN.md.)
import { versionOf } from '../agent-client.mjs'
import { outsideAgent } from '../session.mjs'
export const name = 'agent-steps-back-to-here'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('direct'))
  const ag = await outsideAgent({ c, app, assert, client: 'steps-back' })
  const before = await c.run(() => window.__agent.serialize())
  const titles = () => c.st((s) => s.project.captions.filter((k) => k.text === 'Agent title').length)
  for (const n of [1, 2]) {
    const p = await ag.call('project')
    await ag.call('edit', { ops: [{ op: 'text.add', time: 0.5, text: 'Agent title' }], base: versionOf(p.text) })
    await c.waitFor(`title ${n} landed`, async () => (await titles()) === n, 15000)
  }
  assert.equal(await titles(), 2, 'two titles landed (applied directly)')
  // Steps: project, edit, project, edit — each with its time and tokens.
  await c.waitId('agent.step.4')
  // (D22, A13: what it changed, in the user's words; not "text.add".)
  assert.match(await c.ev(`document.querySelector('[data-testid="agent.step.2"]').textContent`), /Edited: A title "Agent title" is added at 0:0[01]/)
  // Every call has its row on screen.
  const rows = (await c.ids('agent.step.')).filter((x) => /^agent\.step\.\d+$/.test(x)).length
  assert.equal(rows, await c.run(() => window.__agent.store.getState().events.length), 'one row per tool call')
  const depth = await lib.undoDepth(c)
  await c.click('agent.step.back.2')
  await c.click('agent.steps.ask.ok')
  await c.waitFor('back to after step 2', async () => (await titles()) === 1)
  assert.equal((await lib.undoDepth(c)) - depth, 1, 'one undo step')
  // Back to before the agent (asks first).
  await c.click('agent.restore')
  await c.waitId('agent.restore.ask')
  await c.click('agent.restore.ok')
  await c.waitFor('before the agent', async () => (await titles()) === 0)
  assert.equal(await c.run(() => window.__agent.serialize()), before, 'byte for byte the project before the agent')
  // And that too is one undo step.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z brings it back', async () => (await titles()) === 1)
}
