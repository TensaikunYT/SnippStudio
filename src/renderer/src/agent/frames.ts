// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The frames tool (SnippStudio phase 4A, ANA-PLAN.md §2 rule 7): 1–12 moments
// as ONE picture, a grid with each frame's time on it; one moment is one
// frame. The frames are the ones an export draws (notes/image.ts). The page
// side: canvases.
import type { Project } from '../types'
import { framePicture, frameTime, base64 } from '../notes/image'
import { sec } from './format'

export interface Sheet {
  data: string
  width: number
  height: number
  times: number[]
  /** Clips a frame had to leave out, one sentence each (5a/5b patch, C-6). */
  leftOut?: string[]
}

/** Columns of the grid for n frames, and the default width of one frame. */
export function gridOf(n: number): { cols: number; cell: number } {
  if (n <= 1) return { cols: 1, cell: 512 }
  if (n <= 2) return { cols: 2, cell: 384 }
  if (n <= 4) return { cols: 2, cell: 320 }
  if (n <= 9) return { cols: 3, cell: 256 }
  return { cols: 4, cell: 224 }
}

/** The width asked for one frame of an n-frame sheet (phase 7 audit, S1): an
 *  explicit width wins; otherwise the setting (384 / 512 / 768, anything else
 *  is 512) is one frame's width, and a grid shrinks it in proportion, so the
 *  default setting keeps every grid's size of before the setting. */
export function sheetWidth(n: number, explicit: number | undefined, setting: unknown): number {
  if (explicit !== undefined) return explicit
  const s = Number(setting)
  const base = setting !== null && setting !== '' && (s === 384 || s === 512 || s === 768) ? s : 512
  return n <= 1 ? base : Math.round((gridOf(n).cell * base) / 512)
}

/** The width of one frame so the whole sheet stays within `maxPixels`
 *  (phase 4A.8, T12): n frames in `cols` columns of the project's shape. */
export function cellWidth(n: number, wanted: number | undefined, aspect: number, maxPixels = Infinity): number {
  const { cols, cell: dflt } = gridOf(n)
  const rows = Math.ceil(n / cols)
  const w = Math.max(96, Math.min(1280, Math.round(wanted ?? dflt)))
  // Sheet ≈ (cols·w) × (rows·w/aspect) pixels.
  const fit = Math.floor(Math.sqrt((maxPixels * aspect) / (cols * rows)))
  return Math.max(96, Math.min(w, fit))
}

/** The frames sheet's whole picture stays near this many pixels (T12). */
export const FRAMES_MAX_PIXELS = 1_200_000

/** Sheets drawn at the same time (phase 4A.10, D5, safety#9): each frame is
 *  a full export frame; more calls wait their turn instead of all drawing
 *  at once. */
export const SHEETS_AT_ONCE = 2
let drawing = 0
const turns: (() => void)[] = []
async function turn<T>(work: () => Promise<T>): Promise<T> {
  if (drawing >= SHEETS_AT_ONCE) await new Promise<void>((r) => turns.push(r))
  drawing++
  try {
    return await work()
  } finally {
    drawing--
    turns.shift()?.()
  }
}

export function contactSheet(
  project: Project,
  times: readonly number[],
  opts: { width?: number; setting?: unknown; captions?: boolean; maxPixels?: number; picture?: typeof framePicture } = {}
): Promise<Sheet | null> {
  return turn(() => drawSheet(project, times, opts))
}

async function drawSheet(
  project: Project,
  times: readonly number[],
  opts: { width?: number; setting?: unknown; captions?: boolean; maxPixels?: number; picture?: typeof framePicture }
): Promise<Sheet | null> {
  const picture = opts.picture ?? framePicture
  const at = times.map((t) => frameTime(project, t)).filter((t): t is number => t !== null)
  if (!at.length) return null
  const { cols } = gridOf(at.length)
  const aspect = project.settings.width / Math.max(1, project.settings.height)
  const wanted = opts.width === undefined && opts.setting === undefined ? undefined : sheetWidth(at.length, opts.width, opts.setting)
  const cell = cellWidth(at.length, wanted, aspect, opts.maxPixels ?? FRAMES_MAX_PIXELS)
  const pics = []
  for (const t of at) {
    const p = await picture(project, t, { maxWidth: cell, captions: opts.captions !== false })
    if (!p) return null
    pics.push(p)
  }
  const leftOut = [...new Set(pics.flatMap((p) => p.leftOut ?? []))]
  const said = leftOut.length ? { leftOut } : {}
  if (pics.length === 1) return { data: pics[0].data, width: pics[0].width, height: pics[0].height, times: at, ...said }
  const w = pics[0].width
  const h = pics[0].height
  const rows = Math.ceil(pics.length / cols)
  const gap = 2
  const canvas = new OffscreenCanvas(cols * w + (cols - 1) * gap, rows * h + (rows - 1) * gap)
  const g = canvas.getContext('2d', { alpha: false })
  if (!g) return null
  g.fillStyle = '#000'
  g.fillRect(0, 0, canvas.width, canvas.height)
  const font = Math.max(11, Math.round(h / 12))
  for (let i = 0; i < pics.length; i++) {
    const x = (i % cols) * (w + gap)
    const y = Math.floor(i / cols) * (h + gap)
    const bytes = Uint8Array.from(atob(pics[i].data), (c) => c.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
    g.drawImage(bmp, x, y, w, h)
    bmp.close()
    // The time, top-left, on a dark band (the agent reads which is which).
    const label = `${i + 1} · ${sec(at[i])}s`
    g.font = `600 ${font}px sans-serif`
    const tw = g.measureText(label).width
    g.fillStyle = 'rgba(0,0,0,0.65)'
    g.fillRect(x, y, tw + font, font * 1.5)
    g.fillStyle = '#fff'
    g.textBaseline = 'middle'
    g.fillText(label, x + font / 2, y + font * 0.75)
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return { data: base64(new Uint8Array(await blob.arrayBuffer())), width: canvas.width, height: canvas.height, times: at, ...said }
}
