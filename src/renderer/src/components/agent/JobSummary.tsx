// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent bar's "Done" opens what the job changed (KOLAY-PLAN.md, item 4):
// one small card under it — the film's length before → now, how many cuts,
// moves, additions, removals and settings (the review's own sentences,
// counted: job-summary.ts), the tokens the app sent (the bar's number), and
// "Back to before the agent" (the restore point: agent/restore.ts). It opens
// only when "Done" is pressed; it never covers the screen by itself.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BareButton, Button, notify, useT } from '../../ui'
import { placeMenu } from '../../ui/logic'
import { mmss } from '../../agent/draft-words'
import { form } from '../../agent/count'
import { restorePoints, restoreTo } from '../../agent/restore'
import { useStore } from '../../state/store'
import { tokensText } from './TokenCard'
import type { JobNow } from './useJob'
import { GROUPS, projectMetBy, summaryOf, watchCalls, type JobSummary } from './job-summary'
import './summary.css'

// (From the app's start: a job's first call must be seen as it starts.)
watchCalls()

/** The bar's "Done" sentence as a button that opens the card. */
export function JobDone({ j, sentence }: { j: JobNow; sentence: string }): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [sum, setSum] = useState<JobSummary | null>(null)
  const [canRestore, setCanRestore] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  // (Placed again when the window changes size.)
  const [view, setView] = useState(0)
  const toggle = (): void => {
    if (open) return setOpen(false)
    setSum(summaryOf(projectMetBy(j.job?.events[0]?.id), useStore.getState().project))
    setCanRestore(restorePoints().some((p) => p.kind === 'pre'))
    setOpen(true)
  }
  useLayoutEffect(() => {
    if (!open || !button.current || !card.current) return
    const r = button.current.getBoundingClientRect()
    const c = card.current.getBoundingClientRect()
    const p = placeMenu({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: c.width, h: c.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ x: p.x, y: p.y })
  }, [open, sum, view])
  // Closed by a press outside it, Escape or a scroll (as the token card).
  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const down = (e: PointerEvent): void => {
      const at = e.target as Node
      if (!card.current?.contains(at) && !button.current?.contains(at)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const scroll = (e: Event): void => {
      if (!card.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    const resized = (): void => setView((n) => n + 1)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('resize', resized)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])
  const back = async (): Promise<void> => {
    setOpen(false)
    try {
      await restoreTo()
      notify({ text: t('kolay.sum.restored') })
    } catch (err) {
      notify({ text: t('kolay.sum.restoreFailed', { why: err instanceof Error ? err.message : String(err) }), kind: 'error' })
    }
  }
  const parts = sum ? GROUPS.filter((g) => sum.counts[g] > 0).map((g) => t(`kolay.sum.${g}.${form(sum.counts[g])}`, { n: sum.counts[g] })) : []
  return (
    <>
      <BareButton ref={button} className="agent-bar-what agent-sum-btn" testid="agent.bar.what" aria-expanded={open} aria-haspopup="dialog" aria-label={`${sentence} · ${t('kolay.sum.open')}`} onClick={toggle}>
        {sentence}
      </BareButton>
      {open &&
        sum &&
        createPortal(
          <div ref={card} className="agent-sum-card" role="dialog" aria-label={t('kolay.sum.title')} data-testid="agent.summary.card" style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}>
            <div className="agent-sum-title">{t('kolay.sum.title')}</div>
            <div className="agent-sum-row" data-testid="agent.summary.length">
              <span>{t('kolay.sum.length')}</span>
              <span className="agent-sum-n">{sum.before === null ? mmss(sum.after) : t('kolay.sum.fromTo', { from: mmss(sum.before), to: mmss(sum.after) })}</span>
            </div>
            <div className="agent-sum-row" data-testid="agent.summary.changes">
              <span>{t('kolay.sum.changes')}</span>
              <span className="agent-sum-n">{sum.before === null ? t('kolay.sum.unknown') : parts.length ? parts.join(' · ') : t('kolay.sum.none')}</span>
            </div>
            <div className="agent-sum-row" data-testid="agent.summary.tokens">
              <span>{t('kolay.sum.tokens')}</span>
              <span className="agent-sum-n">{tokensText(j.totals?.tokens ?? 0, t)}</span>
            </div>
            {canRestore && (
              <div className="agent-sum-actions">
                <Button size="sm" variant="secondary" icon="undo-2" testid="agent.summary.restore" onClick={() => void back()}>
                  {t('kolay.sum.restore')}
                </Button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
