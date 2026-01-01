// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { api } from '../platform'
import { fmtLeft } from '../export/job'
import { fpsLabel } from '../timeline/rates'
import { fmtClock, framesDone, isStale, parseRenderStatus, renderEta, sortRenders, type RenderStatus } from '../export/renders'
import { Button, Tooltip, localizeMessage, useT } from '../ui'
import { EmptyState } from './EmptyState'
import { requestShell } from './app/requests'

/** Read again this often even without a word from the folder watcher. */
const POLL_MS = 5_000

/** Every export's status file (cikti\.renders), kept fresh: the watcher's word, and a slow poll. */
function useRenders(): { list: RenderStatus[]; dir: string; now: number; reload: () => void } {
  const [list, setList] = useState<RenderStatus[]>([])
  const [dir, setDir] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const busy = useRef(false)
  const again = useRef(false)
  const reload = (): void => {
    const bridge = api?.renders
    if (!bridge) return
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    void bridge
      .list()
      .then((r) => {
        setDir(r.dir)
        setList(r.files.map(parseRenderStatus).filter((s): s is RenderStatus => !!s))
        setNow(Date.now())
      })
      .catch(() => {})
      .finally(() => {
        busy.current = false
        if (again.current) {
          again.current = false
          reload()
        }
      })
  }
  useEffect(() => {
    const bridge = api?.renders
    if (!bridge) return
    reload()
    const off = bridge.onChanged(reload)
    const poll = window.setInterval(reload, POLL_MS)
    return () => {
      off()
      window.clearInterval(poll)
    }
  }, [])
  // A second's tick while something runs (the time left counts down between writes).
  const running = list.some((s) => s.state === 'running')
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])
  return { list, dir, now, reload }
}

const fmtInt = (n: number): string => n.toLocaleString('en-US')

/** One export in the list. */
function RenderRow({ s, now, onChanged }: { s: RenderStatus; now: number; onChanged: () => void }): JSX.Element {
  const t = useT()
  const [cancelling, setCancelling] = useState(false)
  const stale = isStale(s, now)
  const live = s.state === 'running' && !stale
  const pct = Math.max(0, Math.min(100, Math.floor(s.progress * 100)))
  const eta = live ? renderEta(s.samples, s.frames, now) : null
  const bridge = api?.renders
  const state = stale ? 'stale' : s.state
  const head =
    state === 'stale'
      ? t('renders.state.stale')
      : state === 'running'
        ? t('ui.percent', { n: pct })
        : state === 'done'
          ? t('renders.state.done')
          : state === 'cancelled'
            ? t('renders.state.cancelled')
            : t('renders.state.failed')
  const took = s.endedAt ? fmtLeft((s.endedAt - s.startedAt) / 1000) : null
  return (
    <div className={`rp-row ${state}`}>
      <div className="rp-row-head">
        <span className="rp-name" title={s.output ?? s.name}>
          {s.name}
        </span>
        <span className="rp-source" title={s.source === 'script' ? t('renders.source.script.hint') : t('renders.source.snipp.hint')}>
          {s.source === 'script' ? t('renders.source.script') : t('renders.source.snipp')}
        </span>
        <span className="rp-state">{head}</span>
      </div>
      <div className="rp-bar" aria-hidden="true">
        <div style={{ width: `${state === 'done' ? 100 : pct}%` }} />
      </div>
      {live && <div className="rp-step">{s.label}</div>}
      {live && (
        <div className="rp-eta">
          {eta ? (
            <>
              <b>{t('renders.left', { t: fmtLeft(eta.left) })}</b>
              <span>{t('renders.doneAbout', { at: fmtClock(eta.finishAt, now) })}</span>
            </>
          ) : (
            <span>{t('renders.working')}</span>
          )}
        </div>
      )}
      {stale && <div className="rp-note">{t('renders.staleNote', { at: fmtClock(s.updatedAt, now) })}</div>}
      {s.error && <div className="rp-error">{localizeMessage(s.error)}</div>}
      <div className="rp-facts">
        {s.frames > 0 && (
          <span className="ep-fact" title={t('renders.frames.hint')}>
            {live ? t('renders.framesOf', { n: fmtInt(framesDone(s)), of: fmtInt(s.frames) }) : t('renders.frames', { n: fmtInt(s.frames) })}
          </span>
        )}
        {s.fps > 0 && <span className="ep-fact">{t('renders.fps', { fps: fpsLabel(s.fps) })}</span>}
        {s.frames > 0 && (
          <span className="ep-fact" title={t('renders.lanes.hint')}>
            {t(s.workers === 1 ? 'renders.lanes.one' : 'renders.lanes.many', { n: s.workers })}
          </span>
        )}
        {eta && eta.speed > 0 && (
          <span className="ep-fact" title={t('renders.speed.hint')}>
            {t('renders.speed', { n: eta.speed >= 10 ? Math.round(eta.speed) : eta.speed.toFixed(1) })}
          </span>
        )}
        <span className="ep-fact">{t('renders.started', { at: fmtClock(s.startedAt, now) })}</span>
        {took && s.state === 'done' && <span className="ep-fact">{t('renders.took', { t: took })}</span>}
      </div>
      {bridge && (
        <div className="rp-actions">
          {live && (
            <Tooltip content={t('renders.cancel.hint')}>
              <Button variant="danger" size="sm" icon={cancelling ? undefined : 'x'} disabled={cancelling} onClick={() => void bridge.cancel(s.id).then((ok) => setCancelling(ok))}>
                {cancelling ? t('renders.cancelling') : t('renders.cancel')}
              </Button>
            </Tooltip>
          )}
          {s.state === 'done' && s.output && (
            <>
              <Tooltip content={t('renders.open.hint', { file: s.output })}>
                <Button variant="secondary" size="sm" icon="play" onClick={() => void bridge.open(s.id)}>
                  {t('renders.open')}
                </Button>
              </Tooltip>
              <Tooltip content={t('renders.folder.hint')}>
                <Button variant="secondary" size="sm" icon="folder-open" onClick={() => void bridge.reveal(s.id)}>
                  {t('renders.folder')}
                </Button>
              </Tooltip>
            </>
          )}
          {!live && (
            <Tooltip content={t('renders.remove.hint')}>
              <Button variant="ghost" size="sm" onClick={() => void bridge.remove(s.id).then(onChanged)}>
                {t('renders.remove')}
              </Button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The Renders panel: every export running or finished, whether it was started
 * from Snipp's export window or by another program (in this Snipp or
 * another). Each with its bar, the time left and the finish time from the
 * last few minutes' speed, Cancel, and Open video at the end.
 */
export function RendersButton(): JSX.Element | null {
  const t = useT()
  const { list, dir, now, reload } = useRenders()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!api?.renders) return null
  const sorted = sortRenders(list, now)
  const live = sorted.filter((s) => s.state === 'running' && !isStale(s, now))
  // The button's own line: the first running job's time left.
  const first = live[0] ? renderEta(live[0].samples, live[0].frames, now) : null
  return (
    <div ref={ref} className="renders-menu">
      <Tooltip content={live.length ? t(live.length === 1 ? 'renders.running.one' : 'renders.running.many', { n: live.length }) : t('renders.hint')}>
        <Button variant="ghost" className={`renders-btn${live.length ? ' busy' : ''}`} pressed={open ? true : undefined} onClick={() => setOpen(!open)} aria-expanded={open} testid="topbar.renders">
          {t('renders.title')}
          {live.length > 0 && <span className="renders-badge">{live.length}</span>}
          {first && <span className="renders-left">{fmtLeft(first.left)}</span>}
        </Button>
      </Tooltip>
      {open && (
        <div className="renders-panel" role="dialog" aria-label={t('renders.title')}>
          <div className="rp-title">
            <span>{t('renders.title')}</span>
            <small title={dir}>{live.length ? t('renders.runningCount', { n: live.length }) : t('renders.nothingRunning')}</small>
          </div>
          {sorted.length === 0 ? (
            <EmptyState className="rp-empty" text={t('renders.empty')} action={t('empty.renders.action')} icon="download" onAction={() => { setOpen(false); requestShell('export') }} testid="renders.empty" />
          ) : (
            <div className="rp-list">
              {sorted.map((s) => (
                <RenderRow key={s.id} s={s} now={now} onChanged={reload} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
