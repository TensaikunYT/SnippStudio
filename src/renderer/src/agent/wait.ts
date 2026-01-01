// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The `wait` tool's time rules (GONDER-PLAN.md, 5), pure: the main process
// gives the call its own time from them (agent-host.ts) and the page waits
// by them (agent/host.ts). VideoHub's hub_wait, measured there
// (docs/AGENT-WAIT.md): every client stops a tool call after its own limit,
// so a wait returns "nothing yet" well before it and the agent calls again.

/** The least and most one call waits (s). The most stays under the 300 s
 *  after which Node's and Bun's fetch give up on an HTTP answer whose
 *  headers have not come (the answer and its headers leave together here). */
export const WAIT_MIN = 5
export const WAIT_MAX = 240

/** The main process' time for a wait: its seconds and this much more, so
 *  the page always answers ("nothing yet") before the server gives up. */
export const WAIT_MARGIN_MS = 15_000

export type WaitClient = 'claude' | 'codex' | 'opencode' | 'other'

/** The agent program, from its MCP clientInfo name. */
export function waitClient(name: string): WaitClient {
  if (/claude/i.test(name)) return 'claude'
  if (/codex/i.test(name)) return 'codex'
  if (/opencode/i.test(name)) return 'opencode'
  return 'other'
}

/** How long a wait lasts when the agent names no time: under its program's
 *  limit. Claude Code: no limit of its own unless MCP_TOOL_TIMEOUT is set;
 *  Codex: tool_timeout_sec, documented 60 s (our add line sets none);
 *  OpenCode: 12 hours documented; anything else: a short, safe one. */
export const WAIT_DEFAULT: Record<WaitClient, number> = { claude: WAIT_MAX, opencode: WAIT_MAX, codex: 50, other: 45 }

/** The seconds one wait call lasts at most. */
export function waitSeconds(raw: unknown, client: string): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(WAIT_MIN, Math.min(WAIT_MAX, Math.round(raw)))
  return WAIT_DEFAULT[waitClient(client)]
}

/** The main process' time for one wait call (ms). */
export const waitBudgetMs = (raw: unknown, client: string): number => waitSeconds(raw, client) * 1000 + WAIT_MARGIN_MS

/** What a wait answers when nothing came in its time. */
export const NOTHING_YET = 'Nothing from the user yet; call wait again.'

/** What the wait of an agent that is not the one working on the project
 *  answers (D22, the audit's A2): what the user sends goes to that agent.
 *  `name`: that agent as the user knows it; `app`: the product's name. */
export const withOther = (name: string, app: string): string =>
  `Nothing for you: this project is with another agent (${name}) now, and what the user sends from ${app} goes to it. The user can hand the project to you there (Agent tab); until then you can read it. Call wait again to wait for that.`

/** Did a wait bring nothing (it is not a step of the agent's work then)? */
export const waitedForNothing = (text: string | undefined): boolean => text === NOTHING_YET || !!text?.startsWith('Nothing for you: ')
