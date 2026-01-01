// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The workers' regions as the interface shows them (EKIP-3-PLAN.md §6): where
// each lies on the timeline that is open (the live project), its worker's
// name and colour, its tracks by name. No region: an empty list, and every
// part draws what it drew before.
import { useMemo } from 'react'
import { clock } from '../../agent/command'
import { placedIn } from '../../agent/regions'
import { useAgentStore } from '../../agent/store'
import { useStore } from '../../state/store'
import { workerColour } from './crew-colour'

export interface ShownRegion {
  as: string
  client: string
  start: number
  end: number
  colour: string
  /** "00:00–01:30". */
  range: string
  /** "V1, A1", or '' for every track. */
  tracks: string
}

const NONE: ShownRegion[] = []

export function useRegions(): ShownRegion[] {
  const all = useAgentStore((s) => s.regions)
  const crews = useAgentStore((s) => s.crew)
  const project = useStore((s) => s.project)
  return useMemo(() => {
    const out: ShownRegion[] = []
    for (const [client, list] of Object.entries(all)) {
      for (const r of list) {
        const [start, end] = placedIn(r, project) ?? [r.start, r.end]
        const names = (r.tracks ?? []).map((id) => project.tracks.find((t) => t.id === id)?.name ?? id)
        out.push({ as: r.as, client, start, end, colour: workerColour(crews[client] ?? [], r.as), range: `${clock(start * 1000)}–${clock(end * 1000)}`, tracks: names.join(', ') })
      }
    }
    return out.length ? out.sort((a, b) => a.start - b.start) : NONE
  }, [all, crews, project])
}
