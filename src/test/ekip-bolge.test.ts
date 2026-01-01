// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode, step 3 (EKIP-3-PLAN.md): regions. The workers of one agent
// program take stretches of the timeline and write at the same time.
//
// The oracle (random, seeded): on many random projects, workers in adjacent
// or apart regions each write an op per round against the SAME version;
//   (a) one by one, each written after reading the project again,
//   (b) all written on the round's first version, sent one after another,
//   (c) the same, sent in the opposite order,
//   (d) the draft's calls replayed grouped by worker, last worker first
//       (the groups accepted in another order)
// must give the same film, and no op may drop. Where a region lies is told
// here by the footage of the talk (the test's own reckoning, not
// regions.ts).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import type { CommandCall } from '../renderer/src/commands'
import { enter, replay, sameFilm, type Entry, type Outcome, type ReplayContext } from '../renderer/src/agent/replay'
import { carryRegion, opInside, overlap, placedIn, regionBreach, slab, taken, type Region } from '../renderer/src/agent/regions'
import { dropKind, regionOwner } from '../renderer/src/agent/drop-words'
import { clipOf, videoAsset } from './agent-kit'

type Iv = [number, number]

/** mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const r2 = (x: number): number => Math.round(x * 100) / 100

interface Layout {
  project: Project
  v1: string
  v2: string
  /** Per worker: the talk's source seconds its region starts and ends on. */
  workers: { as: string; s0: number; e0: number }[]
}

/** A talk of 6–10 clips on V1 (its own sound: the anchor), pictures on V2
 *  above it, a music bed under everything, a line and a marker on some
 *  clips. The workers' regions start and end on joins of the talk. */
function layout(seed: number): Layout {
  const R = rng(seed)
  const p = defaultProject()
  p.name = `L${seed}`
  p.assets = [videoAsset('a1', 600), { ...videoAsset('a2', 60), hasAudio: false }, { ...videoAsset('a3', 3), hasAudio: false }, { id: 'm1', kind: 'audio', name: 'm1.mp3', url: 'media://m1', size: 1, duration: 900 } as Project['assets'][number]]
  const v1 = p.tracks[0]
  const a1 = p.tracks[1]
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: [] })
  const n = 6 + Math.floor(R() * 5)
  let t = 0
  let src = 0
  const joins: number[] = [0]
  p.captions = []
  p.markers = []
  for (let i = 0; i < n; i++) {
    const d = r2(3 + R() * 4)
    src = r2(src + R() * 2)
    const id = `v${i}`
    p.clips[id] = clipOf(id, 'a1', v1.id, t, src, d)
    v1.clipIds.push(id)
    if (R() < 0.6) p.captions.push({ id: `L${i}`, start: t + 0.1, end: t + 0.42, text: `w${i} x${i}`, words: [{ text: `w${i}`, start: t + 0.1, end: t + 0.25 }, { text: `x${i}`, start: t + 0.27, end: t + 0.42 }], soundClip: id } as Project['captions'][number])
    if (R() < 0.5) p.markers.push({ id: `k${i}`, time: r2(t + 0.6 + R() * (d - 1.2)), color: '#ff0000', note: `n${i}` })
    if (R() < 0.55) {
      const bd = r2(0.8 + R() * (d - 1.6))
      const b = `b${i}`
      p.clips[b] = clipOf(b, 'a2', 'V2', r2(t + 0.2 + R() * (d - bd - 0.4)), 0, bd, { volume: 0 })
      p.tracks[0].clipIds.push(b)
    }
    t = r2(t + d)
    src = r2(src + d)
    joins.push(t)
  }
  // (A music bed under everything, in two layouts of three: a clip that
  // lies in every region at once.)
  if (seed % 3 !== 0) {
    p.clips.m1 = clipOf('m1', 'm1', a1.id, 0, 5, t)
    a1.clipIds.push('m1')
  }
  // Two or three workers; adjacent regions, or a clip of nobody's between.
  const count = n >= 8 && R() < 0.35 ? 3 : 2
  const apart = R() < 0.4
  const workers: Layout['workers'] = []
  let at = 0
  for (let w = 0; w < count; w++) {
    const left = count - w
    const room = n - at - (left - 1) * (apart ? 3 : 2)
    const take = w === count - 1 && !apart ? n - at : Math.max(2, Math.min(room, 2 + Math.floor(R() * 2)))
    const first = p.clips[`v${at}`]
    const last = p.clips[`v${at + take - 1}`]
    workers.push({ as: ['kesim', 'altyazi', 'b-roll'][w], s0: first.inPoint, e0: last.inPoint + last.duration })
    at += take + (apart ? 1 : 0)
  }
  return { project: p, v1: v1.id, v2: 'V2', workers }
}

/** Where the talk shows source second `m` (`end`: where it stops showing it). */
function talkAt(p: Project, v1: string, m: number, end = false): number {
  for (const c of Object.values(p.clips)) {
    if (c.trackId !== v1) continue
    const hi = c.inPoint + c.duration
    if (end ? m > c.inPoint + 1e-9 && m <= hi + 1e-9 : m >= c.inPoint - 1e-9 && m < hi - 1e-9) return c.start + (m - c.inPoint)
  }
  throw new Error(`the talk no longer shows ${m}`)
}
const regionOf = (p: Project, l: Layout, w: number): Iv => [talkAt(p, l.v1, l.workers[w].s0), talkAt(p, l.v1, l.workers[w].e0, true)]

const KINDS = ['cut', 'cut', 'cut', 'move', 'move', 'volume', 'marker', 'markerMove', 'line', 'add', 'delete', 'ripple', 'trim', 'split'] as const

/** One op of a worker inside its region [a, b] of `p`, chosen by the order
 *  of what lies there (never by an id's spelling): the same choice in two
 *  projects that hold the same film there. Null when the draw fits nothing. */
function intent(p: Project, l: Layout, [a, b]: Iv, R: () => number): CommandCall | null {
  const inR = (c: Clip): boolean => c.start >= a - 1e-6 && c.start + c.duration <= b + 1e-6
  const on = (track: string): Clip[] => Object.values(p.clips).filter((c) => c.trackId === track && inR(c)).sort((x, y) => x.start - y.start)
  const talk = on(l.v1)
  const pics = on(l.v2)
  const lines = p.captions.filter((c) => c.start >= a - 1e-6 && c.end <= b + 1e-6).sort((x, y) => x.start - y.start)
  const marks = (p.markers ?? []).filter((m) => m.time >= a + 0.05 && m.time <= b - 0.05).sort((x, y) => x.time - y.time)
  const pick = <T>(list: T[]): T | undefined => list[Math.floor(R() * list.length)]
  /** A free stretch of V2 inside the region, `len` long, not on `but`. */
  const free = (len: number, but?: string): number | null => {
    const busy = pics.filter((c) => c.id !== but).map((c): Iv => [c.start, c.start + c.duration])
    const gaps: Iv[] = []
    let x = a + 0.05
    for (const [s, e] of busy) {
      if (s - x >= len + 0.1) gaps.push([x, s - 0.05])
      x = Math.max(x, e + 0.05)
    }
    if (b - 0.05 - x >= len + 0.1) gaps.push([x, b - 0.05])
    const g = pick(gaps)
    // (Rounded from the region's start: the same place wherever the region lies.)
    return g ? a + r2(g[0] - a + R() * (g[1] - g[0] - len)) : null
  }
  const kind = KINDS[Math.floor(R() * KINDS.length)]
  const u = R()
  switch (kind) {
    case 'cut': {
      const c = pick(talk.filter((x) => x.duration > 1.8))
      if (!c) return null
      const x = c.start + 0.55 + u * (c.duration - 1.5)
      return { name: 'timeline.cutRanges', params: { ranges: [[x, x + 0.2 + R() * 0.35]] } }
    }
    case 'move': {
      const c = pick(pics)
      const at = c ? free(c.duration, c.id) : null
      return c && at !== null && Math.abs(at - c.start) > 0.05 ? { name: 'clip.move', params: { clipId: c.id, start: at, linkAV: true, push: false } } : null
    }
    case 'volume': {
      const c = pick([...talk, ...pics])
      return c ? { name: 'clip.setVolume', params: { clipId: c.id, volume: r2(1.05 + u) } } : null
    }
    case 'marker': {
      const c = pick(talk.filter((x) => x.duration > 1))
      return c ? { name: 'marker.add', params: { time: c.start + 0.5 + u * (c.duration - 0.9), note: `m${Math.floor(u * 1000)}` } } : null
    }
    case 'markerMove': {
      const m = pick(marks)
      const c = pick(talk.filter((x) => x.duration > 1))
      return m && c ? { name: 'marker.update', params: { id: m.id, patch: { time: c.start + 0.5 + u * (c.duration - 0.9) } } } : null
    }
    case 'line': {
      const c = pick(lines)
      return c ? { name: 'caption.editLine', params: { id: c.id, text: `t${Math.floor(u * 1000)} u` } } : null
    }
    case 'add': {
      const at = free(3)
      return at !== null ? { name: 'clip.add', params: { assetId: 'a3', trackId: l.v2, start: at } } : null
    }
    case 'delete': {
      const c = pick(pics)
      return c ? { name: 'clip.delete', params: { ids: [c.id] } } : null
    }
    case 'ripple': {
      // (Never the region's first or last clip: the test tells the region
      // by the footage at its two ends.)
      const c = pick(talk.slice(1, -1))
      return c ? { name: 'clip.delete', params: { ids: [c.id], ripple: true } } : null
    }
    case 'trim': {
      const c = pick(pics.filter((x) => x.duration > 1))
      return c ? { name: 'clip.trimEnd', params: { clipId: c.id, delta: -r2(0.2 + u * 0.3) } } : null
    }
    case 'split': {
      const c = pick(pics.filter((x) => x.duration > 1))
      return c ? { name: 'clip.split', params: { clipIds: [c.id], time: c.start + c.duration * (0.3 + u * 0.4) } } : null
    }
  }
}

const ctxOf = (regions?: readonly Region[]): ReplayContext => ({ own: new Map(), made: [], moved: [], userChangedSince: () => false, ...(regions ? { regions } : {}) })

/** The film without its ids: every track's clips in order, the lines, the
 *  markers; numbers compared within 1e-6. (Not a new marker's colour: the
 *  app gives the next one of its row of colours, by how many there are —
 *  whoever sends first gets the earlier colour.) */
function film(p: Project): unknown {
  const bare = (o: object, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
  return {
    tracks: p.tracks.map((t) =>
      Object.values(p.clips)
        .filter((c) => c.trackId === t.id)
        .sort((x, y) => x.start - y.start || x.inPoint - y.inPoint)
        .map((c) => bare(c, 'id', 'instance', 'linkId'))
    ),
    lines: [...p.captions].sort((x, y) => x.start - y.start).map((c) => bare(c, 'id', 'soundClip')),
    markers: [...(p.markers ?? [])].sort((x, y) => x.time - y.time || x.note.localeCompare(y.note)).map((m) => bare(m, 'id', 'color'))
  }
}
function near(x: unknown, y: unknown): boolean {
  if (x === y) return true
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= 1e-6
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return (x ?? undefined) === (y ?? undefined)
  if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => near(v, y[i]))
  const p = x as Record<string, unknown>
  const q = y as Record<string, unknown>
  return [...new Set([...Object.keys(p), ...Object.keys(q)])].every((k) => near(p[k], q[k]))
}

interface Run {
  project: Project
  outcomes: Outcome[]
  entries: Entry[]
  ops: number
  structural: number
  carried: number
}

/**
 * The rounds of a layout. `together`: every worker writes on the round's
 * first version (else each reads again before it writes); `reverse`: the
 * workers send in the opposite order. The draws are the same in every run.
 */
function play(l: Layout, seed: number, rounds: number, together: boolean, reverse: boolean, claimed = true): Run {
  const regions: Region[] = l.workers.map((w, i) => {
    const [start, end] = regionOf(l.project, l, i)
    return { as: w.as, start, end, on: l.project }
  })
  const ctx = ctxOf(claimed ? regions : undefined)
  const run: Run = { project: l.project, outcomes: [], entries: [], ops: 0, structural: 0, carried: 0 }
  let seq = 0
  for (let round = 0; round < rounds; round++) {
    const first = run.project
    const order = l.workers.map((_, i) => i)
    // (Who sends first changes from round to round; `reverse` turns it.)
    if ((round % 2 === 1) !== reverse) order.reverse()
    // The draws are per round and worker, whoever sends first.
    for (const w of order) {
      const R = rng(seed * 7919 + round * 131 + w * 17 + 1)
      const base = together ? first : run.project
      const call = intent(base, l, regionOf(base, l, w), R)
      if (!call) continue
      // (The same seed for the same worker's same round in every run.)
      const r = enter(run.project, { seq: ++seq, seed: (seed * 31 + round * 7 + w) | 0, label: '', at: 0, baseLive: 0, as: l.workers[w].as }, [{ call, base }], ctx)
      run.ops++
      const op = r.entry.ops[0]
      if (op.family === 'structural') run.structural++
      if (r.outcomes[0].applied && base !== run.project && op.family === 'structural' && op.zone && !near(op.zone.params, op.params)) run.carried++
      run.project = r.project
      run.outcomes.push(...r.outcomes)
      run.entries.push(r.entry)
    }
  }
  return run
}

const LAYOUTS = 360
const ROUNDS = 3

test('the oracle: written together = written one by one = sent the other way round = groups in another order; nothing drops', () => {
  let ops = 0
  let structural = 0
  let carried = 0
  let rescued = 0
  let three = 0
  const kinds = new Map<string, number>()
  for (let seed = 1; seed <= LAYOUTS; seed++) {
    const l = layout(seed)
    if (l.workers.length === 3) three++
    const one = play(l, seed, ROUNDS, false, false)
    const all = play(l, seed, ROUNDS, true, false)
    const back = play(l, seed, ROUNDS, true, true)
    const say = (r: Run): string => r.outcomes.filter((o) => !o.applied).map((o) => `${o.command}: ${o.reason}`).join(' | ')
    assert.equal(say(one), '', `layout ${seed}, one by one: a drop`)
    assert.equal(say(all), '', `layout ${seed}, together: a drop`)
    assert.equal(say(back), '', `layout ${seed}, together and reversed: a drop`)
    assert.equal(all.ops, one.ops, `layout ${seed}: the same ops`)
    if (process.env.BOLGE_DEBUG && (!near(film(all.project), film(one.project)) || !near(film(back.project), film(one.project)))) {
      const rows = (p: Project): string[] => [...p.tracks.map((t) => JSON.stringify(Object.values(p.clips).filter((c) => c.trackId === t.id).sort((x, y) => x.start - y.start).map((c) => [c.start, c.duration, c.inPoint, c.volume]))), JSON.stringify(p.captions.map((c) => [c.start, c.text])), JSON.stringify((p.markers ?? []).map((m) => [m.time, m.note]))]
      console.log(JSON.stringify(l.workers.map((w, i) => [w.as, regionOf(l.project, l, i)])))
      for (const r of [one, all, back]) console.log(JSON.stringify(r.entries.map((e) => [e.seq, e.as, e.ops[0].name, e.ops[0].params, e.ops[0].zone?.params ?? null])))
      const y = rows(one.project)
      rows(all.project).forEach((row, k) => row !== y[k] && console.log('all', k, row, ' VS ', y[k]))
      rows(back.project).forEach((row, k) => row !== y[k] && console.log('back', k, row, ' VS ', y[k]))
    }
    assert.ok(near(film(all.project), film(one.project)), `layout ${seed}: together is not one by one`)
    assert.ok(near(film(back.project), film(one.project)), `layout ${seed}: the other order is another film`)
    // The groups accepted in another order: the same calls, each worker's
    // together, the last worker first.
    const grouped = [...l.workers].reverse().flatMap((w) => all.entries.filter((e) => e.as === w.as))
    const again = replay(l.project, grouped, ctxOf(all.entries.length ? (l.workers.map((w, i) => ({ as: w.as, start: regionOf(l.project, l, i)[0], end: regionOf(l.project, l, i)[1], on: l.project }))) : undefined))
    if (process.env.BOLGE_DEBUG && again.outcomes.some((o) => !o.applied)) {
      console.log(JSON.stringify(l.workers.map((w, i) => [w.as, regionOf(l.project, l, i)])))
      console.log(JSON.stringify(all.entries.map((e) => [e.seq, e.as, e.ops[0].name, e.ops[0].params, e.ops[0].zone?.range ?? null])))
      console.log(JSON.stringify(again.outcomes.map((o) => [o.seq, o.applied])))
    }
    assert.equal(again.outcomes.filter((o) => !o.applied).map((o) => `${o.command}: ${o.reason}`).join(' | '), '', `layout ${seed}, groups in another order: a drop`)
    if (process.env.BOLGE_DEBUG && !near(film(again.project), film(one.project))) {
      console.log(JSON.stringify(grouped.map((e) => [e.as, e.ops[0].name, e.ops[0].params, e.ops[0].zone])))
      const rows = (p: Project): string[] => [...p.tracks.map((t) => JSON.stringify(Object.values(p.clips).filter((c) => c.trackId === t.id).sort((x, y) => x.start - y.start).map((c) => [c.start, c.duration, c.inPoint, c.volume]))), JSON.stringify(p.captions.map((c) => [c.start, c.text])), JSON.stringify(p.markers)]
      const x = rows(again.project)
      const y = rows(one.project)
      x.forEach((row, k) => row !== y[k] && console.log(k, row, ' VS ', y[k]))
    }
    assert.ok(near(film(again.project), film(one.project)), `layout ${seed}: groups in another order give another film`)
    // (The same calls with no region taken: what the rule that was drops.)
    rescued += play(l, seed, ROUNDS, true, false, false).outcomes.filter((o) => !o.applied).length
    ops += all.ops
    structural += all.structural
    carried += all.carried
    for (const e of all.entries) kinds.set(e.ops[0].name, (kinds.get(e.ops[0].name) ?? 0) + 1)
  }
  console.log(`  oracle: ${LAYOUTS} layouts (${three} with three workers) x ${ROUNDS} rounds, ${ops} ops (${structural} structural, ${carried} with their seconds carried), 4 runs each: the same film, 0 drops; with no region taken the same calls drop ${rescued} ops`)
  console.log(`  ops: ${[...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`)
  assert.ok(carried >= 40 && rescued >= 100, `the region rule: ${carried} carried, ${rescued} kept from dropping`)
})


// ---- the rules one by one ---------------------------------------------------------

/** Four clips of talk (v0…v3, 5 s each), a picture over three of them
 *  (b0 1–2 s, b2 11–12 s, b3 16–17 s), two markers. kesim has 0–10 s,
 *  altyazi 10–20 s. */
function small(): { p: Project; regions: Region[] } {
  const p = defaultProject()
  p.assets = [videoAsset('a1', 600), { ...videoAsset('a2', 60), hasAudio: false }]
  const v1 = p.tracks[0]
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b0', 'b2', 'b3'] })
  for (let i = 0; i < 4; i++) {
    p.clips[`v${i}`] = clipOf(`v${i}`, 'a1', v1.id, i * 5, i * 5 + i, 5)
    v1.clipIds.push(`v${i}`)
  }
  p.clips.b0 = clipOf('b0', 'a2', 'V2', 1, 0, 1, { volume: 0 })
  p.clips.b2 = clipOf('b2', 'a2', 'V2', 11, 0, 1, { volume: 0 })
  p.clips.b3 = clipOf('b3', 'a2', 'V2', 16, 0, 1, { volume: 0 })
  p.markers = [{ id: 'k0', time: 2, color: '#ff0000', note: 'a' }, { id: 'k2', time: 12, color: '#ff0000', note: 'b' }]
  return { p, regions: [{ as: 'kesim', start: 0, end: 10, on: p }, { as: 'altyazi', start: 10, end: 20, on: p }] }
}
const one = (head: Project, base: Project, as: string | undefined, call: CommandCall, ctx: ReplayContext, seq = 1): ReturnType<typeof enter> => enter(head, { seq, seed: seq * 11, label: '', at: 0, baseLive: 0, ...(as ? { as } : {}) }, [{ call, base }], ctx)
const MOVE: CommandCall = { name: 'clip.move', params: { clipId: 'b2', start: 13, linkAV: true, push: false } }
const CUT: CommandCall = { name: 'timeline.cutRanges', params: { ranges: [[3, 4.5]] } }

test('a region rides the timeline: a cut before it shifts it, a cut of its owner inside shortens it', () => {
  const { p, regions } = small()
  const ctx = ctxOf(regions)
  const a = one(p, p, 'kesim', CUT, ctx)
  assert.equal(a.outcomes[0].applied, true, String(a.outcomes[0].reason))
  assert.deepEqual(placedIn(regions[0], a.project), [0, 8.5])
  assert.deepEqual(placedIn(regions[1], a.project), [8.5, 18.5])
  assert.deepEqual(carryRegion(p, a.project, [10, 20]), [8.5, 18.5])
  // (What is inside the other region is the same, counted from its start.)
  assert.ok(sameFilm(slab(p, [10, 20]), slab(a.project, [8.5, 18.5])))
  assert.ok(!sameFilm(slab(p, [0, 10]), slab(a.project, [0, 8.5])))
})

test('the write rule: a move written on the old version lands where its region is now, by exactly the shift of the region', () => {
  const { p, regions } = small()
  const ctx = ctxOf(regions)
  const a = one(p, p, 'kesim', CUT, ctx)
  const b = one(a.project, p, 'altyazi', MOVE, ctx, 2)
  assert.equal(b.outcomes[0].applied, true, String(b.outcomes[0].reason))
  assert.equal(b.project.clips.b2.start, 11.5)
  assert.deepEqual(b.entry.ops[0].zone, { range: [8.5, 18.5], params: { clipId: 'b2', start: 11.5, linkAV: true, push: false } })
  // With no region taken the same op drops (the rule that was).
  const ctx0 = ctxOf()
  const a0 = one(p, p, 'kesim', CUT, ctx0)
  const b0 = one(a0.project, p, 'altyazi', MOVE, ctx0, 2)
  assert.equal(b0.outcomes[0].applied, false)
  assert.match(b0.outcomes[0].reason!, /its ids and times are of the version you read/)
})

test('the write rule holds only inside the region and only while its inside is as it was', () => {
  const { p, regions } = small()
  // Naming a clip of another stretch, or a second outside: not an op of the region.
  assert.equal(opInside(p, 'clip.move', { clipId: 'b2', start: 13 }, [10, 20]), true)
  assert.equal(opInside(p, 'clip.move', { clipId: 'b0', start: 13 }, [10, 20]), false)
  assert.equal(opInside(p, 'clip.move', { clipId: 'b2', start: 21 }, [10, 20]), false)
  assert.equal(opInside(p, 'track.setMagnet', { trackId: 'V2', on: true }, [10, 20]), false)
  // The inside was changed before the op came in: dropped as before.
  const ctx = ctxOf(regions)
  const cut = one(p, p, 'kesim', CUT, ctx).project
  const moved: Project = { ...cut, clips: { ...cut.clips, b3: { ...cut.clips.b3, start: cut.clips.b3.start + 0.5 } } }
  const b = one(moved, p, 'altyazi', MOVE, ctx, 2)
  assert.equal(b.outcomes[0].applied, false)
  assert.match(b.outcomes[0].reason!, /its ids and times are of the version you read/)
  // Someone else changed the film since (the user): the rule that was, too.
  const b2 = one(cut, p, 'altyazi', MOVE, { ...ctxOf(regions), userChangedSince: () => true }, 2)
  assert.equal(b2.outcomes[0].applied, false)
  assert.match(b2.outcomes[0].reason!, /not by you/)
})

test('no writing in the region of another worker: dropped and said; shifting it whole is free', () => {
  const { p, regions } = small()
  const ctx = ctxOf(regions)
  for (const call of [
    { name: 'clip.setVolume', params: { clipId: 'b2', volume: 0.5 } },
    { name: 'clip.move', params: { clipId: 'b0', start: 13, linkAV: true, push: false } },
    { name: 'marker.add', params: { time: 14, note: 'x' } },
    { name: 'marker.update', params: { id: 'k2', patch: { color: '#00ff00' } } },
    { name: 'timeline.cutRanges', params: { ranges: [[9, 11]] } },
    // (One track only: the pictures after it move, the talk under them does not.)
    { name: 'timeline.cutRangeOnTrack', params: { trackId: 'V2', range: [3, 4] } }
  ] as CommandCall[]) {
    for (const as of ['kesim', undefined]) {
      const r = one(p, p, as, call, ctx)
      assert.equal(r.outcomes[0].applied, false, `${call.name} by ${as}`)
      // (The agent's own unlabelled call that also changes kesim's stretch is
      // stopped by that region first.)
      const whose = as === undefined && ['clip.move', 'timeline.cutRanges'].includes(call.name) ? 'kesim' : 'altyazi'
      assert.equal(r.outcomes[0].reason, `it changes what is inside the region of worker "${whose}" (${whose === 'kesim' ? '0.00–10.00' : '10.00–20.00'} s): not applied. Only that worker writes there`, call.name)
      assert.equal(dropKind(r.outcomes[0].reason!), 'region')
      assert.equal(regionOwner(r.outcomes[0].reason!), whose)
      assert.equal(r.project, p)
    }
  }
  // Its own worker writes there; a cut elsewhere only shifts it.
  assert.equal(one(p, p, 'altyazi', { name: 'clip.setVolume', params: { clipId: 'b2', volume: 0.5 } }, ctx).outcomes[0].applied, true)
  assert.equal(one(p, p, 'kesim', { name: 'timeline.cutRanges', params: { ranges: [[3, 4]] } }, ctx).outcomes[0].applied, true)
  assert.equal(regionBreach(p, p, regions, 'kesim', sameFilm), null)
  // A region of some tracks: only their clips are its inside.
  const tracked: Region[] = [{ as: 'altyazi', start: 10, end: 20, tracks: ['V2'], on: p }]
  assert.equal(one(p, p, 'kesim', { name: 'marker.add', params: { time: 14, note: 'x' } }, ctxOf(tracked)).outcomes[0].applied, true)
  assert.equal(one(p, p, 'kesim', { name: 'clip.setVolume', params: { clipId: 'b2', volume: 0.5 } }, ctxOf(tracked)).outcomes[0].applied, false)
})

test('a waiting op of a region lives through an edit of the user elsewhere, and drops when the user changes its region', () => {
  const { p, regions } = small()
  const b = one(p, p, 'altyazi', MOVE, ctxOf(regions))
  assert.equal(b.outcomes[0].applied, true)
  // The user moves a picture of the other stretch: the draft is replayed on that.
  const elsewhere: Project = { ...p, clips: { ...p.clips, b0: { ...p.clips.b0, start: 3 } } }
  const r1 = replay(elsewhere, [b.entry], ctxOf(regions))
  assert.equal(r1.outcomes[0].applied, true, String(r1.outcomes[0].reason))
  assert.equal(r1.project.clips.b2.start, 13)
  assert.equal(r1.project.clips.b0.start, 3)
  // The user changes the inside of the region: as before, dropped and said.
  const inside: Project = { ...p, clips: { ...p.clips, b3: { ...p.clips.b3, start: 17 } } }
  const r2 = replay(inside, [b.entry], ctxOf(regions))
  assert.equal(r2.outcomes[0].applied, false)
  assert.match(r2.outcomes[0].reason!, /the project is not as it was when this was sent/)
})

test('claims: a stretch that overlaps is the other worker’s; apart, or on other tracks, both hold', () => {
  const { p, regions } = small()
  assert.equal(taken(regions, 'b-roll', p, [8, 12])?.by.as, 'kesim')
  assert.equal(taken(regions, 'b-roll', p, [20, 30]), null)
  assert.equal(taken(regions, 'kesim', p, [0, 10]), null)
  assert.equal(overlap([0, 10], ['V2'], [5, 15], ['A1']), false)
  assert.equal(overlap([0, 10], ['V2'], [5, 15], undefined), true)
  assert.equal(overlap([0, 10], undefined, [10, 20], undefined), false)
})

test('one long talk, picture and sound linked, under both regions: a cut in one is no change of the other', () => {
  const p = defaultProject()
  p.assets = [videoAsset('a1', 600), { ...videoAsset('a2', 60), hasAudio: false }]
  const [v1, a1] = p.tracks
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['pic'] })
  p.clips.a = clipOf('a', 'a1', v1.id, 0, 0, 12, { linkId: 'L1', audioExtracted: true })
  p.clips.as = clipOf('as', 'a1', a1.id, 0, 0, 12, { linkId: 'L1' })
  v1.clipIds.push('a')
  a1.clipIds.push('as')
  p.clips.pic = clipOf('pic', 'a2', 'V2', 7, 0, 2, { volume: 0 })
  const regions: Region[] = [{ as: 'kesim', start: 0, end: 6, on: p }, { as: 'altyazi', start: 6, end: 12, on: p }]
  const ctx = ctxOf(regions)
  const a = one(p, p, 'kesim', { name: 'timeline.cutRanges', params: { ranges: [[1, 2]] } }, ctx)
  assert.equal(a.outcomes[0].applied, true, String(a.outcomes[0].reason))
  assert.deepEqual(placedIn(regions[1], a.project), [5, 11])
  const b = one(a.project, p, 'altyazi', { name: 'clip.move', params: { clipId: 'pic', start: 8.5, linkAV: true, push: false } }, ctx, 2)
  assert.equal(b.outcomes[0].applied, true, String(b.outcomes[0].reason))
  assert.equal(b.project.clips.pic.start, 7.5)
  // Picture and sound are still in step, piece by piece.
  const pieces = Object.values(b.project.clips).filter((c) => c.linkId)
  for (const c of pieces) assert.ok(pieces.some((o) => o.id !== c.id && o.linkId === c.linkId && o.start === c.start && o.duration === c.duration), c.id)
  // The other way round, the same film.
  const ctx2 = ctxOf(regions)
  const b2 = one(p, p, 'altyazi', { name: 'clip.move', params: { clipId: 'pic', start: 8.5, linkAV: true, push: false } }, ctx2)
  const a2 = one(b2.project, p, 'kesim', { name: 'timeline.cutRanges', params: { ranges: [[1, 2]] } }, ctx2, 2)
  assert.equal(a2.outcomes[0].applied, true, String(a2.outcomes[0].reason))
  assert.ok(near(film(a2.project), film(b.project)))
  // kesim cutting across the join does change the other region.
  const x = one(p, p, 'kesim', { name: 'timeline.cutRanges', params: { ranges: [[5, 7.5]] } }, ctxOf(regions))
  assert.equal(x.outcomes[0].applied, false)
  assert.equal(regionOwner(x.outcomes[0].reason!), 'altyazi')
})
