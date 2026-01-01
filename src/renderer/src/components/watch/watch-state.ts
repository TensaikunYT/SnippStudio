// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch-and-note mode (Desktop\SnippStudio\IZLE-PLAN.md): a way of
// looking at the project, never part of it. Entering it keeps what the
// editor looked like (the preview's zoom, the timeline's scroll, the drawing
// tool) and leaving puts it back; the panels themselves stay mounted under
// the mode's layer, so their tab, selection and open sections never move.
// Nothing here is saved, in the project or in the profile.
import { create } from 'zustand'
import { useStore } from '../../state/store'
import { saveDraft } from '../../notes/actions'
import { endReview } from '../../notes/review'
import { usePreviewUi } from '../preview/pv-ui'
import type { NoteShape } from '../../types'

interface Saved {
  view: { zoom: number; x: number; y: number }
  tool: NoteShape['type'] | null
  scroll: { left: number; top: number } | null
  clips: string[]
}

interface WatchState {
  on: boolean
  saved: Saved | null
  /** The film was playing when the note being written stopped it: Enter
   *  plays on (the click's own flag is the preview's quickNote). */
  wasPlaying: boolean
}

export const useWatch = create<WatchState>(() => ({ on: false, saved: null, wasPlaying: false }))

export const watching = (): boolean => useWatch.getState().on

const timelineScroller = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.tl-scroll'))

export function enterWatch(): void {
  if (watching()) return
  const s = useStore.getState()
  const el = timelineScroller()
  useWatch.setState({
    on: true,
    wasPlaying: false,
    saved: { view: { ...s.previewView }, tool: s.noteTool, scroll: el ? { left: el.scrollLeft, top: el.scrollTop } : null, clips: [...s.selectedClipIds] }
  })
  usePreviewUi.getState().setQuickNote(null)
  // The whole frame, and the pin in hand: a click on the picture is a note.
  s.setPreviewView({ zoom: 1, x: 0, y: 0 })
  s.setNoteTool('pin')
  // No clip's handles over the film while watching: the selection waits for the editor.
  if (s.selectedClipIds.length > 0) s.selectClips([])
}

/** Back to the editor as it was. A note half written is kept when it says
 *  or draws anything, let go when it is empty: nothing is lost. */
export function exitWatch(): void {
  const w = useWatch.getState()
  if (!w.on) return
  const s = useStore.getState()
  const d = s.noteDraft
  usePreviewUi.getState().setQuickNote(null)
  if (d) {
    if (d.text.trim() || d.shapes.length > 0) {
      saveDraft()
      // The editor sees the saved note while the mode is still on (its
      // Notes tab does not open over the tab it had: K4); then out.
      setTimeout(() => leave(w.saved), 0)
      return
    }
    s.cancelNoteDraft()
  }
  leave(w.saved)
}

function leave(saved: Saved | null): void {
  if (!useWatch.getState().on) return
  useWatch.setState({ on: false, saved: null, wasPlaying: false })
  const now = useStore.getState()
  now.setNoteTool(saved?.tool ?? null)
  if (saved) {
    now.setPreviewView(saved.view)
    if (saved.clips.length > 0) now.selectClips(saved.clips.filter((id) => !!now.project.clips[id]))
  }
  const scroll = saved?.scroll
  if (scroll) {
    // After the layer is gone and the timeline laid out again.
    const put = (): void => {
      const el = timelineScroller()
      if (!el) return
      el.scrollLeft = scroll.left
      el.scrollTop = scroll.top
    }
    put()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(put)
  }
}

export const toggleWatch = (): void => (watching() ? exitWatch() : enterWatch())

/** A note started by the mode (N, a drag on the strip, the pen): the film
 *  stops; the box opens. */
export function startWatchNote(range?: { start: number; end: number }, tool: NoteShape['type'] = 'pin'): void {
  const s = useStore.getState()
  if (s.noteReview) endReview()
  const was = s.playing
  s.setPlaying(false)
  usePreviewUi.getState().setQuickNote(null)
  if (s.noteDraft && !range) {
    s.setNoteTool(tool)
    return
  }
  useWatch.setState({ wasPlaying: was })
  useStore.getState().startNoteDraft(range)
  useStore.getState().setNoteTool(tool)
}

/** Enter in the box: the note is saved, the pin is in hand again and the
 *  film plays on when the note stopped it. */
export function saveWatchNote(): string | null {
  const pin = usePreviewUi.getState().quickNote
  const playOn = pin ? pin.wasPlaying : useWatch.getState().wasPlaying
  const id = saveDraft()
  if (!id) return null
  usePreviewUi.getState().setQuickNote(null)
  useWatch.setState({ wasPlaying: false })
  const s = useStore.getState()
  s.setNoteTool('pin')
  if (playOn) s.setPlaying(true)
  return id
}

/** Esc in the box: the note goes (its pin and its words). */
export function dropWatchNote(): void {
  usePreviewUi.getState().setQuickNote(null)
  useWatch.setState({ wasPlaying: false })
  const s = useStore.getState()
  s.cancelNoteDraft()
  s.setNoteTool('pin')
}
