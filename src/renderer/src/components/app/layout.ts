// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The editor window's small state outside the store: a toast, the panels'
// sizes (remembered), what an export is called and whether one runs. Moved out
// of App.tsx in SnippStudio phase 2B (no change).
import { type ExportSettings } from '../../export/exporter'
import { formatOf } from '../../export/formats'
import { qualityName } from '../../export/quality'
import { fpsLabel } from '../../timeline/rates'
import { useStore } from '../../state/store'

export interface Toast {
  text: string
  error?: boolean
  action?: { label: string; run: () => void }
}

export { LAYOUT_KEY, readLayout, ratioFromPx, timelinePx, type PanelLayout } from './timeline-size'
import { LAYOUT_KEY, readLayout, type PanelLayout } from './timeline-size'

/** One line describing what an export is actually writing — shown while it runs
 *  and kept on the finished card, so "which settings was that again?" has an
 *  answer without re-opening the dialog. */
export function describeExport(
  project: ReturnType<typeof useStore.getState>['project'],
  settings: ExportSettings
): string {
  const shorts = settings.target === 'shorts'
  const baseW = shorts ? 1080 : project.settings.width
  const baseH = shorts ? 1920 : project.settings.height
  const w = Math.round((baseW * settings.resolutionScale) / 2) * 2
  const h = Math.round((baseH * settings.resolutionScale) / 2) * 2
  const fmt = formatOf(settings.container)
  const container = fmt.short
  const quality = settings.videoBitrate ? `${(settings.videoBitrate / 1e6).toFixed(0)} Mbps` : qualityName(settings.bitrateFactor)
  const parts = fmt.audioOnly
    ? [container, ...(fmt.audioBitrate ? [`${Math.round(fmt.audioBitrate / 1000)} kbps`] : ['48 kHz'])]
    : fmt.id === 'gif'
      ? [`${w} × ${h}`, `${fpsLabel(settings.fps ?? project.settings.fps)} fps`, container]
      : [`${w} × ${h}`, `${fpsLabel(settings.fps ?? project.settings.fps)} fps`, container, quality]
  if (settings.normalize) parts.push('−14 LUFS')
  if (settings.range) parts.push(`${settings.range[0].toFixed(1)}–${settings.range[1].toFixed(1)}s`)
  return parts.join(' · ')
}

/** True while a render is actually running (a finished job stays in the store
 *  so its panel can be read, but must not block the next export). */
export function exportBusy(): boolean {
  const st = useStore.getState().exportStatus
  return !!st && !st.done
}

export function loadLayout(): PanelLayout {
  const winH = typeof window !== 'undefined' ? window.innerHeight : 0
  try {
    return readLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? ''), winH)
  } catch {
    return readLayout(null, winH)
  }
}

export function saveLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    /* not remembered: fine */
  }
}
