// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A scripted agent for the e2e scenarios (SnippStudio phase 4A): real HTTP to
// the app's agent server (the profile's token, MCP JSON-RPC, a session from
// initialize), every answer's size counted the way the app estimates tokens
// (renderer agent/tokens.ts: characters / 3.6, a picture width × height / 750).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CHARS_PER_TOKEN = 3.6
const PIXELS_PER_TOKEN = 750

/** Width and height of a base64 JPEG or PNG. */
export function imageDims(b64) {
  const bin = Buffer.from(b64.slice(0, 65536), 'base64')
  if (bin[0] === 0x89 && bin.toString('latin1', 1, 4) === 'PNG') return { width: bin.readUInt32BE(16), height: bin.readUInt32BE(20) }
  let i = 2
  while (i + 9 < bin.length) {
    if (bin[i] !== 0xff) return null
    const marker = bin[i + 1]
    const len = bin.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: bin.readUInt16BE(i + 5), width: bin.readUInt16BE(i + 7) }
    i += 2 + len
  }
  return null
}

export async function connectAgent({ c, app, assert, client = 'e2e-script' }) {
  const { token } = await c.waitFor('agent.json', async () => { try { return JSON.parse(readFileSync(join(app.profile, 'agent.json'), 'utf8')) } catch { return null } })
  const url = `http://127.0.0.1:${app.agentPort}/mcp`
  let id = 0
  let session = null
  const log = []
  const rpc = async (method, params, headers = {}) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}), ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
    const body = r.status === 200 ? await r.json() : await r.text()
    return { status: r.status, body, headers: r.headers }
  }
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: client, version: '1' } })
  assert.equal(init.status, 200)
  session = init.headers.get('mcp-session-id')
  assert.ok(session, 'initialize names a session')
  const list = await rpc('tools/list', {})
  const defsChars = JSON.stringify(init.body).length + JSON.stringify(list.body).length
  const tools = list.body.result.tools
  /** One tool call; its answer and size. Throws on a protocol error. */
  const call = async (name, args = {}, { allowError = false } = {}) => {
    const r = await rpc('tools/call', { name, arguments: args })
    assert.equal(r.status, 200, `${name}: HTTP ${r.status}`)
    assert.ok(!r.body.error, `${name}: ${JSON.stringify(r.body.error)}`)
    const res = r.body.result
    const text = res.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n')
    const images = res.content.filter((x) => x.type === 'image').map((x) => imageDims(x.data))
    const tokens = text.length / CHARS_PER_TOKEN + images.reduce((n, d) => n + (d ? (d.width * d.height) / PIXELS_PER_TOKEN : 0), 0)
    log.push({ tool: name, kind: args.kind ?? args.ops?.[0]?.op ?? args.start, chars: text.length, images: images.length, tokens: Math.round(tokens), error: !!res.isError })
    if (res.isError && !allowError) throw new Error(`${name} failed: ${text}`)
    return { text, images, result: res, isError: !!res.isError }
  }
  const total = () => log.reduce((n, l) => n + l.tokens, 0)
  const summary = (label) => `${label}: ${log.length} calls, answers ≈ ${total()} tokens (+ definitions ${Math.round(defsChars / CHARS_PER_TOKEN)} once)\n` + log.map((l) => `   ${l.tool}${l.kind ? ' ' + l.kind : ''}: ${l.chars} chars${l.images ? `, ${l.images} image` : ''} ≈ ${l.tokens}${l.error ? ' (error)' : ''}`).join('\n')
  return { url, token, session, rpc, call, tools, defsChars, log, total, summary }
}

/** The version a tool answer names ("v ab12c-7"). */
export const versionOf = (text) => /\bv ([0-9a-z]+-\d+)/i.exec(text)?.[1] ?? null
/** The result id an analyze answer names. */
export const resultOf = (text) => /^(r\d+) /.exec(text)?.[1] ?? null
/** The items of an analyze answer (numbered lines). */
export const itemsOf = (text) => text.split('\n').filter((l) => /^\d+ /.test(l))
