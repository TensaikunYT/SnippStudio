// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Numbers and times as the interface shows them (audit G6 / G7): one place.
// Before, four time forms lived side by side (the ruler's m:ss:ff read 26 s as
// "0:26:00", the transport's 00:04.60, a drag's 0:15.33, the export's 0:18)
// and every decimal had an English point in the Turkish interface too.
//
// - fmtTime: m:ss (h:mm:ss past an hour), with 1 or 2 decimals of a second
//   when asked: "0:26", "1:02:03", "0:04.60" ("0:04,60" in Turkish).
// - fmtNum: a number with the language's decimal mark ("0.25" / "0,25").
// - fmtSec / fmtTimes: a number of seconds ("1.61 s" / "1,61 sn") and a speed
//   ("0.25×" / "0,25×").
// What the agent reads, the files and the picture keep their own forms: this
// is for the eye only. Typing accepts both marks (ui/logic.ts parseNumber).
import { getLang, t } from './strings'

/** The decimal mark of the interface's language. */
export const decimalMark = (): string => (getLang() === 'tr' ? ',' : '.')

/** A number written with a point ("23.976", "-0.5") in the language's mark. */
export const localNum = (s: string): string => (decimalMark() === '.' ? s : s.replace(/(\d)\.(\d)/g, '$1,$2'))

/**
 * A number with `decimals` decimals: exactly that many when `fixed`, else at
 * most that many with the trailing zeros dropped (2.50 → "2.5", 3.00 → "3").
 */
export function fmtNum(v: number, decimals = 2, fixed = false): string {
  const n = Number.isFinite(v) ? v : 0
  let s = fixed ? n.toFixed(decimals) : String(Number(n.toFixed(decimals)))
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1)
  return localNum(s)
}

/** A unit as the language writes it: seconds are "sn" in Turkish (SOZLUK.md). */
export const unitShown = (unit: string): string => (unit === 's' && getLang() === 'tr' ? 'sn' : unit)

/** A number written out and its unit: "25 %" / "%25" (the percent sign goes
 *  first in Turkish, SOZLUK.md), any other unit after it ("6 dB", "0,35 sn").
 *  Phase 9 audit patch D11. */
export const withUnit = (s: string, unit?: string): string => (!unit ? s : unit === '%' && getLang() === 'tr' ? `%${s}` : `${s} ${unitShown(unit)}`)

/** A share 0–1 as a whole percent: "60%" / "%60". */
export const fmtPct = (share: number): string => {
  const n = Math.round((Number.isFinite(share) ? share : 0) * 100)
  return getLang() === 'tr' ? `%${n}` : `${n}%`
}

/** Seconds with their unit: "1.61 s" / "1,61 sn". */
export const fmtSec = (v: number, decimals = 2, fixed = true): string => t('fmt.seconds', { n: fmtNum(v, decimals, fixed) })

/** A speed: "0.25×" / "0,25×". */
export const fmtTimes = (v: number, decimals = 2): string => `${fmtNum(v, decimals)}×`

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * A time on the timeline, a length of a film: "0:26", "12:05", "1:02:03";
 * with `decimals` (1 or 2) the part of a second after the mark ("0:04.60").
 * Rounded to the last place shown, so 13.9999 s reads 0:14, never 0:13.100.
 */
export function fmtTime(sec: number, decimals: 0 | 1 | 2 = 0): string {
  const v = Number.isFinite(sec) ? sec : 0
  const scale = 10 ** decimals
  const units = Math.round(Math.abs(v) * scale)
  const whole = Math.floor(units / scale)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  const frac = decimals > 0 ? decimalMark() + String(units % scale).padStart(decimals, '0') : ''
  return (v < 0 && units > 0 ? '-' : '') + base + frac
}

/** The default name of a new project (types.ts newProject). */
const DEFAULT_NAME = 'Untitled'

/** A project's name as the interface shows it: the default one in the
 *  interface's language ("Adsız"), any other as the user wrote it. */
export const projectNameShown = (name: string | undefined | null): string => (!name || name === DEFAULT_NAME ? t('top.untitled') : name)
