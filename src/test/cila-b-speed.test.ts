// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): speed 0.1x – 100x in the command
// layer. The range, the one-frame floor (a retimed clip never shows more
// media than it did), and the edits that keep part of a clip — split, the
// two trims, the ripple cut, a linked picture and sound — at 0.1x and 100x,
// forwards and backwards. After every edit the model check must be silent.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { commandByName, runCommand } from '../renderer/src/commands'
import { checkProject, describeProblems } from '../renderer/src/model/check'
import { clipTransformAt } from '../renderer/src/playback/pose'
import { inPointFor, mediaAtLocal } from '../renderer/src/timeline/media-time'
import { AUDIBLE_MAX, AUDIBLE_MIN, SPEED_MAX, SPEED_MIN, clampSpeed, elementPlayable, fastestFor, keepsPitch, minClipLength, speedAudible } from '../renderer/src/timeline/speed'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { speedProblems } from './oracle/speed'

const FPS = 30
const FRAME = 1 / FPS
const T = { x: 960, y: 540, scale: 1, rotation: 0 }

/** A 600 s film `a` (media 100–`100 + len`) with its linked sound `s` under
 *  it, and (when `next`) a clip `b` butt-joined after both. */
function project(len = 60, extra: Partial<Clip> = {}, next = true): Project {
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
const cmd = (p: Project, name: string, params: unknown): Project => {
  const out = runCommand(p, commandByName(name), params).project
  const bad = checkProject(out)
  assert.equal(bad.length, 0, `${name} ${JSON.stringify(params)} left the model broken:\n${describeProblems(bad)}`)
  return out
}
const near = (a: number, b: number, what: string, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not ${b}`)
/** The media a clip shows: [first second, last second]. */
const span = (c: Clip): [number, number] => [c.inPoint, c.inPoint + c.duration * (c.speed ?? 1)]
const piecesOf = (p: Project, track: string): Clip[] => p.tracks.find((t) => t.id === track)!.clipIds.map((id) => p.clips[id])

test('range: the rules of timeline/speed.ts', () => {
  assert.equal(SPEED_MIN, 0.1)
  assert.equal(SPEED_MAX, 100)
  assert.equal(clampSpeed(0.01), 0.1)
  assert.equal(clampSpeed(1000), 100)
  assert.equal(clampSpeed(NaN), 1)
  assert.equal(clampSpeed(37.5), 37.5)
  near(minClipLength(30), 1 / 30, 'a frame at 30 fps')
  near(minClipLength(0), 1 / 30, 'no frame rate: 30')
  // A 1 s clip may go 30x at 30 fps; one already faster than that stays.
  near(fastestFor(1, 1, 30), 30, 'fastest')
  near(fastestFor(0.01, 4, 30), 4, 'never slower than now')
  assert.equal(AUDIBLE_MIN, 0.25)
  assert.equal(AUDIBLE_MAX, 8)
  for (const [s, heard] of [[0.1, false], [0.2499, false], [0.25, true], [1, true], [8, true], [8.01, false], [100, false], [-2, true]] as [number, boolean][]) assert.equal(speedAudible(s), heard, `speed ${s}`)
  assert.equal(keepsPitch({}), true)
  assert.equal(keepsPitch({ keepPitch: false }), false)
  for (const [r, plays] of [[0.05, false], [0.0625, true], [1, true], [16, true], [16.5, false], [100, false]] as [number, boolean][]) assert.equal(elementPlayable(r), plays, `rate ${r}`)
})

test('range: clip.setSpeed and clip.set take 0.1 – 100 and refuse what lies outside', () => {
  for (const name of ['clip.setSpeed', 'clip.set']) {
    for (const speed of [0.1, 0.25, 4, 10, 50, 100]) {
      const c = cmd(project(), name, { clipId: 'a', speed }).clips.a
      near(c.speed ?? 1, speed, `${name} ${speed}`)
      near(c.duration, 60 / speed, `${name} ${speed}: length`)
      assert.deepEqual(span(c).map((x) => +x.toFixed(9)), [100, 160], `${name} ${speed}: the same media`)
    }
    for (const speed of [0.05, 0.099, 100.5, 1000, -1]) assert.throws(() => runCommand(project(), commandByName(name), { clipId: 'a', speed }), Error, `${name} ${speed} is refused`)
  }
})

test('floor: a clip is never left shorter than one frame — the speed stops there, the media stays', () => {
  // 1 s of media at 30 fps: 30x is one frame.
  const p = cmd(project(1), 'clip.setSpeed', { clipId: 'a', speed: 100 })
  near(p.clips.a.speed ?? 1, 30, 'held at 30x')
  near(p.clips.a.duration, FRAME, 'one frame long')
  near(span(p.clips.a)[1], 101, 'the same media end')
  // …and asking again changes nothing (it is not walked along).
  const again = cmd(p, 'clip.setSpeed', { clipId: 'a', speed: 100 })
  assert.deepEqual(again.clips.a, p.clips.a)
  // Slower again: the whole second is back.
  const slow = cmd(p, 'clip.setSpeed', { clipId: 'a', speed: 0.1 })
  near(slow.clips.a.duration, 10, 'one second at 0.1x')
  assert.deepEqual(span(slow.clips.a).map((x) => +x.toFixed(9)), [100, 101])
})

test('floor: a short clip sped up no longer shows more media than it did (it was held at 0.1 s)', () => {
  // 0.3 s at 4x was made 0.1 s long: 0.4 s of media, 0.1 s past what it showed.
  const p = cmd(project(0.3), 'clip.setSpeed', { clipId: 'a', speed: 4 })
  near(p.clips.a.duration, 0.075, 'length')
  near(span(p.clips.a)[1], 100.3, 'media end')
  // At the very end of its file it stays inside it.
  const q = project(0.3, { inPoint: 599.7 })
  const out = cmd(q, 'clip.setSpeed', { clipId: 'a', speed: 4 })
  assert.ok(span(out.clips.a)[1] <= 600 + 1e-9, `ends at ${span(out.clips.a)[1]}`)
})

test('linked picture and sound: one speed, one length, at 0.1x and 100x (and the pair after them follows)', () => {
  for (const speed of [0.1, 100]) {
    const p = cmd(project(), 'clip.setSpeed', { clipId: 'a', speed, linkAV: true })
    for (const id of ['a', 's']) {
      near(p.clips[id].speed ?? 1, speed, `${id} at ${speed}`)
      near(p.clips[id].duration, 60 / speed, `${id} length`)
      near(p.clips[id].start, 10, `${id} start`)
      assert.deepEqual(span(p.clips[id]).map((x) => +x.toFixed(9)), [100, 160])
    }
    // What was butt-joined stays butt-joined, on both tracks.
    near(p.clips.b.start, 10 + 60 / speed, 'the next picture')
    near(p.clips.t.start, 10 + 60 / speed, 'the next sound')
  }
  // The pair is held where the shorter of the two reaches one frame.
  const q = project(1)
  q.clips.s.duration = 0.5
  const out = cmd(q, 'clip.setSpeed', { clipId: 'a', speed: 100, linkAV: true })
  near(out.clips.a.speed ?? 1, 15, 'the sound (0.5 s) allows 15x')
  near(out.clips.s.speed ?? 1, 15, 'the same speed')
  near(out.clips.s.duration, FRAME, 'the sound is one frame')
})

test('keys: a key stays on its media frame from 1x to 0.1x and to 100x', () => {
  for (const extra of [{}, { reversed: true }] as Partial<Clip>[]) {
    const p = project(60, extra)
    const frame = mediaAtLocal(p.clips.a, 30)
    for (const speed of [0.1, 100]) {
      const c = cmd(p, 'clip.setSpeed', { clipId: 'a', speed }).clips.a
      const key = c.channels!.x![0]
      near(mediaAtLocal(c, key.time), frame, `x${speed}${extra.reversed ? ' backwards' : ''}: the key's frame`, 1e-6)
      near(clipTransformAt(c, key.time).x, 300, 'its value')
    }
  }
})

test('split: at 0.1x and 100x both pieces go on showing what the clip showed, forwards and backwards', () => {
  for (const speed of [0.1, 100]) {
    for (const reversed of [false, true]) {
      const p0 = cmd(project(60, reversed ? { reversed: true } : {}), 'clip.setSpeed', { clipId: 'a', speed, linkAV: true })
      const whole = p0.clips.a
      const at = whole.start + whole.duration * 0.4
      const p = cmd(p0, 'clip.split', { clipIds: ['a'], time: at, linkAV: true })
      for (const track of ['V1', 'A1']) {
        const [left, right] = piecesOf(p, track)
        near(left.duration + right.duration, whole.duration, `${track} x${speed}: the lengths add up`, 1e-9)
        near(left.speed ?? 1, speed, 'left speed')
        near(right.speed ?? 1, speed, 'right speed')
        // Any moment shows the media it showed before the cut.
        for (const f of [0.05, 0.39, 0.41, 0.95]) {
          const t = whole.duration * f
          const piece = t < left.duration ? left : right
          near(mediaAtLocal(piece, t - (piece.start - whole.start)), mediaAtLocal(whole, t), `${track} x${speed}${reversed ? ' backwards' : ''} at ${f}`, 1e-6)
        }
        assert.ok(span(left)[0] >= 100 - 1e-6 && span(right)[1] <= 160 + 1e-6 && span(left)[1] <= 160 + 1e-6 && span(right)[0] >= 100 - 1e-6, 'inside the media it had')
      }
    }
  }
})

test('trims: an edge moved by d seconds moves the media by d x speed, and stops at the file', () => {
  for (const speed of [0.1, 100]) {
    const p0 = cmd(project(60, {}, false), 'clip.setSpeed', { clipId: 'a', speed, linkAV: true })
    const c0 = p0.clips.a
    const d = c0.duration * 0.25
    // Head in: the in point moves on by d x speed; the end stays on its frame.
    const head = cmd(p0, 'clip.trimHead', { clipId: 'a', edge: c0.start + d }).clips.a
    near(head.inPoint, 100 + d * speed, `x${speed}: head in`, 1e-6)
    near(span(head)[1], 160, 'its end', 1e-6)
    // End in.
    const end = cmd(p0, 'clip.trimEnd', { clipId: 'a', delta: -d }).clips.a
    near(span(end)[1], 160 - d * speed, `x${speed}: end in`, 1e-6)
    near(end.inPoint, 100, 'its start')
    // End out, far past the file: it stops at the file's last second.
    const far = cmd(p0, 'clip.trimEnd', { clipId: 'a', delta: 1e6 }).clips.a
    near(span(far)[1], 600, `x${speed}: end out stops at the file`, 1e-6)
    // Head out, far before the file: it stops at second 0 of it.
    const p1 = structuredClone(p0)
    p1.clips.a.start = 5000
    p1.clips.s.start = 5000
    const out = cmd(p1, 'clip.trimHead', { clipId: 'a', edge: 0 }).clips.a
    near(out.inPoint, 0, `x${speed}: head out stops at the file`, 1e-6)
    near(span(out)[1], 160, 'its end stays', 1e-6)
  }
})

test('ripple cut: a range cut out of a 0.1x and of a 100x clip leaves both sides on their frames', () => {
  for (const speed of [0.1, 100]) {
    for (const reversed of [false, true]) {
      const p0 = cmd(project(60, reversed ? { reversed: true } : {}), 'clip.setSpeed', { clipId: 'a', speed, linkAV: true })
      const whole = p0.clips.a
      const a = whole.start + whole.duration * 0.3
      const b = whole.start + whole.duration * 0.6
      const p = cmd(p0, 'timeline.cutRanges', { ranges: [[a, b]] })
      for (const track of ['V1', 'A1']) {
        const [left, right] = piecesOf(p, track)
        near(left.duration, whole.duration * 0.3, `${track} x${speed}: left length`, 1e-6)
        near(right.start, a, `${track}: the right piece closed up`, 1e-6)
        near(right.duration, whole.duration * 0.4, 'right length', 1e-6)
        near(mediaAtLocal(left, left.duration / 2), mediaAtLocal(whole, whole.duration * 0.15), `${track} x${speed}${reversed ? ' backwards' : ''}: left frame`, 1e-6)
        near(mediaAtLocal(right, right.duration / 2), mediaAtLocal(whole, whole.duration * 0.8), `${track} x${speed}${reversed ? ' backwards' : ''}: right frame`, 1e-6)
      }
      // The pair after them moved up by the cut's length, both tracks.
      near(p.clips.b.start, p0.clips.b.start - (b - a), 'the next picture', 1e-6)
      near(p.clips.t.start, p0.clips.t.start - (b - a), 'the next sound', 1e-6)
    }
  }
})

test('backwards and fast together: a reversed 50x clip shows its media from the end, and keeps doing so when cut', () => {
  const p = cmd(project(60, { reversed: true }), 'clip.setSpeed', { clipId: 'a', speed: 50, linkAV: true })
  const c = p.clips.a
  near(c.duration, 1.2, 'length')
  near(mediaAtLocal(c, 0), 160, 'first frame on screen is the last of its media')
  near(mediaAtLocal(c, 1.2), 100, 'last frame is the first')
  near(mediaAtLocal(c, 0.6), 130, 'half way')
  // The kept part's in point (what split, trims and the ripple cut ask for).
  near(inPointFor(c, 0.2, 0.7), 100 + (1.2 - 0.7) * 50, 'kept part')
})

test('the speed invariants of the oracle: silent on what the command does, and they do catch each kind of fault', () => {
  const kinds = (before: Project, after: Project, direct = true): string[] => [...new Set(speedProblems(before, after, 'A1', direct).map((v) => v.kind))].sort()
  const words = (p: Project): Project => {
    p.captions = [{ id: 'l1', start: 12, end: 13, text: 'one two', words: [{ text: 'one', start: 12, end: 12.4 }, { text: 'two', start: 12.5, end: 13 }] }]
    return p
  }
  // What clip.setSpeed leaves, at every speed of the range: nothing to say.
  for (const speed of [0.1, 0.25, 2, 10, 50, 100]) {
    const p0 = words(project(60, {}, false))
    const p1 = structuredClone(cmd(p0, 'clip.setSpeed', { clipId: 'a', speed, linkAV: true }))
    // (The subtitles went with it: runCommand settles them as the store does.)
    assert.ok(Math.abs(p1.captions[0].words![1].start - (10 + 2.5 / speed)) < 1e-6, `x${speed}: the word followed`)
    assert.deepEqual(kinds(p0, p1), [], `x${speed}`)
  }
  // A one-frame hold too.
  const short = project(1, {}, false)
  assert.deepEqual(kinds(short, cmd(short, 'clip.setSpeed', { clipId: 'a', speed: 100, linkAV: true })), [])
  // The faults.
  const p0 = words(project(60, {}, false))
  const good = structuredClone(cmd(p0, 'clip.setSpeed', { clipId: 'a', speed: 2, linkAV: true }))
  const broken = (change: (p: Project) => void): Project => {
    const p = structuredClone(good)
    change(p)
    return p
  }
  // The old floor: the length held while the speed was written (more media than before).
  assert.deepEqual(kinds(p0, broken((p) => { p.clips.a.duration = 40 })), ['speed-media-grew'])
  assert.deepEqual(kinds(p0, broken((p) => { p.clips.a.duration = 0.001; p.clips.s.duration = 0.001 })), ['speed-short'])
  assert.ok(kinds(p0, broken((p) => { p.clips.a.speed = 250; p.clips.a.duration = 60 / 250 })).includes('speed-range'))
  // A key left on its second of the timeline instead of its frame of the media.
  assert.deepEqual(kinds(p0, broken((p) => { p.clips.a.channels!.x![0].time = 30 })), ['speed-key-moved'])
  // A word left where it was.
  assert.deepEqual(kinds(p0, broken((p) => { p.captions[0].words![1].start = 12.5 })), ['speed-word-moved'])
  // An undo that gives back media a held change had cut off is not a fault.
  assert.deepEqual(kinds(good, p0, false), [])
  assert.deepEqual(kinds(broken((p) => { p.clips.a.duration = 5 }), p0, false), [])
})
