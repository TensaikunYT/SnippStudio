// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's styles (REF-AB, item 10; YAZI-PANELI-PLAN.md §9): a grid in
// which each style writes its own name in its own look. The three looks that
// come with the program (the Inspector's presets) are among them; the others
// are made the same way, of the text engine's own settings and the fonts the
// program bundles. The names are ours.
import type { CaptionStyle } from '../../types'
import type { StringKey } from '../../ui'
import { BUILT_IN_LOOKS } from '../inspector/subs-tab'

/** What a style starts from, whatever the project's subtitles look like: no
 *  karaoke, gradient, wobble or key words of theirs carried over. */
export const CLEAN: Partial<CaptionStyle> = {
  outlineWidth: 0,
  bgOpacity: 0,
  bgBorder: undefined,
  bgRadius: 0,
  uppercase: false,
  letterSpacing: 0,
  lineHeight: undefined,
  align: 'center',
  rotate: 0,
  maxLineChars: 32,
  fitWidth: undefined,
  gradient: undefined,
  boil: undefined,
  blend: undefined,
  emoji: undefined,
  marker: undefined,
  keyMark: undefined,
  highlight: { enabled: false, color: '#ffd23f', scale: 1 },
  shadow: { enabled: false, color: '#000000', blur: 0, dx: 0, dy: 0 }
}

export const SOFT_SHADOW = { enabled: true, color: '#000000', blur: 18, dx: 0, dy: 3 }

export interface TextLook {
  id: string
  name: StringKey
  /** null: the project's own text style, as it is. */
  look: Partial<CaptionStyle> | null
  hint: StringKey
}

const builtIn = (key: StringKey): Partial<CaptionStyle> => BUILT_IN_LOOKS.find(([k]) => k === key)![1]

export const TEXT_LOOKS: TextLook[] = [
  { id: 'plain', name: 'dock.text.plain', look: null, hint: 'dock.text.add.hint' },
  { id: 'sticker', name: 'insp.presets.sticker', look: builtIn('insp.presets.sticker'), hint: 'insp.presets.sticker.hint' },
  { id: 'label', name: 'insp.presets.label', look: builtIn('insp.presets.label'), hint: 'insp.presets.label.hint' },
  { id: 'serif', name: 'insp.presets.serif', look: builtIn('insp.presets.serif'), hint: 'insp.presets.serif.hint' },
  { id: 'headline', name: 'text.look.headline', hint: 'text.look.headline.hint', look: { fontFamily: 'Anton', fontWeight: 400, color: '#ffffff', uppercase: true, letterSpacing: 1, shadow: SOFT_SHADOW } },
  { id: 'neon', name: 'text.look.neon', hint: 'text.look.neon.hint', look: { fontFamily: 'Inter', fontWeight: 600, color: '#c8fbff', shadow: { enabled: true, color: '#00c8ff', blur: 26, dx: 0, dy: 0 } } },
  { id: 'comic', name: 'text.look.comic', hint: 'text.look.comic.hint', look: { fontFamily: 'Bangers', fontWeight: 400, color: '#ffe14d', outlineColor: '#16161a', outlineWidth: 8, letterSpacing: 1, shadow: { enabled: true, color: '#e5322d', blur: 0, dx: 5, dy: 6 } } },
  { id: 'sunset', name: 'text.look.sunset', hint: 'text.look.sunset.hint', look: { fontFamily: 'Archivo Black', fontWeight: 400, color: '#ffb347', gradient: { enabled: true, from: '#ffc94d', to: '#ff4e8a', angle: 90 }, shadow: SOFT_SHADOW } },
  { id: 'cinema', name: 'text.look.cinema', hint: 'text.look.cinema.hint', look: { fontFamily: 'Bebas Neue', fontWeight: 400, color: '#f4f1ea', uppercase: true, letterSpacing: 8, shadow: SOFT_SHADOW } },
  { id: 'band', name: 'text.look.band', hint: 'text.look.band.hint', look: { fontFamily: 'Oswald', fontWeight: 600, color: '#ffffff', bgColor: '#0b0b0d', bgOpacity: 0.78, bgRadius: 4, bgPadX: 0.4, bgPadY: 0.16 } },
  { id: 'marker', name: 'text.look.marker', hint: 'text.look.marker.hint', look: { fontFamily: 'Permanent Marker', fontWeight: 400, color: '#ffd23f', outlineColor: '#16161a', outlineWidth: 6 } },
  { id: 'hand', name: 'text.look.hand', hint: 'text.look.hand.hint', look: { fontFamily: 'Rock Salt', fontWeight: 400, color: '#ffffff', shadow: SOFT_SHADOW } },
  { id: 'candy', name: 'text.look.candy', hint: 'text.look.candy.hint', look: { fontFamily: 'Luckiest Guy', fontWeight: 400, color: '#ffffff', outlineColor: '#ff5fa2', outlineWidth: 9, shadow: { enabled: true, color: '#7a1f4a', blur: 0, dx: 4, dy: 6 } } },
  { id: 'ink', name: 'text.look.ink', hint: 'text.look.ink.hint', look: { fontFamily: 'Snipp Display', fontWeight: 400, color: '#ffffff', outlineColor: '#0b0b0d', outlineWidth: 6, boil: { enabled: true, amount: 1, fps: 10 } } }
]

/** A look as a title gets it: from clean, then the look (null: the project's own). */
export const cleanLook = (look: Partial<CaptionStyle> | null): Partial<CaptionStyle> | null => (look ? { ...CLEAN, ...look } : null)
