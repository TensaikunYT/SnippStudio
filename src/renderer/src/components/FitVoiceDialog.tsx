// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Fit to voice" (SnippStudio cila O, CILA-O-PLAN.md K3): the pictures picked
// in the Media panel laid on the voice, one of three ways, on a new AUTO
// layer in one undo step (subtitles/fit-voice.ts plans it, the store's
// placeAutomationImages lays it down). It replaced the Automation window.
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Button, Dialog, Segmented, notify, useT, type SegmentOption } from '../ui'
import { useStore } from '../state/store'
import { exportMarks, subscribeExportMarks } from '../export/marks'
import { defaultFitMode, planFitVoice, selectedSpan, type FitVoiceMode } from '../subtitles/fit-voice'

/** "0:07.5". */
function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

export function FitVoiceDialog({ pictureIds, onClose }: { pictureIds: readonly string[]; onClose: () => void }): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const loopRange = useStore((s) => s.loopRange)
  const cutMarks = useStore((s) => s.cutMarks)
  const selectedClipIds = useStore((s) => s.selectedClipIds)
  const marks = useSyncExternalStore(subscribeExportMarks, exportMarks, exportMarks)
  const range = useMemo(() => selectedSpan(project, { marks, loopRange, cutMarks, selectedClipIds }), [project, marks, loopRange, cutMarks, selectedClipIds])
  const plans = useMemo(
    () => ({
      numbers: planFitVoice(project, pictureIds, 'numbers', range),
      even: planFitVoice(project, pictureIds, 'even', range),
      range: planFitVoice(project, pictureIds, 'range', range)
    }),
    [project, pictureIds, range]
  )
  const [mode, setMode] = useState<FitVoiceMode>(() => defaultFitMode(project, pictureIds))
  const [failed, setFailed] = useState(false)
  const plan = plans[mode]

  const closedBy = (m: FitVoiceMode): boolean => {
    const b = plans[m].blocked
    return b === 'noSubtitles' || b === 'noVoice' || b === 'noRange'
  }
  const option = (m: FitVoiceMode, label: string, hint: string): SegmentOption<FitVoiceMode> => ({
    value: m,
    label,
    hint: closedBy(m) ? `${hint}. ${t(`fit.block.${plans[m].blocked!}`)}` : hint,
    disabled: closedBy(m) && m !== mode
  })
  const options = [
    option('numbers', t('fit.mode.numbers'), t('fit.mode.numbers.hint')),
    option('even', t('fit.mode.even'), t('fit.mode.even.hint')),
    option('range', t('fit.mode.range'), t('fit.mode.range.hint'))
  ]

  const n = plan.placements.length
  const summary = plan.blocked
    ? t(`fit.block.${plan.blocked}`)
    : plan.missingSlots.length
      ? t('fit.ready.missing', { n, missing: plan.missingSlots.length, from: clock(plan.span![0]), to: clock(plan.span![1]) })
      : t('fit.ready', { n, from: clock(plan.span![0]), to: clock(plan.span![1]) })

  const apply = (): void => {
    if (plan.blocked) return
    const placed = useStore.getState().placeAutomationImages(plan.placements, 'new', { missingSlots: plan.missingSlots })
    if (!placed) {
      setFailed(true)
      return
    }
    notify({ text: t('fit.done', { n: placed.clipIds.length, track: placed.trackName }) })
    onClose()
  }

  return (
    <Dialog
      open
      title={t('fit.title')}
      onClose={onClose}
      testid="dialog.fit-voice"
      actions={
        <>
          <Button variant="secondary" testid="fit-voice.cancel" onClick={onClose}>
            {t('fit.cancel')}
          </Button>
          <Button variant="primary" testid="fit-voice.apply" disabled={!!plan.blocked} onClick={apply}>
            {t('fit.apply', { n })}
          </Button>
        </>
      }
    >
      <Segmented<FitVoiceMode>
        label={t('fit.mode')}
        testid="fit-voice.mode"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setFailed(false)
        }}
        options={options}
      />
      <p className="win-hint" data-testid="fit-voice.summary" data-blocked={plan.blocked ?? ''}>
        {summary}
      </p>
      {mode === 'numbers' && plan.skipped > 0 && <p className="win-hint">{t('fit.skipped', { n: plan.skipped })}</p>}
      {failed && <p className="win-hint">{t('fit.failed')}</p>}
    </Dialog>
  )
}
