// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Clip, KfChannel, PropKeyframe } from '../types'
import { channelKfs, KF_CHANNELS, uid } from '../types'
import { keyOnFrame } from '../timeline/key-grid'
import { evalNumberKeys } from '../playback/keys'

/**
 * What "the way this clip moves" means, as a copyable value: its property
 * keyframes, its entrance/exit animation and its idle drift.
 *
 * This lives apart from the store on purpose. Copy-a-clip's-keyframes and
 * paste-them-onto-another is a feature that has been reported broken more than
 * once, and every time the answer was somewhere in the shape of the data — a
 * project saved in the older format kept its keyframes in `clip.keyframes`, so
 * reading `clip.channels` directly copied nothing and pasting that nothing
 * erased the target. Out here it is a pure function of a clip, which means it
 * can be tested, and a test is the only thing that keeps a fix fixed.
 */
export interface AnimationSnapshot {
  channels?: NonNullable<Clip['channels']>
  /** The length of the clip it was copied from (a paste may stretch the
   *  key times to the target's: phase Ç2c.2, report K20). */
  duration?: number
  anim?: Clip['anim']
  idle?: Clip['idle']
}

/** Reads a clip's animation. Returns null when there is nothing to copy —
 *  an empty snapshot would ERASE whatever it was pasted onto. */
export function snapshotAnimation(clip: Clip): AnimationSnapshot | null {
  const channels: NonNullable<Clip['channels']> = {}
  let any = false
  for (const ch of KF_CHANNELS) {
    // channelKfs, not clip.channels: this is the accessor the renderer and the
    // timeline diamonds read, so it sees exactly the keyframes you can see.
    const kfs = channelKfs(clip, ch)
    if (kfs && kfs.length > 0) {
      channels[ch] = shownKeys(clip, kfs)
      any = true
    }
  }
  if (!any && !clip.anim && !clip.idle) return null
  return {
    channels: any ? channels : undefined,
    duration: clip.duration,
    anim: clip.anim ? { ...clip.anim } : undefined,
    idle: clip.idle ? { ...clip.idle } : undefined
  }
}

/** A key this close outside the clip's ends is on it (as the diamonds). */
const ON_CLIP = 1e-3

/**
 * The keys of one channel as the clip shows them (Ç2c patch, item 9): every
 * piece of a cut clip carries its whole list (phase Ç2c.1), so a copy of all
 * of it brought the motion of the part cut away onto the clip it was pasted
 * on. The keys on the clip, and a key at each edge that has keys beyond it,
 * with the value drawn there (the right one with the easing of the key it
 * stands for).
 */
function shownKeys(clip: Clip, kfs: readonly PropKeyframe[]): PropKeyframe[] {
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  const end = clip.duration
  const out = sorted.filter((k) => k.time >= -ON_CLIP && k.time <= end + ON_CLIP).map((k) => ({ ...k }))
  const at = (t: number): number => evalNumberKeys(sorted, t) ?? 0
  const next = sorted.find((k) => k.time > end + ON_CLIP)
  if (sorted.some((k) => k.time < -ON_CLIP) && !out.some((k) => Math.abs(k.time) <= ON_CLIP)) out.unshift({ id: uid(), time: 0, value: at(0) })
  if (next && !out.some((k) => Math.abs(k.time - end) <= ON_CLIP)) out.push({ id: uid(), time: end, value: at(end), ...(next.easing ? { easing: next.easing } : {}) })
  return out
}

/**
 * Writes a snapshot onto a clip, in place. Keyframe times are clip-local
 * seconds: they land at the same seconds from the clip's start — or, with
 * `scaled`, stretched to the target's length, so the whole move plays on a
 * clip of another length (phase Ç2c.2, report K20: the comment promised
 * relative positions and the code copied the seconds; Premiere's "Scale
 * Attribute Times").
 *
 * `newId` is injectable so a test can pin the ids; the app passes uid.
 */
export function applyAnimation(clip: Clip, snap: AnimationSnapshot, newId: () => string = uid, opts: { scaled?: boolean } = {}): void {
  const k = opts.scaled && snap.duration && snap.duration > 0 ? clip.duration / snap.duration : 1
  if (snap.channels) {
    const next: NonNullable<Clip['channels']> = {}
    for (const ch of Object.keys(snap.channels) as KfChannel[]) {
      const kfs = snap.channels[ch]
      // Fresh ids, so retiming one clip's keyframes never moves the other's.
      if (kfs) next[ch] = kfs.map((key: PropKeyframe) => ({ ...key, id: newId(), time: key.time * k }))
    }
    clip.channels = next
  } else delete clip.channels
  if (snap.anim) clip.anim = { ...snap.anim }
  else delete clip.anim
  if (snap.idle) clip.idle = { ...snap.idle }
  else delete clip.idle
}

/**
 * ONE instant of animation lifted off a clip: what every keyframed channel was
 * worth at that moment.
 *
 * This is not the same thing as an AnimationSnapshot, and conflating the two is
 * why copy/paste kept disappointing. A snapshot is "make this clip move like
 * that one" — the whole animation, replacing whatever was there. A stamp is
 * "put THAT pose here": you copy one diamond and paste it wherever the playhead
 * is, on this clip or another, and the keyframes it had are added at that
 * instant without touching anything else the clip was already doing.
 */
export interface KeyframeStamp {
  values: Partial<Record<KfChannel, number>>
  /** Clip-local time it was read from — only used to label the menu. */
  fromTime: number
}

/**
 * Writes one channel keyframe, replacing the one already on the same frame
 * (half a frame of `fps` either side: timeline/key-grid.ts, phase Ç2c.2,
 * decision 1; it was a fixed 0.05 s, so at 30 fps a key one frame from
 * another overwrote it). The caller puts `time` on the frame grid.
 *
 * `group`: the "Keyframe all" set the key belongs to (decision 2); a key
 * written on a frame where another channel already has a key of a set joins
 * that set, so one instant stays one diamond.
 */
export function upsertKeyframe(
  clip: Clip,
  ch: KfChannel,
  time: number,
  value: number,
  opts: { fps: number; newId?: () => string; group?: string }
): void {
  const group = opts.group ?? groupOnFrame(clip, time, opts.fps)
  clip.channels = clip.channels ?? {}
  const kfs = (clip.channels[ch] = clip.channels[ch] ?? [])
  const near = keyOnFrame(kfs, time, opts.fps)
  if (near) {
    near.value = value
    if (opts.group) near.group = opts.group
  } else {
    kfs.push({ id: (opts.newId ?? uid)(), time, value, ...(group ? { group } : {}) })
    kfs.sort((a, b) => a.time - b.time)
  }
}

/** The "Keyframe all" set some channel has a key of on the frame of `time`. */
function groupOnFrame(clip: Clip, time: number, fps: number): string | undefined {
  for (const ch of KF_CHANNELS) {
    const g = keyOnFrame(clip.channels?.[ch], time, fps)?.group
    if (g) return g
  }
  return undefined
}

/** Reads the group of keyframes on the frame of `localTime`, or null when
 *  there is none. */
export function readKeyframeStamp(clip: Clip, localTime: number, fps: number): KeyframeStamp | null {
  const values: Partial<Record<KfChannel, number>> = {}
  let found = false
  for (const ch of KF_CHANNELS) {
    const k = keyOnFrame(channelKfs(clip, ch), localTime, fps)
    if (k) {
      values[ch] = k.value
      found = true
    }
  }
  return found ? { values, fromTime: localTime } : null
}

/**
 * Stamps the copied pose onto a clip at `localTime`. Adds to the clip's
 * animation rather than replacing it: every other keyframe stays exactly where
 * it was, and a channel the stamp doesn't mention is not touched at all.
 */
export function applyKeyframeStamp(
  clip: Clip,
  localTime: number,
  stamp: KeyframeStamp,
  fps: number,
  newId: () => string = uid
): void {
  for (const ch of KF_CHANNELS) {
    const v = stamp.values[ch]
    if (typeof v === 'number') upsertKeyframe(clip, ch, localTime, v, { fps, newId })
  }
}
