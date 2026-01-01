// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's job now, for the parts that show it (D22, worker C): the bar
// over the timeline, the top bar's chip, the ruler's flag, the trail. All of
// it from the calls the app records (agent/activity.ts); the one timer here
// fires when the phase is due to change, never per frame.
import { useEffect, useMemo, useState } from 'react'
import { jobKindOf, jobOf, phaseOf, tokenPartsOf, totalsOf, type Job, type JobTotals, type PhaseNow, type TokenParts } from '../../agent/activity'
import { useHolder, workingAgent } from '../../agent/holder'
import { useInbox } from '../../agent/inbox'
import { focusClient } from '../../agent/program'
import { useAgentStore } from '../../agent/store'

export interface JobNow {
  /** The agent program it is about (its MCP client name); null: none. */
  client: string | null
  job: Job | null
  phase: PhaseNow
  totals: JobTotals | null
  /** What the tokens are made of, and raw (TOKEN-PLAN.md): the card. */
  parts: TokenParts | null
  /** The user closed this job's "Done". */
  closed: boolean
  /** The user pressed Stop and the agent has not called since. */
  stopped: boolean
  /** The agent's wait is open: what the user sends reaches it at once. */
  waiting: boolean
  /** One of its sessions is connected. */
  alive: boolean
}

export function useAgentJob(): JobNow {
  const events = useAgentStore((s) => s.events)
  const sessions = useAgentStore((s) => s.sessions)
  const draft = useAgentStore((s) => s.draft)
  const barClosed = useAgentStore((s) => s.barClosed)
  const stoppedAt = useAgentStore((s) => s.stopped)
  const holder = useHolder((s) => s.holder)
  const chosen = useHolder((s) => s.chosen)
  const waiter = useInbox((s) => s.waiting?.client ?? null)
  const [now, setNow] = useState(() => Date.now())
  const client = focusClient(workingAgent({ holder, chosen }), draft, sessions) ?? events[events.length - 1]?.client ?? null
  const mine = useMemo(() => (client === null ? [] : events.filter((e) => (e.client ?? sessions[e.session]?.client) === client)), [events, sessions, client])
  const job = useMemo(() => jobOf(mine), [mine])
  const alive = client !== null && Object.values(sessions).some((s) => s.client === client)
  const waiting = client !== null && waiter === client
  useEffect(() => setNow(Date.now()), [events, waiting, alive])
  const phase = phaseOf(job, waiting, alive, now)
  useEffect(() => {
    if (phase.until === null) return
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(16, phase.until - Date.now() + 5))
    return () => window.clearTimeout(id)
  }, [phase.until])
  const defsOf = (s: string): number => sessions[s]?.defsTokens ?? 0
  const firstOf = (s: string): string | undefined => events.find((e) => e.session === s && e.tool !== 'wait')?.id
  const totals = job ? totalsOf(job, phase, now, defsOf, firstOf) : null
  const parts = job ? tokenPartsOf(job, defsOf, firstOf) : null
  // A finished job goes into the profile's list (at most 20): the Agent
  // tab's "Finished jobs" and "similar jobs took …". Written once per change.
  const doneRec = phase.phase === 'done' && job && client !== null && job.events.length && totals && parts ? { client, kind: jobKindOf(job), start: job.start, ms: totals.ms, steps: totals.steps, changed: totals.changed, tokens: parts.total, ...(parts.raw !== null ? { raw: parts.raw } : {}) } : null
  const doneKey = doneRec ? JSON.stringify(doneRec) : ''
  useEffect(() => {
    if (doneKey) useAgentStore.getState().recordJob(JSON.parse(doneKey))
  }, [doneKey])
  const lastStart = job?.events[job.events.length - 1]?.started ?? job?.start ?? 0
  const stopped = stoppedAt !== null && stoppedAt >= lastStart
  // (Closed: a finished job, or one the user stopped, until the agent calls again.)
  return { client, job, phase, totals, parts, closed: !!job && barClosed === job.start && (phase.phase === 'done' || stopped), stopped, waiting, alive }
}

/** Seconds that tick while the agent works (the bar's clock). */
export function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [on])
  return now
}
