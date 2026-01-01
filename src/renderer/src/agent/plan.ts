// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's own plan (TOKEN-PLAN.md; YOL-HARITASI.md 1.4, source 2): one
// optional field of the wait tool, `plan` — the names of its steps not done
// yet, current first (at most PLAN_MAX, each at most PLAN_NAME_MAX
// characters). Given, the wait answers at once with PLAN_NOTED and the agent
// bar says "step 2 / 5 · name". Not given, the wait is what it always was,
// byte for byte. Pure.

export const PLAN_MAX = 8
export const PLAN_NAME_MAX = 24

/** The wait's answer when it carried a plan. */
export const PLAN_NOTED = 'Plan noted.'

/** The plan as kept: its names trimmed and cut to size, empty ones left
 *  out. Throws (the agent is told) when it is no list of names, unless
 *  `quiet` (then null). An empty list clears the plan. */
export function planArg(raw: unknown, quiet = false): string[] | null {
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) {
    if (quiet) return null
    throw new Error(`plan: a list of up to ${PLAN_MAX} step names.`)
  }
  return (raw as string[])
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, PLAN_NAME_MAX))
    .filter((x) => x.length > 0)
    .slice(0, PLAN_MAX)
}
