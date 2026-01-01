// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One way to read a list of keys at a moment (phase Ç2c.1, decision 6; report
// D2). A clip's channels, its mask, its volume (and the ducking's envelope
// under it), a caption's motion, a tracker, the Shorts window and a map
// template's camera were read by eight evaluators of their own, which
// differed in easing, in sorting and in how they met two keys at one time.
// Every one of them is now `evalKeys` with its own blend of two keys.
//
// The rule, for all: before the first key its value holds, after the last
// key the last one's; between two keys the segment is eased by the LATER
// key's easing ("into this key"). The list need not be in time order (it is
// read sorted; a stable sort, so keys at one time keep their order). Pure.

/** How a value travels into a key. `hold` is a step: the earlier key's
 *  value stays until this key's time, then this key's value. */
export type KeyEasing = 'smooth' | 'linear' | 'easeIn' | 'easeOut' | 'hold'
export const KEY_EASINGS: readonly KeyEasing[] = ['smooth', 'linear', 'easeIn', 'easeOut', 'hold']

/** The smoothstep every unnamed easing is. */
export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** A segment's progress `p` (0..1) eased into a key of `easing`. */
export function easeKey(p: number, easing?: string): number {
  return easing === 'linear'
    ? p
    : easing === 'easeIn'
      ? p * p
      : easing === 'easeOut'
        ? p * (2 - p)
        : easing === 'hold'
          ? p >= 1
            ? 1
            : 0
          : smoothstep(p)
}

export interface KeyOpts<K, V> {
  /** A key's time (default `k.time`). */
  time?: (k: K) => number
  /** The segment's eased progress into key `into` (default: its `easing`). */
  ease?: (p: number, into: K) => number
  /** The shortest span a segment is divided by (default 1e-6 s). */
  minSpan?: number
  /** The value held before the first and after the last key (default
   *  `blend(k, k, 0)`). */
  hold?: (k: K) => V
  /** A time exactly on the last key is read in the segment into it, not
   *  held (the map camera's way; default false). */
  lastInSegment?: boolean
}
const timeOf = (k: unknown): number => (k as { time: number }).time

/** The keys in time order: the list itself when it already is. */
export function sortedKeys<K>(keys: readonly K[], time: (k: K) => number = timeOf): readonly K[] {
  for (let i = 1; i < keys.length; i++) if (time(keys[i - 1]) > time(keys[i])) return [...keys].sort((a, b) => time(a) - time(b))
  return keys
}

/**
 * The value of `keys` at `t`: `blend(a, b, f)` of the two keys around it,
 * `f` the eased progress from a to b; undefined for no keys.
 */
export function evalKeys<K, V>(
  keys: readonly K[] | undefined,
  t: number,
  blend: (a: K, b: K, f: number) => V,
  opts: KeyOpts<K, V> = {}
): V | undefined {
  if (!keys || keys.length === 0) return undefined
  const time = opts.time ?? timeOf
  const hold = opts.hold ?? ((k: K) => blend(k, k, 0))
  const s = sortedKeys(keys, time)
  const first = s[0]
  if (t <= time(first)) return hold(first)
  const last = s[s.length - 1]
  if (opts.lastInSegment ? t > time(last) : t >= time(last)) return hold(last)
  // The first key at or after t (t lies after the first key and at or
  // before the last one): the segment is the one into it.
  let lo = 1
  let hi = s.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (time(s[mid]) >= t) hi = mid
    else lo = mid + 1
  }
  const a = s[lo - 1]
  const b = s[lo]
  const p = (t - time(a)) / Math.max(opts.minSpan ?? 1e-6, time(b) - time(a))
  const f = opts.ease ? opts.ease(p, b) : easeKey(p, (b as { easing?: string }).easing)
  return blend(a, b, f)
}

/** A plain number channel: `a.value → b.value`. */
export function evalNumberKeys<K extends { time: number; value: number; easing?: string }>(
  keys: readonly K[] | undefined,
  t: number,
  opts: { ease?: (p: number, into: K) => number } = {}
): number | undefined {
  return evalKeys(keys, t, (a, b, f) => a.value + (b.value - a.value) * f, { ...opts, hold: (k) => k.value })
}
