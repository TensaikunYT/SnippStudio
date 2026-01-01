// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The notes' actions that reach outside the editor's own state: a saved
// note's frame picture and "Send to agent" (the agent's inbox; its Copy for
// the agent's chat: agent/send-line.ts).
// (Starting, picking and reviewing notes: review.ts. The rules: model.ts.)

import { t } from '../ui/strings'
import { CHANNEL } from '../channel'
import { registeredServerName } from '../../../shared/product'
import { projectSession, useStore } from '../state/store'
import { notify } from '../ui/toast-core'
import { captureNoteImage } from './image'
import { notesToSend } from './model'
import { sendToInbox, useInbox } from '../agent/inbox'
import { noteSent } from '../agent/send-line'

/** The name an agent knows this copy by: the one the user added it under
 *  (Settings → Agent connection; shared/product.ts registeredServerName). */
export const AGENT_SERVER_NAME = registeredServerName(CHANNEL)

/**
 * Saves the note being written. With a drawing, its frame picture is made
 * right after (the frame an export would draw, with the drawing on it) and
 * put on the note when it is ready. Returns the note's id, or null when the
 * draft says nothing yet.
 */
export function saveDraft(): string | null {
  const before = useStore.getState()
  const draft = before.noteDraft
  const id = before.saveNoteDraft()
  if (!id) {
    if (draft) notify({ text: t('notes.toast.empty'), kind: 'error' })
    return null
  }
  if (draft && draft.shapes.length > 0) {
    const session = projectSession()
    void captureNoteImage(useStore.getState().project, draft.at ?? draft.start, draft.shapes)
      .then((image) => {
        // Another project was opened meanwhile: the picture is not its.
        if (image && projectSession() === session) useStore.getState().setNoteImage(id, image)
      })
      .catch(() => undefined)
  }
  return id
}

/** The open notes not in line for the agent yet (what the button sends). */
export function notesNotQueued(): string[] {
  const queued = new Set(useInbox.getState().queuedNotes)
  return notesToSend(useStore.getState().project)
    .map((n) => n.id)
    .filter((id) => !queued.has(id))
}

/**
 * "Send to agent" (GONDER-PLAN.md, 13): the open notes not in line yet go to
 * the agent's inbox; a waiting agent's `wait` call takes them at once, else
 * its next one. (They stay "open" until the agent takes them; the notes tool
 * reads them too.) When no agent waits, the toast and the line under the
 * button offer Copy (agent/send-line.ts).
 */
export function sendNotesToAgent(): number {
  const ids = notesNotQueued()
  if (ids.length === 0) return 0
  const r = sendToInbox({ kind: 'notes', notes: ids })
  // (GONDER2-PLAN.md: taken, or in line with Copy: the notes' own text for
  // the agent's chat, out of the line.)
  noteSent('notes', r, { kind: 'notes', notes: ids }, true)
  return ids.length
}
