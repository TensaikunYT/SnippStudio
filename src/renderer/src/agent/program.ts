// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's colour comes from its program (D22, worker C;
// YOL-HARITASI.md 1.5): Claude Code the orange the agent always had, Codex
// silver, OpenCode pink, Antigravity sky blue, any other program grey. No
// logo and no brand mark: a colour and the program's name. The page's root
// carries `data-agent-program`; ui/tokens.css gives --agent, --agent-text,
// --agent-soft, --agent-line and --on-agent for each. Without the attribute
// (no agent, or the app's own ready commands) the colour is the orange.
import type { DraftView, SessionInfo } from './store'
import { LOCAL_CLIENT } from './ready'

export type AgentProgram = 'claude' | 'codex' | 'opencode' | 'antigravity' | 'other'
export const AGENT_PROGRAMS: readonly AgentProgram[] = ['claude', 'codex', 'opencode', 'antigravity', 'other']

/** The program of an MCP client name (the same reading as holder.ts
 *  agentDisplayName). */
export function programOf(client: string): AgentProgram {
  if (/claude/i.test(client)) return 'claude'
  if (/codex/i.test(client)) return 'codex'
  if (/opencode/i.test(client)) return 'opencode'
  if (/antigravity|agy/i.test(client)) return 'antigravity'
  return 'other'
}

/** The agent program the interface is about now: the one working on the
 *  project (it holds it, or the user picked it), else the waiting draft's
 *  owner, else the one that called last; null: none (or the app itself). */
export function focusClient(working: string | null, draft: Pick<DraftView, 'client'> | null, sessions: Readonly<Record<string, SessionInfo>>): string | null {
  if (working) return working
  if (draft && draft.client !== LOCAL_CLIENT) return draft.client
  if (draft) return null
  return Object.values(sessions).sort((a, b) => b.lastCall - a.lastCall)[0]?.client ?? null
}
