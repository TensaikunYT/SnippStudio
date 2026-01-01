// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): the export shows the right source
// frame along a speed curve. A three-point curve set by the command; every
// output frame of the export's own cursor (a stand-in decoder with
// mediabunny's rule, the times the exporter asks for: clipMediaAt) is the
// source frame of its moment as worked out here on its own — the points'
// eased speed integrated by Simpson's rule and inverted by bisection — within
// one frame. And a speed ramp at a curved clip's cut: the curve wins, the
// clip on the other side still ramps.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMANDS, runCommand } from '../renderer/src/commands'
import { ClipFrameCursor, FRAME_EPS, ReverseCursor, type FrameSource } from '../renderer/src/export/frame-cursor'
import { clipMediaAt } from '../renderer/src/playback/draw/timing'
import { defaultProject, type Clip, type Project, type SpeedCurve } from '../renderer/src/types'

type Wrapped = NonNullable<ClipFrameCursor['current']>
class FakeSink implements FrameSource {
  decoded = 0
  constructor(private readonly frames: number, private readonly fps: number) {}
  stamp(k: number): number {
    return Math.round((k * 15360) / this.fps) / 15360
  }
  async *canvases(from: number, to: number): AsyncGenerator<Wrapped, void, unknown> {
    let k0 = Math.max(0, Math.floor(from * this.fps) - 2)
    while (k0 + 1 < this.frames && this.stamp(k0 + 1) <= from) k0++
    for (let k = k0; k < this.frames && (k === k0 || this.stamp(k) < to); k++) {
      this.decoded++
      yield { canvas: { k } as unknown as HTMLCanvasElement, timestamp: this.stamp(k), duration: 1 / this.fps }
    }
  }
}
const frameOf = (c: ClipFrameCursor): number => (c.current!.canvas as unknown as { k: number }).k
function shownAt(sink: FakeSink, fps: number, at: number): number {
  let k = Math.max(0, Math.floor(at * fps) - 2)
  while (sink.stamp(k + 1) <= at + FRAME_EPS) k++
  return k
}

function project(fps: number): Project {
  const p = defaultProject()
  p.settings.fps = fps
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: false } as never]
  p.clips.a = { id: 'a', assetId: 'vid', trackId: 'V1', start: 1.5, inPoint: 20, duration: 30, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip
  p.captions = []
  return p
}
const curved = (p: Project, points: { u: number; v: number }[], reversed = false): Project => {
  if (reversed) p.clips.a.reversed = true
  return runCommand(p, COMMANDS['clip.setSpeedCurve'], { clipId: 'a', curve: { points } }).project
}

/** The clip's media at clip-local second `l`, worked out on its own: the
 *  points' eased speed (log speed, smoothstep) integrated by Simpson's rule
 *  over 1 ms of media, inverted by bisection. */
function expected(curve: SpeedCurve, inPoint: number, mediaLen: number, duration: number, l: number, reversed = false): number {
  const k = curve.keys
  const v = (m: number): number => {
    if (m <= k[0].m) return k[0].v
    if (m >= k[k.length - 1].m) return k[k.length - 1].v
    let i = 0
    while (k[i + 1].m <= m) i++
    const u = (m - k[i].m) / (k[i + 1].m - k[i].m)
    const e = u * u * (3 - 2 * u)
    return Math.exp(Math.log(k[i].v) * (1 - e) + Math.log(k[i + 1].v) * e)
  }
  // T at every 2 ms of media (Simpson over each, 1 ms apart), straight between.
  const key = JSON.stringify([curve, inPoint, mediaLen])
  let cum = tables.get(key)
  if (!cum) {
    cum = [0]
    for (let i = 1; i * 0.002 <= mediaLen + 1e-9; i++) {
      const a = inPoint + (i - 1) * 0.002
      cum.push(cum[i - 1] + ((1 / v(a) + 4 / v(a + 0.001) + 1 / v(a + 0.002)) * 0.001) / 3)
    }
    tables.set(key, cum)
  }
  const table = cum
  const T = (m: number): number => {
    const x = (m - inPoint) / 0.002
    const i = Math.min(table.length - 2, Math.max(0, Math.floor(x)))
    return table[i] + (table[i + 1] - table[i]) * (x - i)
  }
  const total = T(inPoint + mediaLen)
  const want = ((reversed ? duration - l : l) / duration) * total
  let lo = inPoint
  let hi = inPoint + mediaLen
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (T(mid) < want) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const tables = new Map<string, number[]>()
const THREE = [{ u: 0, v: 4 }, { u: 0.4, v: 0.5 }, { u: 1, v: 2 }]

test('export frames along a three-point curve: each output frame is the source frame of its moment (± 1)', async () => {
  for (const [srcFps, outFps] of [[30, 30], [60, 30], [24, 60], [25, 30]] as [number, number][]) {
    const p = curved(project(outFps), THREE)
    const c = p.clips.a
    const sink = new FakeSink(600 * srcFps, srcFps)
    const cursor = new ClipFrameCursor(sink, c, 600)
    const first = Math.round(c.start * outFps)
    const count = Math.floor(c.duration * outFps)
    let exact = 0
    let worst = 0
    let last = -1
    for (let i = first; i < first + count; i++) {
      const at = clipMediaAt(p, c, i / outFps).time
      await cursor.seekTo(at)
      const got = frameOf(cursor)
      const want = shownAt(sink, srcFps, expected(c.speedCurve!, 20, 30, c.duration, i / outFps - c.start))
      const off = Math.abs(got - want)
      worst = Math.max(worst, off)
      if (off === 0) exact++
      assert.ok(off <= 1, `${srcFps} fps footage in a ${outFps} fps film: output frame ${i - first} shows ${got}, its moment is ${want}`)
      assert.ok(got >= last, 'never backwards')
      last = got
    }
    cursor.close()
    console.log(`  ${srcFps} → ${outFps} fps: ${count} frames, ${exact} exact, the rest within ${worst}`)
    assert.ok(exact / count > 0.99, `nearly all exact (${exact} / ${count})`)
  }
})

test('export frames along a curve backwards: the reverse cursor gives the frame of each moment (± 1)', async () => {
  const p = curved(project(30), THREE, true)
  const c = p.clips.a
  const sink = new FakeSink(600 * 30, 30)
  const rev = new ReverseCursor<number>(sink, 48, 1 / 30, (src) => (src.canvas as unknown as { k: number }).k)
  const first = Math.round(c.start * 30)
  const count = Math.floor(c.duration * 30)
  let before = Infinity
  for (let i = first; i < first + count; i++) {
    const at = clipMediaAt(p, c, i / 30).time + FRAME_EPS
    const k = (await rev.frameAt(at))!
    // The curve is read in the order the clip plays: u 0 is its first frame on screen.
    const want = shownAt(sink, 30, expected(c.speedCurve!, 20, 30, c.duration, i / 30 - c.start, true))
    assert.ok(Math.abs(k - want) <= 1, `backwards: output frame ${i - first} shows ${k}, its moment is ${want}`)
    assert.ok(k <= before, 'it runs backwards')
    before = k
  }
})

test('a speed ramp at the cut of a curved clip: the curve wins on its side, the next clip still ramps', () => {
  const p0 = project(30)
  p0.clips.a.duration = 10
  p0.tracks[0].clipIds.push('b')
  p0.clips.b = { ...p0.clips.a, id: 'b', start: 11.5, inPoint: 300, duration: 4 } as Clip
  p0.clips.a.transitionOut = { type: 'speed-ramp', duration: 0.5, to: 'b' } as never
  const p = curved(p0, [{ u: 0, v: 1 }, { u: 1, v: 3 }])
  const a = p.clips.a
  // Its last moments: the curve's own speed (3x at its end), no ramp energy.
  const end = clipMediaAt(p, a, a.start + a.duration - 0.01)
  assert.equal(end.ramp, 0)
  assert.ok(Math.abs(end.rate - 3) < 0.05, `the curve's speed at its end: ${end.rate}`)
  // The next clip's first moments: ramping down from its peak.
  const b = p.clips.b
  assert.ok(Math.abs(b.start - (a.start + a.duration)) < 1e-9, 'the next clip was carried to the new end')
  const into = clipMediaAt(p, b, b.start + 0.01)
  assert.ok(into.rate > 1.5, `the next clip still ramps in: ${into.rate}`)
  assert.ok(into.ramp > 0)
})
