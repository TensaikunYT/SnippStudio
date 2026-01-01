// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Long work for an agent (SnippStudio phase 4A, ANA-PLAN.md 4.1 "iş takibi"):
// a job number comes back at once; job {"id", "wait"} waits for it (at most
// 60 s per call, so one call replaces many polls); a finished job's answer is
// kept, and the same transcription asked again (same project version, same
// language) is the same job: free. (The transcription job itself is in
// transcribe-job.ts: this file loads no speech model code, so the tests can
// hold the job table and its checks.)
import { projectSession, useStore } from '../state/store'
import { whisperRunning } from '../subtitles/whisper-lock'
import { isSubtitle } from '../types'
import { PRODUCT_NAME } from '../../../shared/product'

export interface Job {
  id: string
  what: string
  started: number
  done: boolean
  /** The answer when done (text for the agent). */
  answer?: string
  error?: string
  progress?: string
  promise: Promise<void>
  /** For the cache: what it was started on. */
  key?: string
}

const jobs = new Map<string, Job>()
let seq = 0
/** Finished jobs kept for a later wait (G9: not without end). */
const KEEP_JOBS = 32

export function startJob(what: string, run: (job: Job) => Promise<string>, key?: string): Job {
  if (key) {
    const same = [...jobs.values()].find((j) => j.key === key && (!j.done || !j.error))
    if (same) return same
  }
  const finished = [...jobs.values()].filter((j) => j.done)
  for (const old of finished.slice(0, Math.max(0, finished.length - KEEP_JOBS))) jobs.delete(old.id)
  const job: Job = { id: `j${++seq}`, what, started: Date.now(), done: false, key, promise: Promise.resolve() }
  job.promise = run(job).then(
    (answer) => {
      job.answer = answer
      job.done = true
    },
    (e) => {
      job.error = e instanceof Error ? e.message : String(e)
      job.done = true
    }
  )
  jobs.set(job.id, job)
  return job
}

export const jobById = (id: string): Job | undefined => jobs.get(id)
/** The first job that fits (the transcription job of a project version). */
export const findJob = (fits: (j: Job) => boolean): Job | undefined => [...jobs.values()].find(fits)

/** A job's state as the agent reads it. */
export function jobText(j: Job): string {
  const secs = Math.round((Date.now() - j.started) / 1000)
  if (!j.done) return `${j.id} ${j.what}: running (${secs} s${j.progress ? `, ${j.progress}` : ''}). Wait with job {"id":"${j.id}","wait":60}.`
  if (j.error) return `${j.id} ${j.what}: failed: ${j.error}`
  return `${j.id} ${j.what}: done.\n${j.answer}`
}

/** Waits up to `seconds` for the job (it ends early when the call is cancelled). */
export async function waitFor(j: Job, seconds: number, cancelled: () => boolean): Promise<void> {
  const until = Date.now() + Math.max(0, Math.min(60, seconds)) * 1000
  while (!j.done && Date.now() < until && !cancelled()) {
    await Promise.race([j.promise, new Promise((r) => setTimeout(r, 250))])
  }
}

/**
 * The agent's transcription, started only when everything still holds AFTER
 * the restore point was written (phase 4A.9, V-restore-transcribe-2,
 * V-limits-sessions-1). Writing the point waits on the disk; meanwhile the
 * user may open another project (whose hand-corrected lines a transcription
 * would replace with no replace:true and no point of its own), agent access
 * may be turned off, lines may appear. Checked before the wait and again
 * after it: the project is the same one, the call was not cancelled, and
 * "subtitles there → only with replace:true" holds for the project as it is
 * now. Throws with what stopped it; `start` runs only when nothing did.
 */
export async function startTranscribeChecked(o: {
  replace: boolean
  cancelled: () => boolean
  ensurePoint: () => Promise<unknown>
  start: () => Job
  /** For tests: the project session, the subtitle count, a Whisper run. */
  session?: () => number
  lines?: () => number
  running?: () => boolean
}): Promise<Job> {
  const session = o.session ?? projectSession
  const lines = o.lines ?? ((): number => useStore.getState().project.captions.filter(isSubtitle).length)
  const running = o.running ?? whisperRunning
  const check = (): void => {
    const n = lines()
    if (n > 0 && !o.replace) throw new Error(`The project has ${n} subtitle lines; transcribe replaces ALL of them. Send replace:true to do that (the user can undo it), or read them with transcript.`)
    if (running()) throw new Error(`A transcription is already running in ${PRODUCT_NAME}; wait for it and ask again.`)
  }
  check()
  const ps0 = session()
  // The point before the agent first: the lines land on the live project.
  await o.ensurePoint()
  if (session() !== ps0) throw new Error(`Another project was opened in ${PRODUCT_NAME} while this waited; no transcription was started. Call project to work on the one open now.`)
  if (o.cancelled()) throw new Error('cancelled: the call was cancelled (or agent access was turned off) while it waited; no transcription was started')
  check()
  return o.start()
}

/** Where the undo history stands right after an agent's step landed: the
 *  step is "on top" while both are unchanged. */
export interface StepMark {
  version: number
  depth: number
}
export const markStep = (): StepMark => ({ version: useStore.getState().projectVersion, depth: useStore.getState().past.length })

/**
 * The "Undo" of a notice about one step (the agent made the subtitles
 * again): undoes THAT step — only while it is the newest one. When anything
 * was done after it (an edit of the agent's, a nudge of the user's), a plain
 * undo would take back that other thing and leave the step in place; then
 * nothing is undone and false comes back (the caller says so and points at
 * Ctrl+Z / the point before the agent). Phase 4A.9, V-restore-transcribe-3.
 */
export function undoStep(mark: StepMark | null): boolean {
  const st = useStore.getState()
  if (!mark || st.projectVersion !== mark.version || st.past.length !== mark.depth) return false
  st.undo()
  return true
}
