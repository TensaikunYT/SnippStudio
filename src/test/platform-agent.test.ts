// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b, steps 3 and 4 (FAZ10-PLAN.md): the places an agent is looked
// for and the copied commands, each platform's branch run here on Windows.
// (The embedded terminal's package and way D's system terminal went:
// TERMINAL-YOK-PLAN.md.)
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { findAgents, knownDirs } from '../main/agent-connect'

test('knownDirs: Windows as before; macOS and Linux their own places, absolute only', () => {
  const winEnv = { APPDATA: 'C:\\Users\\u\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', USERPROFILE: 'C:\\Users\\u' }
  const home = 'C:\\Users\\u'
  assert.deepEqual(knownDirs(winEnv, 'win32'), [
    path.join(winEnv.APPDATA, 'npm'),
    path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.codex', 'bin'),
    path.join(home, '.opencode', 'bin'), path.join(home, 'scoop', 'shims'),
    path.join(winEnv.LOCALAPPDATA, 'Programs', 'claude'), path.join(winEnv.LOCALAPPDATA, 'Programs', 'codex'), path.join(winEnv.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'), path.join(winEnv.LOCALAPPDATA, 'agy', 'bin')
  ])
  const mac = knownDirs({ HOME: '/Users/a' }, 'darwin')
  for (const d of ['/Users/a/.local/bin', '/Users/a/.claude/local', '/Users/a/.npm-global/bin', '/opt/homebrew/bin', '/usr/local/bin']) assert.ok(mac.includes(d), d)
  assert.equal(mac.includes('/snap/bin'), false)
  const lin = knownDirs({ HOME: '/home/a', npm_config_prefix: '/home/a/.npm' }, 'linux')
  for (const d of ['/home/a/.local/bin', '/home/a/.npm/bin', '/usr/local/bin', '/snap/bin']) assert.ok(lin.includes(d), d)
  assert.equal(lin.includes('/opt/homebrew/bin'), false)
  assert.deepEqual(knownDirs({ HOME: 'relative/home' }, 'linux'), ['/usr/local/bin', '/snap/bin'], 'a home that is not absolute adds nothing')
  for (const d of [...mac, ...lin]) assert.ok(d.startsWith('/') && !d.includes('\\'), d)
})

test('findAgents on macOS: an app started from Finder (short PATH) still finds Homebrew\'s and the installer\'s', () => {
  const disk = new Set(['/opt/homebrew/bin/codex', '/Users/a/.local/bin/claude'])
  const found = findAgents({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/a' }, (p) => disk.has(p), 'darwin')
  assert.deepEqual(found, [
    { id: 'claude', path: '/Users/a/.local/bin/claude' },
    { id: 'codex', path: '/opt/homebrew/bin/codex' }
  ])
  // Linux: PATH first (':' separated), no extension.
  const lin = findAgents({ PATH: '/opt/tools:/usr/bin', HOME: '/home/a' }, (p) => p === '/opt/tools/claude' || p === '/home/a/.local/bin/claude', 'linux')
  assert.deepEqual(lin, [{ id: 'claude', path: '/opt/tools/claude' }])
  // A relative PATH entry is never searched.
  assert.deepEqual(findAgents({ PATH: 'bin:.', HOME: '/nowhere' }, () => true, 'linux').map((a) => a.path).filter((p) => !p.startsWith('/')), [])
})

test('the copied agent commands outside Windows are sh lines (phase 10b.7); Windows keeps PowerShell', async () => {
  const { codexAddLine, tokenSetupLine, antigravityPrintLine } = await import('../main/agent-connect')
  const file = "/Users/a/Library/Application Support/SnippStudio/agent.json"
  // Windows: as before.
  assert.match(tokenSetupLine('C:\p\agent.json', 'win32'), /^\$env:SNIPP_MCP_TOKEN = \(Get-Content -LiteralPath /)
  assert.match(codexAddLine('http://127.0.0.1:47811/mcp', 'snippstudio-dev', 'win32'), /^\$env:NoDefaultCurrentDirectoryInExePath = '1'; codex mcp remove /)
  assert.match(antigravityPrintLine('C:\p\agent.json', 'http://127.0.0.1:47811/mcp', 'win32'), /ConvertTo-Json/)
  // macOS and Linux: sh, the token read by sed from the settings file (never written out).
  for (const p of ['darwin', 'linux']) {
    const env = tokenSetupLine(file, p)
    assert.equal(env, `export SNIPP_MCP_TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' '${file}')"`)
    const codex = codexAddLine('http://127.0.0.1:47811/mcp', 'snippstudio', p, '/opt/homebrew/bin/codex')
    assert.equal(codex, `'/opt/homebrew/bin/codex' mcp remove snippstudio >/dev/null 2>&1; '/opt/homebrew/bin/codex' mcp add snippstudio --url 'http://127.0.0.1:47811/mcp' --bearer-token-env-var SNIPPSTUDIO_TOKEN`)
    assert.equal(/Set-Location|\$env:|Get-Content/.test(codex), false)
    const ag = antigravityPrintLine(file, 'http://127.0.0.1:47811/mcp', p)
    assert.match(ag, /^k="\$\(sed -n /)
    assert.ok(ag.includes(`printf '{"mcpServers":{"snippstudio":{"serverUrl":"http://127.0.0.1:47811/mcp","headers":{"Authorization":"Bearer %s"}}}}\\n' "$k"`), ag)
  }
  // A quote in a path is closed and reopened for sh.
  assert.ok(tokenSetupLine("/home/o'neil/agent.json", 'linux').endsWith(`'/home/o'\\''neil/agent.json')"`))
})
