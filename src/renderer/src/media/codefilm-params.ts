// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A code film's parameters and the project look (phase 5f, decisions 2–3).
// Pure: tested in Node (src/test/codefilm-params.test.ts).
//
// A page MAY say what can be set without touching its code:
//   window.__params = [{ key, label, type: 'text' | 'color' | 'number', value }, …]
// The app's guard (main/codefilm-guard.ts) writes down what it said and,
// before the page reads it back, puts the values the user set in the
// Inspector over its own (Asset.code.params). A page that says nothing gets no
// Parameters section. The project look (Project.look: an accent colour and a
// font, empty by default) is offered to every page as window.__snippLook; a
// page that does not read it is not changed by it. Both reach the page in its
// address (`snp=`), so every load of it (the preview's frame, a drawing
// window, the checker's fresh load, an export's reload) gets the same values.

export type ParamType = 'text' | 'color' | 'number'
export type ParamValue = string | number

/** One parameter as the page said it (its own value: the default). */
export interface ParamDef {
  key: string
  label: string
  type: ParamType
  value: ParamValue
  /** For a number: its range and step, when the page says them. */
  min?: number
  max?: number
  step?: number
}

/** The project look (phase 5f, decision 3): empty unless the user sets it. */
export interface ProjectLook {
  accent?: string
  font?: string
}

export const MAX_PARAMS = 40
const KEY = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
export const TEXT_MAX = 2000

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A value of `type`, or null when it is not one ('' is a colour: "none"). */
export function coerceParam(type: ParamType, v: unknown): ParamValue | null {
  if (type === 'number') {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
    return finite(n) ?? null
  }
  if (typeof v !== 'string') return null
  if (type === 'color') return v === '' || COLOR.test(v) ? v : null
  return v.slice(0, TEXT_MAX)
}

/** What a page said (through its guard), bounded: at most MAX_PARAMS, each
 *  with a known type and a value of that type; others left out. */
export function clampParamDefs(raw: unknown): ParamDef[] | null {
  if (!Array.isArray(raw)) return null
  const out: ParamDef[] = []
  const seen = new Set<string>()
  for (const x of raw.slice(0, MAX_PARAMS)) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    const type = o.type === 'text' || o.type === 'color' || o.type === 'number' ? o.type : null
    if (!KEY.test(key) || !type || seen.has(key)) continue
    const value = coerceParam(type, o.value)
    if (value === null) continue
    seen.add(key)
    const d: ParamDef = { key, label: typeof o.label === 'string' && o.label.trim() ? o.label.slice(0, 80) : key, type, value }
    if (type === 'number') {
      const min = finite(o.min)
      const max = finite(o.max)
      const step = finite(o.step)
      if (min !== null) d.min = min
      if (max !== null && (min === null || max >= min)) d.max = max
      if (step !== null && step > 0) d.step = step
    }
    out.push(d)
  }
  return out
}

/** The user's values, kept only for keys the page has and of its types. */
export function cleanValues(defs: readonly ParamDef[], values: Record<string, unknown> | undefined): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {}
  if (!values) return out
  for (const d of defs) {
    if (!(d.key in values)) continue
    const v = coerceParam(d.type, values[d.key])
    if (v !== null) out[d.key] = v
  }
  return out
}

/** The project look as stored: only what is set, a colour of #rgb… form, a
 *  font name of at most 80 characters (no quotes). Null when nothing is. */
export function cleanLook(look: unknown): ProjectLook | null {
  if (!look || typeof look !== 'object') return null
  const o = look as Record<string, unknown>
  const out: ProjectLook = {}
  if (typeof o.accent === 'string' && COLOR.test(o.accent)) out.accent = o.accent
  if (typeof o.font === 'string') {
    const f = o.font.replace(/["'\\;{}<>]/g, '').trim().slice(0, 80)
    if (f) out.font = f
  }
  return out.accent || out.font ? out : null
}

/** The values a page is opened with, as one query part (`snp=<base64url
 *  of JSON>`), or '' when there are none: a film without parameters and a
 *  project without a look are opened exactly as before. */
/** The most the values and the look take in a page's address (bytes of JSON). */
export const QUERY_MAX = 16_000

const sizeOf = (body: Record<string, unknown>): number => new TextEncoder().encode(JSON.stringify(body)).length

/** The values as a page gets them (audit O2: nothing is dropped silently).
 *  The look always goes; a text is at most TEXT_MAX characters; when all
 *  of them do not fit in QUERY_MAX, the longest texts are cut until they
 *  do. `cut`: the keys whose text the page gets shorter than it is kept
 *  (the Inspector shows these values and says so). */
export function fittedValues(values: Record<string, unknown> | undefined, look: unknown): { v: Record<string, ParamValue>; l: ProjectLook | null; cut: string[] } {
  const v: Record<string, ParamValue> = {}
  const cut = new Set<string>()
  if (values)
    for (const [k, x] of Object.entries(values)) {
      if (!KEY.test(k)) continue
      if (typeof x === 'string') {
        v[k] = x.slice(0, TEXT_MAX)
        if (x.length > TEXT_MAX) cut.add(k)
      } else if (finite(x) !== null) v[k] = x as number
    }
  const l = cleanLook(look)
  const body = (): Record<string, unknown> => ({ ...(Object.keys(v).length ? { v } : {}), ...(l ? { l } : {}) })
  for (let round = 0; round < 64 && sizeOf(body()) > QUERY_MAX; round++) {
    // The longest text, cut by what is over (at least by an eighth of it).
    const texts = Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0)
    if (!texts.length) break
    const [k, s] = texts.reduce((a, b) => (b[1].length > a[1].length ? b : a))
    const over = sizeOf(body()) - QUERY_MAX
    // (Code points, not halves of a pair: an emoji is cut whole.)
    const chars = [...s]
    v[k] = chars.slice(0, Math.max(0, chars.length - Math.max(Math.ceil(chars.length / 8), Math.ceil(over / 4)))).join('')
    cut.add(k)
  }
  return { v, l, cut: [...cut] }
}

export function valuesQuery(values: Record<string, unknown> | undefined, look: unknown): string {
  const { v, l } = fittedValues(values, look)
  const body: Record<string, unknown> = {}
  if (Object.keys(v).length) body.v = v
  if (l) body.l = l
  if (!Object.keys(body).length) return ''
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return 'snp=' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What `valuesQuery` wrote, read back (the guard does the same in the page). */
export function readValuesQuery(search: string): { v?: Record<string, unknown>; l?: ProjectLook } | null {
  const m = /(?:^|[?&])snp=([A-Za-z0-9_-]+)(?:&|$)/.exec(search)
  if (!m) return null
  try {
    const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))
    const u = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
    const o = JSON.parse(new TextDecoder().decode(u))
    return o && typeof o === 'object' ? o : null
  } catch {
    return null
  }
}

/** The project look as one fact for the agent (frames context:true), only
 *  when the user set it: what it is, never what to do with it. */
export function lookFact(look: unknown): string | null {
  const l = cleanLook(look)
  if (!l) return null
  const parts = [...(l.accent ? [`accent ${l.accent}`] : []), ...(l.font ? [`font ${JSON.stringify(l.font)}`] : [])]
  return `Project look (set by the user): ${parts.join(', ')}.`
}
