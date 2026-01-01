// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The spoken language a NEW project starts with (Settings → General;
// TERMINAL-YOK-PLAN.md, 7): "follow the interface" (the default, as before:
// a Turkish interface makes a Turkish project, phase 9 audit patch D1) or one
// language. Kept in this browser profile; read only when a project is made,
// never applied to one that is open (the Subtitles tab changes that one).
import type { Project } from '../types'
import { WHISPER_SPOKEN_LANGUAGES, type SpokenLanguage } from './models'

export const SPOKEN_DEFAULT_KEY = 'snippstudio-spoken-default'
export type SpokenDefault = 'follow' | SpokenLanguage

export function readSpokenDefault(): SpokenDefault {
  try {
    const v = localStorage.getItem(SPOKEN_DEFAULT_KEY)
    return v && (WHISPER_SPOKEN_LANGUAGES as readonly string[]).includes(v) ? (v as SpokenLanguage) : 'follow'
  } catch {
    return 'follow'
  }
}

export function writeSpokenDefault(v: SpokenDefault): void {
  try {
    if (v === 'follow') localStorage.removeItem(SPOKEN_DEFAULT_KEY)
    else localStorage.setItem(SPOKEN_DEFAULT_KEY, v)
  } catch {
    /* kept for nothing: the default stays */
  }
}

/** A new project with the chosen spoken language (as it is with "follow"). */
export function withSpokenDefault(p: Project, choice: SpokenDefault = readSpokenDefault()): Project {
  if (choice === 'follow') return p
  return { ...p, transcription: { ...(p.transcription ?? { model: 'english' }), language: choice } }
}
