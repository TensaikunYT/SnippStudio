// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 7 (K-G4): the agent server's secret key never reaches
// the page. Every answer the page can get about the agent (status, the
// connection, the catalog, each agent's copied part, the registration
// checks, the restore points, Help and About) is searched for this profile's
// key; so is everything the Settings window puts on the clipboard. Since
// TERMINAL-YOK-PLAN.md there is no terminal of the app's to drive: the page's
// bridge holds no way to start, type into or read an agent program.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { accessOn } from '../session.mjs'
export const name = 'security-agent-key'
export const freshWindow = true

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await accessOn(c)
  const token = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8')).token
  assert.match(token, /^[A-Za-z0-9_-]{32,}$/)

  // Nothing the page is answered holds the key.
  const answers = await c.ev(`(async () => {
    const a = window.api
    const out = {}
    const take = async (name, work) => { try { out[name] = await work() } catch (e) { out[name] = 'threw: ' + String(e) } }
    await take('agent.status', () => a.agent.status())
    await take('agent.setEnabled', () => a.agent.setEnabled(true))
    await take('agent.restoreList', () => a.agent.restoreList())
    await take('session.status', () => a.agentSession.status())
    await take('session.connect', () => a.agentSession.connect(true))
    await take('session.catalog', () => a.agentSession.catalog())
    await take('session.openCodeSetup', () => a.agentSession.openCodeSetup())
    await take('session.antigravitySetup', () => a.agentSession.antigravitySetup())
    await take('session.claudeSetup', () => a.agentSession.claudeSetup())
    await take('session.codexSetup', () => a.agentSession.codexSetup())
    // (DENEME-2: "is the key's variable set for the user": True / False only.)
    await take('session.codexEnv', () => a.agentSession.codexEnv())
    await take('session.checkClaude', () => a.agentSession.check('claude'))
    await take('session.checkCodex', () => a.agentSession.check('codex'))
    await take('help.info', () => a.help.info())
    await take('profileInherited', () => a.profileInherited())
    // (Nothing of the terminal is left on the bridge.)
    out.bridge = Object.keys(a.agentSession).sort()
    return JSON.stringify(out)
  })()`)
  const got = JSON.parse(answers)
  for (const [name, value] of Object.entries(got)) {
    const text = JSON.stringify(value)
    assert.ok(!text.startsWith('"threw'), `${name}: ${text}`)
    assert.equal(text.includes(token), false, `${name} holds the key`)
    assert.doesNotMatch(text, /Bearer [A-Za-z0-9_-]{20,}/, `${name} holds an Authorization header`)
  }
  assert.deepEqual(Object.keys(got['agent.status']).sort(), ['enabled', 'error', 'port', 'running', 'url'])
  // (22 Nov, K6: `codexEnv` joined the bridge in DENEME-2 and this list was
  // not told, so the scenario stopped here and the clipboard was never looked at.)
  assert.deepEqual(got.bridge, ['antigravitySetup', 'catalog', 'check', 'claudeSetup', 'codexEnv', 'codexSetup', 'connect', 'onChanged', 'openCodeSetup', 'renewKey', 'status'])
  // (SIHIRBAZ-PLAN.md: the user's variable compared with the key inside PowerShell.)
  assert.ok(['same', 'different', 'missing', 'unknown'].includes(got['session.codexEnv']), 'codexEnv answers a verdict, nothing else')
  assert.equal(await c.ev("typeof window.api.recipes"), 'undefined')

  // Every copy button of Settings → Agent connection, for every program of
  // the connection wizard (SIHIRBAZ-PLAN.md): no key on the clipboard.
  await c.click('topbar.settings')
  await c.click('settings.nav.agent')
  await c.waitId('settings.agent.wizard')
  // (The wizard reads the program and its registration as it opens: wait
  // for that, so a click does not land on a line that moves.)
  await c.waitFor('the wizard settled', async () => (await c.has('settings.agent.found')) && !['unchecked', 'checking'].includes(await c.attr('settings.agent.row.registered', 'data-say')), 40_000)
  await c.sleep(300)
  await c.click('settings.agent.more')
  await c.waitId('settings.agent.url.copy')
  // Every copy button there is: the list is read from the page, so a new one
  // cannot be left out (the "keep it for good" line of DENEME-2 was).
  const KNOWN = ['settings.agent.url.copy', 'settings.agent.register', 'settings.agent.start', 'settings.agent.try', 'settings.agent.row.key.fix']
  // (An agent that is not installed on this computer shows "copy the install
  // command" too: pressed when it is there.)
  const INSTALL = /^settings.agent.[a-z]+.install$/
  const pressed = new Set()
  for (const program of ['claude', 'codexCli', 'codexApp', 'opencode', 'other']) {
    await c.click(`settings.agent.program.${program}`)
    await c.waitFor(`${program} shown`, async () => (await c.attr('settings.agent.wizard', 'data-program')) === program)
    await c.waitFor(`${program} settled`, async () => !['checking'].includes(await c.attr('settings.agent.row.registered', 'data-say')), 40_000)
    await c.sleep(300)
    const shown = await c.ev(`[...document.querySelectorAll('[data-testid^="settings.agent."]')].filter((e) => e.tagName === 'BUTTON' && e.querySelector('[data-icon="copy"]')).map((e) => e.getAttribute('data-testid'))`)
    for (const id of shown) assert.ok(KNOWN.includes(id) || INSTALL.test(id), `${id}: a copy button this scenario does not know`)
    assert.ok(shown.includes('settings.agent.register') && shown.includes('settings.agent.try'), `${program}: ${shown}`)
    for (const id of shown) {
      const before = app.events().filter((e) => e.type === 'clipboard').length
      await c.click(id)
      await c.waitFor(`${program} ${id} copied`, async () => app.events().filter((e) => e.type === 'clipboard').length > before, 8000)
      pressed.add(id)
    }
  }
  for (const id of ['settings.agent.url.copy', 'settings.agent.register', 'settings.agent.start', 'settings.agent.try']) assert.ok(pressed.has(id), `${id} was never pressed`)
  const copied = app.events().filter((x) => x.type === 'clipboard')
  assert.ok(copied.length >= 11)
  for (const e of copied) assert.equal(JSON.stringify(e).includes(token), false, 'the clipboard holds the key')
  // And the page itself shows none.
  assert.equal((await c.ev('document.body.innerText')).includes(token), false, 'the window shows the key')
  await c.click('settings.close')
}
