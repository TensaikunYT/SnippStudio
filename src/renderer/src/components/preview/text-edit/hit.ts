// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a press on the preview takes among the titles and shapes on screen
// (SnippStudio YAZI2-PLAN.md, 2.2): the turn knob of a selected one, then one
// of its handles, then the body of the topmost one under the pointer. Only
// what is drawn can be taken: handles and a knob belong to a selected thing.
// Pure (screen px in, a target out); tested in src/test/text-edit-hit.test.ts.
import { handleReach } from '../../../ui/handles'
import { OUTLINE_PAD, boxHandles, boxKnob, grown, insideBox, type HandleId, type TurnedBox } from './handles'

/** A title or a shape as it stands on screen: its letters' (or its own) box. */
export interface ScreenItem {
  id: string
  box: TurnedBox
  selected: boolean
  shape: boolean
}

export type TextHit =
  | { kind: 'knob'; id: string }
  | { kind: 'handle'; id: string; handle: HandleId }
  | { kind: 'body'; id: string }

/** How near a knob's middle a press still takes it (screen px). */
export const KNOB_HIT = 14
/** How far outside its outline a body is still picked up (screen px). */
export const BODY_SLACK = 2

/** The outline a thing gets when selected: its box, a little outside it. */
export const outlineOf = (it: ScreenItem): TurnedBox => grown(it.box, it.shape ? 0 : OUTLINE_PAD)

/**
 * `items` in drawing order (the last is on top); `canvasH` the preview's
 * height (the knob keeps inside it). `handles: false` while the selection's
 * handles are not drawn (a title being typed in).
 */
export function hitTest(items: readonly ScreenItem[], x: number, y: number, canvasH: number, handles = true): TextHit | null {
  if (handles) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (!it.selected) continue
      const o = outlineOf(it)
      const { knob } = boxKnob(o, canvasH)
      if (Math.hypot(x - knob[0], y - knob[1]) <= KNOB_HIT) return { kind: 'knob', id: it.id }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (!it.selected) continue
      const o = outlineOf(it)
      // The nearest handle within reach: on a small box the reaches overlap.
      const reach = handleReach(Math.min(o.w, o.h))
      let best: HandleId | null = null
      let bd = Infinity
      for (const h of boxHandles(o)) {
        const dx = Math.abs(x - h.x)
        const dy = Math.abs(y - h.y)
        if (dx > reach || dy > reach) continue
        const d = dx * dx + dy * dy
        if (d < bd) {
          bd = d
          best = h.id
        }
      }
      if (best) return { kind: 'handle', id: it.id, handle: best }
    }
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (insideBox(outlineOf(it), x, y, BODY_SLACK)) return { kind: 'body', id: it.id }
  }
  return null
}
