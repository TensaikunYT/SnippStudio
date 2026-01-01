// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): a speed curve through the edits.
// clip.setSpeedCurve gives the clip the length its curve asks for, the same
// media on screen; split, the two trims, the ripple cut and keep-range leave
// every frame where it was on the timeline (each piece with its own average
// speed, the same points); a linked picture and sound keep in step; one
// speed again (setSpeed, or no curve); the one-frame floor; keys stay on
// their frames. After every edit the model check must be silent.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMANDS, runCommand } from '../renderer/src/commands'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { clipMediaAt } from '../renderer/src/playback/render'
import { mediaAtLocal } from '../renderer/src/timeline/media-time'
import { curveDuration, curveRange, pointsOf } from '../renderer/src/timeline/speed-curve'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

const FPS = 30
const T = { x: 960, y: 540, scale: 1, rotation: 0 }

/** A film `a` (media 100–`100 + len`) with its linked sound `s` under it,
 *  and (when `next`) a pair `b` / `t` butt-joined after both. */
export function project(len = 60, extra: Partial<Clip> = {}, next = true): Project {
  const p = defaultProject()
  p.settings.fps = FPS
  p.tracks = [
    { id: 'V1', kind: 'video', name: 'V1', clipIds: next ? ['a', 'b'] : ['a'] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: next ? ['s', 't'] : ['s'] }
  ]
  p.assets = [
    { id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: false } as never,
    { id: 'snd', kind: 'audio', name: 'snd.wav', url: 'media://snd', size: 1, duration: 600, width: 0, height: 0, hasAudio: true } as never
  ]
  p.clips.a = { id: 'a', assetId: 'vid', trackId: 'V1', start: 10, inPoint: 100, duration: len, transform: T, volume: 1, linkId: 'L', channels: { x: [{ id: 'k', time: len / 2, value: 300 }] }, ...extra } as Clip
  p.clips.s = { id: 's', assetId: 'snd', trackId: 'A1', start: 10, inPoint: 100, duration: len, transform: T, volume: 1, linkId: 'L', ...extra } as Clip
  if (next) {
    p.clips.b = { id: 'b', assetId: 'vid', trackId: 'V1', start: 10 + len, inPoint: 300, duration: 5, transform: T, volume: 1, linkId: 'M' } as Clip
    p.clips.t = { id: 't', assetId: 'snd', trackId: 'A1', start: 10 + len, inPoint: 300, duration: 5, transform: T, volume: 1, linkId: 'M' } as Clip
  }
  p.captions = []
  return p
}
export const cmd = (p: Project, name: string, params: unknown): Project => {
  const out = runCommand(p, COMMANDS[name], params).project
  const bad = checkProject(out)
  assert.equal(bad.length, 0, `${name} ${JSON.stringify(params)} left the model broken:\n${describeProblems(bad)}`)
  return out
}
const near = (a: number, b: number, what: string, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b} (± ${eps})`)
const span = (c: Clip): [number, number] => [c.inPoint, c.inPoint + c.duration * (c.speed ?? 1)]
const piecesOf = (p: Project, track: string): Clip[] => p.tracks.find((t) => t.id === track)!.clipIds.map((id) => p.clips[id])
/** The media frame a track shows at timeline second `t` (null: none there). */
const frameAt = (p: Project, track: string, t: number): number | null => {
  const c = piecesOf(p, track).find((x) => t >= x.start - 1e-9 && t < x.start + x.duration - 1e-9)
  return c ? clipMediaAt(p, c, t).time : null
}
/** Three points over the clip: fast, slow, fast-ish. */
export const RAMP = { points: [{ u: 0, v: 4 }, { u: 0.5, v: 0.5 }, { u: 1, v: 2 }] }
export const curvedProject = (extra: Partial<Clip> = {}, next = true): Project => cmd(project(60, extra, next), 'clip.setSpeedCurve', { clipId: 'a', curve: RAMP, linkAV: true })

test('setSpeedCurve: the length the curve asks for, the same media, the next pair pushed along, picture and sound alike', () => {
  const p = curvedProject()
  const a = p.clips.a
  const want = curveDuration(a.speedCurve!, 100, 60)
  near(a.duration, want, 'its length')
  assert.deepEqual(span(a).map((x) => +x.toFixed(6)), [100, 160], 'the same media')
  assert.deepEqual(pointsOf(a).map((x) => [+x.u.toFixed(6), +x.v.toFixed(6)]), [[0, 4], [0.5, 0.5], [1, 2]])
  // Its sound has the same curve, the same length.
  near(p.clips.s.duration, a.duration, 'the sound\'s length')
  assert.deepEqual(p.clips.s.speedCurve, a.speedCurve)
  // The pair after it was butt-joined: it moved with the new end.
  near(p.clips.b.start, 10 + want, 'the next picture', 1e-9)
  near(p.clips.t.start, 10 + want, 'the next sound', 1e-9)
  // It plays at the points' speeds.
  near(clipMediaAt(p, a, a.start).rate, 4, 'start speed')
  near(clipMediaAt(p, a, a.start + a.duration - 1e-9).rate, 2, 'end speed', 1e-6)
  const [lo, hi] = curveRange(a)!
  near(lo, 0.5, 'slowest', 1e-9)
  near(hi, 4, 'fastest', 1e-9)
  // The key stays on its frame (it was on media 130 at 1x).
  const key = a.channels!.x![0]
  near(mediaAtLocal(a, key.time), 130, 'the key\'s frame', 1e-6)
})

test('split, trims, ripple cut, keep-range: every frame left where it was, forwards and backwards', () => {
  for (const reversed of [false, true]) {
    const p0 = curvedProject(reversed ? { reversed: true } : {})
    const whole = p0.clips.a
    const D = whole.duration
    const at = (f: number): number => whole.start + D * f
    const check = (p: Project, what: string, from = 0, to = 1, shift = 0): void => {
      for (const track of ['V1', 'A1']) {
        for (let f = from + 0.013; f < to - 0.005; f += 0.047) {
          const was = frameAt(p0, track, at(f))
          const now = frameAt(p, track, at(f) - shift)
          assert.ok(was !== null && now !== null, `${what} ${track} at ${f}: a frame`)
          near(now!, was!, `${what}${reversed ? ' backwards' : ''} ${track} at ${f}`, 1e-6)
        }
      }
    }
    check(cmd(p0, 'clip.split', { clipIds: ['a'], time: at(0.37), linkAV: true }), 'split')
    check(cmd(p0, 'clip.split', { clipIds: ['a'], time: at(0.5), linkAV: true }), 'split at a point')
    check(cmd(p0, 'clip.trimEnd', { clipId: 'a', delta: -D * 0.3 }), 'end in', 0, 0.7)
    check(cmd(p0, 'clip.trimHead', { clipId: 'a', edge: at(0.25) }), 'head in', 0.25, 1)
    check(cmd(p0, 'clip.keepRange', { clipId: 'a', range: [at(0.2), at(0.8)] }), 'keep range', 0.2, 0.8)
    // The ripple cut: the left side stays, the right side moved up.
    const cut = cmd(p0, 'timeline.cutRanges', { ranges: [[at(0.3), at(0.6)]] })
    check(cut, 'ripple left', 0, 0.3)
    check(cut, 'ripple right', 0.6, 1, D * 0.3)
    // The pieces keep the points; their averages add up to the media.
    const [left, right] = piecesOf(cmd(p0, 'clip.split', { clipIds: ['a'], time: at(0.37), linkAV: true }), 'V1')
    assert.deepEqual(left.speedCurve, whole.speedCurve)
    assert.deepEqual(right.speedCurve, whole.speedCurve)
    near(left.duration * (left.speed ?? 1) + right.duration * (right.speed ?? 1), 60, 'the media adds up', 1e-9)
  }
})

test('trims out: the media around the clip plays at the curve\'s end speeds, and stops at the file', () => {
  const p0 = curvedProject({}, false)
  const a = p0.clips.a
  // 10 s more on the timeline at its last point's 2x: 20 s more media.
  const out = cmd(p0, 'clip.trimEnd', { clipId: 'a', delta: 10 }).clips.a
  near(span(out)[1], 180, 'end out', 1e-6)
  near(out.inPoint, 100, 'its start', 1e-9)
  const far = cmd(p0, 'clip.trimEnd', { clipId: 'a', delta: 1e6 }).clips.a
  near(span(far)[1], 600, 'end out stops at the file', 1e-6)
  // Head out by 5 s at its first point's 4x: 20 s more media before it.
  const p1 = structuredClone(p0)
  p1.clips.a.start = 500
  p1.clips.s.start = 500
  const head = cmd(p1, 'clip.trimHead', { clipId: 'a', edge: 495 }).clips.a
  near(head.inPoint, 80, 'head out', 1e-6)
  near(span(head)[1], 160, 'its end stays', 1e-6)
  const all = cmd(p1, 'clip.trimHead', { clipId: 'a', edge: 0 }).clips.a
  near(all.inPoint, 0, 'head out stops at the file', 1e-6)
  near(all.start, 500 - 25, 'after 100 s of media at 4x', 1e-6)
  void a
})

test('one speed again: setSpeed takes the curve away (same media); no curve keeps the length', () => {
  const p0 = curvedProject()
  const one = cmd(p0, 'clip.setSpeed', { clipId: 'a', speed: 2, linkAV: true })
  assert.equal(one.clips.a.speedCurve, undefined)
  assert.equal(one.clips.s.speedCurve, undefined)
  near(one.clips.a.duration, 30, 'its length at 2x')
  assert.deepEqual(span(one.clips.a).map((x) => +x.toFixed(6)), [100, 160])
  near(mediaAtLocal(one.clips.a, one.clips.a.channels!.x![0].time), 130, 'the key\'s frame', 1e-6)
  const none = cmd(p0, 'clip.setSpeedCurve', { clipId: 'a', curve: null, linkAV: true })
  assert.equal(none.clips.a.speedCurve, undefined)
  near(none.clips.a.duration, p0.clips.a.duration, 'the same length')
  near(none.clips.a.speed ?? 1, 60 / p0.clips.a.duration, 'its average', 1e-9)
  near(mediaAtLocal(none.clips.a, none.clips.a.channels!.x![0].time), 130, 'the key\'s frame', 1e-6)
})

test('the one-frame floor, the points outside a piece, the clips that take no curve', () => {
  // 0.06 s of media at 100x everywhere would be 0.6 ms: held to one frame.
  const tiny = cmd(project(0.06, {}, false), 'clip.setSpeedCurve', { clipId: 'a', curve: { points: [{ u: 0, v: 100 }, { u: 1, v: 100 }] }, linkAV: true })
  near(tiny.clips.a.duration, 1 / FPS, 'one frame', 1e-9)
  assert.deepEqual(span(tiny.clips.a).map((x) => +x.toFixed(9)), [100, 100.06])
  // A piece's edit keeps the points its window does not show.
  const p0 = curvedProject()
  const split = cmd(p0, 'clip.split', { clipIds: ['a'], time: p0.clips.a.start + p0.clips.a.duration * 0.6, linkAV: true })
  const left = piecesOf(split, 'V1')[0]
  const edited = cmd(split, 'clip.setSpeedCurve', { clipId: left.id, curve: { points: [{ u: 0, v: 1 }, { u: 1, v: 1 }] }, linkAV: true })
  const keys = edited.clips[left.id].speedCurve!.keys
  assert.ok(keys.some((k) => Math.abs(k.m - 160) < 1e-6 && Math.abs(k.v - 2) < 1e-9), 'the point past its end stays')
  // A still, a held frame: no curve.
  const still = project(60, {}, false)
  still.assets.push({ id: 'img', kind: 'image', name: 'i.png', url: 'media://i', size: 1, duration: 0, width: 10, height: 10 } as never)
  still.clips.a.assetId = 'img'
  delete still.clips.a.linkId
  delete still.clips.s.linkId
  assert.equal(cmd(still, 'clip.setSpeedCurve', { clipId: 'a', curve: RAMP }).clips.a.speedCurve, undefined)
  const held = project(60, { freeze: 120 }, false)
  assert.equal(cmd(held, 'clip.setSpeedCurve', { clipId: 'a', curve: RAMP, linkAV: true }).clips.a.speedCurve, undefined)
})

test('slip: other footage under the same speeds', () => {
  const p0 = curvedProject({}, false)
  const p = cmd(p0, 'clip.slip', { clipId: 'a', delta: 2, linkAV: true })
  const a = p.clips.a
  const d = a.inPoint - p0.clips.a.inPoint
  assert.ok(d > 0, 'it slipped')
  near(a.duration, p0.clips.a.duration, 'the same length')
  for (let f = 0.01; f < 1; f += 0.07) {
    const t = a.start + a.duration * f
    near(clipMediaAt(p, a, t).rate, clipMediaAt(p0, p0.clips.a, t).rate, `the same speed at ${f}`, 1e-9)
    near(clipMediaAt(p, a, t).time, clipMediaAt(p0, p0.clips.a, t).time + d, `the footage moved at ${f}`, 1e-6)
  }
})

test('followers: a subtitle word stays on its frame when a curve is put on, changed, cut and taken away', () => {
  const words = (p: Project): Project => {
    // Words at media 130 and 145 (the clip shows media 100–160 from second 10 at 1x).
    p.captions = [{ id: 'l1', start: 40, end: 41, text: 'one', words: [{ text: 'one', start: 40, end: 40.4 }] }, { id: 'l2', start: 55, end: 56, text: 'two', words: [{ text: 'two', start: 55, end: 55.5 }] }] as never
    return p
  }
  const at = (p: Project, id: string): number => p.captions.find((c) => c.id === id)!.start
  const onFrame = (p: Project, id: string, m: number, what: string): void => {
    const a = piecesOf(p, 'A1').find((c) => at(p, id) >= c.start - 1e-9 && at(p, id) <= c.start + c.duration + 1e-9)!
    near(clipMediaAt(p, a, at(p, id)).time, m, what, 1e-6)
  }
  const p0 = words(project(60, {}, false))
  const p1 = cmd(p0, 'clip.setSpeedCurve', { clipId: 'a', curve: RAMP, linkAV: true })
  onFrame(p1, 'l1', 130, 'curve on: word one')
  onFrame(p1, 'l2', 145, 'curve on: word two')
  const p2 = cmd(p1, 'clip.setSpeedCurve', { clipId: 'a', curve: { points: [{ u: 0, v: 0.5 }, { u: 1, v: 3 }] }, linkAV: true })
  onFrame(p2, 'l1', 130, 'curve changed: word one')
  onFrame(p2, 'l2', 145, 'curve changed: word two')
  const a2 = p2.clips.a
  const p3 = cmd(p2, 'timeline.cutRanges', { ranges: [[a2.start + 0.1, a2.start + a2.duration * 0.2]] })
  onFrame(p3, 'l2', 145, 'after a ripple cut: word two')
  const p4 = cmd(p3, 'clip.setSpeed', { clipId: piecesOf(p3, 'V1').at(-1)!.id, speed: 1.5, linkAV: true })
  onFrame(p4, 'l2', 145, 'one speed again: word two')
})
