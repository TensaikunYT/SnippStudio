// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Going to a change of the draft (D22, worker C): the playhead moves to
// where it happens in the project the timeline shows, and the timeline
// scrolls there, sideways and to its lane. The scroll is the timeline's own
// (its scrollLeft / scrollTop): nothing else on the page moves.
import { itemStart, marksFor } from '../../agent/marks'
import type { DraftView } from '../../agent/store'
import { useStore } from '../../state/store'
import { TIMELINE_HEADER_W } from '../../types'

export function revealItem(draft: DraftView, key: string, after: boolean): void {
  const live = draft.on
  const next = draft.project
  const items = draft.items ?? []
  const i = items.findIndex((x) => x.key === key)
  if (!live || !next || i < 0) return
  const shown = after ? next : live
  const marks = marksFor(after ? 'after' : 'before', live, next, draft.marks?.cuts ?? [], items)
  const at = itemStart(marks, i, shown)
  const s = useStore.getState()
  if (at !== null) {
    s.setPlaying(false)
    s.setTime(Math.max(0, at))
  }
  const el = document.querySelector<HTMLElement>('[data-testid="timeline.scroll"]')
  if (!el) return
  if (at !== null) {
    const x = TIMELINE_HEADER_W + at * s.pxPerSec
    const room = el.clientWidth - TIMELINE_HEADER_W
    if (x < el.scrollLeft + TIMELINE_HEADER_W + 24 || x > el.scrollLeft + el.clientWidth - Math.min(160, room / 3)) el.scrollLeft = Math.max(0, x - TIMELINE_HEADER_W - room * 0.3)
  }
  // Its lane: the first mark that lies on one.
  const m = marks.find((x) => x.item === i && (x.shape === 'clip' || x.shape === 'box' || x.shape === 'track'))
  const trackId = !m ? undefined : m.shape === 'clip' ? (m.id !== undefined && Object.hasOwn(shown.clips, m.id) ? shown.clips[m.id].trackId : undefined) : m.shape === 'box' ? m.trackId : m.id
  const rows = [...el.querySelectorAll<HTMLElement>('.tl-track[data-track-id]')]
  const row = rows.find((r) => r.dataset.trackId === trackId)
  if (!row) return
  const ruler = el.querySelector<HTMLElement>('.tl-ruler')?.offsetHeight ?? 24
  if (row.offsetTop < el.scrollTop + ruler + 8) el.scrollTop = Math.max(0, row.offsetTop - ruler - 8)
  else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight + 8
}
