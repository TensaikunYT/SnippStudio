// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where before and after are drawn when a draft is compared with the project
// (ONIZLEME-UYGULA-PLAN.md, K8; the idea is VideoHub's compare modes). Pure.
import type { CompareMode } from '../../playback/candidate'
import type { PreviewView } from './zoom'

export interface Rect {
  left: number
  top: number
  w: number
  h: number
}

/** The gap between the two pictures side by side (CSS px). */
export const SIDE_GAP = 8

/** A W × H frame fitted in a cw × ch area at (ox, oy), with the zoom and pan. */
export function fitFrame(cw: number, ch: number, W: number, H: number, pv: PreviewView, ox = 0, oy = 0): Rect {
  const k = Math.min(cw / Math.max(1, W), ch / Math.max(1, H)) * (pv.zoom || 1)
  return { left: ox + cw / 2 - (W * k) / 2 + pv.x, top: oy + ch / 2 - (H * k) / 2 + pv.y, w: W * k, h: H * k }
}

export interface CompareLayout {
  /** Where the after (the draft, the one that plays) is drawn. */
  after: Rect
  /** Where the before is drawn (null: not compared). */
  before: Rect | null
  /** Each picture's own part of the preview side by side (drawn inside it). */
  afterArea: Rect | null
  beforeArea: Rect | null
}

/** Side by side: before on the left half, after on the right, each fitted
 *  in its half (the same zoom and pan). The others: one frame, both on it. */
export function compareLayout(mode: CompareMode, cw: number, ch: number, W: number, H: number, pv: PreviewView): CompareLayout {
  if (mode === 'side') {
    const half = Math.max(1, (cw - SIDE_GAP) / 2)
    const beforeArea = { left: 0, top: 0, w: half, h: ch }
    const afterArea = { left: half + SIDE_GAP, top: 0, w: half, h: ch }
    return { before: fitFrame(half, ch, W, H, pv, 0, 0), after: fitFrame(half, ch, W, H, pv, afterArea.left, 0), beforeArea, afterArea }
  }
  const one = fitFrame(cw, ch, W, H, pv)
  return { after: one, before: mode === 'off' ? null : one, afterArea: null, beforeArea: null }
}
