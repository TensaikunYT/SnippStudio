// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's transcription job (SnippStudio phase 4A): the app's own
// subtitle run as a job of the table in jobs.ts.
import { useStore } from '../state/store'
import { exportBusy } from '../components/app/layout'
import { transcribeIntoProject } from '../subtitles/run'
import type { SpokenLanguage } from '../subtitles/models'
import { cancelTranscription, type TranscribeProgress } from '../subtitles/transcribe'
import { isSubtitle } from '../types'
import { findJob, startJob, type Job } from './jobs'
import { spokenCode } from './format'

/** The agent's languages; 'auto' is the project's own (the Subtitles tab's
 *  choice: transformers.js cannot detect the language, so a run names one). */
const LANG: Record<string, SpokenLanguage | undefined> = { auto: undefined, tr: 'turkish', en: 'english' }

/** An agent's transcription is running (not the user's own). */
let agentTranscribing = 0

/** Agent access was turned off (G7): the agent's own transcription stops
 *  (the user's is left alone). */
export function cancelAgentJobs(): void {
  if (agentTranscribing > 0) cancelTranscription()
}

/** The agent's transcription jobs, by project version: the same version
 *  asked again is the same job whatever language (G4: one Whisper at a time). */
const transcribeKey = (): string => {
  const st = useStore.getState()
  return `transcribe:${st.versionEpoch}:${st.projectVersion}`
}

/** A transcription job of the agent's for the project as it is now, if one
 *  runs or ran. */
export const transcribeJobNow = (): Job | undefined => findJob((j) => j.key === transcribeKey() && (!j.done || !j.error))

/** The app's own subtitle run (the Subtitles tab's button, same code). The
 *  multilingual model: the product ships only that one (phase 9a, decision 7).
 *  It REPLACES every subtitle line (the caller checks the agent asked for
 *  that); `hooks` are told right before and after the lines are written. */
export function startTranscribe(
  language: unknown,
  onDone: (count: number, replaced: number) => void,
  hooks: { beforeWrite?: () => void; afterWrite?: () => void } = {}
): Job {
  const lang = typeof language === 'string' && Object.prototype.hasOwnProperty.call(LANG, language) ? language : 'auto'
  return startJob(`transcribe (${lang})`, async (job) => {
    const onProgress = (p: TranscribeProgress): void => {
      job.progress = p.label
      const s = useStore.getState()
      s.setTranscribeProgress(p)
      s.setTranscribeStatus(p.label)
    }
    const replaced = useStore.getState().project.captions.filter(isSubtitle).length
    // The language it is written in, said in the answer (audit patch D1).
    const spoken = LANG[lang] ? (lang as string) : spokenCode(useStore.getState().project)
    agentTranscribing++
    let r
    try {
      r = await transcribeIntoProject({ language: LANG[lang], onProgress, exportBusy, ...hooks })
    } finally {
      agentTranscribing--
    }
    if (!r.ok) throw new Error(r.message)
    onDone(r.count, replaced)
    return `${r.count} subtitle lines (${spoken}) in ${r.seconds.toFixed(1)} s${r.estimated ? ' (some word times estimated)' : ''}${replaced ? `; they replaced the ${replaced} lines there were` : ''}. Read them with transcript.`
  }, transcribeKey())
}
