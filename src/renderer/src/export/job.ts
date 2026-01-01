// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one export job at a time: its Cancel, and the "time left" the progress
// window shows. Every export (video, sound, Shorts, a frame, subtitles, the
// voice with its subtitles) goes through here, so each has the same window,
// the same Cancel and the same "Open folder" at the end. Pure apart from
// AbortController: the tests read it.

/** What is being exported (the window's title and its icon follow it). */
export type ExportKind = 'video' | 'sound' | 'shorts' | 'frame' | 'srt' | 'voiceset'

export const EXPORT_TITLES: Record<ExportKind, { running: string; done: string; icon: string }> = {
  video: { running: 'Exporting the video', done: 'Video exported', icon: '🎞' },
  sound: { running: 'Exporting the sound', done: 'Sound exported', icon: '🔊' },
  shorts: { running: 'Exporting the Shorts', done: 'Shorts exported', icon: '📱' },
  frame: { running: 'Saving the frame', done: 'Frame saved', icon: '📸' },
  srt: { running: 'Saving the subtitles', done: 'Subtitles saved', icon: '💬' },
  voiceset: { running: 'Exporting the subtitles and the sound', done: 'Subtitles and sound exported', icon: '💬' }
}

let current: AbortController | null = null
/** What the running job wants said when it ends (a loudness target it did
 *  not reach, a frame it could not read): shown beside the result instead of
 *  a plain "Done". Each once, a few at most, only while a job runs. */
let notes: string[] = []
const MAX_NOTES = 6

/** Starts a job and returns its signal (a job still running is cancelled). */
export function beginExportJob(): AbortSignal {
  current?.abort()
  current = new AbortController()
  notes = []
  return current.signal
}

/** Something the person should know about the running job's result. */
export function noteExportJob(text: string): void {
  if (!current || current.signal.aborted) return
  if (notes.length < MAX_NOTES && !notes.includes(text)) notes.push(text)
}

/** The running job's notes so far. */
export function exportJobNotes(): string[] {
  return [...notes]
}

/** The Cancel button. */
export function cancelExportJob(): void {
  current?.abort()
}

/** The job is over (done, failed or cancelled). */
export function endExportJob(signal: AbortSignal): void {
  if (current?.signal === signal) {
    current = null
    notes = []
  }
}

/** Whether a job can be cancelled right now. */
export function exportJobRunning(): boolean {
  return !!current && !current.signal.aborted
}

/** An error thrown because the job was cancelled (not a real failure). */
export function wasCancelled(signal: AbortSignal | undefined, err: unknown): boolean {
  if (signal?.aborted) return true
  return (err as { name?: string } | null)?.name === 'AbortError'
}

/**
 * Time left, from how fast the bar has moved over the last stretch rather
 * than since the start: an export's phases run at different speeds (the
 * sound is mixed quickly, the frames slowly), and a straight line from the
 * start promised minutes that were not there. Samples are [seconds, 0..1].
 * Null until there is enough to say anything honest.
 */
export function etaFromSamples(samples: [number, number][], windowSec = 12): number | null {
  if (samples.length < 2) return null
  const [tN, pN] = samples[samples.length - 1]
  if (pN >= 1) return 0
  // The oldest sample still inside the window (at least two samples apart).
  let i = samples.length - 2
  while (i > 0 && tN - samples[i - 1][0] <= windowSec) i--
  const [t0, p0] = samples[i]
  const dt = tN - t0
  const dp = pN - p0
  if (dt < 1 || dp <= 0.002) return null
  return ((1 - pN) * dt) / dp
}

/** "1m 05s", "12s", "<1s". */
export function fmtLeft(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 1) return '<1s'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}
