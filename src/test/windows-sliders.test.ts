// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.4 (the dialogs and windows on the building blocks): the sliders of
// Remove silence (SilenceCutter) and Clean the voice (CleanVoice) are the
// Inspector's UndoSlider now (components/inspector/sliders.tsx), in place of
// the old components/controls.tsx Slider. Two things must not change:
//   - the numbers: range, step, the shown value and its unit, for each family
//     (dB with one decimal, whole milliseconds, seconds with two decimals,
//     "off" or a percentage);
//   - the undo rule (tarifler\FAZ3C.md decision 5): these sliders set the
//     panel's own settings, not the project, so a drag opens the gesture
//     window and closes it with NO undo step, and leaves nothing armed behind
//     (the next plain edit is not swallowed into a stray step). The panels'
//     project edits stay one step each: a voice preset (undoable) and a beat
//     edit (editTemplates). BeatSync has no slider.
import './dom-stub'
import { fixture, hash, resetWorld } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sliderNumberFormat } from '../renderer/src/ui/slider-value'
import { UndoSlider } from '../renderer/src/components/inspector/sliders'
import { useStore } from '../renderer/src/state/store'
import { VOICE_PRESETS } from '../renderer/src/audio/clean'

/** What the old box showed (NumberBox: `String(Number(value.toFixed(digits)))`). */
const oldShown = (value: number, digits: number): string => String(Number(value.toFixed(digits)))

interface Family {
  name: string
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  value: number
  /** The scale and unit the old box used (0–1 shown as 0–100 %). */
  scale: number
  unit: string
}

const FAMILIES: Family[] = [
  { name: 'Remove silence: silence below dB', min: -70, max: -10, step: 0.5, fmt: (v) => `${v.toFixed(1)} dB`, value: -40.5, scale: 1, unit: 'dB' },
  { name: 'Remove silence: keep around speech ms', min: 0, max: 300, step: 10, fmt: (v) => `${v.toFixed(0)}ms`, value: 110, scale: 1, unit: 'ms' },
  { name: 'Remove silence: ignore gaps under s', min: 0.1, max: 2, step: 0.05, fmt: (v) => `${v.toFixed(2)}s`, value: 0.25, scale: 1, unit: 's' },
  { name: 'Clean the voice: noise out / softer esses (off or %)', min: 0, max: 1, step: 0.05, fmt: (v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`), value: 0.6, scale: 100, unit: '%' }
]

const attr = (html: string, tag: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1])

for (const f of FAMILIES) {
  test(`the numbers are the old ones: ${f.name}`, () => {
    const n = sliderNumberFormat(f.max, f.step, f.fmt)
    assert.equal(n.scale, f.scale, 'scale')
    assert.equal(n.suffix.trim(), f.unit, 'unit')
    const html = renderToStaticMarkup(createElement(UndoSlider, { label: f.name, value: f.value, min: f.min, max: f.max, step: f.step, fmt: f.fmt, onChange: () => {} }))
    const range = /<input[^>]*type="range"[^>]*>/.exec(html)?.[0] ?? ''
    assert.match(range, new RegExp(`min="${f.min}"`))
    assert.match(range, new RegExp(`max="${f.max}"`))
    assert.match(range, new RegExp(`step="${f.step}"`))
    assert.match(range, new RegExp(`value="${f.value}"`))
    // The number field shows what the old box showed, with the old unit.
    const shown = attr(html, 'input', 'value').find((v) => v.endsWith(f.unit)) ?? ''
    assert.equal(shown, `${oldShown(f.value * f.scale, n.digits)} ${f.unit}`)
  })
}

test('a drag of a panel setting (not the project) is no undo step and leaves nothing armed', () => {
  const s = useStore.getState
  resetWorld()
  s().loadProject(fixture())
  const before = hash(s().project)
  const past0 = s().past.length
  // The slider's gesture (undo-gesture.ts): armGesture on the first change,
  // the panel's own state changes (the silence preview is not the project),
  // endGesture on the release.
  s().armGesture()
  for (let k = 1; k <= 5; k++) s().setSilencePreview(k % 2 ? [{ clipId: 'm1', start: k, end: k + 0.5 }] : null)
  s().setSilencePreview(null)
  s().endGesture()
  assert.equal(s().past.length, past0, 'no undo step')
  assert.equal(hash(s().project), before, 'the project is untouched')
  // Nothing stayed armed: a later edit that takes no snapshot of its own adds none.
  s().setClipVolume('m1', 0.5)
  assert.equal(s().past.length, past0, 'no stray step from an armed gesture')
})

test('the panels’ project edits stay one undo step each: a voice preset, a beat edit', () => {
  const s = useStore.getState
  resetWorld()
  s().loadProject(fixture())
  const past0 = s().past.length
  const before = hash(s().project)
  const key = Object.keys(VOICE_PRESETS)[0]
  s().undoable(() => s().setClipAudioFx('m1', VOICE_PRESETS[key].fx as never))
  assert.equal(s().past.length, past0 + 1, 'the preset: one step')
  s().editTemplates((p) => {
    p.markers = [...(p.markers ?? []), { id: 'beat1', time: 1, color: '#ffd23f', note: '', label: 'beat' }]
  })
  assert.equal(s().past.length, past0 + 2, 'the bars: one step')
  s().undo()
  s().undo()
  assert.equal(hash(s().project), before, 'two undos: the project as it was')
})
