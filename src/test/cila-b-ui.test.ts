// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): the speed row of the Inspector. The
// track by decades (ui/logic.ts: every tenfold the same length, two-figure
// values), the slider drawn with it, the presets, and the words of the part
// (each in English and Turkish, naming the numbers the rules use).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UndoDecadeSlider } from '../renderer/src/components/inspector/sliders'
import { AUDIBLE_MAX, AUDIBLE_MIN, PLAYABLE_MAX, SPEED_MAX, SPEED_MIN } from '../renderer/src/timeline/speed'
import { DECADE_STEPS, decadeLast, decadePos, decadeValue } from '../renderer/src/ui/logic'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_3C } from '../renderer/src/ui/strings-3c'
import { STRINGS_3C3 } from '../renderer/src/ui/strings-3c3'
import { STRINGS_CILA_B } from '../renderer/src/ui/strings-cila-b'

test('the track by decades: 0.1 – 100 is 270 positions, a tenfold every 90, round values all the way', () => {
  assert.equal(decadeLast(SPEED_MIN, SPEED_MAX), 3 * DECADE_STEPS)
  const values = Array.from({ length: 271 }, (_, p) => decadeValue(p, SPEED_MIN, SPEED_MAX))
  assert.equal(values[0], 0.1)
  assert.equal(values[1], 0.11)
  assert.equal(values[89], 0.99)
  assert.equal(values[90], 1)
  assert.equal(values[91], 1.1)
  assert.equal(values[180], 10)
  assert.equal(values[181], 11)
  assert.equal(values[270], 100)
  // Strictly rising, and every one a number of at most two figures (no 0.30000000000000004).
  for (let p = 1; p <= 270; p++) assert.ok(values[p] > values[p - 1], `position ${p}`)
  for (const v of values) assert.equal(String(v), String(Number(v.toPrecision(3))), `${v}`)
  // Each position reads back as itself; past the ends it stays at them.
  for (let p = 0; p <= 270; p++) assert.ok(Math.abs(decadePos(values[p], SPEED_MIN, SPEED_MAX) - p) < 1e-6, `position of ${values[p]}`)
  assert.equal(decadeValue(-5, SPEED_MIN, SPEED_MAX), 0.1)
  assert.equal(decadeValue(999, SPEED_MIN, SPEED_MAX), 100)
  assert.equal(decadePos(0.01, SPEED_MIN, SPEED_MAX), 0)
  assert.equal(decadePos(5000, SPEED_MIN, SPEED_MAX), 270)
  // The middle of the track is 3.2x, not 50x.
  assert.equal(decadeValue(135, SPEED_MIN, SPEED_MAX), 5.5)
  // A typed value between two positions lies between them.
  const p = decadePos(37.5, SPEED_MIN, SPEED_MAX)
  assert.ok(p > 207 && p < 208, `37.5 at ${p}`)
})

test('the usual speeds are values of the track (the slider can rest on each; DENEME-2 took their buttons away)', () => {
  for (const v of [0.25, 0.5, 1, 2, 4, 10, 50, 100]) {
    const p = decadePos(v, SPEED_MIN, SPEED_MAX)
    assert.ok(Math.abs(p - Math.round(p)) < 1e-6, `${v} at ${p}`)
    assert.equal(decadeValue(Math.round(p), SPEED_MIN, SPEED_MAX), v)
  }
})

test('the speed slider: a track of positions with the old test id, a free number in ×', () => {
  const html = renderToStaticMarkup(createElement(UndoDecadeSlider, { label: 'Speed', value: 2, min: SPEED_MIN, max: SPEED_MAX, suffix: '×', testid: 'inspector.clip.speed', onChange: () => {} }))
  const track = /<input[^>]*type="range"[^>]*>/.exec(html)![0]
  assert.match(track, /data-testid="inspector\.clip\.speed"/)
  assert.match(track, /min="0"/)
  assert.match(track, /max="270"/)
  assert.match(track, /step="1"/)
  assert.match(track, /value="100"/, '2x is position 100')
  assert.match(track, /aria-valuetext="2 ×"/)
  const number = /<input[^>]*role="spinbutton"[^>]*>/.exec(html)![0]
  assert.match(number, /data-testid="inspector\.clip\.speed\.value"/)
  assert.match(number, /value="2 ×"/)
  assert.match(number, /aria-valuemin="0\.1"/)
  assert.match(number, /aria-valuemax="100"/)
  // A speed that is not one of the track's own (held at a frame: 37.5): the number shows it as it is.
  const odd = renderToStaticMarkup(createElement(UndoDecadeSlider, { label: 'Speed', value: 37.5, min: SPEED_MIN, max: SPEED_MAX, suffix: '×', onChange: () => {} }))
  assert.match(odd, /value="37\.5 ×"/)
  assert.match(odd, /type="range"[^>]*value="208"|value="208"[^>]*type="range"/)
})

test('the words of part B: both languages, the same parameters, in STRINGS, no key taken from another file', () => {
  const params = (s: string): string => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  const keys = Object.keys(STRINGS_CILA_B)
  assert.ok(keys.length >= 7, `${keys.length} keys`) // (9 before DENEME-2 took the speed presets' two away)
  for (const [k, e] of Object.entries(STRINGS_CILA_B)) {
    assert.ok(e.en.trim().length > 0, `${k}: English`)
    assert.ok(e.tr.trim().length > 0, `${k}: Turkish`)
    assert.equal(params(e.tr), params(e.en), `${k}: the same parameters`)
    assert.deepEqual((STRINGS as Record<string, unknown>)[k], e, `${k} is in STRINGS`)
    assert.ok(!k.includes('-'), `${k}: no hyphen in a key`)
  }
  const other = new Set([...Object.keys(STRINGS_3C), ...Object.keys(STRINGS_3C3)])
  assert.deepEqual(keys.filter((k) => other.has(k)), [])
})

test('the hints name the numbers the rules use (0.25x, 8x, 16x)', () => {
  assert.equal(AUDIBLE_MIN, 0.25)
  assert.equal(AUDIBLE_MAX, 8)
  assert.equal(PLAYABLE_MAX, 16)
  const s = STRINGS_CILA_B
  for (const k of ['insp.speed.silent', 'insp.audio.silentSpeed'] as const) {
    assert.match(s[k].en, /0\.25×/)
    assert.match(s[k].en, /8×/)
    assert.match(s[k].tr, /0,25×/)
    assert.match(s[k].tr, /8×/)
  }
  assert.match(s['insp.speed.stepped'].en, /16×/)
  assert.match(s['insp.speed.stepped'].tr, /16×/)
})
