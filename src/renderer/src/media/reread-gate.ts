// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The re-reads of media files that changed on disk (media/relink.ts
// refreshChangedMedia, right after an open) still running. The autosave waits
// for them (phase Ç2b, E2): what it writes then holds the re-read
// fingerprints, and the re-read landing after the save no longer makes the
// project unsaved again at once.
const running = new Set<Promise<unknown>>()

/** Keeps `work` in the list until it settles; returns it. */
export function holdReread<T>(work: Promise<T>): Promise<T> {
  running.add(work)
  const done = (): void => void running.delete(work)
  work.then(done, done)
  return work
}

/** A re-read that hangs does not hold the autosave back for longer. */
const MAX_WAIT_MS = 20_000

/** Resolves when every running re-read has settled (or after MAX_WAIT_MS). */
export async function rereadsSettled(): Promise<void> {
  if (running.size === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([Promise.allSettled([...running]), new Promise<void>((r) => (timer = setTimeout(r, MAX_WAIT_MS)))])
  clearTimeout(timer)
}
