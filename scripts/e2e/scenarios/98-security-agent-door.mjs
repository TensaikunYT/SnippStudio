// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent server's door, tried with raw HTTP the way another program on
// this computer (or a web page in the user's browser) would (final security
// audit, 23 Nov 2026; SECURITY-REVIEW.md "The agent server"). Every refusal
// the review claims: only 127.0.0.1 listens; no token, a wrong one, a prefix,
// a longer one: 401; any Origin (also "null") even with the right token, a
// preflight: 403 and never a CORS header; a foreign Host or one without the
// port (DNS rebinding): 403; no Host: 400; GET: 405; another path: 404; a
// made-up session: 404; a body over 1 MB (sent or only declared): 413;
// 100 idle connections at once: the app answers again once they go, and the
// server itself drops a connection that sends nothing; and with access off
// nothing listens. Then what an agent with the key sends that the page
// shows: its program name, a worker label and plan steps holding HTML are
// shown as text (no element is made, no script runs), and over-long ones
// are cut or refused.
import { request } from 'node:http'
import { connect as netConnect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { accessOn, listening } from '../session.mjs'
import { connectAgent } from '../agent-client.mjs'
export const name = 'security-agent-door'
export const freshWindow = true

/** One raw request: its status, headers and body text (never throws for a
 *  refused answer; a refused CONNECTION gives { error }). */
function raw(port, { method = 'POST', path = '/mcp', headers = {}, body, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const req = request({ host, port, method, path, headers, setHost: !Object.keys(headers).some((k) => k.toLowerCase() === 'host'), agent: false, timeout: 15_000 }, (res) => {
      const chunks = []
      res.on('data', (d) => chunks.push(d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', (e) => resolve({ error: e.code ?? String(e) }))
    })
    req.on('error', (e) => resolve({ error: e.code ?? String(e) }))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** Bytes sent on a bare socket; the first answer line (or the error). */
function bare(port, text, ms = 4000) {
  return new Promise((resolve) => {
    const s = netConnect(port, '127.0.0.1')
    let got = ''
    const done = (v) => {
      s.destroy()
      resolve(v)
    }
    s.on('connect', () => s.write(text))
    s.on('data', (d) => {
      got += d.toString('latin1')
      if (got.includes('\r\n')) done(got.split('\r\n')[0])
    })
    s.on('error', (e) => done(`error ${e.code}`))
    s.on('close', () => done(got.split('\r\n')[0] || 'closed'))
    setTimeout(() => done(got.split('\r\n')[0] || 'no answer'), ms)
  })
}

const rpcBody = (method, params = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await accessOn(c)
  const port = app.agentPort
  const token = JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8')).token
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const list = rpcBody('tools/list')
  const noCors = (r, what) => {
    for (const k of Object.keys(r.headers ?? {})) assert.ok(!/^access-control-/i.test(k), `${what}: a CORS header ${k}`)
  }

  // Only 127.0.0.1 listens.
  const v6 = await raw(port, { host: '::1', headers: auth, body: list })
  assert.ok(v6.error, `[::1] answered ${v6.status}`)
  for (const list4 of Object.values(networkInterfaces())) {
    for (const a of list4 ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const r = await raw(port, { host: a.address, headers: auth, body: list })
      assert.ok(r.error, `${a.address} answered ${r.status}`)
    }
  }

  // The right request works (the baseline every refusal below differs from by one thing).
  const good = await raw(port, { headers: auth, body: list })
  assert.equal(good.status, 200, good.body)
  noCors(good, 'a good answer')
  assert.equal((await raw(port, { headers: { ...auth, host: `localhost:${port}` }, body: list })).status, 200, 'localhost:<port> is this address too')

  // The key.
  const keyCases = {
    none: {},
    empty: { authorization: 'Bearer ' },
    wrong: { authorization: `Bearer ${'A'.repeat(token.length)}` },
    prefix: { authorization: `Bearer ${token.slice(0, -1)}` },
    longer: { authorization: `Bearer ${token}x` },
    basic: { authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}` },
    lowercase: { authorization: `Bearer ${token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase()}` }
  }
  for (const [what, h] of Object.entries(keyCases)) {
    const r = await raw(port, { headers: { 'content-type': 'application/json', ...h }, body: list })
    assert.equal(r.status, 401, `${what}: ${r.status}`)
    assert.equal(r.headers['www-authenticate'], 'Bearer', what)
    assert.equal(r.body.includes(token), false, `${what}: the answer holds the key`)
    noCors(r, what)
  }

  // A browser page: any Origin, even with the right key; a preflight.
  for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${port}`, 'file://']) {
    const r = await raw(port, { headers: { ...auth, origin }, body: list })
    assert.equal(r.status, 403, `Origin ${origin}: ${r.status}`)
    noCors(r, `Origin ${origin}`)
  }
  const pre = await raw(port, { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } })
  assert.equal(pre.status, 403, `preflight: ${pre.status}`)
  noCors(pre, 'preflight')
  // A plain form post (no preflight in a browser): Origin is sent, refused.
  assert.equal((await raw(port, { headers: { origin: 'http://evil.example', 'content-type': 'text/plain' }, body: list })).status, 403)

  // DNS rebinding: the page's own name in Host.
  for (const host of [`evil.example:${port}`, '127.0.0.1', 'localhost', `127.0.0.1:${port + 1}`, `127.0.0.1.evil.example:${port}`, `[::1]:${port}`]) {
    const r = await raw(port, { headers: { ...auth, host }, body: list })
    assert.equal(r.status, 403, `Host ${host}: ${r.status}`)
  }
  // No Host at all (HTTP/1.1 requires one): Node answers 400 before the app.
  assert.match(await bare(port, `POST /mcp HTTP/1.1\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${list.length}\r\n\r\n${list}`), / 400 /)

  // Method, path, session.
  assert.equal((await raw(port, { method: 'GET', headers: auth })).status, 405, 'GET')
  assert.equal((await raw(port, { method: 'PUT', headers: auth, body: list })).status, 405, 'PUT')
  for (const p of ['/', '/mcp/', '/MCP', '/mcp/..', '/x/../mcp', '/%6dcp']) assert.equal((await raw(port, { path: p, headers: auth, body: list })).status, 404, `path ${p}`)
  const made = await raw(port, { headers: { ...auth, 'mcp-session-id': 'not-a-session' }, body: list })
  assert.equal(made.status, 404, 'a made-up session')

  // Bodies: not JSON, a batch, over 1 MB sent, over 1 MB only declared.
  assert.equal((await raw(port, { headers: auth, body: '{"jsonrpc":' })).status, 400, 'broken JSON')
  const batch = await raw(port, { headers: auth, body: JSON.stringify([JSON.parse(list), JSON.parse(list)]) })
  assert.match(batch.body, /one JSON-RPC message/, 'a batch is refused')
  const big = await raw(port, { headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(1_500_000) } }) })
  assert.equal(big.status, 413, `1.5 MB: ${big.status}`)
  assert.match(await bare(port, `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\nContent-Length: 104857600\r\n\r\n{}`), / 413 /, 'a declared 100 MB body')

  // 100 connections at once that send nothing: the server holds at most 64,
  // drops the others, and closes the idle ones by itself within its ten
  // seconds; then the agent is answered again.
  const socks = []
  const closedBy = []
  const t0 = Date.now()
  for (let i = 0; i < 100; i++) {
    const s = netConnect(port, '127.0.0.1')
    s.on('error', () => {})
    s.on('close', () => closedBy.push(Date.now() - t0))
    socks.push(s)
  }
  await c.waitFor('the idle connections dropped by the server', async () => closedBy.length === 100, 20_000)
  assert.ok(Math.max(...closedBy) < 15_000, `the last idle connection went after ${Math.max(...closedBy)} ms`)
  for (const s of socks) s.destroy()
  assert.equal((await raw(port, { headers: auth, body: list })).status, 200, 'answered again after the flood')

  // What an agent with the key sends that the page SHOWS: as text only.
  const evil = '<img src=x onerror="window.__xss=1">'
  const ag = await connectAgent({ c, app, assert, client: `${evil}${'n'.repeat(300)}` })
  await ag.call('project', { as: '<b onmouseover=window.__xss=2>w</b>' })
  const planned = await ag.call('wait', { seconds: 5, plan: ['<img src=x onerror=window.__xss=3>'.slice(0, 24), 'step two'], as: 'w1' }, { allowError: true })
  assert.ok(!planned.isError, planned.text)
  const longPlan = await ag.call('wait', { plan: ['x'.repeat(25)] }, { allowError: true })
  assert.ok(longPlan.isError, 'a plan step over 24 characters is refused')
  const manyPlan = await ag.call('wait', { plan: Array.from({ length: 9 }, (_, i) => `s${i}`) }, { allowError: true })
  assert.ok(manyPlan.isError, 'more than 8 plan steps are refused')
  await c.sleep(500)
  const page = await c.ev(`(() => ({
    xss: window.__xss ?? null,
    imgs: [...document.querySelectorAll('img')].filter((i) => /(^|\\/)x$/.test(i.getAttribute('src') ?? '')).length,
    bold: [...document.querySelectorAll('b[onmouseover]')].length,
    text: document.body.innerText.includes('<img src=x')
  }))()`)
  assert.equal(page.xss, null, 'a script ran')
  assert.equal(page.imgs, 0, 'an element was made from the agent text')
  assert.equal(page.bold, 0, 'an element was made from the worker label')
  // The program name the wizard keeps is cut to 80 characters.
  const heard = await c.ev('window.api.agentSession.status()')
  for (const s of heard.heard.seen) assert.ok(s.client.length <= 80, `a program name of ${s.client.length} characters`)
  // A huge label is cleaned to 12 letters (crew.ts), never an error.
  const labelled = await ag.call('project', { as: 'z'.repeat(200_000) })
  assert.ok(!labelled.isError)
  assert.equal(await c.ev(`[...document.querySelectorAll('*')].some((e) => e.childElementCount === 0 && (e.textContent ?? '').includes('zzzzzzzzzzzzz'))`), false, 'a label longer than 12 letters is shown')

  // Off: nothing listens.
  await c.ev('window.api.agent.setEnabled(false)')
  await c.waitFor('the port closed', async () => !(await listening(port)), 10_000)
  await c.ev('window.api.agent.setEnabled(true)')
  await c.waitFor('the port open again', () => listening(port), 10_000)
}
