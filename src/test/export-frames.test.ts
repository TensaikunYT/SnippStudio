// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { ClipFrameCursor, CURSOR_GRACE, cursorEnd, FRAME_EPS, frameDue, staleClips, type FrameSource } from '../renderer/src/export/frame-cursor'

type Wrapped = NonNullable<ClipFrameCursor['current']>

/** A frame's timestamp as mediabunny gives it: its pts in the track's
 *  timescale, divided (ffmpeg's usual 60 fps timescale is 15360). */
const stamp = (k: number, fps: number, timescale = 15360): number => Math.round((k * timescale) / fps) / timescale

/** A stand-in decoder with mediabunny's `canvases(from, to)` rule: first the
 *  last frame starting at or before `from`, then each later one starting
 *  before `to`. With `pool`, its frames are painted on that many canvases in
 *  turn, as a CanvasSink's are (each canvas says which frame is on it now). */
class FakeSink implements FrameSource {
  calls: [number, number][] = []
  private readonly canvasesPool: { k: number }[]
  private nextCanvas = 0
  constructor(private readonly frames: number, private readonly fps: number, pool = 0) {
    this.canvasesPool = Array.from({ length: pool }, () => ({ k: -1 }))
  }
  async *canvases(from: number, to: number): AsyncGenerator<Wrapped, void, unknown> {
    this.calls.push([from, to])
    let k0 = 0
    for (let k = 0; k < this.frames; k++) if (stamp(k, this.fps) <= from) k0 = k
    for (let k = k0; k < this.frames && (k === k0 || stamp(k, this.fps) < to); k++) {
      let canvas: { k: number }
      if (this.canvasesPool.length) {
        canvas = this.canvasesPool[this.nextCanvas]
        this.nextCanvas = (this.nextCanvas + 1) % this.canvasesPool.length
        canvas.k = k
      } else canvas = { k }
      yield { canvas: canvas as unknown as HTMLCanvasElement, timestamp: stamp(k, this.fps), duration: 1 / this.fps }
    }
  }
}

const frameOf = (c: ClipFrameCursor): number => (c.current!.canvas as unknown as { k: number }).k
const clip = (start: number, inPoint: number, duration: number, extra: { speed?: number; transitionOut?: { duration: number } } = {}) => ({ start, inPoint, duration, ...extra })
/** The export's media time for a frame (exporter: t = rangeStart + i / fps; clipMediaAt: inPoint + (t - start) * speed). */
const mediaAt = (c: { start: number; inPoint: number; speed?: number }, i: number, fps: number): number => c.inPoint + (i / fps - c.start) * (c.speed ?? 1)

test('export frames: a trimmed clip of frame-aligned footage shows every frame once (no duplicate-then-skip judder)', async () => {
  const fps = 60
  // The auditor's case: start 3.2 s, in point 1.7 s, 60 fps footage in a 60 fps export.
  const c = clip(3.2, 1.7, 4)
  const sink = new FakeSink(60 * 20, fps)
  const cursor = new ClipFrameCursor(sink, c, 20)
  const first = Math.round(c.start * fps)
  let bareWrong = 0
  for (let i = first; i < first + 4 * fps; i++) {
    const local = mediaAt(c, i, fps)
    await cursor.seekTo(local)
    // Exactly frame-aligned: frame i - 90 (1.7 s = 102 frames, 3.2 s = 192).
    assert.equal(frameOf(cursor), i - 90, `frame ${i}`)
    // The old bare comparison would have shown the frame before here.
    if (!(stamp(i - 90, fps) <= local)) bareWrong++
  }
  assert.ok(bareWrong > 0, 'the float error this guards against is really there in this case')
  cursor.close()
})

test('export frames: frame-aligned clips at many places, 60 and 30 fps footage, pick the frame they land on', async () => {
  let seed = 12345
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  for (const footage of [60, 30]) {
    for (let n = 0; n < 60; n++) {
      const startF = rnd(60 * 600)
      const inF = rnd(60 * 60)
      const c = clip(startF / 60, inF / 60, 1)
      const sink = new FakeSink(footage * 120, footage)
      const cursor = new ClipFrameCursor(sink, c, 120)
      for (let i = startF; i < startF + 60; i++) {
        await cursor.seekTo(mediaAt(c, i, 60))
        // Media frame (in 60ths) i - startF + inF, on footage of `footage` fps.
        const want = Math.floor(((i - startF + inF) * footage) / 60)
        assert.equal(frameOf(cursor), want, `${footage} fps, clip at ${startF}/${inF}, frame ${i}`)
      }
      cursor.close()
    }
  }
})

test('export frames: the slack is far under a frame and does not move frames of footage that is not aligned', async () => {
  assert.ok(FRAME_EPS < 1 / 240 / 1000)
  assert.equal(frameDue(1, 1 - 1e-12), true, 'a few ulps under: due')
  assert.equal(frameDue(1, 1 - 1e-4), false, 'a tenth of a millisecond under: not yet')
  // 29.97 fps footage in a 30 fps export: the frame shown is the last one started.
  const fps = 30000 / 1001
  const sink = new FakeSink(3000, fps)
  const cursor = new ClipFrameCursor(sink, clip(0, 0, 60), 100)
  for (let i = 0; i < 900; i++) {
    const t = i / 30
    await cursor.seekTo(t)
    let want = 0
    for (let k = 0; k < 3000; k++) if (stamp(k, fps) <= t + 1e-9) want = k
    assert.equal(frameOf(cursor), want, `frame ${i}`)
  }
  cursor.close()
})

test('export frames: the decoder runs to the end of an outgoing transition at the clip own speed (no frozen tail)', async () => {
  // Speed 2, a 1 s slide pushed after the cut (post = 1 s): the tail needs
  // media up to inPoint + (duration + post) * speed = 10 + 10 = 20 s.
  const c = clip(0, 10, 4, { speed: 2, transitionOut: { duration: 1 } })
  assert.ok(cursorEnd(c, 100) >= 10 + (4 + 1) * 2, `end ${cursorEnd(c, 100)}`)
  assert.equal(cursorEnd(c, 15), 15, 'never past the file')
  // Every alignment (post at most the duration) and speeds up to 16x are covered.
  for (const speed of [0.25, 0.5, 1, 1.5, 2, 3, 4, 8, 16])
    for (const d of [0.2, 0.5, 1, 2.2, 4])
      for (const post of [0, d / 2, d]) {
        const k = clip(5, 3, 6, { speed, transitionOut: { duration: d } })
        assert.ok(cursorEnd(k, 1e6) >= k.inPoint + (k.duration + post) * speed, `speed ${speed}, d ${d}, post ${post}`)
      }
  // The cursor asks the decoder for exactly that, offset into the track's time.
  const sink = new FakeSink(60 * 100, 60)
  const cursor = new ClipFrameCursor(sink, c, 100, 0.25)
  const fps = 60
  // Through the clip and its whole tail: the picture keeps moving to the last frame.
  let last = -1
  for (let i = 0; i < (4 + 1) * fps; i++) {
    await cursor.seekTo(mediaAt(c, i, fps))
    const f = frameOf(cursor)
    assert.ok(f > last, `frame ${i} moved on (${f} after ${last})`)
    last = f
  }
  assert.equal(sink.calls.length, 1)
  assert.ok(Math.abs(sink.calls[0][1] - (cursorEnd(c, 100) + 0.25)) < 1e-9)
  assert.ok(Math.abs(sink.calls[0][0] - (10 + 0.25 + FRAME_EPS)) < 1e-9, 'it starts where the clip does')
  cursor.close()
})

test('export frames: a cursor on a two-canvas pool of its own never shows another frame than its own', async () => {
  // A CanvasSink's pool belongs to the sink: the cursor holds two frames
  // (now and next), so a pool of two is enough for one cursor alone.
  const fps = 60
  const a = clip(0, 0, 3)
  const b = clip(0, 1, 3)
  const own = [new FakeSink(600, fps, 2), new FakeSink(600, fps, 2)]
  const ca = new ClipFrameCursor(own[0], a, 10)
  const cb = new ClipFrameCursor(own[1], b, 10)
  for (let i = 0; i < 120; i++) {
    await cb.seekTo(mediaAt(b, i, fps))
    await ca.seekTo(mediaAt(a, i, fps))
    assert.equal(frameOf(ca), i)
    assert.equal(frameOf(cb), i + 60)
  }
  // One pool shared by both (what frameDrawer used to do per file): their
  // pictures paint over each other.
  const shared = new FakeSink(600, fps, 2)
  const sa = new ClipFrameCursor(shared, a, 10)
  const sb = new ClipFrameCursor(shared, b, 10)
  let wrong = 0
  for (let i = 0; i < 120; i++) {
    await sb.seekTo(mediaAt(b, i, fps))
    await sa.seekTo(mediaAt(a, i, fps))
    if (frameOf(sa) !== i || frameOf(sb) !== i + 60) wrong++
  }
  assert.ok(wrong > 0, 'a shared pool really does mix the two up')
})

test('export frames: a clip off screen past the grace lets its decoder go; one just gone keeps it', () => {
  const seen = new Map<string, number>([
    ['a', 1.0],
    ['b', 2.0],
    ['c', 2.4]
  ])
  assert.deepEqual(staleClips(seen, 2.45), ['a'])
  assert.deepEqual([...seen.keys()], ['b', 'c'], 'the stale one is forgotten')
  // Seen this frame: never stale.
  seen.set('b', 3)
  assert.deepEqual(staleClips(seen, 3), ['c'])
  assert.deepEqual(staleClips(seen, 3 + CURSOR_GRACE), [], 'exactly the grace: kept')
  assert.deepEqual(staleClips(seen, 3 + CURSOR_GRACE + 0.01), ['b'])
  assert.equal(seen.size, 0)
})

test('export frames: a cursor let go and made again later picks up the right frame', async () => {
  const fps = 60
  const c = clip(0, 2, 10)
  const sink = new FakeSink(60 * 20, fps)
  const first = new ClipFrameCursor(sink, c, 20)
  await first.seekTo(mediaAt(c, 30, fps))
  assert.equal(frameOf(first), 150)
  first.close()
  const again = new ClipFrameCursor(sink, c, 20)
  for (const i of [200, 201, 260]) {
    await again.seekTo(mediaAt(c, i, fps))
    assert.equal(frameOf(again), i + 120)
  }
  again.close()
})
