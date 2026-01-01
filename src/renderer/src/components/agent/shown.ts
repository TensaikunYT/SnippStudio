// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Which project the timeline shows (D22, worker C; YOL-HARITASI.md, part 4:
// "Before | After changes the timeline itself"): the live project, or —
// while an agent's draft waits and "After" is chosen — the draft's project,
// drawn by the same lanes and clips, read-only. The switch is the preview's
// own (playback/candidate.ts): After plays the draft there too, the
// playhead at the same second in both.
import { useSyncExternalStore } from 'react'
import { useAgentStore } from '../../agent/store'
import { candidate } from '../../playback/candidate'
import type { Project } from '../../types'
import { adoptingNow } from '../../agent/drafts'
import { filmGate } from '../../state/shared'
import { notify, t } from '../../ui'

const showing = (): boolean => candidate.get().showing === 'candidate' && !!candidate.get().project

/** The timeline shows an agent's draft now ("After"). */
export const timelineShowsDraft = (): boolean => showing() && !!useAgentStore.getState().draft?.project

// "After" is read-only (D22, worker C, the second pass): the lanes take no
// press there, and an edit that reaches the store another way — a key
// (Delete, the split and trim keys, paste), a toolbar button, media dropped
// in, a field of the Inspector — is not made either: the film's gate
// (state/shared.ts) refuses it and the user is told, once per burst. Undo,
// redo, and accepting the draft are not edits of this kind.
let saidAt = 0
filmGate.refuses = (): boolean => {
  if (!timelineShowsDraft() || adoptingNow()) return false
  const now = Date.now()
  if (now - saidAt > 2500) {
    saidAt = now
    notify({ text: t('d22c.after.readOnly') })
  }
  return true
}

/** Is the preview (and so the timeline) on "After"? */
export const useShowingAfter = (): boolean => useSyncExternalStore(candidate.subscribe, showing, showing)

/** The draft's project while the timeline shows it; null: the live project. */
export function useAfterProject(): Project | null {
  const after = useShowingAfter()
  const project = useAgentStore((s) => s.draft?.project ?? null)
  return after ? project : null
}
