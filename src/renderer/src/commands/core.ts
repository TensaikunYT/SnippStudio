// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command layer's core (SnippStudio phase 2A).
//
// A command is a pure edit: (project, parameters) → new project. It never
// reads the selection, the playhead, the A/V link switch, the DOM or
// localStorage: whatever it needs is a parameter, and the two things a pure
// function cannot make on its own — random numbers and text measurement — come
// in through `env`. The store's actions are thin wrappers: they read the UI
// state, call the command on their undo draft, and write the selection back.
// The agent tools (phase 4) call the same commands through `runCommand` /
// `applyBatch`, by name, with the parameters checked against each command's
// schema.
import type { Project } from '../types'
import { withIds } from '../types'
import { produce } from '../state/cow'
import { followClipEdits } from '../subtitles/follow'
import { followNotes } from '../notes/follow'
import { afterEdit } from '../model/check-hook'
import { settleTransitions } from '../timeline/transition-links'
import { validate, type JsonSchema, type Schema } from './schema'
import { PROJECT_LIMITS } from '../model/limits'

export interface CommandEnv {
  /** 0 ≤ n < 1. The store passes Math.random (the seeds it always made); a
   *  batch with a seed passes a seeded generator. */
  random: () => number
  /** Width in pixels of one line of `text` in a CSS `font`; the app measures
   *  with a canvas. Absent: a fixed estimate (0.55 em per character). */
  measureText?: (font: string, text: string) => number
  /** The time a note is written at. */
  now: () => Date
  /** New ids while the command runs (types.ts uid); unset: random. A seeded
   *  batch passes a seeded one, so the same batch makes the same ids. */
  newId?: () => string
}

export interface Command<P = unknown, R = unknown> {
  name: string
  /** One sentence for the agent tool's description. */
  summary: string
  params: Schema<P>
  /** Only the store calls it (with app-made structures, e.g. a drag plan):
   *  not offered to an agent, refused by name (commandByName). */
  internal?: boolean
  /** Called by name (runCommand / a batch), before apply, on the project as
   *  it is at that point of the batch: the things it names exist, a clip it
   *  edits is not locked, a given id is free. Throws CommandError. The
   *  store's own buttons call apply directly and skip this. */
  check?(project: Project, params: P): void
  /** Edits the draft in place and returns what the caller needs (new ids…).
   *  Throws CommandError when the edit cannot be made: the draft is then
   *  thrown away, so nothing changes. */
  apply(draft: Project, params: P, env: CommandEnv): R
}

export class CommandError extends Error {
  constructor(
    readonly command: string,
    message: string,
    readonly problems: string[] = []
  ) {
    super(`${command}: ${message}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`)
    this.name = 'CommandError'
  }
}

export function defineCommand<P, R>(def: Command<P, R>): Command<P, R> {
  return def
}

/** Ids from a seed: the same seed, the same ids (uid's 13-character form). */
export function seededIds(seed: number): () => string {
  const r = seededRandom((seed * 7919) | 0)
  const hex = (n: number, w: number): string => Math.floor(r() * n).toString(16).padStart(w, '0')
  return () => `${hex(0xffffffff, 8)}-${hex(0xffff, 4)}`
}

/** A seeded generator (mulberry32), for a batch that asks for repeatable
 *  random choices. */
export function seededRandom(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const defaultEnv = (): CommandEnv => ({ random: Math.random, now: () => new Date() })

/** The parameters, checked; a CommandError listing every problem otherwise. */
export function checkParams<P>(cmd: Command<P, unknown>, params: unknown): P {
  const problems = validate(cmd.params as Schema<unknown>, params)
  if (problems.length > 0) throw new CommandError(cmd.name, 'bad parameters', problems)
  return params as P
}

/**
 * The project after `apply` ran on a draft of it, with what every edit gets
 * in the store: subtitles follow their voice clip, work notes stay on their
 * picture (the same two passes `mutate` runs).
 */
export function produceEdit(project: Project, apply: (draft: Project) => void, what = 'a command'): Project {
  // (A transition whose clip is no longer the one after it goes: phase
  // Ç2b.2, decision 1.)
  const next = settleTransitions(produce(project, (d) => {
    apply(d)
    followClipEdits(project, d)
    followNotes(project, d)
  }), project)
  // The model's rules (model/check.ts), when a test or a development build
  // installed the check (phase Ç2a.1).
  afterEdit(project, next, what)
  return next
}

/**
 * A command called by name may not leave a clip beyond what a project can
 * hold (model/limits.ts; 22 Nov, K9): the file reader would drop that clip
 * at the next open ("the command took it, the repair deleted it"). The
 * parameters' own rules stop a time given outright; this stops one worked
 * out (a move `by` seconds, a clip made longer). Only clips this command put
 * there: one that already lay beyond is not this command's doing.
 */
export function withinLimits(before: Project, after: Project, cmd: string): void {
  const max = PROJECT_LIMITS.maxTime
  for (const c of Object.values(after.clips)) {
    if (c.start + c.duration <= max && c.start >= 0) continue
    const was = before.clips[c.id]
    if (was && was.start === c.start && was.duration === c.duration) continue
    throw new CommandError(cmd, `clip "${c.id}" would lie outside the timeline a project can hold (0 to ${max} s): ${+c.start.toFixed(3)} to ${+(c.start + c.duration).toFixed(3)} s`)
  }
}

/** One command, pure: the new project and the command's result. Throws
 *  CommandError on bad parameters or an edit that cannot be made. */
export function runCommand<P, R>(project: Project, cmd: Command<P, R>, params: unknown, env: CommandEnv = defaultEnv()): { project: Project; result: R } {
  const checked = checkParams(cmd, params)
  cmd.check?.(project, checked)
  let result!: R
  const next = withIds(env.newId, () =>
    produceEdit(project, (d) => {
      result = cmd.apply(d, checked, env)
    }, cmd.name)
  )
  withinLimits(project, next, cmd.name)
  return { project: next, result }
}

/** The JSON Schema of a command's parameters (phase 4 builds the agent tools
 *  from this). */
export const paramsSchema = (cmd: Command): JsonSchema => cmd.params.json
