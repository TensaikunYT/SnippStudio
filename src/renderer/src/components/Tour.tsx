// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The first-run tour (SnippStudio phase 9b, decision 2; FAZ9.md 9b karar 2):
// five steps, each a bubble pointing at one part of the window: the media,
// the timeline, the preview, the command box and the agent, the export.
// Not modal: no curtain, the window works under it, the bubble never takes
// the focus. "Skip" on every step and Esc end it; it is seen once (kept in
// the profile) and comes back from File → Help → Show the tour.
// Calm (TASARIM.md, the four rules): a raised surface, no accent fill; the
// part it points at gets the focus ring's outline.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, useT, type StringKey } from '../ui'
import { onShellRequest } from './app/requests'
import { homeBlocksTour } from './app/launch-home'

export const TOUR_SEEN_KEY = 'snipp-tour-seen'

interface Step {
  id: string
  /** The part it points at (a data-testid). */
  target: string
  title: StringKey
  body: StringKey
}

export const TOUR_STEPS: readonly Step[] = [
  { id: 'media', target: 'media.import', title: 'tour.media.title', body: 'tour.media.body' },
  { id: 'timeline', target: 'timeline.scroll', title: 'tour.timeline.title', body: 'tour.timeline.body' },
  { id: 'preview', target: 'preview.canvas', title: 'tour.preview.title', body: 'tour.preview.body' },
  // (Phase 9 audit patch D8: the top bar's Agent access switch, always there;
  // Connect agent is only in the command box when it is open.)
  { id: 'agent', target: 'agent.switch', title: 'tour.agent.title', body: 'tour.agent.body' },
  { id: 'export', target: 'topbar.export', title: 'tour.export.title', body: 'tour.export.body' }
]

const W = 300
const GAP = 10
const MARGIN = 8

function seen(): boolean {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1'
  } catch {
    return true // storage blocked: never pester
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1')
  } catch {
    /* storage blocked: it shows only this once anyway */
  }
}

interface Place {
  ring: { x: number; y: number; w: number; h: number } | null
  x: number
  y: number
}

/** Where the bubble goes: beside the part where it fits (below, above, right,
 *  left), kept inside the window; in the middle when the part is not there.
 *  A place over one of `avoid` (the transport bar: phase 11b, U2 — under the
 *  preview it covered Play and the time while the step said "Space plays")
 *  is taken only when no other fits. */
export function placeBubble(r: DOMRect | null, bubbleH: number, vw: number, vh: number, avoid: readonly DOMRect[] = []): Place {
  if (!r || r.width < 2 || r.height < 2) return { ring: null, x: Math.round((vw - W) / 2), y: Math.round((vh - bubbleH) / 2) }
  const clampX = (x: number): number => Math.max(MARGIN, Math.min(vw - W - MARGIN, x))
  const clampY = (y: number): number => Math.max(MARGIN, Math.min(vh - bubbleH - MARGIN, y))
  const ring = { x: r.left, y: r.top, w: r.width, h: r.height }
  const cx = r.left + r.width / 2 - W / 2
  const cy = clampY(r.top + r.height / 2 - bubbleH / 2)
  const fits: { x: number; y: number }[] = []
  if (r.bottom + GAP + bubbleH <= vh - MARGIN) fits.push({ x: clampX(cx), y: r.bottom + GAP })
  if (r.top - GAP - bubbleH >= MARGIN) fits.push({ x: clampX(cx), y: r.top - GAP - bubbleH })
  if (r.right + GAP + W <= vw - MARGIN) fits.push({ x: r.right + GAP, y: cy })
  if (r.left - GAP - W >= MARGIN) fits.push({ x: r.left - GAP - W, y: cy })
  // A part as big as the window (the timeline on a small screen): inside it, at its top.
  fits.push({ x: clampX(cx), y: clampY(r.top + GAP) })
  const over = (p: { x: number; y: number }): boolean => avoid.some((a) => a.width > 0 && p.x < a.right && p.x + W > a.left && p.y < a.bottom && p.y + bubbleH > a.top)
  const best = fits.find((p) => !over(p)) ?? fits[0]
  return { ring, ...best }
}

export function Tour(): JSX.Element | null {
  const t = useT()
  const [step, setStep] = useState<number | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const bubble = useRef<HTMLDivElement>(null)

  const end = useCallback(() => {
    markSeen()
    setStep(null)
  }, [])

  // The first run: once the editor is drawn. Again from the Help menu.
  useEffect(() => {
    // (Not over the Projects window shown at launch: it starts once that
    // one is closed, REF-AB item 1.)
    let id = 0
    const later = (ms: number): void => {
      id = window.setTimeout(() => (homeBlocksTour() ? later(400) : setStep((s) => s ?? 0)), ms)
    }
    if (!seen()) later(900)
    const off = onShellRequest((what) => { if (what === 'tour') setStep(0) })
    return () => {
      window.clearTimeout(id)
      off()
    }
  }, [])

  useEffect(() => {
    if (step === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') end()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, end])

  // Follows its part: the window's size, a panel that moves, a part that
  // appears late.
  const measure = useCallback(() => {
    if (step === null) return
    const target = document.querySelector(`[data-testid="${TOUR_STEPS[step].target}"]`)
    const h = bubble.current?.offsetHeight ?? 140
    const avoid = [...document.querySelectorAll('.transport-bar')].map((e) => e.getBoundingClientRect())
    setPlace(placeBubble(target ? target.getBoundingClientRect() : null, h, window.innerWidth, window.innerHeight, avoid))
  }, [step])
  useLayoutEffect(() => {
    measure()
    if (step === null) return
    window.addEventListener('resize', measure)
    const id = window.setInterval(measure, 400)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearInterval(id)
    }
  }, [step, measure])

  if (step === null) return null
  const s = TOUR_STEPS[step]
  const last = step === TOUR_STEPS.length - 1
  return createPortal(
    <>
      {place?.ring && <div className="tour-ring" aria-hidden="true" style={{ left: place.ring.x - 3, top: place.ring.y - 3, width: place.ring.w + 6, height: place.ring.h + 6 }} />}
      <div
        ref={bubble}
        className="tour-bubble"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        data-testid="tour"
        data-step={s.id}
        style={{ left: place?.x ?? -9999, top: place?.y ?? -9999, width: W }}
      >
        <div className="tour-head">
          <strong id="tour-title">{t(s.title)}</strong>
          <span className="tour-count" data-testid="tour.count">{t('tour.count', { n: step + 1, total: TOUR_STEPS.length })}</span>
        </div>
        <p className="tour-body">{t(s.body)}</p>
        <div className="tour-actions">
          <Button size="sm" variant="ghost" onClick={end} testid="tour.skip">
            {t('tour.skip')}
          </Button>
          <span className="tour-spacer" />
          {step > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setStep(step - 1)} testid="tour.back">
              {t('tour.back')}
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => (last ? end() : setStep(step + 1))} testid="tour.next">
            {t(last ? 'tour.done' : 'tour.next')}
          </Button>
        </div>
      </div>
    </>,
    document.body
  )
}
