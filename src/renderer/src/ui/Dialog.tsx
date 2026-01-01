// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The dialog shell (SnippStudio phase 3a.2): a title with its close button,
// the content, the actions at the bottom right. Modal: the focus moves in when
// it opens, Tab and Shift+Tab stay inside, Escape closes, and the focus goes
// back where it was. What goes inside is the caller's.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from './Button'
import { trapIndex } from './logic'
import { useT } from './strings'

export interface DialogProps {
  open: boolean
  title: string
  onClose: () => void
  children?: ReactNode
  /** Buttons at the bottom right (the main one last). */
  actions?: ReactNode
  /** 'sm' 360, 'md' 480, 'lg' 640 pixels wide. */
  width?: 'sm' | 'md' | 'lg'
  /** A press on the dim backdrop closes it (on by default). */
  closeOnBackdrop?: boolean
  /** Drawn in place, not over the window (the building blocks page shows it so). */
  inline?: boolean
  testid?: string
  /** data-testid of the close button when it is not <testid>.close (phase
   *  3c.4: a window moved onto the dialog keeps its old close button's name). */
  closeTestid?: string
  /** One more class on the box (a window wider than 'lg' sets its own width). */
  className?: string
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A modal box's keyboard manners, for the Dialog and for a window that draws
 * its own box (the Projects window, audit E6): while `open`, the focus moves in
 * (the [data-autofocus] element, else the first control outside the head
 * `skip` names), Tab and Shift+Tab stay inside, and the focus goes back where
 * it was when it closes. Returns the box's Tab handler.
 */
export function useModalFocus(box: RefObject<HTMLElement | null>, open: boolean, skip = '.ui-dialog-head'): (e: KeyboardEvent) => void {
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const el = box.current
    if (el) {
      const all = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const pick = el.querySelector<HTMLElement>('[data-autofocus]') ?? all.find((x) => !x.closest(skip)) ?? all[0] ?? el
      pick.focus()
    }
    return () => {
      if (before && document.contains(before)) before.focus()
    }
  }, [open])
  return (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !box.current) return
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0)
    if (!all.length) return
    e.preventDefault()
    const next = trapIndex(all.indexOf(document.activeElement as HTMLElement), all.length, e.shiftKey)
    all[next]?.focus()
  }
}

export function Dialog({ open, title, onClose, children, actions, width = 'md', closeOnBackdrop = true, inline, testid, closeTestid, className }: DialogProps): JSX.Element | null {
  const t = useT()
  const titleId = useId()
  const box = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const trap = useModalFocus(box, open && !inline)

  if (!open) return null

  const onKey = (e: KeyboardEvent): void => {
    if (inline) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
      return
    }
    trap(e)
  }

  const dialog = (
    <div
      ref={box}
      className={`ui-dialog ui-dialog-${width}${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testid}
      onKeyDown={onKey}
    >
      <div className="ui-dialog-head">
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
        <IconButton icon="x" label={t('ui.dialog.close')} variant="ghost" size="sm" tooltip={false} testid={closeTestid ?? (testid ? `${testid}.close` : undefined)} onClick={() => closeRef.current()} />
      </div>
      {children != null && <div className="ui-dialog-body">{children}</div>}
      {actions != null && <div className="ui-dialog-actions">{actions}</div>}
    </div>
  )
  if (inline) return dialog
  return createPortal(
    <div
      className="ui-dialog-backdrop"
      onPointerDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) closeRef.current()
      }}
    >
      {dialog}
    </div>,
    document.body
  )
}
