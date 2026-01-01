// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A card of the Text page dragged out (SnippStudio YAZI2-PLAN.md, 2.1, D9):
// onto the preview, the title is put where it is dropped; onto the timeline,
// at the time it is dropped at (a ghost clip shows where, catching on the
// playhead and the clips' edges as a moved title does). With pointer events,
// not the system's drag and drop: the ghost is this module's own to draw, and
// a press that does not move stays the card's click.
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useStore } from '../../../state/store'
import type { CaptionStyle } from '../../../types'
import { Icon, useT } from '../../../ui'
import { fmtTime } from '../../../ui/format'
import { DRAG_THRESHOLD, pastThreshold } from '../../../ui/handles'
import { HEADER_W, snapEdgeTime } from '../../timeline/shared'
import { NEW_TITLE_SECONDS, addTitle } from '../../text/TextStyles'

interface Dragged {
  name: string
  look: Partial<CaptionStyle> | null
  /** The pointer (client px). */
  x: number
  y: number
  /** Over the preview's picture: where in the frame (parts of it). */
  frame: { x: number; y: number } | null
  /** Over the timeline: the time, and the ghost clip's box (client px). */
  timeline: { time: number; left: number; top: number; width: number } | null
}

export const useCardDrag = create<{ drag: Dragged | null }>(() => ({ drag: null }))

/** Where the pointer is: over the preview's picture, over the timeline, or neither. */
function place(x: number, y: number, exact: boolean): Pick<Dragged, 'frame' | 'timeline'> {
  const el = document.elementFromPoint(x, y)
  const s = useStore.getState()
  const canvas = el?.closest<HTMLCanvasElement>('[data-testid="preview.canvas"]')
  if (canvas) {
    const r = canvas.getBoundingClientRect()
    const { width: W, height: H } = s.project.settings
    const pv = s.previewView
    const k = Math.min(r.width / W, r.height / H) * pv.zoom
    const fx = (x - r.left - r.width / 2 - pv.x) / (W * k) + 0.5
    const fy = (y - r.top - r.height / 2 - pv.y) / (H * k) + 0.5
    // Dropped beside the picture, it is still put inside it.
    return { frame: { x: Math.min(0.95, Math.max(0.05, fx)), y: Math.min(0.95, Math.max(0.05, fy)) }, timeline: null }
  }
  const scroll = el?.closest<HTMLElement>('[data-testid="timeline.scroll"]')
  const ruler = scroll?.querySelector<HTMLElement>('[data-testid="timeline.ruler"]')
  if (scroll && ruler) {
    const rr = ruler.getBoundingClientRect()
    const px = s.pxPerSec
    let time = Math.max(0, (x - rr.left - HEADER_W) / px)
    const caught = exact ? time : snapEdgeTime(s, time, '', 8 / px)
    s.setSnapGuide(caught !== time ? caught : null)
    time = caught
    // On the text lane it will join when there is one; else under the ruler.
    const lanes = [...scroll.querySelectorAll<HTMLElement>('.tl-caption-lane')].filter((l) => Number(l.dataset.captionLayer) >= 1)
    const lane = lanes[0]?.getBoundingClientRect()
    return { frame: null, timeline: { time, left: rr.left + HEADER_W + time * px, top: lane ? lane.top + 3 : rr.bottom + 3, width: Math.max(14, NEW_TITLE_SECONDS * px - 2) } }
  }
  return { frame: null, timeline: null }
}

/**
 * On a card's pointerdown: the card is dragged once the pointer has left the
 * press by the threshold. Dropped on the preview or the timeline it adds its
 * title there (typed in at once); anywhere else, or with Esc, nothing is
 * added. A press that never moved is left to the card's own click.
 */
export function startCardDrag(e: React.PointerEvent, card: { name: string; look: Partial<CaptionStyle> | null }): void {
  if (e.button !== 0) return
  const x0 = e.clientX
  const y0 = e.clientY
  let on = false
  const move = (ev: PointerEvent): void => {
    if (!on) {
      if (!pastThreshold(x0, y0, ev.clientX, ev.clientY, DRAG_THRESHOLD)) return
      on = true
      document.body.classList.add('yz-card-dragging')
    }
    useCardDrag.setState({ drag: { ...card, x: ev.clientX, y: ev.clientY, ...place(ev.clientX, ev.clientY, ev.shiftKey) } })
  }
  const done = (): void => {
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', cancel, true)
    window.removeEventListener('keydown', key, true)
    document.body.classList.remove('yz-card-dragging')
    useStore.getState().setSnapGuide(null)
    useCardDrag.setState({ drag: null })
  }
  const up = (ev: PointerEvent): void => {
    const was = on
    const at = was ? place(ev.clientX, ev.clientY, ev.shiftKey) : null
    done()
    if (!was) return
    // The release is the drop, not the card's click.
    const swallow = (c: MouseEvent): void => {
      c.stopPropagation()
      c.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    if (at?.frame) addTitle(card.look, { at: at.frame })
    else if (at?.timeline) addTitle(card.look, { time: at.timeline.time })
  }
  const cancel = (): void => done()
  const key = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape' || !on) return
    ev.preventDefault()
    ev.stopPropagation()
    done()
  }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', cancel, true)
  window.addEventListener('keydown', key, true)
}

/** The dragged card beside the pointer, and where it would land. */
export function CardDragGhost(): JSX.Element | null {
  const t = useT()
  const d = useCardDrag((s) => s.drag)
  if (!d) return null
  const hint = d.frame ? t('yz.drag.preview') : d.timeline ? t('yz.drag.timeline', { time: fmtTime(d.timeline.time, 2) }) : t('yz.drag.away')
  return createPortal(
    <div className="yz-drag" data-testid="text.card.drag" data-over={d.frame ? 'preview' : d.timeline ? 'timeline' : 'none'}>
      {d.frame && <span className="yz-drag-cross" style={{ left: d.x, top: d.y }} aria-hidden="true" />}
      {d.timeline && (
        <span className="yz-drag-clip" data-testid="text.card.drag.clip" style={{ left: d.timeline.left, top: d.timeline.top, width: d.timeline.width }}>
          <Icon name="type" size={12} />
          <span className="yz-drag-clip-name">{d.name}</span>
        </span>
      )}
      <span className={d.frame || d.timeline ? 'yz-drag-tag is-on' : 'yz-drag-tag'} style={{ left: d.x + 14, top: d.y + 16 }}>
        <Icon name="type" size={14} />
        <span className="yz-drag-name">{d.name}</span>
        <span className="yz-drag-hint">{hint}</span>
      </span>
    </div>,
    document.body
  )
}
