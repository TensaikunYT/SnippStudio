// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decision 6 (report D2, K25): one interpolation module. Every
// evaluator (a clip's channels and opacity, its mask, its volume, a
// caption's motion, a tracker, the Shorts window, the map camera) now reads
// its keys through playback/keys.ts. What they gave before is kept: each is
// compared, on random key lists, with a copy of the evaluator as it was
// (3b6c1cf), to the last bit. New: a caption's keys are read in time order
// whatever order the list has (K25), and a key may `hold` (a step).
import assert from 'node:assert/strict'
import test from 'node:test'
import { automationGainAt } from '../renderer/src/audio/envelope'
import { captionMotionAt, clipOpacityAt, clipTransformAt, maskGeomAt, shortsWindowAt } from '../renderer/src/playback/pose'
import { trackerPosAt } from '../renderer/src/playback/draw/core'
import { atlasCamera } from '../renderer/src/templates/layout/map'
import { defaultProject, type Caption, type Clip, type MaskKeyframe, type PropKeyframe } from '../renderer/src/types'

// -- the evaluators as they were (3b6c1cf), copied ------------------------------------
const smooth = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
const easeKf = (p: number, easing?: string): number =>
  easing === 'linear' ? p : easing === 'easeIn' ? p * p : easing === 'easeOut' ? p * (2 - p) : smooth(p)
function oldChannel(kfs: PropKeyframe[] | undefined, base: number, localTime: number): number {
  if (!kfs || kfs.length === 0) return base
  const s = kfs.length > 1 ? [...kfs].sort((a, b) => a.time - b.time) : kfs
  if (localTime <= s[0].time) return s[0].value
  const last = s[s.length - 1]
  if (localTime >= last.time) return last.value
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]
    const b = s[i + 1]
    if (localTime >= a.time && localTime <= b.time) {
      const t = easeKf((localTime - a.time) / Math.max(1e-6, b.time - a.time), b.easing)
      return a.value + (b.value - a.value) * t
    }
  }
  return last.value
}
function oldMask(kfs: MaskKeyframe[], localTime: number): number[] {
  const sorted = [...kfs].sort((a, b) => a.time - b.time)
  const flat = (g: MaskKeyframe | { cx: number; cy: number; w: number; h: number; rot?: number }) => [g.cx, g.cy, g.w, g.h, g.rot ?? 0]
  if (localTime <= sorted[0].time) return flat(sorted[0])
  const last = sorted[sorted.length - 1]
  if (localTime >= last.time) return flat(last)
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (localTime >= a.time && localTime <= b.time) {
      const t = smooth((localTime - a.time) / Math.max(1e-6, b.time - a.time))
      const lerp = (x: number, y: number) => x + (y - x) * t
      return [lerp(a.cx, b.cx), lerp(a.cy, b.cy), lerp(a.w, b.w), lerp(a.h, b.h), lerp(a.rot ?? 0, b.rot ?? 0)]
    }
  }
  return flat(last)
}
type CK = NonNullable<Caption['kfs']>[number]
function oldCaption(kfs: CK[], local: number): number[] {
  const flat = (k: CK) => [k.x, k.y, k.scale, k.rot, k.opacity]
  if (kfs.length === 1) return flat(kfs[0])
  if (local <= kfs[0].time) return flat(kfs[0])
  const last = kfs[kfs.length - 1]
  if (local >= last.time) return flat(last)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (local < a.time || local > b.time) continue
    const span = b.time - a.time
    const t = span <= 1e-6 ? 1 : (local - a.time) / span
    const e = t * t * (3 - 2 * t)
    return [a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.scale + (b.scale - a.scale) * e, a.rot + (b.rot - a.rot) * e, a.opacity + (b.opacity - a.opacity) * e]
  }
  return flat(last)
}
function oldTracker(kfs: { time: number; x: number; y: number }[], time: number): number[] {
  if (time <= kfs[0].time) return [kfs[0].x, kfs[0].y]
  const last = kfs[kfs.length - 1]
  if (time >= last.time) return [last.x, last.y]
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (time >= a.time && time <= b.time) {
      const t = smooth((time - a.time) / Math.max(1e-6, b.time - a.time))
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t]
    }
  }
  return [last.x, last.y]
}
function oldVolume(keyframes: { time: number; value: number }[], base: number, local: number): number {
  let value = base
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  if (local <= sorted[0].time) value = sorted[0].value
  else if (local >= sorted[sorted.length - 1].time) value = sorted[sorted.length - 1].value
  else {
    for (let i = 0; i < sorted.length - 1; i++) {
      const left = sorted[i]
      const right = sorted[i + 1]
      if (local < left.time || local > right.time) continue
      const mix = (local - left.time) / Math.max(1e-6, right.time - left.time)
      value = left.value + (right.value - left.value) * mix
      break
    }
  }
  return Math.max(0, Math.min(2, value))
}
const glide = (u: number): number => {
  const x = u < 0 ? 0 : u > 1 ? 1 : u
  return x * x * x * (x * (x * 6 - 15) + 10)
}
function oldAtlas(keys: { t: number; lon: number; lat: number; z: number }[], t: number): number[] {
  if (t <= keys[0].t) return [keys[0].lon, keys[0].lat, keys[0].z]
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]
    const c = keys[i + 1]
    if (t > c.t) continue
    const u = glide((t - a.t) / Math.max(1e-3, c.t - a.t))
    const dist = Math.hypot((c.lon - a.lon) * Math.cos((((a.lat + c.lat) / 2) * Math.PI) / 180), c.lat - a.lat)
    const dip = Math.min(1.4, dist / 25) * Math.sin(Math.PI * u)
    const lz = Math.log(a.z) + (Math.log(c.z) - Math.log(a.z)) * u - dip
    return [a.lon + (c.lon - a.lon) * u, a.lat + (c.lat - a.lat) * u, Math.max(0.9, Math.exp(lz))]
  }
  const last = keys[keys.length - 1]
  return [last.lon, last.lat, last.z]
}

// -- random lists ---------------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = s
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
const EASINGS = [undefined, 'smooth', 'linear', 'easeIn', 'easeOut'] as const
/** Sorted times, 1–6 of them, some apart by a hair, some on whole seconds. */
function times(r: () => number): number[] {
  const n = 1 + Math.floor(r() * 6)
  const out: number[] = []
  let t = r() < 0.3 ? 0 : -1 + r() * 3
  for (let i = 0; i < n; i++) {
    out.push(r() < 0.3 ? Math.round(t) : t)
    t += 0.01 + r() * 3
  }
  return out.sort((a, b) => a - b)
}
/** Where to read: the keys' own times, just around them, the middle of
 *  segments, outside. */
function probes(r: () => number, ts: number[]): number[] {
  const out = [ts[0] - 1, ts[ts.length - 1] + 1]
  for (const t of ts) out.push(t, t - 1e-7, t + 1e-7)
  for (let i = 0; i < 12; i++) out.push(ts[0] - 0.5 + r() * (ts[ts.length - 1] - ts[0] + 1))
  return out
}
const same = (a: number[], b: number[], what: string): void => {
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) assert.fail(`${what}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
}
const baseClip = (extra: Partial<Clip>): Clip =>
  ({ id: 'c', assetId: 'a', trackId: 'V1', start: 3, inPoint: 0, duration: 10, transform: { x: 100, y: 200, scale: 1, rotation: 0 }, volume: 1, ...extra }) as Clip

test('decision 6: every evaluator gives what it gave before, to the last bit (random key lists)', () => {
  let checked = 0
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed)
    // A clip's channels and opacity.
    const ch = (): PropKeyframe[] => times(r).map((t, i) => ({ id: `k${i}`, time: t, value: -500 + r() * 1000, easing: EASINGS[Math.floor(r() * EASINGS.length)] }))
    const channels = { x: ch(), y: ch(), scale: ch(), rotation: ch(), opacity: ch() }
    const clip = baseClip({ channels, opacity: 0.7 })
    for (const t of probes(r, channels.x.map((k) => k.time).concat(channels.opacity.map((k) => k.time)))) {
      const tr = clipTransformAt(clip, t)
      same([tr.x, tr.y, tr.scale, tr.rotation, clipOpacityAt(clip, t)], [oldChannel(channels.x, 100, t), oldChannel(channels.y, 200, t), oldChannel(channels.scale, 1, t), oldChannel(channels.rotation, 0, t), oldChannel(channels.opacity, 0.7, t)], `channels seed ${seed} t ${t}`)
      checked++
    }
    // A mask.
    const mts = times(r)
    const mk: MaskKeyframe[] = mts.map((t, i) => ({ id: `m${i}`, time: t, cx: r() * 400, cy: r() * 300, w: 10 + r() * 100, h: 10 + r() * 100, ...(r() < 0.5 ? { rot: r() * 3 } : {}) }))
    const mask = { enabled: true, shape: 'ellipse', feather: 0, cx: 0, cy: 0, w: 1, h: 1, keyframes: mk } as NonNullable<Clip['mask']>
    for (const t of probes(r, mts)) {
      const g = maskGeomAt(mask, t)
      same([g.cx, g.cy, g.w, g.h, g.rot ?? 0], oldMask(mk, t), `mask seed ${seed} t ${t}`)
      checked++
    }
    // A caption's motion (sorted, segments longer than 1e-6 s as every writer leaves them).
    const cts = times(r)
    const kfs: CK[] = cts.map((t, i) => ({ id: `c${i}`, time: t, x: r() * 100, y: r() * 100, scale: 0.5 + r(), rot: r(), opacity: r() }))
    const cap = { id: 'cap', start: 0, end: 20, text: 'a', kfs } as Caption
    for (const t of probes(r, cts)) {
      const m = captionMotionAt(cap, t)
      same([m.x, m.y, m.scale, m.rot, m.opacity], oldCaption(kfs, t), `caption seed ${seed} t ${t}`)
      checked++
    }
    // A tracker.
    const tts = times(r)
    const tk = tts.map((t, i) => ({ id: `t${i}`, time: t, x: r() * 1000, y: r() * 1000 }))
    for (const t of probes(r, tts)) {
      const pos = trackerPosAt(tk, t)
      same([pos.x, pos.y], oldTracker(tk, t), `tracker seed ${seed} t ${t}`)
      checked++
    }
    // The volume.
    const vts = times(r)
    const vk = vts.map((t, i) => ({ id: `v${i}`, time: t, value: r() * 2.4 }))
    const vclip = baseClip({ volumeKeyframes: vk, volume: 0.8 })
    for (const t of probes(r, vts)) {
      same([automationGainAt(vclip, t)], [oldVolume(vk, 0.8, t)], `volume seed ${seed} t ${t}`)
      checked++
    }
    // The map camera (block seconds, its keys as setAtlasKey keeps them: in order).
    const ats = times(r).map((t) => Math.max(0, t))
    const cams = ats.map((t) => ({ t, lon: -180 + r() * 360, lat: -80 + r() * 160, z: 0.9 + r() * 30 }))
    for (const t of probes(r, ats)) {
      const c = atlasCamera({ cams }, t)
      same([c.lon, c.lat, c.z], oldAtlas(cams, t), `map seed ${seed} t ${t}`)
      checked++
    }
  }
  assert.ok(checked > 40000, `${checked} readings`)
})

test('decision 6: the Shorts window gives what it gave before', () => {
  const r = rng(7)
  for (let n = 0; n < 200; n++) {
    const p = defaultProject()
    const ts = times(r).map((t) => t + 2)
    p.shorts = { baseX: 500, keyframes: ts.map((t, i) => ({ id: `s${i}`, time: t, x: 300 + r() * 1300 })) }
    const w = (p.settings.height * 9) / 16
    for (const t of probes(r, ts)) {
      const sorted = p.shorts.keyframes
      const raw = oldTracker(sorted.map((k) => ({ time: k.time, x: k.x, y: 0 })), t)[0]
      same([shortsWindowAt(p, t).cx], [Math.min(p.settings.width - w / 2, Math.max(w / 2, raw))], `shorts ${n} t ${t}`)
    }
  }
})

test('K25: a caption whose keys are out of order is read in time order', () => {
  const cap = {
    id: 'cap',
    start: 0,
    end: 10,
    text: 'a',
    kfs: [
      { id: 'b', time: 2, x: 300, y: 0, scale: 1, rot: 0, opacity: 1 },
      { id: 'a', time: 0, x: 0, y: 0, scale: 1, rot: 0, opacity: 1 }
    ]
  } as Caption
  // Before: the t=2 pose held until 2 s, then the t=0 pose.
  assert.equal(captionMotionAt(cap, 0).x, 0)
  assert.equal(captionMotionAt(cap, 1).x, 150)
  assert.equal(captionMotionAt(cap, 3).x, 300)
})

test('decision 6: a key may hold (a step into it); the four easings stay as they were', () => {
  const clip = baseClip({
    channels: {
      x: [
        { id: 'a', time: 1, value: 0 },
        { id: 'b', time: 3, value: 100, easing: 'hold' as never },
        { id: 'c', time: 5, value: 200, easing: 'linear' }
      ]
    }
  })
  const x = (t: number): number => clipTransformAt(clip, t).x
  assert.equal(x(1), 0)
  assert.equal(x(2), 0, 'held at the earlier key until the step')
  assert.equal(x(3 - 1e-9), 0)
  assert.equal(x(3), 100, 'the step lands at its key')
  assert.equal(x(4), 150, 'the next segment eases as its own key says')
  assert.equal(x(6), 200)
})
