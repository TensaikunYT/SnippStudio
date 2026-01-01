// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { api } from '../platform'
import { useStore } from '../state/store'
import { cancelExportJob, etaFromSamples, exportJobRunning, fmtLeft, type ExportKind } from '../export/job'
import { fmtClock } from '../export/renders'
import { Button, Icon, Tooltip, localizeMessage, useT, type IconName, type StringKey } from '../ui'

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1e3))} KB`
}

/** Each kind of export: what it says while it runs and when it is done, its icon
 *  (phase 3c.4: the words of export/job.ts's EXPORT_TITLES in t(), Lucide icons). */
const KINDS: Record<ExportKind, { running: StringKey; done: StringKey; icon: IconName }> = {
  video: { running: 'win.export.video.running', done: 'win.export.video.done', icon: 'film' },
  sound: { running: 'win.export.sound.running', done: 'win.export.sound.done', icon: 'volume-2' },
  shorts: { running: 'win.export.shorts.running', done: 'win.export.shorts.done', icon: 'smartphone' },
  frame: { running: 'win.export.frame.running', done: 'win.export.frame.done', icon: 'camera' },
  srt: { running: 'win.export.srt.running', done: 'win.export.srt.done', icon: 'captions' },
  voiceset: { running: 'win.export.voiceset.running', done: 'win.export.voiceset.done', icon: 'captions' }
}

/**
 * The one export window: every export (the video, the sound, the Shorts, a
 * frame, the subtitles) shows here. While it runs: what it is doing now, a real percentage, the time
 * left and Cancel. At the end: where it went, Open folder, Play, Close.
 *
 * It used to be a card above the inspector's tabs (out of sight in the
 * Studio, and with no Cancel), while a frame or an SRT was saved with no
 * word at all.
 */
export function ExportProgress(): JSX.Element | null {
  const t = useT()
  const job = useStore((s) => s.exportStatus)
  const [now, setNow] = useState(() => performance.now())
  const samples = useRef<[number, number][]>([])
  const running = !!job && !job.done
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(id)
  }, [running])
  // The bar's recent movement, for the time left.
  const startedAt = job?.startedAt
  useEffect(() => {
    samples.current = []
  }, [startedAt])
  if (job && !job.done) {
    const sec = (performance.now() - (job.startedAt ?? 0)) / 1000
    const last = samples.current[samples.current.length - 1]
    if (!last || job.progress !== last[1]) samples.current.push([sec, job.progress])
    if (samples.current.length > 400) samples.current.splice(0, samples.current.length - 400)
  }
  // Esc closes a finished window (never a running one: Cancel is a button).
  useEffect(() => {
    if (!job?.done) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useStore.getState().setExportStatus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job?.done])
  if (!job) return null

  const kind = job.kind ?? 'video'
  const words = KINDS[kind]
  // A finished job's time is fixed; a running one's counts up.
  const elapsed = job.startedAt ? Math.max(0, ((job.done ? job.endedAt ?? now : now) - job.startedAt) / 1000) : 0
  const pct = Math.max(0, Math.min(100, Math.floor(job.progress * 100)))
  const eta = running ? etaFromSamples([...samples.current, [elapsed, job.progress]]) : null
  const state = job.error ? 'failed' : job.cancelled ? 'cancelled' : job.done ? 'done' : 'running'
  const title =
    state === 'failed' ? t('win.export.failed') : state === 'cancelled' ? t('win.export.cancelled') : state === 'done' ? t(words.done) : t('win.export.runningPct', { what: t(words.running), pct })
  const icon: IconName = state === 'failed' ? 'triangle-exclamation-point' : state === 'cancelled' ? 'square' : state === 'done' ? 'circle-check' : words.icon
  const where = job.path ?? job.folder ?? job.target ?? ''

  return (
    <div className={`export-window ${state}`} role={running ? 'progressbar' : 'status'} aria-live="polite" aria-label={title} aria-valuenow={running ? pct : undefined} aria-valuemin={0} aria-valuemax={100}>
      <div className="ep-head">
        <span className="ep-icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <div className="ep-words">
          <div className="ep-title">{title}</div>
          {where && (
            <Tooltip content={where}>
              <div className="ep-target">{where}</div>
            </Tooltip>
          )}
        </div>
      </div>
      {running && (
        <>
          <div className="ep-step">{localizeMessage(job.label)}</div>
          {/* The time left (and the clock it ends at) on the bar itself. */}
          <div className="ep-bar ep-bar-labelled">
            <div style={{ width: `${pct}%` }} />
            <span>{eta !== null ? t('win.export.eta', { pct, left: fmtLeft(eta), at: fmtClock(Date.now() + eta * 1000, Date.now()) }) : t('win.export.pct', { pct })}</span>
          </div>
        </>
      )}
      {job.error ? (
        <div className="ep-error">{localizeMessage(job.error)}</div>
      ) : (
        <div className="ep-facts">
          {job.detail && <span className="ep-fact">{localizeMessage(job.detail)}</span>}
          {!job.cancelled && <span className="ep-fact">{job.done ? t('win.export.took', { t: fmtLeft(elapsed) }) : t('win.export.soFar', { t: fmtLeft(elapsed) })}</span>}
          {running && eta === null && <span className="ep-fact ep-left">{t('win.export.working')}</span>}
          {job.done && job.bytes ? <span className="ep-fact" data-testid="export.done.size">{fmtBytes(job.bytes)}</span> : null}
        </div>
      )}
      <div className="ep-actions">
        {running ? (
          <Tooltip content={t('win.export.cancel.hint')}>
            <Button variant="danger" size="sm" icon="x" onClick={cancelExportJob} disabled={!exportJobRunning()}>
              {t('win.cancel')}
            </Button>
          </Tooltip>
        ) : (
          <>
            {api && (job.path || job.folder) && !job.error && !job.cancelled && (
              <Tooltip content={t('win.export.folder.hint')}>
                <Button variant="secondary" size="sm" icon="folder-open" onClick={() => void api!.revealOutput(job.folder ?? job.path!)}>
                  {t('win.export.folder')}
                </Button>
              </Tooltip>
            )}
            {api && job.path && !job.error && !job.cancelled && (kind === 'video' || kind === 'sound') && (
              <Tooltip content={t('win.export.play.hint')}>
                <Button size="sm" icon="play" onClick={() => void api!.openOutput(job.path!)}>
                  {t('win.export.play')}
                </Button>
              </Tooltip>
            )}
            <Tooltip content={t('win.closeEsc')}>
              <Button variant="ghost" size="sm" className="ep-close" onClick={() => useStore.getState().setExportStatus(null)}>
                {t('win.close')}
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
