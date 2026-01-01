// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 7 (K-G4): the agent server's secret key never goes to
// the page. What the main process answers a page about the server holds no
// key; the key stays in the profile's files and in the main process (the
// session's own config, the agent's environment). The window that owns the
// terminal is checked in the app: e2e `security-agent-key`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentHost } from '../main/agent-host'

const SRC = path.join(__dirname, '..', '..', 'src')

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => res(port))
    })
  })
}

test('item 7: what the page is told about the agent server holds no key', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-g7-'))
  const host = new AgentHost({ userData: () => dir, port: await freePort(), version: '1', name: 'snipp-dev', forced: false, target: () => null })
  try {
    const on = await host.setEnabled(true)
    assert.equal(on.running, true)
    const token = (JSON.parse(readFileSync(path.join(dir, 'agent.json'), 'utf8')) as { token: string }).token
    assert.match(token, /^[A-Za-z0-9_-]{32,}$/)
    const answers = [on, await host.status(), await host.setEnabled(false), await host.setEnabled(true)]
    for (const a of answers) {
      const text = JSON.stringify(a)
      assert.equal(text.includes(token), false, 'the key is in an answer for the page')
      assert.doesNotMatch(text, /Bearer|Authorization/i)
      assert.deepEqual(Object.keys(a).sort(), ['enabled', 'error', 'port', 'running', 'url'])
    }
    // (The main process itself still has it, for the session's own config.)
    assert.equal((await host.connection())?.token, token)
  } finally {
    await host.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('item 7: the bridge\'s type of the server status names no key field', () => {
  const preload = readFileSync(path.join(SRC, 'preload', 'index.ts'), 'utf8')
  const at = preload.indexOf('export interface AgentStatus {')
  assert.ok(at > 0)
  const body = preload.slice(at, preload.indexOf('\n}', at))
  assert.doesNotMatch(body, /\bheader\b|\bclaude\b|token/i)
})
