// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { Component, useEffect, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { saveProject, writeRecovery } from '../media/projectio'
import { api } from '../platform'
import { useStore } from '../state/store'
import { failureText, rateGate } from '../ui/crash-guard'
import { Button, t, useT } from '../ui'

/**
 * Crash containment. Without a boundary, one exception while rendering any
 * panel unmounted the whole React root: the window went blank, the autosave
 * and recovery timers (App effects) stopped, and the in-app quit dialog was
 * gone — while the project itself was still intact in the store. Now a failed
 * panel shows a small box in its place and the rest keeps working; a failure
 * outside every panel shows a whole-window box that can still save.
 */

/** A burst of failures (several panels on the same bad state) writes once. */
const catchGate = rateGate(5_000)

/**
 * Writes a recovery snapshot of the project as it is now, if the platform can
 * (Electron's recovery file; a plain browser has none). Best-effort, logged.
 * Unconditional on purpose (no dirty / empty gate): it is the copy the next
 * launch offers after a hard crash.
 */
export function snapshotForRecovery(reason: string, gate: (now: number) => boolean = catchGate): void {
  if (!gate(Date.now())) return
  if (!api?.recoveryWrite) {
    console.warn(`[snipp] ${reason}: no recovery file on this platform, nothing written`)
    return
  }
  void writeRecovery(useStore.getState().project).then(() => console.info(`[snipp] ${reason}: recovery snapshot written`))
}

interface Props {
  /** What the panel is called, in its box and in the log. */
  name: string
  /** 'panel': a box in the panel's own place. 'overlay': a box over
   *  everything (for a full-window panel). 'app':
   *  the whole-window fallback, which can still save the project. */
  variant?: 'panel' | 'overlay' | 'app'
  /** A second way out beside Reload (e.g. back to the editor). */
  leave?: { label: string; run: () => void }
  children?: ReactNode
}

interface State {
  error: unknown
  failed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[snipp] the ${this.props.name} panel failed:`, error, info.componentStack)
    snapshotForRecovery(`the ${this.props.name} panel failed`)
  }

  private reload = (): void => this.setState({ error: null, failed: false })

  render(): ReactNode {
    if (!this.state.failed) return this.props.children ?? null
    const message = failureText(this.state.error)
    if (this.props.variant === 'app') return <AppFallback message={message} onRetry={this.reload} />
    const overlay = this.props.variant === 'overlay'
    return (
      <div role="alert" style={overlay ? OVERLAY_STYLE : PANEL_STYLE}>
        <div style={overlay ? OVERLAY_BOX_STYLE : BOX_STYLE}>
          <strong style={{ color: 'var(--text)' }}>{t('crash.panel', { name: this.props.name })}</strong>
          <span style={MESSAGE_STYLE} title={message}>{message}</span>
          <span>{t('crash.panel.safe')}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="primary" icon="rotate-cw" onClick={this.reload}>
              {t('crash.reload')}
            </Button>
            {this.props.leave && (
              <Button
                variant="secondary"
                onClick={() => {
                  this.reload()
                  this.props.leave?.run()
                }}
              >
                {this.props.leave.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }
}

/**
 * The whole window, when the editor itself failed. The project is still in
 * the store, so this can save it, and it answers the close-with-unsaved-work
 * question the editor would have asked (the editor's own listener died with
 * it, and the window would otherwise only close through the system box).
 */
function AppFallback({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  useT()
  const [status, setStatus] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    // The bridge has no way to remove a listener: this one stays and simply
    // stops answering once the editor is back.
    api?.onConfirmQuit(() => {
      if (live.current) setAsking(true)
    })
    return () => {
      live.current = false
    }
  }, [])

  const save = async (): Promise<boolean> => {
    try {
      const saved = await saveProject(useStore.getState().project, { quick: true })
      if (saved) {
        useStore.getState().setDirty(false)
        // The editor's dirty watcher is gone too: tell the window directly.
        api?.setDirty(false)
        setStatus(t('crash.saved'))
      }
      return saved
    } catch (err) {
      setStatus(t('crash.saveFailed', { error: failureText(err) }))
      return false
    }
  }

  return (
    <div role="alert" style={APP_STYLE}>
      <div style={OVERLAY_BOX_STYLE}>
        <strong style={{ color: 'var(--text)', fontSize: 15 }}>{t('crash.app')}</strong>
        <span style={MESSAGE_STYLE} title={message}>{message}</span>
        <span>{t('crash.app.safe')}</span>
        {asking ? (
          <>
            <span style={{ color: 'var(--text)' }}>{t('crash.askQuit')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button
                variant="primary"
                icon="save"
                onClick={() => {
                  setAsking(false)
                  void save().then((saved) => {
                    if (saved) api?.confirmQuit()
                  })
                }}
              >
                {t('crash.saveQuit')}
              </Button>
              <Button variant="danger" onClick={() => api?.confirmQuit()}>
                {t('crash.quitNoSave')}
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t('crash.cancel')}
              </Button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Button variant="primary" icon="save" onClick={() => void save()}>
              {t('crash.save')}
            </Button>
            <Button variant="secondary" icon="rotate-cw" onClick={onRetry}>
              {t('crash.retry')}
            </Button>
          </div>
        )}
        {status && <span>{status}</span>}
      </div>
    </div>
  )
}

const BOX_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  maxWidth: 360,
  textAlign: 'center'
}

const PANEL_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--bg-panel)',
  border: '1px solid var(--line)',
  color: 'var(--text-2)',
  fontSize: 12
}

const OVERLAY_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 'var(--z-dialog)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--scrim)',
  color: 'var(--text-2)',
  fontSize: 12
}

const APP_STYLE: CSSProperties = { ...OVERLAY_STYLE, background: 'var(--bg-app)' }

const OVERLAY_BOX_STYLE: CSSProperties = {
  ...BOX_STYLE,
  gap: 8,
  maxWidth: 420,
  padding: 18,
  background: 'var(--bg-raised)',
  border: '1px solid var(--line)',
  borderRadius: 8
}

const MESSAGE_STYLE: CSSProperties = {
  fontFamily: 'monospace',
  color: 'var(--danger)',
  overflowWrap: 'anywhere'
}
