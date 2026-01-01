// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's Voiceover page (REF-AB, worker S, item 8; REF-AB-PLAN-S.md):
// a script to read, the microphone, the countdown, the level, and one large
// Record / Stop. While it records the script is shown large, as a prompter;
// the take lands on a new audio track where the playhead was. The microphone
// is asked for only when Record is pressed (audio/recorder.ts).
import { useEffect } from 'react'
import { api } from '../platform'
import { useStore } from '../state/store'
import { getLastProjectPath } from '../media/projectio'
import { meterFraction, meterZone, takeClock, COUNTDOWNS, type Countdown } from '../audio/voiceover'
import { PROMPT_SIZES, useVoiceover } from '../audio/voiceover-store'
import { leaveTake, refreshMics, startTake, stopTake, useTake } from '../audio/voiceover-run'
import { Button, Field, Icon, Segmented, Select, Slider, TextArea, Toggle, Tooltip, useT } from '../ui'
import './ref-s.css'

export function VoiceoverPage({ active }: { active: boolean }): JSX.Element {
  const t = useT()
  const vo = useVoiceover()
  const take = useTake()
  // Saved somewhere: the take goes into the project's folder (read again
  // whenever the page draws; a save clears the unsaved mark and so draws it).
  useStore((s) => s.dirty)
  const saved = !!getLastProjectPath()
  const busy = take.phase !== 'idle'
  const rolling = take.phase === 'countdown' || take.phase === 'recording'

  useEffect(() => {
    void refreshMics()
    const on = (): void => void refreshMics()
    navigator.mediaDevices?.addEventListener?.('devicechange', on)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', on)
  }, [])
  // The page left while it records: the take is stopped and kept.
  useEffect(() => {
    if (!active) leaveTake()
  }, [active])
  useEffect(() => () => leaveTake(), [])

  const micOptions = [
    { value: '', label: t('vo.mic.default') },
    ...take.mics.map((m) => ({ value: m.deviceId, label: m.label })),
    // A remembered microphone not plugged in now: still named.
    ...(vo.deviceId && !take.mics.some((m) => m.deviceId === vo.deviceId) ? [{ value: vo.deviceId, label: t('vo.mic.gone') }] : [])
  ]
  const zone = meterZone(take.peak)
  const level = meterFraction(take.peak)

  return (
    <div className="dock-page-body vo-page" data-testid="dock.voiceover">
      <div className="dock-intro">
        <strong>{t('dock.cat.voiceover')}</strong>
        <Tooltip content={t('dock.cat.voiceover.hint')}>
          <span className="ui-section-info" role="note" tabIndex={0} aria-label={t('dock.cat.voiceover.hint')}>
            <Icon name="info" size={14} />
          </span>
        </Tooltip>
      </div>

      {rolling ? (
        <div className="vo-prompter" data-testid="voiceover.prompter" aria-live="polite">
          {take.phase === 'countdown' && (
            <div className="vo-count" style={{ fontSize: `${vo.promptSize * 3}px` }} data-testid="voiceover.count" aria-label={t('vo.countdown.now', { n: take.count })}>
              {take.count}
            </div>
          )}
          {vo.script.trim() ? (
            <div className="vo-prompt-text" style={{ fontSize: `${vo.promptSize}px` }}>
              {vo.script}
            </div>
          ) : (
            <div className="vo-prompt-empty">{t('vo.prompt.none')}</div>
          )}
        </div>
      ) : (
        <TextArea
          className="vo-script"
          rows={9}
          value={vo.script}
          label={t('vo.script')}
          placeholder={t('vo.script.placeholder')}
          testid="voiceover.script"
          disabled={busy}
          onChange={(script) => vo.set({ script })}
        />
      )}

      <div className="vo-take-row">
        <span className={`vo-clock${take.phase === 'recording' ? ' is-on' : ''}`} data-testid="voiceover.clock">
          {takeClock(take.seconds)}
        </span>
        <Tooltip content={busy && take.phase !== 'saving' ? t('vo.stop.hint') : t('vo.record.hint')}>
          <Button
            variant={busy ? 'secondary' : 'danger'}
            className={`vo-record${busy ? ' is-recording' : ''}`}
            icon={busy ? 'square' : 'circle'}
            testid="voiceover.record"
            disabled={take.phase === 'saving' || take.phase === 'opening' || !api?.voiceover}
            aria-pressed={take.phase === 'recording'}
            onClick={() => void (busy ? stopTake() : startTake())}
          >
            {take.phase === 'saving' ? t('vo.saving') : busy ? t('vo.stop') : t('vo.record')}
          </Button>
        </Tooltip>
      </div>

      <div
        className={`vo-meter is-${zone}`}
        role="meter"
        aria-label={t('vo.level')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        data-testid="voiceover.level"
      >
        <span className="vo-meter-fill" style={{ width: `${(level * 100).toFixed(1)}%` }} />
      </div>
      <div className="hint">{busy ? (take.using ? t('vo.using', { name: take.using }) : t('vo.level.hint')) : t('vo.level.idle')}</div>

      <Field label={t('vo.mic')}>
        <Select value={vo.deviceId} options={micOptions} testid="voiceover.mic" disabled={busy} onChange={(deviceId) => vo.set({ deviceId })} />
      </Field>
      {take.mics.length === 0 && <div className="hint">{t('vo.mic.names')}</div>}
      <Field label={t('vo.countdown')}>
        <Segmented<string>
          value={String(vo.countdown)}
          label={t('vo.countdown')}
          testid="voiceover.countdown"
          disabled={busy}
          options={COUNTDOWNS.map((n) => ({ value: String(n), label: n === 0 ? t('vo.countdown.off') : t('vo.countdown.s', { n }) }))}
          onChange={(v) => vo.set({ countdown: Number(v) as Countdown })}
        />
      </Field>
      <Toggle label={t('vo.hear')} checked={vo.hearTimeline} testid="voiceover.hear" disabled={busy} onChange={(hearTimeline) => vo.set({ hearTimeline })} />
      <div className={vo.hearTimeline ? 'hint is-warning' : 'hint'} data-testid="voiceover.hear.hint">
        {vo.hearTimeline ? t('vo.hear.warn') : t('vo.hear.off')}
      </div>
      <Slider
        label={t('vo.prompt.size')}
        value={vo.promptSize}
        min={PROMPT_SIZES.min}
        max={PROMPT_SIZES.max}
        step={PROMPT_SIZES.step}
        unit="px"
        onChange={(promptSize) => vo.set({ promptSize })}
      />
      <div className="hint" data-testid="voiceover.where">{saved ? t('vo.where.project') : t('vo.where.profile')}</div>
      <div className="hint">{t('vo.agent.hint')}</div>
    </div>
  )
}
