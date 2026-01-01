// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Settings window (TERMINAL-YOK-PLAN.md; it took the place of way D's
// scenario, which went with the embedded terminal): it opens from the top
// bar's gear, File → Settings, Ctrl+, and File → Keyboard shortcuts (on its
// page), and from the Agent tab's "Open settings" (on Agent connection). Each
// page: General (the interface language; the spoken language of new
// projects), Agent connection (access, the address to copy, a card per
// agent; an agent from outside makes the Agent tab say "Connected · from
// outside"), Keyboard shortcuts (a ready set, one key changed), Help (the
// guides opened by the system, the tour), About (the version, the licence).
import { join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
import { APP_DIR } from '../app.mjs'
import { accessOn, listening, textOf } from '../session.mjs'
export const name = 'agent-connect-settings'

export async function run({ c, app, lib }) {
  const { assert } = lib
  const clipboard = () => app.events().filter((e) => e.type === 'clipboard').at(-1)?.text
  const opened = () => app.events().filter((e) => e.type === 'shell' && e.call === 'openPath').map((e) => e.path)
  const page = () => c.ev(`document.querySelector('[data-testid="settings.nav"] [aria-selected="true"]')?.getAttribute('data-testid') ?? null`)
  const close = async () => {
    await c.click('settings.close')
    await c.waitGone('settings')
  }

  // The ways in.
  await c.click('topbar.settings')
  await c.waitId('settings')
  assert.equal(await page(), 'settings.nav.general')
  await close()
  await c.click('topbar.file')
  await c.click('menu.file.settings')
  await c.waitId('settings')
  await close()
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key(',', ['ctrl'])
  await c.waitId('settings')
  await c.key('Escape')
  await c.waitGone('settings')
  await c.click('topbar.file')
  await c.click('menu.file.shortcuts')
  await c.waitId('settings.keys')
  assert.equal(await page(), 'settings.nav.keys')
  assert.equal(await c.has('dialog.shortcuts'), false, 'no shortcuts window of its own any more')

  // Keyboard shortcuts: a ready set, one key changed (and back).
  assert.match(await textOf(c, 'shortcuts.key.settings'), (await c.ev('navigator.platform')).startsWith('Mac') ? /^⌘.*,$/ : /^Ctrl \+ ,$/)
  await c.click('shortcuts.key.closeGap')
  await c.key('g')
  await c.waitFor('the key changed', async () => (await textOf(c, 'shortcuts.key.closeGap'))?.toLowerCase() === 'g')
  assert.equal(await c.run(() => JSON.parse(localStorage.getItem('autocut-shortcuts') ?? '{}').closeGap), 'g')
  await c.click('shortcuts.reset')
  await c.waitFor('the keys back', async () => (await textOf(c, 'shortcuts.key.closeGap'))?.toLowerCase() === 'e')

  // General: the language (as File → Language), the spoken language of new projects.
  await c.click('settings.nav.general')
  await c.waitId('settings.general')
  await c.select('settings.general.uiLang', 'tr')
  await c.waitFor('Turkish', async () => (await textOf(c, 'settings.nav.agent')) === 'Ajan bağlantısı')
  await c.select('settings.general.uiLang', 'en')
  await c.waitFor('English', async () => (await textOf(c, 'settings.nav.agent')) === 'Agent connection')
  assert.match(await textOf(c, 'settings.general.autosave'), /every 5 minutes/)
  await c.select('settings.general.spoken', 'german')
  assert.equal(await c.run(() => localStorage.getItem('snippstudio-spoken-default')), 'german')
  await close()
  await c.run(() => { window.__store.getState().setDirty(false); window.__store.getState().newProject('16:9'); return true })
  assert.equal(await c.st((s) => s.project.transcription?.language), 'german', 'a new project takes the chosen language')
  await c.click('topbar.settings')
  await c.select('settings.general.spoken', 'follow')
  assert.equal(await c.run(() => localStorage.getItem('snippstudio-spoken-default')), null)

  // Agent connection: the wizard (a program, five steps: SIHIRBAZ-PLAN.md),
  // the address and the key under Details.
  await c.click('settings.nav.agent')
  await c.waitId('settings.agent.wizard')
  // (The wizard reads the program and its registration as it opens: wait
  // for that, so a click does not land on a line that moves.)
  await c.waitFor('the wizard settled', async () => (await c.has('settings.agent.found')) && !['unchecked', 'checking'].includes(await c.attr('settings.agent.row.registered', 'data-say')), 40_000)
  await c.sleep(300)
  for (const id of ['claude', 'codexCli', 'codexApp', 'opencode', 'other']) assert.ok(await c.has(`settings.agent.program.${id}`), id)
  for (const n of [1, 2, 3, 4, 5]) assert.ok(await c.has(`settings.agent.step.${n}`), `step ${n}`)
  await c.click('settings.agent.more')
  await c.waitId('settings.agent.url')
  const url = `http://127.0.0.1:${app.agentPort}/mcp`
  assert.equal(await textOf(c, 'settings.agent.url'), url)
  assert.match(await textOf(c, 'settings.agent.port'), new RegExp(`^Port ${app.agentPort} `))
  await c.click('settings.agent.url.copy')
  await c.waitFor('the address copied', () => clipboard() === url)
  assert.match(await textOf(c, 'settings.agent.security'), /^Keep the key private/)
  // Access off and on from here: the same switch as the top bar's.
  if ((await c.attr('settings.agent.access', 'data-state')) === 'on') {
    await c.click('settings.agent.access')
    await c.waitFor('off', async () => !(await listening(app.agentPort)))
    assert.equal(await c.attr('agent.switch', 'aria-checked'), 'false')
  }
  await c.click('settings.agent.access')
  await c.waitFor('on', async () => await listening(app.agentPort))
  assert.equal(await c.attr('agent.switch', 'aria-checked'), 'true')
  await close()

  // The Agent tab: not connected, a way to Settings; then an agent from outside.
  await accessOn(c)
  assert.equal(await c.attr('agent.connection', 'data-state'), 'server')
  assert.match(await textOf(c, 'agent.status'), /Settings → Agent connection/)
  await c.click('agent.openSettings')
  await c.waitId('settings.agent')
  assert.equal(await page(), 'settings.nav.agent')
  await close()
  assert.equal(await c.has('agent.terminal.card'), false)
  assert.equal(await c.has('agent.fallback'), false)
  const ag = await connectAgent({ c, app, assert, client: 'claude-code' })
  await c.waitFor('connected from outside', async () => (await textOf(c, 'agent.status')) === 'Connected · from outside (Claude Code)')
  assert.equal(await c.has('agent.openSettings'), false)
  await fetch(ag.url, { method: 'DELETE', headers: { authorization: `Bearer ${ag.token}`, 'mcp-session-id': ag.session } })

  // Help: the guides beside the program, opened by the system; the tour.
  await c.click('topbar.settings')
  await c.click('settings.nav.help')
  await c.waitId('settings.help')
  await c.click('settings.help.guide')
  await c.waitFor('the guide opened', () => opened().some((p) => p.endsWith(join('docs', 'guide.md'))))
  await c.click('settings.help.agents')
  await c.waitFor('the agents guide opened', () => opened().some((p) => p.endsWith(join('docs', 'agents.md'))))
  assert.ok(opened().every((p) => p.startsWith(APP_DIR)), JSON.stringify(opened()))
  await c.click('settings.help.tour')
  await c.waitGone('settings')
  await c.waitId('tour', 8000)
  await c.key('Escape')

  // About: the version, the licence.
  await c.click('topbar.settings')
  await c.click('settings.nav.about')
  await c.waitId('settings.about')
  await c.waitFor('the version', async () => /^Version \d+\.\d+\.\d+ \(development build\)$/.test((await textOf(c, 'settings.about.version')) ?? ''))
  await c.click('settings.about.licenseFile')
  await c.waitFor('the licence opened', () => opened().some((p) => p.endsWith('LICENSE')))
  await c.click('settings.about.notices')
  await c.waitFor('the notices opened', () => opened().some((p) => p.endsWith('THIRD-PARTY-NOTICES.md')))
  await close()
  console.log(`     ways in: gear, File → Settings, Ctrl+, and File → Keyboard shortcuts; ${opened().length} files opened by the system`)
}
