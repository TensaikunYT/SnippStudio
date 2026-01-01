// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the transition editing needs beside the project (core polish T): the
// transition that is selected, the remembered default (the kind and length
// a click on a cut or Ctrl+T adds), the length label of an end being dragged,
// and the few actions every surface shares (the cut on the timeline, its
// menu, the Inspector, Ctrl+T, a drop from Library). None of it is an edit of
// its own: the edits are the store's `setTransitionOut`, one undo step each.
import { create } from 'zustand'
import { useStore } from '../../state/store'
import {
  FIRST_DEFAULT,
  clampDuration,
  isTransitionType,
  nearestCut,
  withType,
  type Transition,
  type TransitionType
} from '../../timeline/transition-types'

const DEFAULT_KEY = 'snipp-transition-default'

function readDefault(): { type: TransitionType; duration: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(DEFAULT_KEY) ?? 'null') as { type?: unknown; duration?: unknown } | null
    if (raw && isTransitionType(raw.type) && typeof raw.duration === 'number') return { type: raw.type, duration: clampDuration(raw.duration) }
  } catch {
    /* nothing kept, or storage blocked */
  }
  return { ...FIRST_DEFAULT }
}

export const useTransitionUi = create<{
  /** The selected transition: the id of the clip it leaves (null: none). */
  sel: string | null
  /** What a click on a cut and Ctrl+T add: the last kind and length used, or
   *  the one made the default. Kept with the profile, not in the project. */
  def: { type: TransitionType; duration: number }
  /** An end being dragged: its label (the length now), at its cut. */
  tip: { clipId: string; text: string } | null
}>(() => ({ sel: null, def: readDefault(), tip: null }))

/** Remember a kind and/or a length as the default (the last one used). */
export function rememberDefault(next: { type?: TransitionType; duration?: number }): void {
  const cur = useTransitionUi.getState().def
  const def = { type: next.type ?? cur.type, duration: next.duration === undefined ? cur.duration : clampDuration(next.duration) }
  if (def.type === cur.type && def.duration === cur.duration) return
  useTransitionUi.setState({ def })
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify(def))
  } catch {
    /* not kept: fine */
  }
}

/** Select the transition `clipId` leaves with (null: let go). One thing is
 *  selected at a time: the clips, titles and graphic let go. */
export function selectTransition(clipId: string | null): void {
  if (clipId) {
    const s = useStore.getState()
    if (s.selectedClipIds.length) s.selectClip(null)
    if (s.selectedCaptionIds.length) s.selectCaptions([])
    if (s.templateSel) s.selectTemplate(null)
    if (s.noteSel) s.selectNote(null)
  }
  if (useTransitionUi.getState().sel !== clipId) useTransitionUi.setState({ sel: clipId })
}

/** The selected transition, if it is still there. */
export function selectedTransition(): { clipId: string; tr: Transition } | null {
  const id = useTransitionUi.getState().sel
  const tr = id ? useStore.getState().project.clips[id]?.transitionOut : undefined
  return id && tr ? { clipId: id, tr } : null
}

// Picking anything else lets the transition go.
useStore.subscribe((s, prev) => {
  if (!useTransitionUi.getState().sel) return
  if (
    (s.selectedClipIds !== prev.selectedClipIds && s.selectedClipIds.length > 0) ||
    (s.selectedCaptionIds !== prev.selectedCaptionIds && s.selectedCaptionIds.length > 0) ||
    (s.templateSel !== prev.templateSel && !!s.templateSel) ||
    (s.noteSel !== prev.noteSel && !!s.noteSel) ||
    // A new project, or the transition undone away.
    (s.project !== prev.project && !s.project.clips[useTransitionUi.getState().sel!]?.transitionOut)
  )
    useTransitionUi.setState({ sel: null })
})

/** Set (or replace) the transition `clipId` leaves with: one undo step. */
export function putTransition(clipId: string, tr: Transition | null): void {
  const st = useStore.getState()
  st.undoable(() => st.setTransitionOut(clipId, tr))
}

/** A cut's transition becomes the default one (what a click on a cut adds):
 *  one undo step, and it is selected. A transition already there keeps its
 *  sound and where it sits; its kind and length become the default's.
 *  `select`: false from the Clip tab, where the clip stays selected. */
export function addDefaultAt(clipId: string, select = true): void {
  const clip = useStore.getState().project.clips[clipId]
  if (!clip) return
  const { type, duration } = useTransitionUi.getState().def
  putTransition(clipId, withType(clip.transitionOut ? { ...clip.transitionOut, duration } : null, type, duration))
  if (select) selectTransition(clipId)
}

/** Change the kind of `clipId`'s transition (it is remembered as the
 *  default kind). One undo step. */
export function setTransitionType(clipId: string, type: TransitionType): void {
  const clip = useStore.getState().project.clips[clipId]
  if (!clip) return
  if (clip.transitionOut?.type === type) return
  const next = withType(clip.transitionOut, type, useTransitionUi.getState().def.duration)
  putTransition(clipId, next)
  rememberDefault({ type })
}

/** This transition's kind and length become the default. */
export function makeDefault(clipId: string): void {
  const tr = useStore.getState().project.clips[clipId]?.transitionOut
  if (tr) rememberDefault({ type: tr.type, duration: tr.duration })
}

/** Ctrl+T: the default transition on the selected transition's cut, or on the
 *  cut nearest the playhead (the selected clip's track first). False: there
 *  is no cut to put one on. */
export function addDefaultNearPlayhead(): boolean {
  const sel = selectedTransition()
  if (sel) {
    addDefaultAt(sel.clipId)
    return true
  }
  const s = useStore.getState()
  const picked = s.selectedClipIds.map((id) => s.project.clips[id]).find(Boolean)
  const cut = nearestCut(s.project, s.currentTime, picked?.trackId)
  if (!cut) return false
  addDefaultAt(cut.clipId)
  return true
}

let stopWatch: (() => void) | null = null
/**
 * Play the cut: from 1 s before it to 1 s after it, then stop. Pressing
 * pause or moving the playhead elsewhere ends it (the playhead stays where
 * the user put it).
 */
export function playCut(clipId: string): void {
  stopWatch?.()
  const s = useStore.getState()
  const clip = s.project.clips[clipId]
  if (!clip) return
  const cut = clip.start + clip.duration
  const from = Math.max(0, cut - 1)
  const to = cut + 1
  s.setPlaying(false)
  s.setTime(from)
  s.setPlaying(true)
  let last = from
  const unsub = useStore.subscribe((st) => {
    if (!st.playing) return done()
    // Moved by hand (a seek back, a jump far ahead): not ours any more.
    if (st.currentTime < last - 0.25 || st.currentTime > to + 0.5) return done()
    last = st.currentTime
    if (st.currentTime >= to) {
      done()
      st.setPlaying(false)
    }
  })
  function done(): void {
    unsub()
    if (stopWatch === done) stopWatch = null
  }
  stopWatch = done
}
