// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4B.5 (d) and (e), and "nothing is left when the app closes"; since
// TERMINAL-YOK-PLAN.md the app starts no agent process at all: with the
// switch off nothing listens on the agent port; turning it off while an agent
// from outside works closes the port and ends its session (its next call is
// refused); turned on again (the top bar's switch) the port opens and the
// agent connects again; the app closed with access on quits within 15 s.
import { connectAgent } from '../agent-client.mjs'
import { accessOn, listening, outsideAgent, status } from '../session.mjs'
export const name = 'agent-switch-off-no-process'

export async function run({ c, app, lib, relaunch }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const ag = await outsideAgent({ c, app, assert, client: 'switch-off' })
  assert.ok(await listening(app.agentPort), 'the server listens')
  assert.equal((await status(c)).external?.client, 'switch-off')

  // (e) Off: the session ends; (d) nothing listens.
  await c.click('agent.switch')
  await c.waitFor('the port closed', async () => !(await listening(app.agentPort)), 8000)
  const off = await status(c)
  assert.equal(off.server.running, false)
  assert.equal(off.external, null)
  // (Phase 3c.Y, K2: switched off, the Agent tab is gone; the top bar's
  // switch says off. The command box is one line when empty and left alone,
  // the switch on or off (audit G1): kept open by accessOn, let go.)
  await c.waitGone('inspector.tab.agent')
  assert.equal(await c.attr('agent.switch', 'aria-checked'), 'false')
  if (await c.has('agent.box.collapse')) await c.click('agent.box.collapse')
  await c.waitFor('the box folded', async () => (await c.attr('agent.box', 'data-folded')) === 'true')

  // On again from the top bar: no chooser, the server opens; the old session
  // is gone, a new one connects.
  await accessOn(c)
  assert.equal(await c.has('agent.picker'), false, 'no chooser any more')
  const old = await ag.rpc('tools/call', { name: 'project', arguments: {} })
  assert.notEqual(old.status, 200, 'the old session is not taken back')
  const again = await connectAgent({ c, app, assert, client: 'switch-on' })
  assert.ok((await again.call('project')).text.length > 0)

  // The app closes with access on: it quits.
  await c.st((s) => s.setDirty(false))
  const t0 = Date.now()
  await c.ev('setTimeout(() => window.close(), 50), true')
  const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))])
  const ms = Date.now() - t0
  assert.notEqual(code, 'timeout', 'the app quit within 15 s')
  await new Promise((r) => setTimeout(r, 500))
  assert.equal(await listening(app.agentPort), false, 'nothing listens after the app')
  console.log(`     the app quit in ${ms} ms with agent access on`)
  await relaunch({})
}
