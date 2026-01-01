// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the quick bar of a selected title goes in the preview (SnippStudio
// YAZI2-PLAN.md, 2.6 and addendum 6). Pure; tested in src/test/text-edit.test.ts.

/** The picture's box in the preview (screen px). */
export interface Frame {
  l: number
  t: number
  r: number
  b: number
}

/**
 * Where the quick bar goes (YAZI2-PLAN.md, 2.6 and addendum 6): over the
 * title and its knob; under them when there is no room above (a title near
 * the picture's top); never on the title when either fits. Inside the picture
 * where the picture is big enough to hold it, else inside the preview. With
 * room on neither side (a title that nearly fills the picture, cila4, 3):
 * `inside`, against the picture's inner edge the bar covers less of the
 * title on, the top one when they are even (shown see-through by the layer,
 * hidden while the title is dragged). `box` is the title's outline as it
 * stands (its bounds), `knobY` its knob's middle.
 */
export function barPlace(box: Frame, knobY: number, bar: { w: number; h: number }, frame: Frame, size: { cw: number; ch: number }): { left: number; top: number; side: 'above' | 'below' | 'inside' } {
  const edge = 4
  const gap = 10
  const inL = Math.max(edge, frame.l + edge)
  const inR = Math.min(size.cw - edge, frame.r - edge)
  const [minX, maxX] = inR - inL >= bar.w ? [inL, inR - bar.w] : [edge, Math.max(edge, size.cw - edge - bar.w)]
  const left = Math.min(maxX, Math.max(minX, (box.l + box.r) / 2 - bar.w / 2))
  const minY = Math.max(edge, frame.t + edge)
  const maxY = Math.max(minY, Math.min(size.ch - edge, frame.b - edge) - bar.h)
  const above = Math.min(box.t, knobY - 9) - gap - bar.h
  const below = Math.max(box.b, knobY + 9) + gap
  if (above >= minY) return { left, top: above, side: 'above' }
  if (below <= maxY) return { left, top: below, side: 'below' }
  // How much of the title's words a bar at `top` lies on.
  const onTitle = (top: number): number => Math.max(0, Math.min(top + bar.h, box.b) - Math.max(top, box.t))
  return { left, top: onTitle(maxY) < onTitle(minY) ? maxY : minY, side: 'inside' }
}
