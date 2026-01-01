// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Searching the timeline (KOLAY-PLAN.md, item 2): a small search in the
// timeline's toolbar, and Ctrl+F (the app keeps that key for itself:
// shortcuts-presets.ts RESERVED_KEYS; while the Transcript panel is on screen
// it stays that panel's word search, as before). What is found: clips by
// their media's name, subtitles and texts by their words, markers, work notes
// (timeline/search.ts). The arrows go through the hits, Enter goes to one:
// the playhead there, the timeline scrolled to it (its own scroll, nothing
// else on the page moves), the item selected. The project is not changed.
// A colour under the field keeps only the clips of that label (item 3).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BareButton, Icon, TextField, useT, type IconName } from '../../ui'
import { placeMenu } from '../../ui/logic'
import { fmtTime } from '../../ui/format'
import { revealIn } from '../../ui/reveal'
import { modalOpen } from '../../shortcuts'
import { useStore } from '../../state/store'
import { searchTimeline, type SearchHit } from '../../timeline/search'
import { CLIP_LABELS, TIMELINE_HEADER_W, type ClipLabel } from '../../types'
import { labelName, labelToken } from './clip-label-menu'
import { ToolButton } from '../ToolButton'
import './search.css'

const HIT_ICON: Record<SearchHit['kind'], IconName> = { clip: 'film', subtitle: 'captions', text: 'type', marker: 'bookmark', note: 'sticky-note' }
const MEDIA_ICON = { video: 'video', image: 'image', audio: 'audio-waveform', code: 'code' } as const

/** The playhead to the hit, the timeline scrolled to it (sideways and to its
 *  lane), the item selected. */
export function goToHit(hit: SearchHit): void {
  const s = useStore.getState()
  s.setPlaying(false)
  s.setTime(Math.max(0, hit.at))
  if (hit.kind === 'clip') s.selectClip(hit.id)
  else if (hit.kind === 'subtitle' || hit.kind === 'text') s.selectCaptions([hit.id])
  else if (hit.kind === 'note') s.selectNote(hit.id)
  const el = document.querySelector<HTMLElement>('[data-testid="timeline.scroll"]')
  if (!el) return
  const px = useStore.getState().pxPerSec
  const x = TIMELINE_HEADER_W + hit.at * px
  const room = el.clientWidth - TIMELINE_HEADER_W
  if (x < el.scrollLeft + TIMELINE_HEADER_W + 24 || x > el.scrollLeft + el.clientWidth - Math.min(160, room / 3)) el.scrollLeft = Math.max(0, x - TIMELINE_HEADER_W - room * 0.3)
  if (!hit.trackId) return
  const row = [...el.querySelectorAll<HTMLElement>('.tl-track[data-track-id]')].find((r) => r.dataset.trackId === hit.trackId)
  if (!row) return
  const ruler = el.querySelector<HTMLElement>('.tl-ruler')?.offsetHeight ?? 24
  if (row.offsetTop < el.scrollTop + ruler + 8) el.scrollTop = Math.max(0, row.offsetTop - ruler - 8)
  else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight + 8
}

/** Ctrl+F belongs to the Transcript panel while it is on screen. */
const transcriptShown = (): boolean => {
  const el = document.querySelector<HTMLElement>('.transcript-root')
  return !!el && el.isConnected && el.getClientRects().length > 0
}

export function TimelineSearch(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [label, setLabel] = useState<ClipLabel | null>(null)
  const project = useStore((s) => s.project)
  const hits = useMemo(() => (open ? searchTimeline(project, query, label ? (id) => project.clips[id]?.label === label : undefined) : []), [open, project, query, label])
  const listed = query.trim() !== '' || label !== null
  const anchor = useRef<HTMLSpanElement | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  // (Placed again when the window changes size.)
  const [view, setView] = useState(0)

  useEffect(() => setActive(0), [query, label])
  // Ctrl+F: open (or focus) the search.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      if (transcriptShown() || modalOpen(document)) return
      e.preventDefault()
      setOpen(true)
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) return
    const r = anchor.current.getBoundingClientRect()
    const c = card.current.getBoundingClientRect()
    const p = placeMenu({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: c.width, h: c.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ x: p.x, y: p.y })
  }, [open, hits.length, view])
  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    requestAnimationFrame(() => input.current?.focus())
    // Closed by a press outside it, or Escape wherever the focus is in it.
    const down = (e: PointerEvent): void => {
      const at = e.target as Node
      if (!card.current?.contains(at) && !anchor.current?.contains(at)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !card.current?.contains(document.activeElement)) return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      anchor.current?.querySelector('button')?.focus()
    }
    const resized = (): void => setView((n) => n + 1)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', resized)
    }
  }, [open])
  // The active hit in view inside the list (its own scroll).
  useEffect(() => {
    revealIn(list.current?.querySelector('.tsr-hit.is-active'), 'nearest')
  }, [active, hits])

  const close = (): void => {
    setOpen(false)
    anchor.current?.querySelector('button')?.focus()
  }
  const go = (i: number): void => {
    const h = hits[i]
    if (!h) return
    setActive(i)
    goToHit(h)
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (!hits.length) return
      go((active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(active)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <>
      <span ref={anchor} className="tsr-anchor">
        <ToolButton icon="search" pressed={open} testid="timeline.search" onClick={() => setOpen((o) => !o)} label={t('kolay.search')} hint={t('kolay.search.hint')} aria-expanded={open} aria-haspopup="dialog" />
      </span>
      {open &&
        createPortal(
          <div ref={card} className="tsr-card" role="dialog" aria-label={t('kolay.search')} data-testid="timeline.search.card" style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}>
            <TextField ref={input} value={query} onChange={setQuery} onKeyDown={onKey} label={t('kolay.search')} placeholder={t('kolay.search.placeholder')} size="sm" testid="timeline.search.input" />
            <div className="tsr-filter" role="group" aria-label={t('kolay.label')}>
              {CLIP_LABELS.map((l) => (
                <BareButton
                  key={l}
                  className={`tsr-swatch${label === l ? ' is-on' : ''}`}
                  style={{ background: `var(${labelToken(l)})` }}
                  aria-pressed={label === l}
                  aria-label={t('kolay.search.label', { name: labelName(l) })}
                  title={t('kolay.search.label', { name: labelName(l) })}
                  testid={`timeline.search.label.${l}`}
                  onClick={() => setLabel((was) => (was === l ? null : l))}
                />
              ))}
            </div>
            {listed && (
              <div ref={list} className="tsr-list" role="listbox" aria-label={t('kolay.search.results')} data-testid="timeline.search.results">
                {hits.length === 0 && <div className="tsr-none" data-testid="timeline.search.none">{t('kolay.search.none')}</div>}
                {hits.map((h, i) => (
                  <BareButton
                    key={`${h.kind}-${h.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={`tsr-hit${i === active ? ' is-active' : ''}`}
                    testid={`timeline.search.hit.${h.kind}.${h.id}`}
                    tabIndex={-1}
                    onClick={() => {
                      go(i)
                      close()
                    }}
                  >
                    <Icon name={h.kind === 'clip' && h.media ? MEDIA_ICON[h.media] : HIT_ICON[h.kind]} size={14} />
                    <span className="tsr-name">{h.name}</span>
                    <span className="tsr-time">{fmtTime(h.at, 1)}</span>
                  </BareButton>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
