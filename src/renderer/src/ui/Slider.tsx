// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The slider (SnippStudio phase 3a.2; TASARIM.md "Kaydırıcı"): one row — the
// label (a fixed width), the track, the number field (monospaced, right
// aligned, with its unit) that can be typed into.
//
// Phase 3c.1: a slider that edits the project takes the undo gesture of the
// old one (components/undo-gesture.ts, passed in as `gesture` so the building
// blocks do not import the store): a press or a key on the track arms it, the
// first change opens it, the release closes it; one drag is one undo step.
// `scale` shows a fraction as the number people read (0.55 as 55 %).
import { useId, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { NumberField } from './fields'
import { clamp, decadeLast, decadePos, decadeValue, decimalsOf, formatFree, formatNumber, sliderDragValue, sliderKeyValue, sliderModeOf, trackFraction, type SliderMode } from './logic'
import { useT } from './strings'

/** The undo window of one gesture (arm on press, fire on the first change, end on release). */
export interface SliderGesture {
  arm: () => void
  fire: () => void
  end: () => void
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  unit?: string
  decimals?: number
  /** The number field shows value × scale (and takes what is typed ÷ scale). */
  scale?: number
  disabled?: boolean
  /** One undo step per drag (see above). */
  gesture?: SliderGesture
  /** The number field is free (phase 3c.3; ui/fields.tsx): a typed value is
   *  only kept in range, `decimals` is the most it shows. */
  free?: boolean
  /** The number field's own step when it differs from the track's (in the shown unit). */
  numberStep?: number
  /** data-testid of the row; the track is <testid>.range, the number <testid>.value. */
  testid?: string
  /** data-testid of the track itself, for a slider that had one before the
   *  move (the tests click and read the track); its number is <trackTestid>.value. */
  trackTestid?: string
  /** The track runs by decades (ui/logic.ts decadeValue): every tenfold the
   *  same length, two-figure values along it; `step` is not used. The number
   *  field takes any value in the range. For a range like 0.1 – 100. */
  decades?: boolean
}

/** How far along the track a value is, 0–100. */
export const fillPercent = (v: number, min: number, max: number): number => (max > min ? clamp(((v - min) / (max - min)) * 100, 0, 100) : 0)

export function Slider({ label, value, min, max, step = 1, onChange, unit, decimals, scale = 1, disabled, gesture, free, numberStep, testid, trackTestid, decades }: SliderProps): JSX.Element {
  const t = useT()
  const id = useId()
  // By decades the track counts positions; the value is read off them.
  const last = decades ? decadeLast(min, max) : 0
  const pos = decades ? decadePos(value, min, max) : 0
  const fill = { '--fill': `${decades ? fillPercent(pos, 0, last) : fillPercent(value, min, max)}%` } as CSSProperties
  const shownStep = numberStep ?? step * scale
  const nameOf = trackTestid ?? testid
  const dec = decimals ?? decimalsOf(shownStep)
  // The track's own range: positions for a slider by decades.
  const r = decades ? { min: 0, max: last, step: 1 } : { min, max, step }
  const toValue = (x: number): number => (decades ? decadeValue(x, min, max) : x)
  const at = decades ? pos : value
  // A drag on the track (arayüz v4): run here, not by the native range, so
  // Shift (ten steps) and Alt (a tenth of a step, a tenth of the way) can
  // change it while it lasts. Without a modifier it is the native drag: the
  // value jumps under the pointer and follows it, on the step grid.
  const drag = useRef<{ id: number; mode: SliderMode; anchor: { frac: number; value: number } } | null>(null)
  const emit = (next: number): void => {
    if (next === at) return
    gesture?.fire()
    onChange(toValue(next))
  }
  const fracOf = (e: ReactPointerEvent<HTMLInputElement>): number => {
    const box = e.currentTarget.getBoundingClientRect()
    return trackFraction(e.clientX - box.left, box.width)
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLInputElement>): void => {
    if (disabled || e.button !== 0) return
    gesture?.arm()
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    e.currentTarget.classList.add('is-held')
    const frac = fracOf(e)
    const mode = sliderModeOf(e)
    // Fine starts where the value is; the others under the pointer.
    const next = mode === 'fine' ? at : sliderDragValue(frac, mode, r)
    drag.current = { id: e.pointerId, mode, anchor: { frac, value: next } }
    emit(next)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLInputElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const frac = fracOf(e)
    const mode = sliderModeOf(e)
    // A modifier pressed or let go mid-drag: the way is counted from here.
    if (mode !== d.mode) d.anchor = { frac, value: at }
    d.mode = mode
    emit(sliderDragValue(frac, mode, r, d.anchor))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLInputElement>): void => {
    if (drag.current?.id !== e.pointerId) return
    drag.current = null
    e.currentTarget.classList.remove('is-held')
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  return (
    <div className={disabled ? 'ui-slider is-disabled' : 'ui-slider'} data-testid={testid}>
      <label className="ui-slider-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-range"
        type="range"
        min={decades ? 0 : min}
        max={decades ? last : max}
        step={decades ? 1 : step}
        value={decades ? Math.round(pos) : value}
        disabled={disabled}
        style={fill}
        aria-valuetext={decades ? formatFree(value * scale, dec, unit) : unit ? formatNumber(value * scale, dec, unit) : undefined}
        data-testid={trackTestid ?? (testid ? `${testid}.range` : undefined)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          gesture?.arm()
          // Shift + arrow: ten steps; Alt + arrow: a tenth of one. The rest is the native range's.
          const next = sliderKeyValue(e.key, sliderModeOf(e), at, r)
          if (next === null) return
          e.preventDefault()
          emit(decades ? Math.round(next) : next)
        }}
        onChange={(e) => {
          gesture?.fire()
          onChange(decades ? decadeValue(Number(e.target.value), min, max) : Number(e.target.value))
        }}
      />
      <NumberField
        value={value * scale}
        onChange={(v) => {
          // A typed value or an arrow key: its own step (a held key stays one).
          gesture?.arm()
          gesture?.fire()
          onChange(clamp(v / scale, min, max))
        }}
        min={min * scale}
        max={max * scale}
        step={shownStep}
        unit={unit}
        decimals={dec}
        free={free}
        disabled={disabled}
        label={t('ui.slider.value', { label })}
        testid={nameOf ? `${nameOf}.value` : undefined}
        className="ui-slider-value"
      />
    </div>
  )
}
