// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A tooltip (SnippStudio phase 3a.2; TASARIM.md "İpucu"): a small light bubble
// that shows 400 ms after the pointer or the keyboard reaches its control, with
// the control's shortcut. It replaces the native title attribute.
import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { placeTooltip, shortcutLabel } from './logic'

/** The tooltip's wait (TASARIM.md: 400 ms; --tooltip-delay). */
export const TOOLTIP_DELAY = 400

export interface TooltipBubbleProps {
  content: string
  /** A name said first, in the bubble's strong weight (an icon-only tool's name before what it does). */
  heading?: string
  shortcut?: string
  id?: string
  style?: CSSProperties
  testid?: string
}

/** The bubble itself (also drawn standing still on the building blocks page). */
export function TooltipBubble({ content, heading, shortcut, id, style, testid }: TooltipBubbleProps): JSX.Element {
  return (
    <div className="ui-tooltip" role="tooltip" id={id} style={style} data-testid={testid}>
      <span>
        {heading && <b className="ui-tooltip-head">{heading}</b>}
        {heading && ' '}
        {content}
      </span>
      {shortcut && <kbd className="ui-kbd">{shortcutLabel(shortcut)}</kbd>}
    </div>
  )
}

type Handler = ((e: SyntheticEvent) => void) | undefined

export interface TooltipProps {
  content: string
  /** A name said before the content (see TooltipBubble). */
  heading?: string
  shortcut?: string
  /** One element that takes pointer and focus events (a button, a field). */
  children: ReactElement
  delay?: number
  /** Say the tooltip as the control's description (off when it repeats the control's name). */
  describe?: boolean
  testid?: string
  /** 'right': beside the control, clear of the pointer and of what is under
   *  it (a side rail's items; kullanım, item 3). Default: above, else below. */
  side?: 'above' | 'right'
}

export function Tooltip({ content, heading, shortcut, children, delay = TOOLTIP_DELAY, describe = true, testid, side = 'above' }: TooltipProps): JSX.Element {
  const id = useId()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<number | null>(null)
  const bubble = useRef<HTMLDivElement | null>(null)

  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const hide = useCallback((): void => {
    cancel()
    setOpen(false)
    setPos(null)
  }, [])
  const showSoon = (el: HTMLElement): void => {
    cancel()
    setAnchor(el)
    timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  useEffect(() => () => cancel(), [])

  // Placed once it is drawn (its size is known only then).
  useLayoutEffect(() => {
    if (!open || !anchor || !bubble.current) return
    const r = anchor.getBoundingClientRect()
    const b = bubble.current.getBoundingClientRect()
    const gap = 8
    if (side === 'right' && r.right + gap + b.width <= window.innerWidth - 4) {
      setPos({ x: r.right + gap, y: Math.max(4, Math.min(window.innerHeight - 4 - b.height, r.top + r.height / 2 - b.height / 2)) })
      return
    }
    const p = placeTooltip({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: b.width, h: b.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ x: p.x, y: p.y })
  }, [open, anchor, side])

  // A scroll or a press anywhere hides it.
  useEffect(() => {
    if (!open) return
    const off = (): void => hide()
    window.addEventListener('scroll', off, true)
    window.addEventListener('pointerdown', off, true)
    return () => {
      window.removeEventListener('scroll', off, true)
      window.removeEventListener('pointerdown', off, true)
    }
  }, [open, hide])

  const p = children.props as Record<string, Handler>
  const chain = (own: Handler, mine: (e: SyntheticEvent) => void) => (e: SyntheticEvent) => {
    own?.(e)
    mine(e)
  }
  const child = cloneElement(children, {
    onPointerEnter: chain(p.onPointerEnter, (e) => showSoon(e.currentTarget as HTMLElement)),
    onPointerLeave: chain(p.onPointerLeave, hide),
    onFocus: chain(p.onFocus, (e) => {
      const el = e.currentTarget as HTMLElement
      // Only the keyboard's focus (a click's focus already has the pointer's tooltip).
      if (el.matches(':focus-visible')) showSoon(el)
    }),
    onBlur: chain(p.onBlur, hide),
    onKeyDown: chain(p.onKeyDown, (e) => {
      if ((e as unknown as KeyboardEvent).key === 'Escape' && open) hide()
    }),
    'aria-describedby': describe && open ? id : (children.props as { 'aria-describedby'?: string })['aria-describedby']
  })

  return (
    <>
      {child}
      {open &&
        createPortal(
          <div ref={bubble} className="ui-tooltip-layer" style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}>
            <TooltipBubble content={content} heading={heading} shortcut={shortcut} id={id} testid={testid} />
          </div>,
          document.body
        )}
    </>
  )
}
