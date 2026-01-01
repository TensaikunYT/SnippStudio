// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { openExportWindow } from './ExportWindow'
import { useStore } from '../state/store'
import { useEffect, useRef, useState } from 'react'
import { BareButton, Icon, IconButton, MenuTrigger, Select, TextField, Tooltip, notify, useT } from '../ui'
import { VolumeMeter } from './VolumeMeter'
import { fmtTime, fmtTimes } from '../ui/format'
import { projectDuration } from '../types'
import { parseTime } from '../ui/timecode'
import { usePreviewUi } from './preview/pv-ui'
import { PLAY_RATES, usePlayRate } from '../playback/play-rate'

/** The clock: the one time form with hundredths (ui/format.ts, audit G6). */
const fmt = (t: number): string => fmtTime(t, 2)

/**
 * The clock, on its own.
 *
 * It is the only part of the transport that changes while the video plays, and
 * subscribing to currentTime up in <TransportBar> re-rendered the whole strip
 * — every button, the meter, the closures — thirty to sixty times a second,
 * on the same thread the preview draws on. Same trick as the playhead.
 */
function ClockText(): JSX.Element {
  const currentTime = useStore((s) => s.currentTime)
  return <>{fmt(currentTime)}</>
}

/** The clock as a button: only its text follows the playhead (the tooltip
 *  and the button are not drawn again 60 times a second). */
function Clock(): JSX.Element {
  const t = useT()
  const open = (): void => usePreviewUi.getState().setTimeEdit(true)
  return (
    <Tooltip content={t('transport.time.hint')} shortcut="g">
      <BareButton className="timecode" testid="transport.time" aria-label={t('transport.time.go')} onClick={open}>
        <ClockText />
      </BareButton>
    </Tooltip>
  )
}

/**
 * The clock, or the field it turns into (a click, or G): any time form
 * parseTime reads (ui/timecode.ts), Enter goes there, Esc or leaving the
 * field closes it (ONIZLEME-UYGULA-PLAN.md, K2; VideoHub's typed timecode).
 */
function Timecode(): JSX.Element {
  const t = useT()
  const editing = usePreviewUi((s) => s.timeEdit)
  const [text, setText] = useState('')
  const [bad, setBad] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) return
    setText(fmt(useStore.getState().currentTime))
    setBad(false)
    // After the field is laid out: the caret in it, the time selected.
    const id = window.setTimeout(() => {
      ref.current?.focus()
      ref.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [editing])
  if (!editing) return <Clock />
  const close = (): void => usePreviewUi.getState().setTimeEdit(false)
  const go = (value: string): void => {
    const s = useStore.getState()
    const to = parseTime(value, s.project.settings.fps, s.currentTime)
    if (to === null) {
      setBad(true)
      notify({ text: t('transport.time.bad'), kind: 'error' })
      return
    }
    s.setPlaying(false)
    s.setTime(to)
    close()
  }
  return (
    <TextField
      ref={ref}
      className="timecode-field"
      mono
      size="sm"
      testid="transport.time.field"
      label={t('transport.time.go')}
      placeholder={t('transport.time.hint')}
      value={text}
      invalid={bad}
      onChange={(v) => {
        setText(v)
        setBad(false)
      }}
      onCommit={go}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
      }}
      onBlur={close}
    />
  )
}

/** The play speed (ONIZLEME-UYGULA-PLAN.md, K3): [ and ] step it. */
function RateSelect(): JSX.Element {
  const t = useT()
  const rate = usePlayRate((s) => s.rate)
  return (
    <Tooltip content={t('transport.rate.hint')}>
      <Select
        className="tb-rate"
        size="sm"
        testid="transport.rate"
        label={t('transport.rate')}
        value={String(rate)}
        options={PLAY_RATES.map((r) => ({ value: String(r), label: fmtTimes(r) }))}
        onChange={(v) => {
          usePlayRate.getState().setRate(Number(v))
          // Space plays again, not the list (a select keeps the focus).
          ;(document.activeElement as HTMLElement | null)?.blur?.()
        }}
      />
    </Tooltip>
  )
}

/** The frame at the playhead as a picture file (the camera button and File →
 *  This frame): the export window on its frame part (phase Ç3b, decision 9;
 *  components/ExportWindow.tsx). */
export async function exportFrameNow(): Promise<void> {
  openExportWindow('frame')
}

/** The arrow beside Undo: go back several steps at once (was File → History). */
function HistoryMenu(): JSX.Element {
  const t = useT()
  const pastCount = useStore((s) => s.past.length)
  return (
    <MenuTrigger
      className="tb-history"
      variant="ghost"
      size="sm"
      icon="chevron-down"
      iconLabel={t('transport.history', { n: pastCount })}
      hint={t('transport.history.hint', { n: pastCount })}
      menuLabel={t('transport.history.title', { n: pastCount })}
      disabled={pastCount === 0}
      testid="transport.history"
      items={() =>
        Array.from({ length: Math.min(30, pastCount) }, (_, i) => i + 1).map((n) => ({
          id: `undo-${n}`,
          icon: 'undo-2' as const,
          label: n === 1 ? t('transport.history.one') : t('transport.history.many', { n }),
          headingBefore: n === 1 ? t('transport.history.title', { n: pastCount }) : undefined,
          onSelect: () => useStore.getState().undoTo(n)
        }))
      }
    />
  )
}

/** Minimalist transport strip directly under the preview. */
export function TransportBar(): JSX.Element {
  const t = useT()
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const setTime = useStore((s) => s.setTime)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const audioDrift = useStore((s) => s.audioDrift)

  return (
    <div className="transport-bar" role="toolbar" aria-label={t('transport.name')}>
      {/* v3: the clock on the left in its pill, the three transport buttons
          in the middle, the edit history and the frame on the right. */}
      <div className="tb-side">
        <Timecode />
        <RateSelect />
      </div>
      <div className="tb-center">
        <IconButton icon="skip-back" variant="ghost" testid="transport.start" onClick={() => setTime(0)} label={t('transport.start')} shortcut="home" />
        <IconButton icon={playing ? 'pause' : 'play'} className="transport-play" testid="transport.play" onClick={() => setPlaying(!playing)} label={playing ? t('transport.pause') : t('transport.play')} shortcut="space" />
        <IconButton icon="skip-forward" variant="ghost" testid="transport.end" onClick={() => setTime(projectDuration(useStore.getState().project))} label={t('transport.end')} />
      </div>
      {/* Only shown once the gap is big enough to actually hear. Preview audio
          running away from the playhead is otherwise something you half-notice
          and can't name — and it says plainly whether a file is out of sync or
          just sounds odd. */}
      {audioDrift > 0.15 && (
        <Tooltip content={t('transport.drift.hint')}>
          <span className="tb-drift" tabIndex={0}>
            <Icon name="triangle-exclamation-point" size={14} />
            {t('transport.drift', { s: audioDrift.toFixed(2) })}
          </span>
        </Tooltip>
      )}
      <div className="tb-side right">
        <IconButton icon="undo-2" variant="ghost" testid="transport.undo" onClick={undo} label={t('transport.undo')} shortcut="ctrl+z" />
        <HistoryMenu />
        <IconButton icon="redo-2" variant="ghost" testid="transport.redo" onClick={redo} label={t('transport.redo')} shortcut="ctrl+shift+z" />
        <IconButton icon="camera" variant="ghost" testid="transport.frame" label={t('transport.frame')} onClick={() => void exportFrameNow()} />
        <VolumeMeter />
      </div>
    </div>
  )
}
