// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Projects window at launch (REF-AB, item 1; REF-AB-PLAN-P.md): it opens
// when the program starts with nothing else to show: no crash snapshot to
// offer, no project handed over by the OS or the command line, no film handed
// over by VideoHub. Each of those three reports once, as soon as it knows; the
// window is decided when all three have. The preference is the profile's
// (localStorage), on by default: Settings → General.

export const HOME_AT_LAUNCH_KEY = 'snipp-home-at-launch'

export type LaunchSource = 'recovery' | 'project' | 'film'
const SOURCES: readonly LaunchSource[] = ['recovery', 'project', 'film']

/** Pure: whether the Projects window opens, from the preference and what
 *  each source said (true: it has something; undefined: not known yet →
 *  null, not decided). */
export function homeAtLaunch(pref: boolean, said: Partial<Record<LaunchSource, boolean>>): boolean | null {
  if (!pref) return false
  if (SOURCES.some((k) => said[k] === true)) return false
  return SOURCES.every((k) => said[k] === false) ? true : null
}

export function readHomePref(): boolean {
  try {
    return localStorage.getItem(HOME_AT_LAUNCH_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeHomePref(on: boolean): void {
  try {
    localStorage.setItem(HOME_AT_LAUNCH_KEY, on ? '1' : '0')
  } catch {
    /* not remembered: fine */
  }
}

// ---- the gate: one per window (the page loads once per launch) ----------------
const said: Partial<Record<LaunchSource, boolean>> = {}
let decided: boolean | null = null
let listener: ((open: boolean) => void) | null = null

/** A source says whether it had something at launch (once; later calls of
 *  the same source are ignored). */
export function noteLaunch(source: LaunchSource, had: boolean): void {
  if (said[source] !== undefined) return
  said[source] = had
  settle()
}

function settle(): void {
  if (decided !== null) return
  const d = homeAtLaunch(readHomePref(), said)
  if (d === null) return
  decided = d
  listener?.(d)
}

/** Called once with the decision (at once when it is already made). */
export function whenLaunchSettled(fn: (open: boolean) => void): () => void {
  listener = fn
  if (decided !== null) fn(decided)
  return () => {
    if (listener === fn) listener = null
  }
}

/** Whether the launch's Projects window is still to be decided or showing:
 *  the first-run tour waits for it (two layers would cover each other). */
let homeShowing = false
const loadedAt = Date.now()
export function setHomeShowing(on: boolean): void {
  homeShowing = on
}
export function homeBlocksTour(): boolean {
  // (Undecided, it waits at most a few seconds: a source that never answers
  // must not keep the tour away for good.)
  return homeShowing || (decided === null && readHomePref() && Date.now() - loadedAt < 5000)
}
