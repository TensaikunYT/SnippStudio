// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the store's actions share besides the store: the session's version
// log, the command environment, the tracks a cut leaves in place, the Shorts
// band colours. Moved out of state/store.ts in SnippStudio phase 2B (no change).
import type { Project } from '../types'
import { defaultEnv, type CommandEnv } from '../commands/core'
import { VersionLog } from '../history/versions'
import { currentToasts, notify } from '../ui/toast-core'
import { t } from '../ui/strings'

/** The store's clock (the merge window of repeated edits, the idle close of a
 *  drag). A test sets its own, so a sequence of steps does not depend on how
 *  fast it ran (phase 4A.9, A8). */
export const clock = { now: (): number => performance.now() }

let offClipToast = 0
/** A keyed value edited with the playhead off the clip (or line) writes no
 *  key (phase Ç2c.2, K19): say so, once while the word is on screen (a
 *  slider's drag calls it on every move). Ç2c patch, item 6. */
export function tellKeyedOffClip(): void {
  if (offClipToast && currentToasts().some((x) => x.id === offClipToast)) return
  offClipToast = notify({ text: t('keyframe.offClip'), kind: 'info' })
}

/** The film's versions this session (history/versions.ts). */
export const versions = new VersionLog()

/**
 * The film's gate (D22, worker C): while the timeline shows an agent's draft
 * ("After") the film is read-only — for the pointer, the keyboard, every
 * button. `refuses` is asked for an edit that would change the FILM (not a
 * note, not a row's height); true: the edit is not made (the one who set the
 * gate says why). Unset: every edit is made. Undo, redo and an agent's own
 * landing do not pass through here.
 */
export const filmGate: { refuses: (() => boolean) | null } = { refuses: null }

/** Locked tracks holding a clip that runs past the earliest cut: a
 *  whole-timeline cut skips them, so their times do not shift. */
export function lockedTracksAfter(p: Project, cuts: [number, number][][], kept: readonly string[] = []): string[] {
  const first = Math.min(...cuts.flat().map(([a]) => a))
  return p.tracks
    // (`kept`: tracks the cut was told to leave, a music bed: as fixed as a
    // locked one for that cut.)
    .filter((t) => (t.locked || kept.includes(t.id)) && t.clipIds.some((id) => {
      const c = p.clips[id]
      return !!c && c.start + c.duration > first + 1e-6
    }))
    .map((t) => t.id)
}

/** What a command gets from the app: Math.random (the seeds the store always
 *  made) and, for a shape sized to a title, a canvas to measure text with. */
export function env(measure = false): CommandEnv {
  const e = defaultEnv()
  if (!measure || typeof document === 'undefined') return e
  let ctx: CanvasRenderingContext2D | null | undefined
  const m = (): CanvasRenderingContext2D | null => (ctx === undefined ? (ctx = document.createElement('canvas').getContext('2d')) : ctx)
  if (!m()) return e
  return {
    ...e,
    measureText: (font, text) => {
      const g = m()!
      g.font = font
      return g.measureText(text).width
    }
  }
}

/** Distinct band tints for Shorts segments, tuned for the dark timeline. */
export const SEGMENT_COLORS = [
  '#25d0c2',
  '#ff8a4c',
  '#b26bff',
  '#4cd97b',
  '#ffd83d',
  '#ff5c8a',
  '#4fa8ff',
  '#9fe04c'
]

/** The merge key of a run of one continuous change (phase Ç2a.1, report D2):
 *  a colour being picked, a number typed, a box ticked for a value. With no
 *  window open every change is an undo step; a run of the same key within a
 *  second is one. A patch of switches alone (true / false) has none: two
 *  clicks are two steps (merged, they would make a step that undoes nothing). */
export function runKey(what: string, patch?: object | null): string | undefined {
  if (patch && Object.values(patch).length > 0 && Object.values(patch).every((v) => typeof v === 'boolean')) return undefined
  return `${what}:${patch ? Object.keys(patch).sort().join(',') : ''}`
}
