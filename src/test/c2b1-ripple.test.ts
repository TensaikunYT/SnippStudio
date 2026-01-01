// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2b.1, decision 1 (report L1) and K-3: one ripple. A ripple delete,
// Q / W, close gap, the cut marks, the transcript delete, the silence cut
// and the agent's timeline.cutRanges take their range out of EVERY unlocked
// track: two clips after the cut, on any two unlocked tracks, keep their
// offset (property test over random ranges). No cut leaves a piece shorter
// than 0.05 s. A locked track does not move, and the user is told.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { runCommand, commandByName } from '../renderer/src/commands'
import { useStore } from '../renderer/src/state/store'
/** The shortest piece a cut may leave (K-3; ops/ripple.ts MIN_PIECE). */
const MIN_PIECE = 0.002
import { clearToasts, currentToasts } from '../renderer/src/ui/toast-core'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
const S = useStore.getState

/** V2 B-roll and stings, V1 talk pieces, A1 the voice, A2 music; subtitles. */
function layered(lockA2 = false): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] },
    { id: 'A2', kind: 'audio', name: 'A2', clipIds: [], ...(lockA2 ? { locked: true } : {}) }
  ]
  const a = (id: string, kind: 'video' | 'audio' | 'image', duration: number) => ({ id, kind, name: id, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: kind !== 'image' }) as never
  p.assets = [a('talk', 'video', 300), a('voice', 'audio', 300), a('music', 'audio', 300), a('pic', 'image', 0), a('sting', 'video', 30)]
  const put = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('t1', 'talk', 'V1', 0, 10, 12)
  put('t2', 'talk', 'V1', 12, 40, 14)
  put('t3', 'talk', 'V1', 26, 70, 10)
  put('v1', 'voice', 'A1', 0, 10, 36)
  put('b1', 'pic', 'V2', 4, 0, 5)
  put('s1', 'sting', 'V2', 15, 0, 3)
  put('s2', 'sting', 'V2', 30, 2, 4)
  put('m1', 'music', 'A2', 0, 0, 40)
  p.captions = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, start: i * 3.5 + 0.3, end: i * 3.5 + 2.8, text: `line ${i}`, soundClip: 'v1' }))
  p.markers = [{ id: 'mk', time: 33, label: 'end' } as never]
  return p
}

const clipsOn = (p: Project, trackId: string): Clip[] => p.tracks.find((t) => t.id === trackId)!.clipIds.map((id) => p.clips[id])

/** Every clip edge (start) after `from`, by the media it shows there. */
function edgesAfter(p: Project, from: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of p.tracks) {
    if (t.locked) continue
    for (const c of clipsOn(p, t.id)) if (c.start >= from - 1e-6) out.set(`${c.assetId}@${c.inPoint.toFixed(4)}`, c.start)
  }
  return out
}

function noSlivers(p: Project, what: string): void {
  for (const c of Object.values(p.clips)) assert.ok(c.duration >= MIN_PIECE - 1e-9, `${what}: ${c.id} is ${c.duration} s long`)
}

/** The property: whatever lay after the cut (b) lies after it still, every
 *  pair at the same offset, on every unlocked track. */
function inStep(before: Project, after: Project, b: number, what: string): void {
  const was = edgesAfter(before, b)
  const now = edgesAfter(after, 0)
  const keys = [...was.keys()].filter((k) => now.has(k))
  assert.ok(keys.length >= 2, `${what}: at least two clips after the cut (${[...was.keys()].join(' ')})`)
  const shift = now.get(keys[0])! - was.get(keys[0])!
  for (const k of keys) assert.ok(Math.abs(now.get(k)! - was.get(k)! - shift) < 1e-6, `${what}: ${k} moved ${(now.get(k)! - was.get(k)!).toFixed(3)}, ${keys[0]} ${shift.toFixed(3)}`)
}

function rng(seed: number): () => number {
  let x = seed >>> 0
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('timeline.cutRanges: every unlocked track keeps step after the cut, no sliver is left (random ranges)', () => {
  const r = rng(7)
  for (let i = 0; i < 60; i++) {
    const p = layered()
    const a = +(r() * 22).toFixed(3)
    const b = +(a + 0.1 + r() * 4).toFixed(3)
    const out = runCommand(p, commandByName('timeline.cutRanges'), { ranges: [[a, b]] }).project
    inStep(p, out, b + 0.05, `cut [${a}, ${b}]`)
    noSlivers(out, `cut [${a}, ${b}]`)
  }
})

test('K-3: a cut that ends a hair before a clip ends takes the sliver with it; every track still loses the same time', () => {
  const p = layered()
  // t1 ends at 12: the cut stops 0.001 s short of it. The 0.001 s left of
  // t1 goes (a gap that short is a join to the player); the time taken out
  // is 3.999 s on every track, so nothing falls out of step.
  const out = runCommand(p, commandByName('timeline.cutRanges'), { ranges: [[8, 11.999]] }).project
  noSlivers(out, 'cut to 11.999')
  assert.ok(Math.abs(out.clips.t2.start - 8.001) < 1e-9)
  inStep(p, out, 12, 'cut to 11.999')
  // The voice under it lost the same 3.999 s, not a hair more.
  const voice = clipsOn(out, 'A1')
  assert.equal(voice.length, 2)
  assert.ok(Math.abs(voice[1].start - 8) < 1e-9 && Math.abs(voice[1].inPoint - 21.999) < 1e-9)
  // Two cuts 0.03 s apart inside one clip leave no 0.03 s piece between them.
  const two = runCommand(p, commandByName('timeline.cutRanges'), { ranges: [[13, 15], [15.03, 17]] }).project
  noSlivers(two, 'two cuts 0.03 s apart')
})

/** A cut with nothing on the other tracks: V1 talk 0–10 and 25–35 (the
 *  first linked to its sound on A1), V2 a picture 20–25 and nothing else
 *  under it; subtitles and a marker after it. */
function sparse(): Project {
  const p = layered()
  for (const t of p.tracks) t.clipIds = []
  p.clips = {}
  const put = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}) => {
    p.clips[id] = { id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }
    p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
  }
  put('ta', 'talk', 'V1', 0, 0, 10, { linkId: 'L1' })
  put('aa', 'voice', 'A1', 0, 0, 10, { linkId: 'L1' })
  put('tb', 'talk', 'V1', 10, 30, 6, { linkId: 'L2' })
  put('ab', 'voice', 'A1', 10, 30, 6, { linkId: 'L2' })
  put('pc', 'pic', 'V2', 20, 0, 5)
  put('tc', 'talk', 'V1', 25, 60, 10)
  p.captions = [{ id: 'c0', start: 1, end: 3, text: 'one' }, { id: 'c1', start: 27, end: 29, text: 'two' }]
  p.markers = [{ id: 'mk', time: 30, label: 'end' } as never]
  return p
}

// (Ç2b patch, item 3: E1's "only its own tracks close up" drifted the linked
// pairs after the deleted clip; with material elsewhere a ripple delete now
// deletes without ripple and the gap stays. The E1 tests below say so.)
test('E1: ripple-deleting the B-roll over the talk leaves the gap; not one word of the talk goes', () => {
  const p = layered()
  S().loadProject(p)
  clearToasts()
  S().deleteClips(['b1'], true)
  const out = S().project
  // The talk under the B-roll (V1, its voice A1, the music A2) and every
  // subtitle are where they were.
  for (const id of ['t1', 't2', 't3', 'v1', 'm1']) assert.deepEqual(out.clips[id], p.clips[id], id)
  assert.deepEqual(out.captions, p.captions)
  assert.equal(out.markers![0].time, 33)
  // The gap stays (Ç2b patch, item 3): s1 and s2 where they were.
  assert.equal(out.clips.b1, undefined)
  assert.equal(out.clips.s1.start, 15)
  assert.equal(out.clips.s2.start, 30)
  const told = currentToasts().map((x) => x.text)
  assert.ok(told.some((x) => /gap was left/i.test(x)), told.join(' | '))
  // The command by name follows the same rule.
  const byName = runCommand(p, commandByName('clip.delete'), { ids: ['b1'], ripple: true }).project
  assert.deepEqual(byName.clips.v1, p.clips.v1)
  assert.deepEqual(byName.captions, p.captions)
})

test('E1: a ripple delete with material elsewhere ripples nothing (the gap stays); with only its track, its own track closes up', () => {
  const p = layered()
  const out = runCommand(p, commandByName('clip.delete'), { ids: ['t2'], ripple: true }).project
  assert.equal(out.clips.t2, undefined)
  assert.equal(out.clips.t3.start, 26)
  // The voice, the music and the layer above have material in 12–26: they stay.
  assert.deepEqual(out.clips.v1, p.clips.v1)
  assert.deepEqual(out.clips.m1, p.clips.m1)
  assert.equal(out.clips.s2.start, 30)
  assert.equal(out.markers![0].time, 33)
  const alone = runCommand(p, commandByName('clip.delete'), { ids: ['t2'], ripple: true, onlyItsTrack: true }).project
  assert.equal(alone.clips.t3.start, 12)
  assert.equal(alone.clips.v1.duration, 36)
  assert.equal(alone.clips.s2.start, 30)
})

test('E1: a ripple delete with nothing on the other tracks moves every unlocked track (subtitles, markers too)', () => {
  const p = sparse()
  const out = runCommand(p, commandByName('clip.delete'), { ids: ['pc'], ripple: true }).project
  assert.equal(out.clips.tc.start, 20)
  assert.equal(out.markers![0].time, 25)
  assert.equal(out.captions[1].start, 22)
  assert.equal(out.captions[0].start, 1)
  // A linked pair (its partner deleted with it): the pair is not "material
  // elsewhere"; the whole timeline closes up.
  S().loadProject(sparse())
  clearToasts()
  useStore.setState({ linkAV: true })
  S().deleteClips(['tb'], true)
  const pair = S().project
  assert.equal(pair.clips.ab, undefined)
  assert.equal(pair.clips.pc.start, 14)
  assert.equal(pair.clips.tc.start, 19)
  assert.equal(pair.markers![0].time, 24)
  assert.equal(pair.captions[1].start, 21)
  assert.ok(!currentToasts().some((x) => /gap was left/i.test(x.text)))
})

test('the silence cut takes its ranges out of every unlocked track; two voices are cut only where both are quiet', () => {
  const p = layered()
  const out = runCommand(p, commandByName('silence.apply'), { regions: [{ clipId: 'v1', start: 20, end: 22 }] }).project
  inStep(p, out, 22, 'silence 20–22')
  assert.equal(out.clips.s2.start, 28)
  assert.equal(out.markers![0].time, 31)
  // A second voice (the talk's own sound) is loud over 20–21: only 21–22 goes.
  const both = runCommand(p, commandByName('silence.apply'), { regions: [{ clipId: 'v1', start: 20, end: 22 }, { clipId: 't2', start: 21, end: 23 }] }).project
  assert.equal(both.clips.s2.start, 29)
})

test('Alt+Q / Alt+W, close gap, the cut marks and the transcript delete move every unlocked track; Alt keeps close gap and the marks to one track', () => {
  const run = (go: () => void, b: number, what: string, alone = false): Project => {
    const p = layered()
    S().loadProject(p)
    go()
    const out = S().project
    if (!alone) inStep(p, out, b, what)
    noSlivers(out, what)
    return out
  }
  // (Plain Q / W keep to the clip's track since DENEME-1, item 2:
  // den1-c-ripple.test.ts.)
  run(() => { useStore.setState({ currentTime: 20, selectedClipIds: ['t2'] }); S().rippleTrimToPlayhead('left', true) }, 20, 'Alt+Q')
  run(() => { useStore.setState({ currentTime: 20, selectedClipIds: ['t2'] }); S().rippleTrimToPlayhead('right', true) }, 26, 'Alt+W')
  const q = run(() => { useStore.setState({ currentTime: 20, selectedClipIds: ['t2'] }); S().rippleTrimToPlayhead('left') }, 20, 'Q', true)
  assert.equal(q.clips.v1.duration, 36)
  assert.equal(q.clips.t3.start, 18)
  run(() => { useStore.setState({ cutMarks: [16, 18], cutTrackId: 'V1' }); S().deleteBetweenCuts() }, 18, 'cut marks on V1')
  const marks = run(() => { useStore.setState({ cutMarks: [16, 18], cutTrackId: 'V1' }); S().deleteBetweenCuts(true) }, 18, 'Alt cut marks', true)
  assert.equal(marks.clips.v1.duration, 36)
  run(() => S().rippleDelete(16, 18), 18, 'transcript delete')
  run(() => S().rippleDeleteMany([[3, 4], [16, 18]]), 18, 'transcript delete, two ranges')
  // A gap on V2 (9–15): closed on every track.
  const gap = run(() => { useStore.setState({ currentTime: 12, selectedClipIds: ['s1'] }); S().closeGapAtPlayhead() }, 15, 'close gap')
  assert.equal(gap.clips.s1.start, 9)
})

test('a locked track does not move with a whole-timeline cut; the cut is made and the user is told', () => {
  const p = layered(true)
  S().loadProject(p)
  S().rippleDelete(16, 18)
  const out = S().project
  assert.equal(out.clips.m1.start, 0)
  assert.equal(out.clips.m1.duration, 40)
  assert.equal(out.clips.s2.start, 28)
  const told = currentToasts().map((x) => x.text)
  assert.ok(told.some((x) => /A2/.test(x) && /16\.00/.test(x)), told.join(' | '))
})
