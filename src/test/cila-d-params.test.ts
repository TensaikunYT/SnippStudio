// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Cila" part D: what the pixel pass is asked to do for a clip
// (playback/draw/pixel-fx.ts fxParamsFor, the one description both paths are
// given), and which clips take the pass at all.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fxParamsFor, needsPixelFx } from '../renderer/src/playback/draw/pixel-fx'
import { setLutHover } from '../renderer/src/playback/draw/lut-table'
import { withDrawQuality } from '../renderer/src/playback/draw/quality'
import type { Clip } from '../renderer/src/types'

const clip = (extra: Partial<Clip> = {}): Clip => ({ id: 'c', assetId: 'a', trackId: 'v', start: 10, inPoint: 0, duration: 8, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...extra })

test('a clip made before part D does not take the pass; neutral new fields do not send it there either', () => {
  assert.equal(needsPixelFx(clip()), false)
  assert.equal(needsPixelFx(clip({ grade: { brightness: 1.2, contrast: 1, saturation: 1, warmth: 0 }, blur: 4, glow: 0.5 })), false, 'the grade, the blur and the first glow are drawn elsewhere, as before')
  assert.equal(needsPixelFx(clip({ tone: { exposure: 0, tint: 0, highlights: 0, shadows: 0 }, lutAmount: 0.5, bloom: { amount: 0, threshold: 0.6, radius: 0.4 }, halation: { amount: 0, size: 0.5 }, isolate: { color: '#ff0000', range: 0.1, amount: 0 } })), false)
  assert.equal(needsPixelFx(clip({ lut: 'a LUT this computer does not have' })), false, 'a missing LUT: drawn without it')
  for (const on of [{ tone: { exposure: 0.1, tint: 0, highlights: 0, shadows: 0 } }, { lut: 'preset:cool' }, { bloom: { amount: 0.2, threshold: 0.6, radius: 0.4 } }, { halation: { amount: 0.2, size: 0.5 } }, { mosaic: 12 }, { isolate: { color: '#ff0000', range: 0.1, amount: 1 } }, { vignette: 0.3 }] as Partial<Clip>[]) assert.equal(needsPixelFx(clip(on)), true, JSON.stringify(on))
  // An amount at nothing with keys on it: a key may bring it up later.
  assert.equal(needsPixelFx(clip({ fxKeys: { mosaic: [{ id: 'k', time: 4, value: 30 }] } })), true)
})

test('the first keyer is asked exactly as before; the chroma keyer in its plane’s units', () => {
  const old = fxParamsFor(clip({ chroma: { enabled: true, color: '#00d000', similarity: 0.35, smoothness: 0.12 } }), 12, 1920, 1920).chroma!
  assert.deepEqual(old, { key: [0, 208, 0], sim: 0.35 * 255, smooth: Math.max(1, 0.12 * 255), mode: 0 })
  assert.equal(fxParamsFor(clip({ chroma: { enabled: true, color: '#00d000', similarity: 0.35, smoothness: 0 } }), 12, 1920, 1920).chroma!.smooth, 1, 'its edge is never under a level wide')
  const now = fxParamsFor(clip({ chroma: { enabled: true, color: '#00d000', similarity: 0.4, smoothness: 0.1, method: 'chroma', spill: 0.5 } }), 12, 1920, 1920).chroma!
  assert.deepEqual(now, { key: [0, 208, 0], sim: 0.2, smooth: 0.05, mode: 1, spill: 0.5 })
  assert.equal(fxParamsFor(clip({ chroma: { enabled: false, color: '#00d000', similarity: 0.4, smoothness: 0.1 } }), 12, 1920, 1920).chroma, null)
})

test('lengths ride the size the pass works at: the preview at half size asks for half the pixels', () => {
  const c = clip({ mosaic: 24, chromaAb: 8, bloom: { amount: 0.5, threshold: 0.6, radius: 0.5 }, halation: { amount: 0.5, size: 0.5 } })
  const full = fxParamsFor(c, 12, 1920, 1920)
  const half = fxParamsFor(c, 12, 960, 1920)
  assert.equal(full.mosaic, 24)
  assert.equal(half.mosaic, 12)
  assert.equal(full.cab, 8)
  assert.equal(half.cab, 4)
  assert.ok(Math.abs(full.bloom!.radius - 2 * half.bloom!.radius) < 1e-9)
  assert.ok(Math.abs(full.bloom!.radius - (0.004 + 0.036 * 0.5) * 1920) < 1e-9, 'a share of the width')
  assert.ok(Math.abs(full.halation!.radius - 2 * half.halation!.radius) < 1e-9)
  // A 4K source in a 1080p frame: the cell is media pixels of the source.
  assert.equal(fxParamsFor(c, 12, 1920, 3840).mosaic, 12)
})

test('amounts: the LUT whole unless told, keyed effects at the clip’s own time, held to their ranges', () => {
  assert.equal(fxParamsFor(clip({ lut: 'preset:cool' }), 12, 100, 100).lutAmount, 1)
  assert.equal(fxParamsFor(clip({ lut: 'preset:cool', lutAmount: 0.3 }), 12, 100, 100).lutAmount, 0.3)
  assert.equal(fxParamsFor(clip({ lut: 'preset:cool' }), 12, 100, 100).lut!.n, 33)
  assert.equal(fxParamsFor(clip({ lut: 'nope' }), 12, 100, 100).lut, null)
  const keyed = clip({ bloom: { amount: 0.1, threshold: 0.6, radius: 0.4 }, fxKeys: { bloom: [{ id: 'a', time: 0, value: 0, easing: 'linear' }, { id: 'b', time: 4, value: 1, easing: 'linear' }] } })
  assert.equal(fxParamsFor(keyed, 10, 100, 100).bloom, null, 'at the first key: nothing')
  assert.ok(Math.abs(fxParamsFor(keyed, 12, 100, 100).bloom!.amount - 0.5) < 1e-9, 'halfway between the keys (project time 12 is 2 s into the clip)')
  assert.equal(fxParamsFor(keyed, 17, 100, 100).bloom!.amount, 1)
  assert.equal(fxParamsFor(clip({ tone: { exposure: 0.5, tint: 0, highlights: 0, shadows: 0 } }), 12, 100, 100).grade!.exposure, 0.5)
  assert.equal(fxParamsFor(clip(), 12, 100, 100).grade, null)
  assert.equal(fxParamsFor(clip({ isolate: { color: '#0000ff', range: 0.9, amount: 3 } }), 12, 100, 100).isolate!.range, 0.5)
})

test('the looks’ hover is the preview’s alone: shown whole there, never in a frame of final quality', () => {
  const c = clip({ lut: 'preset:cool', lutAmount: 0.4 })
  setLutHover({ clipId: 'c', lut: 'preset:night' })
  const shown = fxParamsFor(c, 12, 100, 100)
  assert.match(shown.lut!.id, /^preset:night#/)
  assert.equal(shown.lutAmount, 1, 'a look pointed at is shown whole')
  const final = withDrawQuality(true, 100, () => fxParamsFor(c, 12, 100, 100))
  assert.match(final.lut!.id, /^preset:cool#/, 'the export draws the project')
  assert.equal(final.lutAmount, 0.4)
  // Pointing at "none" on a clip whose only effect is its LUT: the pass is not needed.
  setLutHover({ clipId: 'c', lut: null })
  assert.equal(needsPixelFx(c), false)
  assert.equal(withDrawQuality(true, 100, () => needsPixelFx(c)), true)
  setLutHover(null)
  assert.match(fxParamsFor(c, 12, 100, 100).lut!.id, /^preset:cool#/)
})
