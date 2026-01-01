// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Steps shared by the agent scenarios (SnippStudio phase 4B.5; since
// TERMINAL-YOK-PLAN.md the app starts no agent: a scripted agent connects
// from outside over real HTTP, agent-client.mjs): agent access turned on
// with the app's own switch, the connection's state, and small helpers.
import { connectAgent } from './agent-client.mjs'
import { keepBoxOpen } from './lib.mjs'

export const status = (c) => c.ev('window.api.agentSession.status()')

/** Agent access on with the top bar's own switch (when it is off), the Agent
 *  tab open and the command box kept open. Returns the status. */
export async function accessOn(c) {
  // (Just after a launch the server may still be opening: a moment first,
  // so the switch is never pressed while it turns on.)
  let s0 = await status(c)
  for (let i = 0; i < 30 && !s0.server?.running && s0.server?.enabled; i++) {
    await c.sleep(100)
    s0 = await status(c)
  }
  if (!s0.server?.running) {
    await c.waitFor('the agent switch', () => c.ev(`(() => { const b = document.querySelector('[data-testid="agent.switch"]'); return !!b && !b.disabled })()`))
    await c.click('agent.switch')
    await c.waitFor('agent access on', async () => !!(await status(c)).server?.running, 20000)
  }
  await c.click('inspector.tab.agent')
  await c.waitId('agent.connection')
  await keepBoxOpen(c)
  return status(c)
}

/** Access on, then a scripted agent from outside (it asks for the tools):
 *  the Agent tab says "Connected · from outside". Returns the agent. */
export async function outsideAgent({ c, app, assert, client = 'e2e-outside' }) {
  await accessOn(c)
  const ag = await connectAgent({ c, app, assert, client })
  await c.waitFor('connected from outside', async () => (await c.attr('agent.connection', 'data-state')) === 'external', 10000)
  return ag
}

/** Is a process there? (Our own child's pid only.) */
export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** Can anything connect to the agent port now? */
export async function listening(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' })
    return true
  } catch {
    return false
  }
}

/** The text a selector shows. */
export const textOf = (c, id) => c.ev(`document.querySelector('[data-testid="${id}"]')?.textContent ?? null`)
