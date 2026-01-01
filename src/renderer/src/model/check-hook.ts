// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the model checker (model/check.ts) runs after every edit: the store's
// `mutate` and the command layer's `produceEdit` call `afterEdit`, which does
// nothing until a check is installed. Tests install one that throws
// (src/test/model-check-setup.ts); a development or e2e build one that logs
// (main.tsx). A packaged app never installs one: no cost there.
import type { Project } from '../types'
import { describeProblems, newProblems, type Problem } from './check'

type Hook = (before: Project, after: Project, what: string) => void
let hook: Hook | null = null

/** Installs (or with null removes) the check run after every edit. */
export function setModelCheck(fn: Hook | null): void {
  hook = fn
}

export function afterEdit(before: Project, after: Project, what: string): void {
  if (hook && before !== after) hook(before, after, what)
}

/** The problems an edit made, as an Error (what the test hook throws). */
export class ModelCheckError extends Error {
  constructor(
    readonly what: string,
    readonly problems: Problem[]
  ) {
    super(`model check after ${what}:\n${describeProblems(problems)}`)
  }
}

/** A hook that throws on the first edit that breaks a rule (but the
 *  problems `skip` says are known). */
export const throwingCheck =
  (skip?: (problem: Problem, before: Project, after: Project) => boolean): Hook =>
  (before, after, what) => {
    const fresh = newProblems(before, after).filter((x) => !skip?.(x, before, after))
    if (fresh.length) throw new ModelCheckError(what, fresh)
  }

/** A hook that logs (and hands each list to `keep`) and lets the edit stand. */
export const loggingCheck =
  (keep?: (problems: Problem[], what: string) => void): Hook =>
  (before, after, what) => {
    const fresh = newProblems(before, after)
    if (!fresh.length) return
    keep?.(fresh, what)
    console.error(`[snipp] model check after ${what}:\n${describeProblems(fresh)}`)
  }
