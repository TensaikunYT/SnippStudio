// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the building blocks decide, as plain functions (SnippStudio phase 3a.2):
// a number's next value for a key, reading and writing a number with its unit,
// moving through a row of items with the arrow keys, where a popover goes, the
// toast stack. The components only wire these to the DOM, so the decisions are
// tested without one (src/test/ui-kit.test.ts).
import { localNum, unitShown, withUnit } from './format'
import { ariaModName, modKeyName, uiPlatform, type UiPlatform } from '../os-platform'

export interface NumRange {
  min?: number
  max?: number
  step?: number
}

export const clamp = (v: number, lo = -Infinity, hi = Infinity): number => Math.min(hi, Math.max(lo, v))

/** Decimals a step needs (1 → 0, 0.1 → 1, 0.25 → 2). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const s = String(step)
  const e = /e-(\d+)$/.exec(s)
  if (e) return Number(e[1])
  const dot = s.indexOf('.')
  return dot < 0 ? 0 : s.length - dot - 1
}

/** A value on the step grid (counted from min) and inside the range. */
export function snap(v: number, r: NumRange): number {
  const step = r.step && r.step > 0 ? r.step : 0
  const base = Number.isFinite(r.min) ? (r.min as number) : 0
  let x = step ? base + Math.round((v - base) / step) * step : v
  x = clamp(x, r.min, r.max)
  return step ? Number(x.toFixed(decimalsOf(step))) : x
}

/** The value a key gives a number control, or null for a key that is not one
 *  of its own. Arrows step (Shift: ten steps), PageUp/Down ten steps, Home and
 *  End the ends of the range. */
export function keyValue(key: string, shift: boolean, v: number, r: NumRange): number | null {
  const step = (r.step && r.step > 0 ? r.step : 1) * (shift ? 10 : 1)
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return snap(v + step, r)
    case 'ArrowDown':
    case 'ArrowLeft':
      return snap(v - step, r)
    case 'PageUp':
      return snap(v + step * (shift ? 1 : 10), r)
    case 'PageDown':
      return snap(v - step * (shift ? 1 : 10), r)
    case 'Home':
      return Number.isFinite(r.min) ? (r.min as number) : null
    case 'End':
      return Number.isFinite(r.max) ? (r.max as number) : null
    default:
      return null
  }
}

// ---- free numbers (phase 3c.3: the Inspector's fields) ------------------------
// A field that replaced an old one keeps its value rules: what is typed is only
// kept in range (33.3 stays 33.3 on a step of 0.5), an arrow adds one step to
// the value as it is (no grid), and the number shows at most `decimals`
// decimals with no trailing zeros.

/** A typed value of a free field: kept in range, nothing else. */
export const freeValue = (v: number, r: NumRange): number => clamp(v, r.min, r.max)

/** The value a key gives a free field (null: not one of its keys). Arrows add
 *  one step (Shift: ten), PageUp/PageDown ten, Home and End the ends. */
export function freeKeyValue(key: string, shift: boolean, v: number, r: NumRange): number | null {
  const step = r.step && r.step > 0 ? r.step : 1
  // Rounded to four decimals, so repeated nudges do not grow a tail of noise.
  const by = (d: number): number => freeValue(Number((v + d).toFixed(4)), r)
  switch (key) {
    case 'ArrowUp':
      return by(step * (shift ? 10 : 1))
    case 'ArrowDown':
      return by(-step * (shift ? 10 : 1))
    case 'PageUp':
      return by(step * 10)
    case 'PageDown':
      return by(-step * 10)
    case 'Home':
      return Number.isFinite(r.min) ? (r.min as number) : null
    case 'End':
      return Number.isFinite(r.max) ? (r.max as number) : null
    default:
      return null
  }
}

// ---- a track by decades (core polish B: the speed slider, 0.1x – 100x) --------
// A straight track cannot hold a range of a thousand to one: half of it would
// be 50x – 100x. On a track by decades every tenfold takes the same length
// and the values along one are its two-figure ones (0.10, 0.11 … 0.99, 1.0,
// 1.1 … 9.9, 10, 11 … 100): round numbers under the pointer and one of them
// per arrow key, with no snapping. Positions are whole numbers from 0.

// ---- the slider's drag and keys with a modifier (arayüz v4, UI-V4-PLAN.md §2) ----
/** How a slider moves: as the pointer says, by tens of steps (Shift), by
 *  tenths of a step and a tenth of the pointer's way (Alt). */
export type SliderMode = 'normal' | 'coarse' | 'fine'

export const sliderModeOf = (e: { shiftKey: boolean; altKey: boolean }): SliderMode => (e.altKey ? 'fine' : e.shiftKey ? 'coarse' : 'normal')

/** The step a mode puts the value on. */
export const modeStep = (step: number, mode: SliderMode): number => (mode === 'coarse' ? step * 10 : mode === 'fine' ? step / 10 : step)

/** Where along a track of `width` pixels (its thumb `thumb` wide) the pointer
 *  at `x` (from the track's left) is, 0–1: the native range's own reading. */
export const trackFraction = (x: number, width: number, thumb = 14): number => (width > thumb ? clamp((x - thumb / 2) / (width - thumb), 0, 1) : 0)

/**
 * A drag's value at the pointer's fraction `frac` of the track. Normal: the
 * value under the pointer on the step grid; coarse: the same on a grid of ten
 * steps; fine: the value the drag had at `anchor` plus a tenth of the
 * pointer's way since, on a grid of a tenth of a step.
 */
export function sliderDragValue(frac: number, mode: SliderMode, r: { min: number; max: number; step: number }, anchor?: { frac: number; value: number }): number {
  const span = r.max - r.min
  const step = modeStep(r.step, mode)
  const raw = mode === 'fine' && anchor ? anchor.value + ((frac - anchor.frac) * span) / 10 : r.min + clamp(frac, 0, 1) * span
  return snap(raw, { min: r.min, max: r.max, step })
}

/** An arrow key with a modifier: Shift ten steps, Alt a tenth of one; null for
 *  a key the native range answers itself (no modifier, or not an arrow). */
export function sliderKeyValue(key: string, mode: SliderMode, v: number, r: { min: number; max: number; step: number }): number | null {
  if (mode === 'normal') return null
  const dir = key === 'ArrowRight' || key === 'ArrowUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' ? -1 : 0
  if (!dir) return null
  const step = modeStep(r.step, mode)
  // (Rounded to the finer of the two steps: Shift from 0.51 is 0.61, not 0.6.)
  return clamp(Number((v + dir * step).toFixed(decimalsOf(Math.min(step, r.step)))), r.min, r.max)
}

/** Positions in one tenfold. */
export const DECADE_STEPS = 90

/** The last position of a track from `min` to `max` (both above 0). */
export function decadeLast(min: number, max: number): number {
  return Math.max(1, Math.round(decadePos(max, min, Infinity)))
}

/** Where `v` is on the track (a fraction between two positions for a value
 *  that is not one of the track's own, a typed 37.5 for one). */
export function decadePos(v: number, min: number, max: number): number {
  const x = clamp(v, min, max) / min
  const decade = Math.min(Math.floor(Math.log10(x) + 1e-9), 300)
  return decade * DECADE_STEPS + (x / 10 ** decade - 1) * 10
}

/** The value at a position. */
export function decadeValue(pos: number, min: number, max: number): number {
  const p = Math.max(0, Math.round(pos))
  const decade = Math.floor(p / DECADE_STEPS)
  const v = Number(((min * 10 ** decade * (10 + (p % DECADE_STEPS))) / 10).toPrecision(10))
  return clamp(v, min, max)
}

/** A free field's number: at most `decimals` decimals, trailing zeros dropped,
 *  in the interface's decimal mark (audit G7: "0,25" in Turkish), then its unit. */
export function formatFree(v: number, decimals = 2, unit?: string): string {
  const n = Number.isFinite(v) ? Number(v.toFixed(decimals)) : 0
  const s = localNum(String(Object.is(n, -0) ? 0 : n))
  return withUnit(s, unit)
}

/** A typed number: "120", "120 %", "%120", "-6,5 dB", "−6.5", "0,35 sn". Null when it is not one. */
export function parseNumber(text: string, unit?: string): number | null {
  let s = text.trim().replace(/−/g, '-').replace(/\s+/g, '')
  if (unit) {
    // (The unit as written, or as the language shows it: "s" / "sn".)
    for (const w of [unitShown(unit), unit]) {
      const u = w.replace(/\s+/g, '')
      if (u && s.toLowerCase().endsWith(u.toLowerCase())) {
        s = s.slice(0, s.length - u.length)
        break
      }
    }
  }
  s = s.replace(/%$/, '').replace(/^%/, '').replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A number as a field shows it: fixed decimals in the interface's decimal
 *  mark, then its unit. */
export function formatNumber(v: number, decimals = 0, unit?: string): string {
  const s = localNum((Object.is(v, -0) ? 0 : v).toFixed(decimals))
  return withUnit(s, unit)
}

/** A shortcut as the eye reads it: "ctrl+d" → "Ctrl D" ("⌘ D" on a Mac:
 *  the modifier names are the platform's, os-platform.ts, phase 10a.5). */
export function shortcutLabel(s: string, platform: UiPlatform = uiPlatform()): string {
  const names: Record<string, string> = { ctrl: modKeyName('ctrl', platform), shift: modKeyName('shift', platform), alt: modKeyName('alt', platform), meta: modKeyName('meta', platform), del: 'Del', delete: 'Del', esc: 'Esc', escape: 'Esc', enter: 'Enter', space: 'Space', backspace: 'Backspace' }
  return s
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => names[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join(' ')
}

/** A shortcut as aria-keyshortcuts wants it: "ctrl+d" → "Control+D" (Meta+D on a Mac). */
export function ariaShortcut(s: string, platform: UiPlatform = uiPlatform()): string {
  const names: Record<string, string> = { ctrl: ariaModName('ctrl', platform), shift: 'Shift', alt: 'Alt', meta: 'Meta', del: 'Delete', esc: 'Escape' }
  return s
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => names[p.toLowerCase()] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+')
}

export type Orientation = 'horizontal' | 'vertical'

/** The index the focus moves to in a row (or column) of items for a key, the
 *  disabled ones skipped; null when the key is not a move. Wraps at the ends. */
export function rovingIndex(current: number, key: string, count: number, disabled: (i: number) => boolean = () => false, orientation: Orientation = 'horizontal'): number | null {
  if (count <= 0) return null
  const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
  const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
  const find = (from: number, dir: 1 | -1): number | null => {
    for (let k = 1; k <= count; k++) {
      const i = (((from + dir * k) % count) + count) % count
      if (!disabled(i)) return i
    }
    return null
  }
  switch (key) {
    case next:
      return find(current, 1)
    case prev:
      return find(current, -1)
    case 'Home':
      return find(-1, 1)
    case 'End':
      return find(count, -1)
    default:
      return null
  }
}

/** Type-ahead: the next enabled item after `from` whose label starts with the letter. */
export function typeahead(labels: readonly string[], from: number, char: string, disabled: (i: number) => boolean = () => false): number | null {
  const c = char.toLowerCase()
  if (c.length !== 1 || !/\S/.test(c)) return null
  for (let k = 1; k <= labels.length; k++) {
    const i = (from + k) % labels.length
    if (!disabled(i) && labels[i].trim().toLowerCase().startsWith(c)) return i
  }
  return null
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Size {
  w: number
  h: number
}
export interface Placed {
  x: number
  y: number
  side: 'above' | 'below'
  /** Taller than the room on either side: the menu stays under its button
   *  and scrolls within this height (phase 11b, U6). */
  maxH?: number
}

const MARGIN = 8

/** A menu under its button (its left edge on the button's), above it when
 *  there is no room below, always inside the window. */
export function placeMenu(anchor: Rect, size: Size, view: Size, gap = 4): Placed {
  const below = anchor.y + anchor.h + gap
  const fitsBelow = below + size.h <= view.h - MARGIN
  const above = anchor.y - gap - size.h
  const side = fitsBelow || above < MARGIN ? 'below' : 'above'
  const y = side === 'below' ? Math.min(below, Math.max(MARGIN, view.h - MARGIN - size.h)) : above
  const x = clamp(anchor.x, MARGIN, Math.max(MARGIN, view.w - MARGIN - size.w))
  // (Room on neither side: moved up, it lay over its own button — 9 px of
  // "Dosya" at 768 px: phase 11b, U6. It stays under the button and scrolls,
  // when that leaves a menu of some height.)
  const room = view.h - MARGIN - below
  if (side === 'below' && y < below && room >= 160) return { x, y: below, side, maxH: room }
  return { x, y, side }
}

/** A tooltip centred over what it explains, under it when there is no room above. */
export function placeTooltip(anchor: Rect, size: Size, view: Size, gap = 6): Placed {
  const above = anchor.y - gap - size.h
  const side = above >= MARGIN ? 'above' : 'below'
  const y = side === 'above' ? above : anchor.y + anchor.h + gap
  const x = clamp(anchor.x + anchor.w / 2 - size.w / 2, MARGIN, Math.max(MARGIN, view.w - MARGIN - size.w))
  return { x, y, side }
}

/** The next focusable index when Tab (or Shift+Tab) is pressed inside a dialog: it wraps. */
export function trapIndex(current: number, count: number, back: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return back ? count - 1 : 0
  return (current + (back ? -1 : 1) + count) % count
}

// ---- toasts ----------------------------------------------------------------
export interface ToastAction {
  label: string
  run: () => void
}
export interface ToastItem {
  id: number
  text: string
  kind: 'info' | 'error'
  action?: ToastAction
  /** Milliseconds it stays (0: until dismissed). */
  timeout: number
}
export type ToastEvent = { type: 'push'; toast: ToastItem } | { type: 'dismiss'; id: number } | { type: 'clear' }

/** At most this many at once; the oldest goes first. */
export const TOAST_MAX = 4

/** How long a toast stays: longer when it has something to do or went wrong. */
export const toastTimeout = (t: { kind?: 'info' | 'error'; action?: unknown }): number => (t.action || t.kind === 'error' ? 8000 : 5000)

/** The stack after an event: newest last (drawn at the bottom), at most TOAST_MAX. */
export function toastsAfter(list: readonly ToastItem[], e: ToastEvent): ToastItem[] {
  if (e.type === 'clear') return []
  if (e.type === 'dismiss') return list.filter((t) => t.id !== e.id)
  const next = [...list.filter((t) => t.id !== e.toast.id), e.toast]
  return next.slice(Math.max(0, next.length - TOAST_MAX))
}
