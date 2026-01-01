// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The connection wizard (SnippStudio SIHIRBAZ-PLAN.md), with real clicks: the
// four broken states each make step 4 put a cross on the right row with the
// right way out, and the screen moves on live (a refused key, an agent window
// older than the server, an agent that connects) without pressing anything.
// 1 access off · 2 no registration · 3 an old key · 4 the agent in an old
// window, or never connected. Stand-in claude and codex (fake-agents.mjs);
// Codex's key row compares the test's variable (e2e-user-env.json in the
// test profile) with the profile's key inside PowerShell. No real agent runs.
// Screenshots of every program in both languages at 1920 × 1080 and
// 1366 × 768, and of each broken state, go to
// tasarim\karsilastirma\sihirbaz\ (SNIPP_SIHIRBAZ_SHOTS=0: not taken).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { APP_DIR } from '../app.mjs'
import { connectAgent } from '../agent-client.mjs'
import { writeFakes } from '../fake-agents.mjs'
import { systemOnlyPath } from '../harness-paths.mjs'
import { textOf } from '../session.mjs'

export const name = 'sihirbaz'

const SIZES = [[1920, 1080], [1366, 768]]
const PROGRAMS = ['claude', 'codexCli', 'codexApp', 'opencode', 'other']

export async function run({ relaunch, lib }) {
  const { assert } = lib
  const bin = mkdtempSync(join(tmpdir(), 'sihirbaz bin '))
  writeFakes(bin)
  const shots = process.env.SNIPP_SIHIRBAZ_SHOTS !== '0'
  const dir = join(APP_DIR, '..', 'tasarim', 'karsilastirma', 'sihirbaz')
  if (shots) mkdirSync(dir, { recursive: true })
  try {
    const app = await relaunch({ agent: false, agentSearchPath: [bin, systemOnlyPath()].join(delimiter) })
    const c = app.cdp
    const url = `http://127.0.0.1:${app.agentPort}/mcp`
    const variable = 'SNIPPSTUDIO_DEV_TOKEN'
    const row = (id) => c.attr(`settings.agent.row.${id}`, 'data-say')
    const waitRow = (id, say) => c.waitFor(`${id}: ${say}`, async () => (await row(id)) === say, 40_000)
    // Step 4's button, pressed the way a person does: once it is on. The
    // wizard checks by itself when a program is chosen or the window comes
    // back, and the button is off ("Checking…") until that check ends; a
    // press on it then is not heard. (Pressing at once raced that first
    // check: on a slow PowerShell the press fell on the off button and the
    // rows kept the answer read before the test wrote its registration.)
    const pressCheck = async () => {
      await c.waitFor('Check is on', async () => (await c.ev(`document.querySelector('[data-testid="settings.agent.check"]')?.disabled === false`)) === true, 40_000)
      await c.click('settings.agent.check')
    }
    const step = (n) => c.attr(`settings.agent.step.${n}`, 'data-state')
    const size = (w, h) => c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    const lang = async (l) => {
      await c.run((x) => { window.__store.getState().setUiLang(x); return true }, l)
      await c.waitFor(`language ${l}`, async () => (await textOf(c, 'settings.nav.agent')) === (l === 'tr' ? 'Ajan bağlantısı' : 'Agent connection'))
    }
    // The page's own scroller: the top, or a step brought into view.
    const scrollTo = (n) => c.ev(`(() => { const b = document.querySelector('.settings-body'); const s = ${n ? `document.querySelector('[data-testid="settings.agent.step.${n}"]')` : 'null'}; b.scrollTop = s ? s.offsetTop - 8 : 0; return b.scrollTop })()`)
    const shot = async (file) => {
      if (!shots) return
      await c.sleep(450)
      await c.shot(join(dir, `${file}.png`))
    }
    // Nothing on the page is cut, spills out or overlaps its row (the reviewer's eye, as numbers).
    const layout = () => c.ev(`(() => {
      const bad = []
      const body = document.querySelector('[data-testid="settings.agent.wizard"]').getBoundingClientRect()
      for (const el of document.querySelectorAll('[data-testid="settings.agent.wizard"] .ui-btn, [data-testid="settings.agent.wizard"] .ui-seg-part')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right > body.right + 0.5 || r.left < body.left - 0.5) bad.push('outside: ' + el.textContent)
        const label = el.querySelector('.ui-btn-label, .ui-seg-label')
        if (label && label.scrollWidth > label.clientWidth + 1) bad.push('cut: ' + label.textContent)
      }
      for (const el of document.querySelectorAll('.wiz-title, .wiz-text, .wiz-row-text, .wiz-res span, .wiz-found')) {
        if (el.scrollWidth > el.clientWidth + 1) bad.push('wide: ' + el.textContent)
      }
      for (const r of document.querySelectorAll('.wiz-row')) {
        const fix = r.querySelector('.wiz-fix')
        const text = r.querySelector('.wiz-row-text')
        if (fix && text && text.getBoundingClientRect().right > fix.getBoundingClientRect().left + 0.5) bad.push('overlap: ' + text.textContent)
      }
      return bad
    })()`)
    const checkLayout = async (where) => assert.deepEqual(await layout(), [], where)

    await c.click('topbar.settings')
    await c.waitId('settings')
    await c.click('settings.nav.agent')
    await c.waitId('settings.agent.wizard')
    await c.click('settings.agent.program.codexApp')
    await c.waitFor('codex found', async () => (await c.attr('settings.agent.found', 'data-state')) === 'found')

    // Everything right but the agent: access on, Codex registered, its key kept.
    const registered = JSON.stringify({ name: 'snippstudio-dev', enabled: true, transport: { type: 'streamable_http', url, bearer_token_env_var: variable } })
    await c.click('settings.agent.access')
    await c.waitFor('access on', async () => (await c.attr('settings.agent.access', 'data-state')) === 'on')
    const token = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8')).token
    writeFileSync(join(bin, 'codex-get.json'), registered)
    writeFileSync(join(app.profile, 'e2e-user-env.json'), JSON.stringify({ [variable]: token }))
    await pressCheck()
    await waitRow('registered', 'found')
    await waitRow('key', 'ok')
    await waitRow('connected', 'never')

    // ---- 1. Access off: "not listening: do step 1", and a button that turns it on.
    await c.click('settings.agent.access')
    await waitRow('listening', 'off')
    assert.equal(await c.attr('settings.agent.row.listening', 'data-state'), 'bad')
    assert.equal(await textOf(c, 'settings.agent.row.listening.fix'), 'Turn access on')
    assert.equal(await step(1), 'now')
    assert.equal(await row('registered'), 'found')
    assert.equal(await row('key'), 'ok')
    assert.equal(await row('connected'), 'notYet', 'nothing to say of the agent while nothing listens')
    for (const [w, h] of SIZES) {
      await size(w, h)
      for (const l of ['tr', 'en']) {
        await lang(l)
        await scrollTo(4)
        await checkLayout(`1 ${l} ${w}`)
        await shot(`bozuk-1-erisim-kapali-${l}-${w}x${h}`)
      }
    }
    await c.click('settings.agent.row.listening.fix')
    await waitRow('listening', 'ok')

    // ---- 2. No registration: "no registration: do step 2"; step 2 is the one to do.
    rmSync(join(bin, 'codex-get.json'))
    await pressCheck()
    await waitRow('registered', 'missing')
    assert.equal(await c.attr('settings.agent.row.registered', 'data-state'), 'bad')
    assert.equal(await textOf(c, 'settings.agent.row.registered'), 'No registration: do step 2Go to step 2')
    assert.equal(await row('key'), 'ok')
    assert.equal(await step(1), 'ok')
    assert.equal(await step(2), 'now')
    await c.click('settings.agent.row.registered.fix')
    await c.waitFor('step 2 shown', async () => (await c.ev(`document.querySelector('[data-testid="settings.agent.step.2"]').classList.contains('is-flash')`)) === true)
    for (const l of ['tr', 'en']) {
      await lang(l)
      await scrollTo(4)
      await checkLayout(`2 ${l}`)
      await shot(`bozuk-2-kayit-yok-${l}-1366x768`)
    }

    // ---- 3. An old key: Codex's variable holds another key.
    writeFileSync(join(bin, 'codex-get.json'), registered)
    writeFileSync(join(app.profile, 'e2e-user-env.json'), JSON.stringify({ [variable]: 'an-old-key-' + 'x'.repeat(32) }))
    await pressCheck()
    await waitRow('registered', 'found')
    await waitRow('key', 'old')
    assert.equal(await step(2), 'now')
    assert.ok(await c.has('settings.agent.row.key.fix'), 'copy the command again')
    for (const l of ['tr', 'en']) {
      await lang(l)
      await scrollTo(4)
      await checkLayout(`3 ${l}`)
      await shot(`bozuk-3-anahtar-eski-${l}-1366x768`)
    }
    // A program that came with an old key: told live (no button pressed).
    writeFileSync(join(app.profile, 'e2e-user-env.json'), JSON.stringify({ [variable]: token }))
    await pressCheck()
    await waitRow('key', 'ok')
    const r401 = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${'y'.repeat(43)}` }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
    assert.equal(r401.status, 401)
    await waitRow('key', 'refused')
    await pressCheck()
    await waitRow('key', 'ok')

    // ---- 4. The agent: never connected, then an old window (404), live.
    await waitRow('connected', 'never')
    assert.equal(await step(3), 'now')
    assert.equal(await textOf(c, 'settings.agent.row.connected.fix'), 'Go to step 3')
    for (const l of ['tr', 'en']) {
      await lang(l)
      await scrollTo(4)
      await checkLayout(`4 ${l}`)
      await shot(`bozuk-4a-hic-baglanmadi-${l}-1366x768`)
    }
    const r404 = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'mcp-session-id': 'a-session-from-before' }, body: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' })
    assert.equal(r404.status, 404)
    await waitRow('connected', 'oldWindow')
    for (const l of ['tr', 'en']) {
      await lang(l)
      await scrollTo(3)
      await checkLayout(`4b ${l}`)
      await shot(`bozuk-4b-eski-pencere-${l}-1366x768`)
    }

    // ---- All right: Codex connects; every step done, "Codex connected".
    const ag = await connectAgent({ c, app, assert, client: 'codex-mcp-client' })
    await waitRow('connected', 'ok')
    await c.waitId('settings.agent.connected')
    for (const n of [1, 2, 3, 4, 5]) assert.equal(await step(n), 'ok', `step ${n}`)

    // ---- Every program, both languages, both sizes (top, and step 4 to the end).
    for (const [w, h] of SIZES) {
      await size(w, h)
      for (const l of ['tr', 'en']) {
        await lang(l)
        for (const p of PROGRAMS) {
          await c.click(`settings.agent.program.${p}`)
          await c.waitFor(`${p} shown`, async () => (await c.attr('settings.agent.wizard', 'data-program')) === p)
          await c.sleep(300)
          await scrollTo(0)
          await checkLayout(`${p} ${l} ${w}`)
          await shot(`${p}-${l}-${w}x${h}`)
          if (h < 1000) {
            await scrollTo(4)
            await shot(`${p}-${l}-${w}x${h}-alt`)
          }
        }
      }
    }
    // An "If it did not work" open (Codex desktop, Turkish, the small screen).
    await c.click('settings.agent.program.codexApp')
    await c.click('settings.agent.step.3.ifnot')
    await c.waitId('settings.agent.step.3.ifnot.list')
    await scrollTo(3)
    await checkLayout('if not open')
    await lang('tr')
    await shot('olmadiysa-acik-tr-1366x768')
    await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${ag.token}`, 'mcp-session-id': ag.session } })
    await size(1920, 1080)
    await lang('en')
    await c.click('settings.close')
    await c.waitGone('settings')
    console.log(`     four broken states, each the right row and way out; 5 programs × en, tr × 1920, 1366${shots ? `: ${dir}` : ''}`)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
  await relaunch({})
}
