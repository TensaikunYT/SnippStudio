// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The way to connect (SnippStudio DIS-MCP-PLAN.md; since SIHIRBAZ-PLAN.md
// through the connection wizard of Settings → Agent connection): the app
// added to Claude Code (and Codex) once. Step 2 copies a line that holds no
// key; the line, run here by a real shell (PowerShell on Windows), hands a
// stand-in claude exactly `mcp remove` then `mcp add --transport http --scope
// user <name> <url> --header "Authorization: Bearer <key>"`, the key read from
// the profile's file. Step 4's rows read the stand-in's `mcp get`: not added,
// added, an old key after "Renew key", added again. Codex: step 2's one line
// keeps the key for the user (never run here: it would write this computer's
// environment) and adds `codex mcp add <name> --url <url>
// --bearer-token-env-var <VAR>` (run against a stand-in codex); its key row
// compares the test's variable with the profile's key inside PowerShell. An
// agent that connects from outside makes the Agent tab say so. The
// stand-ins never touch a real Claude Code or Codex or their settings.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { connectAgent } from '../agent-client.mjs'
import { writeFakes } from '../fake-agents.mjs'
import { systemOnlyPath, userShell } from '../harness-paths.mjs'
import { listening, status, textOf } from '../session.mjs'

export const name = 'dis-mcp-register'

export async function run({ relaunch, lib }) {
  const { assert } = lib
  const systemPath = systemOnlyPath()
  const bin = mkdtempSync(join(tmpdir(), "dis mcp o'bin "))
  writeFakes(bin)
  const codexCalls = () => (existsSync(join(bin, 'codex-calls.txt')) ? readFileSync(join(bin, 'codex-calls.txt'), 'utf8').trim().split(/\r?\n/).map((l) => l.replace(/"/g, '').trim()) : [])
  // (Quotes dropped: cmd's %* keeps them as they came, sh's $* has none.)
  const calls = () => (existsSync(join(bin, 'calls.txt')) ? readFileSync(join(bin, 'calls.txt'), 'utf8').trim().split(/\r?\n/).map((l) => l.replace(/"/g, '').trim()) : [])
  try {
    const app = await relaunch({ agent: false, agentSearchPath: [bin, systemPath].join(delimiter) })
    const c = app.cdp
    const clipboard = () => app.events().filter((e) => e.type === 'clipboard').at(-1)?.text
    const url = `http://127.0.0.1:${app.agentPort}/mcp`
    const name = 'snippstudio-dev'
    const row = (id) => c.attr(`settings.agent.row.${id}`, 'data-say')
    const waitRow = (id, say, what = `${id}: ${say}`) => c.waitFor(what, async () => (await row(id)) === say, 40_000)

    // Settings → Agent connection, from the top bar's gear: the wizard, Claude Code first.
    await c.click('topbar.settings')
    await c.waitId('settings')
    await c.click('settings.nav.agent')
    await c.waitId('settings.agent.wizard')
    await c.click('settings.agent.program.claude')
    await c.waitFor('installed CLI version', async () => (await textOf(c, 'settings.agent.found')) === 'Installed on this computer · 2.1.318')
    assert.equal(await listening(app.agentPort), false, 'a visit leaves the port closed')
    assert.equal(await c.attr('settings.agent.step.1', 'data-state'), 'now')

    // Not added yet (the wizard reads it by itself when the program shows).
    await waitRow('registered', 'missing')
    assert.deepEqual([...new Set(calls())], [`mcp get ${name}`])

    // Step 2's copy: access goes on; the line names the found claude by its
    // full path, reads the key from the profile's file and holds no key itself.
    await c.click('settings.agent.register')
    await c.waitFor('the copied command', () => clipboard()?.includes(' mcp add '))
    assert.equal(await listening(app.agentPort), true)
    await c.waitFor('step 1 done', async () => (await c.attr('settings.agent.step.1', 'data-state')) === 'ok')
    const settings = join(app.profile, 'agent.json')
    const token = JSON.parse(readFileSync(settings, 'utf8')).token
    const claude = (await status(c)).agents.find((a) => a.id === 'claude').path
    assert.ok(claude.startsWith(bin), claude)
    const q = (v) => v.replace(/'/g, clipboard().startsWith('$env:') || clipboard().startsWith('[Environment]') ? "''" : "'\\''")
    assert.ok(clipboard().includes(`'${q(claude)}' mcp remove --scope user ${name} `), clipboard())
    assert.ok(clipboard().includes(`'${q(claude)}' mcp add --transport http --scope user ${name} '${url}' --header "Authorization: Bearer $k"`), clipboard())
    assert.ok(clipboard().includes(`'${q(settings)}'`), 'the profile file is where the key is read')
    assert.equal(clipboard().includes(token), false, 'no key on the clipboard')
    await c.waitFor('the command shown', async () => (await textOf(c, 'settings.agent.register.text')) === clipboard())
    assert.equal(JSON.stringify(await status(c)).includes(token), false)

    // The user runs it (here: the system's real shell, the stand-in claude).
    const runLine = () => {
      const shell = userShell(clipboard())
      const r = spawnSync(shell.file, shell.args, { encoding: 'utf8', timeout: 60_000, windowsHide: true })
      assert.equal(r.status, 0, r.stderr)
      const added = calls().at(-1)
      assert.equal(calls().at(-2), `mcp remove --scope user ${name}`)
      const m = /^mcp add --transport http --scope user (\S+) (\S+) --header Authorization: Bearer ([A-Za-z0-9_-]+)$/.exec(added)
      assert.ok(m, added)
      // What `claude mcp get` says after such an add (Claude Code 2.1.318's own lines).
      writeFileSync(join(bin, 'get.txt'), [`${m[1]}:`, '  Scope: User config (available in all your projects)', '  Status: ✔ Connected', '  Type: http', `  URL: ${m[2]}`, '  Headers:', `    Authorization: Bearer ${m[3]}`, '', `To remove this server, run: claude mcp remove ${m[1]} -s user`, ''].join('\r\n'))
      return m[3]
    }
    assert.equal(runLine(), token, 'the key read from the profile file')
    await c.click('settings.agent.check')
    await waitRow('registered', 'found')
    await waitRow('key', 'ok')
    assert.equal(await textOf(c, 'settings.agent.row.registered'), 'Registration found')
    assert.equal(await c.attr('settings.agent.step.2', 'data-state'), 'ok')
    assert.equal(await c.attr('settings.agent.step.3', 'data-state'), 'now')

    // Renew key (under Details): asked first; the old entry is then an old key.
    await c.click('settings.agent.more')
    await c.click('settings.agent.renew')
    await c.click('settings.agent.renew.cancel')
    assert.equal(JSON.parse(readFileSync(settings, 'utf8')).token, token)
    await c.click('settings.agent.renew')
    await c.click('settings.agent.renew.confirm')
    await c.waitFor('a new key', () => JSON.parse(readFileSync(settings, 'utf8')).token !== token)
    const fresh = JSON.parse(readFileSync(settings, 'utf8')).token
    assert.equal(await listening(app.agentPort), true, 'the server runs on, with the new key')
    const old = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' })
    assert.equal(old.status, 401, 'the old key is refused')
    await c.click('settings.agent.check')
    await waitRow('key', 'old')
    assert.equal(await row('registered'), 'found', 'registered, at the right address')
    assert.equal(await c.attr('settings.agent.step.2', 'data-state'), 'now')
    // The row's own button copies step 2's line again; run: added with the new key.
    await c.click('settings.agent.row.key.fix')
    await c.waitFor('copied again', () => clipboard()?.includes(' mcp add '))
    assert.equal(runLine(), fresh)
    await c.click('settings.agent.check')
    await waitRow('key', 'ok', 'the new key, checked after the refused one')

    // Codex (terminal): one line that keeps the key for the user and adds the server.
    await c.click('settings.agent.program.codexCli')
    await waitRow('registered', 'missing', 'codex not added')
    await c.click('settings.agent.register')
    await c.waitFor('the codex line', () => clipboard()?.includes(' mcp add '))
    const codex = (await status(c)).agents.find((a) => a.id === 'codex').path
    const variable = 'SNIPPSTUDIO_DEV_TOKEN'
    const line = clipboard()
    assert.equal(line.includes(fresh), false, 'no key in the codex line')
    let add = line
    // (Windows' line keeps the key for the user first; elsewhere there is none.)
    const windows = line.startsWith('[Environment]::')
    if (windows) {
      const keep = `[Environment]::SetEnvironmentVariable('${variable}', (Get-Content -LiteralPath '${settings.replace(/'/g, "''")}' -Raw | ConvertFrom-Json).token, 'User'); `
      assert.ok(line.startsWith(keep), line)
      // (That part would write this computer's own environment: not run here.)
      add = line.slice(keep.length)
      assert.equal(add.includes('SetEnvironmentVariable'), false)
    }
    assert.ok(add.includes(`'${q(codex)}' mcp remove ${name}`), add)
    assert.ok(add.includes(`'${q(codex)}' mcp add ${name} --url '${url}' --bearer-token-env-var ${variable}`), add)
    const r = spawnSync(userShell(add).file, userShell(add).args, { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(codexCalls().slice(-2), [`mcp remove ${name}`, `mcp add ${name} --url ${url} --bearer-token-env-var ${variable}`])
    writeFileSync(join(bin, 'codex-get.json'), JSON.stringify({ name, enabled: true, transport: { type: 'streamable_http', url, bearer_token_env_var: variable } }))
    await c.click('settings.agent.check')
    await waitRow('registered', 'found', 'codex added')
    if (windows) {
      // The key row: the user's variable (here the test's, e2e-user-env.json)
      // compared with the profile's key inside PowerShell: missing, another, the same.
      await waitRow('key', 'notSaved')
      writeFileSync(join(app.profile, 'e2e-user-env.json'), JSON.stringify({ [variable]: token }))
      await c.click('settings.agent.check')
      await waitRow('key', 'old')
      writeFileSync(join(app.profile, 'e2e-user-env.json'), JSON.stringify({ [variable]: fresh }))
      await c.click('settings.agent.check')
      await waitRow('key', 'ok')
    }

    // An agent from outside: the wizard and the Agent tab say it is connected, and when it leaves.
    await c.click('settings.agent.check')
    await waitRow('connected', 'never', 'all right but no agent yet')
    const agent = await connectAgent({ c, app, assert, client: 'codex-mcp-client' })
    await waitRow('connected', 'ok')
    await c.waitId('settings.agent.connected')
    assert.match(await textOf(c, 'settings.agent.row.connected'), /^Codex connected · \d\d:\d\d$/)
    await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${agent.token}`, 'mcp-session-id': agent.session } })
    await c.click('settings.close')
    await c.waitGone('settings')
    await c.click('inspector.tab.agent')
    await c.waitFor('no agent now', async () => (await c.attr('agent.connection', 'data-state')) === 'server')
    const again = await connectAgent({ c, app, assert, client: 'claude-code' })
    // (The Agent tab names the program, not its MCP client name, since the
    // agent interface merge, 11b9766b: agentDisplayName.)
    await c.waitFor('connected from outside', async () => (await textOf(c, 'agent.status')) === 'Connected · from outside (Claude Code)')
    await fetch(url, { method: 'DELETE', headers: { authorization: `Bearer ${again.token}`, 'mcp-session-id': again.session } })
    await c.waitFor('gone again', async () => (await c.attr('agent.connection', 'data-state')) === 'server')
    // Every call the app made of claude and codex was a read: --version and mcp get.
    assert.deepEqual([...new Set(calls().filter((l) => !/^mcp (add|remove) /.test(l)))], [`mcp get ${name}`])
    assert.deepEqual([...new Set(codexCalls().filter((l) => !/^mcp (add|remove) /.test(l)))], [`mcp get ${name} --json`])
    console.log(`     claude: ${calls().filter((l) => l.startsWith('mcp get')).length} checks, 2 adds; codex: ${codexCalls().filter((l) => l.startsWith('mcp get')).length} checks, 1 add; all run in the user's shell`)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
  await relaunch({})
}
