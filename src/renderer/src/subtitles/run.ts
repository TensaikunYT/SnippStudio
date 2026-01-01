// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Generate subtitles", the whole run: the timeline's sound to the local
// speech model, the lines written into the project the run was made for. The
// Subtitles tab's button and the agent's `job {"start":"transcribe"}`
// (SnippStudio phase 4A) run this same code; only what they tell the user
// differs.
import { writeLinesOwnStep } from './write'
import { engine } from '../playback/engine'
import { api } from '../platform'
import { projectSession, useStore } from '../state/store'
import { isSubtitle } from '../types'
import { carryCaptionsAcross } from './follow'
import type { SpokenLanguage } from './models'
import { transcribeProject, transcribeProjectRange, type TranscribeProgress } from './transcribe'
import { sourceProject, type CaptionSource } from './source'
import { withWhisper } from './whisper-lock'

export type TranscriptionOutcome =
  | { ok: true; count: number; estimated: boolean; seconds: number }
  | { ok: false; reason: 'running' | 'busy' | 'moved-on' | 'cancelled' | 'failed'; message: string }

export interface TranscriptionRun {
  /** The spoken language. Default: the project's own choice (Subtitles
   *  tab; subtitles/models.ts spokenLanguage). One model runs every language
   *  (phase 9a, decision 7). */
  language?: SpokenLanguage
  /** What is heard (REF-AB, worker S): all the timeline's sound (default),
   *  one track or one clip (subtitles/source.ts). */
  source?: CaptionSource
  onProgress: (p: TranscribeProgress) => void
  /** An export is running (both at once is more than a 16 GB PC holds). */
  exportBusy: () => boolean
  /** Right before and after the lines are written (the agent's restore
   *  point and its "the agent changed it" record: agent/restore.ts). */
  beforeWrite?: () => void
  afterWrite?: () => void
}

export { claimWhisper, whisperRunning } from './whisper-lock'

export function transcribeIntoProject(run: TranscriptionRun): Promise<TranscriptionOutcome> {
  const s = useStore.getState()
  if (run.exportBusy()) return Promise.resolve({ ok: false, reason: 'busy', message: 'An export is running: transcribe when it is done.' })
  // Claimed before anything is awaited (whisper-lock.ts withWhisper; G4).
  return withWhisper<TranscriptionOutcome>(() => transcribeClaimed(run, s), { ok: false, reason: 'running', message: 'A transcription is already running.' })
}

async function transcribeClaimed(run: TranscriptionRun, s: ReturnType<typeof useStore.getState>): Promise<TranscriptionOutcome> {
  const session = projectSession()
  const from = s.project
  const t0 = performance.now()
  s.setPlaying(false)
  // Free the audio rendering thread: the realtime metering context would
  // otherwise starve the OfflineAudioContext mix and hang extraction.
  await engine.suspendAudio()
  // A long recording takes minutes: the PC must not sleep in the middle.
  api?.keepAwake(true, 'transcription')
  try {
    s.setTranscribeStatus('Starting…')
    // From a track or a clip: everything else silent, only its stretch mixed.
    const heard = run.source ? sourceProject(s.project, run.source) : { project: s.project, span: null }
    const made = heard.span
      ? await transcribeProjectRange(heard.project, heard.span[0], heard.span[1], run.onProgress, s.project.captionStyle.maxLineChars, run.language)
      : await transcribeProject(heard.project, run.onProgress, s.project.captionStyle.maxLineChars, run.language)
    // Another project opened meanwhile: it is not written into that one.
    if (projectSession() !== session) return { ok: false, reason: 'moved-on', message: 'The transcription finished for a project that is no longer open; nothing was changed.' }
    // The voice moved, trimmed or cut while it ran: the lines go with
    // their words, onto the timeline as it is now — after a drag the user
    // is in, as an undo step of their own (phase 4A.10, E3).
    const captions = await writeLinesOwnStep(() => carryCaptionsAcross({ ...from, captions: from.captions.filter((c) => !isSubtitle(c)) }, useStore.getState().project, made), run)
    if (!captions) return { ok: false, reason: 'moved-on', message: 'The transcription finished for a project that is no longer open; nothing was changed.' }
    const estimated = captions.some((caption) => caption.words?.some((word) => word.estimated))
    return { ok: true, count: captions.length, estimated, seconds: (performance.now() - t0) / 1000 }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return msg.includes('cancelled') ? { ok: false, reason: 'cancelled', message: 'Transcription cancelled.' } : { ok: false, reason: 'failed', message: msg }
  } finally {
    api?.keepAwake(false, 'transcription')
    engine.resumeAudio()
    useStore.getState().setTranscribeStatus(null)
    useStore.getState().setTranscribeProgress(null)
  }
}
