// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The video player template's plan: what happens when (pause, play, skip,
// speed, captions, quality), where its buttons and menus sit, and every tap
// on them. No DOM.

import type { TemplateBlock } from '../types'

export type PlayerAct = 'pause' | 'play' | 'skip' | 'back' | 'speed' | 'cc' | 'quality'
export const PLAYER_ACTS: PlayerAct[] = ['pause', 'play', 'skip', 'back', 'speed', 'cc', 'quality']
export const SPEEDS = ['0.25', '0.5', '0.75', 'Normal', '1.25', '1.5', '1.75', '2']
export const QUALITIES = ['1080p', '720p', '480p', '360p', '240p', '144p']

export interface PlayerEvent {
  act: PlayerAct
  /** Block seconds: when it takes effect. */
  t: number
  /** Speed ("2"), quality ("144p") or seconds skipped ("10"). */
  arg: string
  /** Which item it came from. */
  i: number
}

const actOf = (s: string): PlayerAct | null => {
  const k = s.trim().toLowerCase()
  return (PLAYER_ACTS as string[]).includes(k) ? (k as PlayerAct) : null
}

/** The block's events in time order (an item's value is its time; unset,
 *  they share the block evenly). */
export function playerEvents(b: Pick<TemplateBlock, 'items' | 'duration'>): PlayerEvent[] {
  const n = b.items.length
  return b.items
    .map((it, i) => {
      const act = actOf(it.title)
      if (!act) return null
      const even = 1.2 + ((b.duration - 2) * i) / Math.max(1, n)
      const t = typeof it.value === 'number' && Number.isFinite(it.value) ? Math.max(0.3, Math.min(b.duration - 0.2, it.value)) : even
      const arg = (it.note ?? '').trim() || (act === 'speed' ? '2' : act === 'quality' ? '144p' : act === 'skip' || act === 'back' ? '10' : '')
      return { act, t, arg, i }
    })
    .filter((e): e is PlayerEvent => !!e)
    .sort((a, b) => a.t - b.t)
}

type Rect = { x: number; y: number; w: number; h: number }

export interface PlayerLayout {
  /** The progress bar: its ends and height line. */
  bar: { x0: number; x1: number; y: number }
  /** The control row's middle line and its icons' middles. */
  row: number
  icon: number
  play: [number, number]
  volume: [number, number]
  /** The autoplay switch, the captions, the gear, the theatre and the full
   *  screen buttons, left to right on the right of the row. */
  autoplay: [number, number]
  cc: [number, number]
  gear: [number, number]
  theatre: [number, number]
  full: [number, number]
  /** The little "i" at the top right. */
  info: [number, number]
  /** The settings panel (bottom right, above the controls). */
  menu: Rect
  rowH: number
}

export function playerLayout(left: number, W: number, H: number): PlayerLayout {
  const u = H / 1080
  const portrait = W / H < 1
  const pad = W * (portrait ? 0.04 : 0.018)
  const row = H - (portrait ? 150 : 44) * u
  const icon = (portrait ? 34 : 30) * u
  const step = icon * 1.9
  const x0 = left + pad
  const x1 = left + W - pad
  const rowH = (portrait ? 64 : 50) * u
  const mw = portrait ? W * 0.72 : Math.max(300 * u, W * 0.19)
  const mh = rowH * 3 + 16 * u
  return {
    bar: { x0, x1, y: row - 38 * u },
    row,
    icon,
    play: [x0 + icon * 0.6, row],
    volume: [x0 + icon * 0.6 + step * 1.15, row],
    full: [x1 - icon * 0.6, row],
    theatre: [x1 - icon * 0.6 - step, row],
    gear: [x1 - icon * 0.6 - step * 2, row],
    cc: [x1 - icon * 0.6 - step * 3, row],
    autoplay: [x1 - icon * 0.6 - step * 4.1, row],
    info: [x1 - icon * 0.4, (portrait ? 90 : 30) * u],
    menu: { x: x1 - mw, y: row - 60 * u - mh, w: mw, h: mh },
    rowH
  }
}

/** The settings panel's rows at a moment: the main list, or one of its
 *  lists (speed, quality). */
export function menuRows(kind: 'main' | 'speed' | 'quality'): string[] {
  if (kind === 'speed') return SPEEDS
  if (kind === 'quality') return QUALITIES
  return ['Playback speed', 'Subtitles/CC', 'Quality']
}

/** A menu's rect grown to fit its rows (a list opens taller, upwards). */
export function menuRect(L: PlayerLayout, kind: 'main' | 'speed' | 'quality'): Rect {
  const n = menuRows(kind).length
  const h = L.rowH * n + (L.menu.h - L.rowH * 3)
  return { x: L.menu.x, y: L.menu.y + L.menu.h - h, w: L.menu.w, h }
}

/** A row's middle in a menu. */
export function menuRowAt(L: PlayerLayout, kind: 'main' | 'speed' | 'quality', row: number): [number, number] {
  const r = menuRect(L, kind)
  const top = r.y + (L.menu.h - L.rowH * 3) / 2
  return [r.x + r.w * 0.35, top + L.rowH * (row + 0.5)]
}

/** When a menu event's taps fall: the gear, the list's name, the choice. */
export const MENU_STEPS = [-1.0, -0.5, 0]


/** The player's state at block time t. */
export function playerState(b: Pick<TemplateBlock, 'items' | 'duration'>, t: number, from = 187): { paused: boolean; speed: string; cc: boolean; quality: string; pos: number } {
  let paused = false
  let speed = 'Normal'
  let cc = false
  let quality = '1080p'
  // The video's clock: from where it starts, stopping while paused, faster
  // at speed, jumping on a skip.
  let pos = from
  let last = 0
  const rate = (): number => (paused ? 0 : speed === 'Normal' ? 1 : Number(speed) || 1)
  for (const e of playerEvents(b)) {
    if (e.t > t) break
    pos += (e.t - last) * rate()
    last = e.t
    if (e.act === 'pause') paused = true
    else if (e.act === 'play') paused = false
    else if (e.act === 'skip') pos += Number(e.arg) || 10
    else if (e.act === 'back') pos = Math.max(0, pos - (Number(e.arg) || 10))
    else if (e.act === 'speed') speed = e.arg === '1' ? 'Normal' : e.arg
    else if (e.act === 'cc') cc = !cc
    else if (e.act === 'quality') quality = e.arg
  }
  pos += (t - last) * rate()
  return { paused, speed, cc, quality, pos }
}

/** How long a pause lasts: to the next play (or two seconds). */
export function pauseLength(b: Pick<TemplateBlock, 'items' | 'duration'>, i: number): number {
  const ev = playerEvents(b)
  const k = ev.findIndex((e) => e.i === i)
  if (k < 0) return 2
  const next = ev.slice(k + 1).find((e) => e.act === 'play')
  return Math.max(0.3, (next ? next.t : Math.min(b.duration, ev[k].t + 2)) - ev[k].t)
}
