// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The GIF export (KOLAY-PLAN.md, item 1): the frames drawn by the export's own
// drawer (the same picture as a video's), each read back and handed to the
// GIF writer (export/gif.ts); the file made whole in memory and written the
// way the sound alone is (beside its target, then put in place). No sound, no
// system encoder.
import type { Project } from '../types'
import { frameTime } from '../timeline/rates'
import { t } from '../ui/strings'
import { checkRenderCancelled } from './cancel'
import { frameDrawer, type ExportOptions } from './exporter'
import { checkRoomFor, saveWholeFile } from './file-target'
import { GifWriter, GIF_RATE_DEFAULT, GIF_WIDTH_DEFAULT, gifDelay, gifEstimate, gifSize } from './gif'

export async function exportGif(project: Project, opts: ExportOptions, at: { base: [number, number]; shorts: boolean; fps: number; rangeStart: number; duration: number }): Promise<Uint8Array> {
  const fps = at.fps > 0 && at.fps <= 30 ? at.fps : GIF_RATE_DEFAULT
  const { w, h } = gifSize(at.base[0], at.base[1], Math.min(opts.settings?.gifWidth ?? GIF_WIDTH_DEFAULT, at.base[0]))
  const total = Math.max(1, Math.round(at.duration * fps))
  if (opts.toPath) await checkRoomFor(opts.toPath, gifEstimate(w, h, fps, at.duration) * 2, 'file')
  checkRenderCancelled(opts.signal)
  const drawer = frameDrawer(project, { w, h, shorts: at.shorts }, opts.signal)
  // Read back from a canvas of its own (as the exactness probe does): the
  // drawer's canvas stays drawn on the graphics card.
  const copy = new OffscreenCanvas(w, h)
  const g = copy.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  const gif = new GifWriter(w, h)
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new Error('Export cancelled')
      await drawer.draw(at.rangeStart + frameTime(i, fps))
      g.drawImage(drawer.canvas, 0, 0)
      gif.add(g.getImageData(0, 0, w, h).data, gifDelay(i, fps))
      if (i % 5 === 0) opts.onProgress((0.95 * (i + 1)) / total, `Drawing frame ${i + 1} of ${total}`)
    }
  } finally {
    drawer.close()
  }
  const data = gif.finish()
  checkRenderCancelled(opts.signal)
  if (opts.toPath) {
    opts.onProgress(0.99, t('export.save.writing'))
    await saveWholeFile(opts.toPath, data, opts.signal)
  }
  return data
}
