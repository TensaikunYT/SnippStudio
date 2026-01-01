// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The transitions, in one table (core polish T). Every place that names a
// transition, offers one or adds one reads it here: the cut on the timeline,
// its right-click menu, the Inspector, Ctrl+T and Library → Effects. Before,
// the timeline menu and the Inspector each had their own list, their own
// names ("Dissolve" / "Mix (dissolve)") and their own default length (0.5 /
// 0.7 s).
//
// The data model is unchanged: a transition is still `Clip.transitionOut`
// with one of the 17 types of the command schema. The table only groups them
// for the eye: the four directional ramps (`ramp-right` …) are ONE kind with
// a direction. The sound each type makes lives where the sound is made
// (audio/timeline-sfx.ts), already in one place. Pure: no DOM, no store.
import type { Clip, Project } from '../types'
import type { IconName } from '../ui/Icon'
import type { StringKey } from '../ui/strings'
import { JOIN_EPS } from './eps'
import { TRANSITION_LIMITS } from './transition-links'

export type Transition = NonNullable<Clip['transitionOut']>
export type TransitionType = Transition['type']
export type RampDir = 'right' | 'left' | 'down' | 'up'
export type TransitionKindId =
  | 'mix' | 'fade' | 'blur'
  | 'slide' | 'wipe' | 'zoom' | 'whip' | 'push' | 'iris'
  | 'ramp' | 'speed-ramp'
  | 'flash' | 'light-leak' | 'film-burn'
export type TransitionGroup = 'basic' | 'motion' | 'ramp' | 'light'

export interface TransitionKind {
  id: TransitionKindId
  group: TransitionGroup
  icon: IconName
  /** Its name, through t(). */
  name: StringKey
  /** The shortest length it is given when chosen (a film burn wants time). */
  minDuration?: number
  /** One kind, four types: `ramp-<direction>`. */
  directional?: true
}

/** The length a new transition gets until the user makes another the default. */
export const DEFAULT_DURATION = 0.5
/** What a click on a cut adds before anything was chosen: a dissolve, 0.5 s. */
export const FIRST_DEFAULT: { type: TransitionType; duration: number } = { type: 'mix', duration: DEFAULT_DURATION }

/** Fourteen kinds, in the order they are offered. */
export const TRANSITION_KINDS: readonly TransitionKind[] = [
  { id: 'mix', group: 'basic', icon: 'contrast', name: 'trans.opt.mix' },
  { id: 'fade', group: 'basic', icon: 'moon', name: 'trans.opt.fade' },
  { id: 'blur', group: 'basic', icon: 'droplet', name: 'trans.opt.blur' },
  { id: 'slide', group: 'motion', icon: 'arrow-right-to-line', name: 'trans.opt.slide' },
  { id: 'wipe', group: 'motion', icon: 'rectangle-vertical', name: 'trans.opt.wipe' },
  { id: 'zoom', group: 'motion', icon: 'zoom-in', name: 'trans.opt.zoom' },
  { id: 'whip', group: 'motion', icon: 'arrow-left-right', name: 'trans.opt.whip' },
  { id: 'push', group: 'motion', icon: 'arrow-up', name: 'trans.opt.push' },
  { id: 'iris', group: 'motion', icon: 'circle', name: 'trans.opt.iris' },
  { id: 'ramp', group: 'ramp', icon: 'arrow-right', name: 'ct.kind.ramp', directional: true },
  { id: 'speed-ramp', group: 'ramp', icon: 'zap', name: 'trans.opt.speedRamp' },
  { id: 'flash', group: 'light', icon: 'wand-sparkles', name: 'trans.opt.flash' },
  { id: 'light-leak', group: 'light', icon: 'sun', name: 'trans.opt.lightLeak' },
  { id: 'film-burn', group: 'light', icon: 'flame', name: 'trans.opt.filmBurn', minDuration: 1.2 }
]

export const TRANSITION_GROUPS: readonly TransitionGroup[] = ['basic', 'motion', 'ramp', 'light']
export const RAMP_DIRS: readonly RampDir[] = ['right', 'left', 'down', 'up']

/** Every type the table can make (the command schema's 17). */
export const TABLE_TYPES: readonly TransitionType[] = TRANSITION_KINDS.flatMap((k) =>
  k.directional ? RAMP_DIRS.map((d) => `ramp-${d}` as TransitionType) : [k.id as TransitionType]
)

const BY_ID = new Map(TRANSITION_KINDS.map((k) => [k.id, k]))

/** The kind a stored type belongs to (`ramp-left` → `ramp`). */
export function kindOf(type: TransitionType): TransitionKind {
  return BY_ID.get(type.startsWith('ramp-') ? 'ramp' : (type as TransitionKindId)) ?? TRANSITION_KINDS[0]
}

/** A ramp's direction (null: not a ramp). */
export function rampDirOf(type: TransitionType): RampDir | null {
  return type.startsWith('ramp-') ? (type.slice(5) as RampDir) : null
}

/** The type of a kind: a ramp takes `dir` (or the one it had, or right). */
export function typeOf(kind: TransitionKindId, dir?: RampDir | null): TransitionType {
  return (kind === 'ramp' ? `ramp-${dir ?? 'right'}` : kind) as TransitionType
}

/** True if `v` is a type the table knows (a value read back from storage). */
export function isTransitionType(v: unknown): v is TransitionType {
  return typeof v === 'string' && (TABLE_TYPES as readonly string[]).includes(v)
}

/** A length inside the one rule (transition-links.ts). */
export const clampDuration = (s: number): number =>
  Math.max(TRANSITION_LIMITS.min, Math.min(TRANSITION_LIMITS.max, Number.isFinite(s) ? s : DEFAULT_DURATION))

/**
 * The transition `prev` becomes when its type is changed to `type`: what it
 * had (length, where it sits, its sound, the ramp's settings) stays; a new
 * one gets `duration` (the default's); a kind that wants more time than it
 * has gets its shortest.
 */
export function withType(prev: Transition | undefined | null, type: TransitionType, duration = DEFAULT_DURATION): Transition {
  const min = kindOf(type).minDuration ?? 0
  const len = clampDuration(Math.max(min, prev?.duration ?? duration))
  return { ...(prev ?? {}), type, duration: len }
}

/** A cut where two clips of a video track meet, and the clip whose
 *  transition it holds (the outgoing one). */
export interface Cut {
  clipId: string
  trackId: string
  time: number
}

/**
 * The cuts of the video tracks that can take a transition: two clips that
 * meet (the render's tolerance), neither an adjustment layer, not on a
 * locked track. The same rule as the timeline's junctions and the presets
 * (commands/effects.ts). `trackId`: that track only.
 */
export function cutsOf(project: Project, trackId?: string): Cut[] {
  const out: Cut[] = []
  for (const track of project.tracks) {
    if (track.kind !== 'video' || track.locked) continue
    if (trackId && track.id !== trackId) continue
    const clips = track.clipIds.map((id) => project.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start)
    for (let i = 0; i < clips.length - 1; i++) {
      const a = clips[i]
      const b = clips[i + 1]
      if (a.adjustment || b.adjustment) continue
      if (Math.abs(b.start - (a.start + a.duration)) < JOIN_EPS) out.push({ clipId: a.id, trackId: track.id, time: a.start + a.duration })
    }
  }
  return out
}

/**
 * The cut Ctrl+T works on: the cut nearest `time` on `trackId` (the selected
 * clip's track), or, with none given, on the topmost video track that has a
 * cut. Null: no cut to put a transition on.
 */
export function nearestCut(project: Project, time: number, trackId?: string | null): Cut | null {
  let cuts: Cut[] = []
  if (trackId) cuts = cutsOf(project, trackId)
  if (cuts.length === 0) {
    for (const track of project.tracks) {
      if (track.kind !== 'video') continue
      cuts = cutsOf(project, track.id)
      if (cuts.length > 0) break
    }
  }
  let best: Cut | null = null
  for (const c of cuts) if (!best || Math.abs(c.time - time) < Math.abs(best.time - time)) best = c
  return best
}
