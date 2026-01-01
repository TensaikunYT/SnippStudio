// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's coloured label (KOLAY-PLAN.md, item 3): a clip's right-click menu,
// "Label": one of six colours, or none. Internal: an agent is not offered it
// (the agent tools' definitions stay as they are). The label is no part of
// the film (history/equal.ts, agent/replay.ts): it is drawn on the timeline
// only, kept in the project file (format 8, an optional field: a file without
// labels is the same bytes) and is one undo step.
import { CLIP_LABELS } from '../types'
import { defineCommand } from './core'
import { requireClip } from './require'
import { s } from './schema'

export const setClipLabel = defineCommand({
  name: 'clip.setLabel',
  internal: true,
  summary: 'Give clips a coloured label, or take it off.',
  params: s.object({ ids: s.array(s.id(), { min: 1 }), label: s.nullable(s.enum(CLIP_LABELS)) }),
  check(p, { ids }) {
    for (const id of ids) requireClip(p, id, 'clip.setLabel', { edit: false })
  },
  apply(p, { ids, label }): void {
    for (const id of ids) {
      const clip = p.clips[id]
      if (!clip) continue
      if (label) clip.label = label
      else delete clip.label
    }
  }
})
