// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-goruntu.md G-3): a Short of a
// project narrower than 9:16 is cut where the preview shows it; the usual
// projects stay within half a pixel, as Ç3a measured.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { shortsCropX } from '../renderer/src/playback/pose'
import { shortsWindowAt } from '../renderer/src/playback/render'

/** The preview: the window [cx − w/2, cx + w/2] (project px) is the Short;
 *  the project's left edge sits at −(cx − w/2) · k output px. */
const previewLeft = (k: number, win: { cx: number; w: number }): number => -(win.cx - win.w / 2) * k

function exportLeft(w: number, h: number, ow: number, oh: number, win: { cx: number; w: number }): number {
  const k = oh / h
  const fullW = Math.max(ow, Math.round(w * k))
  return -shortsCropX(w, k, ow, fullW, win)
}

test('G-3: a project narrower than 9:16 (1080 × 2340): the export places the picture where the preview does', () => {
  const project = { settings: { width: 1080, height: 2340, fps: 30 }, shorts: { baseX: 540, keyframes: [] } } as never
  const win = shortsWindowAt(project, 0)
  for (const [ow, oh] of [[1080, 1920], [2160, 3840]]) {
    const e = exportLeft(1080, 2340, ow, oh, win)
    const p = previewLeft(oh / 2340, win)
    assert.ok(Math.abs(e - p) <= 0.5 + 1e-9, `${ow}×${oh}: export ${e}, preview ${p.toFixed(1)}`)
  }
})

test('G-3: the usual projects stay within half a pixel of the preview', () => {
  for (const [w, h] of [[1920, 1080], [3840, 2160], [1280, 720], [1080, 1080], [1080, 1350], [2560, 1080]]) {
    for (const cxFrac of [0, 0.25, 0.5, 0.77, 1]) {
      const project = { settings: { width: w, height: h, fps: 30 }, shorts: { baseX: cxFrac * w, keyframes: [] } } as never
      const win = shortsWindowAt(project, 0)
      for (const [ow, oh] of [[1080, 1920], [2160, 3840], [540, 960], [1440, 2560]]) {
        const e = exportLeft(w, h, ow, oh, win)
        const p = previewLeft(oh / h, win)
        assert.ok(Math.abs(e - p) <= 0.5 + 1e-9, `${w}x${h} cx ${cxFrac} out ${ow}x${oh}: export ${e}, preview ${p}`)
      }
    }
  }
})
