// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { engine } from '../playback/engine'
import { clipTransformAt, clipVisualPoseAt, maskGeomAt, renderFrame, shortsWindowAt, traceMaskPath, trackerPosAt, visibleClips, type SourceResolver } from '../playback/render'
import { getFramesVersion, releaseCompareFrames } from '../playback/scrub'
import { scaleClipFromCentre, scaleClipFromCorner } from '../playback/clip-grip'
import { DRAG_THRESHOLD, HANDLE_ACCENT, HANDLE_HIT, drawAngleTag, drawDot, drawGrip, drawKnob, drawTag, handleReach, nearestHandle, nearestOnSegment, pastThreshold, resizeCursor, snapAngle, turnCursor, turnFrom } from '../ui/handles'
import { useStore } from '../state/store'
import type { Caption, Clip } from '../types'
import { assetById, isSubtitle, templateEnd, uid } from '../types'
import { WordTimingEditor } from './WordTimingEditor'
import { prerenderedFrame, prerenderSome } from '../playback/prerender'
import { prerenderOn } from '../playback/prerender-switch'
import { shownProject, showingCandidate } from '../playback/candidate'
import { zoomAround } from './preview/zoom'
import { NarrationLine, PreviewExtras } from './preview/PreviewExtras'
import { compareLayout } from './preview/compare'
import { compareResolver, drawCompared } from './preview/compare-draw'
import { compareMode, wipeAt } from '../playback/candidate'
import { atlasCamera, placeable, setAtlasKey } from '../templates/model'
import { mapPointAt } from '../templates/map'
import { markerCoversWord, remapMarkedWords, toggleMarkedWords, wordIndicesAtSelection } from '../subtitles/marker'
import { captionMarker, toggleKeyWords } from '../subtitles/keywords'
import { NoteDrawLayer } from './NoteDrawLayer'
import { AgentPreviewLayer } from './agent/AgentLayers'
import { NoteReviewBar } from './NoteReviewBar'
import { pickKeyColour } from './inspector/chroma-pick'
import { localToWorld, worldToLocal, maskCornerScreen, maskHandlePoints, maskRotateGrip, rotateGrip, captionAngle, insideCaptionBox, manualCaptionBox, worldToScreen, screenToWorld, clipBBox, hitTestClip, placedTemplateBox, activeCaptionStyle } from './preview/geometry'
import type { ViewXform } from './preview/geometry'
import { doubleClickText, dragText, drawTextOverlay, hoverText, nudgeText, pressText, typeSelected, typingSignature } from './preview/text-edit/interaction'
import { boxTargets, frameTargets, snapMove, type GuideLine } from './preview/text-edit/guides'
import { draftProject, startTyping, typable, typing, useTextEdit } from './preview/text-edit/session'
import { TextEditLayer } from './preview/text-edit/TextEditLayer'
import type { DragState } from './preview/drag-state'
import { maskFeatherGrip } from './preview/geometry'
import { CROP_HANDLES, boxHandlePoints, cropBox, cropFromHandle, cropMoved } from './preview/crop'
import { SAFE_INSETS, usePreviewUi } from './preview/pv-ui'
import { gestureMark, takeBackGesture } from './preview/gesture'
import { Button, IconButton, Tooltip, notify, t as say, useT } from '../ui'
import { loadBindings, modalOpen, shortcutsAllowed } from '../shortcuts'
import { BareButton } from '../ui/Button'
import { fmtPct } from '../ui/format'
import { overlayFontStack } from '../os-platform'

/** The most soft edge the handle gives a mask (the Inspector's slider ends here too). */
const FEATHER_MAX = 120

/** The stage around the picture: --bg-stage of ui/tokens.css, read once. */
let stage: string | null = null
function stageColour(): string {
  if (stage === null) stage = getComputedStyle(document.documentElement).getPropertyValue('--bg-stage').trim() || '#0C0C0E'
  return stage
}
/** When the Alt + drag note was last shown (it moved the preview before cila A). */
let panNoteAt = -Infinity

export function PreviewCanvas(): JSX.Element {
  const tr = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufferRef = useRef<OffscreenCanvas | null>(null)
  /** The comparison's before (ONIZLEME-UYGULA-PLAN.md, K8), the live
   *  project it was drawn from, and whether a comparison was on screen. */
  const bufferBRef = useRef<OffscreenCanvas | null>(null)
  const compareLiveRef = useRef<unknown>(null)
  const comparedRef = useRef(false)
  /** Adaptive preview scale multiplier (1 = the user's chosen quality). */
  const adaptRef = useRef(1)
  // Skip-redraw bookkeeping (see the paused fast-path in draw()).
  const lastSigRef = useRef('')
  const projectRef = useRef<unknown>(null)
  const dragRef = useRef<DragState | null>(null)
  const xfRef = useRef<ViewXform | null>(null)
  const guidesRef = useRef<GuideLine[]>([])
  /** The canvas's CSS size as the draw measured it (a ResizeObserver keeps it):
   *  the handles are hit where they are drawn, with no layout read per move. */
  const sizeRef = useRef({ cw: 0, ch: 0 })
  /** The interaction's pending pointer move, applied by the draw: one write
   *  of the project per drawn frame however fast the pointer reports. */
  const flushRef = useRef<(() => void) | null>(null)
  /** What the pointer is on (a handle's name), for its lit state. */
  const hotRef = useRef('')
  /** Where a click would put a new point on a pen mask (screen px). */
  const ghostRef = useRef<[number, number] | null>(null)
  /** Bumped when something only the overlay shows changed (a lit handle, a
   *  drag's start or end): the paused preview draws again. */
  const uiTickRef = useRef(0)
  /** The preview buffer's scale while a drag's frames run over budget (1 =
   *  full; the frame after the release is drawn in full again). */
  const draftRef = useRef({ level: 1, over: 0 })
  /** Until when the place of a nudged thing is shown beside it (an arrow key
   *  has no pointer to show that something moved). */
  const nudgedRef = useRef(0)
  /** Manual text under the pointer (drives the hover outline + cursor). */
  const hoverCapRef = useRef<string | null>(null)
  const capEditInputRef = useRef<HTMLTextAreaElement>(null)
  const capEditWrapRef = useRef<HTMLDivElement>(null)
  const splittingCaptionRef = useRef(false)
  /** The subtitle window's field has had its first focus (its words selected then). */
  const capOpened = useRef(false)
  const [capEdit, setCapEdit] = useState<{ id: string; x: number; y: number; text: string } | null>(null)
  const [wordTimingOpen, setWordTimingOpen] = useState(false)
  const [timingSelectedWordIndex, setTimingSelectedWordIndex] = useState<number | null>(null)
  const [markerPickerOpen, setMarkerPickerOpen] = useState(false)
  const timingCaption = useStore((state) => capEdit ? state.project.captions.find((caption) => caption.id === capEdit.id) : undefined)
  // The marker the edited line shows: its own, or its key words.
  const allCaptions = useStore((state) => state.project.captions)
  const capBase = useStore((state) => activeCaptionStyle(state.project))
  const timingMarker = timingCaption ? captionMarker(timingCaption, allCaptions, capBase) : undefined

  /**
   * A double-click on a chip in the timeline asks for the same editor. Auto
   * captions could always be fixed that way in the preview; a title you had
   * placed yourself could not be edited from the timeline at all.
   */
  // The green screen's eyedropper taken up or put down: the picking cursor
  // at once, before the pointer moves (DENEME-1, P6).
  const eyedropper = useStore((s) => s.eyedropperClip)
  useEffect(() => {
    const cv = canvasRef.current
    if (cv) cv.style.cursor = eyedropper ? 'crosshair' : ''
  }, [eyedropper])
  // Its clip let go (another clip picked, a click on the empty timeline): the
  // eyedropper is put down, and said (22 November, L12). It stayed up with
  // its card gone from the Inspector, and the next click on the preview
  // keyed a clip nobody was looking at.
  const eyedropperHeld = useStore((s) => !s.eyedropperClip || s.selectedClipIds.includes(s.eyedropperClip))
  useEffect(() => {
    if (eyedropperHeld) return
    useStore.getState().setEyedropper(null)
    notify({ text: say('d22d.dropper.away'), kind: 'info' })
  }, [eyedropperHeld])
  const editRequest = useStore((s) => s.captionEditRequest)
  useEffect(() => {
    if (!editRequest) return
    const s = useStore.getState()
    const cap = s.project.captions.find((c) => c.id === editRequest)
    s.requestCaptionEdit(null)
    if (!cap || cap.shape) return
    // A title: typed where it stands (text-edit; YAZI2-PLAN.md, 2.7).
    if (typable(cap)) {
      startTyping(cap.id, 'all')
      return
    }
    // The editor sits over the picture, so the playhead has to be inside the
    // caption for there to be anything to sit over.
    if (s.currentTime < cap.start || s.currentTime >= cap.end) s.setTime(cap.start + 0.01)
    s.selectCaptions([cap.id])
    openCaptionEditor(cap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  // Double-click a subtitle in the preview to edit its text in place.
  const onDoubleClick = (e?: React.MouseEvent) => {
    const s = useStore.getState()
    // Finishing a hand-drawn mask.
    if (s.maskDrawMode) {
      s.setMaskDrawMode(false)
      return
    }
    // Pen mask (its outline on screen): a double-click near the outline adds
    // a point on the nearest side. Not on a point (the first click of the two
    // has just put or picked one up there), and not far from the mask: a
    // double-click on a subtitle still opens it.
    if (e) {
      const mc = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
      const canvasEl = canvasRef.current
      const shown = s.maskOverlay === 'on' || (s.maskOverlay === 'auto' && s.clipTabActive && !s.playing)
      if (mc?.mask?.enabled && mc.mask.shape === 'path' && canvasEl && shown) {
        const xf = xfRef.current
        if (xf) {
          const rect = canvasEl.getBoundingClientRect()
          const sx = e.clientX - rect.left
          const sy = e.clientY - rect.top
          const [wx, wy] = screenToWorld(xf, sx, sy)
          const t = clipTransformAt(mc, s.currentTime - mc.start)
          const [lx, ly] = worldToLocal(t, wx, wy)
          const g = maskGeomAt(mc.mask, s.currentTime - mc.start)
          const pts = g.points ?? []
          if (pts.length >= 3) {
            const scr = pts.map((q): [number, number] => {
              const [px, py] = localToWorld(t, q.x, q.y)
              return worldToScreen(xf, px, py)
            })
            if (nearestHandle(scr, sx, sy, HANDLE_HIT) >= 0) return
            let best = 0
            let bd = Infinity
            for (let i = 0; i < scr.length; i++) {
              const d = nearestOnSegment(scr[i], scr[(i + 1) % scr.length], [sx, sy]).d
              if (d < bd) {
                bd = d
                best = i
              }
            }
            if (bd <= 24) {
              const points = [...pts]
              points.splice(best + 1, 0, { x: lx, y: ly })
              s.undoable(() => s.editMaskGeom(mc.id, { points }))
              return
            }
          }
        }
      }
    }
    // A title is typed in where it stands; a shape has no words to fix
    // (text-edit: YAZI2-PLAN.md, 2.2 and 2.5).
    const xfNow = xfRef.current
    const canvasNow = canvasRef.current
    if (e && xfNow && canvasNow) {
      const r = canvasNow.getBoundingClientRect()
      if (doubleClickText(xfNow, e.clientX - r.left, e.clientY - r.top)) return
    }
    // A subtitle line: the one under the pointer. (This used to take the
    // first ACTIVE caption whatever it was and wherever you clicked: a
    // double-click on empty picture opened a title's editor.)
    const live = (c: Caption): boolean => !c.manual && !c.shape && s.currentTime >= c.start && s.currentTime < c.end
    let caption: Caption | undefined
    if (e && xfNow && canvasNow) {
      const r = canvasNow.getBoundingClientRect()
      const [dwx, dwy] = screenToWorld(xfNow, e.clientX - r.left, e.clientY - r.top)
      caption = s.project.captions.find(
        (c) =>
          live(c) &&
          insideCaptionBox(
            manualCaptionBox(s.project, c, s.currentTime),
            captionAngle(s.project, c, s.currentTime),
            dwx,
            dwy,
            12 / xfNow.k
          )
      )
    }
    // Nothing under the pointer: fall back to the subtitle showing right now,
    // which is what makes "double-click and fix the misheard word" work.
    caption ??= s.project.captions.find(live)
    if (!caption) return
    openCaptionEditor(caption)
  }

  /** Puts the in-place editor over the caption. Shared, because the timeline
   *  asks for the same thing when a chip is double-clicked. */
  const openCaptionEditor = (caption: Caption): void => {
    const s = useStore.getState()
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = s.project.settings
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const x = cw / 2
    const fit = Math.min(cw / width, ch / height)
    const dh = height * fit
    const style = caption.style ?? s.project.captionStyle
    const y = (ch - dh) / 2 + style.posY * dh
    s.setPlaying(false)
    // The editor is multi-line now; leave enough room for its wrapped text,
    // split controls and hint when the caption sits near the bottom edge.
    setWordTimingOpen(false)
    setTimingSelectedWordIndex(null)
    setMarkerPickerOpen(false)
    capOpened.current = false
    setCapEdit({ id: caption.id, x, y: Math.min(ch - 86, Math.max(86, y)), text: caption.text })
  }

  const saveCapEdit = () => {
    if (capEdit) {
      const text = capEdit.text.trim()
      const store = useStore.getState()
      const current = store.project.captions.find((caption) => caption.id === capEdit.id)
      if (text && current && text !== current.text) store.updateCaption(capEdit.id, { text })
      else if (!text) store.deleteCaption(capEdit.id)
    }
    setWordTimingOpen(false)
    setTimingSelectedWordIndex(null)
    setMarkerPickerOpen(false)
    setCapEdit(null)
  }

  const markCapWords = (indices: number[]): void => {
    if (!capEdit) return
    const store = useStore.getState()
    const current = store.project.captions.find((caption) => caption.id === capEdit.id)
    if (!current) return
    if (!indices.length) return
    const targetIndices = capEdit.text.trim() === current.text
      ? indices
      : remapMarkedWords(capEdit.text, current.text, indices)
    // A subtitle with key words on: your choice is kept on the line, and it
    // keeps the subtitles' own look.
    const base = activeCaptionStyle(store.project)
    if (!current.style && isSubtitle(current) && base.keyMark?.enabled) {
      const now = captionMarker(current, store.project.captions, base)?.words ?? []
      store.updateCaption(capEdit.id, { marks: toggleKeyWords(now, targetIndices) })
      return
    }
    store.undoable(() => {
      store.setCaptionOwnStyle(capEdit.id, {
        marker: toggleMarkedWords(current.style?.marker, targetIndices)
      })
    })
  }

  const toggleCapMarker = (): void => {
    if (!capEdit) return
    const selection = capEditInputRef.current
    // A deliberate text selection applies immediately. With only a caret,
    // open the word picker instead of silently marking an arbitrary word.
    if (selection && selection.selectionStart !== selection.selectionEnd) {
      markCapWords(wordIndicesAtSelection(capEdit.text, selection.selectionStart, selection.selectionEnd))
      setMarkerPickerOpen(true)
    } else {
      setMarkerPickerOpen((open) => !open)
    }
  }

  const splitCapEdit = (cursorOverride?: number) => {
    if (!capEdit || splittingCaptionRef.current) return
    const edit = capEdit
    const nextSelectedWord = wordTimingOpen && timingSelectedWordIndex !== null
      ? [...edit.text.matchAll(/\S+/gu)][timingSelectedWordIndex + 1]
      : undefined
    if (cursorOverride === undefined && wordTimingOpen && timingSelectedWordIndex !== null && !nextSelectedWord) return
    const cursor = cursorOverride ?? nextSelectedWord?.index ?? capEditInputRef.current?.selectionStart ?? edit.text.length
    splittingCaptionRef.current = true
    // Transcription already refined these timestamps once. Re-running onset
    // detection here can jump to a pause inside a spoken word, and also makes
    // the split depend on an asynchronous audio decode while the editor is up.
    const rightId = useStore.getState().splitCaptionAtCursor(edit.id, edit.text, cursor)
    if (!rightId) {
      splittingCaptionRef.current = false
      return
    }
    setWordTimingOpen(false)
    setTimingSelectedWordIndex(null)
    setMarkerPickerOpen(false)
    setCapEdit(null)
    // Unmounting the input can emit blur. Keep that blur from saving the old,
    // unsplit text back over the left cue, then release the guard next frame.
    requestAnimationFrame(() => {
      splittingCaptionRef.current = false
    })
  }

  // Clicking a scrollbar or word handle can blur the textarea without leaving
  // the editor. While timing is open, close only on an actual outside click.
  useEffect(() => {
    if (!capEdit || !wordTimingOpen) return
    const onOutside = (event: PointerEvent): void => {
      if (!capEditWrapRef.current?.contains(event.target as Node)) saveCapEdit()
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capEdit, wordTimingOpen])

  // ------------------------------------------------------------------ draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    /**
     * The canvas's CSS size, measured only when it actually changes.
     *
     * clientWidth/clientHeight are layout reads, and the playhead writes to the
     * DOM on every tick — so reading them inside the draw forced a synchronous
     * reflow of the whole window 60 times a second, with a timeline of hundreds
     * of clips to lay out each time. That cost lands in the preview's frame
     * budget, and it is the kind of stutter no amount of decoding work
     * explains. The ResizeObserver already knows when the size changed.
     */
    const size = { cw: 0, ch: 0 }
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const { clientWidth, clientHeight } = canvas
      size.cw = clientWidth
      size.ch = clientHeight
      sizeRef.current = { cw: clientWidth, ch: clientHeight }
      canvas.width = Math.max(2, Math.round(clientWidth * dpr))
      canvas.height = Math.max(2, Math.round(clientHeight * dpr))
    }
    // Setting the size clears the canvas, and the observer runs after this
    // frame's draw: so it draws again at once, or a resized preview shows a
    // frame of nothing.
    const ro = new ResizeObserver(() => {
      resize()
      if (lastResolve) draw(lastResolve)
    })
    ro.observe(canvas)
    resize()

    const getXform = (): ViewXform => {
      const s = useStore.getState()
      const { width, height } = s.project.settings
      const { cw, ch } = size
      const pv = s.previewView
      const k = Math.min(cw / width, ch / height) * pv.zoom
      // Preview pan offsets (screen px) folded into the world center.
      return { cx: width / 2 - pv.x / k, cy: height / 2 - pv.y / k, k, cw, ch }
    }

    // The heavy parts made ahead while nothing plays and nothing is being
    // edited (see prerender.ts) — with the resolver the last draw had.
    let lastResolve: SourceResolver | null = null
    let lastProject = useStore.getState().project
    let lastTime = useStore.getState().currentTime
    let changedAt = performance.now()
    let working = false
    const idle = window.setInterval(() => {
      const s = useStore.getState()
      // An edit, or the playhead moved (scrubbing): wait until it rests.
      if (s.project !== lastProject || s.currentTime !== lastTime) {
        lastProject = s.project
        lastTime = s.currentTime
        changedAt = performance.now()
        return
      }
      // Not beside a transcription or an export: they need the main thread
      // and the memory, and the frames would only be made again after them.
      if (s.transcribeStatus || (s.exportStatus && !s.exportStatus.done)) return
      if (working || s.playing || !lastResolve || !prerenderOn() || document.visibilityState !== 'visible') return
      if (performance.now() - changedAt < 1500) return
      working = true
      void prerenderSome(s.project, lastResolve, 14)
        .catch(() => undefined)
        .finally(() => {
          working = false
        })
    }, 120)

    const draw = (resolve: SourceResolver) => {
      lastResolve = resolve
      // A drag's last pointer move is applied here, once per drawn frame
      // (cila A): the project is written and drawn in the same frame.
      flushRef.current?.()
      const s = useStore.getState()
      const pvUi = usePreviewUi.getState()
      // A drag in progress (past its threshold; not the view's own pan).
      const live = dragRef.current
      const interacting = !!live?.moved && live.kind !== 'preview-pan'
      if (!interacting && draftRef.current.level !== 1) draftRef.current = { level: 1, over: 0 }
      const { currentTime } = s
      // The candidate project when one is shown (playback/candidate.ts): it is
      // drawn and played, the store's project is left as it is.
      const project = shownProject(s.project)
      const candidateShown = project !== s.project
      // A title being typed in is drawn with the words typed so far (the
      // project gets them when the typing ends: text-edit/session.ts).
      const drawn = candidateShown ? project : draftProject(project)
      // Before and after at once (ONIZLEME-UYGULA-PLAN.md, K8): the after
      // (the candidate) as always, the before (the store's project) beside,
      // under or against it. Off: the draw below is the one it always was.
      const cmp = candidateShown ? compareMode() : 'off'
      if (cmp === 'off' && comparedRef.current) {
        comparedRef.current = false
        releaseCompareFrames()
        if (usePreviewUi.getState().compareDraft) usePreviewUi.setState({ compareDraft: false })
      }
      const { width, height } = project.settings
      const dpr = window.devicePixelRatio || 1
      const { cw, ch } = size

      // While PAUSED, recompositing 60×/second when nothing has changed is pure
      // waste — it kept a core busy and the fans on just sitting on a frame.
      // `project` is replaced on every edit so its identity is the revision, and
      // the decoder bumps its own counter when a sharper frame lands.
      if (!s.playing) {
        // EVERY piece of state the draw reads has to be in here — anything
        // missed shows up as a preview that refuses to update.
        const sig = [
          currentTime,
          s.previewQuality,
          s.adaptiveQuality,
          s.showGuideOverlay,
          s.clipTabActive,
          s.maskDrawMode,
          s.maskOverlay,
          s.selectedTrackerId,
          s.templateSel,
          s.selectedClipIds.join(','),
          s.selectedCaptionIds.join(','),
          s.previewView.zoom,
          s.previewView.x,
          s.previewView.y,
          cw,
          ch,
          dpr,
          getFramesVersion(),
          uiTickRef.current,
          pvUi.cropMode,
          pvUi.safeGuides,
          interacting,
          draftRef.current.level,
          cmp,
          cmp === 'off' ? '' : wipeAt(),
          typingSignature()
        ].join('|')
        if (sig === lastSigRef.current && projectRef.current === drawn && (cmp === 'off' || compareLiveRef.current === s.project)) return
        lastSigRef.current = sig
        projectRef.current = drawn
        compareLiveRef.current = cmp === 'off' ? null : s.project
      } else {
        lastSigRef.current = ''
      }
      // ResizeObserver callbacks can be throttled (e.g. occluded window);
      // verify the backing store every tick so drawing never goes stale.
      if (canvas.width !== Math.max(2, Math.round(cw * dpr)) || canvas.height !== Math.max(2, Math.round(ch * dpr))) {
        resize()
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Outside-the-frame area: the stage's tone (ui/tokens.css --bg-stage,
      // read once), so the picture stands on the same ground as its card.
      ctx.fillStyle = stageColour()
      ctx.fillRect(0, 0, cw, ch)
      const xf = getXform()
      xfRef.current = xf

      {
        // Final-output view: render at (scaled) project resolution, then
        // blit with the preview zoom/pan applied. previewQuality only lowers
        // this preview buffer — exports always render at full resolution.
        // Adaptive quality: if frames run over budget while playing, quietly
        // shrink the preview buffer and restore it once there's headroom
        // again. Never touches export, which always renders full resolution.
        // Never render more pixels than end up on screen. The buffer used to be
        // full project resolution (1920×1080) and was then blitted into a canvas
        // a third that size — roughly 7× the pixels for no visible gain. Export
        // is untouched: it renders at full resolution through the same code.
        const layout = cmp === 'off' ? null : compareLayout(cmp, cw, ch, width, height, s.previewView)
        const shownW = layout ? layout.after.w * dpr : Math.min(cw, (width / height) * ch) * (s.previewView.zoom || 1) * dpr
        const fitQ = Math.min(1, Math.max(0.2, shownW / width))
        // Snapped to 1/16 steps. The buffer below is thrown away and rebuilt
        // whenever its pixel size changes, and an adaptive scale that drifts by
        // a few percent per frame changed it EVERY frame — allocating a fresh
        // GPU-backed canvas every frame to save a bit of fill rate, which is
        // the opposite of what adaptive quality is for.
        // While something is dragged and its frames run over budget, the
        // buffer is drawn smaller (a draft); the frame after the release is
        // full again (`interacting` is part of the signature above).
        const draft = interacting ? draftRef.current.level : 1
        const rawQ = Math.min(1, s.previewQuality * adaptRef.current, fitQ) * draft
        const q = Math.max(0.2, Math.round(rawQ * 16) / 16)
        const bw = Math.max(2, Math.round(width * q))
        const bh = Math.max(2, Math.round(height * q))
        let buffer = bufferRef.current
        if (!buffer || buffer.width !== bw || buffer.height !== bh) {
          buffer = new OffscreenCanvas(bw, bh)
          bufferRef.current = buffer
        }
        const bctx = buffer.getContext('2d')!
        const t0 = performance.now()
        // Playing through a heavy part made ahead: its frame, not a live draw.
        const ahead = s.playing && prerenderOn() && !candidateShown ? prerenderedFrame(project, currentTime) : null
        if (ahead) {
          bctx.setTransform(1, 0, 0, 1, 0, 0)
          bctx.drawImage(ahead, 0, 0, bw, bh)
        } else renderFrame(bctx, drawn, currentTime, resolve, { scale: q, quality: s.playing ? 'draft' : 'refine' })
        // The before, into a buffer of its own at the same scale.
        let before: OffscreenCanvas | null = null
        if (layout) {
          comparedRef.current = true
          before = bufferBRef.current
          if (!before || before.width !== bw || before.height !== bh) {
            before = new OffscreenCanvas(bw, bh)
            bufferBRef.current = before
          }
          const used = new Set<string>()
          renderFrame(before.getContext('2d')!, s.project, currentTime, compareResolver(resolve, project, currentTime, used), { scale: q, quality: s.playing ? 'draft' : 'refine' })
          releaseCompareFrames(used)
        }
        // (Both pictures count: comparing while playing lowers the buffer
        // sooner, and says so over the preview.)
        const cost = performance.now() - t0
        if (interacting && !s.playing) {
          // Two frames over 12 ms in a row: one step down (0.75, then 0.5).
          // Never back up within the drag: a picture that flickers between
          // two sharpnesses is worse than a soft one.
          const d = draftRef.current
          d.over = cost > 12 ? d.over + 1 : 0
          if (d.over >= 2 && d.level > 0.5) draftRef.current = { level: d.level > 0.75 ? 0.75 : 0.5, over: 0 }
        }
        const draftNow = String(interacting ? draftRef.current.level : 1)
        if (canvas.dataset.draft !== draftNow) canvas.dataset.draft = draftNow
        if (!s.adaptiveQuality) {
          // Switched off: the picture never changes sharpness on its own.
          adaptRef.current = 1
        } else if (s.playing) {
          const budget = 1000 / Math.max(10, project.settings.fps || 30)
          if (cost > budget * 0.8) adaptRef.current = Math.max(0.35, adaptRef.current * 0.85)
          else if (cost < budget * 0.35) adaptRef.current = Math.min(1, adaptRef.current * 1.08)
        } else {
          // Paused: no reason to hold back, ease straight back to full.
          adaptRef.current = Math.min(1, adaptRef.current * 1.25)
        }
        const pv = s.previewView
        const fit = Math.min(cw / width, ch / height) * pv.zoom
        let dw = width * fit
        let dh = height * fit
        let dx = (cw - dw) / 2 + pv.x
        let dy = (ch - dh) / 2 + pv.y
        if (!layout || !before) ctx.drawImage(buffer, dx, dy, dw, dh)
        else {
          drawCompared(ctx, cmp, buffer, before, layout, wipeAt())
          // The guides and the outline below go on the after.
          ;[dx, dy, dw, dh] = [layout.after.left, layout.after.top, layout.after.w, layout.after.h]
          const low = s.playing && adaptRef.current < 0.999
          if (usePreviewUi.getState().compareDraft !== low) usePreviewUi.setState({ compareDraft: low })
        }
        // Frame outline so the video's bounds are always visible.
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'
        ctx.lineWidth = 1
        ctx.strokeRect(dx - 0.5, dy - 0.5, dw + 1, dh + 1)
        // Composition guides: rule-of-thirds grid + a brighter centre cross.
        // Drawn on top of the frame, preview-only — never in the export.
        if (s.showGuideOverlay) {
          ctx.save()
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(255,255,255,0.28)'
          ctx.lineWidth = 1
          for (let i = 1; i <= 2; i++) {
            const gx = dx + (dw * i) / 3
            const gy = dy + (dh * i) / 3
            ctx.moveTo(gx, dy)
            ctx.lineTo(gx, dy + dh)
            ctx.moveTo(dx, gy)
            ctx.lineTo(dx + dw, gy)
          }
          ctx.stroke()
          // Centre cross, a touch brighter, with a small dot at dead centre.
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(37,208,194,0.85)'
          const mx = dx + dw / 2
          const my = dy + dh / 2
          const arm = Math.min(dw, dh) * 0.06
          ctx.moveTo(mx - arm, my)
          ctx.lineTo(mx + arm, my)
          ctx.moveTo(mx, my - arm)
          ctx.lineTo(mx, my + arm)
          ctx.stroke()
          ctx.restore()
        }
        // The safe areas: two frames inside the picture, 5 % and 10 % in
        // (titles snap to the 5 % one). Preview only, as the guides above.
        if (pvUi.safeGuides) {
          ctx.save()
          ctx.lineWidth = 1
          SAFE_INSETS.forEach((inset, i) => {
            ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)'
            ctx.setLineDash(i === 0 ? [] : [6, 4])
            ctx.strokeRect(Math.round(dx + dw * inset) + 0.5, Math.round(dy + dh * inset) + 0.5, Math.round(dw * (1 - 2 * inset)), Math.round(dh * (1 - 2 * inset)))
          })
          ctx.restore()
        }
      }

      // A candidate is only looked at: no selection, handles or guides of the
      // live project over it.
      if (candidateShown) return

      // Selection outlines + scale handle on the primary selection.
      s.selectedClipIds.forEach((selId, idx) => {
        const sel = project.clips[selId]
        const selAsset = sel ? assetById(project, sel.assetId) : null
        if (!sel || !selAsset || selAsset.kind === 'audio') return
        const t = clipVisualPoseAt(project, sel, currentTime).transform
        const w = ((selAsset.width || 2) / 2) * t.scale
        const h = ((selAsset.height || 2) / 2) * t.scale
        const corners: [number, number][] = [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h]
        ].map(([lx, ly]) => {
          const rx = lx * Math.cos(t.rotation) - ly * Math.sin(t.rotation)
          const ry = lx * Math.sin(t.rotation) + ly * Math.cos(t.rotation)
          return worldToScreen(xf, t.x + rx, t.y + ry)
        })
        const hot = hotRef.current
        // The crop mode (cila A): the whole picture's box dashed, the crop's
        // box with a handle on every corner and side; the corner handles and
        // the knob wait until the mode is left.
        const cropping = pvUi.cropMode && idx === 0 && currentTime >= sel.start && currentTime < sel.start + sel.duration
        ctx.strokeStyle = HANDLE_ACCENT
        ctx.lineWidth = 1.25
        if (cropping) ctx.setLineDash([4, 4])
        ctx.beginPath()
        corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])
        if (cropping) {
          const toScreen = ([lx, ly]: [number, number]): [number, number] => {
            const [wx, wy] = localToWorld(t, lx, ly)
            return worldToScreen(xf, wx, wy)
          }
          const box = cropBox(sel.crop, selAsset.width || 2, selAsset.height || 2, sel.flipH, sel.flipV)
          const pts = boxHandlePoints(box).map(toScreen)
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ;[0, 2, 4, 6].forEach((ci, i) => (i === 0 ? ctx.moveTo(pts[ci][0], pts[ci][1]) : ctx.lineTo(pts[ci][0], pts[ci][1])))
          ctx.closePath()
          ctx.stroke()
          pts.forEach(([hx, hy], i) => drawGrip(ctx, hx, hy, undefined, undefined, hot === `crop:${i}` || (live?.kind === 'crop' && live.handle === CROP_HANDLES[i])))
          if (live?.kind === 'crop' || live?.kind === 'crop-move') {
            const c = sel.crop ?? { l: 0, t: 0, r: 0, b: 0 }
            const pc = (v: number): string => `${Math.round(v * 100)}`
            drawTag(ctx, pts[2][0], pts[2][1], `${pc(c.l)} · ${pc(c.t)} · ${pc(c.r)} · ${pc(c.b)} %`)
          }
        } else if (idx === 0) {
          // The shared handles (ui/handles.ts): white
          // corners to size, the knob on its stem to turn round the middle,
          // and the angle beside it while turning.
          corners.forEach(([hx, hy], i) => drawGrip(ctx, hx, hy, undefined, undefined, hot === `clip:corner:${i}`))
          const { base: gb, grip: gk } = rotateGrip(xf, t.x, t.y, h, t.rotation)
          drawKnob(ctx, gb, gk, undefined, hot === 'clip:knob')
          if (live?.kind === 'rotate' && live.clipId === sel.id) drawAngleTag(ctx, gk[0], gk[1], t.rotation)
          // The size beside the corner while it is pulled.
          if (live?.kind === 'scale' && live.moved && live.clipId === sel.id && live.scaleGrip) {
            const ci = live.scaleGrip.cornerY < 0 ? (live.scaleGrip.cornerX < 0 ? 0 : 1) : live.scaleGrip.cornerX < 0 ? 3 : 2
            drawTag(ctx, corners[ci][0], corners[ci][1], fmtPct(t.scale))
          }
          // Its place for a moment after an arrow key moved it.
          if (!live && performance.now() < nudgedRef.current && s.selectedCaptionIds.length === 0) {
            const [tcx, tcy] = worldToScreen(xf, t.x, t.y)
            drawTag(ctx, tcx - 12, tcy, `${Math.round(t.x)} , ${Math.round(t.y)}`)
          }
        }
      })

      // Titles and shapes: the outline of the one the pointer is on, the
      // selection's outline, handles and knob, a typed title's caret, and the
      // lines a drag rests on (text-edit/interaction.ts).
      drawTextOverlay(ctx, s, drawn, xf, { hover: hoverCapRef.current, hot: hotRef.current, live: live ?? null, nudged: performance.now() < nudgedRef.current, guides: guidesRef.current })

      // Hand-drawing: show the in-progress polyline with numbered points.
      if (s.maskDrawMode) {
        const mc = s.selectedClipIds.length > 0 ? project.clips[s.selectedClipIds[0]] : null
        const pts = mc?.mask?.points
        if (mc && pts && pts.length > 0) {
          const t = clipTransformAt(mc, currentTime - mc.start)
          const scr = pts.map((p) => {
            const [pwx, pwy] = localToWorld(t, p.x, p.y)
            return worldToScreen(xf, pwx, pwy)
          })
          ctx.strokeStyle = '#ffd83d'
          ctx.lineWidth = 2
          ctx.beginPath()
          scr.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
          ctx.stroke()
          scr.forEach(([x, y], i) => {
            ctx.fillStyle = i === 0 ? '#ff5c6c' : '#ffd83d'
            ctx.beginPath()
            ctx.arc(x, y, i === 0 ? 8 : 5, 0, Math.PI * 2)
            ctx.fill()
          })
        }
      }

      // Mask outline + handles of the selected clip — visibility follows the
      // overlay setting (auto = only while the Clip tab is open and paused).
      const overlayVisible =
        s.maskOverlay === 'on' || (s.maskOverlay === 'auto' && s.clipTabActive && !s.playing)
      if (!s.maskDrawMode && overlayVisible) {
        const mSel = s.selectedClipIds.length > 0 ? project.clips[s.selectedClipIds[0]] : null
        if (mSel?.mask?.enabled && currentTime >= mSel.start && currentTime < mSel.start + mSel.duration) {
          const t = clipTransformAt(mSel, currentTime - mSel.start)
          const g = maskGeomAt(mSel.mask, currentTime - mSel.start)
          ctx.save()
          ctx.translate(cw / 2 - xf.cx * xf.k, ch / 2 - xf.cy * xf.k)
          ctx.scale(xf.k, xf.k)
          ctx.translate(t.x, t.y)
          ctx.rotate(t.rotation)
          ctx.scale(t.scale, t.scale)
          traceMaskPath(ctx, mSel.mask.shape, g, mSel.mask.smooth ?? 0)
          ctx.restore()
          ctx.strokeStyle = '#25d0c2'
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.stroke()
          ctx.setLineDash([])
          // The mask's handles (cila A): the sizes and the lit state of every
          // other handle (ui/handles.ts), in the mask's own colour.
          const MASK = '#25d0c2'
          const hot = hotRef.current
          const isPath = mSel.mask.shape === 'path' && !!g.points
          if (isPath && g.points) {
            g.points.forEach((p, i) => {
              const [pwx, pwy] = localToWorld(t, p.x, p.y)
              const [hx, hy] = worldToScreen(xf, pwx, pwy)
              drawDot(ctx, hx, hy, MASK, undefined, hot === `mask:pt:${i}` || (live?.kind === 'mask-point' && live.maskPointIdx === i))
            })
            // Where a click would put a new point.
            const ghost = ghostRef.current
            if (ghost && hot === 'mask:seg') {
              ctx.save()
              ctx.globalAlpha = 0.85
              drawDot(ctx, ghost[0], ghost[1], MASK, 9, true)
              ctx.restore()
            }
          } else {
            // The same furniture a clip or a text gets: a square on each
            // corner and a grip to turn it. One handle in one corner told you
            // nothing about which way the mask was facing, and there was no
            // way to face it any other way.
            maskHandlePoints(t, g, xf).forEach(([hx, hy], i) => drawGrip(ctx, hx, hy, MASK, undefined, hot === `mask:corner:${i}`))
            const [gx, gy] = maskRotateGrip(t, g, xf)
            drawKnob(ctx, maskCornerScreen(t, g, xf, 0, -1), [gx, gy], MASK, hot === 'mask:knob')
            if (live?.kind === 'mask-rotate') drawAngleTag(ctx, gx, gy, g.rot ?? 0, MASK)
          }
          // The soft edge: a handle out of the mask's side, as far out as the
          // edge is soft; pulled away it softens, pushed back it hardens.
          {
            const f = maskFeatherGrip(t, g, mSel.mask.feather, xf, isPath)
            ctx.save()
            ctx.strokeStyle = MASK
            ctx.lineWidth = 1.5
            ctx.setLineDash([2, 3])
            ctx.beginPath()
            ctx.moveTo(f.base[0], f.base[1])
            ctx.lineTo(f.grip[0], f.grip[1])
            ctx.stroke()
            ctx.restore()
            const on = hot === 'mask:feather' || live?.kind === 'mask-feather'
            drawDot(ctx, f.grip[0], f.grip[1], MASK, 10, on)
            if (on) drawTag(ctx, f.grip[0], f.grip[1], mSel.mask.feather < 0.5 ? '0' : mSel.mask.feather.toFixed(0), MASK)
          }
        }
      }

      // Selected motion tracker: circle with a crosshair.
      if (s.selectedTrackerId) {
        const trk = project.trackers?.find((tk) => tk.id === s.selectedTrackerId)
        if (trk && trk.keyframes.length > 0) {
          const kfs = [...trk.keyframes].sort((a, b) => a.time - b.time)
          const pos = trackerPosAt(kfs, currentTime)
          const [tx, ty] = worldToScreen(xf, pos.x, pos.y)
          ctx.strokeStyle = '#ffb454'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(tx, ty, 20, 0, Math.PI * 2)
          ctx.stroke()
          ctx.beginPath()
          ctx.moveTo(tx - 12, ty)
          ctx.lineTo(tx + 12, ty)
          ctx.moveTo(tx, ty - 12)
          ctx.lineTo(tx, ty + 12)
          ctx.stroke()
          ctx.fillStyle = '#ffb454'
          ctx.font = `11px ${overlayFontStack()}`
          ctx.textAlign = 'left'
          ctx.fillText(`${trk.name} · ${trk.keyframes.length} kf`, tx + 26, ty - 6)
        }
      }

      // The selected template, when it can be placed: its box to drag, and a
      // corner to scale it by.
      {
        const tb = s.templateSel ? project.templates?.find((x) => x.id === s.templateSel) : undefined
        if (tb && placeable(tb.kind) && currentTime >= tb.start && currentTime < templateEnd(tb)) {
          const bx = placedTemplateBox(project, tb, currentTime)
          const [ax, ay] = worldToScreen(xf, bx.x0, bx.y0)
          const [hx, hy] = worldToScreen(xf, bx.x1, bx.y1)
          ctx.save()
          ctx.strokeStyle = 'rgba(255,207,92,0.85)'
          ctx.setLineDash([6, 5])
          ctx.lineWidth = 1.5
          ctx.strokeRect(ax, ay, hx - ax, hy - ay)
          ctx.setLineDash([])
          ctx.fillStyle = 'rgba(20,22,30,0.85)'
          ctx.strokeStyle = '#ffcf5c'
          ctx.lineWidth = 2
          ctx.fillRect(hx - 7, hy - 7, 14, 14)
          ctx.strokeRect(hx - 7, hy - 7, 14, 14)
          ctx.restore()
        }
      }

    }

    engine.onDraw = draw
    engine.start()
    return () => {
      window.clearInterval(idle)
      ro.disconnect()
      if (engine.onDraw === draw) engine.onDraw = null
    }
  }, [])

  // ----------------------------------------------------------- interaction
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // The canvas's place in the window, measured at a press and while the
    // pointer hovers (never during a drag: the pointer is captured, and a
    // layout read per move forced a reflow of the window per move). Its size
    // is the one the draw measured (sizeRef).
    const geom = { left: 0, top: 0 }
    const measure = (): void => {
      const r = canvas.getBoundingClientRect()
      geom.left = r.left
      geom.top = r.top
    }
    const getXf = (): ViewXform => {
      const s = useStore.getState()
      const { width, height } = s.project.settings
      const { cw, ch } = sizeRef.current
      const pv = s.previewView
      const k = Math.min(cw / width, ch / height) * pv.zoom
      // Frame centre, offset by however far the preview has been panned.
      return { cx: width / 2 - pv.x / k, cy: height / 2 - pv.y / k, k, cw, ch }
    }

    const applySnap = (clip: Clip, nx: number, ny: number, xf: ViewXform): [number, number] => {
      const s = useStore.getState()
      const { project } = s
      const snap = project.snap
      guidesRef.current = []
      if (!snap.enabled) return [nx, ny]
      const threshold = snap.distance / xf.k

      const base = clipTransformAt(clip, s.currentTime - clip.start)
      const visual = clipVisualPoseAt(project, clip, s.currentTime).transform
      const box = clipBBox(project, clip, { ...visual, x: visual.x + nx - base.x, y: visual.y + ny - base.y })
      if (!box) return [nx, ny]

      // The frame's lines and the other pictures' (text-edit/guides.ts: the
      // one sum for a picture, a title and a shape).
      const { width, height } = project.settings
      const o = { centres: snap.snapCenters, edges: snap.snapEdges }
      const targets = frameTargets(width, height, o)
      for (const other of visibleClips(project, s.currentTime)) {
        if (other.id === clip.id) continue
        const ob = clipBBox(project, other, clipVisualPoseAt(project, other, s.currentTime).transform)
        if (ob) targets.push(...boxTargets(ob, o))
      }
      const caught = snapMove(box, targets, threshold)
      guidesRef.current = caught.guides
      return [nx + caught.dx, ny + caught.dy]
    }

    /** The mask's outline and handles are on screen (the draw's own rule):
     *  only then is the mask what a press edits. */
    const maskShown = (s: ReturnType<typeof useStore.getState>): boolean =>
      !s.maskDrawMode && (s.maskOverlay === 'on' || (s.maskOverlay === 'auto' && s.clipTabActive && !s.playing))
    /** The selected clip with a picture under the playhead, and its media. */
    const pictureSel = (s: ReturnType<typeof useStore.getState>): { clip: Clip; w: number; h: number } | null => {
      const clip = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
      const asset = clip ? assetById(s.project, clip.assetId) : null
      if (!clip || !asset || asset.kind === 'audio') return null
      if (s.currentTime < clip.start || s.currentTime >= clip.start + clip.duration) return null
      return { clip, w: asset.width || 2, h: asset.height || 2 }
    }
    /** The way a box handle pulls, on screen (radians), for its cursor. */
    const HANDLE_DIR: Record<string, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }
    const pullCursor = (vx: number, vy: number, rot: number): string => resizeCursor(Math.atan2(vy, vx) + rot)
    const bump = (): void => {
      uiTickRef.current++
    }
    /** Alt + drag moved the preview before cila A: said once in a while. */
    const panNote = (): void => {
      if (performance.now() - panNoteAt < 20000) return
      panNoteAt = performance.now()
      notify({ text: say('pv.pan.moved'), kind: 'info' })
    }

    // The pointer over the canvas, Space held as the hand, the drag's pointer.
    let over = false
    let spaceHeld = false
    let spaceUsed = false
    let activePointer = -1
    /** Alt had a meaning of its own in this press (a point taken off a mask). */
    let altUsed = false
    /** The last pointer move of a drag, not applied yet (client px). */
    let pending: { x: number; y: number; shift: boolean; alt: boolean } | null = null
    let lastPtr: { x: number; y: number } | null = null
    let lastFlush = 0

    const press = (e: PointerEvent) => {
      // A candidate on screen is not the project the handles would edit.
      if (showingCandidate()) return
      const s = useStore.getState()
      const xf = getXf()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      // Green-screen eyedropper: the colour of the clip's OWN picture under
      // the click (its source frame, drawn alone: playback/eyedropper.ts),
      // not of this canvas, which also holds the grade, the key already
      // made, the tracks above and the handles ("cila" part D).
      if (s.eyedropperClip) {
        const [ex, ey] = screenToWorld(xf, sx, sy)
        pickKeyColour(s.eyedropperClip, ex, ey)
        s.setEyedropper(null)
        return
      }

      const [wx, wy] = screenToWorld(xf, sx, sy)

      // The middle button, or Space held, moves the zoomed preview (Alt did
      // before cila A: it is the handles' "from the middle" now).
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        spaceUsed = true
        dragRef.current = {
          kind: 'preview-pan',
          startWorld: { x: sx, y: sy },
          startView: { x: s.previewView.x, y: s.previewView.y }
        }
        canvas.setPointerCapture(e.pointerId)
        return
      }
      if (e.button !== 0) return

      // Picking a map's place: the click is the place.
      if (s.mapPick) {
        const tb = s.project.templates?.find((x) => x.id === s.mapPick!.tplId)
        if (tb && s.currentTime >= tb.start && s.currentTime < templateEnd(tb)) {
          const [wx0, wy0] = screenToWorld(xf, sx, sy)
          const { width: fw, height: fh } = s.project.settings
          const pt = mapPointAt(tb, s.currentTime - tb.start, 0, fw, fh, wx0, wy0)
          const lat = Math.round(Math.max(-80, Math.min(84, pt.lat)) * 100) / 100
          const lon = Math.round((((pt.lon + 540) % 360) - 180) * 100) / 100
          const pick = s.mapPick
          s.editTemplates((p) => {
            const t = p.templates?.find((x) => x.id === pick.tplId)
            if (!t) return
            if (pick.itemId) {
              const it = t.items.find((x) => x.id === pick.itemId)
              if (it) {
                it.value = lat
                it.value2 = lon
              }
            } else if (t.items.length < 12) t.items.push({ id: uid(), title: `Here ${t.items.length + 1}`, value: lat, value2: lon })
          })
          if (pick.itemId) s.setMapPick(null)
          return
        }
      }

      // Hand-drawing a mask: each click drops a point; clicking near the first
      // point (with 3+) or double-clicking finishes and switches to editing.
      if (s.maskDrawMode) {
        const mc = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
        if (mc?.mask) {
          const t = clipTransformAt(mc, s.currentTime - mc.start)
          const [lx, ly] = worldToLocal(t, wx, wy)
          const pts = mc.mask.points ?? []
          if (pts.length >= 3) {
            const [fx, fy] = localToWorld(t, pts[0].x, pts[0].y)
            const [fsx, fsy] = worldToScreen(xf, fx, fy)
            if (Math.hypot(sx - fsx, sy - fsy) <= HANDLE_HIT) {
              s.setMaskDrawMode(false) // close the shape
              return
            }
          }
          if (pts.length === 0) s.beginGesture()
          s.addMaskPoint(mc.id, lx, ly)
          return
        }
      }

      // Shorts mode: dragging inside the frame pans the 9:16 window.
      if (s.project.mode === 'shorts') {
        const win = shortsWindowAt(s.project, s.currentTime)
        s.armGesture()
        dragRef.current = {
          kind: 'shorts-pan',
          startWorld: { x: wx, y: wy },
          startTransform: { x: win.cx, y: 0, scale: 1 }
        }
        canvas.setPointerCapture(e.pointerId)
        return
      }

      // Selected motion tracker: the crosshair is draggable — each drag
      // writes a position keyframe at the playhead.
      if (s.selectedTrackerId) {
        const trk = s.project.trackers?.find((tk) => tk.id === s.selectedTrackerId)
        if (trk && trk.keyframes.length > 0) {
          const kfs = [...trk.keyframes].sort((a, b) => a.time - b.time)
          const pos = trackerPosAt(kfs, s.currentTime)
          const [tx, ty] = worldToScreen(xf, pos.x, pos.y)
          if (Math.hypot(sx - tx, sy - ty) <= 26) {
            s.armGesture()
            dragRef.current = { kind: 'tracker-move', startWorld: { x: wx, y: wy } }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // The crop mode (cila A): the crop's box takes the press: a handle
      // pulls its side or corner, inside it the window slides.
      if (usePreviewUi.getState().cropMode) {
        const pic = pictureSel(s)
        if (pic) {
          const t = clipVisualPoseAt(s.project, pic.clip, s.currentTime).transform
          const box = cropBox(pic.clip.crop, pic.w, pic.h, pic.clip.flipH, pic.clip.flipV)
          const local = boxHandlePoints(box)
          const pts = local.map(([lx, ly]) => {
            const [px, py] = localToWorld(t, lx, ly)
            return worldToScreen(xf, px, py)
          })
          const reach = handleReach(Math.min(box.r - box.l, box.b - box.t) * t.scale * xf.k)
          const i = nearestHandle(pts, sx, sy, reach)
          const common = {
            clipId: pic.clip.id,
            startWorld: { x: wx, y: wy },
            startVisualTransform: { ...t },
            crop: { start: pic.clip.crop ? { ...pic.clip.crop } : undefined, w: pic.w, h: pic.h, flipH: !!pic.clip.flipH, flipV: !!pic.clip.flipV }
          }
          if (i >= 0) {
            const h = CROP_HANDLES[i]
            s.armGesture()
            dragRef.current = { kind: 'crop', handle: h, startScaleHandle: { x: local[i][0], y: local[i][1] }, cursor: pullCursor(HANDLE_DIR[h][0], HANDLE_DIR[h][1], t.rotation), ...common }
            canvas.setPointerCapture(e.pointerId)
            return
          }
          const [lx, ly] = worldToLocal(t, wx, wy)
          if (lx >= box.l && lx <= box.r && ly >= box.t && ly <= box.b) {
            s.armGesture()
            dragRef.current = { kind: 'crop-move', cursor: 'move', ...common }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // Mask editing: when the selected clip's mask is enabled and its outline
      // is on screen, it is directly editable: the body moves, a corner
      // resizes, the knob turns, the points drag, the side handle softens
      // its edge. (Only while it is shown: before cila A a mask whose outline
      // was hidden still took the press, and the picture could not be picked
      // up where its mask was.)
      {
        const mc = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
        if (mc?.mask?.enabled && maskShown(s) && s.currentTime >= mc.start && s.currentTime < mc.start + mc.duration) {
          const t = clipTransformAt(mc, s.currentTime - mc.start)
          const g = maskGeomAt(mc.mask, s.currentTime - mc.start)
          const snap = { cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot ?? 0, points: g.points?.map((p) => ({ ...p })) }
          const isPath = mc.mask.shape === 'path' && !!g.points
          // The soft-edge handle first: it hangs outside the outline.
          {
            const f = maskFeatherGrip(t, g, mc.mask.feather, xf, isPath)
            if (Math.hypot(sx - f.grip[0], sy - f.grip[1]) <= HANDLE_HIT) {
              s.armGesture()
              dragRef.current = { kind: 'mask-feather', clipId: mc.id, startWorld: { x: wx, y: wy }, feather: { start: mc.mask.feather, perPx: f.perPx, ux: f.u[0], uy: f.u[1] }, cursor: pullCursor(f.u[0], f.u[1], 0) }
              canvas.setPointerCapture(e.pointerId)
              return
            }
          }
          // Pen points next.
          if (isPath && g.points) {
            const scr = g.points.map((p): [number, number] => {
              const [px, py] = localToWorld(t, p.x, p.y)
              return worldToScreen(xf, px, py)
            })
            const i = nearestHandle(scr, sx, sy, HANDLE_HIT)
            if (i >= 0) {
              if (e.altKey) {
                // Alt + click takes the point off (three stay), as a right click does.
                altUsed = true
                if (g.points.length > 3) {
                  const points = g.points.filter((_, j) => j !== i)
                  s.undoable(() => s.editMaskGeom(mc.id, { points }))
                }
                return
              }
              s.armGesture()
              dragRef.current = { kind: 'mask-point', clipId: mc.id, maskPointIdx: i, startWorld: { x: wx, y: wy }, maskStart: snap, cursor: 'move' }
              canvas.setPointerCapture(e.pointerId)
              return
            }
            // On the outline between two points: the press puts a point there
            // and goes on dragging it (one undo step for both).
            if (scr.length >= 2) {
              let best = { i: -1, x: 0, y: 0, d: Infinity }
              for (let k = 0; k < scr.length; k++) {
                const n = nearestOnSegment(scr[k], scr[(k + 1) % scr.length], [sx, sy])
                if (n.d < best.d) best = { i: k, x: n.x, y: n.y, d: n.d }
              }
              if (best.i >= 0 && best.d <= 8) {
                const [nwx, nwy] = screenToWorld(xf, best.x, best.y)
                const [nlx, nly] = worldToLocal(t, nwx, nwy)
                const points = g.points.map((p) => ({ ...p }))
                points.splice(best.i + 1, 0, { x: nlx, y: nly })
                s.armGesture()
                s.editMaskGeom(mc.id, { points })
                dragRef.current = { kind: 'mask-point', clipId: mc.id, maskPointIdx: best.i + 1, startWorld: { x: wx, y: wy }, maskStart: { ...snap, points }, cursor: 'move' }
                canvas.setPointerCapture(e.pointerId)
                return
              }
            }
          }
          if (!isPath) {
            // The grip is tested before the corners: it hangs outside the
            // outline, so the two can never be confused.
            const [gx, gy] = maskRotateGrip(t, g, xf)
            if (Math.hypot(sx - gx, sy - gy) <= HANDLE_HIT) {
              s.armGesture()
              const [mcx, mcy] = localToWorld(t, g.cx, g.cy)
              const [mscx, mscy] = worldToScreen(xf, mcx, mcy)
              dragRef.current = {
                kind: 'mask-rotate',
                clipId: mc.id,
                startWorld: { x: wx, y: wy },
                maskStart: snap,
                startAngle: Math.atan2(sy - mscy, sx - mscx),
                startRotation: g.rot ?? 0,
                cursor: 'grabbing'
              }
              canvas.setPointerCapture(e.pointerId)
              return
            }
            // Any of the four corners resizes it: the nearest within reach.
            const corners = maskHandlePoints(t, g, xf)
            const ci = nearestHandle(corners, sx, sy, handleReach(Math.min(g.w, g.h) * t.scale * xf.k))
            if (ci >= 0) {
              const cornerX = (ci === 0 || ci === 3 ? -1 : 1) as -1 | 1
              const cornerY = (ci < 2 ? -1 : 1) as -1 | 1
              s.armGesture()
              dragRef.current = {
                kind: 'mask-scale',
                clipId: mc.id,
                startWorld: { x: wx, y: wy },
                maskStart: snap,
                scaleGrip: { halfWidth: g.w / 2, halfHeight: g.h / 2, cornerX, cornerY },
                cursor: pullCursor(cornerX, cornerY, t.rotation + (g.rot ?? 0))
              }
              canvas.setPointerCapture(e.pointerId)
              return
            }
          }
          // Inside the mask bounds: move the whole mask.
          const [lx, ly] = worldToLocal(t, wx, wy)
          // Into the mask's OWN frame, so a turned mask is grabbable where it
          // is drawn rather than where an unturned one would have been.
          const mrot = g.rot ?? 0
          const ddx = lx - g.cx
          const ddy = ly - g.cy
          const mx = g.cx + ddx * Math.cos(-mrot) - ddy * Math.sin(-mrot)
          const my = g.cy + ddx * Math.sin(-mrot) + ddy * Math.cos(-mrot)
          const inBounds =
            mc.mask.shape === 'path' && g.points
              ? Math.abs(mx - g.cx) <= Math.max(...g.points.map((p) => Math.abs(p.x - g.cx))) + 20 &&
                Math.abs(my - g.cy) <= Math.max(...g.points.map((p) => Math.abs(p.y - g.cy))) + 20
              : Math.abs(mx - g.cx) <= g.w / 2 && Math.abs(my - g.cy) <= g.h / 2
          if (inBounds) {
            s.armGesture()
            dragRef.current = { kind: 'mask-move', clipId: mc.id, startWorld: { x: wx, y: wy }, maskStart: snap, cursor: 'move' }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // Titles and shapes (text-edit/interaction.ts): the knob and handles of
      // a selected one, then the body of the topmost under the pointer. A
      // press outside a title being typed in ends the typing first.
      {
        const took = pressText(xf, sx, sy, { shift: e.shiftKey })
        if (took === 'taken') return
        if (took) {
          dragRef.current = took
          canvas.setPointerCapture(e.pointerId)
          return
        }
      }

      // Your-camera map: dragging the map moves its camera — a key at the
      // playhead.
      {
        const tb = s.templateSel ? s.project.templates?.find((x) => x.id === s.templateSel) : undefined
        const { width: fw, height: fh } = s.project.settings
        if (tb?.kind === 'atlas' && !tb.follow && s.currentTime >= tb.start && s.currentTime < templateEnd(tb) && wx >= 0 && wx <= fw && wy >= 0 && wy <= fh) {
          s.armGesture()
          dragRef.current = { kind: 'tpl-cam', tplId: tb.id, keyT: s.currentTime - tb.start, mapCam: atlasCamera(tb, s.currentTime - tb.start), startWorld: { x: wx, y: wy }, cursor: 'grabbing' }
          canvas.setPointerCapture(e.pointerId)
          return
        }
      }

      // The selected template: its corner scales it, anywhere in its box
      // moves it.
      {
        const tb = s.templateSel ? s.project.templates?.find((x) => x.id === s.templateSel) : undefined
        if (tb && placeable(tb.kind) && s.currentTime >= tb.start && s.currentTime < templateEnd(tb)) {
          const bx = placedTemplateBox(s.project, tb, s.currentTime)
          const [ax, ay] = worldToScreen(xf, bx.x0, bx.y0)
          const [hx, hy] = worldToScreen(xf, bx.x1, bx.y1)
          const start = tb.place ?? { x: 0, y: 0, s: 1 }
          if (Math.abs(sx - hx) <= HANDLE_HIT && Math.abs(sy - hy) <= HANDLE_HIT) {
            const placed: [number, number] = [(bx.x0 + bx.x1) / 2, (bx.y0 + bx.y1) / 2]
            s.armGesture()
            dragRef.current = {
              kind: 'tpl-scale',
              tplId: tb.id,
              tplStart: start,
              tplScale: { C: bx.C, raw: bx.raw, placed, d0: Math.max(4, Math.hypot(wx - placed[0], wy - placed[1])), w: bx.w, h: bx.h },
              startWorld: { x: wx, y: wy },
              cursor: 'nwse-resize'
            }
            canvas.setPointerCapture(e.pointerId)
            return
          }
          if (sx >= Math.min(ax, hx) && sx <= Math.max(ax, hx) && sy >= Math.min(ay, hy) && sy <= Math.max(ay, hy)) {
            s.armGesture()
            dragRef.current = { kind: 'tpl-move', tplId: tb.id, tplStart: start, tplScale: { C: bx.C, raw: bx.raw, placed: bx.C, d0: 1, w: bx.w, h: bx.h }, startWorld: { x: wx, y: wy }, cursor: 'grabbing' }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // Scale handle of the current selection?
      const sel = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
      const selAsset = sel ? assetById(s.project, sel.assetId) : null
      if (sel && selAsset && selAsset.kind !== 'audio') {
        const base = clipTransformAt(sel, s.currentTime - sel.start)
        const t = clipVisualPoseAt(s.project, sel, s.currentTime).transform
        const w = ((selAsset.width || 2) / 2) * t.scale
        const h = ((selAsset.height || 2) / 2) * t.scale
        // The rotate grip is tested first: it hangs outside the box, so it can
        // never be confused with a corner.
        {
          const { grip } = rotateGrip(xf, t.x, t.y, h, t.rotation)
          if (Math.hypot(sx - grip[0], sy - grip[1]) <= HANDLE_HIT) {
            s.armGesture()
            dragRef.current = {
              kind: 'rotate',
              clipId: sel.id,
              startWorld: { x: wx, y: wy },
              startTransform: { ...base },
              startVisualTransform: { ...t },
              startAngle: Math.atan2(wy - t.y, wx - t.x),
              startRotation: base.rotation,
              cursor: 'grabbing'
            }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
        // Any of the four corner handles starts a resize: the nearest within
        // reach (16 px; less on a small picture, so it can still be picked up).
        {
          const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
          const pts = signs.map(([qx, qy]): [number, number] => {
            const rx = qx * w * Math.cos(t.rotation) - qy * h * Math.sin(t.rotation)
            const ry = qx * w * Math.sin(t.rotation) + qy * h * Math.cos(t.rotation)
            return worldToScreen(xf, t.x + rx, t.y + ry)
          })
          const ci = nearestHandle(pts, sx, sy, handleReach(Math.min(w, h) * 2 * xf.k))
          if (ci >= 0) {
            s.armGesture()
            dragRef.current = {
              kind: 'scale',
              clipId: sel.id,
              startWorld: { x: wx, y: wy },
              startTransform: { ...base },
              startVisualTransform: { ...t },
              scaleGrip: { halfWidth: w, halfHeight: h, cornerX: signs[ci][0], cornerY: signs[ci][1] },
              cursor: pullCursor(signs[ci][0] * w, signs[ci][1] * h, t.rotation)
            }
            canvas.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // Hit test clips, topmost first.
      const clips = visibleClips(s.project, s.currentTime)
      for (let i = clips.length - 1; i >= 0; i--) {
        const clip = clips[i]
        const t = clipVisualPoseAt(s.project, clip, s.currentTime).transform
        if (hitTestClip(s.project, clip, wx, wy, t)) {
          // One kind of thing is picked at a time in the preview.
          if (s.selectedCaptionIds.length) s.selectCaptions([])
          s.selectClip(clip.id)
          s.armGesture()
          dragRef.current = {
            kind: 'move',
            clipId: clip.id,
            startWorld: { x: wx, y: wy },
            startTransform: { ...clipTransformAt(clip, s.currentTime - clip.start) },
            startVisualTransform: { ...t },
            cursor: 'grabbing'
          }
          canvas.setPointerCapture(e.pointerId)
          return
        }
      }

      // Nothing there: nothing is picked.
      s.selectClip(null)
      if (s.selectedCaptionIds.length) s.selectCaptions([])
    }

    /** The kinds a press on a thing's body starts (Alt keeps them still; a
     *  title's move is not among them: there Alt is "catch on nothing"). */
    const BODY = new Set<DragState['kind']>(['move', 'tpl-move', 'tpl-cam', 'mask-move', 'crop-move', 'shorts-pan', 'tracker-move'])

    const onPointerDown = (e: PointerEvent) => {
      // Another button pressed while something is dragged: the drag goes on.
      if (dragRef.current) return
      const mark = gestureMark()
      pending = null
      lastPtr = { x: e.clientX, y: e.clientY }
      altUsed = false
      measure()
      press(e)
      // The preview takes the keys from here on (the arrow keys nudge); not
      // from a title being typed in (its own field keeps them).
      if (!typing() && document.activeElement !== canvas) canvas.focus({ preventScroll: true })
      const d = dragRef.current as DragState | null
      if (!d) {
        if (e.altKey && e.button === 0 && !altUsed) panNote()
        return
      }
      if (e.altKey && BODY.has(d.kind)) {
        // Alt + drag on a picture was the preview's pan: it moves nothing
        // now (the picture must not go where the view was meant to).
        dragRef.current = null
        useStore.getState().endGesture()
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        panNote()
        return
      }
      activePointer = e.pointerId
      d.startScreen = { x: e.clientX - geom.left, y: e.clientY - geom.top }
      // The view's own pan follows at once; everything else once the pointer
      // has left the press by the threshold.
      d.moved = d.kind === 'preview-pan'
      d.undoMark = mark
      if (d.kind === 'preview-pan') d.cursor = 'grabbing'
      canvas.style.cursor = d.cursor ?? 'grabbing'
      hotRef.current = ''
      ghostRef.current = null
      bump()
    }

    /**
     * Not dragging: say what is under the pointer. A text was grabbable but
     * gave no sign of it (no cursor change, no outline), so you found out by
     * trying. Hover marks it, the cursor names the gesture (a resize arrow
     * that lies along the pull on a turned box, a bent arrow on a knob), and
     * the handle the press would take is lit (cila A).
     */
    const hover = (e: PointerEvent): void => {
      const s0 = useStore.getState()
      const xf0 = getXf()
      measure()
      const hx = e.clientX - geom.left
      const hy = e.clientY - geom.top
      const [hwx, hwy] = screenToWorld(xf0, hx, hy)
      let hit: string | null = null
      let cursor = ''
      let hot = ''
      let ghost: [number, number] | null = null
      if (showingCandidate()) {
        if (canvas.style.cursor !== '') canvas.style.cursor = ''
        return
      }
      if (spaceHeld) cursor = 'grab'
      // The green screen's eyedropper is up: a picking cursor over the whole
      // preview (DENEME-1, P6), nothing else lit.
      if (!cursor && s0.eyedropperClip) {
        if (canvas.style.cursor !== 'crosshair') canvas.style.cursor = 'crosshair'
        return
      }
      // The crop mode's box.
      if (!cursor && usePreviewUi.getState().cropMode) {
        const pic = pictureSel(s0)
        if (pic) {
          const t = clipVisualPoseAt(s0.project, pic.clip, s0.currentTime).transform
          const box = cropBox(pic.clip.crop, pic.w, pic.h, pic.clip.flipH, pic.clip.flipV)
          const pts = boxHandlePoints(box).map(([lx, ly]) => {
            const [px, py] = localToWorld(t, lx, ly)
            return worldToScreen(xf0, px, py)
          })
          const i = nearestHandle(pts, hx, hy, handleReach(Math.min(box.r - box.l, box.b - box.t) * t.scale * xf0.k))
          const [lx, ly] = worldToLocal(t, hwx, hwy)
          if (i >= 0) {
            hot = `crop:${i}`
            cursor = pullCursor(HANDLE_DIR[CROP_HANDLES[i]][0], HANDLE_DIR[CROP_HANDLES[i]][1], t.rotation)
          } else if (lx >= box.l && lx <= box.r && ly >= box.t && ly <= box.b) cursor = 'move'
        }
      }
      // The mask's handles, while its outline is shown.
      if (!cursor) {
        const mc = s0.selectedClipIds.length > 0 ? s0.project.clips[s0.selectedClipIds[0]] : null
        if (mc?.mask?.enabled && maskShown(s0) && s0.currentTime >= mc.start && s0.currentTime < mc.start + mc.duration) {
          const t = clipTransformAt(mc, s0.currentTime - mc.start)
          const g = maskGeomAt(mc.mask, s0.currentTime - mc.start)
          const isPath = mc.mask.shape === 'path' && !!g.points
          const f = maskFeatherGrip(t, g, mc.mask.feather, xf0, isPath)
          if (Math.hypot(hx - f.grip[0], hy - f.grip[1]) <= HANDLE_HIT) {
            hot = 'mask:feather'
            cursor = pullCursor(f.u[0], f.u[1], 0)
          } else if (isPath && g.points) {
            const scr = g.points.map((p): [number, number] => {
              const [px, py] = localToWorld(t, p.x, p.y)
              return worldToScreen(xf0, px, py)
            })
            const i = nearestHandle(scr, hx, hy, HANDLE_HIT)
            if (i >= 0) {
              hot = `mask:pt:${i}`
              cursor = 'move'
            } else if (scr.length >= 2) {
              let best = { x: 0, y: 0, d: Infinity }
              for (let k = 0; k < scr.length; k++) {
                const n = nearestOnSegment(scr[k], scr[(k + 1) % scr.length], [hx, hy])
                if (n.d < best.d) best = n
              }
              if (best.d <= 8) {
                hot = 'mask:seg'
                ghost = [best.x, best.y]
                cursor = 'copy'
              }
            }
          } else {
            const [gx, gy] = maskRotateGrip(t, g, xf0)
            const corners = maskHandlePoints(t, g, xf0)
            const ci = Math.hypot(hx - gx, hy - gy) <= HANDLE_HIT ? -2 : nearestHandle(corners, hx, hy, handleReach(Math.min(g.w, g.h) * t.scale * xf0.k))
            if (ci === -2) {
              hot = 'mask:knob'
              cursor = turnCursor(t.rotation + (g.rot ?? 0))
            } else if (ci >= 0) {
              hot = `mask:corner:${ci}`
              cursor = pullCursor(ci === 0 || ci === 3 ? -1 : 1, ci < 2 ? -1 : 1, t.rotation + (g.rot ?? 0))
            }
          }
        }
      }
      // A title or a shape (text-edit/interaction.ts).
      if (!cursor) {
        const on = hoverText(xf0, hx, hy)
        if (on) {
          hit = on.hit
          hot = on.hot
          cursor = on.cursor
        }
      }
      if (!cursor) {
        const selected = s0.selectedClipIds.length ? s0.project.clips[s0.selectedClipIds[0]] : null
        const asset = selected ? assetById(s0.project, selected.assetId) : null
        if (selected && asset && asset.kind !== 'audio' && !usePreviewUi.getState().cropMode) {
          const t = clipVisualPoseAt(s0.project, selected, s0.currentTime).transform
          const halfWidth = ((asset.width || 2) / 2) * t.scale
          const halfHeight = ((asset.height || 2) / 2) * t.scale
          const { grip } = rotateGrip(xf0, t.x, t.y, halfHeight, t.rotation)
          const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
          if (Math.hypot(hx - grip[0], hy - grip[1]) <= HANDLE_HIT) {
            hot = 'clip:knob'
            const [scx, scy] = worldToScreen(xf0, t.x, t.y)
            cursor = turnCursor(Math.atan2(grip[1] - scy, grip[0] - scx) + Math.PI / 2)
          } else {
            const pts = signs.map(([qx, qy]): [number, number] =>
              worldToScreen(xf0, t.x + qx * halfWidth * Math.cos(t.rotation) - qy * halfHeight * Math.sin(t.rotation), t.y + qx * halfWidth * Math.sin(t.rotation) + qy * halfHeight * Math.cos(t.rotation)))
            const ci = nearestHandle(pts, hx, hy, handleReach(Math.min(halfWidth, halfHeight) * 2 * xf0.k))
            if (ci >= 0) {
              hot = `clip:corner:${ci}`
              cursor = pullCursor(signs[ci][0] * halfWidth, signs[ci][1] * halfHeight, t.rotation)
            }
          }
        }
        if (!cursor && visibleClips(s0.project, s0.currentTime).some((clip) =>
          hitTestClip(s0.project, clip, hwx, hwy, clipVisualPoseAt(s0.project, clip, s0.currentTime).transform))) cursor = 'grab'
      }
      const g0 = ghostRef.current
      if (hit !== hoverCapRef.current || hot !== hotRef.current || (ghost?.[0] ?? -1) !== (g0?.[0] ?? -1) || (ghost?.[1] ?? -1) !== (g0?.[1] ?? -1)) bump()
      hoverCapRef.current = hit
      hotRef.current = hot
      ghostRef.current = ghost
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor
    }

    /** The drag's pending pointer move, applied: by the draw (once per drawn
     *  frame), at the release, and at once when no draw has come for a while. */
    const flush = (): void => {
      const p = pending
      pending = null
      if (!p || !dragRef.current) return
      lastFlush = performance.now()
      applyDrag(p.x - geom.left, p.y - geom.top, p.shift, p.alt)
    }
    flushRef.current = flush

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current) {
        hover(e)
        return
      }
      // Kept, not applied: however fast the pointer reports (a 144 Hz screen
      // hands over 144 moves a second), the project is written once per drawn
      // frame. Each move used to be two or three writes of its own, each with
      // every panel that shows the project drawn again.
      lastPtr = { x: e.clientX, y: e.clientY }
      pending = { x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey }
      if (performance.now() - lastFlush > 50) flush()
    }

    const applyDrag = (sx: number, sy: number, shift: boolean, alt: boolean): void => {
      const drag = dragRef.current
      if (!drag) return
      if (!drag.moved) {
        // A press that has not left its place yet is a click: nothing moves,
        // nothing snaps (a shaking hand used to jump the picture to a guide).
        const from = drag.startScreen ?? { x: sx, y: sy }
        if (!pastThreshold(from.x, from.y, sx, sy, DRAG_THRESHOLD)) return
        drag.moved = true
        if (drag.kind !== 'caption-caret') useTextEdit.setState({ dragging: true })
      }
      const s = useStore.getState()
      const xf = getXf()

      if (drag.kind === 'preview-pan' && drag.startView) {
        s.setPreviewView({
          x: drag.startView.x + (sx - drag.startWorld.x),
          y: drag.startView.y + (sy - drag.startWorld.y)
        })
        return
      }
      if (drag.kind === 'tpl-cam' && drag.tplId && drag.mapCam && drag.keyT !== undefined) {
        const [wx, wy] = screenToWorld(xf, sx, sy)
        const cam = drag.mapCam
        const ppd = ((s.project.settings.width * 0.95) / 360) * cam.z
        const next = { lon: cam.lon - (wx - drag.startWorld.x) / ppd, lat: cam.lat + (wy - drag.startWorld.y) / ppd, z: cam.z }
        const id = drag.tplId
        const kt = drag.keyT
        s.editTemplates((p) => {
          const t = p.templates?.find((x) => x.id === id)
          if (t) setAtlasKey(t, kt, next, p.settings.fps)
        }, false)
        return
      }
      if ((drag.kind === 'tpl-move' || drag.kind === 'tpl-scale') && drag.tplId && drag.tplStart && drag.tplScale) {
        const [wx, wy] = screenToWorld(xf, sx, sy)
        const k = drag.tplScale
        const st = drag.tplStart
        let next: { x: number; y: number; s: number }
        if (drag.kind === 'tpl-move') {
          next = { x: st.x + (wx - drag.startWorld.x) / k.w, y: st.y + (wy - drag.startWorld.y) / k.h, s: st.s }
        } else {
          // Scaled round its own middle, which stays put.
          const sc = Math.max(0.25, Math.min(2.5, (st.s * Math.hypot(wx - k.placed[0], wy - k.placed[1])) / k.d0))
          next = { x: (k.placed[0] - k.C[0] - (k.raw[0] - k.C[0]) * sc) / k.w, y: (k.placed[1] - k.C[1] - (k.raw[1] - k.C[1]) * sc) / k.h, s: sc }
        }
        const id = drag.tplId
        s.editTemplates((p) => {
          const t = p.templates?.find((x) => x.id === id)
          if (t) t.place = { x: Math.max(-1, Math.min(1, next.x)), y: Math.max(-1, Math.min(1, next.y)), s: next.s }
        }, false)
        return
      }
      if (drag.kind === 'tracker-move') {
        const [wx, wy] = screenToWorld(xf, sx, sy)
        if (s.selectedTrackerId) s.dragTracker(s.selectedTrackerId, s.currentTime, wx, wy)
        return
      }
      if (drag.kind === 'mask-rotate' && drag.clipId && drag.maskStart && drag.startAngle !== undefined) {
        const mc = s.project.clips[drag.clipId]
        if (!mc?.mask) return
        const t = clipTransformAt(mc, s.currentTime - mc.start)
        const ms = drag.maskStart
        const [mcx, mcy] = localToWorld(t, ms.cx, ms.cy)
        const [mscx, mscy] = worldToScreen(xf, mcx, mcy)
        const grabbed: [number, number] = [mscx + Math.cos(drag.startAngle), mscy + Math.sin(drag.startAngle)]
        // Shift: 15° steps; otherwise right angles catch (ui/handles.ts).
        const rot = snapAngle(turnFrom([mscx, mscy], grabbed, [sx, sy], drag.startRotation ?? 0, (drag.turn ??= { sum: 0 })), shift)
        s.editMaskGeom(mc.id, { rot })
        return
      }
      if (drag.kind === 'mask-feather' && drag.clipId && drag.feather && drag.startScreen) {
        // Along the handle's own line: away softens, back hardens.
        const f = drag.feather
        const d = (sx - drag.startScreen.x) * f.ux + (sy - drag.startScreen.y) * f.uy
        s.setClipMask(drag.clipId, { feather: Math.round(Math.min(FEATHER_MAX, Math.max(0, f.start + d * f.perPx))) })
        return
      }
      if ((drag.kind === 'crop' || drag.kind === 'crop-move') && drag.clipId && drag.crop && drag.startVisualTransform) {
        // In the clip's own frame as it stood at the press.
        const t = { ...drag.startVisualTransform, rotation: drag.startVisualTransform.rotation ?? 0 }
        const [wx, wy] = screenToWorld(xf, sx, sy)
        const [lx0, ly0] = worldToLocal(t, drag.startWorld.x, drag.startWorld.y)
        const [lx1, ly1] = worldToLocal(t, wx, wy)
        const c = drag.crop
        // Shift keeps the crop's shape, Alt works from its middle.
        const next = drag.kind === 'crop' && drag.handle && drag.startScaleHandle
          ? cropFromHandle(c.start, drag.handle, drag.startScaleHandle.x + lx1 - lx0, drag.startScaleHandle.y + ly1 - ly0, c.w, c.h, { flipH: c.flipH, flipV: c.flipV, keepRatio: shift, centre: alt })
          : cropMoved(c.start, lx1 - lx0, ly1 - ly0, c.w, c.h, c.flipH, c.flipV)
        // The Inspector's field: its sliders show the same four numbers.
        s.setClipCrop(drag.clipId, next)
        return
      }
      if ((drag.kind === 'mask-move' || drag.kind === 'mask-scale' || drag.kind === 'mask-point') && drag.clipId && drag.maskStart) {
        const mc = s.project.clips[drag.clipId]
        if (!mc?.mask) return
        const t = clipTransformAt(mc, s.currentTime - mc.start)
        const [wx, wy] = screenToWorld(xf, sx, sy)
        const [lx0, ly0] = worldToLocal(t, drag.startWorld.x, drag.startWorld.y)
        const [lx1, ly1] = worldToLocal(t, wx, wy)
        let dlx = lx1 - lx0
        let dly = ly1 - ly0
        // Shift constrains to one axis, exactly as it does when dragging a
        // clip or a text. Everything else in the editor did this; the mask
        // was the one thing that drifted diagonally however hard you tried.
        if (shift && drag.kind !== 'mask-scale') {
          if (Math.abs(dlx) >= Math.abs(dly)) dly = 0
          else dlx = 0
        }
        const ms = drag.maskStart
        if (drag.kind === 'mask-move') {
          s.editMaskGeom(mc.id, {
            cx: ms.cx + dlx,
            cy: ms.cy + dly,
            points: ms.points?.map((p) => ({ x: p.x + dlx, y: p.y + dly }))
          })
        } else if (drag.kind === 'mask-scale') {
          // The drag is measured along the mask's OWN axes, so a turned mask
          // grows the way it looks like it should.
          const mrot = ms.rot ?? 0
          const ax = dlx * Math.cos(-mrot) - dly * Math.sin(-mrot)
          const ay = dlx * Math.sin(-mrot) + dly * Math.cos(-mrot)
          // Outwards from the corner that is held grows it: the corner stays
          // under the pointer (the mask grows round its middle, so twice the
          // pull). Before cila A every corner behaved as the bottom right
          // one: the top left corner pulled outwards made the mask smaller.
          const qx = drag.scaleGrip?.cornerX ?? 1
          const qy = drag.scaleGrip?.cornerY ?? 1
          // Shift keeps the aspect ratio while resizing.
          if (shift) {
            const f = Math.max(0.05, 1 + (ax * qx * 2) / Math.max(10, ms.w))
            s.editMaskGeom(mc.id, { w: Math.max(10, ms.w * f), h: Math.max(10, ms.h * f) })
          } else {
            s.editMaskGeom(mc.id, {
              w: Math.max(10, ms.w + ax * qx * 2),
              h: Math.max(10, ms.h + ay * qy * 2)
            })
          }
        } else if (drag.maskPointIdx !== undefined && ms.points) {
          const points = ms.points.map((p, i) =>
            i === drag.maskPointIdx ? { x: p.x + dlx, y: p.y + dly } : p
          )
          s.editMaskGeom(mc.id, { points })
        }
        return
      }
      // A title's or a shape's drag (text-edit/interaction.ts).
      if (dragText(drag, xf, sx, sy, shift, alt, guidesRef)) {
        // A side's pull moves the held box's line with every move, also
        // while the words stay as they are (the project unchanged): the
        // paused preview draws again.
        if (drag.kind === 'caption-width') bump()
        return
      }

      const [wx, wy] = screenToWorld(xf, sx, sy)

      if (drag.kind === 'shorts-pan' && drag.startTransform) {
        s.dragShorts(drag.startTransform.x + (wx - drag.startWorld.x))
        return
      }

      const clip = drag.clipId ? s.project.clips[drag.clipId] : null
      if (!clip || !drag.startTransform) return

      // The channels go as ONE change (setPropValues): each keyframes where
      // it is already keyed and edits the static base where it is not, as
      // setPropValue does; x and y (and scale) used to be a write each.
      const applyXf = (patch: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>>) => {
        s.setPropValues(clip.id, patch, false)
      }

      if (drag.kind === 'move') {
        const dxw = wx - drag.startWorld.x
        const dyw = wy - drag.startWorld.y
        let nx = drag.startTransform.x + dxw
        let ny = drag.startTransform.y + dyw
        if (shift) {
          // Axis lock: constrain to whichever direction has moved further, so
          // dragging stays perfectly horizontal or vertical (like every NLE).
          guidesRef.current = []
          if (Math.abs(dxw) >= Math.abs(dyw)) ny = drag.startTransform.y
          else nx = drag.startTransform.x
        } else {
          ;[nx, ny] = applySnap(clip, nx, ny, xf)
        }
        applyXf({ x: nx, y: ny })
      } else if (drag.kind === 'scale' && drag.scaleGrip) {
        const grip = drag.scaleGrip
        const visual = drag.startVisualTransform ?? drag.startTransform
        // Alt: round the middle, which stays; else the opposite corner stays.
        const resized = (alt ? scaleClipFromCentre : scaleClipFromCorner)(
          { ...visual, rotation: visual.rotation ?? 0 },
          grip.halfWidth, grip.halfHeight, grip.cornerX, grip.cornerY,
          drag.startWorld, { x: wx, y: wy }
        )
        applyXf({
          x: drag.startTransform.x + resized.x - visual.x,
          y: drag.startTransform.y + resized.y - visual.y,
          scale: drag.startTransform.scale * resized.scale / Math.max(1e-6, visual.scale)
        })
      } else if (drag.kind === 'rotate' && drag.startAngle !== undefined) {
        const center = drag.startVisualTransform ?? drag.startTransform
        // Round the middle, no jump on grab; Shift: 15° steps, otherwise
        // right angles catch (ui/handles.ts).
        const rot = snapAngle(turnFrom([center.x, center.y], [drag.startWorld.x, drag.startWorld.y], [wx, wy], drag.startRotation ?? 0, (drag.turn ??= { sum: 0 })), shift)
        applyXf({ rotation: rot })
      }
    }

    const endDrag = (e: PointerEvent) => {
      if (dragRef.current) {
        // The last move the draw has not applied yet: the release is exact.
        flush()
        guidesRef.current = []
        dragRef.current = null
        activePointer = -1
        if (useTextEdit.getState().dragging) useTextEdit.setState({ dragging: false })
        // Closes the undo window this drag opened. Armed rather than pushed on
        // the way in: a press that turns out to move nothing used to leave an
        // undo step behind that undid nothing, so clicking a text a couple of
        // times and then pressing Ctrl+Z appeared to do NOTHING at all — the
        // press had buried the real edit under dead entries.
        useStore.getState().endGesture()
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        // The frame after the release: in full, without the drag's guides
        // and tags (they stayed on the paused picture until something else
        // made it draw).
        bump()
        hover(e)
      }
      pending = null
    }

    /**
     * Esc while something is dragged: the drag is taken back. The project is
     * as it was at the press, with no undo step left and the redo steps as
     * they were (the store's undo, and then the step it would keep for redo
     * dropped).
     */
    const cancelDrag = (): boolean => {
      const drag = dragRef.current
      if (!drag) return false
      pending = null
      guidesRef.current = []
      dragRef.current = null
      if (useTextEdit.getState().dragging) useTextEdit.setState({ dragging: false })
      if (drag.kind === 'preview-pan' && drag.startView) useStore.getState().setPreviewView(drag.startView)
      takeBackGesture(drag.undoMark)
      try {
        if (activePointer >= 0) canvas.releasePointerCapture(activePointer)
      } catch {
        /* ignore */
      }
      activePointer = -1
      canvas.style.cursor = ''
      bump()
      return true
    }

    /**
     * The arrow keys with the preview in focus: the selection moves by one
     * frame pixel, with Shift by ten. A keyed channel takes a key at the
     * playhead, as a drag gives it. Presses that follow each other are one
     * undo step.
     */
    let nudgeTimer = 0
    const nudged = (): void => {
      // Its place is shown beside it for a moment (and then taken away).
      nudgedRef.current = performance.now() + 900
      window.clearTimeout(nudgeTimer)
      nudgeTimer = window.setTimeout(bump, 950)
      bump()
    }
    const nudge = (dx: number, dy: number): boolean => {
      const s = useStore.getState()
      if (showingCandidate()) return false
      if (nudgeText(dx, dy)) {
        nudged()
        return true
      }
      const pic = pictureSel(s)
      if (!pic) return false
      const base = clipTransformAt(pic.clip, s.currentTime - pic.clip.start)
      s.setPropValues(pic.clip.id, { x: base.x + dx, y: base.y + dy }, true, `nudge:${pic.clip.id}`)
      nudged()
      return true
    }

    const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (dragRef.current) {
        if (e.key === 'Escape') {
          cancelDrag()
          e.preventDefault()
          e.stopPropagation()
        } else if ((e.key === 'Shift' || e.key === 'Alt') && lastPtr) {
          // A modifier pressed while the pointer rests: the drag follows it.
          if (e.key === 'Alt') e.preventDefault()
          pending = { x: lastPtr.x, y: lastPtr.y, shift: e.shiftKey, alt: e.altKey }
        }
        return
      }
      // Esc puts the green screen's eyedropper down (and nothing else: the
      // selection stays). DENEME-1, P6.
      if (e.key === 'Escape' && useStore.getState().eyedropperClip && !modalOpen(document)) {
        useStore.getState().setEyedropper(null)
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const target = e.target as HTMLElement | null
      if (modalOpen(document) || !shortcutsAllowed(target, e)) return
      // Esc leaves the crop mode (and goes on to whatever else it leaves).
      if (e.key === 'Escape' && usePreviewUi.getState().cropMode) usePreviewUi.getState().setCropMode(false)
      // Space held over a preview that is zoomed or moved is the hand: a
      // drag moves the view, a tap still plays (on its release). Over a
      // preview that shows the whole frame Space is play alone, at once.
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const pv = useStore.getState().previewView
        if (spaceHeld) {
          e.preventDefault()
          e.stopPropagation()
        } else if (!e.repeat && over && (pv.zoom !== 1 || pv.x !== 0 || pv.y !== 0) && loadBindings().playPause === 'space') {
          spaceHeld = true
          spaceUsed = false
          canvas.style.cursor = 'grab'
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (e.key === 'Enter' && document.activeElement === canvas && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && typeSelected()) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      const arrow = ARROWS[e.key]
      if (arrow && document.activeElement === canvas && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const step = e.shiftKey ? 10 : 1
        if (nudge(arrow[0] * step, arrow[1] * step)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (dragRef.current && (e.key === 'Shift' || e.key === 'Alt') && lastPtr) {
        if (e.key === 'Alt') e.preventDefault()
        pending = { x: lastPtr.x, y: lastPtr.y, shift: e.shiftKey, alt: e.altKey }
      }
      if (e.code === 'Space' && spaceHeld) {
        spaceHeld = false
        e.preventDefault()
        e.stopPropagation()
        if (!dragRef.current) canvas.style.cursor = ''
        if (!spaceUsed) {
          const s = useStore.getState()
          s.setPlaying(!s.playing)
        }
      }
    }
    const onEnter = (): void => {
      over = true
    }
    const onLeave = (): void => {
      over = false
      if (!dragRef.current && (hotRef.current || hoverCapRef.current || ghostRef.current)) {
        hotRef.current = ''
        hoverCapRef.current = null
        ghostRef.current = null
        bump()
      }
    }
    const onBlur = (): void => {
      spaceHeld = false
    }

    let atlasWheel = 0
    const onWheel = (e: WheelEvent) => {
      const s = useStore.getState()
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)

      // Zoom the preview itself around the cursor.
      const zoomPreview = (): void => {
        // Round the pointer, within the limits (components/preview/zoom.ts).
        s.setPreviewView(zoomAround(s.previewView, s.previewView.zoom * factor, sx, sy, canvas.clientWidth, canvas.clientHeight))
      }
      // Your-camera map: the wheel zooms its camera round the cursor — a key
      // at the playhead.
      {
        const tb = s.templateSel ? s.project.templates?.find((x) => x.id === s.templateSel) : undefined
        if (tb?.kind === 'atlas' && !tb.follow && !e.ctrlKey && s.currentTime >= tb.start && s.currentTime < templateEnd(tb)) {
          const [wx, wy] = screenToWorld(getXf(), sx, sy)
          const { width: fw, height: fh } = s.project.settings
          const kt = s.currentTime - tb.start
          const cam = atlasCamera(tb, kt)
          const ppd = ((fw * 0.95) / 360) * cam.z
          const lonC = cam.lon + (wx - fw / 2) / ppd
          const latC = cam.lat - (wy - fh / 2) / ppd
          const z = Math.max(0.9, Math.min(40, cam.z * factor))
          const ppd2 = ((fw * 0.95) / 360) * z
          const next = { lon: lonC - (wx - fw / 2) / ppd2, lat: latC + (wy - fh / 2) / ppd2, z }
          if (!atlasWheel) s.armGesture()
          window.clearTimeout(atlasWheel)
          atlasWheel = window.setTimeout(() => {
            atlasWheel = 0
            useStore.getState().endGesture()
          }, 380)
          const id = tb.id
          s.editTemplates((p) => {
            const t = p.templates?.find((x) => x.id === id)
            if (t) setAtlasKey(t, kt, next, p.settings.fps)
          }, false)
          return
        }
      }

      zoomPreview()
    }

    // A press on the preview while a title is typed in leaves the focus in
    // its field (the press's default would move it to the canvas).
    const keepFocus = (e: MouseEvent): void => {
      if (typing()) e.preventDefault()
    }
    canvas.addEventListener('mousedown', keepFocus)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', endDrag)
    canvas.addEventListener('pointercancel', endDrag)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    // Before the app's own shortcuts (a capture listener): Esc takes a drag
    // back, the arrows nudge while the preview has the focus.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      flushRef.current = null
      window.clearTimeout(nudgeTimer)
      canvas.removeEventListener('mousedown', keepFocus)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', endDrag)
      canvas.removeEventListener('pointercancel', endDrag)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <>
    <div className="preview-canvas-wrap">
      <canvas
        ref={canvasRef}
        data-testid="preview.canvas"
        // In focus after a press on it (never by Tab): the arrow keys then
        // move the selection.
        tabIndex={-1}
        aria-label={tr('pv.canvas')}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          // Pen mask: right-click a point to remove it (min 3 points stay).
          const s = useStore.getState()
          const mc = s.selectedClipIds.length > 0 ? s.project.clips[s.selectedClipIds[0]] : null
          const canvasEl = canvasRef.current
          const xf = xfRef.current
          const shown = !s.maskDrawMode && (s.maskOverlay === 'on' || (s.maskOverlay === 'auto' && s.clipTabActive && !s.playing))
          if (!mc?.mask?.enabled || mc.mask.shape !== 'path' || !canvasEl || !xf || !shown) return
          const rect = canvasEl.getBoundingClientRect()
          const sx = e.clientX - rect.left
          const sy = e.clientY - rect.top
          const t = clipTransformAt(mc, s.currentTime - mc.start)
          const g = maskGeomAt(mc.mask, s.currentTime - mc.start)
          const pts = g.points ?? []
          if (pts.length <= 3) return
          for (let i = 0; i < pts.length; i++) {
            const [pwx, pwy] = localToWorld(t, pts[i].x, pts[i].y)
            const [hx, hy] = worldToScreen(xf, pwx, pwy)
            if (Math.abs(sx - hx) <= HANDLE_HIT && Math.abs(sy - hy) <= HANDLE_HIT) {
              e.preventDefault()
              s.undoable(() => s.editMaskGeom(mc.id, { points: pts.filter((_, j) => j !== i) }))
              return
            }
          }
        }}
      />
      {/* A work note's drawing: its own layer above the canvas (it takes the
          pointer only while a drawing tool is on). */}
      <NoteDrawLayer />
      {/* The agent's region, "looked here", before / after (phase 4B.4). */}
      <AgentPreviewLayer />
      {/* VideoHub's review page's ideas (ONIZLEME-UYGULA-PLAN.md): the
          review's before frame, the comparison's marks, the click-and-type
          note, the shortcut list. */}
      <PreviewExtras />
      {/* A title typed in where it stands, and the quick bar over the
          selected one (text-edit). */}
      <TextEditLayer canvasRef={canvasRef} />
      {capEdit && (
        <div ref={capEditWrapRef} className={`caption-editor${wordTimingOpen ? ' timing-open' : ''}`} style={{ left: capEdit.x, top: wordTimingOpen ? '50%' : capEdit.y }}>
          <div className="caption-editor-head">
            <div><span>{tr('capedit.kind')}</span><strong>{tr('capedit.title')}</strong></div>
            <IconButton icon="x" variant="ghost" size="sm" label={tr('capedit.close')} onMouseDown={(event) => event.preventDefault()} onClick={saveCapEdit} />
          </div>
          <textarea
            ref={capEditInputRef}
            autoFocus
            rows={3}
            wrap="soft"
            value={capEdit.text}
            onChange={(event) => setCapEdit({ ...capEdit, text: event.target.value })}
            onFocus={(event) => {
              setTimingSelectedWordIndex(null)
              // Opened: its words selected, so typing replaces them (it opened
              // with the caret before the first letter).
              if (!capOpened.current) {
                capOpened.current = true
                event.currentTarget.select()
              }
            }}
            onKeyDown={(event) => {
              if ((event.altKey && event.key === 'Enter') || (event.ctrlKey && event.code === 'Space')) {
                event.preventDefault()
                void splitCapEdit()
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                saveCapEdit()
              }
              if (event.key === 'Escape') {
                setWordTimingOpen(false)
                setTimingSelectedWordIndex(null)
                setMarkerPickerOpen(false)
                setCapEdit(null)
              }
            }}
            onBlur={() => {
              if (!splittingCaptionRef.current && !wordTimingOpen) saveCapEdit()
            }}
          />
          <div className="caption-editor-toolbar">
            <div className="caption-editor-tools">
              <Tooltip content={wordTimingOpen && timingSelectedWordIndex !== null ? tr('capedit.splitWord.hint') : tr('capedit.split.hint')}>
                <Button variant="secondary" size="sm" disabled={!/\S\s+\S/u.test(capEdit.text) || (wordTimingOpen && timingSelectedWordIndex !== null && timingSelectedWordIndex >= [...capEdit.text.matchAll(/\S+/gu)].length - 1)} onMouseDown={(event) => event.preventDefault()} onClick={() => void splitCapEdit()}>{wordTimingOpen && timingSelectedWordIndex !== null ? tr('capedit.splitWord') : tr('capedit.split')}</Button>
              </Tooltip>
              <Tooltip content={tr('capedit.timing.hint')}>
                <Button variant="secondary" size="sm" disabled={!timingCaption?.words?.length} pressed={wordTimingOpen} onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!wordTimingOpen && capEdit.text.trim()) useStore.getState().updateCaption(capEdit.id, { text: capEdit.text.trim() })
                    setTimingSelectedWordIndex(null)
                    setWordTimingOpen(!wordTimingOpen)
                  }}>{tr('capedit.timing')}</Button>
              </Tooltip>
              <Tooltip content={tr('capedit.marker.hint')}>
                <Button variant="secondary" size="sm" icon="highlighter" pressed={markerPickerOpen || !!timingMarker?.enabled} onMouseDown={(event) => event.preventDefault()} onClick={toggleCapMarker}>
                  {tr('capedit.marker')}
                </Button>
              </Tooltip>
            </div>
            <Button variant="secondary" size="sm" className="caption-editor-done" onMouseDown={(event) => event.preventDefault()} onClick={saveCapEdit}>{tr('capedit.done')}</Button>
          </div>
          <div className="caption-editor-hint">{tr('capedit.help')}</div>
          {markerPickerOpen && <div className="caption-marker-picker" aria-label={tr('capedit.picker')}>
            <div className="caption-marker-picker-heading">{tr('capedit.picker.help')}</div>
            <div className="caption-marker-words">
              {[...capEdit.text.matchAll(/\S+/gu)].map((match, index) => {
                const currentText = timingCaption?.text ?? capEdit.text
                const target = capEdit.text.trim() === currentText
                  ? index
                  : remapMarkedWords(capEdit.text, currentText, [index])[0]
                const marked = markerCoversWord(timingMarker, target)
                return <BareButton
                  key={`${match.index}-${index}`}
                  type="button"
                  className={marked ? 'marked' : ''}
                  aria-pressed={marked}
                  title={marked ? tr('capedit.unmark', { word: match[0] }) : tr('capedit.mark', { word: match[0] })}
                  style={marked ? { backgroundColor: timingMarker?.color ?? '#f1ef00' } : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => markCapWords([index])}
                >{match[0]}</BareButton>
              })}
            </div>
          </div>}
          {wordTimingOpen && timingCaption && <WordTimingEditor
            caption={timingCaption}
            onSelectWord={setTimingSelectedWordIndex}
            onSplitAfter={(index) => {
              const next = [...capEdit.text.matchAll(/\S+/gu)][index + 1]
              if (next) splitCapEdit(next.index)
            }}
          />}
        </div>
      )}
    </div>
    {/* Going through what the agent changed: its own strip under the
        picture, never over the film (DENEME-2-PLAN-N.md, K1). */}
    <NoteReviewBar />
    {/* The spoken line, under the picture (Shift+C). */}
    <NarrationLine />
    </>
  )
}
