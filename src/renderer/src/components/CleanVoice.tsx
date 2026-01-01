// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useState } from 'react'
import { VOICE_PRESETS } from '../audio/clean'
import { cleanRecording } from '../audio/clean-run'
import { useStore } from '../state/store'
import type { Clip } from '../types'
import { assetById } from '../types'
import { Button, Tooltip, notify, t as tr, useT } from '../ui'
import { voiceHint, voiceName } from '../ui/data-names'
import { UndoSlider } from './inspector/sliders'
import { fmtPct } from '../ui/format'

/**
 * A voice made clean: a ready sound (its EQ, filters, compression) in one
 * click, and the noise under it taken out and the esses softened — into a
 * new file beside the original, which stays to go back to. Phase 3c.4: the
 * building blocks (the two sliders are the Inspector's UndoSlider, the same
 * gesture window as the old ones); the preset names and tips stay the data
 * module's (audio/clean.ts, phase 3c.1 K7).
 */
export function CleanVoice({ clip }: { clip: Clip }): JSX.Element | null {
  const t = useT()
  const project = useStore((s) => s.project)
  const [noise, setNoise] = useState(clip.cleaned?.noise ?? 0.6)
  const [ess, setEss] = useState(clip.cleaned?.ess ?? 0.5)
  const [busy, setBusy] = useState<number | null>(null)
  const asset = assetById(project, clip.assetId)
  if (!asset || !asset.hasAudio || clip.adjustment) return null

  const preset = (key: string): void => {
    const st = useStore.getState()
    st.undoable(() => st.setClipAudioFx(clip.id, VOICE_PRESETS[key].fx as never))
  }
  const clean = async (): Promise<void> => {
    const st = useStore.getState()
    let target = clip
    // A video's own sound is taken out onto the audio lane first.
    if (asset.kind === 'video' && !clip.audioExtracted) {
      st.extractAudio(clip.id)
      const p = useStore.getState().project
      const linked = Object.values(p.clips).find((c) => c.id !== clip.id && c.linkId && c.linkId === p.clips[clip.id]?.linkId)
      if (!linked) {
        notify({ text: tr('win.clean.noExtract'), kind: 'error' })
        return
      }
      target = linked
    }
    const src = assetById(useStore.getState().project, target.cleaned?.from ?? target.assetId)
    if (!src) return
    setBusy(0)
    try {
      const file = await cleanRecording(src, { noise, ess }, (k) => setBusy(k))
      if (!file) {
        notify({ text: tr('win.clean.unreadable'), kind: 'error' })
        return
      }
      useStore.getState().applyCleanedAudio(target.id, file, { noise, ess })
      notify({ text: tr('win.clean.done') })
    } catch (e) {
      notify({ text: tr('win.clean.failed', { error: String(e) }), kind: 'error' })
    } finally {
      setBusy(null)
    }
  }
  const pct = (v: number): string => (v === 0 ? t('data.voice.off') : fmtPct(v))
  return (
    <>
      <div className="clean-presets">
        <Tooltip content={t('win.clean.sound.hint')}>
          <span className="clean-label">{t('win.clean.sound')}</span>
        </Tooltip>
        <div className="clean-preset-row" role="group" aria-label={t('win.clean.sound')}>
          {Object.keys(VOICE_PRESETS).map((key) => (
            <Tooltip key={key} content={voiceHint(key)}>
              <Button size="sm" onClick={() => preset(key)}>
                {voiceName(key)}
              </Button>
            </Tooltip>
          ))}
        </div>
      </div>
      <UndoSlider label={t('win.clean.noise')} value={noise} min={0} max={1} step={0.01} fmt={pct} onChange={setNoise} />
      <UndoSlider label={t('win.clean.ess')} value={ess} min={0} max={1} step={0.01} fmt={pct} onChange={setEss} />
      <div className="clean-actions">
        <Tooltip content={t('win.clean.run.hint')}>
          <Button variant="secondary" icon="eraser" className="grow" disabled={busy !== null} onClick={() => void clean()}>
            {busy !== null ? t('win.clean.busy', { pct: Math.round(busy * 100) }) : clip.cleaned ? t('win.clean.again') : t('win.clean.run')}
          </Button>
        </Tooltip>
        {clip.cleaned && (
          <Tooltip content={t('win.clean.original.hint')}>
            <Button icon="rotate-ccw" disabled={busy !== null} onClick={() => useStore.getState().restoreOriginalAudio(clip.id)}>
              {t('win.clean.original')}
            </Button>
          </Tooltip>
        )}
      </div>
      {clip.cleaned && <p className="win-hint">{t('win.clean.cleaned', { noise: Math.round(clip.cleaned.noise * 100), ess: Math.round(clip.cleaned.ess * 100) })}</p>}
    </>
  )
}
