// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Security patch, item 8 (K-G6, K-G7): the agent server's door against slow
// and oversized requests, on a real loopback socket. A request left half-sent
// is closed after ten seconds (Node's default kept it for a minute and a
// half); a connection that never sends anything goes the same way; at most 64
// connections are held; a body over 1 MB is answered 413 and the answer
// reaches the client.
import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'
import { AGENT_PATH, CONNECTIONS_MAX, REQUEST_TIMEOUT_MS, startAgentServer, type AgentSessions, type RunningAgentServer } from '../main/agent-server'

const TOKEN = 'k'.repeat(43)

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

const sessions: AgentSessions = { open: () => 's1', has: () => true, end: () => undefined, fallback: () => 'default', sent: () => undefined }

async function withServer(work: (port: number, server: RunningAgentServer) => Promise<void>): Promise<void> {
  const port = await freePort()
  const server = await startAgentServer({ port, token: TOKEN, version: '1', sessions, call: async () => ({ content: [{ type: 'text', text: 'ok' }] }) })
  try {
    await work(port, server)
  } finally {
    await server.close()
  }
}

/** Opens a socket, writes `text` (maybe nothing) and tells when the server
 *  closed it and what it had answered until then. */
function hold(port: number, text: string): { socket: Socket; closed: Promise<{ seconds: number; answer: string }> } {
  const t0 = Date.now()
  const socket = connect(port, '127.0.0.1')
  let answer = ''
  socket.on('data', (d) => (answer += d.toString('latin1')))
  socket.on('error', () => undefined)
  if (text) socket.write(text)
  const closed = new Promise<{ seconds: number; answer: string }>((res) => socket.on('close', () => res({ seconds: (Date.now() - t0) / 1000, answer })))
  return { socket, closed }
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'still open'> => Promise.race([p, new Promise<'still open'>((r) => setTimeout(() => r('still open'), ms).unref())])

test('item 8: the limits are the ones decided', () => {
  assert.equal(REQUEST_TIMEOUT_MS, 10_000)
  assert.equal(CONNECTIONS_MAX, 64)
})

test('item 8: a half-sent request and a silent connection are closed after ten seconds', async () => {
  await withServer(async (port) => {
    const headers = hold(port, `POST ${AGENT_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: applic`)
    const body = hold(port, `POST ${AGENT_PATH} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"jsonrpc":`)
    const silent = hold(port, '')
    const limit = REQUEST_TIMEOUT_MS + 5_000
    const [h, b, s] = await Promise.all([within(headers.closed, limit), within(body.closed, limit), within(silent.closed, limit)])
    for (const x of [headers, body, silent]) x.socket.destroy()
    assert.notEqual(h, 'still open', 'half-sent headers')
    assert.notEqual(b, 'still open', 'a half-sent body')
    assert.notEqual(s, 'still open', 'a silent connection')
    for (const [name, r] of [['headers', h], ['body', b], ['silent', s]] as const) {
      const seconds = (r as { seconds: number }).seconds
      assert.ok(seconds >= 8 && seconds <= 15, `${name}: closed after ${seconds} s`)
    }
  })
})

test('item 8: a working call is not cut by the ten seconds: they are for receiving the request only', async () => {
  const port = await freePort()
  const server = await startAgentServer({ port, token: TOKEN, version: '1', sessions, call: () => new Promise((res) => setTimeout(() => res({ content: [{ type: 'text', text: 'late' }] }), 12_500)) })
  try {
    const r = await fetch(`http://127.0.0.1:${port}${AGENT_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'project', arguments: {} } }) })
    assert.equal(r.status, 200)
    assert.match(JSON.stringify(await r.json()), /late/)
  } finally {
    await server.close()
  }
})

test('item 8: a body over 1 MB is answered 413, and the answer reaches the client', async () => {
  await withServer(async (port) => {
    for (const bytes of [1024 * 1024 + 1024, 6 * 1024 * 1024]) {
      const answer = await new Promise<{ status: number; body: string }>((res, rej) => {
        const req = request({ host: '127.0.0.1', port, path: AGENT_PATH, method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'content-length': bytes } }, (r) => {
          let body = ''
          r.on('data', (d) => (body += d))
          r.on('end', () => res({ status: r.statusCode ?? 0, body }))
        })
        req.on('error', rej)
        // (In pieces, as a real client sends a large body.)
        const piece = Buffer.alloc(64 * 1024, 0x20)
        let sent = 0
        const more = (): void => {
          while (sent < bytes) {
            const n = Math.min(piece.length, bytes - sent)
            sent += n
            if (!req.write(n === piece.length ? piece : piece.subarray(0, n))) return void req.once('drain', more)
          }
          req.end()
        }
        more()
      })
      assert.equal(answer.status, 413, `${bytes} bytes`)
      assert.match(answer.body, /too large/i)
    }
    // Exactly at the limit is still read (and is not JSON: 400).
    const ok = await fetch(`http://127.0.0.1:${port}${AGENT_PATH}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: ' '.repeat(1024 * 1024) })
    assert.equal(ok.status, 400)
  })
})

test('item 8: at most 64 connections are held; a call still gets through when the idle ones have gone', async () => {
  await withServer(async (port) => {
    const held = Array.from({ length: CONNECTIONS_MAX + 40 }, () => hold(port, ''))
    await new Promise((r) => setTimeout(r, 1_500))
    // The ones over the limit were dropped at once.
    const early = await Promise.all(held.map((h) => within(h.closed, 10)))
    const dropped = early.filter((x) => x !== 'still open').length
    assert.ok(dropped >= 40, `${dropped} of ${held.length} dropped at once`)
    assert.ok(held.length - dropped <= CONNECTIONS_MAX, `${held.length - dropped} held`)
    for (const h of held) h.socket.destroy()
    await new Promise((r) => setTimeout(r, 300))
    const r = await fetch(`http://127.0.0.1:${port}${AGENT_PATH}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
    assert.equal(r.status, 200)
  })
})
