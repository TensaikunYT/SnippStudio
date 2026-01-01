// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A worker's colour (EKIP-PLAN.md): one of six (ui/tokens.css --agent-w1 …
// --agent-w6, derived from the program's colour) by the order the worker was
// first seen; a 7th worker takes the first again; unlabelled calls are the
// program itself. Kept with the interface: nothing of it reaches the agent.
export const CREW_COLOURS = 6

export function workerColour(order: readonly string[], as: string | undefined): string {
  const i = as ? order.indexOf(as) : -1
  return i < 0 ? 'var(--agent)' : `var(--agent-w${(i % CREW_COLOURS) + 1})`
}
