// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { create } from 'zustand'

/**
 * The timeline's horizontal viewport in scroll pixels. Kept OUT of the project
 * store so scrolling can't touch undo history, and quantised so a scroll only
 * re-renders the things that watch it (waveforms) every ~32 px instead of every
 * frame.
 *
 * Why it exists: a waveform used to draw bars across the clip's ENTIRE width.
 * On an 8-minute clip zoomed in, that width is hundreds of thousands of pixels,
 * so the bar count hit its cap and the bars spread out into a sparse comb with
 * empty-looking gaps. Drawing only the visible slice keeps the bar density
 * constant at any zoom, and is far cheaper too.
 */
export const useViewport = create<{
  left: number
  width: number
  set: (left: number, width: number) => void
}>((set) => ({
  left: 0,
  width: 4000,
  set: (left, width) =>
    set((s) => (Math.abs(s.left - left) < 32 && s.width === width ? s : { left, width }))
}))
