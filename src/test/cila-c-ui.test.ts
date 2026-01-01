// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part C (CILA-C-PLAN.md): the curve editor of the Clip tab.
// Its shapes (around the clip's speed, held to the range), the speed it
// draws at each point of the clip, and the graph drawn for a curved clip:
// one handle per point, the silent bands, the names from t().
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CURVE_PRESET_ORDER, SpeedCurveEditor, presetPoints, speedAtU } from '../renderer/src/components/inspector/speed-curve-editor'
import { CURVE_PRESETS, curveDuration } from '../renderer/src/timeline/speed-curve'
import type { Clip, SpeedCurve } from '../renderer/src/types'

const curved = (curve: SpeedCurve, extra: Partial<Clip> = {}): Clip => {
  const d = curveDuration(curve, 100, 10)
  return { id: 'c', assetId: 'v', trackId: 'V1', start: 0, inPoint: 100, duration: d, speed: 10 / d, speedCurve: curve, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...extra } as Clip
}

test('the five shapes, around the speed the clip has, held to 0.1x – 100x', () => {
  assert.deepEqual([...CURVE_PRESET_ORDER].sort(), Object.keys(CURVE_PRESETS).sort())
  for (const name of CURVE_PRESET_ORDER) {
    const at1 = presetPoints(name, 1)
    assert.equal(at1[0].u, 0, `${name} starts at the clip's first frame`)
    assert.equal(at1[at1.length - 1].u, 1, `${name} ends at its last`)
    for (let i = 1; i < at1.length; i++) assert.ok(at1[i].u > at1[i - 1].u, `${name}: in order`)
    const at50 = presetPoints(name, 50)
    for (const p of at50) assert.ok(p.v >= 0.1 && p.v <= 100, `${name} at 50x: ${p.v}`)
  }
  assert.deepEqual(presetPoints('ease-in', 2).map((p) => p.v), [0.6, 2, 2])
})

test('the speed drawn along the clip is the speed it plays at, forwards and backwards', () => {
  const c = curved({ keys: [{ m: 100, v: 4 }, { m: 110, v: 0.5 }] })
  assert.ok(Math.abs(speedAtU(c, 0) - 4) < 1e-9)
  assert.ok(Math.abs(speedAtU(c, 1) - 0.5) < 1e-9)
  const r = curved({ keys: [{ m: 100, v: 4 }, { m: 110, v: 0.5 }] }, { reversed: true })
  assert.ok(Math.abs(speedAtU(r, 0) - 0.5) < 1e-9, 'backwards: its first frame on screen is the media end')
  assert.equal(speedAtU({ speed: 3 } as Clip, 0.5), 3)
})

test('the graph: one handle per point, both silent bands, a labelled line at 1x', () => {
  const c = curved({ keys: [{ m: 100, v: 2 }, { m: 104, v: 0.2 }, { m: 110, v: 12 }] })
  const html = renderToStaticMarkup(createElement(SpeedCurveEditor, { clip: c }))
  assert.equal((html.match(/data-testid="inspector\.clip\.speed\.curve\.point\.\d"/g) ?? []).length, 3)
  assert.equal((html.match(/class="insp-curve-silent"/g) ?? []).length, 2)
  assert.match(html, /aria-label="Point 2: 0\.2×"/)
  assert.match(html, />1×</)
  assert.match(html, /data-testid="inspector\.clip\.speed\.curve"/)
})
