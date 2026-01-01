// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Typing a title where it stands (SnippStudio YAZI2-PLAN.md, 2.5): the one
// session there can be, kept beside the project store (how the preview is
// being used, never an edit by itself), and its ends in the store: the
// session starts on a title under the playhead, the preview draws its draft
// (draftProject), and ending it writes the title's words once.
import { create } from 'zustand'
import { useStore } from '../../../state/store'
import { captionFont } from '../../../playback/draw/captions'
import type { Caption, Project } from '../../../types'
import { measureCtx } from '../geometry'
import { beginTyping, typingResult, type TypeSession } from './inline'
import { layoutText, type Measure, type TextLayout, type TextSpec } from './layout'

export const useTextEdit = create<{
  session: TypeSession | null
  /** When the caret last moved or a key came (its blink starts lit). */
  touched: number
  /** Something is being dragged in the preview: the quick bar steps aside. */
  dragging: boolean
}>(() => ({ session: null, touched: 0, dragging: false }))

export const typing = (): TypeSession | null => useTextEdit.getState().session

/** A title's words as they are shown anywhere beside the preview (the
 *  Inspector's field, its clip on the timeline): the draft while it is typed
 *  in, else the project's. Shown only: the project still gets the words once,
 *  when the typing ends (YAZI2-PLAN.md, D5 and the addendum). */
export function useTypedText(id: string, text: string): string {
  const typed = useTextEdit((s) => (s.session?.id === id ? s.session.text : null))
  return typed ?? text
}

/** The title being typed in, and its draft (for a list that shows many). */
export function useTyped(): { id: string; text: string } | null {
  const id = useTextEdit((s) => s.session?.id ?? null)
  const text = useTextEdit((s) => s.session?.text ?? '')
  return id ? { id, text } : null
}

/** The title being typed in, as the session has it (the caret's blink restarts). */
export function setTyping(session: TypeSession): void {
  const now = useTextEdit.getState().session
  // Only the session that is open is changed: a late event of a field that
  // is going away must not open it again.
  if (!now || now.id !== session.id || session === now) return
  useTextEdit.setState({ session, touched: performance.now() })
}

/** A title the session can open on: placed by hand, with words. */
export const typable = (c: Caption | undefined): c is Caption & { manual: true } => !!c && !!c.manual && !c.shape

/**
 * Starts typing in a title. The playhead comes to rest where the title is
 * shown as it will stand: inside it, and past its way in (what is typed is
 * what is seen). Playback stops; the title is the selection.
 */
export function startTyping(id: string, select: 'all' | 'end' | number = 'all'): boolean {
  endTyping()
  const s = useStore.getState()
  const cap = s.project.captions.find((c) => c.id === id)
  if (!typable(cap)) return false
  s.setPlaying(false)
  const inDur = cap.anim?.in && cap.anim.in !== 'none' ? cap.anim.inDur ?? 0.35 : 0
  const outDur = cap.anim?.out && cap.anim.out !== 'none' ? cap.anim.outDur ?? 0.35 : 0
  const lo = cap.start + inDur
  const hi = cap.end - outDur
  const t = s.currentTime
  if (t < cap.start || t >= cap.end || (hi > lo && (t < lo || t > hi))) {
    const frame = 1 / Math.max(1, s.project.settings.fps || 30)
    s.setTime(Math.min(Math.max(cap.start, cap.end - frame), hi > lo ? lo : cap.start))
  }
  if (s.selectedCaptionIds.length !== 1 || s.selectedCaptionIds[0] !== id) s.selectCaptions([id])
  if (s.selectedClipIds.length) s.selectClip(null)
  useTextEdit.setState({ session: beginTyping(id, cap.text, select), touched: performance.now() })
  return true
}

/**
 * Ends the session: the draft becomes the title's words in one edit (one
 * undo step for the whole session); words left empty or blank, or unchanged,
 * write nothing (the title keeps its words). `keep: false` drops the draft.
 */
export function endTyping(keep = true): void {
  const session = useTextEdit.getState().session
  if (!session) return
  useTextEdit.setState({ session: null })
  if (!keep) return
  const s = useStore.getState()
  if (!s.project.captions.some((c) => c.id === session.id)) return
  const r = typingResult(session)
  if (r.kind === 'text') s.updateCaption(r.id, { text: r.text })
}

let draftOf: { project: Project; id: string; text: string; out: Project } | null = null

/** The project as the preview draws it while a title is typed in: that
 *  title with the draft's words, everything else the project's own. */
export function draftProject(project: Project): Project {
  const session = useTextEdit.getState().session
  if (!session) return project
  if (draftOf && draftOf.project === project && draftOf.id === session.id && draftOf.text === session.text) return draftOf.out
  const cap = project.captions.find((c) => c.id === session.id)
  if (!cap || cap.text === session.text) return project
  const out = { ...project, captions: project.captions.map((c) => (c === cap ? { ...c, text: session.text } : c)) }
  draftOf = { project, id: session.id, text: session.text, out }
  return out
}

/** A title's layout as the engine sets it at this frame size. */
export function captionSpec(project: Project, cap: Caption): { spec: TextSpec; measure: Measure; key: string } {
  const style = cap.style ?? project.captionStyle
  const { width: W, height: H } = project.settings
  const scale = H / 1080
  const spacing = `${(style.letterSpacing ?? 0) * scale}px`
  const measure: Measure = (text, size) => {
    // (The measuring canvas is the preview's shared one: set every time.)
    measureCtx.font = captionFont(style, size)
    measureCtx.letterSpacing = spacing
    return measureCtx.measureText(text).width
  }
  const spec: TextSpec = {
    text: cap.text,
    uppercase: !!style.uppercase,
    maxLineChars: style.maxLineChars,
    align: style.align ?? 'center',
    fontSize: style.fontSize * scale,
    lineHeight: style.lineHeight ?? 1.25,
    fitWidth: (style.fitWidth ?? 0) * W,
    minFontSize: 8 * scale
  }
  return { spec, measure, key: `${captionFont(style, 1)}|${spacing}|${JSON.stringify(spec)}|${fontsSeen()}` }
}

/** Counted up when a font finishes loading: a layout measured with the
 *  stand-in face is measured again. */
let fontLoads = 0
let watching = false
function fontsSeen(): number {
  if (!watching && typeof document !== 'undefined' && document.fonts) {
    watching = true
    document.fonts.addEventListener('loadingdone', () => void fontLoads++)
  }
  return fontLoads
}

let lastLayout: { key: string; layout: TextLayout } | null = null

/** Where a title's letters are (kept while nothing it depends on changes). */
export function captionLayout(project: Project, cap: Caption): TextLayout {
  const { spec, measure, key } = captionSpec(project, cap)
  if (lastLayout?.key === key) return lastLayout.layout
  const layout = layoutText(spec, measure)
  lastLayout = { key, layout }
  return layout
}
