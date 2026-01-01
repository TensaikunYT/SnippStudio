// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which agent may change the project (DENEME-4, item 9; DENEME-2-PLAN-T.md):
// one agent at a time. The first agent program that changes the project is
// its holder while its session lives; another program asking to change it
// is refused politely and listed ("Codex wanted to connect"); the user hands
// the project over in one click (a waiting draft of the holder is accepted
// or rejected first), and the old session's next call, a wait it is in
// included, gets "the user handed the project to another agent". Reading
// stays open to every agent. A reconnecting session of the same program is
// the same agent (as with drafts: phase 4A.11, K3).
//
// D22 (the audit's A2 / K2, A11): the user may also PICK the agent that
// works on the project, before any agent changed it or to hand it on:
// `chosen` (written only by chooseAgent / handTo). The agent working on the
// project — workingAgent(): the holder, else the pick — is the one the
// user's sends go to (agent/inbox.ts) and, with no holder yet, the only one
// that may become it.
import { create } from 'zustand'
import { PRODUCT_NAME } from '../../../shared/product'

/** An agent program's name as the user knows it, from MCP clientInfo.name. */
export function agentDisplayName(client: string): string {
  if (/claude/i.test(client)) return 'Claude Code'
  if (/codex/i.test(client)) return 'Codex'
  if (/opencode/i.test(client)) return 'OpenCode'
  if (/antigravity|agy/i.test(client)) return 'Antigravity'
  return client
}

export interface Asked {
  client: string
  session: string
  at: number
}

export interface HolderState {
  holder: { client: string; session: string } | null
  /** Agents refused while another held the project (latest first, one per program). */
  asked: Asked[]
  /** Sessions the project was taken from: their next call is told so. */
  handedOff: Record<string, string>
  /**
   * The agent program (its MCP client name, as SessionInfo.client has it)
   * the user picked to work on the project open in this window; null: no
   * pick (the first agent that changes the project holds it, the first that
   * waits gets what is sent — the behaviour before D22). The ONE field the
   * "working agent" selector of the Agent tab writes — through chooseAgent,
   * never by setState. Kept in memory for the window, like the holder.
   */
  chosen: string | null
}

export const useHolder = create<HolderState>(() => ({ holder: null, asked: [], handedOff: {}, chosen: null }))

/** The agent program working on the project now: the one that holds it,
 *  else the one the user picked; null: none yet. What the user sends goes
 *  to it (agent/inbox.ts), and the selector shows it. */
export const workingAgent = (s: Pick<HolderState, 'holder' | 'chosen'> = useHolder.getState()): string | null => s.holder?.client ?? s.chosen ?? null

/** The agent working on the project when it is NOT the program `client`
 *  (D22, the audit's A2 / A8): what the user sends, and their notes, are
 *  that agent's; null when `client` is the working agent, or none is. */
export const otherAgent = (client: string, s: Pick<HolderState, 'holder' | 'chosen'> = useHolder.getState()): string | null => {
  const w = workingAgent(s)
  return w !== null && w !== client ? w : null
}

/**
 * The user picks the agent program that works on this project (the Agent
 * tab's selector; D22). `session`: a live session of that program, when the
 * caller knows one (useAgentStore's sessions) — it holds the project from
 * now; without one the program's next change makes it the holder.
 *
 * - Another program holds the project: this hands it over (as handTo does):
 *   that session's next call, a wait it is in included, is told so. A draft
 *   of the old holder that waits must be accepted or rejected FIRST by the
 *   caller (as components/agent/AgentsCard.tsx does before handTo): this
 *   function does not look at drafts.
 * - Nobody holds it: only the picked program may become the holder; another
 *   program that tries is refused and listed in `asked`.
 * - null: the pick is taken back (a holder stays the holder).
 *
 * The pick stays until the user changes it: it is not dropped when that
 * program's sessions end (an agent that is started again is the same
 * agent); another program that tries meanwhile is listed in `asked`, one
 * click away.
 */
export function chooseAgent(client: string | null, session?: string): void {
  const { holder, asked, handedOff } = useHolder.getState()
  if (client === null) return void useHolder.setState({ chosen: null })
  const to = session ?? asked.find((a) => a.client === client)?.session
  // (A session the project was taken from earlier and is given back to is
  // not "handed off" any more: D22, worker C.)
  const back = Object.fromEntries(Object.entries(handedOff).filter(([s]) => s !== to && s !== holder?.session))
  useHolder.setState({
    chosen: client,
    holder: holder?.client === client ? holder : to !== undefined ? { client, session: to } : null,
    asked: asked.filter((a) => a.client !== client),
    handedOff: holder && holder.client !== client ? { ...back, [holder.session]: client } : holder?.client === client ? handedOff : back
  })
}

/** The words an agent gets when the user handed the project on. */
export const handedOffText = (to: string): string => `The user handed the project to another agent (${agentDisplayName(to)}) in ${PRODUCT_NAME}. Please stop changing it; thank you for your work.`

/** Throws the polite answer when the user took the project from this session. */
export function checkHandedOff(session: string): void {
  const to = useHolder.getState().handedOff[session]
  if (to !== undefined) throw new Error(handedOffText(to))
}

/** Before a change: may this session's program change the project? It
 *  becomes the holder when nobody (alive) holds it. */
export function checkWriter(session: string, client: string, alive: (session: string) => boolean): void {
  checkHandedOff(session)
  const { holder, asked, chosen } = useHolder.getState()
  const held = holder && alive(holder.session) ? holder : null
  // Another program holds it — or nobody does and the user picked another.
  const other = held ? (held.client !== client ? held.client : null) : chosen !== null && chosen !== client ? chosen : null
  if (other !== null) {
    useHolder.setState({ asked: [{ client, session, at: Date.now() }, ...asked.filter((a) => a.client !== client)].slice(0, 5) })
    throw new Error(held
      ? `Another agent (${agentDisplayName(other)}) is changing this project in ${PRODUCT_NAME}; only one agent changes it at a time. The user can hand it to you there (Agent tab); until then you can read it.`
      : `The user chose another agent (${agentDisplayName(other)}) to work on this project in ${PRODUCT_NAME}; only one agent changes it at a time. The user can hand it to you there (Agent tab); until then you can read it.`)
  }
  if (!holder || holder.session !== session) useHolder.setState({ holder: { client, session }, asked: asked.filter((a) => a.client !== client) })
}

/** The user's one click: the project goes to the program that asked. */
export function handTo(client: string): boolean {
  const { holder, asked, handedOff, chosen } = useHolder.getState()
  const a = asked.find((x) => x.client === client)
  if (!a) return false
  const { [a.session]: _back, ...rest } = handedOff
  useHolder.setState({
    holder: { client: a.client, session: a.session },
    // (A pick the user made goes with the project; no pick stays no pick.)
    chosen: chosen === null ? null : a.client,
    asked: asked.filter((x) => x.client !== client),
    handedOff: holder && holder.client !== client ? { ...rest, [holder.session]: client } : rest
  })
  return true
}

/** A session that ended leaves the list (and frees the project). */
export function forgetHolderSession(session: string): void {
  const { holder, asked, handedOff } = useHolder.getState()
  const { [session]: _gone, ...rest } = handedOff
  useHolder.setState({ holder: holder?.session === session ? null : holder, asked: asked.filter((a) => a.session !== session), handedOff: rest })
}
