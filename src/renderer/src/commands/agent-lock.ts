// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's lock of a clip against agents (KAPSAM-AJAN-PLAN.md, K1): a
// clip's right-click menu, "Don't let the agent touch this clip". Internal:
// an agent is never offered it (it could take the lock off). The lock is no
// part of the film (history/equal.ts): the user's own edits go on as before,
// an agent's op that would change the clip is not applied (agent/scope.ts).
import { defineCommand } from './core'
import { requireClip } from './require'
import { s } from './schema'

export const setAgentLock = defineCommand({
  name: 'clip.setAgentLock',
  internal: true,
  summary: 'Lock clips against agents, or take the lock off.',
  params: s.object({ ids: s.array(s.id(), { min: 1 }), locked: s.boolean() }),
  check(p, { ids }) {
    for (const id of ids) requireClip(p, id, 'clip.setAgentLock', { edit: false })
  },
  apply(p, { ids, locked }): void {
    for (const id of ids) {
      const clip = p.clips[id]
      if (!clip) continue
      if (locked) clip.agentLock = true
      else delete clip.agentLock
    }
  }
})
