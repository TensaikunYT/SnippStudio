// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D (tarifler\CILA.md "D"): the pixel pass as arithmetic
// (playback/draw/fx-math.ts, the CPU path; the shader is its twin and e2e 96
// compares their pictures) and the LUT tables (playback/draw/lut-table.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLUR_WEIGHTS,
  blurBufferSize,
  brightBlur,
  cbcr,
  chromaDir,
  despill,
  gradeColor,
  isolateKeep,
  keyAlpha,
  luma709,
  lutTrilinear,
  pixelPassCpu,
  type FxParams,
  type LutTable
} from '../renderer/src/playback/draw/fx-math'
import {
  LUT_PRESETS,
  PRESET_PREFIX,
  cubeText,
  lutFor,
  lutKeyOf,
  lutKind,
  lutMissing,
  lutRegistry,
  parseCube,
  setDeclaredLuts,
  setLocalLut,
  setLutHover,
  setProjectLut,
  tableOf
} from '../renderer/src/playback/draw/lut-table'

const NONE: FxParams = { chroma: null, lut: null, duotone: null, sharpen: 0, vignette: 0, grain: 0, cab: 0, time: 0 }
/** A picture of w × h whose pixel (x, y) is `at(x, y)` (RGBA). */
const picture = (w: number, h: number, at: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(at(x, y), (y * w + x) * 4)
  return d
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number): number[] => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)]
const identity = (n: number): LutTable => tableOf((c) => c, n)

// ---- LUT: trilinear, amount --------------------------------------------------------

test('LUT: an identity table gives every colour back (between its entries too)', () => {
  const out = [0, 0, 0]
  for (const n of [2, 5, 17, 33]) {
    const lut = identity(n)
    for (const c of [[0, 0, 0], [1, 1, 1], [0.123, 0.456, 0.789], [0.999, 0.001, 0.5], [0.3333, 0.6667, 0.0101]]) {
      lutTrilinear(lut, c[0], c[1], c[2], out)
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(out[i] - c[i]) < 1e-6, `n ${n}: ${c} → ${out}`)
    }
  }
})

test('LUT: a grey ramp through a small table keeps its steps (nearest gave 17 bands)', () => {
  // A 17³ table of a gamma: 256 greys in, and what comes out is the curve
  // itself to within what a straight line between two entries misses.
  const lut = tableOf((c) => [Math.pow(c[0], 0.8), Math.pow(c[1], 0.8), Math.pow(c[2], 0.8)], 17)
  const d = picture(256, 1, (x) => [x, x, x, 255])
  pixelPassCpu(d, 256, 1, { ...NONE, lut: { ...lut, id: 'g' } })
  const levels = new Set<number>()
  let worst = 0
  for (let x = 0; x < 256; x++) {
    levels.add(d[x * 4])
    // (Past the table's first entry: a line from 0 misses a power curve most there.)
    if (x >= 16) worst = Math.max(worst, Math.abs(d[x * 4] - Math.pow(x / 255, 0.8) * 255))
    if (x > 0) assert.ok(d[x * 4] >= d[(x - 1) * 4], `the ramp rises at ${x}`)
  }
  assert.ok(levels.size > 200, `${levels.size} levels (nearest neighbour: 17)`)
  assert.ok(worst <= 1.5, `off the curve by ${worst.toFixed(2)} levels at most`)
})

test('LUT: its amount mixes it in (0 the picture, 1 the LUT, a half halfway)', () => {
  const lut = { ...tableOf((c) => [1 - c[0], 1 - c[1], 1 - c[2]], 9), id: 'inv' }
  const src = (): Uint8ClampedArray => picture(4, 1, (x) => [40 * x, 200, 10 + x, 255])
  const run = (lutAmount?: number): Uint8ClampedArray => {
    const d = src()
    pixelPassCpu(d, 4, 1, { ...NONE, lut, lutAmount })
    return d
  }
  assert.deepEqual([...run(0)], [...src()], 'amount 0: untouched')
  assert.deepEqual(px(run(), 4, 1, 0), [215, 55, 244, 255], 'unset: all of it')
  assert.deepEqual(px(run(1), 4, 1, 0), [215, 55, 244, 255])
  const half = px(run(0.5), 4, 1, 0)
  assert.ok(Math.abs(half[0] - 127.5) <= 1 && Math.abs(half[1] - 127.5) <= 1 && Math.abs(half[2] - 127.5) <= 1, `halfway: ${half}`)
})

test('.cube: a table written out reads back the same; a wrong one is refused', () => {
  const t = tableOf(LUT_PRESETS[0].look, 5)
  const back = parseCube(cubeText(t))
  assert.equal(back.n, 5)
  for (let i = 0; i < t.data.length; i++) assert.ok(Math.abs(back.data[i] - t.data[i]) < 1e-5)
  assert.throws(() => parseCube('LUT_3D_SIZE 3\n0 0 0\n'), /Not a valid/)
  assert.throws(() => parseCube('LUT_1D_SIZE 16\n'), /1D/)
})

// ---- the built-in looks and the registry -------------------------------------------------

test('looks: eight, made by code, each a table of colours in range', () => {
  assert.equal(LUT_PRESETS.length, 8)
  assert.equal(new Set(LUT_PRESETS.map((p) => p.id)).size, 8)
  for (const p of LUT_PRESETS) {
    const lut = lutFor(PRESET_PREFIX + p.id)
    assert.ok(lut, p.id)
    assert.equal(lut!.n, 33)
    assert.equal(lut!.data.length, 33 * 33 * 33 * 3)
    for (const v of lut!.data) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${p.id}: ${v}`)
    // Not the identity: black to white changes somewhere on the way.
    const out = [0, 0, 0]
    let moved = 0
    for (const c of [[0.2, 0.4, 0.8], [0.8, 0.5, 0.3], [0.5, 0.5, 0.5]]) {
      lutTrilinear(lut!, c[0], c[1], c[2], out)
      moved += Math.abs(out[0] - c[0]) + Math.abs(out[1] - c[1]) + Math.abs(out[2] - c[2])
    }
    assert.ok(moved > 0.02, `${p.id} changes the picture`)
    assert.equal(lutFor(PRESET_PREFIX + p.id), lut, 'made once')
  }
  const mono = [0, 0, 0]
  lutTrilinear(lutFor('preset:monoContrast')!, 0.9, 0.2, 0.1, mono)
  assert.ok(Math.abs(mono[0] - mono[1]) < 1e-6 && Math.abs(mono[1] - mono[2]) < 1e-6, 'black and white is grey')
  assert.equal(lutFor('preset:nope'), null)
})

test('a project LUT is its file and nothing else; a name of this computer works on; the hover is the preview’s', () => {
  const t = identity(2)
  setDeclaredLuts([])
  setLocalLut('Old', t)
  assert.ok(lutFor('Old'), 'a LUT kept on this computer is found by its name')
  assert.equal(lutKind('Old'), 'local')
  assert.equal(lutMissing('Old'), false)
  assert.equal(lutMissing('Gone'), true, 'a name nothing knows is missing')
  assert.equal(lutMissing(undefined), false)

  // The project declares "Old" as one of its files, and the file is not read:
  // the local one of the same name does not stand in.
  setDeclaredLuts(['Old', 'Film'])
  assert.equal(lutFor('Old'), null)
  assert.equal(lutMissing('Old'), true)
  assert.equal(lutKind('Old'), 'project')
  setProjectLut('Film', t)
  assert.ok(lutFor('Film'))
  assert.equal(lutRegistry.has('Film'), true, 'only this window holds it')
  assert.equal(lutRegistry.has('preset:cool'), false, 'a look is made in any window')
  const first = lutFor('Film')!.id
  setProjectLut('Film', t)
  assert.notEqual(lutFor('Film')!.id, first, 'a file read again is another table for the GPU')
  setProjectLut('Film', null)
  assert.equal(lutMissing('Film'), true)
  setDeclaredLuts([])
  assert.ok(lutFor('Old'), 'no longer declared: the local one again')
  setLocalLut('Old', null)

  const clip = { id: 'c1', lut: 'preset:cool' }
  setLutHover({ clipId: 'c1', lut: 'preset:night' })
  assert.equal(lutKeyOf(clip, false), 'preset:night', 'the preview shows the look pointed at')
  assert.equal(lutKeyOf(clip, true), 'preset:cool', 'a frame in final quality (the export) never does')
  assert.equal(lutKeyOf({ id: 'c2', lut: 'x' }, false), 'x', 'another clip is not touched')
  setLutHover({ clipId: 'c1', lut: null })
  assert.equal(lutKeyOf(clip, false), undefined, 'pointing at "none" shows the picture without its LUT')
  setLutHover(null)
  assert.equal(lutKeyOf(clip, false), 'preset:cool')
})

// ---- nothing new, nothing changed -------------------------------------------------------

test('a pass with nothing asked leaves every pixel as it is (the new fields default to nothing)', () => {
  const src = picture(7, 5, (x, y) => [x * 36, y * 60, (x * y * 11) % 256, 255 - x * 20])
  for (const p of [NONE, { ...NONE, lutAmount: 1, grade: { exposure: 0, tint: 0, highlights: 0, shadows: 0 }, mosaic: 0, isolate: null, bloom: null, halation: null }, { ...NONE, mosaic: 1, bloom: { amount: 0, threshold: 0.6, radius: 8 }, halation: { amount: 0, radius: 8 }, isolate: { key: [255, 0, 0] as [number, number, number], range: 0.1, amount: 0 } }]) {
    const d = new Uint8ClampedArray(src)
    pixelPassCpu(d, 7, 5, p)
    assert.deepEqual([...d], [...src])
  }
})

test('the effects there were draw as they did: vignette, duotone, the first keyer', () => {
  // Vignette 0.5 on a white 9 × 9: the centre untouched, a corner darker by the old formula.
  const d = picture(9, 9, () => [200, 200, 200, 255])
  pixelPassCpu(d, 9, 9, { ...NONE, vignette: 0.5 })
  assert.deepEqual(px(d, 9, 4, 4), [200, 200, 200, 255])
  const dist = Math.hypot(0 - 4.5, 0 - 4.5) / Math.hypot(4.5, 4.5)
  assert.equal(px(d, 9, 0, 0)[0], Math.round(200 * (1 - 0.5 * Math.max(0, dist - 0.35) * 1.6)))
  // Duotone black → white is the 601 luma.
  const duo = picture(1, 1, () => [200, 100, 50, 255])
  pixelPassCpu(duo, 1, 1, { ...NONE, duotone: { dark: [0, 0, 0], light: [255, 255, 255] } })
  assert.equal(duo[0], Math.round(200 * 0.299 + 100 * 0.587 + 50 * 0.114))
  // The first keyer: RGB distance, a linear edge.
  const key = picture(3, 1, (x) => (x === 0 ? [0, 208, 0, 255] : x === 1 ? [60, 208, 0, 255] : [200, 150, 120, 255]))
  pixelPassCpu(key, 3, 1, { ...NONE, chroma: { key: [0, 208, 0], sim: 50, smooth: 40, mode: 0 } })
  assert.equal(key[3], 0, 'the key colour is gone')
  assert.equal(key[7], Math.round(255 * ((60 - 50) / 40)), 'the edge is linear')
  assert.equal(key[11], 255, 'skin stays')
  assert.deepEqual([key[4], key[5], key[6]], [60, 208, 0], 'the first keyer does not touch colours')
})

test('the first keyer measures the SOURCE colour, with a LUT on too (the CPU path measured the graded one)', () => {
  // A LUT that turns everything red: the green screen must still be keyed.
  const lut = { ...tableOf(() => [1, 0, 0], 2), id: 'red' }
  const d = picture(2, 1, (x) => (x === 0 ? [0, 208, 0, 255] : [255, 0, 0, 255]))
  pixelPassCpu(d, 2, 1, { ...NONE, lut, chroma: { key: [0, 208, 0], sim: 50, smooth: 40, mode: 0 } })
  assert.equal(d[3], 0, 'the green pixel is keyed although the LUT made it red')
  assert.equal(d[7], 255, 'the red pixel stays although it now equals what the green one became')
})

// ---- the chroma keyer ----------------------------------------------------------------

test('chroma keyer: the screen goes, its shadow too; skin, white, grey and black stay', () => {
  const [kcb, kcr] = cbcr(0, 208 / 255, 0)
  // (The dials' 0..1 is halved into the plane's units: pixel-fx.ts fxParamsFor.)
  const a = (r: number, g: number, b: number, sim = 0.4): number => keyAlpha(r / 255, g / 255, b / 255, kcb, kcr, sim * 0.5, 0.1 * 0.5)
  assert.equal(a(0, 208, 0), 0, 'the key colour')
  assert.equal(a(20, 190, 30), 0, 'a little off it')
  assert.equal(a(0, 150, 0), 0, 'the screen less lit')
  assert.equal(a(0, 110, 0, 0.6), 0, 'the screen in shadow, with more similarity')
  for (const sim of [0.4, 0.6, 0.8]) for (const c of [[230, 180, 150], [255, 255, 255], [128, 128, 128], [0, 0, 0], [200, 30, 40], [40, 60, 200]]) assert.equal(a(c[0], c[1], c[2], sim), 1, `${c} stays at similarity ${sim}`)
  const edge = a(0, 112, 0)
  assert.ok(edge > 0 && edge < 1, `an edge colour is in between (${edge})`)
})

test('despill: a green cast turns neutral, other colours and the luma stay', () => {
  const dir = chromaDir([0, 208, 0])
  const out = [0, 0, 0]
  // White with green spilled on it.
  despill(0.75, 0.95, 0.75, dir[0], dir[1], 1, out)
  assert.ok(Math.abs(out[0] - out[1]) < 0.01 && Math.abs(out[1] - out[2]) < 0.01, `neutral: ${out}`)
  assert.ok(Math.abs(luma709(out[0], out[1], out[2]) - luma709(0.75, 0.95, 0.75)) < 1e-6, 'as bright as it was')
  // Half the dial: half the way.
  despill(0.75, 0.95, 0.75, dir[0], dir[1], 0.5, out)
  assert.ok(out[1] - out[0] > 0.05 && out[1] - out[0] < 0.15, `half: ${out}`)
  // Skin, red, blue, yellow, cyan: not the key's side of the plane, or far enough from it.
  for (const c of [[0.9, 0.7, 0.6], [0.8, 0.1, 0.1], [0.1, 0.2, 0.8], [0.9, 0.9, 0.1], [0.1, 0.8, 0.8], [0.5, 0.5, 0.5]]) {
    despill(c[0], c[1], c[2], dir[0], dir[1], 1, out)
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(out[i] - c[i]) < 1e-6, `${c} untouched (${out})`)
  }
})

test('chroma keyer in the pass: alpha from the source, the cast off what stays', () => {
  const d = picture(3, 1, (x) => (x === 0 ? [0, 208, 0, 255] : x === 1 ? [190, 240, 190, 255] : [230, 180, 150, 200]))
  pixelPassCpu(d, 3, 1, { ...NONE, chroma: { key: [0, 208, 0], sim: 0.15, smooth: 0.05, mode: 1, spill: 1 } })
  assert.equal(d[3], 0)
  assert.equal(d[7], 255, 'the spilled white stays')
  assert.ok(Math.abs(d[4] - d[5]) <= 1 && Math.abs(d[5] - d[6]) <= 1, `and is neutral: ${px(d, 3, 1, 0)}`)
  assert.deepEqual(px(d, 3, 2, 0), [230, 180, 150, 200], 'skin and its own alpha untouched')
})

// ---- colour dials --------------------------------------------------------------------

test('colour dials: nothing at 0; exposure in stops with a shoulder; highlights and shadows keep black, white and the order', () => {
  const v = [0.2, 0.5, 0.8]
  gradeColor(v, 0, 0, 0, 0)
  assert.deepEqual(v, [0.2, 0.5, 0.8])
  // One stop up: brighter, never over white, order kept.
  let last = -1
  for (let i = 0; i <= 100; i++) {
    const c = [i / 100, i / 100, i / 100]
    gradeColor(c, 1, 0, 0, 0)
    assert.ok(c[0] >= i / 100 - 1e-9 && c[0] <= 1 + 1e-9, `${i}: ${c[0]}`)
    assert.ok(c[0] >= last - 1e-9, `rises at ${i}`)
    last = c[0]
  }
  // One stop down is a half in linear light.
  const down = [0.5, 0.5, 0.5]
  gradeColor(down, -1, 0, 0, 0)
  assert.ok(Math.abs(Math.pow(down[0], 2.2) - Math.pow(0.5, 2.2) / 2) < 1e-9)
  // Tint: + is magenta (less green), − is green.
  const m = [0.5, 0.5, 0.5]
  gradeColor(m, 0, 1, 0, 0)
  assert.ok(m[1] < 0.5 && m[0] > 0.5 && m[2] > 0.5)
  // Highlights and shadows, at every strength: the grey ramp keeps rising, black stays black.
  for (const [hi, sh] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    let prev = -1
    for (let i = 0; i <= 200; i++) {
      const c = [i / 200, i / 200, i / 200]
      gradeColor(c, 0, 0, hi, sh)
      assert.ok(c[0] >= prev - 1e-9, `hi ${hi} sh ${sh}: rises at ${i} (${prev} → ${c[0]})`)
      prev = c[0]
      if (i === 0) assert.equal(c[0], 0)
      if (i === 200) assert.ok(Math.abs(c[0] - 1) < 1e-9, 'white stays')
    }
  }
  const lifted = [0.2, 0.2, 0.2]
  gradeColor(lifted, 0, 0, 0, 1)
  assert.ok(lifted[0] > 0.25, 'shadows up lifts the dark tones')
  const tamed = [0.8, 0.8, 0.8]
  gradeColor(tamed, 0, 0, -1, 0)
  assert.ok(tamed[0] < 0.7, 'highlights down brings the bright tones in')
})

// ---- mosaic, colour isolate ------------------------------------------------------------

test('mosaic: the picture in cells, each of one colour', () => {
  const w = 16
  const d = picture(w, 8, (x, y) => [x * 16, y * 32, (x + y) * 8, 255])
  pixelPassCpu(d, w, 8, { ...NONE, mosaic: 4 })
  for (let y = 0; y < 8; y++) for (let x = 0; x < w; x++) assert.deepEqual(px(d, w, x, y), px(d, w, Math.floor(x / 4) * 4, Math.floor(y / 4) * 4), `(${x}, ${y}) is its cell's colour`)
  assert.notDeepEqual(px(d, w, 0, 0), px(d, w, 4, 0), 'neighbouring cells differ')
  // The cell's colour: the four taps around its middle.
  assert.equal(px(d, w, 0, 0)[0], Math.round((1 * 16 + 3 * 16 + 1 * 16 + 3 * 16) / 4))
})

test('colour isolate: the kept hue keeps its colour, the rest goes grey, by the amount', () => {
  const dir = chromaDir([224, 32, 32])
  assert.ok(isolateKeep(0.9, 0.1, 0.1, dir[0], dir[1], 0.08) > 0.99, 'red is kept')
  assert.ok(isolateKeep(0.8, 0.25, 0.2, dir[0], dir[1], 0.08) > 0.9, 'a red a little off too')
  assert.equal(isolateKeep(0.1, 0.8, 0.1, dir[0], dir[1], 0.08), 0, 'green is not')
  assert.equal(isolateKeep(0.1, 0.2, 0.9, dir[0], dir[1], 0.08), 0, 'blue is not')
  assert.equal(isolateKeep(0.5, 0.5, 0.5, dir[0], dir[1], 0.08), 0, 'a grey has no hue')
  const d = picture(2, 1, (x) => (x === 0 ? [230, 30, 30, 255] : [30, 200, 60, 255]))
  pixelPassCpu(d, 2, 1, { ...NONE, isolate: { key: [224, 32, 32], range: 0.08, amount: 1 } })
  assert.deepEqual(px(d, 2, 0, 0), [230, 30, 30, 255])
  const g = px(d, 2, 1, 0)
  assert.ok(g[0] === g[1] && g[1] === g[2], `grey: ${g}`)
  assert.equal(g[0], Math.round(luma709(30, 200, 60)))
  const half = picture(1, 1, () => [30, 200, 60, 255])
  pixelPassCpu(half, 1, 1, { ...NONE, isolate: { key: [224, 32, 32], range: 0.08, amount: 0.5 } })
  assert.ok(half[1] < 200 && half[1] > g[1], 'half the amount: half the way')
})

// ---- glow and halation ----------------------------------------------------------------

test('blur: its weights sum to one; its buffer is half the pass, smaller for a wide radius', () => {
  assert.ok(Math.abs(BLUR_WEIGHTS.reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.equal(BLUR_WEIGHTS.length, 17)
  assert.deepEqual(blurBufferSize(1920, 1080, 20), { bw: 960, bh: 540, rb: 10 })
  const wide = blurBufferSize(1920, 1080, 80)
  assert.equal(wide.bw, 384)
  assert.ok(Math.abs(wide.rb - 16) < 1e-9, 'the taps stay within two texels of each other')
})

test('glow: light spills out of the bright parts, nothing gets darker, dark pictures are left alone', () => {
  const w = 64
  const h = 64
  const scene = (): Uint8ClampedArray => picture(w, h, (x, y) => (x >= 28 && x < 36 && y >= 28 && y < 36 ? [255, 255, 255, 255] : [20, 20, 30, 255]))
  const src = scene()
  const d = scene()
  pixelPassCpu(d, w, h, { ...NONE, bloom: { amount: 1, threshold: 0.6, radius: 12 } })
  for (let i = 0; i < d.length; i += 4) assert.ok(d[i] >= src[i] && d[i + 1] >= src[i + 1] && d[i + 2] >= src[i + 2], 'no pixel darker')
  assert.ok(px(d, w, 26, 32)[0] > 40, `light beside the square: ${px(d, w, 26, 32)}`)
  assert.ok(px(d, w, 26, 32)[0] > px(d, w, 20, 32)[0], 'fading with distance')
  assert.deepEqual(px(d, w, 2, 2), [20, 20, 30, 255], 'far from it: untouched')
  assert.equal(px(d, w, 32, 32)[3], 255)
  // A picture with nothing above the threshold.
  const dark = picture(16, 16, (x) => [60 + x, 60, 60, 255])
  const before = new Uint8ClampedArray(dark)
  pixelPassCpu(dark, 16, 16, { ...NONE, bloom: { amount: 1, threshold: 0.8, radius: 6 } })
  assert.deepEqual([...dark], [...before])
  // The blur buffer itself: brightest in the middle, symmetric.
  const b = brightBlur(scene(), w, h, 0.6, 12)
  const at = (x: number, y: number): number => b.buf[(y * b.bw + x) * 4]
  assert.ok(at(16, 16) >= at(12, 16) && at(12, 16) >= at(8, 16))
  assert.ok(Math.abs(at(12, 16) - at(19, 16)) <= 1 && Math.abs(at(16, 12) - at(16, 19)) <= 1, 'the same either side')
})

test('halation: a warm halo — red most, blue least — around the highlights', () => {
  const w = 48
  const d = picture(w, w, (x, y) => (x >= 20 && x < 28 && y >= 20 && y < 28 ? [255, 255, 255, 255] : [0, 0, 0, 255]))
  pixelPassCpu(d, w, w, { ...NONE, halation: { amount: 1, radius: 10 } })
  const p = px(d, w, 17, 24)
  assert.ok(p[0] > 20 && p[0] > p[1] * 2 && p[1] > p[2], `beside the light: ${p}`)
  assert.deepEqual(px(d, w, 1, 1), [0, 0, 0, 255])
})

test('transparent pixels neither glow nor are counted as bright', () => {
  const w = 32
  const d = picture(w, w, (x) => (x < 16 ? [255, 255, 255, 0] : [10, 10, 10, 255]))
  pixelPassCpu(d, w, w, { ...NONE, bloom: { amount: 1, threshold: 0.5, radius: 8 } })
  assert.ok(px(d, w, 20, 16)[0] <= 12, `the clear half lights nothing: ${px(d, w, 20, 16)}`)
  assert.equal(px(d, w, 4, 16)[3], 0)
})
