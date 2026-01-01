// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useMemo, useRef, useState } from 'react'
import type { SilenceFind } from '../agent/analyze'
import { cutPrefs, setEndBeds, setKeepMusic, setSilenceTarget, type SilenceTarget } from '../audio/cut-prefs'
import { planSilenceCut, silenceCutTracks, silenceLimit, sourceTracks, type SilencePace, type SilenceSensitivity } from '../audio/silence'
import { scanSilence, silenceScope, type SilenceScope } from '../audio/silence-scope'
import { useStore } from '../state/store'
import { assetById } from '../types'
import { Button, Checkbox, Field, Segmented, Toggle, Tooltip, notify, t as tr, useT, type StringKey } from '../ui'
import { UndoSlider } from './inspector/sliders'

const SENS_LABEL: { id: SilenceSensitivity; label: StringKey }[] = [
  { id: 'less', label: 'win.silence.less' },
  { id: 'balanced', label: 'win.silence.balanced' },
  { id: 'more', label: 'win.silence.more' }
]

const PACE_LABEL: { id: SilencePace; label: StringKey; hint: StringKey }[] = [
  { id: 'tight', label: 'win.silence.tight', hint: 'win.silence.tight.hint' },
  { id: 'natural', label: 'win.silence.natural', hint: 'win.silence.natural.hint' },
  { id: 'relaxed', label: 'win.silence.relaxed', hint: 'win.silence.relaxed.hint' }
]

const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

/**
 * "Remove Silence" — one-click, auto-calibrated.
 *
 * What it listens to (çekirdek cila S, decision 1): the clips picked (each
 * one that sounds; for a picture whose sound was taken out, that sound);
 * with nothing picked, the speech, found as the agent finds it. Between two
 * cut marks, or inside the loop range, only that stretch is scanned.
 *
 * What it cuts (sessiz, SESSIZ-PLAN.md): the user says. "Picked sound"
 * (the default with clips picked): the tracks of the clips listened to and
 * of their linked pictures. "All tracks" (the default with none): every
 * unlocked track, so the picture, the layers, the subtitles, markers and
 * notes stay in step with the talk — but a sound track that holds none of
 * the clips listened to (the music) is left alone while "Do not cut music
 * and other sounds" is on. "Choose…": the tracks ticked, with their linked
 * partners' tracks. Every choice reaches the store as the same keepTracks
 * (the tracks left as they are).
 *
 * What it shows (decision 4) is worked out by the functions the cut itself
 * uses (audio/silence.ts planSilenceCut): the red marks lie on the clips
 * that will be cut, and the total is the time that will go.
 */
export function SilenceCutter({ onClose }: { onClose?: () => void }): JSX.Element {
  const t = useT()
  const [sensitivity, setSensitivity] = useState<SilenceSensitivity>('balanced')
  const [padMs, setPadMs] = useState(110) // kept on each side of a cut
  const [pace, setPace] = useState<SilencePace>('natural')
  const [minGap, setMinGap] = useState(0.25) // ignore gaps shorter than this (s)
  const [crossfade, setCrossfade] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState(true)
  // Manual dB threshold. Off by default (auto-calibration handles most clips),
  // but when the automatic value flags passages that clearly have audio in
  // them, this takes over: lower it and those passages stop being cut.
  const [manualDb, setManualDb] = useState(false)
  const [thresholdDb, setThresholdDb] = useState(-40)
  const [keepMusic, setKeep] = useState(() => cutPrefs().keepMusic)
  const [endBeds, setEnd] = useState(() => cutPrefs().endBeds)
  // The pauses that are not surely pauses stay unless this is on (decision 5).
  const [withUnsure, setWithUnsure] = useState(false)
  // What is listened to (null: nothing can be) and what the scan found.
  const [scope, setScope] = useState<SilenceScope | null>(null)
  const [found, setFound] = useState<SilenceFind | null>(null)
  const applySilenceCuts = useStore((s) => s.applySilenceCuts)
  const setSilencePreview = useStore((s) => s.setSilencePreview)
  // Stable references, resolved during render (a selector that builds an
  // object returns a new one on every store snapshot: an endless re-render).
  const project = useStore((s) => s.project)
  const selectedIds = useStore((s) => s.selectedClipIds)
  const cutMarks = useStore((s) => s.cutMarks)
  const loopRange = useStore((s) => s.loopRange)
  const limit = useMemo(() => silenceLimit({ cutMarks, loopRange }), [cutMarks, loopRange])
  const limitKey = limit ? limit.join('|') : ''
  const selectionKey = selectedIds.join('|')
  const thresholdSetting = manualDb ? thresholdDb : null
  const anySelection = selectedIds.some((id) => project.clips[id])
  // Where the cut is made, remembered apart for a pick and for none.
  const [target, setTargetState] = useState<SilenceTarget>(() => cutPrefs().target[anySelection ? 'picked' : 'none'])
  useEffect(() => setTargetState(cutPrefs().target[anySelection ? 'picked' : 'none']), [anySelection])
  const setTarget = (v: SilenceTarget): void => {
    setTargetState(v)
    setSilenceTarget(anySelection, v)
  }
  // "Choose…": the tracks ticked (null: those of the sound listened to).
  const [ticked, setTicked] = useState<string[] | null>(null)
  // The scan leaves the music out of its doubts unless every track is cut
  // with the music (SESSIZ-PLAN.md decision 3).
  const scanKeep = target === 'all' ? keepMusic : true
  const runRef = useRef(0)

  // Closing the panel any way at all — Cancel, the toolbar button, a click
  // outside — must take the red preview with it.
  useEffect(() => {
    return () => {
      runRef.current++
      setSilencePreview(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Scan on open and whenever the project, the pick, the range or a setting
  // changes (debounced). No "Detect" step: the red preview always shows the
  // settings as they are, and Remove cannot commit marks of older ones.
  useEffect(() => {
    const my = ++runRef.current
    setSilencePreview(null)
    setFound(null)
    setBusy(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          useStore.getState().setPlaying(false)
          const p = useStore.getState().project
          const sc = await silenceScope(p, useStore.getState().selectedClipIds)
          if (my !== runRef.current) return
          setScope(sc)
          if (!sc) return
          const got = await scanSilence(p, sc, { sensitivity, minDuration: minGap, pad: padMs / 1000, pace, thresholdDb: manualDb ? thresholdDb : undefined }, { limit, keepMusic: scanKeep })
          if (my !== runRef.current) return
          setFound(got)
          // Seed the manual slider with the automatic value, so taking over
          // starts from what the analysis chose rather than a jump.
          const thresholds = [...got.thresholds].sort((a, b) => a - b)
          if (!manualDb && thresholds.length > 0) setThresholdDb(Math.round(thresholds[Math.floor(thresholds.length / 2)]))
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[silence] scan failed', err)
        } finally {
          if (my === runRef.current) setBusy(false)
        }
      })()
    }, 250)
    return () => {
      window.clearTimeout(timer)
      runRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, selectionKey, limitKey, sensitivity, padMs, pace, minGap, manualDb, thresholdSetting, scanKeep])

  // The cut as it will be made: the same functions the command uses.
  const sourceIds = useMemo(() => (scope ? scope.sources.map((c) => c.id) : []), [scope])
  const ownTracks = useMemo(() => sourceTracks(project, sourceIds), [project, sourceIds])
  const tickedTracks = (ticked ?? ownTracks).filter((id) => project.tracks.some((x) => x.id === id && !x.locked))
  const askedKey = target === 'all' ? '' : (target === 'picked' ? ownTracks : tickedTracks).join('|')
  const plan = useMemo(() => {
    if (!scope) return null
    const chosen = found ? [...found.sure, ...(withUnsure ? found.unsure.map((u) => u.r) : [])] : []
    return planSilenceCut(project, sourceIds, chosen, target === 'all' ? { keepMusic } : { keepMusic, tracks: askedKey ? askedKey.split('|') : [] })
  }, [project, scope, sourceIds, found, withUnsure, keepMusic, target, askedKey])
  // "Choose…": the tracks a ticked one takes with it (linked partners).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pulledInList = useMemo(() => (target === 'custom' ? silenceCutTracks(project, askedKey ? askedKey.split('|') : []) : []), [project, target, askedKey])

  // The red marks: every range on every clip that will really be cut.
  useEffect(() => {
    // (okunur) A mark that lies on a pause the finder was not sure of is
    // drawn hatched, so a sure cut and an unsure one read apart.
    const unsure = withUnsure && found ? found.unsure.map((u) => u.r) : []
    setSilencePreview(found && plan && plan.ranges.length ? (unsure.length ? plan.marks.map((m) => (unsure.some(([a, b]) => m.start < b && m.end > a) ? { ...m, unsure: true } : m)) : plan.marks) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, found])

  const names = (ids: readonly string[]): string => ids.map((id) => project.tracks.find((x) => x.id === id)?.name ?? id).join(', ')
  /** "V1, V2 and A1": the tracks as the summary line says them. */
  const list = (ids: readonly string[]): string => {
    const n = ids.map((id) => project.tracks.find((x) => x.id === id)?.name ?? id)
    return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')}${t('ss.and')}${n[n.length - 1]}`
  }
  const summary = (): string => {
    if (!plan) return ''
    if (plan.cutTracks.length === 0) return t('ss.line.none')
    if (plan.keepTracks.length === 0) return t('ss.line.all', { cut: list(plan.cutTracks) })
    return t(plan.keepTracks.length === 1 ? 'ss.line.one' : 'ss.line', { cut: list(plan.cutTracks), kept: list(plan.keepTracks) })
  }
  const speech = scope?.from === 'speech'
  const targets: { value: SilenceTarget; label: string; hint: string }[] = [
    { value: 'picked', label: t(speech ? 'ss.target.speech' : 'ss.target.picked'), hint: t(speech ? 'ss.target.speech.hint' : 'ss.target.picked.hint') },
    { value: 'all', label: t('ss.target.all'), hint: t('ss.target.all.hint') },
    { value: 'custom', label: t('ss.target.custom'), hint: t('ss.target.custom.hint') }
  ]
  // (No track to cut: nothing may be removed, not even the subtitles.)
  const count = plan && plan.cutTracks.length ? plan.ranges.length : 0
  const unsureWord = found?.unsure.filter((u) => u.why === 'enters a word').length ?? 0
  const unsureVoice = (found?.unsure.length ?? 0) - unsureWord
  const failed = found?.failed.length ?? 0
  const thresholds = found ? [...found.thresholds].sort((a, b) => a - b) : []
  // The red word is coloured inside the sentence, wherever the language puts it.
  const [redBefore, redAfter = ''] = t('cs.silence.red').split('{red}')

  const listen = (): string => {
    if (!scope) return ''
    if (scope.from === 'speech') return t('cs.silence.listen.speech', { tracks: names([...new Set(scope.sources.map((c) => c.trackId))]) })
    if (scope.sources.length === 1) return t('cs.silence.listen.one', { name: assetById(project, scope.sources[0].assetId)?.name ?? scope.sources[0].id })
    return t('cs.silence.listen.many', { n: scope.sources.length })
  }

  return (
    <div className="silence-panel" data-testid="silence">
      <h3 className="silence-title">{t('win.silence.title')}</h3>
      {!scope ? (
        <>
          <p className="win-hint" data-testid="silence.status" data-busy={busy ? '1' : '0'}>
            {busy ? t('cs.silence.finding') : t(anySelection ? 'win.silence.noSound' : 'cs.silence.noSpeech')}
          </p>
          <div className="silence-actions">
            <Button className="grow" testid="silence.close" onClick={() => onClose?.()}>
              {t('win.close')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="win-hint" data-testid="silence.listen" data-from={scope.from} data-sources={sourceIds.join(',')}>
            <b>{listen()}</b>
            {limit && ` ${t(cutMarks.length >= 2 ? 'cs.silence.limit.marks' : 'cs.silence.limit.loop', { a: clock(limit[0]), b: clock(limit[1]) })}`}
          </p>
          <div className="ss-target">
            <Field label={t('ss.target')}>
              <Segmented value={target} onChange={setTarget} label={t('ss.target')} testid="silence.target" options={targets} />
            </Field>
          </div>
          {target === 'custom' && (
            <div className="ss-tracks" role="group" aria-label={t('ss.tracks')} data-testid="silence.tracks">
              {project.tracks
                .filter((x) => x.clipIds.length > 0)
                .map((x) => {
                  const own = tickedTracks.includes(x.id)
                  const linked = !own && pulledInList.includes(x.id)
                  return (
                    <Checkbox
                      key={x.id}
                      testid={`silence.track.${x.id}`}
                      checked={own || linked}
                      disabled={!!x.locked || linked}
                      label={x.locked ? t('ss.lockedTrack', { name: x.name }) : linked ? t('ss.linked', { name: x.name }) : x.name}
                      onChange={(on) => setTicked(on ? [...tickedTracks, x.id] : tickedTracks.filter((id) => id !== x.id))}
                    />
                  )
                })}
            </div>
          )}
          {plan && (
            <p className="win-hint" data-testid="silence.scope" data-target={target} data-cut={plan.cutTracks.join(',')} data-kept={plan.keepTracks.join(',')} data-pulled={plan.pulled.join(',')}>
              {summary()}
            </p>
          )}
          {plan && target !== 'all' && plan.behind.length > 0 && (
            <p className="win-hint cs-kept" data-testid="silence.drift">
              {t('ss.drift')}
            </p>
          )}
          {plan && plan.lockedTracks.length > 0 && <p className="win-hint cs-kept">{t('ss.locked', { tracks: names(plan.lockedTracks) })}</p>}
          <p className="win-hint">
            {redBefore}
            <span className="silence-red">{t('win.silence.red')}</span>
            {redAfter}
          </p>

          <Field label={t('win.silence.sensitivity')}>
            <Segmented
              value={sensitivity}
              onChange={setSensitivity}
              label={t('win.silence.sensitivity')}
              testid="silence.sensitivity"
              options={SENS_LABEL.map((o) => ({ value: o.id, label: t(o.label) }))}
            />
          </Field>
          <Field label={t('win.silence.pace')}>
            <Segmented
              value={pace}
              onChange={setPace}
              label={t('win.silence.pace')}
              testid="silence.pace"
              options={PACE_LABEL.map((o) => ({ value: o.id, label: t(o.label), hint: t(o.hint) }))}
            />
          </Field>

          {target === 'all' && (
          <Tooltip content={t('cs.keepMusic.hint')}>
            <div className="silence-switch">
              <Toggle
                checked={keepMusic}
                onChange={(on) => {
                  setKeep(on)
                  setKeepMusic(on)
                }}
                label={t('cs.keepMusic')}
                testid="silence.keep-music"
              />
            </div>
          </Tooltip>
          )}
          {target === 'all' && keepMusic && plan && plan.keepTracks.length > 0 && (
            <Tooltip content={t('cs.endBeds.hint')}>
              <div className="silence-switch">
                <Toggle
                  checked={endBeds}
                  onChange={(on) => {
                    setEnd(on)
                    setEndBeds(on)
                  }}
                  label={t('cs.endBeds')}
                  testid="silence.end-beds"
                />
              </div>
            </Tooltip>
          )}

          <p className="win-hint silence-status" data-testid="silence.status" data-busy={busy ? '1' : '0'} data-ranges={count} data-total={plan ? plan.total.toFixed(3) : '0'} data-unsure={found?.unsure.length ?? 0}>
            {busy || !found
              ? t('win.silence.analyzing')
              : count === 0
                ? t('win.silence.none')
                : t(count === 1 ? 'cs.silence.status.one' : 'cs.silence.status.many', { n: count, s: (plan?.total ?? 0).toFixed(1) })}
          </p>
          {found && found.unsure.length > 0 && (
            <>
              <Tooltip content={t('cs.silence.unsure.hint')}>
                <div className="silence-switch">
                  <Toggle checked={withUnsure} onChange={setWithUnsure} label={t('cs.silence.unsure', { n: found.unsure.length })} testid="silence.unsure" />
                </div>
              </Tooltip>
              <p className="win-hint cs-kept">
                {[unsureWord > 0 ? t('cs.silence.unsure.word', { n: unsureWord }) : '', unsureVoice > 0 ? t('cs.silence.unsure.voice', { n: unsureVoice }) : ''].filter(Boolean).join(' · ')}
              </p>
            </>
          )}
          {failed > 0 && <p className="win-hint silence-failed">{t(failed === 1 ? 'win.silence.failedOne' : 'win.silence.failedMany', { n: failed })}</p>}

          <Button
            variant="ghost"
            size="sm"
            className="silence-more"
            icon={advanced ? 'chevron-down' : 'chevron-right'}
            aria-expanded={advanced}
            testid="silence.advanced"
            onClick={() => setAdvanced((v) => !v)}
          >
            {t('win.silence.advanced')}
          </Button>
          {advanced && (
            <div className="silence-advanced">
              <Tooltip content={t('win.silence.manual.hint')}>
                <div className="silence-switch">
                  <Toggle checked={manualDb} onChange={setManualDb} label={t('win.silence.manual')} />
                </div>
              </Tooltip>
              {manualDb ? (
                <UndoSlider label={t('win.silence.below')} value={thresholdDb} onChange={setThresholdDb} min={-70} max={-10} step={0.5} fmt={(v) => `${v.toFixed(1)} dB`} />
              ) : (
                thresholds.length > 0 && (
                  <p className="win-hint">
                    {t(thresholds.length > 1 ? 'win.silence.autoMany' : 'win.silence.autoOne')}{' '}
                    <b>
                      {thresholds[thresholds.length - 1] !== thresholds[0]
                        ? t('win.silence.dbRange', { a: thresholds[0].toFixed(1), b: thresholds[thresholds.length - 1].toFixed(1) })
                        : t('win.silence.db', { a: thresholds[0].toFixed(1) })}
                    </b>{' '}
                    {t('win.silence.override')}
                  </p>
                )
              )}
              <UndoSlider label={t('win.silence.pad')} value={padMs} onChange={setPadMs} min={0} max={300} step={10} fmt={(v) => `${v.toFixed(0)}ms`} />
              <UndoSlider label={t('win.silence.minGap')} value={minGap} onChange={setMinGap} min={0.1} max={2} step={0.01} fmt={(v) => `${v.toFixed(2)}s`} />
              <div className="silence-switch">
                <Toggle checked={crossfade} onChange={setCrossfade} label={t('win.silence.crossfade')} />
              </div>
            </div>
          )}

          <div className="silence-actions">
            <Button
              testid="silence.cancel"
              onClick={() => {
                setSilencePreview(null)
                onClose?.()
              }}
            >
              {t('win.cancel')}
            </Button>
            <Tooltip content={t('cs.silence.markOnly.hint')}>
              <Button
                icon="diamond"
                disabled={busy || count === 0}
                testid="silence.mark"
                onClick={() => {
                  if (plan && count > 0) {
                    // Nothing is cut: a marker at each pause, one undo step (decision 6).
                    useStore.getState().markTimes(plan.ranges.map(([a, b]) => ({ time: a, label: tr('cs.silence.marker', { s: (b - a).toFixed(1) }) })))
                    notify({ text: tr(count === 1 ? 'cs.silence.markedOne' : 'cs.silence.markedMany', { n: count }) })
                  }
                  setSilencePreview(null)
                  onClose?.()
                }}
              >
                {t('cs.silence.markOnly')}
              </Button>
            </Tooltip>
            <Button
              variant="primary"
              icon="scissors"
              className="grow"
              disabled={busy || count === 0}
              testid="silence.apply"
              onClick={() => {
                if (plan && count > 0) {
                  // Every clip listened to counts: one with no pause found (or
                  // that could not be read) is loud all through (Ç2b patch, item 1).
                  applySilenceCuts(plan.regions, { crossfade, picked: plan.picked, keepTracks: plan.keepTracks, endBeds: target === 'all' && endBeds })
                  notify({ text: tr(count === 1 ? 'win.silence.removedOne' : 'win.silence.removedMany', { n: count }) })
                }
                onClose?.()
              }}
            >
              {t('win.silence.remove')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
