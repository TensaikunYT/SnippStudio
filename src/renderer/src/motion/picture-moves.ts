// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Moves for any picture: a photo or a cut-out PNG can enter, leave, walk,
// dash, step closer or back, hop and turn with the motion model's physics
// (motion/physics.ts) — its weight, bounce, lean and squash — kept on the
// clip itself.

import type { MoveAction, MoveKind, MovePhysics, Mover, Clip, Project } from '../types'
import { compileMover, DEFAULT_PHYSICS, evalMover, type MoverEnv } from './physics'

/** Each move's name, icon, colour and hint (the Moves section's buttons). */
export const MOVE_INFO: Record<MoveKind, { label: string; icon: string; color: string; hint: string }> = {
  enter: { label: 'Enter', icon: '⇥', color: '#2f8f6a', hint: 'Comes into the frame' },
  exit: { label: 'Exit', icon: '⇤', color: '#8f4a3a', hint: 'Leaves the frame' },
  move: { label: 'Move', icon: '↔', color: '#3a6a9a', hint: 'Walks to a spot — drag it in the preview' },
  dash: { label: 'Dash', icon: '»', color: '#4d57b8', hint: 'Fast move across, with motion blur' },
  approach: { label: 'Closer', icon: '⤢', color: '#8a6a2a', hint: 'Steps towards the camera' },
  retreat: { label: 'Back', icon: '⤡', color: '#6a5a3a', hint: 'Steps away from the camera' },
  point: { label: 'Point', icon: '☞', color: '#9a3d7a', hint: 'Points at something, then back' },
  pose: { label: 'Pose', icon: '◐', color: '#6a4aa0', hint: 'Changes pose (hidden in a quick whip)' },
  hop: { label: 'Hop', icon: '⤒', color: '#2a7f8f', hint: 'A small jump with squash and stretch' },
  turn: { label: 'Turn', icon: '⇋', color: '#5a6a7a', hint: 'Turns to face the other way' }
}

/** The moves a picture can make. */
export const PICTURE_MOVES: MoveKind[] = ['enter', 'exit', 'move', 'dash', 'approach', 'retreat', 'hop', 'turn']

/** A picture keeps still between its moves (a photo
 *  swaying on its own would only look unsteady). */
export const PICTURE_PHYSICS: MovePhysics = { ...DEFAULT_PHYSICS, idle: 0 }

/** A picture's own feel, as presets over the physics sliders. */
export const MOVE_FEELS: { id: string; label: string; physics: MovePhysics }[] = [
  { id: 'light', label: 'Light', physics: { ...PICTURE_PHYSICS, weight: 0.2, bounce: 0.55, lean: 0.4, squash: 0.55 } },
  { id: 'normal', label: 'Normal', physics: { ...PICTURE_PHYSICS } },
  { id: 'heavy', label: 'Heavy', physics: { ...PICTURE_PHYSICS, weight: 0.85, bounce: 0.12, lean: 0.6, squash: 0.25 } },
  { id: 'calm', label: 'Calm', physics: { ...PICTURE_PHYSICS, weight: 0.5, bounce: 0.05, lean: 0.2, squash: 0.08 } }
]

const cache = new WeakMap<Clip, { key: string; ch: Mover; env: MoverEnv }>()

/**
 * Where a picture with moves is at project time `time`: its centre, scale,
 * turn, opacity and squash (sx carries the turn's mirroring). `base` is its
 * own placing then, `w`×`h` its natural size. Null: it has no moves.
 */
export function pictureMoveAt(
  project: Pick<Project, 'settings'>,
  clip: Clip,
  time: number,
  base: { x: number; y: number; scale: number; rotation: number },
  w: number,
  h: number
): { x: number; y: number; scale: number; rotation: number; alpha: number; sx: number; sy: number } | null {
  const mv = clip.moves
  if (!mv?.actions.length) return null
  const W = project.settings.width
  const H = project.settings.height
  const bh = h * base.scale
  const key = JSON.stringify([mv, clip.start, base.x, base.y, base.scale, w, h, W, H])
  let hit = cache.get(clip)
  if (!hit || hit.key !== key) {
    // A figure standing where the picture stands: its feet the bottom
    // middle of the picture, its height the picture's.
    const ch: Mover = {
      id: `mv:${clip.id}`,
      poses: [{ id: 'p', assetId: clip.assetId, ax: 0.5, faces: 'right' }],
      restPoseId: 'p',
      x: base.x / W,
      y: (base.y + bh / 2) / H,
      size: Math.max(0.01, bh / H),
      physics: mv.physics ?? PICTURE_PHYSICS,
      actions: mv.actions.map((a) => ({ ...a, time: clip.start + a.time }))
    } as Mover
    const env: MoverEnv = { aspect: W / H, poseAspect: () => w / Math.max(1, h) }
    hit = { key, ch, env }
    cache.set(clip, hit)
  }
  const c = compileMover(hit.ch, hit.env)
  const f = evalMover(hit.ch, c, time, hit.env)
  const hNow = bh * f.scale * f.sy
  const rot = base.rotation + f.rot
  // Turned about its foot.
  const fx = f.x * W
  const fy = f.y * H
  return {
    x: fx + Math.sin(rot) * (hNow / 2),
    y: fy - Math.cos(rot) * (hNow / 2),
    scale: base.scale * f.scale,
    rotation: rot,
    alpha: f.opacity,
    sx: f.sx * f.face,
    sy: f.sy
  }
}

/** A new move for a picture, at clip-local time `t`, with sensible defaults. */
export function newPictureMove(kind: MoveKind, t: number, id: string): MoveAction {
  const dur = kind === 'dash' ? 0.5 : kind === 'enter' || kind === 'exit' ? 0.8 : kind === 'turn' ? 0.3 : kind === 'hop' ? 0.6 : 0.9
  return {
    id,
    kind,
    time: Math.max(0, t),
    dur,
    ...(kind === 'enter' ? { side: 'left' as const } : kind === 'exit' ? { side: 'right' as const } : {})
  }
}
