// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The hooks behind K2 of phase 3c.Y (components/agent/visibility.ts): is the
// agent switched on (the top bar's switch: the agent server runs), and is the
// Agent tab shown.
import { pointsInMemory } from '../../agent/restore'
import { useSession } from '../../agent/session'
import { useAgentStore } from '../../agent/store'
import { agentTabShown } from './visibility'

/** The top bar's "Connect agent" switch is on. */
export const useAgentOn = (): boolean => useSession((s) => !!s.status?.server?.running)

export function useAgentTabShown(): boolean {
  const serverOn = useAgentOn()
  const draft = useAgentStore((s) => !!s.draft)
  const running = useAgentStore((s) => s.events.some((e) => !e.done))
  // Restore points change only when the agent's calls land or a point is
  // gone back to: both re-render through the events above.
  useAgentStore((s) => s.events.length)
  // (Read without restorePoints(): that one also settles which project is
  // open, a side effect a render must not have.)
  const points = pointsInMemory()
  return agentTabShown({ serverOn, draft, running, points })
}
