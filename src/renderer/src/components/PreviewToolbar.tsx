// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { prerenderProgress } from '../playback/prerender'
import { prerenderOn, setPrerenderOn } from '../playback/prerender-switch'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { Button, IconButton, Select, TextField, Tooltip, useT } from '../ui'
import { Scopes } from './Scopes'
import { SilenceCutter } from './SilenceCutter'
import { ToolButton } from './ToolButton'
import { usePreviewUi } from './preview/pv-ui'
import { fmtPct } from '../ui/format'
import { clampZoom, pixelScale } from './preview/zoom'
import { previewActualSize } from './preview/actions'
import { useAgentOn } from './agent/useAgentShown'
import { togglePointNote } from '../notes/review'
import { loadBindings } from '../shortcuts'

/** The preview canvas's size on the page, followed as it changes (the zoom
 *  number is the project's real scale: it needs the room the picture has). */
function usePreviewBox(): { cw: number; ch: number } {
  const [box, setBox] = useState({ cw: 0, ch: 0 })
  useEffect(() => {
    let ro: ResizeObserver | null = null
    let raf = 0
    const attach = (): void => {
      const cv = document.querySelector<HTMLCanvasElement>('[data-testid="preview.canvas"]')
      // (The canvas is put in its place a moment after this toolbar.)
      if (!cv) {
        raf = requestAnimationFrame(attach)
        return
      }
      const read = (): void => setBox((b) => (b.cw === cv.clientWidth && b.ch === cv.clientHeight ? b : { cw: cv.clientWidth, ch: cv.clientHeight }))
      read()
      ro = new ResizeObserver(read)
      ro.observe(cv)
    }
    attach()
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [])
  return box
}

/** Motion trackers: create/select/rename/delete; the selected tracker's
 *  crosshair is draggable in the preview and writes keyframes at the playhead. */
function TrackerButton(): JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const trackers = useStore((s) => s.project.trackers)
  const selectedTrackerId = useStore((s) => s.selectedTrackerId)
  const setSelectedTracker = useStore((s) => s.setSelectedTracker)
  const addTracker = useStore((s) => s.addTracker)
  const renameTracker = useStore((s) => s.renameTracker)
  const deleteTracker = useStore((s) => s.deleteTracker)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={popRef} className="pv-pop-anchor">
      <ToolButton icon="crosshair" label={t('preview.tracker')} hint={t('preview.tracker.hint')} pressed={open || !!selectedTrackerId} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="silence-popover pv-pop" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pv-pop-title">{t('preview.tracker.title')}</div>
          <div className="pv-pop-hint">{t('preview.tracker.help')}</div>
          <Button variant="secondary" size="sm" icon="plus" className="pv-pop-wide" onClick={() => addTracker()}>
            {t('preview.tracker.new')}
          </Button>
          {(trackers ?? []).map((tr) => (
            <div key={tr.id} className="pv-tracker-row">
              <TextField size="sm" label={t('preview.tracker.name')} value={tr.name} onChange={(name) => renameTracker(tr.id, name)} />
              <Tooltip content={selectedTrackerId === tr.id ? t('preview.tracker.hide') : t('preview.tracker.show')}>
                <Button variant="ghost" size="sm" pressed={selectedTrackerId === tr.id} onClick={() => setSelectedTracker(selectedTrackerId === tr.id ? null : tr.id)}>
                  {selectedTrackerId === tr.id ? t('preview.tracker.editing') : t('preview.tracker.edit')}
                </Button>
              </Tooltip>
              <span className="pv-tracker-count">{t('preview.tracker.keyframes', { n: tr.keyframes.length })}</span>
              <IconButton icon="x" variant="ghost" size="sm" label={t('preview.tracker.delete')} onClick={() => deleteTracker(tr.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** "Note" (DENEME-2-PLAN-N.md, K4): click-and-type on the preview in one
 *  press, without going to the Notes tab. Shown only while the agent's
 *  access is on (the user's rule: notes are shown only then). The mode is
 *  the Notes tab's "Point" too, so it is not switched off here. */
function PointNoteButton(): JSX.Element | null {
  const t = useT()
  const on = useAgentOn()
  const pointing = useStore((s) => s.noteTool === 'pin')
  if (!on) return null
  return (
    <Tooltip content={t('pv.point.hint')} heading={t('pv.point.label')} shortcut={loadBindings().pointNote}>
      <Button variant="ghost" icon="map-pin" className="pv-point" testid="preview.point-note" pressed={pointing} aria-label={t('pv.point.label')} onClick={() => togglePointNote()}>
        {t('pv.point')}
      </Button>
    </Tooltip>
  )
}

export function PreviewToolbar(): JSX.Element {
  const t = useT()
  const mode = useStore((s) => s.project.mode)
  // The Shorts crop tool pulls a 9:16 window out of a wider frame; in a project
  // that is already portrait it has nothing to do, so it's hidden there.
  const isPortrait = useStore((s) => s.project.settings.height > s.project.settings.width)
  const showGuides = useStore((s) => s.showGuideOverlay)
  // Cila A: the safe-area frames beside the guides, and the crop mode (the
  // selected clip's crop edited with handles in the preview).
  const safeGuides = usePreviewUi((s) => s.safeGuides)
  const cropMode = usePreviewUi((s) => s.cropMode)
  const canCrop = useStore((s) => {
    const clip = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
    const asset = clip ? s.project.assets.find((a) => a.id === clip.assetId) : null
    return !!asset && asset.kind !== 'audio'
  })
  // With nothing left to crop, the mode ends.
  useEffect(() => {
    if (cropMode && !canCrop) usePreviewUi.getState().setCropMode(false)
  }, [cropMode, canCrop])
  const setMode = useStore((s) => s.setMode)
  const previewQuality = useStore((s) => s.previewQuality)
  const [ahead, setAhead] = useState<{ made: number; total: number; on: boolean }>({ made: 0, total: 0, on: prerenderOn() })
  useEffect(() => {
    const id = window.setInterval(() => {
      const pr = prerenderProgress(useStore.getState().project)
      setAhead((cur) => (cur.made === pr.made && cur.total === pr.total && cur.on === prerenderOn() ? cur : { ...pr, on: prerenderOn() }))
    }, 600)
    return () => window.clearInterval(id)
  }, [])
  const adaptive = useStore((s) => s.adaptiveQuality)
  const setAdaptive = useStore((s) => s.setAdaptiveQuality)
  const setPreviewQuality = useStore((s) => s.setPreviewQuality)
  const previewView = useStore((s) => s.previewView)
  const setPreviewView = useStore((s) => s.setPreviewView)
  const silencePreview = useStore((s) => s.silencePreview)
  const [showSilence, setShowSilence] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [morePos, setMorePos] = useState<{ left: number; top: number } | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [silencePos, setSilencePos] = useState<{ left: number; top: number } | null>(null)
  const popRef = useRef<HTMLDivElement>(null)
  // Scopes are a grading instrument, not a daily control: the switch lives in
  // the Effects tab beside the colour tools, and only the overlay is here.
  const scope = useStore((s) => s.scopeKind)
  const silenceBtnRef = useRef<HTMLButtonElement>(null)

  const toggleSilence = () => {
    const next = !showSilence
    setShowSilence(next)
    // The toolbar is a horizontal scroll container (overflow: auto), which
    // clips absolutely-positioned children. Anchor the panel with position:
    // fixed instead, computed from the button, so it escapes that clip.
    if (next && silenceBtnRef.current) {
      const r = silenceBtnRef.current.getBoundingClientRect()
      setSilencePos({ left: Math.min(r.left, window.innerWidth - 376), top: r.bottom + 6 })
    }
  }

  // Close the popover on outside click.
  useEffect(() => {
    if (!showSilence) return
    const onDown = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowSilence(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [showSilence])

  useEffect(() => {
    if (!showMore) return
    const close = (event: PointerEvent): void => {
      if (!moreRef.current?.contains(event.target as Node) && !moreBtnRef.current?.contains(event.target as Node)) setShowMore(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [showMore])

  const zoomTo = (z: number) => setPreviewView({ zoom: clampZoom(z) })
  // The number between the zoom buttons: the project's real scale (100 % =
  // one of its pixels on one pixel of the screen, what the 1:1 button sets).
  const pvBox = usePreviewBox()
  const frameW = useStore((s) => s.project.settings.width)
  const frameH = useStore((s) => s.project.settings.height)
  const shownScale = pixelScale(previewView.zoom, pvBox.cw, pvBox.ch, frameW, frameH, window.devicePixelRatio || 1)
  const aheadWords = ahead.on ? (ahead.made >= ahead.total ? t('preview.ahead.ready') : t('ui.percent', { n: Math.round((100 * ahead.made) / ahead.total) })) : t('preview.ahead.off')

  return (
    <>
    {/* Outside the toolbar element: that one scrolls horizontally, and anything
        absolutely positioned inside it gets clipped and widens the scroll. */}
    {scope && <Scopes kind={scope} onClose={() => useStore.getState().setScopeKind(null)} />}
    <div className="preview-toolbar" role="toolbar" aria-label={t('preview.toolbar')}>
      <div ref={popRef} className="pv-pop-anchor">
        <ToolButton
          ref={silenceBtnRef}
          testid="preview.silence"
          icon="audio-lines"
          pressed={showSilence || !!silencePreview}
          onClick={toggleSilence}
          label={t('preview.silence')}
          hint={t('preview.silence.hint')}
          aria-expanded={showSilence}
        >
          <span className="tb-label">{t('preview.silence')}</span>
          {silencePreview && <span className="tb-count">{silencePreview.length}</span>}
        </ToolButton>
        {showSilence && silencePos && (
          <div
            className="silence-popover"
            style={{ left: silencePos.left, top: silencePos.top }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <SilenceCutter onClose={() => setShowSilence(false)} />
          </div>
        )}
      </div>
      {/* (No "Add text" here since DENEME-3, item 4: the left panel's Text
          has it; the user found the second one in the way.) */}
      <ToolButton
        icon="square"
        folds
        testid="preview.crop-mode"
        pressed={cropMode}
        disabled={!canCrop}
        onClick={() => usePreviewUi.getState().setCropMode(!cropMode)}
        label={t('pv.crop')}
        hint={canCrop ? t('pv.crop.hint') : t('pv.crop.none')}
      />
      <ToolButton
        ref={moreBtnRef}
        testid="preview.more"
        icon="eye"
        folds
        pressed={showMore || mode === 'shorts' || showGuides || safeGuides}
        onClick={() => {
          const next = !showMore
          setShowMore(next)
          if (next && moreBtnRef.current) {
            const rect = moreBtnRef.current.getBoundingClientRect()
            setMorePos({ left: rect.left, top: rect.bottom + 6 })
          }
        }}
        aria-expanded={showMore}
        label={t('ct.view.label')}
        hint={t('ct.view.hint')}
      >
        {t('ct.view')}
      </ToolButton>
      {showMore && morePos && <div ref={moreRef} className="preview-more-pop" style={morePos}>
        {!isPortrait && <ToolButton icon="rectangle-vertical" pressed={mode === 'shorts'} testid="preview.shorts-mode" onClick={() => { setMode(mode === 'shorts' ? 'frame' : 'shorts'); setShowMore(false) }} label={t('preview.shorts')} hint={t('preview.shorts.hint')} />}
        <TrackerButton />
        <ToolButton icon="layout-grid" testid="preview.guides" pressed={showGuides} onClick={() => { useStore.getState().setShowGuideOverlay(!showGuides); setShowMore(false) }} label={t('preview.guides')} hint={t('preview.guides.hint')} />
        <ToolButton icon="rectangle-horizontal" testid="preview.safe-areas" pressed={safeGuides} onClick={() => { usePreviewUi.getState().setSafeGuides(!safeGuides); setShowMore(false) }} label={t('pv.safe')} hint={t('pv.safe.hint')} />
      </div>}
      <PointNoteButton />
      <div className="spacer" />
      <IconButton icon="zoom-out" variant="ghost" onClick={() => zoomTo(previewView.zoom / 1.25)} label={t('preview.zoomOut')} />
      <Tooltip content={t('d22d.preview.scale.hint')} heading={t('preview.zoom')}>
        <span className="zoom-label" data-testid="preview.scale">{fmtPct(shownScale)}</span>
      </Tooltip>
      <IconButton icon="zoom-in" variant="ghost" onClick={() => zoomTo(previewView.zoom * 1.25)} label={t('preview.zoomIn')} />
      <ToolButton testid="preview.actual" onClick={() => previewActualSize()} label={t('preview.actual')} hint={t('preview.actual.hint')} shortcut="1" />
      <ToolButton icon="maximize-2" testid="preview.fit" onClick={() => setPreviewView({ zoom: 1, x: 0, y: 0 })} label={t('preview.fit')} hint={t('preview.fit.hint')} shortcut="0" />
      <span className="sep" />
      {ahead.total > 0 && (
        <ToolButton
          icon="zap"
          className={`prerender-chip${ahead.on ? '' : ' off'}${ahead.made >= ahead.total ? ' done' : ''}`}
          pressed={ahead.on}
          label={t('preview.ahead', { state: aheadWords })}
          hint={ahead.on ? t('preview.ahead.on.hint', { made: ahead.made, total: ahead.total }) : t('preview.ahead.off.hint')}
          onClick={() => {
            setPrerenderOn(!ahead.on)
            setAhead((cur) => ({ ...cur, on: !cur.on }))
          }}
        >
          {aheadWords}
        </ToolButton>
      )}
      {/* One control. Adaptive is the last entry rather than a button of its
          own: it is a quality setting, and the toolbar is short on room. */}
      <Tooltip content={t('preview.quality.hint')}>
        <Select
          className="preview-quality"
          size="sm"
          label={t('preview.quality')}
          value={adaptive ? 'auto' : String(previewQuality)}
          onChange={(v) => {
            setAdaptive(v === 'auto')
            if (v !== 'auto') setPreviewQuality(Number(v))
          }}
          options={[
            { value: '0.25', label: t('preview.quality.quarter') },
            { value: '0.5', label: t('preview.quality.half') },
            { value: '1', label: t('preview.quality.full') },
            { value: 'auto', label: t('preview.quality.adaptive') }
          ]}
        />
      </Tooltip>
    </div>
    </>
  )
}
