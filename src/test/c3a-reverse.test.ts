// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a, decision 7 (report R7, R27): a reversed clip decodes a stretch
// forward once and hands its frames out backwards.
import assert from 'node:assert/strict'
import test from 'node:test'
import { ReverseCursor, type FrameSource } from '../renderer/src/export/frame-cursor'

type Wrapped = Parameters<ConstructorParameters<typeof ReverseCursor>[3]>[0]

/** mediabunny's `canvases(from, to)`: from the frame showing at `from`, each
 *  frame starting before `to`; counts the frames it decodes (from the key
 *  frame before `from`, every `gop` frames). */
class Sink implements FrameSource {
  decoded = 0
  constructor(private readonly frames: number, private readonly fps: number, private readonly gop: number) {}
  async *canvases(from: number, to: number): AsyncGenerator<Wrapped, void, unknown> {
    const at = (k: number): number => Math.round((k * 15360) / this.fps) / 15360
    let k0 = 0
    for (let k = 0; k < this.frames; k++) if (at(k) <= from) k0 = k
    this.decoded += k0 - Math.floor(k0 / this.gop) * this.gop
    for (let k = k0; k < this.frames && (k === k0 || at(k) < to); k++) {
      this.decoded++
      yield { canvas: { k } as unknown as HTMLCanvasElement, timestamp: at(k), duration: 1 / this.fps }
    }
  }
}

test('a reversed clip: every frame backwards from the last, each the right one', async () => {
  const fps = 30
  const sink = new Sink(300, fps, 120)
  const r = new ReverseCursor(sink, 9, 1 / fps, (src) => (src.canvas as unknown as { k: number }).k)
  const got: number[] = []
  // From the last frame (299, which starts at 9.9667 s: reachable) down to 0.
  for (let i = 0; i < 300; i++) got.push((await r.frameAt(299 / fps - i / fps + 1e-6))!)
  assert.deepEqual(got, Array.from({ length: 300 }, (_, i) => 299 - i))
  // About one stretch per nine frames (not one decode from the key frame
  // per frame): 34 stretches.
  assert.ok(r.decodes <= 35, `${r.decodes} stretches`)
  // Decoded frames: the old way read from the key frame for every frame
  // (≈ 60 a frame on a 4 s GOP); this reads fewer than 8 a frame.
  assert.ok(sink.decoded / 300 < 8, `${(sink.decoded / 300).toFixed(1)} decoded a frame`)
})

test('a reversed clip at twice the speed, and one at a 24 fps output of 30 fps footage', async () => {
  for (const [step, outFps] of [[2, 30], [1, 24]] as const) {
    const sink = new Sink(300, 30, 30)
    const r = new ReverseCursor(sink, 9, 1 / 30, (src) => (src.canvas as unknown as { k: number }).k)
    for (let i = 0; i < 100; i++) {
      const t = 9.9 - (i * step) / outFps
      if (t < 0) break
      const want = Math.floor(t * 30 + 1e-6)
      assert.equal(await r.frameAt(t + 1e-6), want, `t ${t.toFixed(4)}`)
    }
  }
})

test('the first frame is reachable; before it, nothing', async () => {
  const r = new ReverseCursor(new Sink(30, 30, 30), 4, 1 / 30, (src) => (src.canvas as unknown as { k: number }).k)
  assert.equal(await r.frameAt(0.0001), 0)
  assert.equal(await r.frameAt(-0.5), null)
})
