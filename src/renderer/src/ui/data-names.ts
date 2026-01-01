// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The names the interface shows for the data modules' entries (SnippStudio
// phase 9b, decision 3): backgrounds, their tints, picture moves and their
// feel, voice presets, the G lane's templates, a recent project's "when".
// The modules keep their English (the agent reads them: playback/backdrop.ts,
// motion/picture-moves.ts, audio/clean.ts, templates/info.ts); the interface
// reads the words here by id, in the language it shows.
// src/test/faz9b-data-names.test.ts: every id of every module has its words.
import { getLang, STRINGS, t, type StringKey } from './strings'

const k = (key: string): StringKey => key as StringKey

export const backdropName = (id: string): string => t(k(`data.backdrop.${id}`))
export const backdropHint = (id: string): string => t(k(`data.backdropHint.${id}`))
/** A tint by its English name ("Navy"). */
export const tintName = (name: string): string => t(k(`data.tint.${name.toLowerCase()}`))
export const moveName = (kind: string): string => t(k(`data.move.${kind}`))
export const moveHint = (kind: string): string => t(k(`data.moveHint.${kind}`))
export const feelName = (id: string): string => t(k(`data.feel.${id}`))
export const voiceName = (id: string): string => t(k(`data.voice.${id}`))
export const voiceHint = (id: string): string => t(k(`data.voiceHint.${id}`))
export const templateName = (kind: string): string => t(k(`data.tpl.${kind}`))
export const templateHint = (kind: string): string => t(k(`data.tplHint.${kind}`))
/** The clip looks, the light on a still, the ambient frame (types.ts
 *  VIDEO_FX, STILL_IMAGE_FX, AMBIENT_FX) and the blend modes (BLEND_MODES:
 *  CSS names, shown as words): phase 9 audit patch D4. Keys are camelCase
 *  ("window-light" → data.stillFx.windowLight). */
const camel = (id: string): string => id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
export const videoFxName = (id: string): string => t(k(`data.vfx.${camel(id)}`))
export const stillFxName = (id: string): string => t(k(`data.stillFx.${camel(id)}`))
export const ambientFxName = (id: string): string => t(k(`data.ambientFx.${camel(id)}`))
export const blendName = (mode: string): string => t(k(`data.blend.${camel(mode)}`))
/** A camera look preset (effects/look.ts LOOK_PRESETS) by id, its hint, and
 *  a look's name as lookName() gives it in English ("Custom" included). */
export const lookPresetName = (id: string): string => t(k(`data.look.${id}`))
export const lookPresetHint = (id: string): string => t(k(`data.lookHint.${id}`))
export const lookShown = (english: string | null, presets: readonly { id: string; label: string }[]): string =>
  english === null ? '' : english === 'Custom' ? t('data.look.custom') : lookPresetName(presets.find((p) => p.label === english)?.id ?? 'custom')
/** A template palette by its English name (templates/info.ts); a name no
 *  palette of the app has stays as it is. */
export function paletteName(name: string): string {
  const key = `data.pal.${camel(name.replace(/ · /g, '-').replace(/ /g, '-').toLowerCase())}`
  return Object.prototype.hasOwnProperty.call(STRINGS, key) ? t(k(key)) : name
}

/** How long ago, in words ("5m ago" / "5 dk önce"); a date after a week. */
export function whenAgo(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60000)
  if (min < 1) return t('data.when.now')
  if (min < 60) return t('data.when.min', { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return t('data.when.hour', { n: hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return t('data.when.day', { n: day })
  return new Date(ms).toLocaleDateString(getLang() === 'tr' ? 'tr-TR' : 'en-GB')
}

/** The build date as "10 Oct 2026, 04:30" / "10 Eki 2026, 04:30". */
export function buildDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const month = d.toLocaleString(getLang() === 'tr' ? 'tr-TR' : 'en-GB', { month: 'short' })
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getDate()} ${month} ${d.getFullYear()}, ${hm}`
}
