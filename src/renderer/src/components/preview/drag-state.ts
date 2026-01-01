// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a drag on the preview is doing (move, scale, rotate, crop, mask, text,
// shape, tracker…). Moved out of PreviewCanvas.tsx in SnippStudio phase 2B
// (no change).
import type { CaptionMotion } from '../../types'
import type { ShapeHandle } from './geometry'
import type { TurnAcc } from '../../ui/handles'
import type { GestureMark } from './gesture'
import type { HandleId, TurnedBox } from './text-edit/handles'
import type { SnapTarget } from './text-edit/guides'

export interface DragState {
  kind:
    | 'move'
    | 'scale'
    | 'preview-pan'
    | 'shorts-pan'
    | 'rotate'
    | 'caption-move'
    | 'caption-scale'
    | 'shape-resize'
    | 'caption-rotate'
    | 'caption-width'
    | 'caption-caret'
    | 'mask-move'
    | 'mask-scale'
    | 'mask-rotate'
    | 'mask-point'
    | 'tracker-move'
    | 'tpl-move'
    | 'tpl-scale'
    | 'tpl-cam'
    | 'crop'
    | 'crop-move'
    | 'mask-feather'
  /** A template moved or scaled as a whole: which, its placing when the drag
   *  began, and (scaling) the centres and the pointer's first distance. */
  tplId?: string
  tplStart?: { x: number; y: number; s: number }
  tplScale?: { C: [number, number]; raw: [number, number]; placed: [number, number]; d0: number; w: number; h: number }
  /** Your-camera map: its camera when the drag began. */
  mapCam?: { lon: number; lat: number; z: number }
  /** The keyframe time (seconds into the block) the drag writes. */
  keyT?: number
  maskPointIdx?: number
  maskStart?: { cx: number; cy: number; w: number; h: number; rot?: number; points?: { x: number; y: number }[] }
  clipId?: string
  captionId?: string
  startWorld: { x: number; y: number }
  /** Where the press was on the canvas (screen px): the drag starts once the
   *  pointer has left it by the threshold (ui/handles.ts DRAG_THRESHOLD). */
  startScreen?: { x: number; y: number }
  /** The pointer has left the press: the drag is on (cila A). */
  moved?: boolean
  /** The cursor this drag keeps (the handle's own). */
  cursor?: string
  /** The undo history at the press: Esc puts the project back to it. */
  undoMark?: GestureMark
  /** Crop: the crop at the press, the media's size and flips. */
  crop?: { start: { l: number; t: number; r: number; b: number } | undefined; w: number; h: number; flipH: boolean; flipV: boolean }
  /** Mask soft edge: its value at the press and how far a screen px moves it. */
  feather?: { start: number; perPx: number; ux: number; uy: number }
  startTransform?: { x: number; y: number; scale: number; rotation?: number }
  startVisualTransform?: { x: number; y: number; scale: number; rotation?: number }
  /** Pointer angle around the object when a rotate drag began. */
  startAngle?: number
  startRotation?: number
  /** A turn's progress, move by move (ui/handles.ts turnFrom; report K23). */
  turn?: TurnAcc
  /** Shape geometry when a resize began (shapes scale their box, not a font). */
  startShape?: { w: number; h: number }
  /** Which of the eight handles a shape resize grabbed. */
  handle?: ShapeHandle
  /** Motion at the moment a drag began — set only when the caption is
   *  keyframed, in which case the drag writes a keyframe instead of moving
   *  the static placement. */
  startMotion?: CaptionMotion
  startView?: { x: number; y: number }
  startScaleCenter?: { x: number; y: number }
  startScaleHandle?: { x: number; y: number }
  scaleGrip?: { halfWidth: number; halfHeight: number; cornerX: -1 | 1; cornerY: -1 | 1 }
  startCam?: { x: number; y: number; zoom: number }
  startCapPos?: { x: number; y: number }
  startMotionScale?: number
  // A title or a shape (text-edit/interaction.ts).
  /** The handle a pull began on. */
  textHandle?: HandleId
  /** Its box on the frame at the press. */
  startBox?: TurnedBox
  /** A width pull: the block's width at every wrap, the title's scale and
   *  the width it is fitted to (0: none). */
  wrap?: { widths: number[]; scale: number; fit: number }
  /** A width pull: the box as it is held now (frame px), its pulled side at
   *  the pointer; drawn in place of the box round the words until the release. */
  heldBox?: TurnedBox
  /** Every thing a move takes along, as it stood at the press. */
  group?: { id: string; pos: { x: number; y: number }; motion?: CaptionMotion }[]
  /** The lines this move can catch on (found once, at its first step). */
  targets?: SnapTarget[]
}
