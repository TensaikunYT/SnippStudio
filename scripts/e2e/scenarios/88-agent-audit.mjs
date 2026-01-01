// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 7 audit patch (tarifler\FAZ7-YAMA.md): S6, access turned off while
// the agent server is still opening is kept: the port closes, the switch
// shows off (no agent is started at all since TERMINAL-YOK-PLAN.md); S2,
// the app quitting while a --version query hangs leaves no process of it behind (our own child's PID, checked by PID).
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { alive, listening, status } from '../session.mjs'

export const name = 'agent-audit-stop-and-quit'
export const timeoutMs = 180_000

export async function run({ relaunch, lib }) {
  const { assert } = lib

  // S6: access on, and at once off.
  let app = await relaunch({})
  let c = app.cdp
  await c.ev(`(async () => { const a = window.api.agentSession; await Promise.all([a.connect(true), a.connect(false)]); return true })()`)
  await c.sleep(2500)
  const s = await status(c)
  assert.equal(!!s.server?.running, false, 'the server closed again')
  assert.equal(await listening(app.agentPort), false, 'port closed')
  // (Phase 3c.Y, K2: off, there is no Agent tab; the top bar's switch says it.
  // The tab used to read the state again when it was opened; the page is
  // opened again instead, so the switch shows what the main process holds.)
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await lib.ready(c)
  await c.waitFor('the switch shows off', async () => (await c.attr('agent.switch', 'aria-checked')) === 'false' && (await c.ev(`!document.querySelector('[data-testid="agent.switch"]').disabled`)), 5_000)
  assert.equal(await c.has('inspector.tab.agent'), false)
  console.log('     S6: on + off at once → port closed, switch off')

  // S2: the app quits while a version query hangs.
  const sys = [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(delimiter)
  const bin = mkdtempSync(join(tmpdir(), 'phase7 audit hang '))
  try {
    writeFileSync(join(bin, 'hang.cjs'), 'require("fs").writeFileSync(require("path").join(__dirname, "pid-" + process.pid), ""); setInterval(() => {}, 1000)')
    writeFileSync(join(bin, 'claude.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0hang.cjs" %*\r\n`)
    const pids = () => readdirSync(bin).filter((f) => f.startsWith('pid-')).map((f) => Number(f.slice(4)))
    app = await relaunch({ agent: false, agentSearchPath: [bin, sys].join(delimiter) })
    c = app.cdp
    // (Settings → Agent connection asks each agent its version.)
    await c.click('topbar.settings')
    await c.click('settings.nav.agent')
    await c.waitFor('the hanging version query', async () => pids().length === 1, 10_000)
    const pid = pids()[0]
    assert.ok(alive(pid))
    await c.ev('setTimeout(() => window.close(), 50), true')
    const code = await Promise.race([app.exited, new Promise((r) => setTimeout(() => r('timeout'), 15_000))])
    assert.notEqual(code, 'timeout', 'the app quit')
    const t0 = Date.now()
    while (alive(pid) && Date.now() - t0 < 3_000) await new Promise((r) => setTimeout(r, 100))
    assert.equal(alive(pid), false, `the version query ${pid} outlived the app`)
    console.log(`     S2: app quit (code ${code}) with a hanging --version: its process gone ${Date.now() - t0} ms after`)
  } finally {
    for (const pid of readdirSync(bin).filter((f) => f.startsWith('pid-')).map((f) => Number(f.slice(4)))) {
      if (alive(pid)) process.kill(pid)
    }
    rmSync(bin, { recursive: true, force: true })
  }
  await relaunch({})
}
