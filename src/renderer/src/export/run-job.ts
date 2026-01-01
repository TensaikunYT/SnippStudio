// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useStore } from '../state/store'
import { beginExportJob, endExportJob, exportJobNotes, wasCancelled, type ExportKind } from './job'
import { trackRender, type RenderTracker } from './render-tracker'

/** The export card's updates at most this often (ms): 4 a second. */
export const PROGRESS_EVERY_MS = 250

/** What a finished job wrote (for the window's Open folder / Play). */
export interface ExportJobResult {
  path?: string
  folder?: string
  bytes?: number
}

/**
 * Runs one export in the export window: sets it up, passes the work its
 * Cancel signal and a progress callback, and ends it as done, failed or
 * cancelled. The save dialog is asked BEFORE this (cancelling it costs
 * nothing and shows no window).
 *
 * With `render` (a video, its sound, the Shorts): the job is in the Renders
 * panel too (its status file in cikti\.renders, a Cancel from there), and
 * `plan` tells it the frames and lanes once the export knows them.
 */
export async function runExportJob(
  kind: ExportKind,
  info: { detail?: string; target?: string; render?: { name: string; output?: string; frames?: number; fps?: number } },
  work: (signal: AbortSignal, progress: (fraction: number, label: string) => void, plan: RenderTracker['plan']) => Promise<ExportJobResult>
): Promise<boolean> {
  const signal = beginExportJob()
  const tracker = info.render ? trackRender(info.render, signal) : null
  const meta = { kind, startedAt: performance.now(), detail: info.detail, target: info.target }
  const set = (patch: Partial<NonNullable<ReturnType<typeof useStore.getState>['exportStatus']>>): void =>
    useStore.getState().setExportStatus({ ...meta, progress: 0, label: '', ...patch })
  let last = 0
  let lastLabel = 'Getting ready'
  set({ progress: 0, label: lastLabel })
  // Four times a second at most (phase Ç3b, decision 8; report R15): every
  // update re-renders the export card on the editor's own thread, which also
  // draws and encodes the frames. The last one waits, never lost.
  let shownAt = 0
  let pending: ReturnType<typeof setTimeout> | null = null
  const show = (): void => {
    pending = null
    if (signal.aborted) return
    shownAt = performance.now()
    set({ progress: last, label: lastLabel })
    tracker?.progress(last, lastLabel)
  }
  const progress = (fraction: number, label: string): void => {
    if (signal.aborted) return
    last = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : last))
    lastLabel = label
    const wait = PROGRESS_EVERY_MS - (performance.now() - shownAt)
    if (wait <= 0) show()
    else pending ??= setTimeout(show, wait)
  }
  // The lanes on the card too once the export knows them (a film drawn
  // several at once); one lane says nothing, as before. Shown now, not at
  // the next tick (the render processes not starting is told after the last).
  const detail = info.detail
  const plan: RenderTracker['plan'] = (p) => {
    tracker?.plan(p)
    if (detail !== undefined && p.workers !== undefined) {
      meta.detail = p.workers > 1 ? `${detail} · ${p.workers} lanes` : detail
      if (!signal.aborted) set({ progress: last, label: lastLabel })
    }
  }
  const settle = (): void => {
    if (pending) clearTimeout(pending)
    pending = null
  }
  try {
    const result = await work(signal, progress, plan)
    settle()
    // A work that came back has put its file in place: a Cancel pressed
    // after that moment does not make it "Cancelled" (phase Ç3 patch, R-1:
    // the new film had replaced the old one and the card said Cancelled).
    // Each work checks the signal up to the replace itself.
    // What the export wants said about its result (a loudness target it did
    // not reach, a frame it could not read): beside the result, not hidden
    // behind a plain "Done".
    const notes = exportJobNotes()
    if (notes.length) meta.detail = [meta.detail, ...notes.map((n) => `⚠ ${n}`)].filter(Boolean).join(' · ')
    set({ ...result, progress: 1, label: 'Done', done: true, endedAt: performance.now() })
    await tracker?.end('done', result.path ? { output: result.path } : {})
    return true
  } catch (err) {
    settle()
    const cancelled = wasCancelled(signal, err)
    const error = err instanceof Error ? err.message : String(err)
    // What a work stopped part-way wants said (a Shorts batch: which Short,
    // how many were saved and where; phase Ç3 patch, R-4).
    const said = (err as { said?: unknown } | null)?.said
    if (cancelled && typeof said === 'string') meta.detail = [meta.detail, said].filter(Boolean).join(' · ')
    if (cancelled) set({ progress: last, label: 'Cancelled', done: true, cancelled: true, endedAt: performance.now() })
    else set({ progress: 1, label: 'Failed', done: true, error, endedAt: performance.now() })
    await tracker?.end(cancelled ? 'cancelled' : 'failed', cancelled ? {} : { error })
    return false
  } finally {
    endExportJob(signal)
  }
}
