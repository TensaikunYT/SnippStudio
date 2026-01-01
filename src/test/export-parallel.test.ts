// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  joinedTime,
  joinFrames,
  MAX_AUTO_LANES,
  onlyHere,
  MIN_SHARE_SEC,
  probeSet,
  sameSetup,
  StretchQueue,
  stretchesOf,
  wantsParallel,
  workerCount,
  type Machine
} from '../renderer/src/export/parallel-plan'

const GB = 1024 ** 3

test('parallel export: the stretches cover every frame once, in order, evenly', () => {
  for (const [frames, lanes] of [
    [9000, 3],
    [18000, 4],
    [1200, 2],
    [601, 3],
    [7, 2]
  ] as const) {
    const s = stretchesOf(frames, lanes, 60)
    assert.equal(s[0][0], 0)
    assert.equal(s[s.length - 1][1], frames)
    for (let i = 1; i < s.length; i++) assert.equal(s[i][0], s[i - 1][1], 'no gap, no overlap')
    const sizes = s.map(([a, b]) => b - a)
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `even: ${sizes}`)
    assert.ok(sizes.every((n) => n > 0))
  }
  // About three a lane, so a lane that finishes early takes the next.
  assert.equal(stretchesOf(9000, 3, 60).length, 9)
  // At most 40 s each on a long film; at least a second each on a short one.
  assert.ok(stretchesOf(60 * 600, 2, 60).every(([a, b]) => b - a <= 40 * 60))
  assert.equal(stretchesOf(100, 3, 60).length, 1)
  assert.deepEqual(stretchesOf(0, 3, 60), [])
})

test('parallel export: the joins are probed on both sides, and a stretch lands where it starts', () => {
  const s = stretchesOf(600, 2, 60)
  const j = joinFrames(s)
  assert.equal(j.length, (s.length - 1) * 4)
  for (let i = 1; i < s.length; i++) for (const f of [s[i][0] - 2, s[i][0] - 1, s[i][0], s[i][0] + 1]) assert.ok(j.includes(f))
  assert.deepEqual(joinFrames([[0, 10]]), [])
  // Frame 3 of a stretch from frame 600 at 60 fps is the film's frame 603.
  assert.ok(Math.abs(joinedTime(3 / 60, 600, 60) - 603 / 60) < 1e-12)
  assert.equal(joinedTime(0, 0, 60), 0)
  // The probes: none, a list, the joins.
  assert.equal(probeSet(undefined, [1]), null)
  assert.deepEqual([...probeSet([5, 9], null)!], [5, 9])
  assert.deepEqual([...probeSet('joins', [3, 4])!], [3, 4])
  assert.equal(probeSet('joins', []), null)
})

test('parallel export: the lane count follows the machine and keeps it usable', () => {
  const pc: Machine = { cpus: 12, totalMem: 16 * GB, freeMem: 4.4 * GB, gpu: true }
  // A 150 s film (2D and 3D) at 35 Mbps.
  const film = { frames: 150 * 60, fps: 60, d3: true, asked: 'auto' as const, outBytes: (35e6 * 150) / 8 }
  // This PC on round 7's day: the editor and one render process.
  const here = workerCount(pc, film)
  assert.equal(here.n, 2)
  assert.match(here.why, /and 1 render process \(/)
  assert.match(here.why, /GB free/)
  // The finished film is held in memory: a longer one leaves less room.
  const roomy = { ...pc, freeMem: 5.3 * GB }
  assert.equal(workerCount(roomy, { ...film, outBytes: 0 }).n, 3)
  assert.equal(workerCount(roomy, { ...film, outBytes: 1.3 * GB }).n, 2)
  // Little memory free: the editor alone (the single-window export).
  assert.equal(workerCount({ ...pc, freeMem: 1.8 * GB }, film).n, 1)
  // Threads: two and a half a lane, two kept.
  assert.equal(workerCount({ ...pc, freeMem: 64 * GB }, film).n, 4)
  // No GPU drawing: half.
  assert.equal(workerCount({ ...pc, freeMem: 64 * GB, gpu: false }, film).n, 2)
  // A big machine: at most 8.
  assert.equal(workerCount({ cpus: 64, totalMem: 128 * GB, freeMem: 100 * GB, gpu: true }, film).n, MAX_AUTO_LANES)
  // A short stretch: each lane at least 8 s of it.
  assert.equal(workerCount({ ...pc, freeMem: 64 * GB }, { ...film, frames: 20 * 60 }).n, Math.floor(20 / MIN_SHARE_SEC))
  // 3D takes more memory a process than 2D.
  const mid = { ...pc, freeMem: 4.5 * GB }
  assert.ok(workerCount(mid, { ...film, d3: false, outBytes: 0 }).n > workerCount(mid, { ...film, outBytes: 0 }).n)
  // As asked: workers=N, 1 being the old way; never more lanes than seconds.
  assert.equal(workerCount(pc, { ...film, asked: 1 }).n, 1)
  assert.equal(workerCount({ ...pc, freeMem: 0 }, { ...film, asked: 5 }).n, 5)
  assert.equal(workerCount(pc, { ...film, frames: 120, asked: 6 }).n, 2)
  // Not asked: one window.
  assert.equal(workerCount(pc, { ...film, asked: undefined }).n, 1)
})

test('parallel export: only a video asked for lanes goes parallel; the single path stays as it was', () => {
  assert.equal(wantsParallel(undefined, false), false)
  assert.equal(wantsParallel(1, false), false)
  assert.equal(wantsParallel(3, true), false)
  assert.equal(wantsParallel('auto', false), true)
  assert.equal(wantsParallel(2, false), true)
})

test('parallel export: fonts or a LUT imported into this window keep the film in one window', () => {
  const here = new Set(['Teal Orange'])
  const has = (l: string): boolean => here.has(l)
  assert.equal(onlyHere(0, [undefined, undefined], has), null)
  // Any imported font, used or not: its name can come from anywhere.
  assert.match(onlyHere(1, [undefined], has) ?? '', /^one window \(fonts/)
  // A clip with a LUT this window has; one it lacks is skipped in every lane.
  assert.match(onlyHere(0, [undefined, 'Teal Orange'], has) ?? '', /^one window \(a LUT/)
  assert.equal(onlyHere(0, ['Gone'], has), null)
})

test('parallel export: stretches join only when their encoders agree; the queue hands them out in order', () => {
  const a = { codec: 'avc1.640034', description: new Uint8Array([1, 100, 0, 52, 255]) }
  assert.ok(sameSetup(a, { codec: 'avc1.640034', description: new Uint8Array([1, 100, 0, 52, 255]).buffer }))
  assert.ok(!sameSetup(a, { codec: 'avc1.640034', description: new Uint8Array([1, 100, 0, 51, 255]) }))
  assert.ok(!sameSetup(a, { codec: 'avc1.42001f', description: a.description }))
  assert.ok(!sameSetup(a, { codec: a.codec }))
  assert.ok(sameSetup({ codec: 'vp09.00.10.08' }, { codec: 'vp09.00.10.08', description: null }))
  const q = new StretchQueue(stretchesOf(9000, 3, 60))
  const got: number[] = []
  for (let k = q.take(); k !== null; k = q.take()) got.push(k)
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(q.remaining, 0)
})
