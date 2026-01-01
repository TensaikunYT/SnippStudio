// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Over the preview's canvas (SnippStudio YAZI2-PLAN.md, 2.5 and 2.6): the
// unseen field a title is typed through (the keys, the clipboard and the
// input method are the system's own; the letters, the caret and the selection
// are drawn on the canvas where the title stands), and the quick bar over the
// selected title: font, size, colour, alignment, bold, italic, style.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '../../../state/store'
import { showingCandidate } from '../../../playback/candidate'
import type { Caption, CaptionStyle } from '../../../types'
import { Button, IconButton, MenuTrigger, NumberField, Tooltip, useT } from '../../../ui'
import { FontSelect } from '../../inspector/fonts'
import { applyLook } from '../../text/TextStyles'
import { TEXT_LOOKS } from '../../text/looks'
import { worldToScreen, type ViewXform } from '../geometry'
import { OUTLINE_PAD, boundsOf, boxKnob, grown, type TurnedBox } from './handles'
import { barPlace, type Frame } from './bar-place'
import { CardDragGhost } from './card-drag'
import { caretToEdge, caretVertical, fieldChanged, fieldSelection, spaceLeaves } from './inline'
import { worldBox } from './interaction'
import { captionLayout, draftProject, endTyping, setTyping, typable, useTextEdit } from './session'

/** The field of the session, for whoever must hand the keys back to it. */
let field: HTMLTextAreaElement | null = null
/** The keys go back to the title being typed in (after a quick bar control took them). */
export function refocusTyping(): void {
  if (useTextEdit.getState().session) field?.focus({ preventScroll: true })
}

/** The canvas's size as laid out, kept by an observer. */
function useCanvasSize(canvasRef: RefObject<HTMLCanvasElement>): { cw: number; ch: number } {
  const [size, setSize] = useState({ cw: 0, ch: 0 })
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const read = (): void => setSize((was) => (was.cw === cv.clientWidth && was.ch === cv.clientHeight ? was : { cw: cv.clientWidth, ch: cv.clientHeight }))
    const ro = new ResizeObserver(read)
    ro.observe(cv)
    read()
    return () => ro.disconnect()
  }, [canvasRef])
  return size
}

/** The selected titles under the playhead (not shapes), and the first one's
 *  outline on screen. Null while there is none, or the film plays. */
function useSelectedTitle(size: { cw: number; ch: number }): { caps: Caption[]; outline: TurnedBox; frame: Frame } | null {
  const ids = useStore((s) => s.selectedCaptionIds)
  const stored = useStore((s) => s.project)
  const time = useStore((s) => (s.playing ? -1 : s.currentTime))
  const view = useStore((s) => s.previewView)
  // (The draft's words: the outline follows what is typed.)
  useTextEdit((t) => t.session?.text)
  if (time < 0 || size.cw < 2 || showingCandidate()) return null
  const project = draftProject(stored)
  const caps = ids.map((id) => project.captions.find((c) => c.id === id)).filter((c): c is Caption => typable(c) && time >= c.start && time < c.end)
  if (!caps.length) return null
  const { width, height } = project.settings
  const k = Math.min(size.cw / width, size.ch / height) * view.zoom
  const xf: ViewXform = { cx: width / 2 - view.x / k, cy: height / 2 - view.y / k, k, cw: size.cw, ch: size.ch }
  const w = worldBox(project, caps[0], time)
  const [cx, cy] = worldToScreen(xf, w.cx, w.cy)
  // The picture's own box in the preview (the bar keeps inside it).
  const [fl, ft] = worldToScreen(xf, 0, 0)
  const [fr, fb] = worldToScreen(xf, width, height)
  return { caps, outline: grown({ cx, cy, w: w.w * k, h: w.h * k, rot: w.rot }, OUTLINE_PAD), frame: { l: fl, t: ft, r: fr, b: fb } }
}

/** The field a title is typed through: real, focused, not seen. */
function TypeField({ canvasRef, at }: { canvasRef: RefObject<HTMLCanvasElement>; at: { x: number; y: number } | null }): JSX.Element | null {
  const t = useT()
  const session = useTextEdit((s) => s.session)
  const ref = useRef<HTMLTextAreaElement>(null)
  const id = session?.id ?? null
  // The session's selection is the field's (a click on the canvas, a line up
  // or down, "select all" at the start set it from outside the field).
  useLayoutEffect(() => {
    const ta = ref.current
    field = ta
    if (!ta || !session) return
    if (document.activeElement !== ta && !document.activeElement?.closest('.yz-bar')) ta.focus({ preventScroll: true })
    const [a, b, dir] = fieldSelection(session)
    if (ta.selectionStart !== a || ta.selectionEnd !== b) ta.setSelectionRange(a, b, dir)
  }, [session])
  useEffect(() => {
    if (!id) return
    // The typing ends when its title is no longer what is worked on: another
    // thing picked, the playhead gone from it, the film playing, it deleted.
    const unsub = useStore.subscribe((s) => {
      const ses = useTextEdit.getState().session
      if (!ses) return
      const cap = s.project.captions.find((c) => c.id === ses.id)
      if (!cap || !s.selectedCaptionIds.includes(ses.id) || s.playing || s.currentTime < cap.start || s.currentTime >= cap.end) endTyping()
    })
    // A press anywhere but the preview and this layer ends it (the preview's
    // own presses are told apart there: in the title's words or not).
    const outside = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (!target || canvasRef.current?.contains(target) || target.closest('.yz-layer')) return
      endTyping()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => {
      unsub()
      document.removeEventListener('pointerdown', outside, true)
      // (Unmounted with a session still open: its words are kept.)
      endTyping()
    }
  }, [id, canvasRef])
  if (!session) return null
  const read = (ta: HTMLTextAreaElement): void => {
    // (The session as it is now, not as this render saw it.)
    const now = useTextEdit.getState().session
    if (now) setTyping(fieldChanged(now, ta.value, ta.selectionStart, ta.selectionEnd, ta.selectionDirection === 'backward'))
  }
  return (
    <textarea
      ref={ref}
      className="yz-type-field"
      data-testid="preview.text.field"
      aria-label={t('yz.type.field')}
      style={at ? { left: at.x, top: at.y } : undefined}
      value={session.text}
      wrap="off"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      onChange={(e) => read(e.currentTarget)}
      onSelect={(e) => read(e.currentTarget)}
      onBlur={() => {
        // The preview or nothing took the focus (a press on the canvas, a
        // closed menu): the keys are still the title's.
        window.setTimeout(() => {
          const a = document.activeElement
          if (useTextEdit.getState().session && (!a || a === document.body || a === canvasRef.current)) ref.current?.focus({ preventScroll: true })
        }, 0)
      }}
      onKeyDown={(e) => {
        const plain = !e.ctrlKey && !e.metaKey && !e.altKey
        if (spaceLeaves(session, { key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey })) {
          // Nothing typed yet: Space plays or stops as anywhere else (cila4,
          // 5), the words as they were. The same key, given to the preview.
          e.preventDefault()
          e.stopPropagation()
          endTyping()
          const cv = canvasRef.current
          cv?.focus({ preventScroll: true })
          ;(cv ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }))
          return
        }
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          // Done: the words are kept, the title stays selected, the preview has the keys.
          e.preventDefault()
          e.stopPropagation()
          endTyping()
          canvasRef.current?.focus({ preventScroll: true })
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          return
        }
        if (!plain || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
        // Up, down, Home and End go by the lines as they are drawn (the
        // field's own lines are only the paragraphs).
        const s = useStore.getState()
        const project = draftProject(s.project)
        const cap = project.captions.find((c) => c.id === session.id)
        if (!cap) return
        e.preventDefault()
        const layout = captionLayout(project, cap)
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setTyping(caretVertical(session, layout, e.key === 'ArrowUp' ? -1 : 1, e.shiftKey))
        else setTyping(caretToEdge(session, layout, e.key === 'Home' ? 'start' : 'end', e.shiftKey))
      }}
    />
  )
}

const BAR_H = 36

/** The quick bar over the selected title. */
function QuickBar({ caps, outline, frame, size }: { caps: Caption[]; outline: TurnedBox; frame: Frame; size: { cw: number; ch: number } }): JSX.Element {
  const t = useT()
  const base = useStore((s) => s.project.captionStyle)
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    if (w && w !== width) setWidth(w)
  })
  const st = caps[0].style ?? base
  const edit = (patch: Partial<CaptionStyle>): void => {
    const s = useStore.getState()
    if (caps.length === 1) s.setCaptionOwnStyle(caps[0].id, patch)
    else s.undoable(() => caps.forEach((c) => s.setCaptionOwnStyle(c.id, patch)))
    refocusTyping()
  }
  const { knob } = boxKnob(outline, size.ch)
  const at = barPlace(boundsOf(outline), knob[1], { w: width, h: BAR_H }, frame, size)
  const align = st.align ?? 'center'
  const bold = st.fontWeight >= 600
  return (
    <div ref={ref} className="yz-bar" role="toolbar" aria-label={t('yz.bar')} data-testid="preview.text.bar" data-side={at.side} style={{ left: at.left, top: at.top, visibility: width ? 'visible' : 'hidden' }}>
      <Tooltip content={t('yz.bar.font')}>
        <span className="yz-bar-font">
          <FontSelect value={st.fontFamily} label={t('yz.bar.font')} testid="preview.text.bar.font" onChange={(fontFamily) => edit({ fontFamily })} />
        </span>
      </Tooltip>
      <Tooltip content={t('yz.bar.size')}>
        <span className="yz-bar-size">
          <NumberField value={Math.round(st.fontSize)} label={t('yz.bar.size')} min={8} max={400} step={1} size="sm" testid="preview.text.bar.size" onChange={(fontSize) => edit({ fontSize })} />
        </span>
      </Tooltip>
      <Tooltip content={t('yz.bar.colour')}>
        <input type="color" className="yz-bar-colour" value={st.color} aria-label={t('yz.bar.colour')} data-testid="preview.text.bar.colour" onChange={(e) => edit({ color: e.target.value })} />
      </Tooltip>
      <span className="yz-bar-sep" aria-hidden="true" />
      <IconButton icon="text-align-start" size="sm" label={t('yz.bar.align.left')} pressed={align === 'left'} testid="preview.text.bar.align.left" onClick={() => edit({ align: 'left' })} />
      <IconButton icon="text-align-center" size="sm" label={t('yz.bar.align.center')} pressed={align === 'center'} testid="preview.text.bar.align.center" onClick={() => edit({ align: 'center' })} />
      <IconButton icon="text-align-end" size="sm" label={t('yz.bar.align.right')} pressed={align === 'right'} testid="preview.text.bar.align.right" onClick={() => edit({ align: 'right' })} />
      <span className="yz-bar-sep" aria-hidden="true" />
      <Tooltip content={t('yz.bar.bold')}>
        <Button variant="ghost" size="sm" className="yz-bar-letter is-bold" aria-label={t('yz.bar.bold')} pressed={bold} testid="preview.text.bar.bold" onClick={() => edit({ fontWeight: bold ? 400 : 700 })}>
          {t('yz.bar.bold.letter')}
        </Button>
      </Tooltip>
      <Tooltip content={t('yz.bar.italic')}>
        <Button variant="ghost" size="sm" className="yz-bar-letter is-italic" aria-label={t('yz.bar.italic')} pressed={!!st.italic} testid="preview.text.bar.italic" onClick={() => edit({ italic: !st.italic })}>
          {t('yz.bar.italic.letter')}
        </Button>
      </Tooltip>
      <span className="yz-bar-sep" aria-hidden="true" />
      <MenuTrigger
        label={t('yz.bar.style')}
        hint={t('yz.bar.style.hint')}
        size="sm"
        testid="preview.text.bar.style"
        items={() => TEXT_LOOKS.map((l) => ({ id: l.id, label: t(l.name), testid: `preview.text.bar.style.${l.id}`, onSelect: () => applyLook(l.look) }))}
      />
    </div>
  )
}

export function TextEditLayer({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement> }): JSX.Element {
  const size = useCanvasSize(canvasRef)
  const sel = useSelectedTitle(size)
  const dragging = useTextEdit((s) => s.dragging)
  return (
    <div className="yz-layer">
      <TypeField canvasRef={canvasRef} at={sel ? { x: sel.outline.cx, y: sel.outline.cy } : null} />
      {sel && !dragging && <QuickBar caps={sel.caps} outline={sel.outline} frame={sel.frame} size={size} />}
      <CardDragGhost />
    </div>
  )
}
