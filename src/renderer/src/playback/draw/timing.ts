// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Time on the timeline: transitions between neighbours (their windows, seams,
// ramps), a clip's media time at a timeline time, and the render list (what
// is drawn at a time, in order). Moved out of playback/render.ts in
// SnippStudio phase 2B (no change).
import { JOIN_EPS } from '../join'
import type { Clip, Project } from '../../types'
import { assetById, clipsOfTrack, flatSiblings } from '../../types'
import { activeClipAtTime, isAdjustmentClip, smooth, snap, nestedSpan } from './core'
import { EPS } from '../../timeline/eps'
import { curveMediaAt, hasCurve } from '../../timeline/speed-curve'
import { curveRoom } from '../../timeline/media-time'

/** All visible (video/image) clips at `time`, bottom layer first. */
export function visibleClips(project: Project, time: number): Clip[] {
  const result: Clip[] = []
  // tracks[0] is the top layer in the UI, so draw from the end of the array.
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]
    if (track.kind !== 'video' || track.hidden) continue
    for (const clip of clipsOfTrack(project, track)) {
      // A disabled clip stays on the timeline but renders nothing.
      if (!clip.disabled && activeClipAtTime(clip, time)) result.push(clip)
    }
  }
  return result
}

export interface RenderEntry {
  clip: Clip
  alpha: number
  /** True when the clip renders outside its own time range (dissolve overlap). */
  ghost: boolean
  /** A between-clip transition owns this edge; do not stack per-clip in/out. */
  suppressEdgeMotion?: boolean
  /** One side of a real cross-mix (phase Ç2b.2, decision 2; report G1): the
   *  pair is drawn on a transparent surface of its track's own, the incoming
   *  one at g, the outgoing one added at 1 − g, and that surface is laid
   *  over the frame. Where only one of them covers, it fades against what is
   *  under the track instead of the incoming shot showing at full strength
   *  from the first frame. */
  mix?: 'in' | 'out'
  /** Horizontal offset in project pixels (for slide transitions). */
  dx?: number
  /** Wipe transition: fraction of the frame still visible (left-anchored). */
  wipe?: number
  /** Zoom transition: extra scale multiplier around the frame center. */
  zoomFx?: number
  /** Vertical offset in project pixels (push transitions). */
  dy?: number
  /** Extra blur in project pixels — whip pan and blur dissolve. */
  blurFx?: number
  /** A short, directional exposure trail for speed ramps, in project pixels. */
  motionBlur?: { dx: number; dy: number }
  /** Wipe from the other side: only the frame right of this fraction shows. */
  wipeFrom?: number
  /** Iris: cut a circular hole of this fraction of the frame's half-diagonal. */
  irisHole?: number
  /** Light sweep: draw the warm bar at this fraction of the width, 0..1. */
  flash?: number
  /** A wide organic warm flare rather than the narrower light sweep. */
  lightLeak?: number
  /** Film burn (0 → 1): the shot burning away, holes eaten through it. */
  burn?: number
  /** Soft-edged version of wipeFrom: the reveal fades over this fraction of
   *  the width instead of ending on a hard vertical line. */
  softFrom?: number
  /** Fade to black (0..1): the clip's own pixels taken this far towards
   *  black. The frame really goes black through a dip, whatever is on the
   *  tracks under it — and round a smaller picture they still show. */
  dip?: number
}

/** Two travelling full-frame shots must always meet. A tiny overlap at the
 * seam also hides sub-pixel sampling/blur fringes in preview and export. */
/**
 * Where the edge between two shots is during a moving transition out of
 * `clipId` at time t — the incoming shot's leading edge, by the very maths
 * the render uses — the axis it runs along and which way it travels. Null
 * outside the window or for a transition that doesn't move the picture.
 */
export function transitionSeam(project: Project, clipId: string, t: number): { axis: 'x' | 'y'; pos: number; dir: 1 | -1 } | null {
  const clip = project.clips[clipId]
  const tr = clip?.transitionOut
  if (!clip || !tr) return null
  const w = outgoingTransitionWindow(project, clip)
  if (w.duration <= 0) return null
  const end = clip.start + clip.duration
  const a = end - w.pre
  if (t < a || t > a + w.duration) return null
  const { width: W, height: H } = project.settings
  const g = smooth((t - a) / w.duration)
  const p = snap(g)
  switch (tr.type) {
    case 'slide':
      return { axis: 'x', pos: -travelOffset(g, W, true), dir: -1 }
    case 'whip':
      return { axis: 'x', pos: -travelOffset(p, W, true), dir: -1 }
    case 'push':
      return { axis: 'y', pos: -travelOffset(p, H, true), dir: -1 }
    case 'wipe':
      return { axis: 'x', pos: W * (1 - g), dir: -1 }
    case 'ramp-right':
    case 'ramp-left':
    case 'ramp-down':
    case 'ramp-up': {
      const axis = rampAxis(tr.type)
      const travel = speedRamp((t - a) / w.duration, w.duration)
      if (axis.x !== 0) return axis.x > 0 ? { axis: 'x', pos: travel * W, dir: 1 } : { axis: 'x', pos: (1 - travel) * W, dir: -1 }
      return axis.y > 0 ? { axis: 'y', pos: travel * H, dir: 1 } : { axis: 'y', pos: (1 - travel) * H, dir: -1 }
    }
    default:
      return null
  }
}

export function travelOffset(progress: number, span: number, incoming: boolean): number {
  const overlap = Math.sin(Math.PI * progress) * span * 0.012
  return incoming ? (progress - 1) * span + overlap : progress * span - overlap
}

/** Slow–fast–slow travel, stepped at a film-like 18 Hz for editorial texture. */
export function speedRamp(t: number, duration = 0): number {
  const clamped = Math.min(1, Math.max(0, t))
  const frames = duration > 0 ? Math.max(6, Math.round(duration * 18)) : 0
  const x = frames ? Math.round(clamped * frames) / frames : clamped
  return x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2
}

export function rampAxis(type: TransitionType): { x: number; y: number } {
  if (type === 'ramp-right') return { x: 1, y: 0 }
  if (type === 'ramp-left') return { x: -1, y: 0 }
  if (type === 'ramp-down') return { x: 0, y: 1 }
  return { x: 0, y: -1 }
}

export type TransitionType =
  | 'mix'
  | 'fade'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'flash'
  | 'whip'
  | 'blur'
  | 'iris'
  | 'push'
  | 'ramp-right'
  | 'ramp-left'
  | 'ramp-down'
  | 'ramp-up'
  | 'speed-ramp'
  | 'light-leak'
  | 'film-burn'

/**
 * Where a transition sits relative to the cut, and how long it is.
 *
 * `pre` is how far BEFORE the cut it starts, `post` how far after it ends —
 * together always `duration`. Everything that needs the window (the render
 * list, the engine's active range and audio crossfade, the export mix, the
 * export's decoder pre-roll) reads it from HERE, so preview and export cannot
 * disagree about where a transition begins.
 */
export interface TransitionWindow {
  duration: number
  type: TransitionType
  pre: number
  post: number
}

export const NO_TRANSITION: TransitionWindow = { duration: 0, type: 'mix', pre: 0, post: 0 }

/** The transitions that work by opacity (a real cross-mix, decision 2); the
 *  others reveal the incoming shot (iris, wipe, slide, push, flash, burn,
 *  the ramps) and keep it at full strength under the outgoing one. */
export const MIX_TYPES: ReadonlySet<TransitionType> = new Set<TransitionType>(['mix', 'zoom', 'blur', 'light-leak'])

/**
 * The clip that butts up against the end of `clip` on the same track, cached
 * per project STATE. Every mutation clones the project, so a WeakMap keyed by
 * the project object is a cache that builds once and then can't go stale — and
 * it keeps the per-frame cost of looking up a neighbour at a map read instead
 * of a scan of the track.
 */
export const neighbourCache = new WeakMap<Project, { next: Map<string, Clip>; prev: Map<string, Clip> }>()
export function neighbours(project: Project): { next: Map<string, Clip>; prev: Map<string, Clip> } {
  let maps = neighbourCache.get(project)
  if (!maps) {
    maps = { next: new Map(), prev: new Map() }
    for (const track of project.tracks) {
      const ordered = clipsOfTrack(project, track)
      for (let i = 0; i < ordered.length - 1; i++) {
        const cur = ordered[i]
        const nx = ordered[i + 1]
        // Only clips that actually butt together can carry a transition —
        // the same tolerance the timeline's junctions and the presets use.
        if (Math.abs(nx.start - (cur.start + cur.duration)) >= JOIN_EPS) continue
        maps.next.set(cur.id, nx)
        maps.prev.set(nx.id, cur)
      }
    }
    neighbourCache.set(project, maps)
  }
  return maps
}
/**
 * The project a clip's transitions are timed in (Ç2b patch, item 5): for a
 * compound child as `flattenClips` gave it (the engine's elements, the
 * export's sound and frames walk those), its siblings on synthetic tracks
 * of their own — one per layer they came from, as `nestedProject` lays them
 * for the picture — on the outer clock; for any other clip, `project`. Timed
 * against the outer tracks a child had no neighbour: its sound hard-cut
 * under the dissolve and its element was not kept for the ghost frames.
 */
const scopeCache = new WeakMap<readonly Clip[], Project>()
export function scopeOf(project: Project, clip: Clip): Project {
  const sibs = flatSiblings(clip)
  if (!sibs) return project
  const hit = scopeCache.get(sibs)
  if (hit && hit.assets === project.assets && hit.settings === project.settings) return hit
  const order: string[] = []
  const byTrack = new Map<string, Clip[]>()
  for (const c of sibs) {
    if (!byTrack.has(c.trackId)) order.push(c.trackId)
    byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), c])
  }
  const kindOf = (id: string): 'video' | 'audio' => project.tracks.find((t) => t.id === id)?.kind ?? 'video'
  const tracks = order.reverse().map((id) => ({ id, kind: kindOf(id), name: id, clipIds: [...byTrack.get(id)!].sort((a, b) => a.start - b.start).map((c) => c.id) }))
  const scope: Project = { ...project, tracks, clips: Object.fromEntries(sibs.map((c) => [c.id, c])) }
  scopeCache.set(sibs, scope)
  return scope
}

export function nextClipOf(project: Project, clip: Clip): Clip | undefined {
  return neighbours(project).next.get(clip.id)
}

/** Timeline seconds of unused media before a clip's in point (its head handle). */
export function handleBefore(project: Project, clip: Clip): number {
  // A freeze frame is the same still whenever it is drawn — no boundary.
  if (clip.freeze !== undefined) return Infinity
  const speed = clip.speed ?? 1
  // A compound clip has frames wherever its children do.
  if (clip.nested) return Math.max(0, clip.inPoint / speed)
  const asset = assetById(project, clip.assetId)
  // A still (or a clip with no asset) can be drawn at any moment — no boundary.
  if (!asset || asset.kind === 'image') return Infinity
  // Along a speed curve: the media outside it, at the curve's speeds (core polish C).
  const curved = curveRoom(clip, asset.duration)
  if (curved) return curved[0]
  // Played backwards, what comes before its first frame is the media after
  // the part it uses.
  if (clip.reversed) return Math.max(0, (asset.duration - (clip.inPoint + clip.duration * speed)) / speed)
  return Math.max(0, clip.inPoint / speed)
}

/** …and after its out point (its tail handle). */
export function handleAfter(project: Project, clip: Clip): number {
  if (clip.freeze !== undefined) return Infinity
  const speed = clip.speed ?? 1
  if (clip.nested) return Math.max(0, (nestedSpan(clip) - clip.inPoint - clip.duration * speed) / speed)
  const asset = assetById(project, clip.assetId)
  if (!asset || asset.kind === 'image') return Infinity
  const curved = curveRoom(clip, asset.duration)
  if (curved) return curved[1]
  // Played backwards, it goes on into the media before its in point.
  if (clip.reversed) return Math.max(0, clip.inPoint / speed)
  const used = clip.inPoint + clip.duration * speed
  return Math.max(0, (asset.duration - used) / speed)
}

/**
 * Whether `clip` carries a transition that takes up time inside it (not a
 * speed ramp, which works from inside both clips at the cut, and not on an
 * adjustment layer, which takes none). Deliberately does not look further
 * along the track, so the clamp below cannot recurse.
 */
export function carriesTimedTransition(clip: Clip): boolean {
  const t = clip.transitionOut
  return !!t && t.duration > 0 && t.type !== 'speed-ramp' && !isAdjustmentClip(clip)
}

/** The window of the transition OUT of `clip` (into whatever follows it). */
export function outgoingTransitionWindow(project: Project, clip: Clip): TransitionWindow {
  project = scopeOf(project, clip)
  const t = clip.transitionOut
  // A switched-off clip draws nothing, so it leads nowhere either.
  if (!t || t.duration <= 0 || clip.disabled) return NO_TRANSITION
  // An adjustment layer only grades what is under it: two grades cannot
  // cross-dissolve that way (both would stack), and a wipe or an iris has
  // nothing of its own to cut — so between looks it is a cut.
  if (isAdjustmentClip(clip)) return NO_TRANSITION
  const d = t.duration
  // Only into a clip that is really there: the last clip on the track, or one
  // whose neighbour was deleted or moved away (or is switched off, or is an
  // adjustment layer), has nothing to go to. A dissolve or a dip there is
  // still a fade-out, inside the clip; anything else is no transition at all —
  // no ghost tail past the end, no sound.
  const next = nextClipOf(project, clip)
  // It goes into the clip it names (phase Ç2b.2, decision 1): another clip
  // that came to touch its end is no partner, and a transition whose clip
  // left is not drawn at all (the edit drops it: timeline/transition-links.ts).
  // `to: null` is a fade-out put there on purpose.
  if (typeof t.to === 'string' && next?.id !== t.to) return NO_TRANSITION
  const linked = !!next && t.to !== null && !next.disabled && !isAdjustmentClip(next)
  // A velocity ramp cuts at the edit point. It uses the footage inside each
  // clip, so it needs neither ghost frames nor media handles outside the cut.
  if (t.type === 'speed-ramp') return linked ? { duration: d, type: t.type, pre: 0, post: 0 } : NO_TRANSITION
  const prev = neighbours(project).prev.get(clip.id)
  // The first half of this clip may belong to the transition coming into it.
  const maxPre = prev && !prev.disabled && carriesTimedTransition(prev) ? clip.duration / 2 : clip.duration
  if (!linked) {
    if (t.type !== 'mix' && t.type !== 'fade') return NO_TRANSITION
    const pre = Math.min(d, maxPre)
    return pre > EPS ? { duration: pre, type: t.type, pre, post: 0 } : NO_TRANSITION
  }
  const half = d / 2
  const align = t.align ?? 'auto'
  let pre: number
  let post: number
  if (align === 'center') [pre, post] = [half, half]
  else if (align === 'start') [pre, post] = [0, d]
  else if (align === 'end') [pre, post] = [d, 0]
  else {
    // auto: centred when both sides can feed it, otherwise pushed to the side
    // that has the footage. Holding a frozen frame is the last resort, not the
    // default.
    const inH = handleBefore(project, next)
    const outH = handleAfter(project, clip)
    const eps = 1 / 240
    if (inH + eps >= half && outH + eps >= half) [pre, post] = [half, half]
    else if (inH < half && outH + eps >= d) [pre, post] = [0, d]
    else if (outH < half && inH + eps >= d) [pre, post] = [d, 0]
    else [pre, post] = [half, half]
  }
  // Never longer than the clips it joins: a transition that started before
  // its clip did, or ran into the next one's own transition out, made the
  // shot jump — straight from part-way through its way in to its way out.
  // A clip with transitions at both ends gives each at most half of itself.
  pre = Math.min(pre, maxPre)
  post = Math.min(post, carriesTimedTransition(next) ? next.duration / 2 : next.duration)
  const duration = pre + post
  return duration > EPS ? { duration, type: t.type, pre, post } : NO_TRANSITION
}

/**
 * The transition the given clip is on the receiving end of: the transitionOut
 * of the clip that ends where this one starts.
 *
 * Timed from THAT clip's end, the one cut both halves share: with a frame or
 * two of gap between the clips (which still counts as a cut), timing the
 * incoming half from this clip's own start made it lag the outgoing one, and
 * a moving transition opened a strip between shots meant to move as one.
 */
export function incomingTransitionInfo(project: Project, clip: Clip): TransitionWindow {
  // A map lookup, not a scan of the track. This runs for every clip on every
  // frame in the render list AND in the engine, so the scan it replaced was
  // quadratic in the number of clips on a track — invisible on a handful,
  // real work on a few hundred.
  project = scopeOf(project, clip)
  const prev = neighbours(project).prev.get(clip.id)
  // (A switched-off clip or an adjustment layer is nothing to go into: the
  // clip before it fades out on its own, see outgoingTransitionWindow.)
  if (!prev?.transitionOut || prev.transitionOut.to === null || clip.disabled || isAdjustmentClip(clip)) return NO_TRANSITION
  const w = outgoingTransitionWindow(project, prev)
  if (w.duration <= 0 || w.type === 'speed-ramp') return w
  const gap = clip.start - (prev.start + prev.duration)
  if (Math.abs(gap) < 1e-9) return w
  return { ...w, pre: Math.max(0, w.pre + gap), post: Math.max(0, w.post - gap) }
}

/**
 * The transition windows a clip's SOUND follows (phase Ç2b.2, decision 4;
 * report G4): its own, or — for a sound on a track of its own (extracted, a
 * code film's, linked) — those of the picture it is linked to, when the
 * sound meets that picture's cut and the sound next to it (after it, before
 * it) is linked to the picture's partner there. So a linked or extracted
 * sound crosses with its picture instead of hard-cutting under a dissolve.
 * There is no transition of a sound track's own (no UI for one).
 */
export function soundWindows(project: Project, clip: Clip): { out: TransitionWindow; in: TransitionWindow } {
  project = scopeOf(project, clip)
  let out = outgoingTransitionWindow(project, clip)
  let inc = incomingTransitionInfo(project, clip)
  if ((out.duration > 0 && inc.duration > 0) || !clip.linkId) return { out, in: inc }
  const pic = pictureOf(project, clip)
  if (!pic) return { out, in: inc }
  const n = neighbours(project)
  const together = (a: Clip | undefined, b: Clip | undefined): boolean => !!a && !!b && !!a.linkId && a.linkId === b.linkId
  if (out.duration <= 0 && Math.abs(pic.start + pic.duration - (clip.start + clip.duration)) < JOIN_EPS && together(n.next.get(clip.id), n.next.get(pic.id))) {
    out = outgoingTransitionWindow(project, pic)
  }
  if (inc.duration <= 0 && Math.abs(pic.start - clip.start) < JOIN_EPS && together(n.prev.get(clip.id), n.prev.get(pic.id))) {
    inc = incomingTransitionInfo(project, pic)
  }
  return { out, in: inc }
}

/** The picture a sound on an audio track is linked to (its link partner on a
 *  video track), if any. */
function pictureOf(project: Project, clip: Clip): Clip | undefined {
  const track = project.tracks.find((t) => t.id === clip.trackId)
  if (!track || track.kind !== 'audio') return undefined
  for (const t of project.tracks) {
    if (t.kind !== 'video') continue
    for (const id of t.clipIds) {
      const c = project.clips[id]
      if (c && c.id !== clip.id && c.linkId === clip.linkId) return c
    }
  }
  return undefined
}

/** Backwards-compatible helper returning just the incoming duration. */
export function incomingTransition(project: Project, clip: Clip): number {
  return incomingTransitionInfo(project, clip).duration
}

export const rampIntegral = (u: number): number => u ** 3 - 0.5 * u ** 4
export const slowIntegral = (u: number): number => u / 2 - Math.sin(2 * Math.PI * u) / (4 * Math.PI)

/** The source clock and instantaneous velocity shared by preview, export and
 * audio. Normal playback surrounds a short S-curve acceleration at the cut.
 * A gentle slowdown before/after pays back exactly the extra source time, so
 * the clip starts and ends on its original frames without using trim handles. */
export function clipMediaAt(project: Project, clip: Clip, time: number): { time: number; rate: number; ramp: number } {
  project = scopeOf(project, clip)
  const speed = Math.max(0.01, clip.speed ?? 1)
  const local = time - clip.start
  const normal = clip.inPoint + local * speed
  if (clip.freeze !== undefined) return { time: clip.freeze, rate: 0, ramp: 0 }
  // A speed curve (core polish C) is the clip's own clock, forwards or
  // backwards; a speed ramp at its cut does not bend it as well (decision
  // C5: the curve wins; the clip on the other side of the cut still ramps).
  if (hasCurve(clip)) {
    const curved = curveMediaAt(clip, local)
    if (curved) return { time: clip.reversed ? Math.max(0, curved.time) : curved.time, rate: curved.rate, ramp: 0 }
  }
  // Backwards: past its end (a transition's ghost frames) it goes on into the
  // media before its in point, rather than holding that frame.
  if (clip.reversed) return {
    time: Math.max(0, clip.inPoint + (clip.duration - local) * speed), rate: -speed, ramp: 0
  }
  const next = nextClipOf(project, clip)
  const previous = neighbours(project).prev.get(clip.id)
  const outgoing = next && !next.disabled && clip.transitionOut?.type === 'speed-ramp'
    ? clip.transitionOut : undefined
  const incoming = previous && !previous.disabled && previous.transitionOut?.type === 'speed-ramp'
    ? previous.transitionOut : undefined
  const transition = local < clip.duration / 2 ? incoming : outgoing
  if (!transition || clip.duration <= 0) return { time: normal, rate: speed, ramp: 0 }
  const fps = Math.max(12, project.settings.fps || 30)
  const rampSpan = Math.min(5.5 / fps, transition.duration / 2, clip.duration / 4)
  const slowSpan = Math.min(clip.duration / 2 - rampSpan, Math.max(3 * rampSpan, transition.duration * 3.5))
  if (rampSpan <= 0 || slowSpan <= 0) return { time: normal, rate: speed, ramp: 0 }
  // (Never under 1: a clip already at 16x or more — core polish B, speeds to
  // 100x — has no room to ramp; 16 / speed alone turned its ramp into a
  // slow-down at the cut.)
  const peak = Math.min(Math.max(1, transition.peakSpeed ?? 10), Math.max(1, 16 / speed),
    1 + 0.75 * slowSpan / rampSpan)
  const slowDepth = (peak - 1) * rampSpan / slowSpan
  let shift = 0
  let velocity = 1
  let ramp = 0
  if (incoming) {
    if (local >= 0 && local < rampSpan) {
      const u = local / rampSpan
      shift = (peak - 1) * rampSpan * (u - rampIntegral(u))
      velocity = peak - (peak - 1) * smooth(u)
      ramp = (velocity - 1) / Math.max(EPS, peak - 1)
    } else if (local >= rampSpan && local < rampSpan + slowSpan) {
      const u = (local - rampSpan) / slowSpan
      shift = (peak - 1) * rampSpan / 2 - slowDepth * slowSpan * slowIntegral(u)
      velocity = 1 - slowDepth * Math.sin(Math.PI * u) ** 2
    }
  } else {
    const slowStart = clip.duration - rampSpan - slowSpan
    if (local >= slowStart && local < clip.duration - rampSpan) {
      const u = (local - slowStart) / slowSpan
      shift = -slowDepth * slowSpan * slowIntegral(u)
      velocity = 1 - slowDepth * Math.sin(Math.PI * u) ** 2
    } else if (local >= clip.duration - rampSpan && local <= clip.duration) {
      const u = Math.min(1, Math.max(0, (local - (clip.duration - rampSpan)) / rampSpan))
      shift = -slowDepth * slowSpan / 2 + (peak - 1) * rampSpan * rampIntegral(u)
      velocity = 1 + (peak - 1) * smooth(u)
      ramp = (velocity - 1) / Math.max(EPS, peak - 1)
    }
  }
  return {
    time: normal + shift * speed,
    rate: Math.max(0.01, velocity * speed),
    ramp: Math.min(1, Math.max(0, ramp))
  }
}

/**
 * Everything to draw at `time`, bottom layer first. Transitions are centered
 * on the cut: `mix` cross-dissolves, `fade` dips to black, `slide` pushes the
 * outgoing shot left while the incoming enters from the right.
 */
export function renderList(project: Project, time: number): RenderEntry[] {
  const width = project.settings.width
  const height = project.settings.height
  const entries: RenderEntry[] = []
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]
    if (track.kind !== 'video' || track.hidden) continue
    // Resolve outgoing-over-incoming inside this track, before drawing any
    // higher track. Global overlay buckets made lower cuts cover upper clips.
    const normal: RenderEntry[] = []
    const overlays: RenderEntry[] = []
    for (const clip of clipsOfTrack(project, track)) {
      // Disabled clips draw nothing — this is the path preview AND export use,
      // so it is the one that actually has to honour the flag.
      if (clip.disabled) continue
      const end = clip.start + clip.duration
      const outInfo = outgoingTransitionWindow(project, clip)
      const dOut = outInfo.duration
      const outType = outInfo.type
      const inInfo = incomingTransitionInfo(project, clip)
      const dIn = inInfo.duration
      const active = activeClipAtTime(clip, time)

      // A real cross-mix for the dissolves that work by opacity (decision 2):
      // not when either clip blends with what is under it (a screen or a
      // multiply needs the frame under it, not an empty surface).
      const blends = (c: Clip | undefined): boolean => !!c?.blendMode && c.blendMode !== 'normal'
      const mixes = (type: TransitionType, other: Clip | undefined): boolean => MIX_TYPES.has(type) && !blends(clip) && !blends(other)
      // g: 0 at the window start, 1 at the window end.
      const pushOutgoing = (ghost: boolean) => {
        const previousCount = overlays.length
        const g = smooth((time - (end - outInfo.pre)) / dOut)
        // The outgoing shot draws ON TOP of the incoming one, so anything
        // that reveals the new shot has to take a bite out of this entry.
        const p = snap(g)
        if (outType === 'fade') {
          // Down to black by the middle, then gone (the next one comes up
          // out of the black). With nothing to come up, it fades down over
          // the whole window and is black at its end.
          const into = nextClipOf(project, clip)
          const toNext = !!into && clip.transitionOut?.to !== null && !into.disabled && !isAdjustmentClip(into)
          overlays.push(toNext
            ? { clip, alpha: g < 0.5 ? 1 : 0, ghost, dip: Math.min(1, 2 * g) }
            : { clip, alpha: 1, ghost, dip: Math.min(1, g) })
        }
        else if (outType === 'slide') overlays.push({ clip, alpha: 1, ghost, dx: -travelOffset(g, width, false) })
        else if (outType === 'wipe') overlays.push({ clip, alpha: 1, ghost, wipe: 1 - g })
        else if (outType === 'zoom') overlays.push({ clip, alpha: 1 - g, ghost, zoomFx: 1 + g * 0.25 })
        else if (outType === 'flash')
          // The bar wipes the old shot away and is drawn over the seam. The
          // edge is SOFT — a hard vertical line moving across the frame is what
          // made this read as a wipe with a light stuck to it rather than as
          // light burning through.
          overlays.push({ clip, alpha: 1, ghost, softFrom: g, flash: g })
        else if (outType === 'whip')
          overlays.push({
            clip,
            alpha: 1,
            ghost,
            dx: -travelOffset(p, width, false),
            blurFx: Math.sin(Math.PI * g) * width * 0.022
          })
        else if (outType === 'blur')
          overlays.push({
            clip,
            alpha: 1 - g,
            ghost,
            zoomFx: 1 + g * 0.05,
            blurFx: Math.sin(Math.PI * g) * width * 0.02
          })
        else if (outType === 'iris') overlays.push({ clip, alpha: 1, ghost, irisHole: g })
        else if (outType === 'push') overlays.push({ clip, alpha: 1, ghost, dy: -travelOffset(p, height, false) })
        else if (outType.startsWith('ramp-')) {
          const axis = rampAxis(outType)
          const travel = speedRamp((time - (end - outInfo.pre)) / dOut, dOut)
          const velocity = Math.sin(Math.PI * travel)
          const trail = velocity * velocity * Math.min(width, height) * 0.065
          overlays.push({
            clip, alpha: 1, ghost,
            dx: axis.x * travelOffset(travel, width, false),
            dy: axis.y * travelOffset(travel, height, false),
            zoomFx: 1 + Math.sin(Math.PI * travel) * 0.025,
            blurFx: velocity * Math.min(width, height) * 0.006,
            motionBlur: { dx: axis.x * trail, dy: axis.y * trail }
          })
        }
        else if (outType === 'light-leak') overlays.push({ clip, alpha: 1 - g, ghost, lightLeak: g })
        else if (outType === 'film-burn') overlays.push({ clip, alpha: 1, ghost, burn: g })
        else overlays.push({ clip, alpha: 1 - g, ghost })
        if (overlays.length > previousCount) {
          const e = overlays[overlays.length - 1]
          e.suppressEdgeMotion = true
          // (Only into a clip that comes in: a fade-out has no other half.)
          const into = nextClipOf(project, clip)
          if (into && mixes(outType, into) && incomingTransitionInfo(project, into).duration > 0) e.mix = 'out'
        }
      }
      const pushIncoming = (ghost: boolean) => {
        const previousCount = normal.length
        const g = smooth((time - (clip.start - inInfo.pre)) / dIn)
        const p = snap(g)
        // Up out of the black once the old one is all the way down into it.
        if (inInfo.type === 'fade') normal.push({ clip, alpha: g >= 0.5 ? 1 : 0, ghost, dip: Math.min(1, 2 - 2 * g) })
        else if (inInfo.type === 'slide') normal.push({ clip, alpha: 1, ghost, dx: -travelOffset(g, width, true) })
        else if (inInfo.type === 'wipe') normal.push({ clip, alpha: 1, ghost })
        else if (inInfo.type === 'zoom') normal.push({ clip, alpha: 1, ghost, zoomFx: 1.2 - g * 0.2 })
        // flash and iris reveal this clip by taking the outgoing one apart; it
        // just sits underneath at full strength.
        else if (inInfo.type === 'flash' || inInfo.type === 'iris')
          normal.push({ clip, alpha: 1, ghost })
        else if (inInfo.type === 'whip')
          normal.push({
            clip,
            alpha: 1,
            ghost,
            dx: -travelOffset(p, width, true),
            blurFx: Math.sin(Math.PI * g) * width * 0.022
          })
        else if (inInfo.type === 'blur')
          normal.push({
            clip,
            alpha: 1,
            ghost,
            zoomFx: 1.05 - g * 0.05,
            blurFx: Math.sin(Math.PI * g) * width * 0.02
          })
        else if (inInfo.type === 'push') normal.push({ clip, alpha: 1, ghost, dy: -travelOffset(p, height, true) })
        else if (inInfo.type.startsWith('ramp-')) {
          const axis = rampAxis(inInfo.type)
          const travel = speedRamp((time - (clip.start - inInfo.pre)) / dIn, dIn)
          const velocity = Math.sin(Math.PI * travel)
          const trail = velocity * velocity * Math.min(width, height) * 0.065
          normal.push({
            clip, alpha: 1, ghost,
            dx: axis.x * travelOffset(travel, width, true),
            dy: axis.y * travelOffset(travel, height, true),
            zoomFx: 1 + Math.sin(Math.PI * travel) * 0.025,
            blurFx: velocity * Math.min(width, height) * 0.006,
            motionBlur: { dx: axis.x * trail, dy: axis.y * trail }
          })
        }
        else if (inInfo.type === 'light-leak' || inInfo.type === 'film-burn') normal.push({ clip, alpha: 1, ghost })
        else normal.push({ clip, alpha: 1, ghost })
        if (normal.length > previousCount) {
          const e = normal[normal.length - 1]
          e.suppressEdgeMotion = true
          // The incoming half of a real mix comes up from 0 (it was drawn at
          // full strength under the outgoing one).
          if (mixes(inInfo.type, neighbours(project).prev.get(clip.id))) {
            e.mix = 'in'
            e.alpha *= g
          }
        }
      }

      if (active) {
        // Late in the clip → outgoing effect; early in the clip → incoming.
        if (dOut > 0 && outType === 'speed-ramp' && time >= end - Math.min(5.5 / Math.max(12, project.settings.fps), dOut / 2, clip.duration / 4)) {
          const energy = clipMediaAt(project, clip, time).ramp
          const direction = clip.transitionOut?.direction ?? 'right'
          const axis = direction === 'right' ? { x: 1, y: 0 } : direction === 'left' ? { x: -1, y: 0 }
            : direction === 'down' ? { x: 0, y: 1 } : { x: 0, y: -1 }
          overlays.push({ clip, alpha: 1, ghost: false, suppressEdgeMotion: true,
            zoomFx: 1 + energy * 0.025,
            blurFx: energy * Math.min(width, height) * 0.005,
            motionBlur: { dx: axis.x * energy * Math.min(width, height) * 0.06,
              dy: axis.y * energy * Math.min(width, height) * 0.06 } })
        } else if (dIn > 0 && inInfo.type === 'speed-ramp' && time < clip.start + Math.min(5.5 / Math.max(12, project.settings.fps), dIn / 2, clip.duration / 4)) {
          const energy = clipMediaAt(project, clip, time).ramp
          const previous = neighbours(project).prev.get(clip.id)
          const direction = previous?.transitionOut?.direction ?? 'right'
          const axis = direction === 'right' ? { x: 1, y: 0 } : direction === 'left' ? { x: -1, y: 0 }
            : direction === 'down' ? { x: 0, y: 1 } : { x: 0, y: -1 }
          normal.push({ clip, alpha: 1, ghost: false, suppressEdgeMotion: true,
            zoomFx: 1 + energy * 0.025,
            blurFx: energy * Math.min(width, height) * 0.005,
            motionBlur: { dx: axis.x * energy * Math.min(width, height) * 0.06,
              dy: axis.y * energy * Math.min(width, height) * 0.06 } })
        } else if (dOut > 0 && time >= end - outInfo.pre) pushOutgoing(false)
        else if (dIn > 0 && time < clip.start + inInfo.post) pushIncoming(false)
        else normal.push({ clip, alpha: 1, ghost: false })
        continue
      }
      // Outgoing tail: keep animating on top past the cut.
      if (dOut > 0 && time >= end && time < end + outInfo.post) {
        pushOutgoing(true)
        continue
      }
      // Incoming lead: the next clip appears early, under the outgoing shot.
      if (dIn > 0 && time < clip.start && time >= clip.start - inInfo.pre) {
        pushIncoming(true)
      }
    }
    entries.push(...normal, ...overlays)
  }
  return entries
}
