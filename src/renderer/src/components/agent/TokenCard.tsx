// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent bar's "≈ N tokens", honestly (TOKEN-PLAN.md; YOL-HARITASI.md
// 1.3): pressed, a small card says what the number is made of — the tool
// definitions (once), the answers' text and their frames, the total — and,
// when every answer of the job was measured, how much bigger the same
// answers would have been raw. Its last line: this is what the app sent;
// the agent's own thinking and writing are not in it. Nothing of it is
// asked of the agent.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BareButton, getLang, useT, type StringKey } from '../../ui'
import { placeMenu } from '../../ui/logic'
import { savedPercent, type TokenParts } from '../../agent/activity'
import { roundedTo } from '../../agent/crew'
import { PRODUCT_NAME } from '../../../../shared/product'

/** The team mode (EKIP-PLAN.md): one row per worker, its answers' tokens
 *  (their sum is the card's text + frames: the total does not change). */
export interface WorkerTokens {
  as: string
  name: string
  colour: string
  tokens: number
}

type T = (key: StringKey, params?: Record<string, string | number>) => string

/** A whole number in groups of three ("3 300" in Turkish, "3,300"). By
 *  hand: the same on every machine, whatever its ICU data holds. (Turkish
 *  takes a narrow space: t() would read "3.300" as a decimal and write it
 *  "3,300" — ui/strings.ts localParams.) */
export const whole = (n: number): string => {
  const sep = getLang() === 'tr' ? ' ' : ','
  return (n < 0 ? '−' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/** "≈ 870 tokens", "≈ 3.2k tokens". */
export function tokensText(n: number, t: T): string {
  return n < 1000 ? t('d22c.bar.tokens', { n: Math.round(n) }) : t('d22c.bar.tokensK', { n: (n / 1000).toFixed(1).replace('.', getLang() === 'tr' ? ',' : '.') })
}

function Row({ label, n, testid, strong }: { label: string; n: string; testid: string; strong?: boolean }): JSX.Element {
  return (
    <div className={`agent-tok-row${strong ? ' is-total' : ''}`} data-testid={testid}>
      <span className="agent-tok-label">{label}</span>
      <span className="agent-tok-n">{n}</span>
    </div>
  )
}

export function TokenCardBody({ parts, workers }: { parts: TokenParts; workers?: readonly WorkerTokens[] }): JSX.Element {
  const t = useT()
  const saved = savedPercent(parts)
  const each = workers?.length ? roundedTo(workers.map((w) => w.tokens), parts.text + parts.images) : []
  return (
    <>
      <div className="agent-tok-title">{t('token.card.title')}</div>
      {parts.defs > 0 && <Row label={t('token.card.defs')} n={t('token.n', { n: whole(parts.defs) })} testid="agent.tokens.defs" />}
      <Row label={t('token.card.text')} n={t('token.n', { n: whole(parts.text) })} testid="agent.tokens.text" />
      <Row label={t('token.card.images')} n={t('token.n', { n: whole(parts.images) })} testid="agent.tokens.images" />
      <Row label={t('token.card.total')} n={t('token.n', { n: whole(parts.total) })} testid="agent.tokens.total" strong />
      {parts.raw !== null && (
        <div className="agent-tok-row" data-testid="agent.tokens.raw" data-saved={saved ?? 0}>
          <span className="agent-tok-label">{t('token.card.raw')}</span>
          <span className="agent-tok-n">{saved !== null ? `${t('token.saved', { n: saved })} · ${t('token.card.rawWas', { n: whole(parts.raw) })}` : t('token.card.rawSame')}</span>
        </div>
      )}
      {workers && workers.length > 0 && (
        <div className="agent-tok-crew" data-testid="agent.tokens.crew">
          <div className="agent-tok-title">{t('ekip.tokens.byWorker')}</div>
          {workers.map((w, i) => (
            <div key={w.as} className="agent-tok-row" data-testid="agent.tokens.worker" data-worker={w.as}>
              <span className="agent-tok-label">
                <span className="agent-crew-dot" style={{ background: w.colour }} aria-hidden="true" />
                <span>{w.name}</span>
              </span>
              <span className="agent-tok-n">{t('token.n', { n: whole(each[i]) })}</span>
            </div>
          ))}
        </div>
      )}
      <div className="agent-tok-note">{t('token.card.note', { app: PRODUCT_NAME })}</div>
    </>
  )
}

/** How long the pointer rests on the number before the card opens, and how
 *  long it may be off the number and the card before a hovered card goes. */
const HOVER_OPEN_MS = 250
const HOVER_CLOSE_MS = 200

/** The bar's token number: a button that opens the card under it. The
 *  pointer resting on it opens the card too (cila3, 2c); a press pins it
 *  (then only a press outside, Escape or a scroll closes it). */
export function TokenButton({ parts, total, workers }: { parts: TokenParts | null; total: number; workers?: readonly WorkerTokens[] }): JSX.Element {
  const t = useT()
  const [mode, setMode] = useState<'hover' | 'pinned' | null>(null)
  const open = mode !== null
  const setOpen = (on: boolean): void => setMode(on ? 'pinned' : null)
  const timer = useRef<number | null>(null)
  const clearTimer = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clearTimer, [])
  const hoverIn = (): void => {
    clearTimer()
    if (mode === null) timer.current = window.setTimeout(() => setMode((m) => m ?? 'hover'), HOVER_OPEN_MS)
  }
  const hoverOut = (): void => {
    clearTimer()
    timer.current = window.setTimeout(() => setMode((m) => (m === 'hover' ? null : m)), HOVER_CLOSE_MS)
  }
  const button = useRef<HTMLButtonElement | null>(null)
  const card = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (!open || !button.current || !card.current) return
    const r = button.current.getBoundingClientRect()
    const c = card.current.getBoundingClientRect()
    const p = placeMenu({ x: r.left, y: r.top, w: r.width, h: r.height }, { w: c.width, h: c.height }, { w: window.innerWidth, h: window.innerHeight })
    setPos({ x: p.x, y: p.y })
  }, [open, parts])
  // Closed by a press outside it, Escape, or a scroll.
  useEffect(() => {
    if (!open) return
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
    window.addEventListener('scroll', scroll, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])
  useEffect(() => {
    if (!open) setPos(null)
  }, [open])
  return (
    <>
      <BareButton
        ref={button}
        className="agent-bar-num agent-tok-btn"
        testid="agent.bar.tokens"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${tokensText(total, t)} · ${t('token.open')}`}
        data-open={mode ?? undefined}
        onPointerEnter={(e) => e.pointerType === 'mouse' && hoverIn()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hoverOut()}
        onClick={() => {
          clearTimer()
          setMode((m) => (m === 'pinned' ? null : 'pinned'))
        }}
      >
        {tokensText(total, t)}
      </BareButton>
      {open &&
        parts &&
        createPortal(
          <div ref={card} className="agent-tok-card" role="dialog" aria-label={t('token.card.title')} data-testid="agent.tokens.card" data-mode={mode ?? undefined} onPointerEnter={() => mode === 'hover' && clearTimer()} onPointerLeave={() => mode === 'hover' && hoverOut()} style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}>
            <TokenCardBody parts={parts} workers={workers} />
          </div>,
          document.body
        )}
    </>
  )
}
