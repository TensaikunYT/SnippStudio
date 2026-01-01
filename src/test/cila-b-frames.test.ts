// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): the export shows the right source
// frame at every speed. The export's forward cursor and its backwards one,
// driven with a stand-in decoder and the times the exporter asks for
// (clipMediaAt: the one clock of the preview, the export and the sound), at
// 0.1x, 50x and 100x, forwards and backwards; and the clock itself at those
// speeds.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ClipFrameCursor, FRAME_EPS, ReverseCursor, cursorEnd, type FrameSource } from '../renderer/src/export/frame-cursor'
import { clipMediaAt } from '../renderer/src/playback/draw/timing'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'

type Wrapped = NonNullable<ClipFrameCursor['current']>

/** A stand-in decoder with mediabunny's `canvases(from, to)` rule: first the
 *  last frame starting at or before `from`, then each later one starting
 *  before `to`. It counts the frames it hands out. */
class FakeSink implements FrameSource {
  decoded = 0
  constructor(private readonly frames: number, private readonly fps: number) {}
  stamp(k: number): number {
    return Math.round((k * 15360) / this.fps) / 15360
  }
  async *canvases(from: number, to: number): AsyncGenerator<Wrapped, void, unknown> {
    let k0 = 0
    for (let k = 0; k < this.frames; k++) if (this.stamp(k) <= from) k0 = k
    for (let k = k0; k < this.frames && (k === k0 || this.stamp(k) < to); k++) {
      this.decoded++
      yield { canvas: { k } as unknown as HTMLCanvasElement, timestamp: this.stamp(k), duration: 1 / this.fps }
    }
  }
}
const frameOf = (c: ClipFrameCursor): number => (c.current!.canvas as unknown as { k: number }).k
/** The frame showing at media time `at`: the last whose own timestamp is at
 *  or before it (the export's slack allowed), by the decoder's timestamps. */
function shownAt(sink: FakeSink, fps: number, at: number): number {
  let k = Math.max(0, Math.floor(at * fps) - 2)
  while (sink.stamp(k + 1) <= at + FRAME_EPS) k++
  return k
}

/** A 600 s film with clip `a` on V1. */
function project(clip: Partial<Clip>, fps = 30): Project {
  const p = defaultProject()
  p.settings.fps = fps
  p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: ['a'] }]
  p.assets = [{ id: 'vid', kind: 'video', name: 'vid.mp4', url: 'media://vid', size: 1, duration: 600, width: 1920, height: 1080, hasAudio: false } as never]
  p.clips.a = { id: 'a', assetId: 'vid', trackId: 'V1', start: 0, inPoint: 0, duration: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1, ...clip } as Clip
  p.captions = []
  return p
}

test('the clock: clipMediaAt at 0.1x, 50x and 100x, forwards and backwards', () => {
  for (const speed of [0.1, 50, 100]) {
    const fwd = project({ start: 3, inPoint: 20, duration: 4, speed })
    for (const local of [0, 0.5, 1.25, 3.999]) {
      const m = clipMediaAt(fwd, fwd.clips.a, 3 + local)
      assert.ok(Math.abs(m.time - (20 + local * speed)) < 1e-9, `x${speed} at ${local}: media ${m.time}`)
      assert.equal(m.rate, speed)
    }
    const back = project({ start: 3, inPoint: 20, duration: 4, speed, reversed: true })
    for (const local of [0, 0.5, 1.25, 3.999]) {
      const m = clipMediaAt(back, back.clips.a, 3 + local)
      assert.ok(Math.abs(m.time - (20 + (4 - local) * speed)) < 1e-9, `x${speed} backwards at ${local}: media ${m.time}`)
      assert.equal(m.rate, -speed)
    }
  }
})

test('export frames at 50x and 100x: every output frame is the source frame of its moment', async () => {
  for (const [speed, srcFps, outFps] of [[50, 30, 30], [100, 30, 30], [50, 60, 30], [100, 24, 60], [37.5, 25, 30]] as [number, number, number][]) {
    // Media 2 s … the file's end, the film's clip from 1.5 s on.
    const p = project({ start: 1.5, inPoint: 2, duration: 500 / speed, speed }, outFps)
    const c = p.clips.a
    const sink = new FakeSink(600 * srcFps, srcFps)
    const cursor = new ClipFrameCursor(sink, c, 600)
    const first = Math.round(c.start * outFps)
    const count = Math.floor(c.duration * outFps)
    for (let i = first; i < first + count; i++) {
      const at = clipMediaAt(p, c, i / outFps).time
      await cursor.seekTo(at)
      const want = shownAt(sink, srcFps, at)
      assert.equal(frameOf(cursor), want, `x${speed}, ${srcFps} fps footage in a ${outFps} fps film: output frame ${i - first} (media ${at})`)
    }
    cursor.close()
    // The decoder ran to the clip's end and no further than its spare half second.
    assert.ok(cursorEnd(c, 600) >= c.inPoint + c.duration * speed)
  }
})

test('export frames at 0.1x: each source frame is held ten frames, none skipped, none early', async () => {
  const p = project({ start: 0.7, inPoint: 5, duration: 20, speed: 0.1 })
  const c = p.clips.a
  const sink = new FakeSink(600 * 30, 30)
  const cursor = new ClipFrameCursor(sink, c, 600)
  const first = Math.round(c.start * 30)
  const seen: number[] = []
  for (let i = first; i < first + 600; i++) {
    await cursor.seekTo(clipMediaAt(p, c, i / 30).time)
    seen.push(frameOf(cursor))
  }
  cursor.close()
  // Media 5.0–7.0 s: source frames 150 … 209, ten output frames each.
  const runs = new Map<number, number>()
  for (const k of seen) runs.set(k, (runs.get(k) ?? 0) + 1)
  assert.deepEqual([...runs.keys()], Array.from({ length: 60 }, (_, i) => 150 + i))
  for (const [k, n] of runs) assert.ok(n >= 9 && n <= 11, `source frame ${k} is held ${n} frames`)
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] === seen[i - 1] || seen[i] === seen[i - 1] + 1, `no jump at output frame ${i}`)
  // It decoded the stretch once (60 frames and the look-ahead), not the film.
  assert.ok(sink.decoded <= 64, `${sink.decoded} frames decoded`)
})

test('export frames backwards at 50x and at 0.1x: the reverse cursor gives the frame of each moment', async () => {
  for (const speed of [50, 0.1]) {
    const p = project({ start: 2, inPoint: 10, duration: speed === 50 ? 4 : 30, speed, reversed: true })
    const c = p.clips.a
    const sink = new FakeSink(600 * 30, 30)
    const rev = new ReverseCursor<number>(sink, 48, 1 / 30, (src) => (src.canvas as unknown as { k: number }).k)
    const first = Math.round(c.start * 30)
    const count = Math.floor(c.duration * 30)
    let before = Infinity
    for (let i = first; i < first + count; i++) {
      const at = clipMediaAt(p, c, i / 30).time + FRAME_EPS
      const k = await rev.frameAt(at)
      const want = shownAt(sink, 30, at)
      assert.equal(k, want, `x${speed} backwards: output frame ${i - first} (media ${at})`)
      assert.ok(k! <= before, 'it runs backwards')
      before = k!
    }
  }
})

test('a speed ramp at a cut: a clip at 16x or more keeps its plain clock (no ramp turned inside out); a slower one still ramps', () => {
  const two = (speed: number): Project => {
    const p = project({ start: 0, inPoint: 10, duration: 4, speed, transitionOut: { type: 'speed-ramp', duration: 0.5 } as never })
    p.tracks[0].clipIds.push('b')
    p.clips.b = { ...p.clips.a, id: 'b', start: 4, inPoint: 300, duration: 4, transitionOut: undefined } as Clip
    return p
  }
  for (const speed of [16, 50, 100]) {
    const p = two(speed)
    for (const id of ['a', 'b']) {
      const c = p.clips[id]
      for (let i = 0; i <= 120; i++) {
        const local = (i / 120) * c.duration
        const m = clipMediaAt(p, c, c.start + local)
        assert.ok(Math.abs(m.time - (c.inPoint + local * speed)) < 1e-6, `x${speed} clip ${id} at ${local.toFixed(3)}: media ${m.time}`)
        assert.ok(Math.abs(m.rate - speed) < 1e-9, `x${speed} clip ${id}: rate ${m.rate}`)
      }
    }
  }
  // At 2x the ramp is there as before: faster than the clip's own speed at the cut, never slower than a hundredth, back on its frames at both ends.
  const p = two(2)
  const a = p.clips.a
  const end = clipMediaAt(p, a, a.start + a.duration - 1e-4)
  assert.ok(end.rate > 2 * 1.5, `at the cut it runs at ${end.rate}`)
  assert.ok(Math.abs(clipMediaAt(p, a, 0).time - 10) < 1e-9)
  assert.ok(Math.abs(clipMediaAt(p, a, a.start + a.duration).time - (10 + 4 * 2)) < 1e-6, 'the clip ends on its own last frame')
  let last = -Infinity
  for (let i = 0; i <= 400; i++) {
    const m = clipMediaAt(p, a, (i / 400) * a.duration)
    assert.ok(m.time >= last - 1e-9, 'the media never runs backwards')
    last = m.time
  }
})
