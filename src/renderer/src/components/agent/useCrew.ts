// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The workers of the agent's job now (EKIP-PLAN.md), for the parts that show
// them: the bar's chips, the flags on the ruler, the steps, the token card,
// the draft's groups. A job none of whose calls named a worker has no team:
// every part then draws exactly what it drew before.
import { useMemo } from 'react'
import { workersOf } from '../../agent/crew'
import { workerColour } from './crew-colour'
import { agentDisplayName } from '../../agent/holder'
import { useAgentStore } from '../../agent/store'
import type { JobNow } from './useJob'

export interface Crew {
  /** The labelled workers of the job, in their colours' order; empty: no team. */
  workers: string[]
  /** All workers of the program so far (the colours' order). */
  order: string[]
  /** A worker's colour (CSS value); unlabelled: the program's. */
  colour: (as: string | undefined) => string
  /** A worker's name as shown; unlabelled: the program's first name. */
  name: (as: string | undefined) => string
}

const EMPTY: string[] = []

export function crewOf(order: readonly string[], workers: string[], client: string | null): Crew {
  const program = agentDisplayName(client ?? '').split(' ')[0]
  return { workers, order: [...order], colour: (as) => workerColour(order, as), name: (as) => as || program }
}

export function useCrew(j: Pick<JobNow, 'job' | 'client'>): Crew {
  const order = useAgentStore((s) => (j.client ? s.crew[j.client] : undefined) ?? EMPTY)
  const events = j.job?.events
  return useMemo(() => crewOf(order, events ? workersOf(events, order) : [], j.client), [order, events, j.client])
}

/** The crew of one program, whatever its job (the draft's groups, the steps). */
export function useCrewOf(client: string | null): Crew {
  const order = useAgentStore((s) => (client ? s.crew[client] : undefined) ?? EMPTY)
  return useMemo(() => crewOf(order, [...order], client), [order, client])
}
