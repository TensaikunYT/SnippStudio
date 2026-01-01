// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One drag on the timeline (phase 3c.T): what every pointer drag there shares.
//
//   - It begins only after the pointer has travelled DRAG_START_PX (a press
//     that does not travel is a click).
//   - Its work runs once per frame, with the newest pointer position: several
//     pointer events in one frame are one step.
//   - Escape (and a cancelled pointer, the window losing focus) cancels it:
//     the caller puts everything back.
//   - At the edge of the visible lanes it can scroll the view on its own,
//     faster the deeper and the longer the pointer stays there, also while
//     the pointer rests.
//   - While it runs, <body> carries `tl-dragging` (no transitions, no hover
//     states under the dragged thing) and the dragged element's native
//     tooltip is put away.
import { useStore } from '../../state/store'
import { TIMELINE_HEADER_W as HEADER_W } from '../../types'
import { DRAG_START_PX, dragStarted, edgeScrollSpeed } from '../../timeline/view-math'
import { motionOff } from '../../ui/motion'

/** The pointer, as a drag's steps see it. */
export interface DragPoint {
  clientX: number
  clientY: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** Sideways travel since the press in timeline pixels: the pointer's own
   *  plus whatever the view has scrolled meanwhile (edge scrolling, the
   *  wheel), so what is dragged stays under the pointer. */
  dx: number
  /** Travel down the screen since the press (px). */
  dy: number
}

export interface DragOptions {
  /** Pointer travel before the drag begins (px). 0: at the first move. */
  slop?: number
  /** The slop counts sideways travel only (a lane's blocks). */
  horizontal?: boolean
  /** The slop has been crossed: the drag begins (before its first step). */
  onStart?: (p: DragPoint) => void
  /** One step: the newest pointer position, once per frame. */
  onMove: (p: DragPoint) => void
  /** Released. `moved`: it had begun. The last step has already run with the
   *  release point (`final`: without scrolling the view once more). */
  onEnd?: (p: DragPoint, moved: boolean) => void
  /** Cancelled (Escape, pointercancel, blur). `moved`: it had begun. */
  onCancel?: (moved: boolean) => void
  /** Scroll the view while the pointer is at the lanes' left or right edge. */
  edgeScroll?: boolean
}

const EDGE_ZONE = 60

/** The drag under way, if any (one pointer: one drag). */
let active: { cancel: () => void } | null = null

/** True while a timeline drag is under way (its slop crossed). */
export const dragging = (): boolean => document.body.classList.contains('tl-dragging')

type RawPoint = Omit<DragPoint, 'dx' | 'dy'>
const point = (e: PointerEvent | React.PointerEvent): RawPoint => ({ clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey })

/**
 * Starts following the pointer of a press (`e`: the pointerdown). The element
 * pressed captures the pointer (its cursor stays for the whole drag).
 */
export function startDrag(e: React.PointerEvent | PointerEvent, o: DragOptions): void {
  active?.cancel()
  const el = (e.currentTarget ?? e.target) as HTMLElement
  const pointerId = e.pointerId
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* the pointer is already gone */
  }
  const slop = o.slop ?? DRAG_START_PX
  const x0 = e.clientX
  const y0 = e.clientY
  let last = point(e)
  let begun = false
  let dirty = false
  let raf = 0
  let done = false
  // Edge scrolling: since when the pointer has been in the zone, the last frame.
  let edgeSince = 0
  let lastFrame = 0
  const scroller = document.querySelector<HTMLDivElement>('.tl-scroll')
  const scroll0 = scroller?.scrollLeft ?? 0
  const bounds = o.edgeScroll ? scroller?.getBoundingClientRect() : undefined
  const travelled = (p: RawPoint): DragPoint => ({ ...p, dx: p.clientX - x0 + (scroller?.scrollLeft ?? scroll0) - scroll0, dy: p.clientY - y0 })
  // The dragged element's native tooltip (and its parents' inside the
  // timeline) would open over the drag: put away until it ends.
  const titles: [HTMLElement, string][] = []
  const hideTitles = (): void => {
    for (let n: HTMLElement | null = el; n && !n.classList.contains('tl-scroll'); n = n.parentElement) {
      const title = n.getAttribute('title')
      if (title !== null) {
        titles.push([n, title])
        n.removeAttribute('title')
      }
    }
  }
  const showTitles = (): void => {
    for (const [n, title] of titles) if (!n.hasAttribute('title')) n.setAttribute('title', title)
  }

  /** How far the view should scroll this frame (px; 0: not at an edge). */
  const edgeStep = (now: number): number => {
    if (!scroller || !bounds || !begun || !o.edgeScroll) return 0
    const moved = last.clientX - x0
    const right = last.clientX - (bounds.right - EDGE_ZONE)
    const left = bounds.left + HEADER_W + EDGE_ZONE - last.clientX
    // Only toward the edge the pointer has moved to since the press.
    const depth = right > 0 && moved > 0 ? right : left > 0 && moved < 0 ? left : 0
    if (depth <= 0) {
      edgeSince = 0
      return 0
    }
    if (!edgeSince) edgeSince = now
    const dt = lastFrame ? now - lastFrame : 16
    const step = edgeScrollSpeed(depth, EDGE_ZONE, now - edgeSince, dt)
    return right > 0 && moved > 0 ? step : -step
  }

  const tick = (now: number): void => {
    raf = 0
    if (done) return
    const step = edgeStep(now)
    lastFrame = now
    let scrolled = false
    if (step !== 0 && scroller) {
      const before = scroller.scrollLeft
      scroller.scrollLeft = Math.max(0, before + step)
      scrolled = scroller.scrollLeft !== before
    }
    if (dirty || scrolled) {
      dirty = false
      o.onMove(travelled(last))
    }
    // At an edge the view keeps scrolling while the pointer rests.
    if (step !== 0 && scrolled) raf = requestAnimationFrame(tick)
    else lastFrame = 0
  }
  const schedule = (): void => {
    if (!raf && !done) raf = requestAnimationFrame(tick)
  }

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    last = point(ev)
    if (!begun) {
      if (!dragStarted(ev.clientX - x0, o.horizontal ? 0 : ev.clientY - y0, slop)) return
      begun = true
      document.body.classList.add('tl-dragging')
      hideTitles()
      o.onStart?.(travelled(last))
    }
    dirty = true
    schedule()
  }
  const stop = (): void => {
    done = true
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onBlur)
    document.body.classList.remove('tl-dragging')
    showTitles()
    try {
      el.releasePointerCapture(pointerId)
    } catch {
      /* already released */
    }
    if (active === handle) active = null
  }
  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId || done) return
    last = point(ev)
    // A fast release may land on a new pixel with no move before it: the
    // last step runs with the release point, without scrolling once more.
    const pending = begun && (dirty || ev.clientX !== x0 || ev.clientY !== y0)
    stop()
    if (pending) o.onMove(travelled(last))
    o.onEnd?.(travelled(last), begun)
  }
  const cancel = (): void => {
    if (done) return
    stop()
    o.onCancel?.(begun)
  }
  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) cancel()
  }
  const onBlur = (): void => cancel()
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return
    // The drag's own Escape: nothing else acts on it (the tools stay as
    // they are, a note under way is kept).
    ev.preventDefault()
    ev.stopPropagation()
    cancel()
  }
  const handle = { cancel }
  active = handle
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onBlur)
}

/**
 * What a drag that edits the project as it goes must put back when it is
 * cancelled: taken at the press. `restore()` takes the drag's one undo step
 * back and leaves no trace of it: the undo and redo lists, the selection and
 * the playhead as they were.
 */
export function gestureMemo(): { restore: () => void } {
  const s = useStore.getState()
  const top = s.past[s.past.length - 1]
  const memo = { future: s.future, clips: s.selectedClipIds, captions: s.selectedCaptionIds, time: s.currentTime, project: s.project }
  return {
    restore: () => {
      const st = useStore.getState()
      // The drag pushed its snapshot (a new top of the undo list) at its
      // first change: back to it, and the redo list as it was before. Taken
      // back while the drag's window is still open (phase 2a.1: the window's
      // model check must not see an Alt + drag's copies on their originals);
      // the window is closed after.
      if (st.past[st.past.length - 1] !== top) {
        if (st.project !== memo.project) st.undo()
        // (A snapshot with no change after it is only dropped.)
        else useStore.setState({ past: st.past.slice(0, -1) })
        useStore.setState({ future: memo.future })
      }
      useStore.getState().endGesture()
      const now = useStore.getState()
      now.selectClips(memo.clips.filter((id) => now.project.clips[id]))
      now.selectCaptions(memo.captions)
      now.setTime(memo.time)
    }
  }
}

let settling = 0
/** A cancelled drag's ghost glides back to where it came from: for a moment
 *  (120 ms) the clips' offsets are animated (timeline.css, `tl-settling`). */
export function settle(): void {
  if (motionOff()) return
  document.body.classList.add('tl-settling')
  window.clearTimeout(settling)
  settling = window.setTimeout(() => document.body.classList.remove('tl-settling'), 140)
}
