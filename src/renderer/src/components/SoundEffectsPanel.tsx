// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { EmptyState } from './EmptyState'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibrarySound } from '../../../preload/index'
import { collectVisualCuts } from '../audio/sfx'
import { placeSavedSound, readSfxPreferences, saveSfxPreferences, SFX_LIBRARY_CHANGED, SFX_PREF_CHANGED } from '../audio/sfx-library'
import { api } from '../platform'
import { useStore } from '../state/store'
import { Button, Icon, Slider, Tooltip, localizeMessage, useT } from '../ui'
import { BareButton } from '../ui/Button'

const stamp = (seconds: number): string => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(1).padStart(4, '0')}`

/** `active`: its dock page is the one showing. Hidden, it does not follow the
 *  playhead (it stays mounted, and re-rendering it on every frame of
 *  playback was work nobody saw). */
export function SoundEffectsPanel({ active = true }: { active?: boolean } = {}): JSX.Element {
  const t = useT()
  const [library, setLibrary] = useState<LibrarySound[]>([])
  const [selectedId, setSelectedId] = useState(() => readSfxPreferences().id)
  const [lead, setLead] = useState(() => readSfxPreferences().lead)
  const [volume, setVolume] = useState(() => readSfxPreferences().volume)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const preview = useRef<HTMLAudioElement | null>(null)
  const project = useStore((state) => state.project)
  const currentTime = useStore((state) => (active ? state.currentTime : 0))
  const cuts = useMemo(() => collectVisualCuts(project), [project])
  const nearby = [...cuts].sort((a, b) => Math.abs(a - currentTime) - Math.abs(b - currentTime)).slice(0, 6).sort((a, b) => a - b)
  const selected = library.find((sound) => sound.id === selectedId)

  useEffect(() => {
    if (!api) return
    let live = true
    void api.listSoundEffects().then((files) => {
      if (!live) return
      setLibrary(files)
      const preferred = readSfxPreferences().id
      const next = files.some((file) => file.id === preferred) ? preferred : files[0]?.id ?? ''
      setSelectedId(next)
      if (next !== preferred) saveSfxPreferences({ id: next })
    }).catch(() => { if (live) setMessage(t('sfx.libraryFailed')) })
    return () => { live = false; preview.current?.pause() }
  }, [])

  useEffect(() => {
    const sync = (): void => {
      const prefs = readSfxPreferences()
      setSelectedId(prefs.id)
      setLead(prefs.lead)
      setVolume(prefs.volume)
    }
    const refresh = (): void => { if (api) void api.listSoundEffects().then(setLibrary).catch(() => {}) }
    window.addEventListener(SFX_PREF_CHANGED, sync)
    window.addEventListener(SFX_LIBRARY_CHANGED, refresh)
    return () => {
      window.removeEventListener(SFX_PREF_CHANGED, sync)
      window.removeEventListener(SFX_LIBRARY_CHANGED, refresh)
    }
  }, [])

  const addToLibrary = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    try {
      const files = await api.importSoundEffects()
      const known = new Set(library.map((sound) => sound.id))
      const added = files.filter((sound) => !known.has(sound.id))
      setLibrary(files)
      const next = added.at(-1)?.id ?? (files.some((file) => file.id === selectedId) ? selectedId : files[0]?.id ?? '')
      setSelectedId(next)
      saveSfxPreferences({ id: next })
      setMessage(added.length ? t(added.length === 1 ? 'sfx.added.one' : 'sfx.added.many', { n: added.length }) : t('sfx.unchanged'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('sfx.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  const place = async (times: readonly number[]): Promise<void> => {
    if (!selected || !times.length) return
    setBusy(true)
    try {
      const placed = await placeSavedSound(selected, times, lead, volume / 100)
      setMessage(placed ? t(placed === 1 ? 'sfx.placed.one' : 'sfx.placed.many', { n: placed }) : t('sfx.already'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('sfx.placeFailed'))
    } finally {
      setBusy(false)
    }
  }

  const playPreview = (): void => {
    if (!selected) return
    preview.current?.pause()
    const audio = new Audio(selected.url)
    audio.volume = volume / 100
    preview.current = audio
    void audio.play().catch(() => setMessage(t('sfx.previewFailed')))
  }

  const setLeadNow = (next: number): void => {
    setLead(next)
    saveSfxPreferences({ lead: next })
  }
  const setVolumeNow = (next: number): void => {
    setVolume(next)
    saveSfxPreferences({ volume: next })
  }

  return (
    <div className="sfx-panel">
      <div className="dock-intro">
        <strong>{t('sfx.title')}</strong>
        <Tooltip content={t('sfx.add.hint')}>
          <Button variant="secondary" size="sm" icon="plus" onClick={() => void addToLibrary()} disabled={!api || busy}>
            {t('sfx.add')}
          </Button>
        </Tooltip>
      </div>
      <p className="dock-note">{t('sfx.note')}</p>
      {!api && <p className="dock-note">{t('sfx.desktopOnly')}</p>}
      <div className="sfx-list" role="listbox" aria-label={t('sfx.list')}>
        {library.map((sound) => (
          <BareButton key={sound.id} type="button" className={`sfx-item${sound.id === selectedId ? ' selected' : ''}`} onClick={() => { setSelectedId(sound.id); saveSfxPreferences({ id: sound.id }) }} role="option" aria-selected={sound.id === selectedId} title={sound.name}>
            <Icon name="eighth-notes" size={14} />
            <span>{sound.name}</span>
          </BareButton>
        ))}
        {/* REF-AB item 7: a picture, one sentence, one action. */}
        {library.length === 0 && (api ? <EmptyState art="sound" text={t('refp.sound.empty')} action={t('sfx.add')} icon="plus" onAction={() => void addToLibrary()} testid="sounds.empty" /> : <span className="dock-empty">{t('sfx.empty')}</span>)}
      </div>
      {selected && <>
        <div className="sfx-action-row">
          <Tooltip content={t('sfx.preview.hint')}>
            <Button variant="secondary" size="sm" icon="play" onClick={playPreview}>{t('sfx.preview')}</Button>
          </Tooltip>
          <Tooltip content={t('sfx.atPlayhead.hint')}>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => void place([currentTime])} disabled={busy}>{t('sfx.atPlayhead')}</Button>
          </Tooltip>
        </div>
        <Slider label={t('sfx.lead')} value={lead} min={0} max={0.5} step={0.01} unit="s" onChange={setLeadNow} testid="sounds.lead" />
        <Slider label={t('sfx.level')} value={volume} min={0} max={100} step={1} unit="%" onChange={setVolumeNow} testid="sounds.level" />
        <div className="sfx-cuts-head"><strong>{t('sfx.cuts')}</strong><span>{cuts.length}</span></div>
        <Tooltip content={t('sfx.allCuts.hint')}>
          <Button variant="secondary" icon="plus" className="sfx-all" onClick={() => void place(cuts)} disabled={busy || cuts.length === 0}>{t('sfx.allCuts')}</Button>
        </Tooltip>
        <div className="sfx-cut-list">
          {nearby.map((time) => (
            <Tooltip key={time} content={t('sfx.atCut.hint', { at: stamp(time) })}>
              <BareButton type="button" onClick={() => void place([time])} disabled={busy}>
                <span className="sfx-cut-at"><Icon name="scissors" size={12} />{stamp(time)}</span>
                <Icon name="plus" size={14} />
              </BareButton>
            </Tooltip>
          ))}
          {cuts.length === 0 && <span className="dock-empty">{t('sfx.noCuts')}</span>}
        </div>
      </>}
      {message && <div className="sfx-message" role="status">{localizeMessage(message)}</div>}
    </div>
  )
}
