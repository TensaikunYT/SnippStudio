// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's Captions page (DENEME-4, worker W: "the left adds, makes
// and brings in; the right sets what is selected"). Everything that MAKES the
// subtitles or works on all of them is here: generating them from the speech
// (the spoken language, the cue grouping, a marked range again), an .srt
// brought in, the lines themselves with their times and words, and the
// whole-set moves (fill the gaps, sides). Their style and the selected line's
// own settings stay in the Inspector's Subtitles tab. Moved here from
// inspector/subs-tab.tsx without a change of behaviour.
import { useEffect, useRef, useState } from 'react'
import { parseSrt } from '../subtitles/srt'
import { FULL_SENTENCE_WORDS_PER_CUE, PAUSE_AWARE_WORDS_PER_CUE } from '../subtitles/captions'
import { spokenLanguage, WHISPER_SPOKEN_LANGUAGES, type WhisperLanguage } from '../subtitles/models'
import { spokenLanguageName } from '../ui/language-names'
import { isWhisperInstalled } from '../subtitles/transcribe'
import { useStore } from '../state/store'
import { Button, Field, Icon, IconButton, Section, Select, TextField, Tooltip, notify, useT, type StringKey } from '../ui'
import { create } from 'zustand'
import { ALL_SOUND, liveSource, sourceChoices, sourceValue, sourceWarnings, type CaptionSource } from '../subtitles/source'
import { CaptionLookGrid } from './CaptionLookGrid'
import './ref-s.css'

/** Where the subtitles are made from (REF-AB, worker S): one choice per
 *  window, kept while other pages are open; not in the project. */
const useSource = create<{ source: CaptionSource; set: (source: CaptionSource) => void }>((set) => ({ source: ALL_SOUND, set: (source) => set({ source }) }))

const PAUSES: [number, StringKey][] = [
  [0, 'insp.gen.pause.auto'],
  [0.35, 'insp.gen.pause.short'],
  [0.55, 'insp.gen.pause.normal'],
  [0.8, 'insp.gen.pause.long']
]

/** A caption's start or end, typed: leaving the field sets it. */
function TimeCell({ value, label, onSet, onFocus }: { value: number; label: string; onSet: (v: number) => void; onFocus?: () => void }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Tooltip content={label}>
      <TextField
        className="insp-cap-time"
        size="sm"
        mono
        label={label}
        value={draft ?? value.toFixed(2)}
        onChange={setDraft}
        onFocus={onFocus}
        onBlur={() => {
          if (draft !== null) onSet(Number(draft.replace(',', '.')) || 0)
          setDraft(null)
        }}
        onCommit={() => (document.activeElement as HTMLElement | null)?.blur()}
      />
    </Tooltip>
  )
}

export function CaptionsPage({ onTranscribe: transcribe, onTranscribeRange }: { onTranscribe?: (source?: CaptionSource) => void; onTranscribeRange?: () => void }): JSX.Element {
  const t = useT()
  // The source (REF-AB, worker S, item 10): all the sound, a track or a clip.
  const project = useStore((s) => s.project)
  const chosen = useSource((s) => s.source)
  const source = liveSource(project, chosen)
  const choices = sourceChoices(project)
  const warn = sourceWarnings(project, source)
  const onTranscribe = transcribe ? (): void => transcribe(source) : undefined
  const srtFileRef = useRef<HTMLInputElement>(null)
  const busy = useStore((s) => s.transcribeStatus)
  const cutMarks = useStore((s) => s.cutMarks)
  const captions = useStore((s) => s.project.captions)
  // The list is for fixing what was HEARD: a shape has no text.
  const textCaptions = captions.filter((c) => !c.shape)
  const estimatedTimingCount = captions.filter((c) => c.words?.some((word) => word.estimated)).length
  const mainStyle = useStore((s) => s.project.captionStyle)
  const setMainStyle = useStore((s) => s.setCaptionStyle)
  const updateCaption = useStore((s) => s.updateCaption)
  const deleteCaption = useStore((s) => s.deleteCaption)
  const transcription = useStore((s) => s.project.transcription)
  const setTranscription = useStore((s) => s.setTranscription)
  const setTime = useStore((s) => s.setTime)
  const selectedId = useStore((s) => s.selectedCaptionIds[0] ?? null)

  // One speech model for every language (phase 9a, decision 7): the user
  // chooses the spoken language, never a model.
  const language = spokenLanguage(transcription)
  const [modelMissing, setModelMissing] = useState(false)
  useEffect(() => {
    let live = true
    void isWhisperInstalled().then((ok) => { if (live) setModelMissing(!ok) }, () => undefined)
    return () => { live = false }
  }, [])
  const cueOptions = [
    { value: '0', label: t('insp.gen.cue.auto') },
    { value: String(FULL_SENTENCE_WORDS_PER_CUE), label: t('insp.gen.cue.sentence') },
    { value: String(PAUSE_AWARE_WORDS_PER_CUE), label: t('insp.gen.cue.blocks') },
    ...[1, 2, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: t(n > 1 ? 'insp.gen.cue.words' : 'insp.gen.cue.word', { n }) }))
  ]
  /** A line picked in the list: the playhead there and the line selected, so
   *  its own settings open on the right. */
  const pick = (id: string, at: number): void => {
    setTime(at)
    if (selectedId !== id) useStore.getState().selectCaptions([id])
  }

  return (
    <div className="dock-page-body dock-captions" data-testid="dock.captions">
      <div className="dock-intro">
        <strong>{t('dock.cat.captions')}</strong>
        <Tooltip content={t('dock.cat.captions.hint')}>
          <span className="ui-section-info" role="note" tabIndex={0} aria-label={t('dock.cat.captions.hint')}>
            <Icon name="info" size={14} />
          </span>
        </Tooltip>
      </div>
      <Section id="Generate" icon="audio-waveform" title={t('insp.gen.title')}>
        <Tooltip content={t('subs.lang.hint')}>
          <div>
            <Field label={t('insp.gen.language')}>
              <Select
                value={language}
                disabled={!!busy}
                testid="subs.language"
                options={[
                  { value: 'english', label: t('subs.lang.english') },
                  { value: 'turkish', label: t('subs.lang.turkish') },
                  ...WHISPER_SPOKEN_LANGUAGES.filter((l) => l !== 'turkish' && l !== 'english').map((l) => ({ value: l, label: spokenLanguageName(l) }))
                ]}
                onChange={(v) => setTranscription({ language: v as WhisperLanguage })}
              />
            </Field>
          </div>
        </Tooltip>
        {modelMissing ? <div className="hint is-warning" role="status" data-testid="subs.model.missing">{t('subs.model.missing')}</div> : <div className="hint">{t('subs.model.note')}</div>}
        <Tooltip content={t('insp.gen.cue.hint')}>
          <div>
            <Field label={t('insp.gen.cue')}>
              <Select value={String(mainStyle.wordsPerCue ?? 0)} options={cueOptions} onChange={(v) => setMainStyle({ wordsPerCue: Number(v) })} />
            </Field>
          </div>
        </Tooltip>
        {mainStyle.wordsPerCue === PAUSE_AWARE_WORDS_PER_CUE && (
          <Tooltip content={t('insp.gen.pause.hint')}>
            <div>
              <Field label={t('insp.gen.pause')}>
                <Select value={String(mainStyle.pauseThreshold ?? 0)} options={PAUSES.map(([v, key]) => ({ value: String(v), label: t(key) }))} onChange={(v) => setMainStyle({ pauseThreshold: Number(v) })} />
              </Field>
            </div>
          </Tooltip>
        )}
        <Tooltip content={t('caps.source.hint')}>
          <div>
            <Field label={t('caps.source')}>
              <Select
                value={sourceValue(source)}
                disabled={!!busy}
                testid="captions.source"
                options={choices.map((c) => ({
                  value: c.value,
                  label: c.source.kind === 'all'
                    ? t('caps.source.all')
                    : c.source.kind === 'track'
                      ? t(c.track!.kind === 'audio' ? 'caps.source.audioTrack' : 'caps.source.videoTrack', { name: c.track!.name })
                      : t('caps.source.clip', { name: c.name ?? '', track: c.track!.name, at: (c.clip!.start).toFixed(1) })
                }))}
                onChange={(v) => useSource.getState().set(choices.find((c) => c.value === v)?.source ?? ALL_SOUND)}
              />
            </Field>
          </div>
        </Tooltip>
        {warn.silent ? (
          <div className="hint is-warning cap-source-warn" role="status" data-testid="captions.source.silent">
            <Icon name="triangle-exclamation-point" size={14} />
            <span>{source.kind === 'all' ? t('caps.source.silentAll') : t('caps.source.silentOne')}</span>
          </div>
        ) : (
          <>
            {warn.muted.length > 0 && (
              <div className="hint is-warning cap-source-warn" role="status" data-testid="captions.source.muted">
                <Icon name="volume-x" size={14} />
                <span>{t('caps.source.muted', { names: warn.muted.join(', ') })}</span>
              </div>
            )}
            {warn.soloedOut.length > 0 && (
              <div className="hint is-warning cap-source-warn" role="status" data-testid="captions.source.solo">
                <Icon name="volume-x" size={14} />
                <span>{t('caps.source.solo', { names: warn.soloedOut.join(', ') })}</span>
              </div>
            )}
          </>
        )}
        {warn.hidden.length > 0 && (
          <div className="hint cap-source-warn" role="status" data-testid="captions.source.hidden">
            <Icon name="eye-off" size={14} />
            <span>{t('caps.source.hidden', { names: warn.hidden.join(', ') })}</span>
          </div>
        )}
        {onTranscribe && (
          <Tooltip content={t('insp.gen.run.hint')}>
            <Button variant="secondary" icon={busy ? undefined : 'mic'} disabled={!!busy || modelMissing || warn.silent} testid="dock.captions.run" onClick={onTranscribe} className="dock-wide">
              {busy ?? t('insp.gen.run')}
            </Button>
          </Tooltip>
        )}
        {cutMarks.length >= 2 && onTranscribeRange ? (
          <Button size="sm" icon="mic" disabled={!!busy} testid="dock.captions.range" onClick={onTranscribeRange} className="dock-wide">
            {t('insp.gen.range', { from: Math.min(...cutMarks).toFixed(1), to: Math.max(...cutMarks).toFixed(1) })}
          </Button>
        ) : null}
        {estimatedTimingCount > 0 && <div className="hint is-warning">{t('insp.gen.estimated', { n: estimatedTimingCount })}</div>}
        <Tooltip content={t('insp.caps.import.hint')}>
          <Button size="sm" icon="upload" testid="subs.import-srt" className="dock-wide" onClick={() => srtFileRef.current?.click()}>{t('insp.caps.import')}</Button>
        </Tooltip>
        <input
          ref={srtFileRef}
          type="file"
          accept=".srt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            void f.arrayBuffer().then((bytes) => {
              const caps = parseSrt(bytes)
              if (caps.length === 0) {
                notify({ text: t('insp.caps.importNone'), kind: 'error' })
                return
              }
              const s = useStore.getState()
              s.setCaptions([...s.project.captions, ...caps].sort((a, b) => a.start - b.start))
            })
          }}
        />
      </Section>

      <Section id="Caption looks" icon="layout-grid" title={t('caps.looks')}>
        <CaptionLookGrid />
      </Section>

      <Section id="Captions" icon="captions" title={t('insp.caps.title')} count={textCaptions.length}>
        {textCaptions.length === 0 && <div className="hint">{t('dock.captions.none')}</div>}
        {textCaptions.length > 0 && <div className="hint">{t('insp.caps.hint')}</div>}
        {textCaptions.length > 0 && (
          <div className="insp-row">
            <Tooltip content={t('insp.gen.fill.hint')}>
              <Button size="sm" icon="arrow-right-to-line" testid="dock.captions.fill" onClick={() => useStore.getState().compactCaptions()}>{t('insp.gen.fill')}</Button>
            </Tooltip>
          </div>
        )}
        {textCaptions.length > 1 && (
          <div className="insp-row is-wrap">
            <Tooltip content={t('insp.caps.alternate.hint')}>
              <Button
                size="sm"
                icon="arrow-left-right"
                onClick={() => {
                  const s = useStore.getState()
                  let side: 'left' | 'right' = 'left'
                  s.setCaptions(
                    s.project.captions.map((c) => {
                      if (c.shape || c.manual) return c
                      const out = { ...c, place: side }
                      // A new side once a sentence ends.
                      if (/[.!?…]["”’)]?\s*$/.test(c.text.trim())) side = side === 'left' ? 'right' : 'left'
                      return out
                    })
                  )
                }}
              >
                {t('insp.caps.alternate')}
              </Button>
            </Tooltip>
            <Button
              size="sm"
              onClick={() => {
                const s = useStore.getState()
                s.setCaptions(s.project.captions.map((c) => (c.place || c.font ? { ...c, place: undefined, font: undefined } : c)))
              }}
            >
              {t('insp.caps.middle')}
            </Button>
          </div>
        )}
        {textCaptions.map((c) => (
          <div key={c.id} className={c.id === selectedId ? 'insp-cap-row is-on' : 'insp-cap-row'} data-testid={`dock.captions.line.${c.id}`}>
            <TimeCell value={c.start} label={t('insp.caps.start')} onFocus={() => pick(c.id, c.start)} onSet={(v) => updateCaption(c.id, { start: Math.max(0, v) })} />
            <TimeCell value={c.end} label={t('insp.caps.end')} onSet={(v) => updateCaption(c.id, { end: Math.max(c.start + 0.1, v) })} />
            <TextField className="insp-cap-text" size="sm" label={t('insp.caps.text')} value={c.text} onFocus={() => pick(c.id, c.start)} onChange={(text) => updateCaption(c.id, { text })} />
            <IconButton icon="x" size="sm" variant="ghost" label={t('insp.caps.delete')} onClick={() => deleteCaption(c.id)} />
          </div>
        ))}
      </Section>
      <Button icon="captions" testid="dock.captions.open" className="dock-wide" onClick={() => useStore.getState().focusInspector('subs')}>
        {t('w4.captions.style')}
      </Button>
    </div>
  )
}
