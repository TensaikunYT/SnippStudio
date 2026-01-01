// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Typing a title where it stands (SnippStudio YAZI2-PLAN.md, 2.5, D5): the
// session's state. The words being typed are a draft: the preview draws them,
// the project gets them once, when the session ends (one undo step however
// long the typing took). A real, unseen text field takes the keys; what it
// holds and where its selection is come in here.
// Pure; tested in src/test/text-edit-inline.test.ts.
import { caretAt, lineEdge, moveVertical, wordAt, type TextLayout } from './layout'

export interface TypeSession {
  /** The title. */
  id: string
  /** Its words when the session began. */
  original: string
  /** The draft. */
  text: string
  /** The selection: where it began and where the caret is. */
  anchor: number
  focus: number
  /** The x a run of up / down moves keeps to (unset after anything else). */
  wantX: number | null
}

export function beginTyping(id: string, text: string, select: 'all' | 'end' | number = 'all'): TypeSession {
  const at = select === 'all' ? text.length : select === 'end' ? text.length : Math.min(text.length, Math.max(0, select))
  return { id, original: text, text, anchor: select === 'all' ? 0 : at, focus: at, wantX: null }
}

/** The field changed (a key, a paste, its own caret moves): its value and its
 *  selection, `backward` when the caret is at the selection's start. */
export function fieldChanged(s: TypeSession, value: string, start: number, end: number, backward: boolean): TypeSession {
  const anchor = backward ? end : start
  const focus = backward ? start : end
  if (value === s.text && anchor === s.anchor && focus === s.focus) return s
  return { ...s, text: value, anchor, focus, wantX: null }
}

/** The caret put at a place (a click), or the selection run to it (a drag,
 *  Shift + click). */
export function caretTo(s: TypeSession, index: number, extend: boolean): TypeSession {
  const focus = Math.min(s.text.length, Math.max(0, index))
  return { ...s, anchor: extend ? s.anchor : focus, focus, wantX: null }
}

/** A double-click: the word there. */
export function selectWord(s: TypeSession, index: number): TypeSession {
  const [a, b] = wordAt(s.text, index)
  return { ...s, anchor: a, focus: b, wantX: null }
}

/** Up or down a line of the block as it is drawn. */
export function caretVertical(s: TypeSession, layout: TextLayout, dir: -1 | 1, extend: boolean): TypeSession {
  const m = moveVertical(layout, s.focus, dir, s.wantX ?? caretAt(layout, s.focus).x)
  return { ...s, anchor: extend ? s.anchor : m.index, focus: m.index, wantX: m.x }
}

/** Home / End: the drawn line's start or end. */
export function caretToEdge(s: TypeSession, layout: TextLayout, edge: 'start' | 'end', extend: boolean): TypeSession {
  const focus = lineEdge(layout, s.focus, edge)
  return { ...s, anchor: extend ? s.anchor : focus, focus, wantX: null }
}

/** The field's own selection for a session: start, end, direction. */
export function fieldSelection(s: TypeSession): [number, number, 'forward' | 'backward'] {
  return s.focus < s.anchor ? [s.focus, s.anchor, 'backward'] : [s.anchor, s.focus, 'forward']
}

export type TypeResult = { kind: 'none' } | { kind: 'text'; id: string; text: string }

/** What ending the session writes: nothing when the words are as they were,
 *  else its new words (blanks at the ends dropped: the drawing does not show
 *  them). Words typed away to nothing, or to blanks only, are not kept and do
 *  not delete the title (cila4, 5: a Space on a new title's selected words
 *  made it one blank and the title was gone): its words stay as they were,
 *  without a word said. */
export function typingResult(s: TypeSession): TypeResult {
  const text = s.text.replace(/\r\n?/g, '\n').trim()
  if (!text || text === s.original) return { kind: 'none' }
  return { kind: 'text', id: s.id, text }
}

/** A Space pressed on a session nothing was typed in yet, its words all
 *  selected (a title just added, or opened to be typed in): it leaves the
 *  typing and does what Space does elsewhere (play / pause) instead of
 *  putting a blank in place of the words (cila4, 5). A letter or a digit
 *  still takes their place. */
export function spaceLeaves(s: TypeSession, key: { key: string; ctrl: boolean; alt: boolean; meta: boolean; shift: boolean }): boolean {
  if (key.key !== ' ' || key.ctrl || key.alt || key.meta || key.shift) return false
  const [a, b] = s.anchor <= s.focus ? [s.anchor, s.focus] : [s.focus, s.anchor]
  return s.text === s.original && s.text.length > 0 && a === 0 && b === s.text.length
}
