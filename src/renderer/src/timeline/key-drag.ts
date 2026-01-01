// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Moving a clip's keys by id (phase Ç2c.2, decision 2; report K3, K24, D5).
//
// A drag takes the keys of the diamond under the pointer at the press — by
// id — and every step of it is worked out from the clip's keys as the drag
// began (`base`), so:
// - only those keys move (it used to move "whatever is at the current time",
//   so a diamond dragged onto another picked it up and the two could never be
//   parted again);
// - a key dropped on another key of its channel (the same frame) takes its
//   place; one the drag only passes over is back where it was;
// - two keys of one channel never share an instant;
// - a ripple drag (Ctrl) moves every key on the clip from the diamond on, by
//   one delta held so that none leaves the clip (it used to push each key
//   onto the end, where they piled up) and so that only the grabbed keys
//   land on a key (the others stop a frame short of one: Ç2c patch, item 1);
// - an Alt-drag leaves the keys where they were and moves copies of them
//   (ids given at the press), easing and all: one gesture, one undo step; a
//   copy never takes an original's place (Ç2c patch, item 2).
// Keys off the clip (an edit keeps them, phase Ç2c.1) are never taken. Pure.

import type { ClipChannels, KfChannel, PropKeyframe } from '../types'
import { KF_CHANNELS } from '../types'
import { gridLocal, keyMergeWindow, sameFrame } from './key-grid'

/** One key of a clip's channels. */
export interface KeyRef {
  ch: KfChannel
  id: string
}

export interface KeyDrag {
  /** The clip's channels as the drag began. */
  base: ClipChannels
  /** The keys the press took (a diamond's). */
  keys: KeyRef[]
  /** Their time at the press (clip-local). */
  from: number
  /** Every key on the clip from `from` on moves with them (Ctrl). */
  ripple?: boolean
  /** Alt: the keys stay; copies of them, with these ids (by the id they are
   *  a copy of) and this set id, move instead. */
  copies?: { ids: Record<string, string>; group?: string }
}

/** A key this close outside the clip's ends is on it (as the diamonds). */
const ON_CLIP = 1e-3

/**
 * The channels after the drag's keys went to clip-local time `to` (put on
 * the frame grid of the timeline; `span` is the clip's place).
 */
export function dragKeys(drag: KeyDrag, to: number, span: { start: number; duration: number }, fps: number): ClipChannels {
  const onClip = (t: number): boolean => t >= -ON_CLIP && t <= span.duration + ON_CLIP
  const key = (ch: KfChannel, id: string): string => `${ch}\u0000${id}`
  const taken = new Set(drag.keys.map((r) => key(r.ch, r.id)))
  const moving = new Set<string>()
  for (const ch of KF_CHANNELS) {
    for (const k of drag.base[ch] ?? []) {
      if (!onClip(k.time)) continue
      if (taken.has(key(ch, k.id)) || (drag.ripple && k.time >= drag.from - ON_CLIP)) moving.add(key(ch, k.id))
    }
  }
  // One delta for all, held so that every moving key stays on the clip.
  const goal = Math.min(span.duration, Math.max(0, gridLocal(to, span.start, fps)))
  let delta = goal - drag.from
  let lo = -Infinity
  let hi = Infinity
  for (const ch of KF_CHANNELS) {
    for (const k of drag.base[ch] ?? []) {
      if (!moving.has(key(ch, k.id))) continue
      lo = Math.max(lo, -k.time)
      hi = Math.min(hi, span.duration - k.time)
    }
  }
  if (moving.size === 0) return structuredClone(drag.base)
  delta = Math.min(Math.max(delta, Math.min(0, lo)), Math.max(0, hi))
  // Only a grabbed key may take the place of a key it lands on, and never of
  // an original an Alt-drag copies (Ç2c patch, items 1 and 2): while any
  // other moving key (or copy) would land on a key, the delta steps back a
  // frame towards the press; at the press nothing moves.
  const win = keyMergeWindow(fps)
  // Per channel: the moving keys, and the keys they may not land on (sorted):
  // `all` for a carried key, `originals` (an Alt-drag's) for a grabbed one.
  const lanes = KF_CHANNELS.map((ch) => {
    const list = drag.base[ch] ?? []
    const isMoving = (k: PropKeyframe): boolean => moving.has(key(ch, k.id))
    const sorted = (ks: PropKeyframe[]): PropKeyframe[] => [...ks].sort((a, b) => a.time - b.time)
    return {
      movers: list.filter(isMoving).map((k) => ({ k, grabbed: taken.has(key(ch, k.id)) })),
      // Without copies the other moving keys move along: never in the way.
      all: sorted(drag.copies ? list : list.filter((k) => !isMoving(k))),
      originals: sorted(drag.copies ? list.filter(isMoving) : [])
    }
  })
  /** Whether a key of `ks` other than `self` lies on the frame of `t`. */
  const hits = (ks: PropKeyframe[], t: number, self: PropKeyframe): boolean => {
    let a = 0
    let b = ks.length
    while (a < b) {
      const mid = (a + b) >> 1
      if (ks[mid].time <= t - win) a = mid + 1
      else b = mid
    }
    for (let i = a; i < ks.length && ks[i].time < t + win; i++) if (ks[i] !== self) return true
    return false
  }
  const blocked = (d: number): boolean =>
    lanes.some((l) => l.movers.some(({ k, grabbed }) => hits(grabbed ? l.originals : l.all, k.time + d, k)))
  const step = 1 / (Number.isFinite(fps) && fps > 0 ? fps : 30)
  const sign = Math.sign(delta)
  while (delta !== 0 && blocked(delta)) {
    const next = delta - sign * step
    delta = sign * next > 0 ? next : 0
  }
  if (delta === 0) return structuredClone(drag.base)
  // An Alt copy dropped back where it came from is no copy.
  const copying = !!drag.copies && Math.abs(delta) >= 0.5 / Math.max(1, fps)

  const out: ClipChannels = {}
  for (const ch of KF_CHANNELS) {
    const list = drag.base[ch]
    if (!list) continue
    const moved: PropKeyframe[] = []
    const still: PropKeyframe[] = []
    for (const k of list) {
      if (!moving.has(key(ch, k.id))) still.push({ ...k })
      else if (drag.copies) {
        still.push({ ...k })
        if (copying) {
          const copy: PropKeyframe = { ...k, id: drag.copies.ids[k.id] ?? `${k.id}-copy`, time: k.time + delta }
          if (drag.copies.group) copy.group = drag.copies.group
          else delete copy.group
          moved.push(copy)
        }
      } else moved.push({ ...k, time: k.time + delta })
    }
    // A key the moved ones land on (the same frame) gives way to them; only a
    // grabbed key's landing frame can hold one (the delta above), and never
    // an original of a copy.
    const kept = still.filter((k) => (drag.copies && moving.has(key(ch, k.id))) || !moved.some((m) => sameFrame(m.time, k.time, fps)))
    const next = [...kept, ...moved].sort((a, b) => a.time - b.time)
    if (next.length > 0) out[ch] = next
  }
  return out
}
