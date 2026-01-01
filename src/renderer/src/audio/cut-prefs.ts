// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The two choices a cut made for the speech remembers (çekirdek cila S,
// decisions 2, 3 and 12): the "Remove silence" window and the transcript
// panel share them, so the music is treated the same from both.
const KEEP = 'snipp-cut-keep-music'
const END = 'snipp-cut-end-beds'
// Where "Remove silence" cuts (sessiz, SESSIZ-PLAN.md decision 4): one choice
// for when clips are picked, one for when nothing is.
const TARGET_PICKED = 'snipp-silence-target-picked'
const TARGET_NONE = 'snipp-silence-target-none'

/** Where a silence cut is made: the tracks of the sound listened to and of
 *  its linked picture, every unlocked track, or tracks ticked by hand. */
export type SilenceTarget = 'picked' | 'all' | 'custom'
const TARGETS: readonly SilenceTarget[] = ['picked', 'all', 'custom']

const read = (key: string): boolean => {
  try {
    // On unless switched off (the default the user asked for).
    return globalThis.localStorage?.getItem(key) !== '0'
  } catch {
    return true
  }
}
const write = (key: string, on: boolean): void => {
  try {
    globalThis.localStorage?.setItem(key, on ? '1' : '0')
  } catch {
    // (No storage: the choice lasts as long as the panel.)
  }
}

const readTarget = (key: string, fallback: SilenceTarget): SilenceTarget => {
  try {
    const v = globalThis.localStorage?.getItem(key)
    return TARGETS.includes(v as SilenceTarget) ? (v as SilenceTarget) : fallback
  } catch {
    return fallback
  }
}

/** "Do not cut music and other sounds", "End the music at the new end", and
 *  where "Remove silence" cuts with clips picked and with none. */
export const cutPrefs = (): { keepMusic: boolean; endBeds: boolean; target: { picked: SilenceTarget; none: SilenceTarget } } => ({
  keepMusic: read(KEEP),
  endBeds: read(END),
  target: { picked: readTarget(TARGET_PICKED, 'picked'), none: readTarget(TARGET_NONE, 'all') }
})
export const setKeepMusic = (on: boolean): void => write(KEEP, on)
export const setEndBeds = (on: boolean): void => write(END, on)
export const setSilenceTarget = (picked: boolean, target: SilenceTarget): void => {
  try {
    globalThis.localStorage?.setItem(picked ? TARGET_PICKED : TARGET_NONE, target)
  } catch {
    // (No storage: the choice lasts as long as the window.)
  }
}
