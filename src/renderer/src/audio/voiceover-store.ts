// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Voiceover page's own state (REF-AB, worker S, item 8): the script and
// the choices, one set per window, remembered in the profile (localStorage),
// never in the project (writing a script is not an unsaved change). The
// script also takes text from elsewhere in the interface: a note's "Put in
// the script" (NotesPanel.tsx). No agent tool writes here.
import { create } from 'zustand'
import { countdownOf, scriptWith, type Countdown } from './voiceover'

const KEY = 'snipp-voiceover'

interface Saved {
  script: string
  deviceId: string
  countdown: Countdown
  hearTimeline: boolean
  promptSize: number
}

export const PROMPT_SIZES = { min: 18, max: 48, step: 2 }

function load(): Saved {
  const base: Saved = { script: '', deviceId: '', countdown: 3, hearTimeline: false, promptSize: 28 }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
    return {
      script: typeof raw.script === 'string' ? raw.script.slice(0, 100000) : base.script,
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId.slice(0, 512) : base.deviceId,
      countdown: countdownOf(raw.countdown ?? base.countdown),
      hearTimeline: raw.hearTimeline === true,
      promptSize: typeof raw.promptSize === 'number' && raw.promptSize >= PROMPT_SIZES.min && raw.promptSize <= PROMPT_SIZES.max ? raw.promptSize : base.promptSize
    }
  } catch {
    return base
  }
}

export interface VoiceoverState extends Saved {
  set: (patch: Partial<Saved>) => void
  /** Text put into the script from elsewhere (a note): in place of it, or after it. */
  putInScript: (text: string, how: 'replace' | 'append') => void
}

export const useVoiceover = create<VoiceoverState>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch)
    const { script, deviceId, countdown, hearTimeline, promptSize } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ script, deviceId, countdown, hearTimeline, promptSize }))
    } catch {
      /* not remembered: fine */
    }
  },
  putInScript: (text, how) => get().set({ script: scriptWith(get().script, text, how) })
}))
