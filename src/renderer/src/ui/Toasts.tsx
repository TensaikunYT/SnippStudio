// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Toasts (SnippStudio phase 3a.2; TASARIM.md "Bildirim"): bottom centre,
// stacked, newest at the bottom, each with an optional action ("Undo") and a
// close button. notify() from anywhere; <ToastStack /> is mounted once (App).
// Since phase 3c.4b it is the only toast: the shell's own single toast and
// the old panels' toast() (ui/toast.ts) come here too.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton } from './Button'
import { Icon } from './Icon'
import type { ToastItem } from './logic'
import { useT } from './strings'
import { localizeMessage } from './errors'

import { clearToasts, currentToasts, dismissToast, notify, snapshot, subscribe, type NotifyOptions } from './toast-core'
export { clearToasts, currentToasts, dismissToast, notify, type NotifyOptions }

export interface ToastViewProps {
  toast: Pick<ToastItem, 'text' | 'kind' | 'action'>
  onDismiss?: () => void
  /** Pauses its timer while the pointer or the focus is on it. */
  onHold?: (held: boolean) => void
  testid?: string
}

/** One toast (also drawn standing still on the building blocks page). */
export function ToastView({ toast, onDismiss, onHold, testid }: ToastViewProps): JSX.Element {
  const t = useT()
  return (
    <div
      className={toast.kind === 'error' ? 'ui-toast is-error' : 'ui-toast'}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      data-testid={testid}
      onPointerEnter={() => onHold?.(true)}
      onPointerLeave={() => onHold?.(false)}
      onFocus={() => onHold?.(true)}
      onBlur={() => onHold?.(false)}
    >
      {toast.kind === 'error' && <Icon name="triangle-exclamation-point" size={16} className="ui-toast-icon" />}
      {/* Engine and main-process messages in the interface's language (phase 9b). */}
      <span className="ui-toast-text">{localizeMessage(toast.text)}</span>
      {toast.action && (
        <Button
          size="sm"
          testid={testid ? `${testid}.action` : undefined}
          onClick={() => {
            toast.action!.run()
            onDismiss?.()
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton icon="x" label={t('ui.toast.dismiss')} variant="ghost" size="sm" tooltip={false} testid={testid ? `${testid}.dismiss` : undefined} onClick={() => onDismiss?.()} />
    </div>
  )
}

/** A live toast: closes itself after its time, unless held. */
function LiveToast({ toast }: { toast: ToastItem }): JSX.Element {
  const timer = useRef<number | null>(null)
  const start = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = toast.timeout > 0 ? window.setTimeout(() => dismissToast(toast.id), toast.timeout) : null
  }
  const stop = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => {
    start()
    return stop
    // A toast's timer starts once.
    // (toast is the same object for its whole life)
  }, [toast])
  return <ToastView toast={toast} testid={`toast.${toast.id}`} onDismiss={() => dismissToast(toast.id)} onHold={(held) => (held ? stop() : start())} />
}

/** Where the toasts are drawn: mount once. */
export function ToastStack(): JSX.Element {
  const t = useT()
  const list = useSyncExternalStore(subscribe, snapshot, snapshot)
  return createPortal(
    <div className="ui-toasts" role="region" aria-label={t('ui.toast.region')} aria-live="polite" data-testid="toast.stack">
      {list.map((x) => (
        <LiveToast key={x.id} toast={x} />
      ))}
    </div>,
    document.body
  )
}
