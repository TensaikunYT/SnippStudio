// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the draft core takes from outside (SnippStudio phase 4A.9, A8): new
// ids, the seed of an entry's random choices, the timer of the delayed replay
// and the clock. In the app these are the defaults below; a test sets its own
// (seeded ids, a seed from the run's seed, a queue it flushes by hand), so a
// failing random sequence can be run again from its seed.
export interface Seams {
  /** A new record id (types.ts uid's 13-character form). */
  newId: () => string
  /** The seed of entry `seq`'s random choices (a pan's direction…). */
  entrySeed: (seq: number) => number
  /** Runs `fn` after `ms` of quiet; returns its cancel. */
  schedule: (fn: () => void, ms: number) => () => void
  now: () => number
}

const DEFAULTS: Seams = {
  newId: () => crypto.randomUUID().slice(0, 13),
  entrySeed: (seq) => (Date.now() + seq * 7919) | 0,
  schedule: (fn, ms) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
  now: () => Date.now()
}

export const seams: Seams = { ...DEFAULTS }

/** Replaces some of them (tests); returns the function that puts the
 *  defaults back. */
export function setSeams(s: Partial<Seams>): () => void {
  Object.assign(seams, s)
  return () => void Object.assign(seams, DEFAULTS)
}
