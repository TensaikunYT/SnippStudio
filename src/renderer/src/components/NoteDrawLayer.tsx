// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { drawingShown, nextNoteNum, NOTE_COLORS } from '../notes/model'
import { notePinLabels, paintShapes, pinNumbers, shapeOfStroke, worthKeeping, type PaintContext } from '../notes/shapes'
import { useWatch } from './watch/watch-state'
import type { NoteShape } from '../types'
import { IconButton, useT, type IconName, type StringKey } from '../ui'
import { ToolButton } from './ToolButton'
import { BareButton } from '../ui/Button'
import { usePreviewUi } from './preview/pv-ui'

/** Two clicks this close in time are a double click (the watch mode's note). */
const DOUBLE_CLICK_MS = 400

const TOOLS: [NoteShape['type'], IconName][] = [
  ['pin', 'map-pin'],
  ['rect', 'square'],
  ['arrow', 'move-up-right'],
  ['pen', 'pencil']
]

/** Where the project frame is on the preview, in the wrap's own pixels: the
 *  same fit, zoom and pan as PreviewCanvas (its getXform). */
export function frameBox(cw: number, ch: number, W: number, H: number, pv: { zoom: number; x: number; y: number }): { left: number; top: number; w: number; h: number } {
  const k = Math.min(cw / W, ch / H) * pv.zoom
  return { left: cw / 2 - (W * k) / 2 + pv.x, top: ch / 2 - (H * k) / 2 + pv.y, w: W * k, h: H * k }
}

/** Is the playhead on the frame a drawing was made on? */
const onFrame = (t: number, at: number | undefined, fps: number): boolean => at !== undefined && Math.abs(t - at) < 0.5 / Math.max(1, fps)

/** The drawing tools of the note being written (the bar over the preview, and
 *  the same buttons in the Notes tab). */
export function NoteToolButtons({ compact = false }: { compact?: boolean }): JSX.Element {
  const tool = useStore((s) => s.noteTool)
  const color = useStore((s) => s.noteColor)
  const count = useStore((s) => s.noteDraft?.shapes.length ?? 0)
  const t = useT()
  const set = (t: NoteShape['type']): void => {
    const s = useStore.getState()
    s.setPlaying(false)
    s.setNoteTool(s.noteTool === t ? null : t)
  }
  return (
    <>
      {TOOLS.map(([id, icon]) =>
        compact ? (
          <IconButton key={id} testid={`notes.draw.tool.${id}.bar`} variant="ghost" size="sm" icon={icon} pressed={tool === id} label={t(`notes.draw.${id}.hint` as StringKey)} onClick={() => set(id)} />
        ) : (
          <ToolButton key={id} testid={`notes.draw.tool.${id}`} variant="secondary" icon={icon} pressed={tool === id} label={t(`notes.draw.${id}` as StringKey)} hint={t(`notes.draw.${id}.hint` as StringKey)} onClick={() => set(id)} />
        )
      )}
      <span className="note-swatches" role="group" aria-label={t('notes.draw.colour')}>
        {NOTE_COLORS.map((c) => (
          <BareButton key={c} type="button" className={`note-swatch${color === c ? ' on' : ''}`} style={{ ['--swatch' as string]: c }} aria-label={t('notes.draw.colour.one', { colour: c })} aria-pressed={color === c} title={t('notes.draw.colour')} onClick={() => useStore.getState().setNoteColor(c)} />
        ))}
      </span>
      <IconButton icon="undo-2" variant="ghost" size="sm" disabled={count === 0} label={t('notes.draw.undo')} testid="notes.draw.undo" onClick={() => { const s = useStore.getState(); if (s.noteDraft) s.patchNoteDraft({ shapes: s.noteDraft.shapes.slice(0, -1) }) }} />
      <ToolButton disabled={count === 0} label={t('notes.draw.clear')} hint={t('notes.draw.clear.hint')} testid="notes.draw.clear" onClick={() => useStore.getState().patchNoteDraft({ shapes: [], at: undefined })} />
    </>
  )
}

/**
 * The drawing of a work note, over the preview: the strokes of the note being
 * written (and the tools to make them), or of the picked note while the
 * playhead is on its frame. It is a layer of its own above the preview canvas
 * and takes the pointer only while a drawing tool is on, so the preview's own
 * handles work as always the rest of the time.
 */
export function NoteDrawLayer(): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ cw: 0, ch: 0 })
  const [live, setLive] = useState<NoteShape | null>(null)
  const liveRef = useRef<NoteShape | null>(null)
  const tool = useStore((s) => s.noteTool)
  const draft = useStore((s) => s.noteDraft)
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const fps = useStore((s) => s.project.settings.fps)
  const pv = useStore((s) => s.previewView)
  const t = useT()
  // The picked note's drawing, only while the playhead is on its frame, and
  // only while the note is open: a done note leaves no pin over the film,
  // but the one the review is on shows (DENEME-2-PLAN-N.md, K2).
  const picked = useStore((s) => {
    if (s.noteDraft) return null
    const n = s.noteSel ? s.project.notes?.find((x) => x.id === s.noteSel) : undefined
    const reviewing = s.noteReview ? s.noteReview.ids[s.noteReview.index] : null
    return n?.shapes?.length && drawingShown(n, reviewing) && onFrame(s.currentTime, n.at, s.project.settings.fps) ? n.shapes : null
  })
  const draftOnFrame = useStore((s) => !!s.noteDraft && (s.noteDraft.shapes.length === 0 || onFrame(s.currentTime, s.noteDraft.at, s.project.settings.fps)))
  // In the watch mode a pin says the note's number, as the list does: the one
  // a note being written will get, or the picked note's (cila3, 1a).
  const watchOn = useWatch((s) => s.on)
  const noteNum = useStore((s) => (!watchOn ? null : s.noteDraft ? nextNoteNum(s.project) : (s.project.notes?.find((x) => x.id === s.noteSel)?.num ?? null)))

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = (): void => setSize({ cw: el.clientWidth, ch: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const shapes: readonly NoteShape[] | null = draft ? (draftOnFrame ? draft.shapes : null) : picked

  useEffect(() => {
    const el = canvasRef.current
    if (!el || size.cw === 0 || size.ch === 0) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.cw * dpr)
    const ph = Math.round(size.ch * dpr)
    if (el.width !== pw) el.width = pw
    if (el.height !== ph) el.height = ph
    const g = el.getContext('2d')
    if (!g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, pw, ph)
    const all = [...(shapes ?? []), ...(live ? [live] : [])]
    if (all.length === 0) return
    const box = frameBox(size.cw, size.ch, W, H, pv)
    g.setTransform(dpr, 0, 0, dpr, box.left * dpr, box.top * dpr)
    paintShapes(g as unknown as PaintContext, all, box.w, box.h, 1, noteNum !== null ? notePinLabels(all, noteNum) : undefined)
  }, [shapes, live, size, W, H, pv, noteNum])

  // The tool is for the note being written: with no draft it is off — but
  // the pin, which with no draft is "Point" (phase 11b): a click starts a
  // note on that frame with its pin 1.
  useEffect(() => {
    if (!draft && tool && tool !== 'pin') useStore.getState().setNoteTool(null)
  }, [draft, tool])
  const pressAt = useRef<[number, number] | null>(null)
  const moved = useRef(0)
  /** The film was playing when this press stopped it (the quick note plays on). */
  const wasPlaying = useRef(false)
  /** The watch mode's last click on the film (a second one soon after is a double click). */
  const lastClick = useRef<{ at: number; x: number; y: number; time: number; playing: boolean } | null>(null)

  const pointAt = (e: React.PointerEvent): [number, number] => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const box = frameBox(r.width, r.height, W, H, useStore.getState().previewView)
    const clamp = (v: number): number => Math.min(1, Math.max(0, v))
    return [clamp((e.clientX - r.left - box.left) / box.w), clamp((e.clientY - r.top - box.top) / box.h)]
  }

  const down = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    let s = useStore.getState()
    if (e.button !== 0 || !tool) return
    wasPlaying.current = s.playing
    // The watch mode (kullanım, item 6): a click on the film plays or
    // stops it; a double click puts a note's pin there, on the frame and in
    // the state the first click found (N and the "Note" button also start one).
    if (useWatch.getState().on && !s.noteDraft && tool === 'pin') {
      const now = performance.now()
      const last = lastClick.current
      const double = !!last && now - last.at < DOUBLE_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8
      if (!double) {
        lastClick.current = { at: now, x: e.clientX, y: e.clientY, time: s.currentTime, playing: s.playing }
        e.preventDefault()
        s.setPlaying(!s.playing)
        return
      }
      lastClick.current = null
      s.setPlaying(false)
      s.setTime(last.time)
      wasPlaying.current = last.playing
    }
    // "Point" with no note yet: the click starts one here (its range is the
    // playhead's frame, as the Notes tab's "New note" makes it).
    if (!s.noteDraft && tool === 'pin') {
      s.setPlaying(false)
      s.startNoteDraft()
      s = useStore.getState()
    }
    const d = s.noteDraft
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    s.setPlaying(false)
    // A note's drawing is on one frame: with strokes already made elsewhere,
    // the first press only goes back to that frame.
    if (d.shapes.length > 0 && d.at !== undefined && !onFrame(s.currentTime, d.at, fps)) {
      s.setTime(d.at)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const pt = pointAt(e)
    pressAt.current = [e.clientX, e.clientY]
    moved.current = 0
    const shape: NoteShape = { type: tool, pts: tool === 'pen' || tool === 'pin' ? [pt] : [pt, pt], color: s.noteColor }
    liveRef.current = shape
    setLive(shape)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cur = liveRef.current
    if (!cur) return
    if (pressAt.current) moved.current = Math.max(moved.current, Math.hypot(e.clientX - pressAt.current[0], e.clientY - pressAt.current[1]))
    if (cur.type === 'pin') return
    const pt = pointAt(e)
    const next: NoteShape = cur.type === 'pen' ? { ...cur, pts: [...cur.pts, pt] } : { ...cur, pts: [cur.pts[0], pt] }
    liveRef.current = next
    setLive(next)
  }
  const up = (): void => {
    const cur = liveRef.current
    liveRef.current = null
    setLive(null)
    if (!cur) return
    // A press that hardly moved is a click: a pin, whatever the tool (phase 11b).
    const shape = shapeOfStroke(cur, moved.current)
    pressAt.current = null
    if (!worthKeeping(shape)) return
    const s = useStore.getState()
    const d = s.noteDraft
    if (!d) return
    s.patchNoteDraft({ shapes: [...d.shapes, shape], at: d.shapes.length > 0 && d.at !== undefined ? d.at : s.currentTime })
    // A pin a click put down: the box to say what is there opens beside it
    // (ONIZLEME-UYGULA-PLAN.md, K7; VideoHub's click-and-type note).
    if (shape.type === 'pin') usePreviewUi.getState().setQuickNote({ x: shape.pts[0][0], y: shape.pts[0][1], wasPlaying: wasPlaying.current })
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`note-draw-layer${tool && (draft || tool === 'pin') ? ' drawing' : ''}`}
        data-testid="notes.draw.layer"
        data-shapes={shapes?.length ?? 0}
        data-pins={shapes ? (noteNum !== null ? notePinLabels(shapes, noteNum) : pinNumbers(shapes).map((n) => (n === null ? null : String(n)))).filter((x) => x !== null).join(' ') : ''}
        aria-hidden="true"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {draft && (
        <div className="note-draw-bar" role="toolbar" aria-label={t('notes.draw.bar')} onPointerDown={(e) => e.stopPropagation()}>
          <span className="note-draw-title">{t('notes.draw.title')}</span>
          <NoteToolButtons compact />
          {draft.shapes.length > 0 && !draftOnFrame && (
            <ToolButton variant="secondary" label={t('notes.draw.back')} hint={t('notes.draw.back.hint')} onClick={() => { const s = useStore.getState(); if (s.noteDraft?.at !== undefined) { s.setPlaying(false); s.setTime(s.noteDraft.at) } }} />
          )}
        </div>
      )}
    </>
  )
}
