// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The watch-and-note mode's pure parts (IZLE-PLAN.md; src/test/izle.test.ts):
// which button is the primary one, the strip's measure, where the note's box
// goes, the keys that still work while watching.

export type Primary = 'access' | 'draft' | 'review' | 'send'

/** The one primary button of the list: what the next step is. */
export function primaryOf(p: { access: boolean; draft: boolean; ready: number }): Primary {
  if (!p.access) return 'access'
  if (p.draft) return 'draft'
  if (p.ready > 0) return 'review'
  return 'send'
}

/** Where second `t` is on a strip `w` pixels wide with `pad` at each end. */
export const stripX = (t: number, length: number, w: number, pad: number): number => pad + (Math.min(Math.max(t, 0), length) / Math.max(length, 1e-6)) * Math.max(0, w - 2 * pad)
/** The second under `x` on that strip. */
export const stripTime = (x: number, length: number, w: number, pad: number): number => (Math.min(Math.max(x - pad, 0), Math.max(1, w - 2 * pad)) / Math.max(1, w - 2 * pad)) * length

/** "0:47", "12:05", "1:02:03": whole seconds, as a person reads a list. */
export function watchClock(t: number): string {
  const all = Math.max(0, Math.floor(t + 1e-6))
  const h = Math.floor(all / 3600)
  const m = Math.floor((all % 3600) / 60)
  const sec = String(all % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export const watchSpan = (n: { start: number; end: number }): string => (n.end - n.start >= 0.5 ? `${watchClock(n.start)}–${watchClock(n.end)}` : watchClock(n.start))

export interface Box { left: number; top: number; w: number; h: number }

/**
 * Where the note's box goes over the film area (`area` wide and high): beside
 * the pin (on its right, or on its left when it does not fit), or, for a note
 * with no pin, on the film's lower edge at the playhead's place.
 */
export function bubblePlace(o: { frame: Box; area: { w: number; h: number }; pin: [number, number] | null; at: number; bw: number; bh: number }): { left: number; top: number } {
  const { frame, area, bw, bh } = o
  const m = 8
  const clampX = (x: number): number => Math.min(Math.max(m, x), Math.max(m, area.w - bw - m))
  const clampY = (y: number): number => Math.min(Math.max(m, y), Math.max(m, area.h - bh - m))
  if (o.pin) {
    const px = frame.left + o.pin[0] * frame.w
    const py = frame.top + o.pin[1] * frame.h
    const right = px + 24
    const left = right + bw > area.w - m ? px - 24 - bw : right
    return { left: clampX(left), top: clampY(py - 18) }
  }
  const x = frame.left + Math.min(Math.max(o.at, 0), 1) * frame.w
  return { left: clampX(x - bw / 2), top: clampY(frame.top + frame.h - bh - 12) }
}

/** The keys that still work while watching: playing, looking, going to a
 *  note, the review's own, saving. Everything that edits the film is quiet. */
export const WATCH_KEYS = [
  'playPause', 'frameBack', 'frameForward', 'secondBack', 'secondForward', 'goStart',
  'shuttleBack', 'shuttlePause', 'shuttleForward', 'slower', 'faster',
  'prevNote', 'nextNote', 'narration', 'shortcutList', 'save', 'settings',
  'reviewBefore', 'reviewApprove', 'watchMode', 'previewFit', 'previewActual'
] as const
