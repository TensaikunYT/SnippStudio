// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Timeline markers (the M key). Bodies as they were in state/store.ts.
import { uid } from '../types'
import { defineCommand } from './core'
import { requireFreshId, requireMarker } from './require'
import { s } from './schema'

const COLORS = ['#ffd83d', '#4fa8ff', '#ff7ab0', '#7ade7a', '#b98cff']

export const addMarker = defineCommand({
  name: 'marker.add',
  summary: 'Put a marker on the ruler at a time. Returns its id.',
  params: s.object({ time: s.time(), note: s.optional(s.string({ max: 500 })), id: s.optional(s.id('An id for the new marker')) }),
  check(p, { id }) {
    requireFreshId(p, id, 'marker.add')
  },
  apply(p, { time, note, id: given }): string {
    p.markers = p.markers ?? []
    const id = given ?? uid()
    p.markers.push({ id, time, color: COLORS[p.markers.length % COLORS.length], note: note ?? '' })
    p.markers.sort((a, b) => a.time - b.time)
    return id
  }
})

export const updateMarker = defineCommand({
  name: 'marker.update',
  summary: 'Move a marker or change its note, label or colour.',
  params: s.object({
    id: s.id(),
    patch: s.object({ time: s.optional(s.time()), color: s.optional(s.color()), note: s.optional(s.string({ max: 500 })), label: s.optional(s.string({ max: 80 })) })
  }),
  check(p, { id }) {
    requireMarker(p, id, 'marker.update')
  },
  apply(p, { id, patch }): void {
    const m = p.markers?.find((x) => x.id === id)
    if (m) Object.assign(m, patch)
    p.markers?.sort((a, b) => a.time - b.time)
  }
})

export const deleteMarker = defineCommand({
  name: 'marker.delete',
  summary: 'Remove a marker from the ruler.',
  params: s.object({ id: s.id() }),
  check(p, { id }) {
    requireMarker(p, id, 'marker.delete')
  },
  apply(p, { id }): void {
    p.markers = (p.markers ?? []).filter((m) => m.id !== id)
    if (p.markers.length === 0) delete p.markers
  }
})
