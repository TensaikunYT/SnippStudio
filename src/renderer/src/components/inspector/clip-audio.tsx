// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Clip tab's sound sections (loudness, audio) and a code clip's own section.
// Moved out of Inspector.tsx in SnippStudio phase 2B (no change).
import { CleanVoice } from '../CleanVoice'
import { useEffect, useState } from 'react'
import { codeFilms } from '../../media/codefilm'
import { CodeFilmBadges } from '../CodeFilmBadges'
import { CodeFilmVersions } from './CodeFilmVersions'
import { CodeFilmParams } from './CodeFilmParams'
import { LOUDNESS_TARGETS } from '../../audio/loudness'
import { automationGainAt } from '../../audio/envelope'
import { correctionFor, measureClip, readingAtVolume, type LoudnessReading } from '../../audio/normalize'
import { useDisplayTime, useStore } from '../../state/store'
import { KeyDiamond } from './key-diamond'
import { toggleVolumeKey } from './key-toggle'
import { ResetCardButton } from './card-reset-button'
import { Button, IconButton, Section, Select, SubSection, Tabs, Toggle, Tooltip, useCardPart, useT } from '../../ui'
import { fmtNum, fmtPct } from '../../ui/format'
import { UndoSlider } from './sliders'
import { Switch } from './parts'
import { keepsPitch, speedAudible } from '../../timeline/speed'
import { formatFree } from '../../ui/logic'

/**
 * A collapsible block INSIDE a section, for controls that are worth having but
 * are reached rarely — loudness matching, the EQ/compressor chain. Folding them
 * away is what keeps volume, fades and mute (the ones touched on every clip) at
 * the top of the panel instead of below two screens of sliders.
 */
/**
 * Loudness readout + one-click normalise for a clip. Measuring is a real decode
 * pass, so it only runs when asked — never automatically on selection.
 */
export function LoudnessRow({ clipId }: { clipId: string }): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<LoudnessReading | null>(null)
  const [target, setTarget] = useState(-14)

  const measure = async (): Promise<LoudnessReading | null> => {
    setBusy(true)
    try {
      const r = await measureClip(useStore.getState().project, clipId)
      setReading(r)
      return r
    } catch (err) {
      console.error('loudness measure failed', err)
      return null
    } finally {
      setBusy(false)
    }
  }

  const normalise = async (): Promise<void> => {
    const r = reading ?? (await measure())
    if (!r || !isFinite(r.lufs)) return
    const s = useStore.getState()
    const clip = s.project.clips[clipId]
    if (!clip) return
    const volume = correctionFor(r, target, clip.volume)
    s.setClipVolume(clipId, volume)
    // What it measures now: the target, unless the 200 % cap held it short.
    setReading(readingAtVolume(r, volume))
  }

  return (
    <div className="insp-loudness">
      <Tooltip content={t('insp.loud.hint')}>
        <div className="insp-readout">
          <span className="insp-readout-label">{t('insp.loud.title')}</span>
          <span className="insp-readout-value">
            {busy
              ? t('insp.loud.measuring')
              : reading
                ? isFinite(reading.lufs)
                  ? t('insp.loud.reading', { lufs: reading.lufs.toFixed(1), peak: reading.peakDb.toFixed(1) })
                  : t('insp.loud.silent')
                : '—'}
          </span>
        </div>
      </Tooltip>
      <div className="insp-row">
        <Select
          className="insp-grow"
          label={t('insp.loud.target')}
          value={String(target)}
          options={LOUDNESS_TARGETS.map((x) => ({ value: String(x.lufs), label: `${x.label} (${x.lufs})` }))}
          onChange={(v) => setTarget(Number(v))}
        />
      </div>
      <div className="insp-row">
        <Tooltip content={t('insp.loud.measure.hint')}>
          <Button size="sm" disabled={busy} onClick={() => void measure()}>{t('insp.loud.measure')}</Button>
        </Tooltip>
        <Tooltip content={t('insp.loud.normalize.hint')}>
          <Button size="sm" disabled={busy} onClick={() => void normalise()}>{t('insp.loud.normalize')}</Button>
        </Tooltip>
      </div>
      {reading && isFinite(reading.peakDb) && reading.peakDb > -0.5 && <div className="hint is-danger">{t('insp.loud.peaks')}</div>}
    </div>
  )
}

/** A code film clip (CODE-FILM-CLIP-PLAN.md): where it comes from, whether
 *  its page runs. */
export function CodeFilmSection({ assetId }: { assetId: string }): JSX.Element | null {
  const t = useT()
  const asset = useStore((s) => s.project.assets.find((a) => a.id === assetId))
  const [, setTick] = useState(0)
  useEffect(() => codeFilms.subscribe(() => setTick((n) => n + 1)), [])
  if (!asset || asset.kind !== 'code') return null
  const st = codeFilms.status(asset.id)
  const state = asset.missing
    ? t('insp.code.missing')
    : !st
      ? t('insp.code.notStarted')
      : st.state === 'booting'
        ? t('insp.code.booting')
        : st.state === 'limited'
          ? (st.error ?? '')
          : st.state === 'error'
            ? t('insp.code.failed', { error: st.error ?? '' })
            : [t('insp.code.running'), `${st.width}×${st.height}`, st.fps ? t('insp.code.fps', { n: st.fps }) : '', st.drawMs !== undefined ? t('insp.code.drawMs', { n: Math.round(st.drawMs) }) : ''].filter(Boolean).join(' · ')
  return (
    <Section id="Code film" icon="code" title={t('insp.code.title')}>
      <Tooltip content={asset.path ?? asset.name}>
        <div className="hint">{t('insp.code.source', { path: asset.path ?? asset.name })}</div>
      </Tooltip>
      <div className="hint">{state}</div>
      <CodeFilmBadges assetId={asset.id} />
      <CodeFilmVersions asset={asset} />
      <CodeFilmParams asset={asset} />
      <div className="insp-row">
        <Tooltip content={t('insp.code.reload.hint')}>
          <Button size="sm" icon="rotate-cw" onClick={() => codeFilms.reload(asset.id)}>{t('insp.code.reload')}</Button>
        </Tooltip>
      </div>
    </Section>
  )
}

/** The Audio card's parts (arayüz v4). */
const AUDIO_PARTS = ['level', 'clean', 'fade', 'fx'] as const

export function AudioSection({ clipId }: { clipId: string }): JSX.Element | null {
  const t = useT()
  const clip = useStore((s) => s.project.clips[clipId])
  const setClipVolume = useStore((s) => s.setClipVolume)
  const setClipFades = useStore((s) => s.setClipFades)
  const addVolumeKeyframe = useStore((s) => s.addVolumeKeyframe)
  const dragVolumeKeyframe = useStore((s) => s.dragVolumeKeyframe)
  const deleteVolumeKeyframe = useStore((s) => s.deleteVolumeKeyframe)
  const clearVolumeKeyframes = useStore((s) => s.clearVolumeKeyframes)
  const toggleClipMute = useStore((s) => s.toggleClipMute)
  const currentTime = useDisplayTime()
  const setTime = useStore((s) => s.setTime)
  const [part, setPart] = useCardPart('Audio', AUDIO_PARTS, 'level')
  if (!clip) return null

  const hasKfs = !!clip.volumeKeyframes && clip.volumeKeyframes.length > 0
  const localTime = Math.max(0, Math.min(clip.duration, currentTime - clip.start))
  const displayedVolume = clip.muted ? 0 : hasKfs ? automationGainAt(clip, localTime) : clip.volume
  const maxFade = Math.max(0.1, clip.duration / 2)

  // Arayüz v4: the card's parts are small tabs (level, enhance, fade, audio
  // effects); mute is the card's own switch at its right.
  return (
    <Section
      id="Audio"
      icon="volume-2"
      title={t('insp.audio.title')}
      testid="inspector.card.audio"
      aside={
        <>
          <ResetCardButton clipId={clip.id} part="audio" title={t('insp.audio.title')} />
          <Tooltip content={clip.muted ? t('insp.audio.unmute.hint') : t('insp.audio.mute.hint')}>
            <span>
              <Toggle ariaLabel={clip.muted ? t('insp.audio.muted') : t('insp.audio.mute')} checked={!clip.muted} onChange={() => toggleClipMute(clip.id)} testid="inspector.audio.mute" />
            </span>
          </Tooltip>
        </>
      }
    >
      <Tabs size="sm" value={part} label={t('insp.audio.parts')} testid="inspector.audio.part" onChange={setPart} tabs={AUDIO_PARTS.map((p) => ({ value: p, label: t(`insp.audio.part.${p}`) }))} />
      {part === 'level' && <>
      {hasKfs && <div className="hint">{t('insp.audio.kfActive')}</div>}
      {/* Muted reads as 0% on the fader, because that is what it sounds like.
          The stored volume is untouched underneath, so unmuting puts the level
          (and any keyframes) straight back; moving the fader unmutes. */}
      {/* (REF-AB, item 2: the volume's ‹ ◇ ›, as every keyable value.) */}
      <div className={hasKfs ? 'insp-prop is-keyed' : 'insp-prop'}>
        <div className="insp-prop-body">
          <UndoSlider
            label={hasKfs ? t('insp.audio.volumeAt') : t('insp.audio.volume')}
            testid="inspector.audio.volume"
            value={displayedVolume}
            onChange={(v) => (hasKfs ? dragVolumeKeyframe(clip.id, v) : setClipVolume(clip.id, v))}
            min={0}
            max={2}
            fmt={(v) => fmtPct(v)}
          />
        </div>
        <KeyDiamond keys={clip.volumeKeyframes} span={clip} label={t('refi.key.volume')} testid="inspector.audio.volume.key" onClick={() => toggleVolumeKey(clip.id)} />
      </div>
      </>}
      {part === 'fade' && <>
      <UndoSlider
        label={t('insp.audio.fadeIn')}
        testid="inspector.audio.fade-in"
        value={clip.fadeIn ?? 0}
        onChange={(fadeIn) => setClipFades(clip.id, { fadeIn })}
        min={0}
        max={maxFade}
        step={0.01}
        fmt={(v) => v.toFixed(1)}
      />
      <UndoSlider
        label={t('insp.audio.fadeOut')}
        value={clip.fadeOut ?? 0}
        onChange={(fadeOut) => setClipFades(clip.id, { fadeOut })}
        min={0}
        max={maxFade}
        step={0.01}
        fmt={(v) => v.toFixed(1)}
      />
      </>}
      {part === 'level' && <>
      <div className="insp-row">
        <Button size="sm" icon="diamond" onClick={() => addVolumeKeyframe(clip.id)}>
          {t('insp.audio.keyAt', { t: localTime.toFixed(2) })}
        </Button>
        {hasKfs && <Button size="sm" className="insp-fixed" onClick={() => clearVolumeKeyframes(clip.id)}>{t('insp.clear')}</Button>}
      </div>
      {/* The sound of a retimed clip (core polish B): its pitch kept or
          following the speed, the same in the preview and in the export;
          beyond 0.25x – 8x there is none, and the panel says so. */}
      {(clip.speed ?? 1) !== 1 && speedAudible(clip.speed ?? 1) && (
        <Switch label={t('insp.audio.keepPitch')} hint={t('insp.audio.keepPitch.hint')} checked={keepsPitch(clip)} onChange={(on) => useStore.getState().setClipKeepPitch(clip.id, on)} testid="inspector.audio.keep-pitch" />
      )}
      {!speedAudible(clip.speed ?? 1) && <div className="hint is-state" data-testid="inspector.audio.silent-speed">{t('insp.audio.silentSpeed', { v: formatFree(clip.speed ?? 1, 2) })}</div>}

      <SubSection id="Loudness" title={t('insp.loud.title')} hint={t('insp.loud.sub.hint')}>
        <LoudnessRow key={clip.id} clipId={clip.id} />
      </SubSection>
      {clip.volumeKeyframes?.map((k) => (
        <div key={k.id} className="insp-kf-row">
          <span className="insp-kf-time">{t('insp.seconds', { n: fmtNum(k.time, 2, true) })}</span>
          <span className="insp-kf-value">{fmtPct(k.value)}</span>
          <IconButton icon="arrow-right" size="sm" variant="ghost" label={t('insp.kf.jump')} onClick={() => setTime(clip.start + k.time)} />
          <IconButton icon="x" size="sm" variant="ghost" label={t('insp.kf.delete')} onClick={() => deleteVolumeKeyframe(clip.id, k.id)} />
        </div>
      ))}
      </>}

      {part === 'clean' && <>
        <div className="ui-section-hint">{t('insp.audio.clean.hint')}</div>
        <CleanVoice clip={clip} />
      </>}

      {part === 'fx' && <>
        <div className="ui-section-hint">{t('insp.afx.hint')}</div>
        {(() => {
        const fx = clip.audioFx
        const setFx = (patch: Parameters<ReturnType<typeof useStore.getState>['setClipAudioFx']>[1]) =>
          useStore.getState().setClipAudioFx(clip.id, patch)
        return (
          <>
            <UndoSlider label={t('insp.afx.eqLow')} value={fx?.eqLow ?? 0} onChange={(eqLow) => setFx({ eqLow })} min={-18} max={18} step={0.5} fmt={(v) => v.toFixed(1)} />
            <UndoSlider label={t('insp.afx.eqMid')} value={fx?.eqMid ?? 0} onChange={(eqMid) => setFx({ eqMid })} min={-18} max={18} step={0.5} fmt={(v) => v.toFixed(1)} />
            <UndoSlider label={t('insp.afx.eqHigh')} value={fx?.eqHigh ?? 0} onChange={(eqHigh) => setFx({ eqHigh })} min={-18} max={18} step={0.5} fmt={(v) => v.toFixed(1)} />
            <UndoSlider label={t('insp.afx.rumble')} value={fx?.highpass ?? 0} onChange={(highpass) => setFx({ highpass })} min={0} max={300} step={10} fmt={(v) => (v === 0 ? 'off' : v.toFixed(0))} />
            <UndoSlider label={t('insp.afx.hiss')} value={fx?.lowpass ?? 0} onChange={(lowpass) => setFx({ lowpass: lowpass >= 20000 ? 0 : lowpass })} min={0} max={20000} step={500} fmt={(v) => (v === 0 ? 'off' : v.toFixed(0))} />
            <Toggle label={t('insp.afx.comp')} checked={fx?.comp.enabled ?? false} onChange={(on) => setFx({ comp: { enabled: on } as never })} />
            {fx?.comp.enabled && (
              <>
                <UndoSlider label={t('insp.afx.threshold')} value={fx.comp.threshold} onChange={(threshold) => setFx({ comp: { threshold } as never })} min={-60} max={0} step={1} fmt={(v) => v.toFixed(0)} />
                <UndoSlider label={t('insp.afx.ratio')} value={fx.comp.ratio} onChange={(ratio) => setFx({ comp: { ratio } as never })} min={1} max={12} step={0.5} fmt={(v) => `${v.toFixed(1)}:1`} />
              </>
            )}
            <Tooltip content={t('insp.afx.gate.hint')}>
              <div>
                <Toggle label={t('insp.afx.gate')} checked={fx?.gate?.enabled ?? false} onChange={(on) => setFx({ gate: { enabled: on } as never })} />
              </div>
            </Tooltip>
            {fx?.gate?.enabled && (
              <>
                <UndoSlider
                  label={t('insp.afx.gateDb')}
                  value={fx.gate.threshold}
                  onChange={(threshold) => setFx({ gate: { threshold } as never })}
                  min={-70}
                  max={-15}
                  step={1}
                  fmt={(v) => v.toFixed(0)}
                />
                <UndoSlider
                  label={t('insp.afx.release')}
                  value={fx.gate.release}
                  onChange={(release) => setFx({ gate: { release } as never })}
                  min={20}
                  max={600}
                  step={10}
                  fmt={(v) => v.toFixed(0)}
                />
                <div className="hint">{t('insp.afx.gate.help')}</div>
              </>
            )}
            {fx && (
              <div className="insp-row">
                <Button size="sm" onClick={() => useStore.getState().undoable(() => useStore.getState().setClipAudioFx(clip.id, null))}>{t('insp.afx.reset')}</Button>
              </div>
            )}
          </>
        )
        })()}
      </>}
    </Section>
  )
}
