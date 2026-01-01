// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Every change of an agent's draft, marked on the timeline (D22, worker C;
// YOL-HARITASI.md, part 4; agent/marks.ts has the table): a move (the old
// place faded, a dashed box where it goes, "3 s later"), an added clip or
// title (dashed, "new"), a removal (hatched across, "to be removed"), a cut
// (a hatched band, the time won), a trim (the end that goes hatched), a
// split (a dashed line), a setting (a frame and a short badge), a
// transition (a badge on the join), a subtitle (a dot on its chip), a lane
// (its row framed). The marks of the review strip's item in focus are lit.
// A press on a badge puts that item in focus.
//
// The lanes' rows are measured, the marks placed by seconds: no clip element
// is needed (the lanes draw only the clips near the view). No badge ever
// lies on a clip's name: after each draw the badges are held against the
// name pills on screen, and one that would touch a name shrinks to a dot,
// moves to the bottom corner, or goes (the frame and the strip still say it).
// And the clips the agent's job changed, framed (YOL-HARITASI.md 1.2).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '../../agent/store'
import { marksFor, type Mark } from '../../agent/marks'
import { saidOf, wordsText } from '../../agent/said'
import { touchedOf } from '../../agent/activity'
import { useStore } from '../../state/store'
import { TIMELINE_HEADER_W, type Project } from '../../types'
import { BareButton, Icon, Tooltip } from '../../ui'
import { changeText } from './draft-text'
import { useShowingAfter } from './shown'
import { useAgentJob } from './useJob'
import { useCrewOf } from './useCrew'
import type { CSSProperties } from 'react'

type Row = { top: number; height: number }
interface Rows {
  tracks: Record<string, Row>
  layers: Record<number, Row>
  /** Under the last lane: a lane the draft adds. */
  fresh: Row
  /** Where a title of a layer that has no lane yet is drawn. */
  top: Row
}

function measure(inner: HTMLElement): Rows {
  const tracks: Record<string, Row> = {}
  const layers: Record<number, Row> = {}
  let bottom = 0
  for (const el of inner.querySelectorAll<HTMLElement>('.tl-track[data-track-id]')) {
    tracks[el.dataset.trackId!] = { top: el.offsetTop, height: el.offsetHeight }
    bottom = Math.max(bottom, el.offsetTop + el.offsetHeight)
  }
  let first = Infinity
  for (const el of inner.querySelectorAll<HTMLElement>('.tl-caption-lane[data-caption-layer]')) {
    layers[Number(el.dataset.captionLayer)] = { top: el.offsetTop, height: el.offsetHeight }
    first = Math.min(first, el.offsetTop)
  }
  const strip = inner.querySelector<HTMLElement>('.tl-addtrack')
  return { tracks, layers, fresh: { top: bottom, height: 28 }, top: { top: Number.isFinite(first) ? first : (strip?.offsetTop ?? 32), height: 24 } }
}

const sameRows = (a: Rows, b: Rows): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The draft's marks for the view the timeline is on, and what is needed to
 *  place them. */
export function useDraftMarks(): { marks: Mark[]; shown: Project | null; after: boolean; focus: number } {
  const draft = useAgentStore((s) => s.draft)
  const focusKey = useAgentStore((s) => s.focusItem)
  const after = useShowingAfter()
  const live = draft?.on
  const next = draft?.project
  const items = draft?.items
  const cuts = draft?.marks?.cuts
  const marks = useMemo(() => (live && next && items ? marksFor(after ? 'after' : 'before', live, next, cuts ?? [], items) : []), [live, next, items, cuts, after])
  return { marks, shown: (after ? next : live) ?? null, after, focus: items ? items.findIndex((i) => i.key === focusKey) : -1 }
}

const hit = (a: DOMRect, b: DOMRect): boolean => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5

/** No badge on a clip's name (or on the clip's own badges): shrink it to a
 *  dot, then move it down, then let it go. */
export function settleBadges(layer: HTMLElement): void {
  const inner = layer.closest<HTMLElement>('.tl-inner')
  if (!inner) return
  const view = inner.parentElement?.getBoundingClientRect()
  const names = [...inner.querySelectorAll<HTMLElement>('.tl-clip .label, .tl-clip .clip-badges, .tl-caption-chip')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && (!view || (r.right > view.left && r.left < view.right)))
  const placed: DOMRect[] = []
  for (const b of layer.querySelectorAll<HTMLElement>('.agent-mark-badge')) {
    b.classList.remove('is-compact', 'is-low', 'is-out')
    const clear = (): boolean => {
      const r = b.getBoundingClientRect()
      // (A subtitle chip is its own name; a dot on it lies on its corner.)
      return !names.some((n) => hit(r, n)) && !placed.some((p) => hit(r, p))
    }
    const onChip = b.dataset.shape === 'chip' || b.dataset.shape === 'chipBox'
    if (onChip || clear()) {
      placed.push(b.getBoundingClientRect())
      continue
    }
    b.classList.add('is-compact')
    if (!clear()) b.classList.add('is-low')
    if (!clear()) b.classList.add('is-out')
    else placed.push(b.getBoundingClientRect())
  }
}

export function DraftMarksLayer({ pxPerSec }: { pxPerSec: number }): JSX.Element | null {
  const { marks, shown, focus } = useDraftMarks()
  const items = useAgentStore((s) => s.draft?.items)
  const hasDraft = useAgentStore((s) => !!s.draft)
  const j = useAgentJob()
  // The team mode (EKIP-PLAN.md): each mark takes its worker's corner.
  const crew = useCrewOf(useAgentStore((s) => s.draft?.client ?? null))
  const team = !!items?.some((i) => i.as)
  const liveClips = useStore((s) => (hasDraft ? null : s.project.clips))
  const liveTracks = useStore((s) => s.project.tracks)
  const ref = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Rows>({ tracks: {}, layers: {}, fresh: { top: 0, height: 28 }, top: { top: 32, height: 24 } })
  const touched = useMemo(() => (hasDraft || j.closed || !j.job ? [] : touchedOf(j.job)), [hasDraft, j.closed, j.job])
  const any = marks.length > 0 || touched.length > 0
  useLayoutEffect(() => {
    const inner = ref.current?.closest<HTMLElement>('.tl-inner')
    if (!inner || !any) return
    const read = (): void => {
      const next = measure(inner)
      setRows((prev) => (sameRows(prev, next) ? prev : next))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(inner)
    for (const el of inner.querySelectorAll('.tl-track')) ro.observe(el)
    return () => ro.disconnect()
  }, [any, shown, liveTracks])
  // After each draw, and while the view moves: the badges against the names.
  useLayoutEffect(() => {
    const layer = ref.current
    const scroll = layer?.closest<HTMLElement>('.tl-scroll')
    if (!layer || !scroll || !marks.length) return
    settleBadges(layer)
    let raf = 0
    const later = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => settleBadges(layer))
    }
    scroll.addEventListener('scroll', later, { passive: true })
    const id = window.setTimeout(later, 120)
    return () => {
      scroll.removeEventListener('scroll', later)
      cancelAnimationFrame(raf)
      window.clearTimeout(id)
    }
  })
  // (The names are drawn by the lanes a moment after a zoom or a new draft.)
  useEffect(() => {
    const layer = ref.current
    if (layer && marks.length) settleBadges(layer)
  }, [pxPerSec, marks])
  if (!any) return null
  const x = (s: number): number => TIMELINE_HEADER_W + s * pxPerSec
  const tipOf = (m: Mark): string => changeText(m.change) || (items?.[m.item] ? saidOf(items[m.item].changes) : '')
  const pick = (m: Mark): void => {
    const key = items?.[m.item]?.key
    if (key) useAgentStore.getState().setFocusItem(key)
  }
  const badge = (m: Mark, cls = ''): JSX.Element | null => {
    if (!m.badge) return null
    const words = wordsText(m.badge)
    return (
      <Tooltip content={tipOf(m)}>
        <BareButton className={`agent-mark-badge${cls}`} data-shape={m.shape} onClick={() => pick(m)} onPointerDown={(e) => e.stopPropagation()} testid="agent.mark.badge">
          <span className="agent-mark-badge-text">{words}</span>
        </BareButton>
      </Tooltip>
    )
  }
  const corner = (m: Mark): JSX.Element | null => {
    if (!team) return null
    const as = items?.[m.item]?.as
    return <i className="agent-mark-corner" style={{ '--worker': crew.colour(as) } as CSSProperties} data-testid="agent.mark.corner" data-worker={as ?? ''} aria-hidden="true" />
  }
  const cls = (m: Mark): string => `agent-mark is-${m.kind} is-${m.variant}${m.item === focus ? ' is-focus' : ''}`
  const data = (m: Mark): Record<string, string | number> => ({ 'data-testid': 'agent.mark', 'data-kind': m.kind, 'data-variant': m.variant, 'data-item': m.item, 'data-shape': m.shape, 'data-change': m.change.kind })
  return (
    <div className="agent-marks" ref={ref} data-testid="agent.marks">
      {touched.map((id) => {
        const c = liveClips && Object.hasOwn(liveClips, id) ? liveClips[id] : undefined
        const row = c ? rows.tracks[c.trackId] : undefined
        if (!c || !row) return null
        return (
          <div key={`t${id}`} className="agent-mark is-touched" style={{ left: x(c.start), width: Math.max(4, c.duration * pxPerSec), top: row.top + 4, height: Math.max(8, row.height - 8) }} data-testid="agent.touched" data-clip={id}>
            <span className="agent-mark-pen">
              <Icon name="pencil" size={12} />
            </span>
          </div>
        )
      })}
      {marks.map((m, i) => {
        const key = `${m.item}.${i}`
        if (m.shape === 'clip') {
          const c = shown && m.id !== undefined && Object.hasOwn(shown.clips, m.id) ? shown.clips[m.id] : undefined
          const row = c ? rows.tracks[c.trackId] : undefined
          if (!c || !row) return null
          const w = Math.max(4, c.duration * pxPerSec)
          return (
            <div key={key} className={cls(m)} style={{ left: x(c.start), width: w, top: row.top + 4, height: Math.max(8, row.height - 8) }} {...data(m)} data-clip={c.id}>
              {m.regions?.map(([a, b], k) => <i key={k} className="agent-mark-region" style={{ left: a * pxPerSec, width: Math.max(2, (b - a) * pxPerSec) }} />)}
              {m.variant === 'seam' && m.seam !== undefined && <i className="agent-mark-seam" style={{ left: Math.min(w - 1, Math.max(0, m.seam * pxPerSec)) }} />}
              {m.variant === 'join' ? badge(m, ' is-join') : badge(m)}
              {corner(m)}
            </div>
          )
        }
        if (m.shape === 'box') {
          const row = (m.trackId !== undefined && !m.fresh ? rows.tracks[m.trackId] : undefined) ?? rows.fresh
          return (
            <div key={key} className={cls(m)} style={{ left: x(m.start ?? 0), width: Math.max(8, ((m.end ?? 0) - (m.start ?? 0)) * pxPerSec), top: row.top + 4, height: Math.max(8, row.height - 8) }} {...data(m)} data-clip={m.change.clipId}>
              {badge(m, ' is-start')}
              {corner(m)}
            </div>
          )
        }
        if (m.shape === 'band') {
          return (
            <div key={key} className={cls(m)} style={{ left: x(m.start ?? 0), width: Math.max(2, ((m.end ?? 0) - (m.start ?? 0)) * pxPerSec) }} {...data(m)}>
              {badge(m, ' is-mid')}
              {corner(m)}
            </div>
          )
        }
        if (m.shape === 'chip' || m.shape === 'chipBox') {
          const cap = m.shape === 'chip' ? shown?.captions.find((c) => c.id === m.id) : undefined
          const start = cap ? cap.start : m.start
          const end = cap ? cap.end : m.end
          if (start === undefined || end === undefined) return null
          const row = rows.layers[cap ? (cap.layer ?? 0) : (m.layer ?? 0)] ?? rows.top
          // (The chip under it stays the user's: only the dot takes a press.)
          return (
            <div key={key} className={`${cls(m)} is-chip`} style={{ left: x(start), width: Math.max(14, (end - start) * pxPerSec - 2), top: row.top + 3, height: Math.max(8, row.height - 6) }} {...data(m)} data-caption={m.id}>
              <Tooltip content={tipOf(m)}>
                <BareButton className="agent-mark-badge is-chipdot" data-shape={m.shape} onClick={() => pick(m)} onPointerDown={(e) => e.stopPropagation()} testid="agent.mark.badge">
                  {/* (A chip that is there keeps its own words: a dot on its corner.) */}
                  {m.shape === 'chip' || m.variant === 'gone' || !m.badge ? <i className="agent-mark-dot" /> : <span className="agent-mark-badge-text">{wordsText(m.badge)}</span>}
                </BareButton>
              </Tooltip>
              {corner(m)}
            </div>
          )
        }
        if (m.shape === 'track') {
          const row = (m.id !== undefined && !m.fresh ? rows.tracks[m.id] : undefined) ?? rows.fresh
          return (
            <div key={key} className={`${cls(m)} is-row`} style={{ top: row.top, height: row.height }} {...data(m)}>
              {badge(m, ' is-sticky')}
              {corner(m)}
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
