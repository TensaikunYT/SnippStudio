// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The regions that are in force (EKIP-3-PLAN.md §1): per agent program, in
// the agent store (the interface draws them from there). A region goes when
// its worker releases it or takes another, when its session ends, when the
// agent's work is done (its unlabelled wait), when the user hands the project
// to another program, and with the project it was taken in.
import { projectSession } from '../state/store'
import type { Project } from '../types'
import type { Iv } from './content'
import { rebased, type Region } from './regions'
import { useAgentStore } from './store'
import { useHolder } from './holder'

/** A program's regions (of the project that is open). */
export function regionsFor(client: string): Region[] {
  const list = useAgentStore.getState().regions[client]
  if (!list) return NONE
  // (The user handed the project to another program: these are over.)
  const h = useHolder.getState().holder
  if (h && h.client !== client) {
    useAgentStore.getState().setRegions(client, [])
    return NONE
  }
  const ps = projectSession()
  if (list.every((r) => r.ps === ps)) return list
  const kept = list.filter((r) => r.ps === ps)
  useAgentStore.getState().setRegions(client, kept)
  return kept.length ? kept : NONE
}
const NONE: Region[] = []

/** `as` takes `range` of `p` (its one region: an earlier one is replaced). */
export function claimRegion(client: string, session: string, as: string, p: Project, range: Iv, tracks?: string[]): void {
  const rest = regionsFor(client).filter((r) => r.as !== as)
  useAgentStore.getState().setRegions(client, [...rest, { as, start: range[0], end: range[1], ...(tracks?.length ? { tracks } : {}), on: p, session, ps: projectSession() }])
}

/** `as` gives its region back. Did it have one? */
export function releaseRegion(client: string, as: string): boolean {
  const list = regionsFor(client)
  if (!list.some((r) => r.as === as)) return false
  useAgentStore.getState().setRegions(client, list.filter((r) => r.as !== as))
  return true
}

/** The program's regions as seconds of `p` (after an edit of its landed:
 *  the next carry starts from there). */
export function rebaseRegions(client: string, p: Project): void {
  const list = regionsFor(client)
  if (!list.length || list.every((r) => r.on === p)) return
  useAgentStore.getState().setRegions(client, rebased(list, p))
}

/** A session ended, or its work is done: its regions go. */
export function forgetRegions(session: string): void {
  const all = useAgentStore.getState().regions
  for (const [client, list] of Object.entries(all)) if (list.some((r) => r.session === session)) useAgentStore.getState().setRegions(client, list.filter((r) => r.session !== session))
}

/** The project went to another program: this one's regions go. */
export function forgetClientRegions(client: string): void {
  if (useAgentStore.getState().regions[client]) useAgentStore.getState().setRegions(client, [])
}
