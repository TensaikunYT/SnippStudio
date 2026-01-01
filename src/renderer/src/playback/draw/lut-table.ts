// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The LUTs a frame is drawn with ("cila" part D): the tables, by the key a
// clip names them with (`Clip.lut`), and nothing of the DOM, so the tests and
// the export's checks can read them.
//
// Three kinds of key:
//   `preset:<id>`  a built-in look, made by code the first time it is asked for
//                  (no file of anyone's: LUT_PRESETS below);
//   a name the project declares (`Project.luts`): the .cube file read from
//                  its path (luts.ts); missing when the file is not there;
//   any other name: a .cube imported before part D, kept on this computer
//                  only (IndexedDB, luts.ts).
import type { LutTable } from './fx-math'
import { PRODUCT_NAME } from '../../../../shared/product'

export interface LutEntry extends LutTable {
  /** Unique per table read: the GPU's copy is kept by it. */
  id: string
}

let serial = 0
const entry = (key: string, t: LutTable): LutEntry => ({ n: t.n, data: t.data, id: `${key}#${++serial}` })

/** The project's own LUT files, read (by name). */
const projectLuts = new Map<string, LutEntry>()
/** The names the open project declares (read or not). */
let declared = new Set<string>()
/** Declared and being read right now (not missing yet). */
const loading = new Set<string>()
/** The .cube files kept on this computer only (by name). */
const localLuts = new Map<string, LutEntry>()
const presets = new Map<string, LutEntry>()

const listeners = new Set<() => void>()
let epoch = 0
/** Told when a table arrives, goes or the looks' hover changes. */
export function onLutChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
/** Counts every such change (a React snapshot). */
export const lutEpoch = (): number => epoch
function changed(): void {
  epoch++
  for (const fn of [...listeners]) fn()
}

export const PRESET_PREFIX = 'preset:'

// ---- the built-in looks -------------------------------------------------------
// Each is a function of a colour, written here and sampled into a 33³ table:
// nothing is downloaded and no file of a third party is shipped.

const c01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
/** More (k > 0) or less (k < 0) contrast around the middle; 0 and 1 stay. */
const curve = (x: number, k: number): number => {
  const v = c01(x)
  return v < 0.5 ? 0.5 * Math.pow(2 * v, 1 + k) : 1 - 0.5 * Math.pow(2 * (1 - v), 1 + k)
}
type Rgb = [number, number, number]
const sat = (c: Rgb, s: number): Rgb => {
  const l = luma(c[0], c[1], c[2])
  return [mix(l, c[0], s), mix(l, c[1], s), mix(l, c[2], s)]
}
const con = (c: Rgb, k: number): Rgb => [curve(c[0], k), curve(c[1], k), curve(c[2], k)]
/** A colour laid into the shadows and another into the highlights. */
const split = (c: Rgb, shadow: Rgb, high: Rgb, amount: number): Rgb => {
  const l = c01(luma(c[0], c[1], c[2]))
  const ws = (1 - l) * (1 - l) * amount
  const wh = l * l * amount
  return [c[0] + (shadow[0] - 0.5) * ws + (high[0] - 0.5) * wh, c[1] + (shadow[1] - 0.5) * ws + (high[1] - 0.5) * wh, c[2] + (shadow[2] - 0.5) * ws + (high[2] - 0.5) * wh]
}
/** Black lifted to `lo`, white lowered to `hi`. */
const range = (c: Rgb, lo: number, hi: number): Rgb => [mix(lo, hi, c[0]), mix(lo, hi, c[1]), mix(lo, hi, c[2])]

export interface LutPreset {
  id: string
  look: (c: Rgb) => Rgb
}

export const LUT_PRESETS: LutPreset[] = [
  // Warm film: a soft curve, warm highlights, a little warmth in the shadows.
  { id: 'warmFilm', look: (c) => split(sat(con(range(c, 0.02, 0.98), 0.18), 0.94), [0.52, 0.5, 0.46], [0.6, 0.52, 0.4], 0.5) },
  // Cool: blue shadows, clean highlights, less colour.
  { id: 'cool', look: (c) => split(sat(con(c, 0.15), 0.88), [0.42, 0.5, 0.6], [0.47, 0.5, 0.56], 0.5) },
  // Teal and orange: the shadows towards teal, the lights towards orange.
  { id: 'tealOrange', look: (c) => split(sat(con(c, 0.2), 1.08), [0.36, 0.53, 0.58], [0.64, 0.52, 0.38], 0.6) },
  // Bleach bypass: half the colour, hard contrast.
  { id: 'bleach', look: (c) => con(sat(c, 0.45), 0.55) },
  // Faded matte: lifted blacks, lowered whites, soft colour.
  { id: 'fadedMatte', look: (c) => split(range(sat(con(c, -0.12), 0.78), 0.09, 0.94), [0.48, 0.52, 0.5], [0.52, 0.5, 0.47], 0.3) },
  // Black and white with bite: a red-filter mix, a strong curve.
  { id: 'monoContrast', look: (c) => { const l = curve(0.4 * c[0] + 0.5 * c[1] + 0.1 * c[2], 0.5); return [l, l, l] } },
  // Old film: faded, yellowed, little colour.
  { id: 'oldFilm', look: (c) => { const s = sat(con(c, 0.08), 0.5); return range(split([s[0] * 1.06, s[1] * 1.0, s[2] * 0.84], [0.5, 0.48, 0.44], [0.6, 0.56, 0.42], 0.45), 0.06, 0.95) } },
  // Night: darker, colder, less colour.
  { id: 'night', look: (c) => { const s = sat(c, 0.55); return con([Math.pow(c01(s[0]), 1.5) * 0.62, Math.pow(c01(s[1]), 1.4) * 0.72, Math.pow(c01(s[2]), 1.25) * 0.95], 0.2) } }
]

export const PRESET_SIZE = 33

/** A look sampled into a table of n³ entries (red fastest). */
export function tableOf(look: (c: Rgb) => Rgb, n = PRESET_SIZE): LutTable {
  const data = new Float32Array(n * n * n * 3)
  let i = 0
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const o = look([r / (n - 1), g / (n - 1), b / (n - 1)])
        data[i++] = c01(o[0])
        data[i++] = c01(o[1])
        data[i++] = c01(o[2])
      }
    }
  }
  return { n, data }
}

function presetFor(key: string): LutEntry | null {
  const had = presets.get(key)
  if (had) return had
  const p = LUT_PRESETS.find((x) => PRESET_PREFIX + x.id === key)
  if (!p) return null
  const made = entry(key, tableOf(p.look))
  presets.set(key, made)
  return made
}

// ---- reading a key ----------------------------------------------------------------

/** The table a clip's `lut` names, or null: no such look, a project LUT whose
 *  file is missing (or still being read), a name this computer does not have. */
export function lutFor(key: string | null | undefined): LutEntry | null {
  if (!key) return null
  if (key.startsWith(PRESET_PREFIX)) return presetFor(key)
  // A LUT the project declares is the project's file and nothing else: one
  // of the same name kept on this computer does not stand in for a file
  // that is missing (the picture would differ on the next computer).
  if (declared.has(key)) return projectLuts.get(key) ?? null
  return localLuts.get(key) ?? null
}

/** A clip names a LUT that cannot be drawn (and it is not merely on its way). */
export const lutMissing = (key: string | null | undefined): boolean => !!key && !loading.has(key) && !lutFor(key)

/** What kind of key this is, for the Inspector. */
export function lutKind(key: string): 'preset' | 'project' | 'local' {
  return key.startsWith(PRESET_PREFIX) ? 'preset' : declared.has(key) ? 'project' : 'local'
}

/** What parallel export asks (export/parallel.ts): a LUT only this window
 *  holds. A built-in look is made in any window. */
export const lutRegistry = {
  has: (key: string): boolean => !key.startsWith(PRESET_PREFIX) && !!lutFor(key)
}

// ---- what luts.ts tells this module ----------------------------------------------

/** The names the open project declares; tables of names it no longer has go. */
export function setDeclaredLuts(names: readonly string[]): void {
  declared = new Set(names)
  for (const k of [...projectLuts.keys()]) if (!declared.has(k)) projectLuts.delete(k)
  for (const k of [...loading]) if (!declared.has(k)) loading.delete(k)
  changed()
}
/** A project LUT's file is being read. */
export function setLutLoading(name: string, on: boolean): void {
  if (on) loading.add(name)
  else loading.delete(name)
  changed()
}
/** A project LUT's table (null: its file is not there or is not a LUT). */
export function setProjectLut(name: string, table: LutTable | null): void {
  loading.delete(name)
  if (table) projectLuts.set(name, entry(name, table))
  else projectLuts.delete(name)
  changed()
}
export const hasProjectLut = (name: string): boolean => projectLuts.has(name)
/** A .cube kept on this computer only (null: removed). */
export function setLocalLut(name: string, table: LutTable | null): void {
  if (table) localLuts.set(name, entry(name, table))
  else localLuts.delete(name)
  changed()
}
export const localLutNames = (): string[] => [...localLuts.keys()].sort()

// ---- the looks' hover -------------------------------------------------------------
// Pointing at a look in the Inspector shows it in the preview without
// touching the project: one clip's LUT is read as another for as long as the
// pointer stays. Only a frame not drawn in final quality reads it (the
// preview), so an export running meanwhile never does.
let hover: { clipId: string; lut: string | null } | null = null
export function setLutHover(h: { clipId: string; lut: string | null } | null): void {
  if (hover === h || (hover && h && hover.clipId === h.clipId && hover.lut === h.lut)) return
  hover = h
  changed()
}
/** The LUT key a clip is drawn with. */
export function lutKeyOf(clip: { id: string; lut?: string }, final: boolean): string | undefined {
  if (!final && hover && hover.clipId === clip.id) return hover.lut ?? undefined
  return clip.lut
}

// ---- .cube ---------------------------------------------------------------------------

/** Parses a .cube file into a flat RGB table. Throws on malformed files. */
export function parseCube(text: string): LutTable {
  let n = 0
  const rows: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('TITLE') || line.startsWith('DOMAIN')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      n = parseInt(line.split(/\s+/)[1], 10)
      continue
    }
    if (line.startsWith('LUT_1D_SIZE')) throw new Error('1D LUTs are not supported — use a 3D .cube')
    const parts = line.split(/\s+/).map(Number)
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) rows.push(...parts)
  }
  if (n < 2 || n > 129 || rows.length !== n * n * n * 3) throw new Error('Not a valid 3D .cube LUT')
  return { n, data: Float32Array.from(rows) }
}

/** A table written as a .cube file (the tests' and the checks' LUT files). */
export function cubeText(t: LutTable, title = PRODUCT_NAME): string {
  const out = [`TITLE "${title}"`, `LUT_3D_SIZE ${t.n}`]
  for (let i = 0; i < t.data.length; i += 3) out.push(`${t.data[i].toFixed(6)} ${t.data[i + 1].toFixed(6)} ${t.data[i + 2].toFixed(6)}`)
  return out.join('\n') + '\n'
}
