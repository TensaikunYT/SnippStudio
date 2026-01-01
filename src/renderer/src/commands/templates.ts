// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Template graphics on the G lane: put one in (the Templates panel's
// "Insert at playhead").
import { collectVisualCuts } from '../audio/sfx'
import { createTemplate, TEMPLATE_INFO } from '../templates/model'
import type { TemplateKind } from '../types'
import { CommandError, defineCommand } from './core'
import { requireFreshId } from './require'
import { s } from './schema'

export const placeTemplate = defineCommand({
  name: 'template.place',
  summary: 'Put a template graphic on the G lane at a time (a home screen centres itself on the nearest cut within 4 s). Returns its id.',
  params: s.object({ kind: s.string({ min: 1, max: 40, description: 'A template kind, e.g. steps, stat, bars, quote' }), time: s.time(), id: s.optional(s.id('An id for the new template')) }),
  check(p, { id }) {
    requireFreshId(p, id, 'template.place')
  },
  apply(p, { kind, time, id }, env): string {
    if (!(kind in TEMPLATE_INFO)) throw new CommandError('template.place', `there is no G lane item kind "${kind}" (kinds: ${Object.keys(TEMPLATE_INFO).join(', ')})`)
    // A home screen goes over the nearest cut, centred on it; the others at
    // the time given.
    let at = time
    if (kind === 'home') {
      const cuts = collectVisualCuts(p)
      const near = cuts.reduce<number | null>((best, c) => (Math.abs(c - time) < 4 && (best === null || Math.abs(c - time) < Math.abs(best - time)) ? c : best), null)
      if (near !== null) at = Math.max(0, near - TEMPLATE_INFO.home.duration / 2)
    }
    const made = createTemplate(p, kind as TemplateKind, at, Math.floor(env.random() * 1e6))
    if (!id) return made
    const block = p.templates?.find((t) => t.id === made)
    if (block) block.id = id
    return id
  }
})
