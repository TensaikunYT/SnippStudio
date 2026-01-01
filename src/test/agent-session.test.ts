// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent connection's pure parts (main/agent-connect.ts; SnippStudio
// phase 4B.1, then TERMINAL-YOK-PLAN.md: the embedded session, its
// launch, way D's line, the project's line and recipes went): finding the
// agent program, a read-only question to it through an npm shim, OpenCode's
// part, the environment a question gets.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agentEnv, agentQuery, findAgents, openCodeConfig } from '../main/agent-connect'

const win = (p: string): string => p.replace(/\//g, '\\')

test('agents are found in PATH first, then the known install places; Claude Code before Codex', () => {
  const env = { PATH: 'C:\\Windows;C:\\tools', APPDATA: 'C:\\Users\\u\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\u', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
  const disk = new Set([path.join('C:\\Users\\u\\AppData\\Roaming', 'npm', 'claude.cmd'), path.join('C:\\tools', 'codex.exe'), path.join('C:\\Users\\u', '.local', 'bin', 'claude.exe')])
  const found = findAgents(env, (p) => disk.has(p), 'win32')
  assert.deepEqual(found.map((f) => f.id), ['claude', 'codex'])
  // (The npm folder comes before ~\.local\bin in the known places.)
  assert.equal(win(found[0].path), win(path.join('C:\\Users\\u\\AppData\\Roaming', 'npm', 'claude.cmd')))
  assert.equal(win(found[1].path), win(path.join('C:\\tools', 'codex.exe')))
  assert.deepEqual(findAgents({ PATH: 'C:\\x' }, () => false, 'win32'), [])
  assert.deepEqual(findAgents({ PATH: '.;relative' }, () => true, 'win32'), [])
})

test('a question to a Codex npm shim reaches it with its arguments as they are, even under an install path with spaces, % and &', { skip: process.platform !== 'win32' }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp %USERNAME% & codex '))
  const before = process.env.SNIPP_TEST_NODE
  process.env.SNIPP_TEST_NODE = process.execPath
  try {
    const shim = path.join(dir, 'codex.cmd')
    writeFileSync(shim, ['@echo off', '"%SNIPP_TEST_NODE%" "%~dp0read-args.cjs" %*', ''].join(String.fromCharCode(13, 10)))
    writeFileSync(path.join(dir, 'read-args.cjs'), 'console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }))')
    const r = await agentQuery({ id: 'codex', path: shim }, ['mcp', 'get', 'snippstudio-dev', '--json'], dir, null, 10_000)
    assert.equal(r?.code, 0, r?.output ?? 'no answer')
    assert.deepEqual(JSON.parse(r!.output), { args: ['mcp', 'get', 'snippstudio-dev', '--json'], cwd: dir })
  } finally {
    if (before === undefined) delete process.env.SNIPP_TEST_NODE
    else process.env.SNIPP_TEST_NODE = before
    rmSync(dir, { recursive: true, force: true })
  }
})

// (Whether anything is written in the user's own agent settings is checked
// on the real disk, with a throw-away home: agent-audit7.test.ts, S3.)
test('OpenCode\'s part is a JSON fragment that names the key\'s variable, never the key', () => {
  const url = 'http://127.0.0.1:47811/mcp'
  assert.deepEqual(JSON.parse(openCodeConfig(url)), {
    mcp: { servers: { snippstudio: { type: 'remote', url, oauth: false, headers: { Authorization: 'Bearer {env:SNIPP_MCP_TOKEN}' } } } }
  })
})

test('a question to an agent program gets neither Electron\'s own environment nor a key', () => {
  const env = agentEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--x', HOME: 'h', SNIPPSTUDIO_DEV_TOKEN: 'k', SNIPPSTUDIO_TOKEN: 'k', SNIPP_MCP_TOKEN: 'k' }, {}, 'linux')
  assert.deepEqual(env, { PATH: 'p', HOME: 'h' })
})
