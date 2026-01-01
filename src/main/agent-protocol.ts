// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent server's protocol side: MCP (Model Context Protocol) over JSON-RPC
// 2.0, the part of it a tool server needs. Pure (no Electron, no sockets), so
// the unit tests drive it directly; main/agent-server.ts puts it on a loopback
// HTTP endpoint and the editor page (renderer agent/) does the work.
//
// An AI agent the user runs themself (Claude Code, Codex, OpenCode, Gemini
// CLI) connects with the user's own subscription: Snipp itself still never
// goes online. What the agent can do here is exactly the tools below.

import { agentTools, SERVER_INSTRUCTIONS, type AgentTool } from '../renderer/src/agent/tools'
import { PRODUCT_NAME } from '../shared/product'

export { SERVER_INSTRUCTIONS, type AgentTool }

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export interface ToolResult {
  content: ToolContent[]
  isError?: boolean
}

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<ToolResult>

/** The protocol revisions this server answers to (it uses nothing newer than
 *  the first one's tools). An agent that asks for another is offered the latest. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

/** The tools (phase 4A, v2): eight, the edit tool's operations generated from
 *  the command schemas (renderer/src/agent/tools.ts, also run by the tests). */
export const AGENT_TOOLS: AgentTool[] = agentTools()

export const textResult = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
export const errorResult = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

/** At most this much of a tool's answer goes back to the agent (a frame is a
 *  few hundred kB; anything near this is a mistake, not an answer). */
export const MAX_RESULT_BYTES = 12 * 1024 * 1024

/**
 * A tool's answer as it came from the editor page, checked before it is sent
 * on: the page is ours, but what crosses to another program is kept to the
 * protocol's two content kinds and a sane size.
 */
export function cleanToolResult(raw: unknown): ToolResult {
  if (!raw || typeof raw !== 'object') return errorResult(`${PRODUCT_NAME} gave no answer for this tool.`)
  const r = raw as { content?: unknown; isError?: unknown }
  if (!Array.isArray(r.content)) return errorResult(`${PRODUCT_NAME} gave no answer for this tool.`)
  const content: ToolContent[] = []
  let bytes = 0
  for (const item of r.content) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (c.type === 'text' && typeof c.text === 'string') {
      bytes += c.text.length
      content.push({ type: 'text', text: c.text })
    } else if (c.type === 'image' && typeof c.data === 'string' && typeof c.mimeType === 'string' && /^image\/(jpeg|png|webp)$/.test(c.mimeType)) {
      bytes += c.data.length
      content.push({ type: 'image', data: c.data, mimeType: c.mimeType })
    }
  }
  if (bytes > MAX_RESULT_BYTES) return errorResult('The answer was too large to send. Ask for a smaller picture or a shorter range.')
  if (content.length === 0) return errorResult(`${PRODUCT_NAME} gave no answer for this tool.`)
  return r.isError === true ? { content, isError: true } : { content }
}

/**
 * A tool's arguments checked against its inputSchema (phase 4A.8, G5): the
 * kinds, the enums, the ranges, the list lengths, the required fields and no
 * unknown field — what the schema promises the agent is what is enforced.
 * Every problem as "where: what" (empty when fine). The JSON Schema subset
 * agent/tools.ts uses: type, properties, required, additionalProperties,
 * items, enum, minimum, maximum, minItems, maxItems, maxLength.
 */
export function checkArgs(schema: Record<string, unknown>, value: unknown, path = ''): string[] {
  const out: string[] = []
  const at = path || 'arguments'
  const type = schema.type as string | undefined
  const typeOk = (): boolean => {
    switch (type) {
      case 'object':
        return !!value && typeof value === 'object' && !Array.isArray(value)
      case 'array':
        return Array.isArray(value)
      case 'string':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value)
      default:
        return true
    }
  }
  if (!typeOk()) return [`${at}: expected ${type === 'integer' ? 'a whole number' : type === 'object' ? 'an object' : type === 'array' ? 'a list' : `a ${type}`}`]
  const en = schema.enum as unknown[] | undefined
  if (en && !en.includes(value)) out.push(`${at}: must be one of ${en.map((x) => JSON.stringify(x)).join(', ')}`)
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) out.push(`${at}: must be at least ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && value > schema.maximum) out.push(`${at}: must be at most ${schema.maximum}`)
  }
  if (typeof value === 'string' && typeof schema.maxLength === 'number' && value.length > schema.maxLength) out.push(`${at}: at most ${schema.maxLength} characters`)
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) out.push(`${at}: needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) out.push(`${at}: at most ${schema.maxItems} items (got ${value.length})`)
    const items = schema.items as Record<string, unknown> | undefined
    if (items && out.length === 0) value.forEach((v, i) => out.push(...checkArgs(items, v, `${at}[${i}]`)))
  }
  if (type === 'object' && value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const k of (schema.required as string[] | undefined) ?? []) if (o[k] === undefined) out.push(`${path ? path + '.' : ''}${k}: is required`)
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue
      // Only the schema's OWN fields are known: "constructor", "toString" or
      // "__proto__" name nothing (phase 4A.9, V-limits-sessions-7).
      const sub = Object.prototype.hasOwnProperty.call(props, k) ? props[k] : undefined
      if (sub) out.push(...checkArgs(sub, v, path ? `${path}.${k}` : k))
      else if (schema.additionalProperties === false) out.push(`${path ? path + '.' : ''}${k}: not a known field (known: ${Object.keys(props).join(', ')})`)
    }
  }
  return out.slice(0, 20)
}

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export type RpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const fail = (id: string | number | null, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } })
const ok = (id: string | number | null, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })

function asRequest(message: unknown): RpcRequest | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const m = message as Record<string, unknown>
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return null
  if ('id' in m && m.id !== null && typeof m.id !== 'string' && typeof m.id !== 'number') return null
  return m as unknown as RpcRequest
}

export interface RpcContext {
  call: CallTool
  serverInfo: { name: string; title: string; version: string }
  tools?: AgentTool[]
}

/**
 * One JSON-RPC message in, its response out. null: nothing to send back (a
 * notification, or a response the agent sent us), which is HTTP 202.
 */
export async function handleRpc(message: unknown, ctx: RpcContext): Promise<RpcResponse | null> {
  // Batches left the protocol in 2025-06-18; one message per request.
  if (Array.isArray(message)) return fail(null, -32600, 'Send one JSON-RPC message per request.')
  const req = asRequest(message)
  if (!req) {
    // A response to something we never asked: nothing to say.
    if (message && typeof message === 'object' && ('result' in message || 'error' in message)) return null
    return fail(null, -32600, 'Not a JSON-RPC 2.0 request.')
  }
  const isNotification = !('id' in req) || req.id === undefined
  if (isNotification) return null
  const id = req.id ?? null
  const tools = ctx.tools ?? AGENT_TOOLS

  switch (req.method) {
    case 'initialize': {
      const asked = (req.params as { protocolVersion?: unknown } | undefined)?.protocolVersion
      const protocolVersion = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0]
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: ctx.serverInfo,
        instructions: SERVER_INSTRUCTIONS
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, { tools })
    case 'tools/call': {
      const params = (req.params ?? {}) as { name?: unknown; arguments?: unknown }
      const tool = typeof params.name === 'string' ? tools.find((t) => t.name === params.name) : undefined
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params.name)}`)
      const args = params.arguments
      if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) return fail(id, -32602, 'Tool arguments must be an object.')
      // What the schema says is enforced here, before the page sees it.
      const problems = checkArgs(tool.inputSchema, args ?? {})
      if (problems.length) return ok(id, errorResult(`${tool.name}: nothing was done.\n${problems.join('\n')}`))
      try {
        return ok(id, cleanToolResult(await ctx.call(tool.name, (args ?? {}) as Record<string, unknown>)))
      } catch (e) {
        // A tool that fails is an answer the agent can read and act on.
        return ok(id, errorResult(e instanceof Error ? e.message : 'The tool failed.'))
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${req.method}`)
  }
}
