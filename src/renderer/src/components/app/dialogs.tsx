// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The editor's own dialogs and small parts: missing media, the app's message
// box (AskDialog), the Shorts explainer and the panel splitter. Moved out of
// App.tsx in SnippStudio phase 2B (no change); onto the building blocks (ui/Dialog, Button, Icon,
// t()) in phase 3c.4.
import { useRef, useState, useSyncExternalStore } from 'react'
import { answerConfirm, currentConfirm, subscribeConfirm } from '../../ui/confirm'
import { relinkAndTell } from '../../media/relink-ui'
import { api } from '../../platform'
import { useStore } from '../../state/store'
import { Button, Chip, Dialog, Icon, Tooltip, useT, type IconName } from '../../ui'

/**
 * Shown when a project opens with media that isn't where it was left.
 *
 * The old behaviour was a toast listing the names, which scrolled away and left
 * you with clips that render nothing and no obvious way to fix them. Relinking
 * one file at a time from the media bin worked but you had to know it was
 * there. This puts the list in front of you and points each one at the file
 * picker; the clips, cuts and effects built on those assets are untouched
 * either way — only the path is missing.
 */
export function MissingMediaDialog({ onClose }: { onClose: () => void }): JSX.Element | null {
  const t = useT()
  const missing = useStore((s) => s.project.assets).filter((a) => a.missing)
  if (missing.length === 0) return null

  const relink = async (assetId: string): Promise<void> => {
    if (!api) return
    const files = await api.openMediaDialog()
    const f = files[0]
    if (!f) return
    // The file is read first (phase Ç2a.2, P7): media/relink-ui.ts.
    await relinkAndTell(assetId, f)
  }

  return (
    <Dialog
      open
      title={t(missing.length === 1 ? 'win.missing.one' : 'win.missing.many', { n: missing.length })}
      onClose={onClose}
      width="md"
      testid="dialog.missing-media"
      actions={
        <Button variant="primary" testid="missing-media.done" onClick={onClose}>
          {t('win.done')}
        </Button>
      }
    >
      <div className="ask-head">
        <span className="ask-icon is-warn">
          <Icon name="link" size={16} />
        </span>
        <p className="ask-sub">{t('win.missing.why')}</p>
      </div>
      <div className="relink-list">
        {missing.map((a) => (
          <div key={a.id} className="relink-row">
            <Tooltip content={a.path ?? a.name}>
              <span className="relink-name">{a.name}</span>
            </Tooltip>
            <Button size="sm" testid={`missing-media.locate.${a.id}`} aria-label={t('win.missing.locateOf', { name: a.name })} onClick={() => void relink(a.id)}>
              {t('win.missing.locate')}
            </Button>
          </div>
        ))}
      </div>
      <p className="ask-note">{t('win.missing.later')}</p>
    </Dialog>
  )
}

/** One button of the app's message box. */
export interface AskAction {
  label: string
  onClick: () => void
  /** The main one (at most one, drawn last) or a destructive one. */
  kind?: 'primary' | 'danger'
  icon?: IconName
  testid?: string
}

/**
 * The app's own message box. Used for the two questions that used to be OS
 * dialogs — quitting with unsaved work, and recovering after a crash — so they
 * look like part of the editor instead of a white system slab titled with the
 * executable name. Phase 3c.4: the building blocks' Dialog (its focus trap,
 * Escape and backdrop close it the way the old box did); the main action is
 * drawn last, at the right (the Dialog's rule).
 */
export function AskDialog({
  icon,
  title,
  message,
  facts,
  note,
  tone = 'accent',
  actions,
  onDismiss,
  testid
}: {
  icon: IconName
  title: string
  message: string
  facts?: { label: string; value: string }[]
  note?: string
  tone?: 'accent' | 'warn'
  actions: AskAction[]
  onDismiss: () => void
  /** Test name (data-testid) of the box; each action's is <testid>.<action testid>. */
  testid?: string
}): JSX.Element {
  // The main action last (the Dialog's order); the rest keep theirs.
  const ordered = [...actions.filter((a) => a.kind !== 'primary'), ...actions.filter((a) => a.kind === 'primary')]
  return (
    <Dialog
      open
      title={title}
      onClose={onDismiss}
      width="md"
      testid={testid}
      actions={ordered.map((a) => (
        <Button
          key={a.label}
          variant={a.kind ?? 'secondary'}
          icon={a.icon}
          testid={testid && a.testid ? `${testid}.${a.testid}` : undefined}
          onClick={a.onClick}
        >
          {a.label}
        </Button>
      ))}
    >
      <div className="ask-head">
        <span className={tone === 'warn' ? 'ask-icon is-warn' : 'ask-icon'}>
          <Icon name={icon} size={16} />
        </span>
        <p className="ask-sub">{message}</p>
      </div>
      {facts && facts.length > 0 && (
        <div className="ask-facts">
          {facts.map((f) => (
            <Chip key={f.label}>
              {f.label} <strong>{f.value}</strong>
            </Chip>
          ))}
        </div>
      )}
      {note && <p className="ask-note">{note}</p>}
    </Dialog>
  )
}

/** The box of confirmDialog() (ui/confirm.ts, audit G9): the first question
 *  asked, in the app's message box; the main button last, at the right. */
export function ConfirmHost(): JSX.Element | null {
  const t = useT()
  const q = useSyncExternalStore(subscribeConfirm, currentConfirm, currentConfirm)
  if (!q) return null
  const o = q.options
  const no = (): void => answerConfirm(q.id, false)
  const actions: AskAction[] = [
    ...(o.cancel === null ? [] : [{ label: o.cancel ?? t('win.cancel'), testid: 'cancel', onClick: no }]),
    { label: o.confirm, testid: 'ok', kind: o.danger ? 'danger' : 'primary', onClick: () => answerConfirm(q.id, true) }
  ]
  return (
    <AskDialog
      key={q.id}
      icon={o.icon ?? (o.danger ? 'trash' : 'circle-question-mark')}
      tone={o.danger ? 'warn' : 'accent'}
      title={o.title}
      message={o.message}
      note={o.note}
      actions={actions}
      onDismiss={no}
      testid="ask.confirm"
    />
  )
}

/** One-time explainer shown when entering Shorts mode. */
export function ModeHelp(): JSX.Element | null {
  const t = useT()
  const mode = useStore((s) => s.project.mode)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('autocut-mode-help') ?? '{}')
    } catch {
      return {}
    }
  })
  if (mode === 'frame' || dismissed[mode]) return null
  const dismiss = () => {
    const next = { ...dismissed, [mode]: true }
    localStorage.setItem('autocut-mode-help', JSON.stringify(next))
    setDismissed(next)
  }
  // The keyframes' words are bold inside the sentence, wherever the language puts them.
  const [before, after = ''] = t('win.mode.pan').split('{kf}')
  return (
    <div className="mode-help" data-testid="mode-help">
      <h3 className="mode-help-title">
        <Icon name="smartphone" size={16} />
        <span>{t('win.mode.title')}</span>
      </h3>
      <p>{t('win.mode.window')}</p>
      <p>
        {before}
        <b>{t('win.mode.panKf')}</b>
        {after}
      </p>
      <Button variant="primary" testid="mode-help.dismiss" onClick={dismiss}>
        {t('win.mode.ok')}
      </Button>
    </div>
  )
}

/** Draggable divider between panels. */
export function Splitter({
  dir,
  onDrag,
  testid,
  onReset,
  keyStep,
  label,
  value
}: {
  dir: 'v' | 'h'
  onDrag: (delta: number) => void
  /** Test name (data-testid) for the end-to-end tests. */
  testid?: string
  /** A double click puts the panel back to its default size (phase 3c.Y). */
  onReset?: () => void
  /** Given, the splitter takes the focus and the arrow keys move it this many
   *  pixels (Up / Left: the same way as a drag up / left). */
  keyStep?: number
  /** Its name for a screen reader (with keyStep). */
  label?: string
  /** The size it holds now, said to a screen reader. */
  value?: number
}): JSX.Element {
  const last = useRef(0)
  const keyed = keyStep !== undefined
  return (
    <div
      className={`splitter ${dir}`}
      data-testid={testid}
      role={keyed ? 'separator' : undefined}
      aria-orientation={keyed ? (dir === 'h' ? 'horizontal' : 'vertical') : undefined}
      aria-label={keyed ? label : undefined}
      aria-valuenow={keyed && value !== undefined ? Math.round(value) : undefined}
      tabIndex={keyed ? 0 : undefined}
      onDoubleClick={onReset}
      onKeyDown={
        keyed
          ? (e) => {
              const back = dir === 'h' ? 'ArrowUp' : 'ArrowLeft'
              const fwd = dir === 'h' ? 'ArrowDown' : 'ArrowRight'
              if (e.key !== back && e.key !== fwd) return
              e.preventDefault()
              e.stopPropagation()
              onDrag(e.key === back ? -keyStep : keyStep)
            }
          : undefined
      }
      onPointerDown={(e) => {
        last.current = dir === 'v' ? e.clientX : e.clientY
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return
        const pos = dir === 'v' ? e.clientX : e.clientY
        onDrag(pos - last.current)
        last.current = pos
      }}
    />
  )
}
