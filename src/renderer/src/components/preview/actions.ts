// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the preview's new keys do (ONIZLEME-UYGULA-PLAN.md, K3 and K4): the
// zoom at one pixel per pixel (1) and the fit (0), and the play speed one
// step ([ and ]). The page side of components/preview/zoom.ts.
import { useStore } from '../../state/store'
import { notify } from '../../ui/toast-core'
import { t } from '../../ui/strings'
import { fmtTimes } from '../../ui/format'
import { stepRate, usePlayRate } from '../../playback/play-rate'
import { oneToOneZoom, zoomAround } from './zoom'

/** The preview canvas's CSS size (0 × 0 when it is not on screen). */
function previewSize(): { cw: number; ch: number } {
  const cv = document.querySelector<HTMLCanvasElement>('[data-testid="preview.canvas"]')
  return { cw: cv?.clientWidth ?? 0, ch: cv?.clientHeight ?? 0 }
}

/** 1: one pixel of the project on one pixel of the screen, round the middle. */
export function previewActualSize(): void {
  const s = useStore.getState()
  const { cw, ch } = previewSize()
  if (cw <= 0 || ch <= 0) return
  const { width, height } = s.project.settings
  const zoom = oneToOneZoom(cw, ch, width, height, window.devicePixelRatio || 1)
  s.setPreviewView(zoomAround(s.previewView, zoom, cw / 2, ch / 2, cw, ch))
}

/** 0: the whole frame. */
export function previewFit(): void {
  useStore.getState().setPreviewView({ zoom: 1, x: 0, y: 0 })
}

/** [ and ]: the play speed a step slower or faster, said in a toast. */
export function stepPlayRate(dir: -1 | 1): void {
  const pr = usePlayRate.getState()
  const next = stepRate(pr.rate, dir)
  pr.setRate(next)
  notify({ text: t('transport.rate.now', { rate: fmtTimes(next) }) })
}
