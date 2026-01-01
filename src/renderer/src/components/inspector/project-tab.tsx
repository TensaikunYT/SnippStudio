// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector's Project tab: Sound (ducking), Script (the transcript) and the
// project's settings, render queue, archive and chapters. Moved out of
// Inspector.tsx in SnippStudio phase 2B (no change).
import { useEffect, useState } from 'react'
import { api } from '../../platform'
import { archiveProject } from '../../media/projectio'
import { useStore } from '../../state/store'
import { projectDuration } from '../../types'
import { BackdropPicker } from '../TopBar'
import { TranscriptPanel } from '../TranscriptPanel'
import { FRAME_RATES, fpsLabel } from '../../timeline/rates'
import { Button, Field, IconButton, Section, Segmented, Select, SubSection, TextArea, TextField, Toggle, Tooltip, useT } from '../../ui'
import { fmtNum, localNum, fmtPct } from '../../ui/format'
import { UndoSlider } from './sliders'
import { ProjectLook } from './ProjectLook'
import { TransitionSoundSection } from './transition-section'

/** Auto music ducking: dips a music track whenever anyone talks. */
export function DuckingSection(): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const audioTracks = project.tracks.filter((track) => track.kind === 'audio')
  const trackKey = audioTracks.map((track) => track.id).join('|')
  const [voiceTrackId, setVoiceTrackId] = useState('')
  const [musicTrackId, setMusicTrackId] = useState('')
  const [duck, setDuck] = useState(0.25)
  const [attack, setAttack] = useState(0.18)
  const [hold, setHold] = useState(0.3)
  const [release, setRelease] = useState(0.45)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  useEffect(() => {
    const nextVoice = audioTracks.some((track) => track.id === voiceTrackId)
      ? voiceTrackId
      : (audioTracks[0]?.id ?? '')
    const nextMusic = audioTracks.some((track) => track.id === musicTrackId && track.id !== nextVoice)
      ? musicTrackId
      : (audioTracks.find((track) => track.id !== nextVoice)?.id ?? '')
    if (nextVoice !== voiceTrackId) setVoiceTrackId(nextVoice)
    if (nextMusic !== musicTrackId) setMusicTrackId(nextMusic)
  }, [trackKey, voiceTrackId, musicTrackId])

  const musicTrack = audioTracks.find((track) => track.id === musicTrackId)
  const duckedCount = musicTrack?.clipIds.filter((id) => !!project.clips[id]?.autoDucking).length ?? 0
  const canApply =
    !!voiceTrackId &&
    !!musicTrackId &&
    voiceTrackId !== musicTrackId &&
    !musicTrack?.locked &&
    (musicTrack?.clipIds.length ?? 0) > 0

  return (
    <Section id="Automatic music ducking" icon="audio-lines" title={t('insp.duck.title')} count={duckedCount || undefined} data-section="sound">
      <div className="hint">{t('insp.duck.hint')}</div>
      <Field label={t('insp.duck.voice')}>
        <Select
          value={voiceTrackId}
          options={[{ value: '', label: t('insp.choose') }, ...audioTracks.map((track) => ({ value: track.id, label: track.name }))]}
          onChange={(id) => {
            setVoiceTrackId(id)
            if (id === musicTrackId) setMusicTrackId(audioTracks.find((track) => track.id !== id)?.id ?? '')
            setResult('')
          }}
        />
      </Field>
      <Field label={t('insp.duck.music')}>
        <Select
          value={musicTrackId}
          options={[{ value: '', label: t('insp.choose') }, ...audioTracks.filter((track) => track.id !== voiceTrackId).map((track) => ({ value: track.id, label: track.locked ? t('insp.duck.locked', { name: track.name }) : track.name, disabled: track.locked }))]}
          onChange={(id) => { setMusicTrackId(id); setResult('') }}
        />
      </Field>
      <UndoSlider
        label={t('insp.duck.lower')}
        value={duck}
        onChange={setDuck}
        min={0.05}
        max={0.7}
        step={0.01}
        fmt={(value) => fmtPct(value)}
      />
      <SubSection id="Smoothing" title={t('insp.duck.smoothing')} hint={t('insp.duck.smoothing.hint')}>
        <UndoSlider label={t('insp.duck.attack')} value={attack} onChange={setAttack} min={0.05} max={0.6} step={0.01} fmt={(value) => value.toFixed(2)} />
        <UndoSlider label={t('insp.duck.hold')} value={hold} onChange={setHold} min={0} max={1} step={0.01} fmt={(value) => value.toFixed(2)} />
        <UndoSlider label={t('insp.duck.release')} value={release} onChange={setRelease} min={0.1} max={1.5} step={0.01} fmt={(value) => value.toFixed(2)} />
      </SubSection>
      <div className="insp-row">
        <Button
          size="sm"
          disabled={!canApply || busy}
          onClick={async () => {
            setBusy(true)
            setResult(t('insp.duck.analyzing'))
            try {
              const snapshot = structuredClone(useStore.getState().project)
              const { trackSpeechActivity } = await import('../../export/audio')
              const activity = await trackSpeechActivity(snapshot, voiceTrackId)
              if (!activity.some(Boolean)) {
                setResult(t('insp.duck.noSpeech'))
                return
              }
              const count = useStore.getState().applyAutoDucking(voiceTrackId, musicTrackId, activity, {
                cell: 0.1,
                duckRatio: duck,
                attack,
                hold,
                release
              })
              setResult(count > 0 ? t(count === 1 ? 'insp.duck.applied' : 'insp.duck.appliedN', { n: count }) : t('insp.duck.noOverlap'))
            } catch (error) {
              console.error('Auto ducking failed:', error)
              setResult(t('insp.duck.failed'))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? t('insp.duck.busy') : duckedCount > 0 ? t('insp.duck.reapply') : t('insp.duck.apply')}
        </Button>
        {duckedCount > 0 && (
          <Button
            size="sm"
            className="insp-fixed"
            disabled={busy || !!musicTrack?.locked}
            onClick={() => {
              const count = useStore.getState().clearAutoDucking(musicTrackId)
              setResult(count > 0 ? t(count === 1 ? 'insp.duck.restored' : 'insp.duck.restoredN', { n: count }) : '')
            }}
          >
            {t('insp.remove')}
          </Button>
        )}
      </div>
      {audioTracks.length < 2 && <div className="hint is-state">{t('insp.duck.needTwo')}</div>}
      {result && <div className="hint">{result}</div>}
    </Section>
  )
}

export function AudioTab(): JSX.Element {
  const t = useT()
  return (
    <>
      <DuckingSection />
      <TransitionSoundSection />
      <Tooltip content={t('insp.sound.clipHint.more')}>
        <div className="hint">{t('insp.sound.clipHint')}</div>
      </Tooltip>
    </>
  )
}

export type ProjectPart = 'sound' | 'script' | 'settings'
export const PROJECT_PART_KEY = 'snipp-project-part'
export const PROJECT_PARTS: ProjectPart[] = ['sound', 'script', 'settings']
/** Which part of the Project tab a focus request belongs to. */
export const PART_OF: Record<string, ProjectPart> = { sound: 'sound', ducking: 'sound', 'transition-sound': 'sound', script: 'script', transcript: 'script', settings: 'settings', archive: 'settings', chapters: 'settings', 'render-queue': 'settings', snapping: 'settings', background: 'settings' }

/**
 * Audio, Script and Project in one tab: three parts under one switch, each as
 * short as it was, instead of three tabs fighting for the row.
 */
export function ProjectTabs({ part, onPart }: { part: ProjectPart; onPart: (p: ProjectPart) => void }): JSX.Element {
  const t = useT()
  return (
    <>
      <div className="insp-parts">
        <Segmented
          value={part}
          label={t('insp.project.parts')}
          testid="inspector.project"
          options={PROJECT_PARTS.map((id) => ({ value: id, label: t(`insp.project.part.${id}`), hint: t(`insp.project.part.${id}.hint`) }))}
          onChange={onPart}
        />
      </div>
      <div role="tabpanel" aria-label={t(`insp.project.part.${part}`)}>
        {part === 'sound' && <AudioTab />}
        {part === 'script' && <TranscriptPanel />}
        {part === 'settings' && <ProjectTab />}
      </div>
    </>
  )
}

const RESOLUTIONS = [
  { value: '1920x1080', label: '1920 × 1080 (16:9)' },
  { value: '3840x2160', label: '3840 × 2160 (16:9 4K)' },
  { value: '1080x1920', label: '1080 × 1920 (9:16 Shorts)' },
  { value: '2160x3840', label: '2160 × 3840 (9:16 4K)' },
  { value: '1080x1080', label: '1080 × 1080 (1:1)' },
  { value: '2160x2160', label: '2160 × 2160 (1:1 4K)' }
]

export function ProjectTab(): JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.project.settings)
  const name = useStore((s) => s.project.name)
  const setSettings = useStore((s) => s.setSettings)
  const setProjectName = useStore((s) => s.setProjectName)
  const snap = useStore((s) => s.project.snap)
  const setSnap = useStore((s) => s.setSnap)
  const size = `${settings.width}x${settings.height}`

  return (
    <>
    <Section id="Background" icon="image" title={t('insp.project.background')} data-section="background">
      <BackdropPicker title={false} />
    </Section>
    <Section id="Project" icon="settings" title={t('insp.tab.project')} data-section="settings">
      <Field label={t('insp.project.name')}>
        <TextField value={name} onChange={setProjectName} />
      </Field>
      <Field label={t('insp.project.resolution')}>
        <Select
          value={size}
          // A size that is not one of the six (an old project) shows as itself.
          options={RESOLUTIONS.some((r) => r.value === size) ? RESOLUTIONS : [...RESOLUTIONS, { value: size, label: `${settings.width} × ${settings.height}` }]}
          onChange={(v) => {
            const [w, h] = v.split('x').map(Number)
            setSettings({ width: w, height: h })
          }}
        />
      </Field>
      <Field label={t('insp.project.fps')}>
        {/* 25 / 50 and the exact NTSC rates (phase Ç3a, decision 4). */}
        <Select value={String(settings.fps)} options={FRAME_RATES.map((f) => ({ value: String(f), label: t('export.fps.option', { fps: localNum(fpsLabel(f)) }) }))} onChange={(v) => setSettings({ fps: Number(v) })} />
      </Field>
    </Section>
    <Section id="Look" icon="palette" title={t('look.title')} data-section="look">
      <ProjectLook />
    </Section>

    {/* Snapping governs dragging a clip around IN THE PREVIEW — it lived in the
        old Camera tab, which is gone, so it moved here rather than becoming
        unreachable. */}
    <Section id="Preview snapping" icon="magnet" title={t('insp.snap.title')} data-section="snapping">
      <div className="hint">{t('insp.snap.hint')}</div>
      <Toggle label={t('insp.enabled')} checked={snap.enabled} onChange={(on) => setSnap({ enabled: on })} />
      <UndoSlider
        label={t('insp.snap.distance')}
        testid="inspector.snap.distance"
        value={snap.distance}
        onChange={(distance) => setSnap({ distance })}
        min={1}
        max={40}
        step={1}
        fmt={(v) => v.toFixed(0)}
      />
      <Toggle label={t('insp.snap.edges')} checked={snap.snapEdges} onChange={(on) => setSnap({ snapEdges: on })} />
      <Toggle label={t('insp.snap.centers')} checked={snap.snapCenters} onChange={(on) => setSnap({ snapCenters: on })} />
    </Section>

    <RenderQueueSection />
    <ChaptersSection />
    <ArchiveSection />
    </>
  )
}

/**
 * The Shorts render queue, in full.
 *
 * The strip in the Shorts panel is a reminder; this is the list — order, name,
 * range, length, total — where you can reorder it, drop one, or send the whole
 * lot off. Queueing five segments and then not being able to see what you
 * queued is how you end up rendering the wrong four.
 */
export function RenderQueueSection(): JSX.Element | null {
  const t = useT()
  const segments = useStore((s) => s.project.shortSegments)
  const queue = useStore((s) => s.exportQueue)
  const toggle = useStore((s) => s.toggleExportQueue)
  const clear = useStore((s) => s.clearExportQueue)
  const reorder = useStore((s) => s.reorderExportQueue)
  const mode = useStore((s) => s.project.mode)
  const rows = queue
    .map((id) => (segments ?? []).find((sg) => sg.id === id))
    .filter((sg): sg is NonNullable<typeof sg> => !!sg)
  const total = rows.reduce((sum, sg) => sum + (sg.end - sg.start), 0)

  return (
    <Section id="Render queue" icon="layers" title={t('insp.queue.title')} count={rows.length} data-section="render-queue">
      {/* Shown in every project, not only in Shorts mode. A panel that grows and
          loses whole sections depending on what is loaded reads as two
          different programs, and you cannot tell "this build lacks it" from
          "this project doesn't show it". */}
      {mode !== 'shorts' ? (
        <div className="hint">{t('insp.queue.notShorts')}</div>
      ) : rows.length === 0 ? (
        <div className="hint">{t('insp.queue.empty')}</div>
      ) : (
        <>
          <div className="hint">{t(rows.length === 1 ? 'insp.queue.summary' : 'insp.queue.summaryN', { n: rows.length, total: total.toFixed(1) })}</div>
          {rows.map((sg, i) => (
            <div key={sg.id} className="insp-kf-row">
              <span className="insp-queue-n">{i + 1}</span>
              <Tooltip content={t('insp.queue.range', { from: sg.start.toFixed(2), to: sg.end.toFixed(2) })}>
                <span className="insp-queue-name" style={{ color: sg.color ?? undefined }}>{sg.name}</span>
              </Tooltip>
              <span className="insp-kf-time">{t('insp.seconds', { n: fmtNum(sg.end - sg.start, 1, true) })}</span>
              <IconButton icon="chevron-up" size="sm" variant="ghost" disabled={i === 0} label={t('insp.queue.earlier')} onClick={() => reorder(sg.id, -1)} />
              <IconButton icon="chevron-down" size="sm" variant="ghost" disabled={i === rows.length - 1} label={t('insp.queue.later')} onClick={() => reorder(sg.id, 1)} />
              <IconButton icon="x" size="sm" variant="ghost" label={t('insp.queue.takeOut')} onClick={() => toggle(sg.id)} />
            </div>
          ))}
          <div className="insp-row">
            <Button size="sm" onClick={clear}>{t('insp.queue.clear')}</Button>
          </div>
        </>
      )}
    </Section>
  )
}

/**
 * Collect every file the project uses into one folder.
 *
 * The relink dialog exists because absolute paths break; this is the other half
 * of that problem — making a project that CAN'T break, because everything it
 * needs sits next to it.
 */
export function ArchiveSection(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const assets = useStore((s) => s.project.assets)
  const total = assets.filter((a) => a.path).length

  const run = async (): Promise<void> => {
    const project = useStore.getState().project
    setResult(null)
    setBusy(t('insp.archive.choosing'))
    try {
      const r = await archiveProject(project, (done, count, name) =>
        setBusy(t('insp.archive.copying', { done: done + 1, count, name }))
      )
      if (!r.folder) {
        setResult(null)
        return
      }
      setResult(
        r.ok
          ? t(r.copied === 1 ? 'insp.archive.done' : 'insp.archive.doneN', { n: r.copied, gb: (r.bytes / 1e9).toFixed(2), folder: r.folder }) +
            (r.failed.length > 0 ? ` · ${t('insp.archive.failedN', { n: r.failed.length })}` : '')
          : t('insp.archive.failed')
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section id="Archive" icon="archive" title={t('insp.archive.title')} data-section="archive">
      <div className="hint">{t(total === 1 ? 'insp.archive.hint' : 'insp.archive.hintN', { n: total })}</div>
      <div className="insp-row">
        <Button size="sm" icon={busy ? undefined : 'archive'} disabled={!!busy || !api} onClick={() => void run()}>
          {busy ?? t('insp.archive.run')}
        </Button>
      </div>
      {result && <div className="hint">{result}</div>}
    </Section>
  )
}

/**
 * YouTube chapters, straight from the timeline markers.
 *
 * Markers were an editing aid that stopped at the edge of the app; the same
 * list is exactly what the description box wants, and retyping it by scrubbing
 * for timestamps is both tedious and easy to get wrong. YouTube's rules are
 * baked in — the first one has to start at 0:00, there must be at least three,
 * and none shorter than ten seconds — so this says whether it will actually be
 * accepted rather than leaving you to find out on the upload page.
 */
export function ChaptersSection(): JSX.Element {
  const t = useT()
  const markers = useStore((s) => s.project.markers)
  const duration = useStore((s) => projectDuration(s.project))
  const [copied, setCopied] = useState(false)

  const rows = [...(markers ?? [])]
    .filter((m) => m.time < duration + 0.5)
    .sort((a, b) => a.time - b.time)
    .map((m, i) => ({ time: m.time, label: (m.label || m.note || t('insp.chapters.nth', { n: i + 1 })).trim() }))
  // YouTube only reads the list if the first entry is at zero.
  if (rows.length > 0 && rows[0].time > 0.5) rows.unshift({ time: 0, label: t('insp.chapters.intro') })
  const stamp = (at: number): string => {
    const h = Math.floor(at / 3600)
    const m = Math.floor((at % 3600) / 60)
    const sec = Math.floor(at % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`
  }
  const text = rows.map((r) => `${stamp(r.time)} ${r.label}`).join('\n')
  const tooShort = rows.filter((r, i) => i < rows.length - 1 && rows[i + 1].time - r.time < 10).length
  const problems: string[] = []
  if (rows.length > 0 && rows.length < 3) problems.push(t('insp.chapters.needThree'))
  if (tooShort > 0) problems.push(t(tooShort === 1 ? 'insp.chapters.short' : 'insp.chapters.shortN', { n: tooShort }))

  return (
    <Section id="Chapters" icon="list-filter" title={t('insp.chapters.title')} count={rows.length} data-section="chapters">
      <div className="hint">{t('insp.chapters.hint')}</div>
      {rows.length === 0 ? (
        <div className="hint">{t('insp.chapters.none')}</div>
      ) : (
        <>
          <TextArea className="insp-chapters" readOnly value={text} onChange={() => {}} label={t('insp.chapters.title')} rows={Math.min(10, rows.length + 1)} />
          {problems.length > 0 && <div className="hint is-danger">{problems.join(' · ')}</div>}
          <div className="insp-row">
            <Button
              size="sm"
              icon={copied ? 'check' : 'copy'}
              onClick={() => {
                // Main writes it: the page's own clipboard is refused by the
                // locked-down permissions, which said "Copied" over nothing.
                const write = api ? api.clipboardWriteText(text) : navigator.clipboard.writeText(text).then(() => true)
                void write.then(
                  (ok) => {
                    if (!ok) return
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1500)
                  },
                  () => {}
                )
              }}
            >
              {copied ? t('insp.chapters.copied') : t('insp.chapters.copy')}
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}
