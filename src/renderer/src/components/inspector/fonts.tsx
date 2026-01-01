// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Inspector's font pieces: the font picker (and the bundled faces it waits
// for), the weights, the "add a font" button and the hand-drawn wobble
// controls. Moved out of Inspector.tsx in SnippStudio phase 2B; onto the
// building blocks in phase 3c.3 (no change of behaviour).
import { useEffect, useRef, useState } from 'react'
import { addCustomFont, fontPickerChoices, FONT_LABELS, HANDWRITTEN_FONTS } from '../../fonts'
import type { CaptionStyle } from '../../types'
import { Button, Select, Toggle, Tooltip, notify, t as say, useT, type SelectOption, type StringKey } from '../../ui'
import { UndoSlider } from './sliders'

/**
 * Weights by name. "700" is a number you have to know the meaning of; Bold is
 * the same thing said in the way everyone already says it. The numbers are
 * what gets stored, so nothing about existing projects changes.
 *
 * A display face (Anton, Bangers, Bebas) ships one weight and simply looks the
 * same at all of these — that is the font, not the control.
 */
export const FONT_WEIGHTS: [number, StringKey][] = [
  [400, 'insp.weight.regular'],
  [500, 'insp.weight.medium'],
  [600, 'insp.weight.semibold'],
  [700, 'insp.weight.bold'],
  [800, 'insp.weight.extraBold'],
  [900, 'insp.weight.black']
]

/** The weights as a select's options. */
export const weightOptions = (): SelectOption[] => FONT_WEIGHTS.map(([w, key]) => ({ value: String(w), label: say(key) }))

/**
 * The font picker.
 *
 * Two panels were rendering the same eighteen options; now they render this.
 * The handwritten pair sits in a group of its own so their names can stay
 * short — the closed box draws the chosen option in that option's own face,
 * and a marker font needs every pixel.
 */
export function FontSelect({
  value,
  onChange,
  label,
  testid,
  ...field
}: {
  value: string
  onChange: (family: string) => void
  /** Its name when no Field label names it. */
  label?: string
  testid?: string
  /** (A Field gives it its label's id.) */
  id?: string
  'aria-describedby'?: string
}): JSX.Element {
  const t = useT()
  useFontVersion()
  // The faces this computer has (all of FONT_FAMILIES on Windows); one it
  // lacks shows only when chosen, marked (phase 10a.6, F1).
  const choices = fontPickerChoices(value)
  const missing = new Set(choices.filter((c) => c.missing).map((c) => c.family))
  const families = choices.map((c) => c.family)
  const rest = families.filter((f) => !HANDWRITTEN_FONTS.includes(f))
  const hand = HANDWRITTEN_FONTS.filter((f) => families.includes(f))
  const option = (f: string, group?: string): SelectOption => ({ value: f, label: missing.has(f) ? t('font.missing.option', { name: FONT_LABELS[f] ?? f }) : FONT_LABELS[f] ?? f, fontFamily: `"${f}"`, group })
  return (
    <Select
      value={value}
      label={label}
      testid={testid}
      style={{ fontFamily: `"${value}"` }}
      {...field}
      options={[...hand.map((f) => option(f, t('insp.font.handwritten'))), ...rest.map((f) => option(f))]}
      onChange={onChange}
    />
  )
}

/**
 * The hand-drawn wobble. Two numbers and a switch, because there is nothing
 * else to say about it: how much, and how often it redraws.
 */
export function BoilControls({
  value,
  onChange
}: {
  value: CaptionStyle['boil']
  onChange: (v: NonNullable<CaptionStyle['boil']>) => void
}): JSX.Element {
  const t = useT()
  const on = !!value?.enabled
  const amount = value?.amount ?? 1
  const fps = value?.fps ?? 10
  return (
    <>
      <Tooltip content={t('insp.boil.hint')}>
        <div>
          <Toggle label={t('insp.boil.title')} checked={on} onChange={(enabled) => onChange({ enabled, amount, fps })} />
        </div>
      </Tooltip>
      {on && (
        <>
          <UndoSlider
            label={t('insp.boil.amount')}
            value={amount}
            onChange={(v) => onChange({ enabled: true, amount: v, fps })}
            min={0.2}
            max={2}
            step={0.1}
          />
          {/* 8-12 is what hand-drawn animation actually runs at. Higher and it
              stops reading as redrawing and starts reading as vibration. */}
          <UndoSlider
            label={t('insp.boil.fps')}
            value={fps}
            onChange={(v) => onChange({ enabled: true, amount, fps: v })}
            min={2}
            max={24}
            step={1}
            fmt={(v) => v.toFixed(0)}
          />
        </>
      )}
    </>
  )
}

/** Re-renders when a custom font is imported (FONT_FAMILIES is mutable). */
export function useFontVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV((x) => x + 1)
    window.addEventListener('fonts-changed', bump)
    return () => window.removeEventListener('fonts-changed', bump)
  }, [])
  return v
}

/** Small "import a .ttf/.otf" button that feeds the font dropdowns. */
export function AddFontButton(): JSX.Element {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Tooltip content={t('insp.font.add.hint')}>
        <Button size="sm" icon="plus" className="insp-fixed" onClick={() => inputRef.current?.click()}>
          {t('insp.font.add')}
        </Button>
      </Tooltip>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          addCustomFont(file)
            .then((name) => notify({ text: t('insp.font.added', { name }) }))
            .catch(() => notify({ text: t('insp.font.failed'), kind: 'error' }))
        }}
      />
    </>
  )
}
