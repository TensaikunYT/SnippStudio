// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command box's words (SnippStudio phase 4B.2), pure: the one line that
// says what the user points at (ids only, never content: ANA-PLAN.md §1
// "Seçim tek satırdır"; the agent reads it in its `project` call), and the
// app's own ready commands, and the typed requests that ARE one (done here,
// never sent: GONDER-PLAN.md 12; every other request goes to the agent's
// inbox, agent/inbox.ts).

export interface Selection {
  clips: readonly string[]
  /** Media files picked in the media panel (ids). */
  media: readonly string[]
  /** A stretch of the timeline (seconds). */
  range?: readonly [number, number] | null
  /** A region drawn on the preview frame, in % of the frame: x, y, w, h. */
  region?: readonly [number, number, number, number] | null
}

const one = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)
const pct = (n: number): string => String(Math.round(n))

/** "clips c12,c13; range 40.0-70.2s; media m3; region 10,20,40,30%" ('' when nothing). */
export function selectionText(sel: Selection, max = 20): string {
  const list = (ids: readonly string[]): string => ids.slice(0, max).join(',') + (ids.length > max ? ` +${ids.length - max}` : '')
  const parts: string[] = []
  if (sel.clips.length) parts.push(`clips ${list(sel.clips)}`)
  if (sel.range && sel.range[1] > sel.range[0]) parts.push(`range ${one(sel.range[0])}-${one(sel.range[1])}s`)
  if (sel.media.length) parts.push(`media ${list(sel.media)}`)
  if (sel.region) parts.push(`region ${sel.region.map(pct).join(',')}%`)
  return parts.join('; ')
}

// ---- ready commands ----------------------------------------------------------

export type ReadyId = 'silences' | 'repeats' | 'fillers' | 'subtitles' | 'loudness' | 'images'
export const READY: readonly ReadyId[] = ['silences', 'repeats', 'fillers', 'subtitles', 'loudness', 'images']

/** Lower case (Turkish İ/I too), no accents, no punctuation, one space. */
export function fold(s: string): string {
  return s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The phrasings that ARE a ready command (exactly, once folded; no fuzzy
 *  matching: a near miss goes to the agent). */
export const READY_PHRASES: Record<ReadyId, readonly string[]> = {
  silences: ['sessizlikleri kes', 'sessizlikleri sil', 'sessizlikleri cikar', 'cut silences', 'cut the silences', 'remove silences', 'remove the silences'],
  repeats: ['tekrarlari bul', 'tekrarlari kes', 'tekrar cekimleri bul', 'find retakes', 'find repeats', 'cut retakes', 'remove retakes'],
  fillers: ['dolgulari bul', 'dolgulari kes', 'find fillers', 'cut fillers', 'remove fillers', 'remove filler words'],
  subtitles: ['altyazi uret', 'altyazi olustur', 'altyazilari uret', 'make subtitles', 'generate subtitles', 'create subtitles', 'transcribe'],
  loudness: ['ses seviyesini esitle', 'sesi esitle', 'even out loudness', 'normalize loudness', 'normalize audio', 'level the audio'],
  images: ['gorselleri seslendirmeye diz', 'gorselleri diz', 'place pictures on the narration', 'place images on the narration', 'place the images']
}

/** The ready command a typed request is, or null (then it goes to the agent). */
export function matchReady(text: string): ReadyId | null {
  const f = fold(text)
  if (!f) return null
  for (const id of READY) if (READY_PHRASES[id].includes(f)) return id
  return null
}

/** "1:05" / "12:03" (an elapsed time on the chip). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return `${m < 10 ? '0' : ''}${m}:${String(s % 60).padStart(2, '0')}`
}
