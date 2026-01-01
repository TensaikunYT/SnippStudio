// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/** A slider's editable box uses the displayed unit, not an internal fraction. */
export function sliderNumberFormat(max: number, step: number, fmt: (value: number) => string): {
  scale: number
  suffix: string
  step: number
  digits: number
} {
  // (A percent reads "100%" or, in Turkish, "%100": phase 9 audit patch D11.)
  const one = fmt(1).trim()
  const percent = one === '100%' || one === '%100'
  const scale = percent ? 100 : 1
  // (Either decimal mark: a Turkish "0,50 sn" has the unit " sn", audit G7.)
  const suffix = percent ? '%' : fmt(max).match(/[-+]?\d+(?:[.,]\d+)?(.*)$/)?.[1] ?? ''
  const scaledStep = step * scale
  const digits = Math.max(2, Math.min(4, (String(scaledStep).split('.')[1] ?? '').length))
  return { scale, suffix, step: scaledStep, digits }
}

export function clampSliderEntry(entered: number, min: number, max: number, scale: number): number {
  return Math.max(min, Math.min(max, entered / scale))
}
