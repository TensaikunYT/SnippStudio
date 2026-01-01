// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector's sliders and number fields (SnippStudio phase 3c.3): the
// building blocks' Slider and NumberField, wired the way the old controls
// (components/controls.tsx) were, so that no field changes its value, range,
// step or rounding with the move:
//   - one drag is one undo step (components/undo-gesture.ts; decision 5);
//   - a typed value is only kept in range, never put on the step grid;
//   - the number shows what the old box showed (ui/slider-value.ts decides the
//     scale, the unit and the decimals from `fmt`, as it did before).
// The rules themselves are plain functions: ui/logic.ts (freeValue,
// freeKeyValue, formatFree) and ui/slider-value.ts; src/test/inspector-fields.test.ts.
import { Field, NumberField, Slider } from '../../ui'
import { sliderNumberFormat } from '../../ui/slider-value'
import { useGestureOnce } from '../undo-gesture'

const unitOf = (suffix: string | undefined): string | undefined => {
  const u = (suffix ?? '').trim()
  return u ? u : undefined
}

/** A slider whose number reads the way `fmt` writes it (a percentage shows
 *  0–100 for a stored 0–1). Replaces the old `Slider`. */
export function UndoSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  fmt = (v: number) => v.toFixed(2),
  disabled,
  testid
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  fmt?: (v: number) => string
  disabled?: boolean
  /** data-testid of the track; its number field is <testid>.value. */
  testid?: string
}): JSX.Element {
  const gesture = useGestureOnce()
  const n = sliderNumberFormat(max, step, fmt)
  return (
    <Slider
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      scale={n.scale}
      unit={unitOf(n.suffix)}
      decimals={n.digits}
      free
      disabled={disabled}
      gesture={gesture}
      trackTestid={testid}
    />
  )
}

/** A slider with its unit given and a number field that may step differently
 *  from the track (Position: the track by 1, the arrows by 10). Replaces the
 *  old `SliderNum`. */
export function UndoSliderNum({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  numStep,
  suffix = '',
  testid
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  numStep?: number
  suffix?: string
  testid?: string
}): JSX.Element {
  const gesture = useGestureOnce()
  return (
    <Slider
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      numberStep={numStep ?? step}
      unit={unitOf(suffix)}
      decimals={2}
      free
      gesture={gesture}
      trackTestid={testid}
    />
  )
}

/** A slider over a range of many tenfolds (speed, 0.1x – 100x): its track
 *  runs by decades (ui/Slider `decades`), its number field takes any value
 *  in the range as typed. One drag is one undo step. */
export function UndoDecadeSlider({
  label,
  value,
  onChange,
  min,
  max,
  numStep = 0.1,
  suffix = '',
  testid
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  numStep?: number
  suffix?: string
  testid?: string
}): JSX.Element {
  const gesture = useGestureOnce()
  return <Slider label={label} value={value} onChange={onChange} min={min} max={max} decades numberStep={numStep} unit={unitOf(suffix)} decimals={2} free gesture={gesture} trackTestid={testid} />
}

/** A number field that edits the project: a typed value or an arrow key is one
 *  undo step (a held key stays one). Without `label` it is the bare field (a
 *  cell of a row). Replaces the old `Num` and the bare `NumberBox`. */
export function UndoNumber({
  label,
  name,
  value,
  onChange,
  step = 1,
  digits = 2,
  min,
  max,
  suffix,
  undo = true,
  testid
}: {
  /** The row's label (a Field). */
  label?: string
  /** Its name when there is no row label. */
  name?: string
  value: number
  onChange: (v: number) => void
  step?: number
  digits?: number
  min?: number
  max?: number
  suffix?: string
  /** Off for a field whose edit already takes its own undo step. */
  undo?: boolean
  testid?: string
}): JSX.Element {
  const gesture = useGestureOnce()
  const field = (
    <NumberField
      value={Number.isFinite(value) ? value : 0}
      onChange={(v) => {
        if (undo) {
          gesture.arm()
          gesture.fire()
        }
        onChange(v)
      }}
      min={min}
      max={max}
      step={step}
      decimals={digits}
      unit={unitOf(suffix)}
      free
      label={label ? undefined : name}
      testid={testid}
    />
  )
  return label ? <Field label={label}>{field}</Field> : field
}
