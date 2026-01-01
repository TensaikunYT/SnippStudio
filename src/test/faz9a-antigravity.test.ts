// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 9a (FAZ9-PLAN.md, step 4): Antigravity, the fourth row
// of the agent chooser (since TERMINAL-YOK-PLAN.md: of Settings → Agent connection). Experimental and connected by hand like OpenCode: the
// app finds its CLI (`agy`) only to say it is installed, never starts it,
// writes nothing of Antigravity's, and hands over a PowerShell command that
// prints the MCP config entry with the key (Antigravity's headers take no
// environment variable), so the key never reaches the page or the clipboard.
import './dom-stub'
import './css-stub'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AGENT_IDS, antigravityPrintLine, findAgents } from '../main/agent-connect'
import { AGENT_NAME } from '../renderer/src/components/settings/agents'
import { STRINGS } from '../renderer/src/ui/strings'

test('Antigravity is the fourth agent: found as agy, never started, experimental', () => {
  assert.deepEqual([...AGENT_IDS], ['claude', 'codex', 'opencode', 'antigravity'])
  assert.equal(AGENT_NAME.antigravity, 'agent.name.antigravity')
  // Its official install place (%LOCALAPPDATA%\agy\bin) and PATH, by its program name.
  const local = 'C:\\Users\\u\\AppData\\Local'
  const at = new Set([path.join(local, 'agy', 'bin', 'agy.exe')])
  assert.deepEqual(findAgents({ PATH: '', LOCALAPPDATA: local, USERPROFILE: 'C:\\Users\\u' }, (p) => at.has(p), 'win32'), [{ id: 'antigravity', path: path.join(local, 'agy', 'bin', 'agy.exe') }])
  assert.deepEqual(findAgents({ PATH: 'C:\\tools' }, (p) => p === path.join('C:\\tools', 'agy.cmd'), 'win32'), [{ id: 'antigravity', path: path.join('C:\\tools', 'agy.cmd') }])
  // A file named after the agent, not its program, is not it.
  assert.deepEqual(findAgents({ PATH: 'C:\\tools' }, (p) => p === path.join('C:\\tools', 'antigravity.exe'), 'win32'), [])
})

test('the help names both of Antigravity\'s MCP config files, in both languages', () => {
  for (const lang of ['en', 'tr'] as const) {
    const text = STRINGS['wiz.s2.if1.other'][lang] // (the connection wizard's Other step, SIHIRBAZ-PLAN.md)
    assert.match(text, /\.agents\/mcp_config\.json/)
    assert.match(text, /~\/\.gemini\/config\/mcp_config\.json/)
  }
})

test('the copied command holds no key; run in real PowerShell it prints the entry with the key, and writes nothing', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'snipp-9a-agy-'))
  try {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const key = 'k3y-0f-32-bytes-in-hex-abcdef0123'
    for (const name of ['profil ığüşöç İ', "O'Neil 'n' co", 'a & b ; c $x']) {
      const dir = path.join(root, name)
      mkdirSync(dir, { recursive: true })
      const settings = path.join(dir, 'agent.json')
      writeFileSync(settings, JSON.stringify({ token: key, port: 47811 }))
      const url = 'http://127.0.0.1:47811/mcp'
      const line = antigravityPrintLine(settings, url)
      assert.ok(!line.includes(key), `${name}: no key in the command`)
      const home = path.join(root, 'home')
      mkdirSync(home, { recursive: true })
      const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', line], {
        cwd: root, encoding: 'utf8', timeout: 20_000, windowsHide: true,
        env: { ...process.env, USERPROFILE: home, HOME: home }
      })
      assert.equal(r.status, 0, `${name}: ${r.stderr}`)
      const entry = JSON.parse(r.stdout)
      // antigravity.google/docs/mcp: serverUrl + headers (httpUrl is not supported).
      assert.deepEqual(entry, { mcpServers: { snippstudio: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } })
      // (PowerShell keeps its own caches under the home's AppData.)
      assert.deepEqual(readdirSync(home).filter((n) => n !== 'AppData'), [], 'nothing of Antigravity in the home (no .gemini)')
      assert.ok(!existsSync(path.join(root, '.agents')), 'nor a workspace config')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
