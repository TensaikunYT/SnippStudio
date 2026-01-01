// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2c.1, decisions 1 and 2 (report K1, K2, K4, K9, K15, K17): no edit
// drops or invents a keyframe; an edit only moves the window a clip shows of
// its keys. The measure: for every channel, before and after the edit, the
// same value at the same frame of the content —
//   clipTransformAt(after, u) == clipTransformAt(before, from + u)   (1e-9)
// over random key sets × easings × windows × {split, head trim (in and
// out), tail trim and back, a ripple cut, the silence cut, keep-range}, for
// clips played forwards, backwards and at twice the speed; the opacity, the
// mask and the volume with them. The probes are spread over each piece
// (the middle of its curves, not only its edges).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { automationGainAt } from '../renderer/src/audio/envelope'
import { commandByName, runCommand } from '../renderer/src/commands'
import { clipOpacityAt, clipTransformAt, maskGeomAt } from '../renderer/src/playback/pose'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, KF_CHANNELS, type Clip, type KfChannel, type Project, type PropKeyframe } from '../renderer/src/types'

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
const EASINGS = [undefined, 'smooth', 'linear', 'easeIn', 'easeOut', 'hold'] as const

const S = 4 // the clip's start
const D = 12 // its length
const IN = 30 // its in point (room to reveal on both sides)

/** Times from before the clip to after it, at least 0.15 s apart. */
function keyTimes(r: () => number, lo: number, hi: number): number[] {
  const out: number[] = []
  let t = lo + r() * 1.5
  while (t < hi && out.length < 7) {
    out.push(t)
    t += 0.15 + r() * 3
  }
  return out
}

function makeProject(r: () => number, kind: number): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: ['x'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 200, width: 1920, height: 1080, hasAudio: true } as never]
  const ch = (lo: number, hi: number, scale: number): PropKeyframe[] =>
    keyTimes(r, lo, hi).map((time, i) => ({ id: `${scale}-${i}`, time, value: (r() - 0.5) * scale, easing: EASINGS[Math.floor(r() * EASINGS.length)] as never }))
  // Some sets start off the clip (a clip already trimmed), some on it.
  const lo = r() < 0.5 ? -2 : 0
  const channels: Partial<Record<KfChannel, PropKeyframe[]>> = { x: ch(lo, D + 2, 800), y: ch(lo, D + 2, 600), scale: ch(lo, D + 2, 2), rotation: ch(lo, D + 2, 6), opacity: ch(lo, D + 2, 1) }
  for (const k of channels.opacity!) k.value += 0.5
  const maskTimes = keyTimes(r, lo, D + 2)
  p.clips.x = {
    id: 'x',
    assetId: 'vid',
    trackId: 'V1',
    start: S,
    inPoint: IN,
    duration: D,
    transform: { x: 960, y: 540, scale: 1, rotation: 0 },
    volume: 1,
    opacity: 1,
    ...(kind === 1 ? { reversed: true } : kind === 2 ? { speed: 2 } : {}),
    channels,
    volumeKeyframes: keyTimes(r, lo, D + 2).map((time, i) => ({ id: `v${i}`, time, value: r() * 2 })),
    mask: {
      enabled: true,
      shape: 'ellipse',
      feather: 0,
      cx: 0,
      cy: 0,
      w: 100,
      h: 100,
      keyframes: maskTimes.map((time, i) => ({ id: `m${i}`, time, cx: r() * 500, cy: r() * 500, w: 50 + r() * 300, h: 50 + r() * 300, rot: r() * 3 }))
    }
  } as Clip
  p.captions = []
  return p
}

/** Every value the renderer draws from a clip's keys at clip-local `u`. */
function values(c: Clip, u: number): number[] {
  const t = clipTransformAt(c, u)
  const m = maskGeomAt(c.mask!, u)
  return [t.x, t.y, t.scale, t.rotation, clipOpacityAt(c, u), automationGainAt(c, u), m.cx, m.cy, m.w, m.h, m.rot ?? 0]
}

/** Where piece `c` starts in the original clip's local time (from its media). */
function fromOf(orig: Clip, c: Clip): number {
  const sp = orig.speed ?? 1
  const media = (c.inPoint - orig.inPoint) / sp
  return orig.reversed ? orig.duration - c.duration - media : media
}

type Edit = { name: string; run: (p: Project, r: () => number) => Project }
const cmd = (p: Project, name: string, params: unknown): Project => runCommand(p, commandByName(name), params).project
const inside = (r: () => number, a: number, b: number): number => a + r() * (b - a)

const EDITS: Edit[] = [
  { name: 'split', run: (p, r) => cmd(p, 'clip.split', { clipIds: ['x'], time: inside(r, S + 0.3, S + D - 0.3) }) },
  { name: 'head trim', run: (p, r) => cmd(p, 'clip.trimHead', { clipId: 'x', edge: inside(r, S + 0.3, S + D - 0.3) }) },
  { name: 'head trim that reveals', run: (p, r) => cmd(p, 'clip.trimHead', { clipId: 'x', edge: inside(r, 0.5, S - 0.1) }) },
  {
    name: 'tail trim and back',
    run: (p, r) => {
      const d = -inside(r, 0.3, D - 0.5)
      const q = cmd(p, 'clip.trimEnd', { clipId: 'x', delta: d })
      return cmd(q, 'clip.trimEnd', { clipId: 'x', delta: -d * inside(r, 0.2, 1) })
    }
  },
  {
    name: 'ripple cut',
    run: (p, r) => {
      const a = inside(r, S + 0.3, S + D - 1)
      return cmd(p, 'timeline.cutRanges', { ranges: [[a, a + inside(r, 0.2, Math.min(3, S + D - 0.3 - a))]] })
    }
  },
  {
    name: 'silence cut',
    run: (p, r) => {
      const a = inside(r, S + 0.3, S + D - 1)
      return cmd(p, 'silence.apply', { regions: [{ clipId: 'x', start: a, end: a + inside(r, 0.2, Math.min(3, S + D - 0.3 - a)) }] })
    }
  },
  {
    name: 'keep range',
    run: (p, r) => {
      const a = inside(r, S + 0.1, S + D - 1)
      return cmd(p, 'clip.keepRange', { clipId: 'x', range: [a, inside(r, a + 0.3, S + D)] })
    }
  }
]

test('decision 2: every edit keeps the value at every frame of the content (≥ 500 random cases, 0 off)', () => {
  let cases = 0
  let readings = 0
  const off: string[] = []
  for (let seed = 1; seed <= 75; seed++) {
    for (const edit of EDITS) {
      const r = rng(seed * 31 + edit.name.length)
      const kind = seed % 3
      const before = makeProject(r, kind)
      const orig = before.clips.x
      const after = edit.run(before, r)
      cases++
      const pieces = Object.values(after.clips).filter((c) => c.trackId === 'V1')
      assert.ok(pieces.length >= 1, `${edit.name}: a piece is left`)
      for (const c of pieces) {
        const from = fromOf(orig, c)
        const us = [0, c.duration, ...Array.from({ length: 24 }, () => r() * c.duration)]
        for (const u of us) {
          const a = values(c, u)
          const b = values(orig, from + u)
          readings++
          if (a.some((v, i) => !(Math.abs(v - b[i]) <= 1e-9))) {
            off.push(`${edit.name} seed ${seed} kind ${kind} piece ${c.id} from ${from.toFixed(4)} u ${u.toFixed(4)}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
            break
          }
        }
      }
    }
  }
  assert.ok(cases >= 500, `${cases} cases`)
  assert.deepEqual(off.slice(0, 5), [], `${off.length} of ${cases} cases off (${readings} readings)`)
})

const keysOf = (c: Clip): unknown => ({
  channels: Object.fromEntries(KF_CHANNELS.filter((ch) => c.channels?.[ch]).map((ch) => [ch, c.channels![ch]!.map((k) => [k.time, k.value, k.easing])])),
  volume: c.volumeKeyframes?.map((k) => [k.time, k.value]),
  mask: c.mask?.keyframes?.map((k) => [k.time, k.cx, k.cy, k.w, k.h, k.rot])
})
const near = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 : Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => near(x, b[i])) : a && b && typeof a === 'object' && typeof b === 'object' ? Object.keys({ ...a, ...b }).every((k) => near((a as never)[k], (b as never)[k])) : a === b

test('K4: a head trim in and back out, and a tail trim and back, give the keys back as they were', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const r = rng(seed)
    const p = makeProject(r, 0)
    const orig = keysOf(p.clips.x)
    const edge = inside(r, S + 0.3, S + D - 0.3)
    const inThenOut = cmd(cmd(p, 'clip.trimHead', { clipId: 'x', edge }), 'clip.trimHead', { clipId: 'x', edge: S })
    assert.ok(near(keysOf(inThenOut.clips.x), orig), `head, seed ${seed}: ${JSON.stringify(keysOf(inThenOut.clips.x))} vs ${JSON.stringify(orig)}`)
    const d = inside(r, 0.3, D - 0.5)
    const tail = cmd(cmd(p, 'clip.trimEnd', { clipId: 'x', delta: -d }), 'clip.trimEnd', { clipId: 'x', delta: d })
    assert.ok(near(keysOf(tail.clips.x), orig), `tail, seed ${seed}`)
  }
})

test('decision 1: a split gives both halves the whole list (the right one moved, with ids of its own)', () => {
  const p = makeProject(rng(3), 0)
  const n = p.clips.x.channels!.x!.length
  const after = cmd(p, 'clip.split', { clipIds: ['x'], time: S + 5 })
  const right = Object.values(after.clips).find((c) => c.id !== 'x')!
  assert.equal(after.clips.x.channels!.x!.length, n)
  assert.equal(right.channels!.x!.length, n)
  assert.deepEqual(right.channels!.x!.map((k) => k.time), p.clips.x.channels!.x!.map((k) => k.time - 5))
  assert.ok(right.channels!.x!.every((k) => !p.clips.x.channels!.x!.some((o) => o.id === k.id)), 'the right half has keyframe ids of its own')
})

test('K15, K17: a split moves a picture\'s moves with its half; reveal-earlier moves the mask with the content', () => {
  const p = makeProject(rng(5), 0)
  p.clips.x.moves = { actions: [{ id: 'mv', kind: 'enter', time: 0.5, dur: 1 } as never] } as Clip['moves']
  const after = cmd(p, 'clip.split', { clipIds: ['x'], time: S + 3 })
  const right = Object.values(after.clips).find((c) => c.id !== 'x')!
  assert.equal(right.moves!.actions[0].time, 0.5 - 3, 'the walk-in does not play again after the cut')
  useStore.getState().loadProject(makeProject(rng(5), 0))
  const was = structuredClone(useStore.getState().project.clips.x)
  useStore.getState().revealEarlier('x', 1)
  const now = useStore.getState().project.clips.x
  assert.equal(now.duration, was.duration + 1)
  for (const u of [0.2, 3.3, 7.1]) assert.ok(near(values(now, u + 1), values(was, u)), `at ${u}`)
})
