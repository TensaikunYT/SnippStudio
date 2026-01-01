// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A number with its short name inside the field ("X 0", "Y 0"; arayüz v4,
// UI-V4-PLAN.md): the field is the building blocks' NumberField (type, the
// arrows, Enter / Esc); its name is a handle — drag it left or right to
// change the value, a step a pixel (Shift ten, Alt a tenth). One drag is one
// undo step when a `gesture` is given (the Slider's).
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { NumberField } from './fields'
import { clamp, modeStep, sliderModeOf, snap } from './logic'
import type { SliderGesture } from './Slider'

export interface ScrubFieldProps {
  /** The short name in the field ("X"). */
  short: string
  /** Its full name, for a screen reader ("Position X"). */
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  decimals?: number
  gesture?: SliderGesture
  /** data-testid of the number; its handle is <testid>.scrub. */
  testid?: string
}

/** The value a scrub gives: the value it started at plus `dx` pixels of steps. */
export function scrubValue(start: number, dx: number, step: number, mode: 'normal' | 'coarse' | 'fine', min = -Infinity, max = Infinity): number {
  const s = modeStep(step, mode)
  return clamp(snap(start + dx * s, { min: -Infinity, max: Infinity, step: s }), min, max)
}

export function ScrubField({ short, label, value, onChange, step = 1, min, max, unit, decimals = 2, gesture, testid }: ScrubFieldProps): JSX.Element {
  const drag = useRef<{ id: number; x: number; start: number; mode: string } | null>(null)
  const down = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    gesture?.arm()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, start: value, mode: sliderModeOf(e) }
  }
  const move = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const mode = sliderModeOf(e)
    // A modifier pressed or let go mid-drag: counted from here.
    if (mode !== d.mode) Object.assign(d, { x: e.clientX, start: value, mode })
    const next = scrubValue(d.start, e.clientX - d.x, step, mode, min, max)
    if (next === value) return
    gesture?.fire()
    onChange(next)
  }
  const up = (e: ReactPointerEvent<HTMLSpanElement>): void => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  return (
    <span className="ui-scrub">
      <span className="ui-scrub-handle" aria-hidden="true" data-testid={testid ? `${testid}.scrub` : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {short}
      </span>
      <NumberField
        value={value}
        onChange={(v) => {
          gesture?.arm()
          gesture?.fire()
          onChange(v)
        }}
        step={step}
        min={min}
        max={max}
        unit={unit}
        decimals={decimals}
        free
        label={label}
        testid={testid}
        className="ui-scrub-value"
      />
    </span>
  )
}
