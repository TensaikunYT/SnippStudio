// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Templates kept from a suggestion, placed on the G lane: the step the edit
// command `placeImages` takes (its `suggestions`, which an agent may give).
// (The reader that made the suggestions from the narration, its number /
// versus / punchline patterns and count-words.ts, went in phase 3c.4b: only
// the removed Automation dialog's Suggest panel called it.)

import { createTemplate } from '../templates/model'
import type { Project, TemplateBlock, TemplateItem, TemplateKind } from '../types'
import { uid } from '../types'

export interface TemplateSuggestion {
  /** Stable while the words stay the same: kind and where. */
  key: string
  kind: TemplateKind
  start: number
  duration: number
  /** The span it starts at, and the last one it covers. */
  from: number
  to: number
  title: string
  items: Omit<TemplateItem, 'id'>[]
  /** The words that asked for it. */
  word: string
  design?: TemplateBlock['design']
}

/** The suggestions you keep, placed on the G lane. How many. */
export function placeSuggestions(p: Project, list: readonly TemplateSuggestion[], random?: () => number): number {
  let n = 0
  for (const s of list) {
    const id = createTemplate(p, s.kind, s.start, random ? Math.floor(random() * 1e6) : undefined)
    const b = p.templates?.find((t) => t.id === id)
    if (!b) continue
    b.duration = s.duration
    b.title = s.title
    // Big words over the line read the subtitles themselves.
    b.items = s.kind === 'words' ? [{ id: uid(), title: s.word }] : s.items.map((it) => ({ id: uid(), ...it }))
    if (s.design) b.design = s.design
    n++
  }
  return n
}
