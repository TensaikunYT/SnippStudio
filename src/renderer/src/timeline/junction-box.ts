// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The block the timeline draws for a transition (phase Ç2b.2, report G5).
import type { Clip, Project } from '../types'
import { outgoingTransitionWindow } from '../playback/draw/timing'
import { JOIN_EPS } from './eps'

/** The least width a transition's block is drawn at (px). */
export const TRANS_BLOCK_MIN_PX = 18

/** Where the timeline draws a clip's transition (report G5): the window the
 *  render uses, in pixels from the timeline's start (no header). Null: none
 *  drawn. A speed ramp works inside both clips: centred on the cut. */
export function junctionBox(p: Project, clip: Clip, pxPerSec: number): { left: number; width: number; pre: number; post: number } | null {
  const w = outgoingTransitionWindow(p, clip)
  if (w.duration <= 0) return null
  const cut = clip.start + clip.duration
  const [pre, post] = w.pre + w.post > 1e-9 ? [w.pre, w.post] : [w.duration / 2, w.duration / 2]
  return { left: (cut - pre) * pxPerSec, width: (pre + post) * pxPerSec, pre, post }
}

/** How far a transition's block reaches into the two clips of its cut, in
 *  pixels from the cut (22 November, L8): `right` into the clip that ends
 *  there, `left` into the clip that starts there. The block sits over the top
 *  of the lane, where the clips' name pills and marks are: each clip's top
 *  row starts after it (ends before it) so the block never lies on a name.
 *  The same geometry as the block's own drawing (components/timeline/
 *  transitions.tsx): the render's window, at least TRANS_BLOCK_MIN_PX wide,
 *  centred when it has no window. */
export function cutReach(p: Project, clips: readonly Clip[], pxPerSec: number): Map<string, { left: number; right: number }> {
  const out = new Map<string, { left: number; right: number }>()
  const at = (id: string): { left: number; right: number } => {
    let r = out.get(id)
    if (!r) out.set(id, (r = { left: 0, right: 0 }))
    return r
  }
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  for (let i = 0; i < sorted.length - 1; i++) {
    const clip = sorted[i]
    const next = sorted[i + 1]
    if (!clip.transitionOut || clip.adjustment || next.adjustment || Math.abs(next.start - (clip.start + clip.duration)) >= JOIN_EPS) continue
    const box = junctionBox(p, clip, pxPerSec)
    const width = box ? Math.max(TRANS_BLOCK_MIN_PX, box.width) : TRANS_BLOCK_MIN_PX
    const pre = box ? box.pre * pxPerSec : TRANS_BLOCK_MIN_PX / 2
    at(clip.id).right = Math.max(0, pre)
    at(next.id).left = Math.max(0, width - pre)
  }
  return out
}
