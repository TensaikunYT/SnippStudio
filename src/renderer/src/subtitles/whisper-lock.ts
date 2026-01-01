// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One speech model run at a time, whoever asks (the Subtitles button, the
// range button, an agent's job): claimed synchronously, before anything is
// awaited (SnippStudio phase 4A.8, G4). Its own small module so the tests
// can hold it without loading the speech model's code.
import { useStore } from '../state/store'

let whisperBusy = false

/** Takes the speech model for one run; null when a run holds it. The
 *  release function gives it back (once). */
export function claimWhisper(): (() => void) | null {
  if (whisperBusy || useStore.getState().transcribeStatus) return null
  whisperBusy = true
  let done = false
  return () => {
    if (done) return
    done = true
    whisperBusy = false
  }
}

export const whisperRunning = (): boolean => whisperBusy || !!useStore.getState().transcribeStatus

/**
 * Runs `work` holding the speech model; `busy` at once when a run holds it.
 * The claim is made synchronously, before `work` is called or anything is
 * awaited: two starts in the same tick cannot both get it (G4).
 */
export function withWhisper<T>(work: () => Promise<T>, busy: T): Promise<T> {
  const release = claimWhisper()
  if (!release) return Promise.resolve(busy)
  let run: Promise<T>
  try {
    run = work()
  } catch (e) {
    release()
    return Promise.reject(e instanceof Error ? e : new Error(String(e)))
  }
  return run.finally(release)
}
