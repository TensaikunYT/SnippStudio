// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A work note's pictures (the page side: canvases, not pure). The frame is
// the one an export would draw (exportFramePng), never a copy of the preview
// canvas: VideoHub learned that a copied <video> frame can come back black,
// and the preview may be zoomed, scaled down or mid-seek.

import type { NoteShape, Project } from '../types'
import { projectDuration } from '../types'
import { closeUp, paintShapes, type PaintContext } from './shapes'

/** A saved note picture is at most this wide (the file carries it). */
export const NOTE_IMAGE_WIDTH = 960

export function base64(bytes: Uint8Array): string {
  let s = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(s)
}

export interface Picture {
  /** Base64 JPEG. */
  data: string
  width: number
  height: number
  /** Clips the frame had to leave out, one sentence each (5a/5b patch, C-6). */
  leftOut?: string[]
}

async function jpegOf(canvas: OffscreenCanvas, quality = 0.82): Promise<string> {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return base64(new Uint8Array(await blob.arrayBuffer()))
}

/** The timeline second a frame can really be drawn at (inside the film). */
export function frameTime(project: Project, t: number): number | null {
  const dur = projectDuration(project)
  if (dur <= 0) return null
  return Math.max(0, Math.min(dur - 1 / (project.settings.fps || 30), t))
}

/**
 * The frame at `time` as an export would draw it, scaled to `maxWidth`, with
 * `shapes` drawn on it. Null on an empty timeline.
 */
export async function framePicture(project: Project, time: number, opts: { maxWidth?: number; shapes?: readonly NoteShape[]; captions?: boolean } = {}): Promise<Picture | null> {
  const at = frameTime(project, time)
  if (at === null) return null
  const { exportFramePng } = await import('../export/exporter')
  const leftOut: string[] = []
  const png = await exportFramePng(project, at, opts.captions !== false, 'draft', leftOut)
  const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
  try {
    const width = Math.max(1, Math.min(opts.maxWidth ?? NOTE_IMAGE_WIDTH, bmp.width))
    const height = Math.max(1, Math.round((bmp.height * width) / bmp.width))
    const canvas = new OffscreenCanvas(width, height)
    const g = canvas.getContext('2d', { alpha: false })
    if (!g) return null
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, width, height)
    if (opts.shapes?.length) paintShapes(g as unknown as PaintContext, opts.shapes, width, height)
    return { data: await jpegOf(canvas), width, height, ...(leftOut.length ? { leftOut } : {}) }
  } finally {
    bmp.close()
  }
}

/** A note's frame with its drawing, as the data URL the note keeps. */
export async function captureNoteImage(project: Project, at: number, shapes: readonly NoteShape[]): Promise<string | null> {
  const pic = await framePicture(project, at, { shapes })
  // A clip left out of the note's picture is said (5a/5b patch, C-6).
  if (pic?.leftOut?.length) void import('../ui').then((m) => m.notify({ text: pic.leftOut!.join(' ') })).catch(() => {})
  return pic ? `data:image/jpeg;base64,${pic.data}` : null
}

/** A data URL's picture, and the close-up of what was drawn on it. */
export async function savedPictures(dataUrl: string, shapes: readonly NoteShape[], maxWidth: number): Promise<{ whole: Picture; close: Picture | null } | null> {
  const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(dataUrl)
  if (!m) return null
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0))
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: m[1] }))
  try {
    const width = Math.max(1, Math.min(maxWidth, bmp.width))
    const height = Math.max(1, Math.round((bmp.height * width) / bmp.width))
    const canvas = new OffscreenCanvas(width, height)
    const g = canvas.getContext('2d', { alpha: false })
    if (!g) return null
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, width, height)
    const whole: Picture = { data: await jpegOf(canvas), width, height }
    if (shapes.length === 0) return { whole, close: null }
    const [x0, y0, x1, y1] = closeUp(shapes)
    // The whole frame is its own close-up when the drawing covers most of it.
    if (x1 - x0 > 0.7 && y1 - y0 > 0.7) return { whole, close: null }
    const sx = Math.round(x0 * bmp.width)
    const sy = Math.round(y0 * bmp.height)
    const sw = Math.max(1, Math.round((x1 - x0) * bmp.width))
    const sh = Math.max(1, Math.round((y1 - y0) * bmp.height))
    const cw = Math.min(640, sw)
    const chh = Math.max(1, Math.round((sh * cw) / sw))
    const crop = new OffscreenCanvas(cw, chh)
    const cg = crop.getContext('2d', { alpha: false })
    if (!cg) return { whole, close: null }
    cg.imageSmoothingQuality = 'high'
    cg.drawImage(bmp, sx, sy, sw, sh, 0, 0, cw, chh)
    return { whole, close: { data: await jpegOf(crop), width: cw, height: chh } }
  } finally {
    bmp.close()
  }
}
