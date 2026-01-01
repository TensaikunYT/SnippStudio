// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the notes' buttons and keys do to the editor's own state: starting a
// note, picking one, a status, and going through what the agent changed.
// Only the store is touched here (no frames, no clipboard: those are in
// actions.ts), so the tests drive it. The rules themselves are in model.ts.

import { useStore } from '../state/store'
import { projectDuration, type NoteStatus } from '../types'
import { t } from '../ui/strings'
import { notify } from '../ui/toast-core'
import { deleteNote, findNote, reviewLoop, reviewQueue, setNoteStatus, updateNote } from './model'
import { neighbourNote } from './nav'
import { usePreviewUi } from '../components/preview/pv-ui'
import { useSession } from '../agent/session'

/** Asks the note being written to take the keyboard. */
export const NOTE_FOCUS_EVENT = 'snipp-note-focus'

/** Starts a note at the playhead (the N key, the panel's button) or over a
 *  range: the film stops, and the Notes tab opens on it. With a note already
 *  being written, that one takes the keyboard again (its range stays). */
export function newNote(range?: { start: number; end: number }): void {
  // Writing a note ends a review under way (its loop would play on under it).
  if (useStore.getState().noteReview) endReview()
  const s = useStore.getState()
  s.setPlaying(false)
  if (s.noteDraft && !range) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTE_FOCUS_EVENT))
    return
  }
  s.startNoteDraft(range)
}

/** The agent's access is on: the notes' quick ways in are shown only then
 *  (DENEME-2, the user's rule; DENEME-2-PLAN-N.md, K4). */
export const agentAccessOn = (): boolean => !!useSession.getState().status?.server?.running

/** The preview toolbar's "Note" (and Shift+N): click-and-type on or off.
 *  On, a click on the preview stops the film, puts pin 1 there and opens the
 *  box beside it (NoteDrawLayer, PreviewExtras' QuickNote); the Notes tab's
 *  "Point" is the same switch. A review under way ends first (its loop would
 *  play on under the note). */
export function togglePointNote(on?: boolean): void {
  const s = useStore.getState()
  const next = on ?? s.noteTool !== 'pin'
  if (next && s.noteReview) endReview()
  s.setPlaying(false)
  if (!next) usePreviewUi.getState().setQuickNote(null)
  s.setNoteTool(next ? 'pin' : null)
}

/** Picks a note and goes to it (to its drawing's frame when it has one). */
export function goToNote(id: string): void {
  const s = useStore.getState()
  const n = findNote(s.project, id)
  if (!n) return
  s.selectNote(id)
  s.setPlaying(false)
  s.setTime(n.at ?? n.start)
}

export function removeNote(id: string): void {
  const s = useStore.getState()
  s.editNotes((p) => deleteNote(p, id))
  if (s.noteSel === id) s.selectNote(null)
}

/** A status set by the user (never an undo step: see FAZ1-PLAN.md, K6). */
export function markNote(id: string, status: NoteStatus): void {
  useStore.getState().editNotes((p) => void setNoteStatus(p, id, status), false)
}

// --- going through what the agent changed ---------------------------------------
// VideoHub's "watch only what changed": each answered note's stretch loops in
// the preview, straight from the timeline (nothing is rendered), and the user
// approves it or sends it back.

/** Shows one note of the review: picked, its changed stretch looping. */
function showReview(index: number): void {
  const s = useStore.getState()
  const review = s.noteReview
  if (!review) return
  const n = findNote(s.project, review.ids[index])
  if (!n) return
  const loop = reviewLoop(n, projectDuration(s.project))
  // Each note starts on the frame as it is now (B shows the one before).
  usePreviewUi.getState().setReviewBefore(false)
  s.setNoteReview({ ids: review.ids, index })
  s.selectNote(n.id)
  s.setLoopRange(loop)
  s.setTime(loop[0])
  s.setPlaying(true)
}

/** Starts the review: every note with an answer, in the order of what
 *  changed on the timeline (from `fromId` when given). */
export function startReview(fromId?: string): void {
  const s = useStore.getState()
  const ids = reviewQueue(s.project).map((n) => n.id)
  if (ids.length === 0) return
  s.cancelNoteDraft()
  s.setNoteReview({ ids, index: 0 })
  showReview(Math.max(0, fromId ? ids.indexOf(fromId) : 0))
}

export function endReview(): void {
  usePreviewUi.getState().setReviewBefore(false)
  const s = useStore.getState()
  s.setPlaying(false)
  s.setLoopRange(null)
  s.setNoteReview(null)
}

/** To the next (or previous) note of the review; past the last one it ends. */
export function stepReview(dir: 1 | -1): void {
  const review = useStore.getState().noteReview
  if (!review) return
  const index = review.index + dir
  if (index < 0) return
  if (index >= review.ids.length) {
    endReview()
    notify({ text: t('notes.toast.reviewDone') })
    return
  }
  showReview(index)
}

/** Plays the note under review again from the top of its stretch. */
export function replayReview(): void {
  const review = useStore.getState().noteReview
  if (review) showReview(review.index)
}

/** Approve, or send back ("still there", with what is still wrong added to
 *  the note's text when said: ONIZLEME-UYGULA-PLAN.md, K5), and go on to the
 *  next. */
export function decideReview(status: 'approved' | 'still', why = ''): void {
  const s = useStore.getState()
  const review = s.noteReview
  if (!review) return
  const id = review.ids[review.index]
  const said = why.trim()
  const n = findNote(s.project, id)
  if (status === 'still' && said && n) {
    const text = t('review.still.added', { text: n.text, why: said }).trim()
    s.editNotes((p) => {
      updateNote(p, id, { text })
      setNoteStatus(p, id, status)
    }, false)
  } else markNote(id, status)
  stepReview(1)
}

/** B in a review: the note's saved frame over the preview, or the frame now.
 *  A note without a saved frame (no drawing) says so. */
export function toggleReviewBefore(): void {
  const s = useStore.getState()
  const review = s.noteReview
  if (!review) return
  const ui = usePreviewUi.getState()
  if (ui.reviewBefore) return ui.setReviewBefore(false)
  const n = findNote(s.project, review.ids[review.index])
  if (!n?.regionImage) {
    notify({ text: t('review.before.none') })
    return
  }
  s.setPlaying(false)
  if (n.at !== undefined) s.setTime(n.at)
  ui.setReviewBefore(true)
}

/** , and . : the note before or after the playhead, picked and gone to. */
export function stepNote(dir: -1 | 1): boolean {
  const s = useStore.getState()
  const n = neighbourNote(s.project.notes ?? [], s.currentTime, dir, s.noteSel)
  if (!n) return false
  goToNote(n.id)
  return true
}
