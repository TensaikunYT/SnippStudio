// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The subtitles' style grid (REF-AB, worker S, item 10; REF-AB-PLAN-S.md): the
// looks a set of subtitles can take with one click, each shown as a sample
// line in its own look. They are made from what the program already has: its
// default, its built-in looks (inspector/subs-tab.tsx BUILT_IN_LOOKS, handed
// in), the user's saved presets, and a few combinations of what the subtitle
// renderer already draws (karaoke, the gliding word box, a dark band, the
// boiling hand). Nothing new is drawn: the renderer is not touched.
// Pure: the tests read it.
import { defaultCaptionStyle, type CaptionStyle } from '../types'

/** The fields a look sets. Everything else (size, place, line length, how
 *  many words to a line, key words) is the user's and stays. */
export const LOOK_FIELDS = [
  'fontFamily', 'fontWeight', 'color', 'outlineColor', 'outlineWidth', 'bgColor', 'bgOpacity', 'uppercase', 'popup', 'boil', 'shadow',
  'lineHeight', 'letterSpacing', 'bgRadius', 'bgPadX', 'bgPadY', 'bgBorder', 'highlight', 'gradient', 'blend'
] as const satisfies readonly (keyof CaptionStyle)[]

type LookField = (typeof LOOK_FIELDS)[number]
export type CaptionLook = Partial<Pick<CaptionStyle, LookField>>

/** The look fields as a new project has them (unset ones as undefined). */
export function lookBase(): CaptionLook {
  const d = defaultCaptionStyle() as Partial<CaptionStyle>
  const out: Record<string, unknown> = {}
  for (const k of LOOK_FIELDS) out[k] = d[k] === undefined ? undefined : structuredClone(d[k])
  return out as CaptionLook
}

/** What clicking a look writes: every look field back to the default, then
 *  the look's own. Without the reset a look kept parts of the one before
 *  (capitals, boiling, a box). */
export function lookPatch(look: CaptionLook | Partial<CaptionStyle>): CaptionLook {
  const out: Record<string, unknown> = { ...lookBase() }
  for (const k of LOOK_FIELDS) if (k in look) out[k] = structuredClone((look as Record<string, unknown>)[k])
  return out as CaptionLook
}

/** The style as it will be after the look: what a tile draws. */
export function styleWithLook(style: CaptionStyle, look: CaptionLook | Partial<CaptionStyle>): CaptionStyle {
  return { ...style, ...lookPatch(look) } as CaptionStyle
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Is the style wearing this look now (every look field as the look has it). */
export function wearsLook(style: CaptionStyle, look: CaptionLook | Partial<CaptionStyle>): boolean {
  const want = lookPatch(look) as Record<string, unknown>
  const has = style as unknown as Record<string, unknown>
  return LOOK_FIELDS.every((k) => same(has[k], want[k]))
}

/** The combinations of what the renderer already draws, the subtitles' own
 *  (the title looks are the Text page's). Ids are the string keys' last part. */
export const CAPTION_ONLY_LOOKS: [id: string, look: CaptionLook][] = [
  [
    'karaoke',
    {
      fontFamily: 'Archivo Black', fontWeight: 400, color: '#ffffff', outlineColor: '#000000', outlineWidth: 7,
      popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' },
      highlight: { enabled: true, color: '#ffd23f', scale: 1.1 }
    }
  ],
  [
    'box',
    {
      fontFamily: 'Archivo Black', fontWeight: 400, color: '#ffffff', outlineWidth: 0,
      shadow: { enabled: true, color: '#000000', blur: 10, dx: 0, dy: 3 },
      highlight: { enabled: true, color: '#ffffff', scale: 1, box: true, boxColor: '#7c3aed', boxGlide: 0.12 }
    }
  ],
  [
    'caps',
    {
      fontFamily: 'Anton', fontWeight: 400, color: '#ffffff', outlineColor: '#000000', outlineWidth: 5, uppercase: true, letterSpacing: 1,
      popup: { enabled: true, duration: 0.18, intensity: 0.6, style: 'pop' }
    }
  ],
  [
    'band',
    {
      fontFamily: 'Inter', fontWeight: 600, color: '#ffffff', outlineWidth: 0,
      bgColor: '#000000', bgOpacity: 0.85, bgRadius: 0, bgPadX: 0.4, bgPadY: 0.16
    }
  ],
  [
    'hand',
    {
      fontFamily: 'Permanent Marker', fontWeight: 400, color: '#ffffff', outlineColor: '#111111', outlineWidth: 4,
      boil: { enabled: true, amount: 1, fps: 10 }
    }
  ],
  [
    'soft',
    {
      fontFamily: 'Inter', fontWeight: 600, color: '#ffffff', outlineWidth: 0,
      shadow: { enabled: true, color: '#000000', blur: 16, dx: 0, dy: 2 },
      popup: { enabled: true, duration: 0.3, intensity: 0, style: 'soft' }
    }
  ]
]

export interface GridLook {
  /** Unique in the grid. */
  id: string
  /** Where the name comes from: a string key, or the user's own name. */
  key?: string
  name?: string
  look: CaptionLook
  /** The user's saved preset. */
  saved?: boolean
}

/**
 * The grid: the default, the built-in looks, the subtitles' own looks, the
 * user's saved presets. A second look with a name the grid already has is
 * left out (two workers' lists merged, or a preset saved under a built-in's
 * name).
 */
export function gridLooks(builtIn: readonly [key: string, look: Partial<CaptionStyle>, hint?: string][], saved: Record<string, Partial<CaptionStyle>>): GridLook[] {
  const out: GridLook[] = [{ id: 'plain', key: 'caps.look.plain', look: {} }]
  for (const [key, look] of builtIn) out.push({ id: key.split('.').pop()!, key, look: look as CaptionLook })
  for (const [id, look] of CAPTION_ONLY_LOOKS) out.push({ id, key: `caps.look.${id}`, look })
  for (const [name, look] of Object.entries(saved)) out.push({ id: `saved:${name}`, name, look: look as CaptionLook, saved: true })
  const seen = new Set<string>()
  return out.filter((g) => {
    const k = g.key ?? `saved:${g.name}`
    const id = g.id.toLowerCase()
    if (seen.has(id) || seen.has(k)) return false
    seen.add(id)
    seen.add(k)
    return true
  })
}
