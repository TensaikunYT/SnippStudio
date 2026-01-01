// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's version and batch actions: the shift table, what changed, a
// pinned version, adopting a candidate, a batch of commands as one step, undo
// to a point. Moved out of state/store.ts in SnippStudio phase 2B (no change).
import { CommandError, seededIds, seededRandom } from '../../commands/core'
import { applySequence, checkBatch, isNoteCommand } from '../../commands'
import { mergeCutRanges } from '../../commands/timeline'
import { versions, env } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type VersionActions = Pick<EditorState, 'shiftTable' | 'changesSince' | 'pinVersion' | 'adoptCandidate' | 'runBatch' | 'undoTo'>

export function versionActions(set: SetState, get: GetState, mutate: Mutate): VersionActions {
  return {
    shiftTable: (fromVersion, epoch) => versions.shiftTable(fromVersion, epoch),
    changesSince: (fromVersion, epoch) => versions.changesSince(fromVersion, get().project, epoch),
    pinVersion: (version) => versions.pin(version),
    adoptCandidate: (project, from) => {
      if (from.epoch !== undefined && from.epoch !== versions.epoch) throw new CommandError('adoptCandidate', 'the candidate was made in another session (epoch)')
      if (from.baseVersion !== get().projectVersion) throw new CommandError('adoptCandidate', `the project changed since the candidate was made (version ${from.baseVersion} → ${get().projectVersion})`)
      get().undoable(() => mutate(() => undefined, true, undefined, { next: project, ...(from.cuts?.length ? { cuts: from.cuts } : {}) }))
      return get().projectVersion
    },

    runBatch: (calls, opts) => {
      const checked = checkBatch(calls)
      const e = opts?.seed !== undefined ? { ...env(true), random: seededRandom(opts.seed), newId: seededIds(opts.seed) } : env(true)
      // Nothing but cuts out of the whole timeline: the version says which
      // ranges, so older times can still be moved to the new ones.
      // The film's calls are one undo step; the note calls (last, if any) are
      // applied after it with no step of their own.
      const film = checked.filter((c) => !isNoteCommand(c.cmd.name))
      const notes = checked.filter((c) => isNoteCommand(c.cmd.name))
      const onlyCuts = film.length > 0 && film.every((c) => c.cmd.name === 'timeline.cutRanges')
      // Run call by call first: if one fails, nothing has been written.
      const a = applySequence(get().project, film, e)
      // The ranges each cut really took out (widened over slivers, phase
      // Ç2b.1 K-3: commands/ops/ripple.ts ripplePlan).
      const cuts = onlyCuts ? a.results.map((r, i) => (r as { ranges?: [number, number][] } | undefined)?.ranges ?? mergeCutRanges((film[i].params as { ranges: [number, number][] }).ranges)) : undefined
      const b = applySequence(a.project, notes, e)
      if (film.length > 0) get().undoable(() => mutate(() => undefined, true, undefined, { next: a.project, ...(cuts ? { cuts } : {}) }))
      if (notes.length > 0) mutate(() => undefined, 'outside', undefined, { next: b.project })
      return [...a.results, ...b.results]
    },

    undoTo: (steps) => {
      for (let i = 0; i < steps; i++) get().undo()
    }
  }
}
