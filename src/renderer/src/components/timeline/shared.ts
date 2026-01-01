// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the timeline's parts share: the header column's width, time to text,
// snapping, edge auto-scroll, the small caches by asset and id, keyframe
// groups, the playhead's transform. Moved out of Timeline.tsx in SnippStudio
// phase 2B (no change).
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useStore } from '../../state/store'
import { channelKfs } from '../../playback/render'
import { type ClipAutomation } from '../../timeline/slice'
import type { KeyRef } from '../../timeline/key-drag'
import { edgeScrollStep } from '../../timeline/snapping'
import type { Asset, Clip, KfChannel, Project, PropKeyframe } from '../../types'
import { KF_CHANNELS, TIMELINE_HEADER_W, projectDuration } from '../../types'
import { fmtTime } from '../../ui/format'

/** A key this close outside the clip's ends is still on it (a key at its
 *  very end, float noise of a cut). */
const ON_CLIP = 1e-3

/** Whether a clip-local key time lies on the clip (its window). Keys off it
 *  are kept by every edit (phase Ç2c.1, decision 1) but are not diamonds. */
export const onClip = (clip: Pick<Clip, 'duration'>, time: number): boolean => time >= -ON_CLIP && time <= clip.duration + ON_CLIP

/** Every property-channel keyframe ON the clip, for the timeline diamonds. */
export function clipKeyframeDiamonds(clip: Clip): { ch: KfChannel; k: PropKeyframe }[] {
  const out: { ch: KfChannel; k: PropKeyframe }[] = []
  for (const ch of KF_CHANNELS) {
    for (const k of channelKfs(clip, ch) ?? []) if (onClip(clip, k.time)) out.push({ ch, k })
  }
  return out
}

/** How many keyframes (channel keys, volume keys, mask keys) lie off the
 *  clip, before its start and after its end: shown as one mark at that edge
 *  (phase Ç2c.1, decision 7; report K26), never as diamonds one could take. */
export function keysOffClip(clip: Clip): { before: number; after: number } {
  const out = { before: 0, after: 0 }
  const count = (time: number): void => {
    if (time < -ON_CLIP) out.before++
    else if (time > clip.duration + ON_CLIP) out.after++
  }
  for (const ch of KF_CHANNELS) for (const k of channelKfs(clip, ch) ?? []) count(k.time)
  for (const k of clip.volumeKeyframes ?? []) count(k.time)
  for (const k of clip.mask?.keyframes ?? []) count(k.time)
  return out
}

export interface KfGroup {
  /** Stable identity: the "Keyframe all" set of its keys (phase Ç2c.2,
   *  decision 2), else the id of its first keyframe. Must NOT be derived
   *  from time — using time as the React key remounted the diamond on every
   *  drag step, which dropped the pointer capture and made dragging stutter
   *  one frame at a time. */
  id: string
  time: number
  channels: KfChannel[]
  /** The keys of this instant, by id: what a drag of the diamond takes at
   *  the press and moves (decision 2; report K3, D5). */
  keys: KeyRef[]
}

/**
 * Collapses the per-channel keyframes into ONE entry per instant. "Keyframe
 * all" writes x/y/scale/rotation/opacity at the same time; drawing five
 * diamonds stacked on top of each other made dragging move only the topmost
 * channel and leave the rest behind. Grouping fixes that at the source.
 */
export function keyframeGroups(clip: Clip): KfGroup[] {
  const byTime = new Map<string, KfGroup>()
  const sets = new Map<string, string>()
  for (const { ch, k } of clipKeyframeDiamonds(clip)) {
    const key = k.time.toFixed(3)
    const g = byTime.get(key)
    if (g) {
      if (!g.channels.includes(ch)) g.channels.push(ch)
      g.keys.push({ ch, id: k.id })
      if (k.group && !sets.get(key)) sets.set(key, k.group)
    } else {
      byTime.set(key, { id: k.id, time: k.time, channels: [ch], keys: [{ ch, id: k.id }] })
      if (k.group) sets.set(key, k.group)
    }
  }
  for (const [key, set] of sets) byTime.get(key)!.id = set
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export const HEADER_W = TIMELINE_HEADER_W

export interface Span {
  id: string
  start: number
  end: number
}

/**
 * Clamps a dragged caption of length `dur` to a start position that doesn't
 * overlap any other caption — it drops into the gap nearest the target.
 */
export function clampCaptionMove(all: Span[], id: string, dur: number, desiredStart: number): number {
  const others = all.filter((c) => c.id !== id).sort((a, b) => a.start - b.start)
  // Build the free gaps between the other captions.
  const gaps: [number, number][] = []
  let cursor = 0
  for (const o of others) {
    if (o.start > cursor + 1e-4) gaps.push([cursor, o.start])
    cursor = Math.max(cursor, o.end)
  }
  gaps.push([cursor, Infinity])
  // Choose the gap whose clamped position is closest to the desired start.
  let best = Math.max(0, desiredStart)
  let bestDist = Infinity
  for (const [lo, hi] of gaps) {
    if (hi - lo < dur - 1e-4) continue // too small to hold the caption
    const s = Math.max(lo, Math.min(desiredStart, hi - dur))
    const d = Math.abs(s - desiredStart)
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return Math.max(0, best)
}

/** A drag's or a trim's time label: the one time form with hundredths
 *  (ui/format.ts, audit G6). */
export const fmt = (t: number): string => fmtTime(t, 2)

export interface TrimDrag {
  kind: 'trim-l' | 'trim-r' | 'move' | 'slip'
  clipId: string
  startX: number
  startY: number
  origStart: number
  /** Original right edge, so a trim-r can snap in absolute time. */
  origEnd: number
  /** The clip's shape when the drag began. A head trim is applied against this
   *  baseline rather than as a running delta: when the edge is blocked by the
   *  previous clip it stops moving while the drag continues, so deriving the
   *  offset from the live clip would re-apply it every mouse move. */
  base: { start: number; inPoint: number; duration: number; automation?: ClipAutomation; motionFx?: Clip['motionFx']; partners?: Record<string, { start: number; inPoint: number; duration: number }> }
  /** Alt held on a trim handle: this clip alone, not its linked partner
   *  (phase Ç2b.1, decision 2). */
  alone?: boolean
  /** Scroll offset when the drag began, so scrolling mid-drag doesn't shift it. */
  startScroll: number
  /** Whether an undo snapshot has been taken for this gesture yet. */
  gestureBegun: boolean
  /** Alt-drag creates copies on press; cancel must remove them again. */
  duplicated: boolean
  /** Last edge position handed to the store, to skip sub-pixel repeats. */
  lastEdge?: number
  /** The top of the clip's lane inside the timeline (px): where a trim's
   *  label goes. */
  rowTop?: number
  /** A move's last step (where it landed, on which lane, snapped to what):
   *  the same again is not planned or drawn again. */
  lastStep?: string
  /** Original start of every selected clip, for group moves. */
  groupStarts: Map<string, number>
  /** Ctrl/Shift pressed on a clip already selected: a click lets go of it
   *  on release; a drag keeps it (see onPointerDown). */
  toggleOnClick?: boolean
  /** A move only begins after the pointer travels past this many px, so a
   *  plain click selects without nudging the clip. */
  started: boolean
  /** Playhead position before a trim began (restored on release). */
  prevTime?: number
}

/**
 * Pulls an edge time toward the nearest snap target: clip cuts on ANY track
 * (audio included), caption edges, shorts/camera segment bands, the playhead
 * and 0. Returns `t` unchanged when nothing is within `threshold`.
 */
export function snapEdgeTime(
  s: ReturnType<typeof useStore.getState>,
  t: number,
  excludeClipId: string,
  threshold: number,
  excludeIds?: Iterable<string>,
  /** Include the playhead as a target. Off when snapping the playhead itself. */
  includePlayhead = true
): number {
  const skip = new Set<string>(excludeIds ?? [])
  skip.add(excludeClipId)
  const candidates: number[] = [0]
  if (includePlayhead) candidates.push(s.currentTime)
  for (const tr of s.project.tracks) {
    for (const id of tr.clipIds) {
      const other = s.project.clips[id]
      if (!other || skip.has(other.id)) continue
      candidates.push(other.start, other.start + other.duration)
    }
  }
  for (const c of s.project.captions) candidates.push(c.start, c.end)
  // Keyframes, but only when it is the PLAYHEAD being snapped: lining a clip's
  // edge up with some other clip's keyframe is noise, while parking the
  // playhead exactly on a diamond is the whole point of dragging it there.
  //
  // Every diamond that is drawn, not just the selected clip's — the diamonds
  // are drawn on every clip, so "it snaps to the purple marks" has to mean the
  // marks you can actually see. Read through channelKfs, the same accessor the
  // diamonds use, or clips from older projects have no snap targets at all.
  if (!includePlayhead) {
    for (const tr of s.project.tracks) {
      for (const id of tr.clipIds) {
        const c = s.project.clips[id]
        if (!c) continue
        for (const ch of KF_CHANNELS) {
          for (const k of channelKfs(c, ch) ?? []) candidates.push(c.start + k.time)
        }
        for (const k of c.volumeKeyframes ?? []) candidates.push(c.start + k.time)
      }
    }
  }
  for (const m of s.project.markers ?? []) candidates.push(m.time)
  for (const seg of s.project.shortSegments ?? []) candidates.push(seg.start, seg.end)
  let best = t
  let bestDist = threshold
  for (const c of candidates) {
    const d = Math.abs(t - c)
    if (d <= bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

/**
 * Scrolls the timeline when a drag reaches the edge of the visible area, so a
 * clip can be dragged past the right-hand side without letting go. Speed ramps
 * up the deeper into the margin the pointer is; only toward the edge the
 * pointer is heading for (`edgeScrollStep`).
 */
export function edgeAutoScroll(el: HTMLDivElement | null, clientX: number, moved: number): void {
  if (!el) return
  const rect = el.getBoundingClientRect()
  const step = edgeScrollStep(rect.left, rect.right, clientX, moved)
  if (step !== 0) el.scrollLeft = Math.max(0, el.scrollLeft + step)
}

/**
 * Playhead snapping to Shorts / camera segment BOUNDARIES only. These are the
 * marks you actually cut against, so they snap even with the general "Snap"
 * toggle off — and because the candidate set is tiny and the threshold tight,
 * it can't fight you the way snapping to every clip and caption edge does.
 */
export function snapToSegments(
  s: ReturnType<typeof useStore.getState>,
  t: number,
  threshold: number
): number {
  let best = t
  let bestDist = threshold
  const consider = (c: number): void => {
    const d = Math.abs(t - c)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  for (const seg of s.project.shortSegments ?? []) {
    consider(seg.start)
    consider(seg.end)
  }
  return best
}

// Lookups every clip block makes on every store change (the playhead moves
// it 60 times a second while playing): by a Map / Set made once per assets
// array or selection, not a scan of the whole list per block.
export const assetMaps = new WeakMap<Asset[], Map<string, Asset>>()
export function assetIn(assets: Asset[], id: string): Asset | undefined {
  let m = assetMaps.get(assets)
  if (!m) {
    m = new Map(assets.map((a) => [a.id, a]))
    assetMaps.set(assets, m)
  }
  return m.get(id)
}
export const idSets = new WeakMap<readonly string[], Set<string>>()
export function idIn(ids: readonly string[], id: string): boolean {
  if (ids.length < 8) return ids.includes(id)
  let set = idSets.get(ids)
  if (!set) {
    set = new Set(ids)
    idSets.set(ids, set)
  }
  return set.has(id)
}

/**
 * A cut needs at least this many pixels of clip on each side before its
 * transition target is offered. The target only shows itself under the
 * pointer (core polish T), so dense cuts (after a silence cut, hundreds of
 * joins a few pixels apart) no longer make a wall of buttons; below this the
 * clips themselves are narrower than the 24 px target. (It was 46 px, when
 * every cut wore a visible button.)
 */
export const TRANS_MIN_CLIP_PX = 12

/** How close to the playhead counts as grabbing it, in pixels. Deliberately
 *  small: it is a grab zone sitting on top of the tracks, and every pixel of it
 *  is a pixel where a press means "move the playhead" instead of whatever is
 *  underneath. ±6 px is a comfortable aim and still narrower than the gap
 *  between two clips. */
export const PLAYHEAD_GRAB_PX = 6

/** Pointer travel (px) that turns a press in the tracks area from a click —
 *  which seeks, as it always has — into a marquee selection. */
export const DRAG_SLOP_PX = 4


/**
 * Where a playhead stands: moved by a transform from the left edge, not by
 * `left`. A changed `left` on the head made the browser lay the ruler out
 * again on every frame of playback (about 1.5 ms a frame, on the thread the
 * preview draws on); a transform is only painted again. Rounded to the
 * screen's pixels, as layout rounds a `left`, so the line stays as sharp.
 */
export function playheadAt(x: number): { left: number; transform: string } {
  return { left: 0, transform: `translateX(${pixelX(x)}px)` }
}

/** x rounded to the screen's pixels. */
const pixelX = (x: number): number => {
  const dpr = window.devicePixelRatio || 1
  return Math.round(x * dpr) / dpr
}

/** The slide's reach (px either side of 0; a power of two, so a whole x
 *  comes back from the animation exactly) and where a hidden mark waits. */
const SLIDE_R = 2 ** 24
const SLIDE_OFF = -(2 ** 20)

// The playhead is being dragged (a scrub: the ruler, the top band, the line
// itself, the notes lane). Said by the press that starts it (beginScrub);
// over at the release of any pointer (window, capture: before the handlers).
// Only a scrub: in a trim or a clip drag the lanes are drawn again on every
// step anyway, and an animated mark there made that dearer (tl.trim).
let scrub = false
const scrubWatchers = new Set<() => void>()
/** The marks slid by an animation now, to hand back to the style on release. */
const sliding = new Set<() => void>()
function setScrub(v: boolean): void {
  if (scrub === v) return
  scrub = v
  if (!v) for (const back of [...sliding]) back()
  for (const f of scrubWatchers) f()
}
/** A press starts dragging the playhead (call before its first seek). */
export const beginScrub = (): void => setScrub(true)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pointerup', () => setScrub(false), true)
  window.addEventListener('pointercancel', () => setScrub(false), true)
  window.addEventListener('blur', () => setScrub(false))
}
const watchScrub = (f: () => void): (() => void) => {
  scrubWatchers.add(f)
  return () => scrubWatchers.delete(f)
}
/** Whether the playhead is being dragged. */
export const useScrubbing = (): boolean => useSyncExternalStore(watchScrub, () => scrub, () => false)

/**
 * The transform playheadAt gives, for an element on a layer of its own
 * (will-change) that x moves; null puts it far off to the left, out of sight.
 * At rest it is the style, as before. While the playhead is dragged (a
 * scrub) it is a paused animation's time instead, handed back to the style on
 * release. Measured on the heavy project (haritalar/_hiz-rapor.md): every new
 * transform in the style of such a layer made the browser sort out all the
 * layers of the page again ("Layerize", ~5 ms a step with ~110 layers), on
 * every step of a scrub, once for the line, its head and the snap line each;
 * the time of a paused animation sorts nothing out. (An animated layer is
 * taken to reach anywhere, so what is drawn over it may be put on layers of
 * its own while it lasts, a hair's difference in their edges: only during a
 * scrub; the still picture is the one it was.)
 */
export function useSlideX<T extends HTMLElement>(x: number | null): React.RefObject<T> {
  const ref = useRef<T>(null)
  const anim = useRef<Animation | null>(null)
  const last = useRef(0)
  // Back to the style, at the last x (one function for the element's life).
  const back = useRef<(() => void) | null>(null)
  if (!back.current) {
    const fn = (): void => {
      sliding.delete(fn)
      anim.current?.cancel()
      anim.current = null
      if (ref.current) ref.current.style.transform = `translateX(${last.current}px)`
    }
    back.current = fn
  }
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    last.current = x === null ? SLIDE_OFF : pixelX(x)
    // (No scrub, or no animations here, as in a test's document: the style.)
    if (!scrub || typeof el.animate !== 'function') {
      back.current?.()
      return
    }
    if (!anim.current || (anim.current.effect as KeyframeEffect | null)?.target !== el) {
      anim.current?.cancel()
      anim.current = el.animate([{ transform: `translateX(${-SLIDE_R}px)` }, { transform: `translateX(${SLIDE_R}px)` }], { duration: 2 * SLIDE_R, fill: 'both', easing: 'linear' })
      anim.current.pause()
    }
    anim.current.currentTime = last.current + SLIDE_R
    if (back.current) sliding.add(back.current)
  }, [x])
  useLayoutEffect(() => () => {
    if (back.current) sliding.delete(back.current)
    anim.current?.cancel()
    anim.current = null
  }, [])
  return ref
}

/** The volume keys a clip shows on the timeline: those on the clip, on any
 *  clip whose sound is its own — an audio clip, or a video with sound not
 *  extracted (phase Ç2c.2, report K27: a video's own volume keys were heard
 *  but had no mark). */
export function volumeKeyMarks(clip: Clip, track: { kind: string }, asset: Pick<Asset, 'hasAudio'> | undefined): NonNullable<Clip['volumeKeyframes']> {
  const own = track.kind === 'audio' || (!!asset?.hasAudio && !clip.audioExtracted)
  return own ? (clip.volumeKeyframes ?? []).filter((k) => onClip(clip, k.time)) : []
}

/** The view's step for what is put in the page as it scrolls (clip blocks,
 *  the cuts' transition buttons): small enough that a step brings in a few
 *  parts, not a screenful at once (a screenful was a slow frame every half
 *  screen of scrolling). */
export const VIEW_STEP_PX = 160

/** The window (timeline pixels, from..to) whose parts are in the page: a
 *  screen to either side of wherever the view is inside its step. */
export function nearWindow(step: number, width: number): { lo: number; hi: number } {
  const left = step * VIEW_STEP_PX
  return { lo: left - width - TIMELINE_HEADER_W, hi: left + VIEW_STEP_PX + 2 * width }
}

/** The film's length (seconds), worked out once per project (a project is
 *  never changed in place): what the timeline's frame watches instead of the
 *  whole project (phase 3c.T). */
const filmLengths = new WeakMap<Project, number>()
export function filmLength(project: Project): number {
  let d = filmLengths.get(project)
  if (d === undefined) {
    d = projectDuration(project)
    filmLengths.set(project, d)
  }
  return d
}

/** The same ids in the same order (a selection that did not change). */
export const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i])

/**
 * What a clip carries that moves it, beyond the position keys drawn as
 * diamonds (clip-kf) and the volume points (vol-kf): DENEME-1, item 4. The
 * picture moves (enter, walk, hop… of motion/picture-moves.ts) as spans, and
 * the keyframes of the effect amounts and of the mask as marks, one per time
 * (clip-local seconds, on the clip only; those off it are keysOffClip's).
 */
export function motionMarks(clip: Clip): {
  moves: { id: string; kind: string; from: number; to: number }[]
  keys: { time: number; what: 'fx' | 'mask' }[]
} {
  const moves = (clip.moves?.actions ?? [])
    .map((a) => ({ id: a.id, kind: a.kind, from: Math.max(0, a.time), to: Math.min(clip.duration, a.time + Math.max(0, a.dur)) }))
    .filter((m) => m.to > m.from)
  const seen = new Map<string, { time: number; what: 'fx' | 'mask' }>()
  const add = (time: number, what: 'fx' | 'mask'): void => {
    if (!onClip(clip, time)) return
    const key = time.toFixed(3)
    if (!seen.has(key)) seen.set(key, { time: Math.min(clip.duration, Math.max(0, time)), what })
  }
  for (const list of Object.values(clip.fxKeys ?? {})) for (const k of list ?? []) add(k.time, 'fx')
  for (const k of clip.mask?.keyframes ?? []) add(k.time, 'mask')
  return { moves, keys: [...seen.values()].sort((a, b) => a.time - b.time) }
}

/**
 * The clips of a track that butt against a neighbour (DENEME-1, item 3): on
 * that side their block runs to the edge with a square corner, so two clips
 * that touch read as one strip with a thin seam, and any lane showing between
 * two clips is a real gap of time. Overlapping clips count as touching.
 */
export function joinedEdges(clips: readonly Clip[]): { left: Set<string>; right: Set<string> } {
  const left = new Set<string>()
  const right = new Set<string>()
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  let reach = -Infinity
  let reachId = ''
  for (const c of sorted) {
    if (reachId && c.start <= reach + JOIN_EPS) {
      left.add(c.id)
      right.add(reachId)
    }
    const end = c.start + c.duration
    if (end > reach) {
      reach = end
      reachId = c.id
    }
  }
  return { left, right }
}
/**
 * The clips of a lane whose name pill rests (okunur, 23 November): a piece
 * whose neighbour before it on the lane is a piece of the same source (a run
 * cut from one file). The first of such a run, and a piece after another
 * source, keep their name. Worked out when the lane's clips change, never
 * per frame (TrackClips memoises it on the clip list).
 */
export function quietNames(clips: readonly Clip[]): Set<string> {
  const quiet = new Set<string>()
  const sorted = [...clips].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i]
    const prev = sorted[i - 1]
    if (c.assetId && prev.assetId === c.assetId) quiet.add(c.id)
  }
  return quiet
}
/** Two clips this close (seconds) touch: a gap shorter than this is no gap. */
const JOIN_EPS = 1e-4
