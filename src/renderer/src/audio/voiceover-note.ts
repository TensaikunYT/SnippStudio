// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A note into the voice-over's script (REF-AB, worker S, item 8;
// REF-AB-PLAN-S.md "Ajanla birleşme"): the agent writes a script the way it
// already answers (a note of its own, or its reply on the user's note); the
// note card's "Put in the script" carries it to the Voiceover page. Only the
// interface does this, on the user's press: no agent tool reaches the script.
import type { WorkNote } from '../types'
import { confirmDialog, t } from '../ui'
import { requestShell } from '../components/app/requests'
import { useVoiceover } from './voiceover-store'

/** What a note gives the script: the agent's reply when it has one, else its text. */
export function noteScript(note: Pick<WorkNote, 'text' | 'reply'>): string {
  return (note.reply?.trim() || note.text?.trim() || '').trim()
}

/** Puts the note's words into the script (asked first when the script holds
 *  text: in place of it, or after it) and opens the Voiceover page. */
export async function putNoteInScript(note: Pick<WorkNote, 'text' | 'reply' | 'num'>): Promise<void> {
  const text = noteScript(note)
  if (!text) return
  const vo = useVoiceover.getState()
  let how: 'replace' | 'append' = 'replace'
  if (vo.script.trim()) {
    // The main button replaces; anything else (Escape too) adds after: no
    // script is lost by a slip.
    const replace = await confirmDialog({
      title: t('vo.note.title', { n: note.num }),
      message: t('vo.note.message'),
      confirm: t('vo.note.replace'),
      cancel: t('vo.note.append'),
      icon: 'mic'
    })
    how = replace ? 'replace' : 'append'
  }
  useVoiceover.getState().putInScript(text, how)
  requestShell('dock:voiceover')
}
