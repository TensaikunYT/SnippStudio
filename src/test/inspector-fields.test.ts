// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.3 (the Inspector on the building blocks): no field changed its
// value, range, step or rounding with the move. The old controls' rules
// (components/controls.tsx: NumberBox, Slider, SliderNum, Num) are written
// here again as plain functions, and every family of field the Inspector has
// is compared with what the new ones do (ui/logic.ts free numbers,
// ui/slider-value.ts, components/inspector/sliders.tsx).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatFree, freeKeyValue, freeValue, parseNumber, snap } from '../renderer/src/ui/logic'
import { clampSliderEntry, sliderNumberFormat } from '../renderer/src/ui/slider-value'
import { UndoNumber, UndoSlider, UndoSliderNum } from '../renderer/src/components/inspector/sliders'

// ---- the old rules --------------------------------------------------------------
/** What the old box showed (NumberBox: `String(Number(value.toFixed(digits)))`). */
const oldShown = (value: number, digits: number): string => String(Number.isFinite(value) ? Number(value.toFixed(digits)) : 0)
/** What an arrow key gave (NumberBox.bump), before the caller's clamp. */
const oldBump = (value: number, step: number, dir: 1 | -1, big: boolean): number => Number((value + step * (big ? 10 : 1) * dir).toFixed(4))
const clampTo = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

interface Family {
  name: string
  min: number
  max: number
  step: number
  fmt?: (v: number) => string
  /** Stored values to try. */
  values: number[]
  /** Typed texts to try (in the shown unit). */
  typed: string[]
}

const two = (v: number): string => v.toFixed(2)
// One row per family of slider in the Inspector (the `fmt` each one passes).
const FAMILIES: Family[] = [
  { name: 'plain, two decimals (grade, chroma, zoom)', min: 0.5, max: 1.5, step: 0.01, values: [0.5, 1, 1.234, 1.5], typed: ['1.333', '0.2', '9', '1,25'] },
  { name: 'plain, step 0.005 (zoom from/to)', min: 0.8, max: 1.4, step: 0.005, values: [0.8, 1.0025, 1.4], typed: ['1.0033', '2'] },
  { name: 'percent of 0–1 (look amount, opacity dials)', min: 0.05, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, values: [0.05, 0.333, 0.6, 1], typed: ['33.3', '33.3 %', '250', '0'] },
  { name: 'percent of 0–2 (volume)', min: 0, max: 2, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%`, values: [0, 0.555, 1, 2], typed: ['55.5', '180', '300'] },
  { name: 'percent or Off (camera look dials)', min: 0, max: 1, step: 0.05, fmt: (v) => (v <= 0 ? 'Off' : `${Math.round(v * 100)}%`), values: [0, 0.35, 1], typed: ['12', '100'] },
  { name: 'seconds (motion duration)', min: 0.1, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}s`, values: [0.1, 0.5, 1.275, 3], typed: ['0.33', '0.33s', '7'] },
  { name: 'times (idle speed)', min: 0.2, max: 3, step: 0.05, fmt: (v) => `${v.toFixed(2)}×`, values: [0.2, 1, 3], typed: ['1.11', '0.01'] },
  { name: 'whole numbers (crop, drift, threshold)', min: -300, max: 300, step: 1, fmt: (v) => v.toFixed(0), values: [-300, 0, 12.5, 300], typed: ['33.3', '-12.75', '999'] },
  { name: 'one decimal (blur, EQ, fades)', min: -18, max: 18, step: 0.5, fmt: (v) => v.toFixed(1), values: [-18, 0, 3.25, 18], typed: ['3.3', '-40'] },
  { name: 'off or a number (rumble cut)', min: 0, max: 300, step: 10, fmt: (v) => (v === 0 ? 'off' : v.toFixed(0)), values: [0, 85, 300], typed: ['85', '15'] },
  { name: 'ratio (compressor)', min: 1, max: 12, step: 0.5, fmt: (v) => `${v.toFixed(1)}:1`, values: [1, 4.5, 12], typed: ['4.2', '20'] },
  { name: 'a word below a floor (mask feather)', min: 0, max: 120, step: 1, fmt: (v) => (v < 0.5 ? 'hard' : v.toFixed(0)), values: [0, 12, 120], typed: ['12.5'] },
  { name: 'pixels (subtitle size)', min: 12, max: 200, step: 1, fmt: (v) => `${v}px`, values: [12, 64, 200], typed: ['63.5', '500'] },
  { name: 'default (physics 0–1)', min: 0, max: 1, step: 0.05, fmt: two, values: [0, 0.55, 1], typed: ['0.333'] }
]

test('free numbers: a typed value is only kept in range, never put on the step grid', () => {
  // The difference phase 3c.1 named: 33.3 on a step of 0.5 became 33.5.
  assert.equal(snap(33.3, { min: 0, max: 100, step: 0.5 }), 33.5)
  assert.equal(freeValue(33.3, { min: 0, max: 100, step: 0.5 }), 33.3)
  assert.equal(freeValue(133.3, { min: 0, max: 100, step: 0.5 }), 100)
  assert.equal(freeValue(-3, { min: 0, max: 100, step: 0.5 }), 0)
  assert.equal(freeValue(-3, {}), -3)
})

test('free numbers: an arrow adds one step to the value as it is (Shift: ten), as the old box did', () => {
  for (const [v, step] of [[33.3, 0.5], [0.123, 0.01], [-12.75, 1], [1.0033, 0.005], [7, 10]] as const) {
    for (const big of [false, true]) {
      assert.equal(freeKeyValue('ArrowUp', big, v, { step }), oldBump(v, step, 1, big), `${v} + ${step}${big ? ' ×10' : ''}`)
      assert.equal(freeKeyValue('ArrowDown', big, v, { step }), oldBump(v, step, -1, big), `${v} − ${step}${big ? ' ×10' : ''}`)
    }
  }
  // The caller's clamp is the field's own range now.
  assert.equal(freeKeyValue('ArrowUp', false, 99.8, { min: 0, max: 100, step: 0.5 }), 100)
  assert.equal(freeKeyValue('ArrowDown', true, 3, { min: 0, max: 100, step: 0.5 }), 0)
  // No noise grows on repeated nudges.
  let v = 0
  for (let i = 0; i < 30; i++) v = freeKeyValue('ArrowUp', false, v, { step: 0.1 }) as number
  assert.equal(v, 3)
  assert.equal(freeKeyValue('a', false, 1, { step: 1 }), null)
  assert.equal(freeKeyValue('Home', false, 5, { min: 2, max: 9 }), 2)
  assert.equal(freeKeyValue('End', false, 5, { min: 2, max: 9 }), 9)
  assert.equal(freeKeyValue('Home', false, 5, {}), null)
})

test('free numbers: the number shown is the old box’s (at most `digits` decimals, no trailing zeros)', () => {
  for (const digits of [0, 1, 2, 3, 4]) {
    for (const v of [0, 1, -1, 33.3, 33.333333, 0.5, 100, -0.004, 1e-7, 1234.56789, NaN, Infinity]) {
      assert.equal(formatFree(v, digits), oldShown(v, digits), `${v} at ${digits}`)
    }
  }
  assert.equal(formatFree(55, 2, '%'), '55 %')
  assert.equal(formatFree(-0.001, 2), '0')
})

for (const f of FAMILIES) {
  test(`slider family "${f.name}": range, step, scale, shown number and typed value are the old ones`, () => {
    const fmt = f.fmt ?? two
    const n = sliderNumberFormat(f.max, f.step, fmt)
    const unit = n.suffix.trim() || undefined
    const range = { min: f.min * n.scale, max: f.max * n.scale, step: n.step }
    for (const v of f.values) {
      // Shown: the old box's number (its unit beside it).
      const shown = formatFree(v * n.scale, n.digits, unit)
      assert.equal(shown, unit ? `${oldShown(v * n.scale, n.digits)} ${unit}` : oldShown(v * n.scale, n.digits), `${v} shown`)
      // What is shown reads back as the same number.
      assert.equal(parseNumber(shown, unit), Number(oldShown(v * n.scale, n.digits)))
      // An arrow key: one shown step, then the slider's clamp.
      for (const dir of [1, -1] as const) {
        const key = freeKeyValue(dir === 1 ? 'ArrowUp' : 'ArrowDown', false, v * n.scale, range) as number
        const was = clampSliderEntry(oldBump(v * n.scale, n.step, dir, false), f.min, f.max, n.scale)
        assert.ok(Math.abs(clampTo(key / n.scale, f.min, f.max) - was) < 1e-9, `${v} ${dir > 0 ? 'up' : 'down'}: ${key / n.scale} / ${was}`)
      }
    }
    for (const text of f.typed) {
      const entered = parseNumber(text, unit)
      assert.notEqual(entered, null, `"${text}" is a number`)
      const now = clampTo(freeValue(entered as number, range) / n.scale, f.min, f.max)
      const was = clampSliderEntry(entered as number, f.min, f.max, n.scale)
      assert.ok(Math.abs(now - was) < 1e-9, `"${text}": ${now} / ${was}`)
    }
  })
}

const attr = (html: string, tag: string, name: string): string[] => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] ?? '')

test('UndoSlider draws the building blocks’ slider with the old numbers and the old test name on the track', () => {
  const html = renderToStaticMarkup(
    createElement(UndoSlider, { label: 'Look amount', value: 0.333, min: 0.05, max: 1, step: 0.05, fmt: (v: number) => `${Math.round(v * 100)}%`, testid: 'x.amount', onChange: () => {} })
  )
  assert.match(html, /class="ui-slider"/)
  const range = /<input[^>]*type="range"[^>]*>/.exec(html)?.[0] ?? ''
  assert.match(range, /data-testid="x\.amount"/)
  assert.match(range, /min="0\.05"/)
  assert.match(range, /max="1"/)
  assert.match(range, /step="0\.05"/)
  assert.match(range, /value="0\.333"/)
  const number = /<input[^>]*role="spinbutton"[^>]*>/.exec(html)?.[0] ?? ''
  assert.match(number, /data-testid="x\.amount\.value"/)
  assert.match(number, /value="33\.3 %"/, number)
  assert.match(number, /aria-valuemin="5"/)
  assert.match(number, /aria-valuemax="100"/)
})

test('UndoSliderNum: the number shows the raw value with its unit; UndoNumber is a free field', () => {
  const html = renderToStaticMarkup(createElement(UndoSliderNum, { label: 'Position X', value: -225.456, min: -1920, max: 1920, step: 1, numStep: 10, testid: 'inspector.clip.x', onChange: () => {} }))
  assert.deepEqual(attr(html, 'input', 'data-testid'), ['inspector.clip.x', 'inspector.clip.x.value'])
  assert.match(html, /value="-225\.46"/)
  const pct = renderToStaticMarkup(createElement(UndoSliderNum, { label: 'Scale', value: 133.3, min: 2, max: 400, step: 1, suffix: '%', onChange: () => {} }))
  assert.match(pct, /value="133\.3 %"/)
  const num = renderToStaticMarkup(createElement(UndoNumber, { name: 'When', value: 1.25, step: 0.1, digits: 1, suffix: 's', onChange: () => {} }))
  assert.match(num, /role="spinbutton"/)
  assert.match(num, /value="1\.3 s"/)
  assert.match(num, /aria-label="When"/)
  const row = renderToStaticMarkup(createElement(UndoNumber, { label: 'Start', value: 2, onChange: () => {} }))
  assert.match(row, /class="ui-field"/)
  assert.match(row, />Start<\/label>/)
})
