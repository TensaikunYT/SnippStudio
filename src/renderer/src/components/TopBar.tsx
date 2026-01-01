// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { BACKDROPS, drawBackdrop, BACKDROP_TINTS } from '../playback/backdrop'
import type { BackdropStyle } from '../types'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { AspectId } from '../types'
import { ASPECT_SIZES } from '../types'
import { explanationsLong, setExplanationsLong, useExplanationsLong } from './explanations'
import { exportFrameNow } from './TransportBar'
import { RendersButton } from './RendersPanel'
import { AgentChip, AgentSwitch } from './agent/AgentTop'
import './agent/pill.css'
import { WatchButton } from './watch/WatchMode'
import { TranscribeButton } from './TranscribeButton'
import { openSettings } from './settings/open'
import { Button, Icon, IconButton, MenuTrigger, Tooltip, useT, type IconName, type MenuItem } from '../ui'
import { backdropHint, backdropName, tintName } from '../ui/data-names'
import { requestShell } from './app/requests'
import { BareButton } from '../ui/Button'
import { LANGS } from '../ui/strings'
import { projectNameShown } from '../ui/format'
import './topbar.css'

const ASPECT_ICON: Record<AspectId, IconName> = { '16:9': 'rectangle-horizontal', '9:16': 'rectangle-vertical', '1:1': 'square' }

/** Change the current canvas while keeping the project's complete timeline. */
function CanvasButton(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const settings = useStore((s) => s.project.settings)
  const setSettings = useStore((s) => s.setSettings)
  const ratio = settings.width / settings.height
  const current: AspectId | 'custom' =
    Math.abs(ratio - 16 / 9) < 0.01
      ? '16:9'
      : Math.abs(ratio - 9 / 16) < 0.01
        ? '9:16'
        : Math.abs(ratio - 1) < 0.01
          ? '1:1'
          : 'custom'

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  const items: { id: AspectId; label: string }[] = [
    { id: '16:9', label: t('top.canvas.landscape') },
    { id: '9:16', label: t('top.canvas.vertical') },
    { id: '1:1', label: t('top.canvas.square') }
  ]
  const highResolution = Math.min(settings.width, settings.height) >= 2000
  const choose = (aspect: AspectId): void => {
    const base = ASPECT_SIZES[aspect]
    const multiplier = highResolution ? 2 : 1
    setSettings({ width: base.width * multiplier, height: base.height * multiplier })
    setOpen(false)
  }

  return (
    <div ref={ref} className="canvas-menu">
      <Tooltip content={t('top.canvas.hint', { w: settings.width, h: settings.height })}>
        <Button variant="ghost" size="sm" iconEnd="chevron-down" pressed={open ? true : undefined} aria-expanded={open} onClick={() => setOpen(!open)} testid="topbar.canvas">
          {t('top.canvas', { ratio: current === 'custom' ? `${settings.width}:${settings.height}` : current })}
        </Button>
      </Tooltip>
      {open && (
        <div className="shell-pop canvas-pop">
          <div className="shell-pop-title">{t('top.canvas.title')}</div>
          {items.map((item) => {
            const base = ASPECT_SIZES[item.id]
            const multiplier = highResolution ? 2 : 1
            const width = base.width * multiplier
            const height = base.height * multiplier
            const on = current === item.id
            return (
              <BareButton key={item.id} type="button" onClick={() => choose(item.id)} className={on ? 'canvas-choice is-on' : 'canvas-choice'} aria-pressed={on}>
                <Icon name={ASPECT_ICON[item.id]} size={14} />
                <span className="canvas-choice-name">
                  {item.id} {item.label}
                </span>
                <small>
                  {width} × {height}
                </small>
                {on && <Icon name="check" size={14} />}
              </BareButton>
            )
          })}
          <div className="shell-pop-hint">{t('top.canvas.keeps')}</div>
          {/* The background is a project setting: one place, the Project tab
              (DENEME-4, worker W: it was here too). */}
          <Button
            variant="ghost"
            size="sm"
            icon="image"
            testid="topbar.canvas.backdrop"
            className="canvas-backdrop-link"
            onClick={() => {
              setOpen(false)
              useStore.getState().focusInspector('background')
            }}
          >
            {t('w4.canvas.backdrop')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** A small live swatch of one background design. */
function BackdropSwatch({ style, tint }: { style: BackdropStyle; tint?: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    let raf = 0
    const start = performance.now()
    const tick = (): void => {
      g.setTransform(cv.width / 320, 0, 0, cv.width / 320, 0, 0)
      drawBackdrop(g, { style, tint }, 4 + (performance.now() - start) / 1000, 320, 180)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [style, tint])
  return <canvas ref={ref} width={96} height={54} />
}

/** The canvas background: black or one of the designs, its colour and pace. */
/** `title` false: inside a panel section that already says Background. */
export function BackdropPicker({ title = true }: { title?: boolean } = {}): JSX.Element {
  const t = useT()
  const backdrop = useStore((s) => s.project.backdrop)
  const setBackdrop = useStore((s) => s.setBackdrop)
  const style = backdrop?.style ?? 'black'
  const info = BACKDROPS.find((b) => b.id === style)!
  return (
    <div className="backdrop-picker">
      {title && <div className="shell-pop-title">{t('top.backdrop.title')}</div>}
      <div className="backdrop-grid">
        {BACKDROPS.map((b) => (
          <Tooltip key={b.id} content={backdropHint(b.id)}>
            <BareButton
              type="button"
              className={style === b.id ? 'is-on' : ''}
              aria-pressed={style === b.id}
              onClick={() => setBackdrop(b.id === 'black' ? null : { style: b.id, ...(backdrop?.motion !== undefined ? { motion: backdrop.motion } : {}) })}
            >
              <BackdropSwatch style={b.id} />
              <span>{backdropName(b.id)}</span>
            </BareButton>
          </Tooltip>
        ))}
      </div>
      {BACKDROP_TINTS[style] && (
        <div className="backdrop-tints">
          {BACKDROP_TINTS[style]!.map((c) => (
            <BareButton
              key={c.tint}
              type="button"
              className={(backdrop?.tint ?? info.tint).toLowerCase() === c.tint ? 'is-on' : ''}
              onClick={() => setBackdrop({ style, ...(c.tint === info.tint ? {} : { tint: c.tint }), ...(backdrop?.motion !== undefined ? { motion: backdrop.motion } : {}) })}
            >
              <span className="backdrop-tint-swatch" style={{ background: c.tint }} />
              {tintName(c.name)}
            </BareButton>
          ))}
        </div>
      )}
      {style !== 'black' && (
        <div className="backdrop-controls">
          <label>
            {t('top.backdrop.colour')}
            <input
              type="color"
              value={backdrop?.tint ?? info.tint}
              onChange={(e) => setBackdrop({ style, tint: e.target.value, ...(backdrop?.motion !== undefined ? { motion: backdrop.motion } : {}) }, false)}
            />
          </label>
          <label>
            {t('top.backdrop.motion')}
            <input
              type="range"
              className="ui-range"
              min={0}
              max={1}
              step={0.01}
              value={backdrop?.motion ?? 0.5}
              onChange={(e) => setBackdrop({ style, ...(backdrop?.tint ? { tint: backdrop.tint } : {}), motion: Number(e.target.value) }, false)}
            />
          </label>
        </div>
      )}
      <div className="shell-pop-hint">{t('top.backdrop.hint')}</div>
    </div>
  )
}

export function TopBar({
  onProjects,
  onNew,
  onNewWindow,
  onOpen,
  onSave,
  onQuickSave,
  onExport,
  onExportSrt,
  onExportVoiceSet,
  onBackups,
  onCancelTranscribe
}: {
  onProjects: () => void
  onNew: (aspect: AspectId) => void
  onNewWindow: () => void
  onOpen: () => void
  /** Save as (always asks where). */
  onSave: () => void
  /** Save to the known file (Ctrl+S). */
  onQuickSave: () => void
  onExport: () => void
  onExportSrt: () => void
  /** The films' input set: sentence SRT, word SRT and the MP3, in one folder. */
  onExportVoiceSet: () => void
  /** File → Earlier versions… (phase Ç2a.2). */
  onBackups: () => void
  onCancelTranscribe: () => void
}): JSX.Element {
  const t = useT()
  const exportStatus = useStore((s) => s.exportStatus)
  const transcribeStatus = useStore((s) => s.transcribeStatus)
  const transcribeProgress = useStore((s) => s.transcribeProgress)
  const name = useStore((s) => s.project.name)
  const dirty = useStore((s) => s.dirty)
  const captionCount = useStore((s) => s.project.captions.length)
  const longText = useExplanationsLong()
  const uiLang = useStore((s) => s.uiLang)
  const setUiLang = useStore((s) => s.setUiLang)
  const exporting = !!exportStatus && !exportStatus.done
  const noSubs = t('top.noSubs')
  const voiceSetTitle = t('top.voiceSet.hint')
  // (The default name in the interface's language: "Adsız", audit item 9.)
  const shown = projectNameShown(name)

  // Every file action, in one place.
  const fileItems = (): MenuItem[] => [
    { id: 'new-16x9', headingBefore: t('top.file.newProject'), icon: 'rectangle-horizontal', label: t('top.file.new169'), onSelect: () => onNew('16:9'), testid: 'menu.file.new-16x9', hint: t('top.file.new169.hint') },
    { id: 'new-9x16', icon: 'rectangle-vertical', label: t('top.file.new916'), onSelect: () => onNew('9:16'), testid: 'menu.file.new-9x16', hint: t('top.file.new916.hint') },
    { id: 'new-1x1', icon: 'square', label: t('top.file.new11'), onSelect: () => onNew('1:1'), testid: 'menu.file.new-1x1', hint: t('top.file.new11.hint') },
    { id: 'projects', separatorBefore: true, icon: 'layout-grid', label: t('top.file.projects'), onSelect: onProjects, testid: 'menu.file.projects', hint: t('top.file.projects.hint') },
    { id: 'open', icon: 'folder-open', label: t('top.file.open'), onSelect: onOpen, testid: 'menu.file.open', hint: t('top.file.open.hint') },
    { id: 'save', icon: 'save', label: t('top.file.save'), shortcut: 'ctrl+s', onSelect: onQuickSave, testid: 'menu.file.save', hint: t('top.file.save.hint') },
    { id: 'save-as', icon: 'copy', label: t('top.file.saveAs'), onSelect: onSave, testid: 'menu.file.save-as', hint: t('top.file.saveAs.hint') },
    { id: 'backups', icon: 'rotate-ccw-clock', label: t('backups.menu'), onSelect: onBackups, testid: 'menu.file.backups', hint: t('backups.menuTitle') },
    { id: 'new-window', icon: 'plus', label: t('top.file.newWindow'), onSelect: onNewWindow, testid: 'menu.file.new-window', hint: t('top.file.newWindow.hint') },
    { id: 'export', separatorBefore: true, headingBefore: t('top.file.exportHead'), icon: 'download', label: t('top.export.video'), onSelect: onExport, disabled: exporting, testid: 'menu.file.export', hint: t('top.export.video.hint') },
    { id: 'export-srt', icon: 'captions', label: t('top.export.srt'), onSelect: onExportSrt, disabled: captionCount === 0, testid: 'menu.file.export-srt', hint: captionCount === 0 ? noSubs : t('top.export.srt.hint') },
    { id: 'export-voice-set', icon: 'captions', label: t('top.export.voiceSet'), onSelect: onExportVoiceSet, disabled: exporting || captionCount === 0, testid: 'menu.file.export-voice-set', hint: captionCount === 0 ? noSubs : voiceSetTitle },
    { id: 'export-frame', icon: 'camera', label: t('top.export.frame'), onSelect: () => void exportFrameNow(), disabled: exporting, testid: 'menu.file.export-frame', hint: t('top.export.frame.hint') },
    { id: 'archive', icon: 'archive', label: t('top.file.archive'), onSelect: () => useStore.getState().focusInspector('archive'), testid: 'menu.file.archive', hint: t('top.file.archive.hint') },
    // Help (phase 9b): the tour, the sample project, the shortcuts.
    { id: 'tour', separatorBefore: true, headingBefore: t('help.head'), icon: 'circle-question-mark', label: t('help.tour'), onSelect: () => requestShell('tour'), testid: 'menu.file.tour', hint: t('help.tour.hint') },
    { id: 'sample', icon: 'film', label: t('help.sample'), onSelect: () => requestShell('sample'), testid: 'menu.file.sample', hint: t('help.sample.hint') },
    // (Both go to the one Settings window: TERMINAL-YOK-PLAN.md, 6.)
    { id: 'shortcuts', icon: 'keyboard', label: t('top.file.shortcuts'), onSelect: () => openSettings('keys'), testid: 'menu.file.shortcuts', hint: t('top.file.shortcuts.hint') },
    { id: 'settings', icon: 'settings', label: t('top.file.settings'), shortcut: 'ctrl+,', onSelect: () => openSettings(), testid: 'menu.file.settings', hint: t('top.file.settings.hint') },
    { id: 'long-text', label: t('top.file.longText'), checked: longText, keepOpen: true, onSelect: () => setExplanationsLong(!explanationsLong()), testid: 'menu.file.long-text', hint: t('top.file.longText.hint') },
    // The interface's language (audit E1): an app preference, kept in the
    // profile; English unless Turkish is chosen here (phase 9b, decision 1).
    ...LANGS.map((l, i): MenuItem => ({
      id: `lang-${l}`,
      separatorBefore: i === 0,
      headingBefore: i === 0 ? t('top.file.langHead') : undefined,
      label: t(`top.file.lang.${l}` as const),
      checked: uiLang === l,
      keepOpen: true,
      onSelect: () => setUiLang(l),
      testid: `menu.file.lang-${l}`,
      hint: t('top.file.lang.hint')
    }))
  ]

  const fmtEta = (sec: number): string => {
    if (sec < 1) return t('top.eta.underSecond')
    if (sec < 60) return t('top.eta.seconds', { s: Math.round(sec) })
    const m = Math.floor(sec / 60)
    return t('top.eta.minutes', { m, s: Math.round(sec % 60) })
  }

  return (
    <div className="topbar" role="banner">
      <Tooltip content={t('top.build', { stamp: __BUILD_STAMP__ })}>
        <span className="logo">{t('top.logo')}</span>
      </Tooltip>
      <MenuTrigger testid="topbar.file" icon="menu" size="sm" label={t('top.file')} hint={t('top.file.hint')} items={fileItems} className="tb-file" />
      <CanvasButton />
      <Tooltip content={dirty ? t('top.save.dirty') : t('top.save.clean')}>
        <Button
          variant="ghost"
          size="sm"
          className={`tb-name${dirty ? ' dirty' : ''}`}
          testid="topbar.save"
          onClick={onQuickSave}
          aria-label={dirty ? t('top.save.dirtyName', { name: shown }) : t('top.save.cleanName', { name: shown })}
        >
          <span className="tb-name-dot" aria-hidden="true">{dirty ? <span className="tb-name-unsaved" /> : <Icon name="check" size={14} />}</span>
          <span className="tb-name-text">{shown}</span>
        </Button>
      </Tooltip>
      <div className="spacer" />
      {transcribeProgress ? (
        <>
          <span className="status tb-status-wide">
            {transcribeProgress.label}
            {transcribeProgress.etaSec !== null && transcribeProgress.etaSec > 0 ? t('top.transcribe.left', { eta: fmtEta(transcribeProgress.etaSec) }) : ''}
          </span>
          <div className="progressbar" role="progressbar" aria-label={t('top.transcribe.progress')} aria-valuenow={Math.round(transcribeProgress.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(transcribeProgress.fraction * 100)}%` }} />
          </div>
          <Tooltip content={t('top.transcribe.stop')}>
            <Button variant="secondary" size="sm" icon="x" onClick={onCancelTranscribe} testid="topbar.transcribe-cancel">
              {t('top.cancel')}
            </Button>
          </Tooltip>
        </>
      ) : (
        transcribeStatus && <span className="status">{transcribeStatus}</span>
      )}
      {/* Just a pulse and a percentage here — what is being written, how long
          is left and where it lands is in the export panel on the right, which
          is big enough to actually say it. */}
      {exportStatus && !exportStatus.done && (
        <>
          <span className="status">{t('top.exporting', { n: Math.round(exportStatus.progress * 100) })}</span>
          <div className="progressbar" role="progressbar" aria-label={t('top.export.progress')} aria-valuenow={Math.round(exportStatus.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(exportStatus.progress * 100)}%` }} />
          </div>
        </>
      )}
      {/* The agent (phase 4B): its chip while it works, and the one switch.
          Everything on the bar is one size: 28 px, 12 px words (DENEME-4,
          worker W; topbar.css sizes the parts made elsewhere). */}
      {/* The watch-and-note mode (IZLE-PLAN.md). */}
      <TranscribeButton />
      <WatchButton />
      <AgentChip />
      <AgentSwitch testid="agent.switch" />
      <IconButton icon="settings" variant="ghost" size="sm" label={t('settings.title')} shortcut="ctrl+," onClick={() => openSettings()} testid="topbar.settings" />
      <RendersButton />
      <div className="tb-export" role="group" aria-label={t('top.export')}>
        <Tooltip content={t('top.export.hint')}>
          <Button variant="primary" size="sm" icon={exporting ? undefined : 'download'} testid="topbar.export" onClick={onExport} disabled={exporting}>
            {exporting ? t('top.export.busy') : t('top.export')}
          </Button>
        </Tooltip>
        <MenuTrigger
          variant="primary"
          size="sm"
          className="tb-export-more"
          testid="topbar.export-more"
          icon="chevron-down"
          iconLabel={t('top.export.more')}
          hint={t('top.export.more.hint')}
          items={() => [
            { id: 'video', icon: 'download', label: t('top.export.video'), onSelect: onExport, disabled: exporting },
            { id: 'srt', icon: 'captions', label: t('top.export.srt'), onSelect: onExportSrt, disabled: captionCount === 0, hint: captionCount === 0 ? noSubs : t('top.export.srt.short') },
            { id: 'voice-set', icon: 'captions', label: t('top.export.voiceSet'), onSelect: onExportVoiceSet, disabled: exporting || captionCount === 0, hint: captionCount === 0 ? noSubs : voiceSetTitle },
            { id: 'frame', icon: 'camera', label: t('top.export.frame'), onSelect: () => void exportFrameNow(), disabled: exporting }
          ]}
        />
      </div>
    </div>
  )
}
