// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-4, item 9 (worker T; DENEME-2-PLAN-T.md): two agent programs on one
// computer, two scripted clients over real HTTP ("claude-code", "codex").
// One agent changes the project at a time: Claude Code edits and holds it;
// Codex's edit is refused politely and Codex is listed as "wanted to
// connect" (reading stays open); Claude Code leaves a draft; "Switch to
// Codex" asks Accept / Reject first; then Claude Code is told the project
// was handed on, and Codex's edit goes in. The names show in the Agent tab,
// the top bar's chip and Settings → Agent connection.
import { connectAgent, versionOf } from '../agent-client.mjs'
import { SHOTS } from './den2-t-agent-move.mjs'
import { join } from 'node:path'
export const name = 'den2-t-two-agents'
export const timeoutMs = 120_000

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  // (A scenario before may have turned access off: the reset turns it on again; wait for the port.)
  if ((await c.attr('agent.switch', 'aria-checked')) !== 'true') await lib.topBarSwitch(c)
  await c.waitFor('the agent server listening', async () => { try { await fetch(`http://127.0.0.1:${app.agentPort}/mcp`, { method: 'POST' }); return true } catch { return false } }, 15_000)
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.run(() => window.__agent.setMode('draft'))
  const claude = await connectAgent({ c, app, assert, client: 'claude-code' })
  const codex = await connectAgent({ c, app, assert, client: 'codex-mcp-client' })
  const clips = await lib.clipList(c)
  const v1 = versionOf((await claude.call('project')).text)
  await claude.call('edit', { ops: [{ op: 'clip.move', clipId: clips[1].id, by: 1 }], base: v1 })
  await c.click('inspector.tab.agent')
  await c.waitId('agent.agents.holder')
  assert.match(await c.ev(`document.querySelector('[data-testid="agent.agents.holder"]').textContent`), /Claude Code is working on this project/)

  // Codex reads (open to all), but its edit is refused politely and listed.
  const v2 = versionOf((await codex.call('project')).text)
  const no = await codex.call('edit', { ops: [{ op: 'clip.move', clipId: clips[0].id, by: 2 }], base: v2 }, { allowError: true })
  assert.ok(no.isError)
  assert.match(no.text, /Another agent \(Claude Code\) is changing this project/)
  await c.waitId('agent.agents.asked.codex-mcp-client')
  assert.match(await c.ev(`document.querySelector('[data-testid="agent.agents.asked.codex-mcp-client"]').textContent`), /Codex wanted to connect/)
  await c.shot(join(SHOTS, 'iki-ajan.png'))

  // Switch to Codex: Claude Code's draft first (rejected here).
  await c.click('agent.agents.switch.codex-mcp-client')
  await c.waitId('agent.handover.ask')
  await c.click('agent.handover.reject')
  await c.waitFor('handed over', () => c.ev(`(document.querySelector('[data-testid="agent.agents.holder"]')?.textContent ?? '').includes('Codex')`))
  assert.equal(await c.ev(`!!window.__agent.store.getState().draft`), false, 'the draft was rejected first')

  // Claude Code may still read (D22, worker C, the audit's A11: "reading stays
  // open to every agent"); its next change is told kindly.
  const stillReads = await claude.call('project', {}, { allowError: true })
  assert.ok(!stillReads.isError, 'the agent the project was taken from can still read it')
  const told = await claude.call('edit', { ops: [{ op: 'marker.add', time: 2 }], base: versionOf(stillReads.text) }, { allowError: true })
  assert.ok(told.isError)
  assert.match(told.text, /The user handed the project to another agent \(Codex\)/)
  // Codex edits now.
  const v3 = versionOf((await codex.call('project')).text)
  // (The last clip of its track: since D22 an agent's move that would land
  // on another clip is refused unless it says push:true.)
  const yes = await codex.call('edit', { ops: [{ op: 'clip.move', clipId: clips[1].id, by: 2 }], base: v3 })
  assert.match(yes.text, /^Draft started/)
  await c.waitFor('the chip names Codex', () => c.ev(`/Codex/.test(document.querySelector('[data-testid="agent.chip"]')?.textContent ?? '')`))

  // Settings → Agent connection lists the connected agents.
  await c.key(',', ['ctrl'])
  await c.click('settings.nav.agent')
  await c.waitId('settings.agents')
  const listed = await c.ev(`document.querySelector('[data-testid="settings.agents"]').textContent`)
  assert.match(listed, /Codex · working on this project/)
  assert.match(listed, /Claude Code/)
  await c.click('settings.close')
  await c.waitGone('settings')
  await c.run(() => window.__agent.reject())
}
