// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The GIF writer (KOLAY-PLAN.md, item 1): a file a decoder reads back, the
// picture's colours kept when they are few, near when they are many, the
// delays adding up to the length, a repeated frame folded into the one before,
// the sizes and rates the window offers.
import assert from 'node:assert/strict'
import test from 'node:test'
import { GifWriter, gifDelay, gifSize, gifWidths, quantize, GIF_RATES } from '../renderer/src/export/gif'

interface Frame { delay: number; rgb: Uint8Array }

/** A plain GIF89a reader: the frames' delays and their pixels (RGB). */
function decode(bytes: Uint8Array): { w: number; h: number; loop: boolean; frames: Frame[] } {
  let p = 0
  const u8 = (): number => bytes[p++]
  const u16 = (): number => bytes[p++] | (bytes[p++] << 8)
  const head = String.fromCharCode(...bytes.subarray(0, 6))
  assert.equal(head, 'GIF89a')
  p = 6
  const w = u16()
  const h = u16()
  const flags = u8()
  p += 2
  assert.equal(flags & 0x80, 0, 'no global palette')
  let loop = false
  let delay = 0
  const frames: Frame[] = []
  const blocks = (): Uint8Array => {
    const parts: number[] = []
    for (let n = u8(); n; n = u8()) for (let i = 0; i < n; i++) parts.push(u8())
    return Uint8Array.from(parts)
  }
  for (;;) {
    const b = u8()
    if (b === 0x3b) break
    if (b === 0x21) {
      const label = u8()
      const data = blocks()
      if (label === 0xff) loop = true
      if (label === 0xf9) delay = data[1] | (data[2] << 8)
      continue
    }
    assert.equal(b, 0x2c, `an image at ${p - 1}`)
    p += 8
    const f = u8()
    assert.ok(f & 0x80, 'a local palette')
    const n = 2 << (f & 7)
    const pal = bytes.subarray(p, p + n * 3)
    p += n * 3
    const min = u8()
    const data = blocks()
    // LZW decode.
    const clear = 1 << min
    const out: number[] = []
    let size = min + 1
    let dict: number[][] = []
    const resetDict = (): void => {
      dict = []
      for (let i = 0; i < clear; i++) dict.push([i])
      dict.push([], [])
      size = min + 1
    }
    resetDict()
    let bit = 0
    let prev: number[] | null = null
    for (;;) {
      let code = 0
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i
      if (code === clear) {
        resetDict()
        prev = null
        continue
      }
      if (code === clear + 1) break
      let entry: number[]
      if (code < dict.length) entry = dict[code]
      else entry = [...prev!, prev![0]]
      out.push(...entry)
      if (prev) dict.push([...prev, entry[0]])
      prev = entry
      if (dict.length === 1 << size && size < 12) size++
    }
    assert.equal(out.length, w * h, 'every pixel')
    const rgb = new Uint8Array(w * h * 3)
    out.forEach((ix, i) => rgb.set(pal.subarray(ix * 3, ix * 3 + 3), i * 3))
    frames.push({ delay, rgb })
  }
  return { w, h, loop, frames }
}

const solid = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Uint8Array => {
  const a = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fill(x, y)
      a.set([r, g, b, 255], (y * w + x) * 4)
    }
  return a
}

test('gif: a few colours come back exactly; the delays add up; it loops', () => {
  const w = 37
  const h = 21
  const g = new GifWriter(w, h)
  const colours: [number, number, number][] = [[255, 0, 0], [0, 128, 255], [250, 250, 250], [17, 33, 99]]
  for (let k = 0; k < 4; k++) g.add(solid(w, h, (x, y) => colours[(x + y + k) % 4]), gifDelay(k, 15))
  const d = decode(g.finish())
  assert.equal(d.w, w)
  assert.equal(d.h, h)
  assert.ok(d.loop)
  assert.equal(d.frames.length, 4)
  assert.deepEqual(d.frames.map((f) => f.delay), [7, 6, 7, 7])
  for (let k = 0; k < 4; k++)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) assert.deepEqual([...d.frames[k].rgb.subarray((y * w + x) * 3, (y * w + x) * 3 + 3)], colours[(x + y + k) % 4])
})

test('gif: a picture of many colours (more codes than the table holds) is read back near', () => {
  const w = 160
  const h = 120
  const px = solid(w, h, (x, y) => [(x * 7 + y) & 255, (y * 5 + x * 3) & 255, (x * y) & 255])
  const g = new GifWriter(w, h)
  g.add(px, 10)
  const d = decode(g.finish())
  let err = 0
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) err += Math.abs(d.frames[0].rgb[i * 3 + c] - px[i * 4 + c])
  const mean = err / (w * h * 3)
  assert.ok(mean < 12, `the mean error is ${mean.toFixed(2)} of 255`)
})

test('gif: the same frame again lengthens the one before; the same input gives the same bytes', () => {
  const w = 8
  const h = 8
  const a = solid(w, h, () => [10, 20, 30])
  const b = solid(w, h, (x) => (x < 4 ? [200, 0, 0] : [0, 200, 0]))
  const make = (): Uint8Array => {
    const g = new GifWriter(w, h)
    g.add(a, 7)
    g.add(a, 6)
    g.add(b, 7)
    assert.equal(g.frames, 1)
    const out = g.finish()
    assert.equal(g.frames, 2)
    assert.equal(g.ticks, 20)
    return out
  }
  const one = make()
  assert.deepEqual(decode(one).frames.map((f) => f.delay), [13, 7])
  assert.deepEqual(make(), one)
})

test('gif: the delays at every rate offered add up to the length', () => {
  for (const fps of GIF_RATES) {
    let sum = 0
    for (let k = 0; k < fps * 7; k++) {
      const d = gifDelay(k, fps)
      assert.ok(d >= 4, `${fps} fps: a delay of ${d} cs`)
      sum += d
    }
    assert.equal(sum, 700, `${fps} fps for 7 s`)
  }
})

test('gif: the widths offered and the size kept in proportion', () => {
  assert.deepEqual(gifWidths(1920), [240, 320, 480, 640, 800])
  assert.deepEqual(gifWidths(500), [240, 320, 480])
  assert.deepEqual(gifWidths(100), [240])
  assert.deepEqual(gifSize(1920, 1080, 480), { w: 480, h: 270 })
  assert.deepEqual(gifSize(1080, 1920, 480), { w: 480, h: 854 })
  const q = quantize(solid(2, 2, () => [1, 2, 3]), 4)
  assert.deepEqual([...q.palette.subarray(0, 3)], [1, 2, 3])
})
