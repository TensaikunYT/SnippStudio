// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { api } from '../platform'
import { cancelExportJob } from './job'
import { finished, newRenderStatus, withProgress, type RenderStatus } from './renders'

/** How often the status file is written while the bar moves. */
const WRITE_EVERY_MS = 2_000
/** Written at least this often while it runs (the panel tells a live job from a dead one). */
const HEARTBEAT_MS = 10_000

export interface RenderTracker {
  progress(fraction: number, label: string): void
  /** What the export found out once it started: its frames, its lanes. */
  plan(p: { frames?: number; fps?: number; workers?: number }): void
  end(state: Exclude<RenderStatus['state'], 'running'>, extra?: { error?: string; output?: string }): Promise<void>
}

const NONE: RenderTracker = { progress: () => {}, plan: () => {}, end: async () => {} }

/**
 * This window's export in the Renders panel: its status file kept up to date
 * (main writes it into cikti\.renders), and a Cancel asked from any panel
 * (this app's or another Snipp's) passed on to the job.
 */
export function trackRender(info: { name: string; output?: string; frames?: number; fps?: number; workers?: number }, signal: AbortSignal): RenderTracker {
  const bridge = api?.renders
  if (!bridge) return NONE
  let status = newRenderStatus({ ...info, source: 'snipp', now: Date.now() })
  let lastWrite = 0
  let lastAsk = 0
  let chain: Promise<unknown> = Promise.resolve()
  let over = false
  const write = (): void => {
    lastWrite = Date.now()
    const json = JSON.stringify(status)
    chain = chain.then(() => bridge.write(json)).catch(() => {})
  }
  const askedToStop = (): void => {
    if (signal.aborted || Date.now() - lastAsk < WRITE_EVERY_MS) return
    lastAsk = Date.now()
    void bridge
      .cancelAsked(status.id)
      .then((yes) => {
        if (yes && !over && !signal.aborted) cancelExportJob()
      })
      .catch(() => {})
  }
  // The heartbeat (and the Cancel check while the bar stands still).
  const timer = window.setInterval(() => {
    if (over) return
    askedToStop()
    if (Date.now() - lastWrite >= HEARTBEAT_MS) {
      status = withProgress(status, Date.now(), status.progress)
      write()
    }
  }, WRITE_EVERY_MS)
  write()
  return {
    progress(fraction, label) {
      if (over) return
      status = withProgress(status, Date.now(), fraction, label)
      askedToStop()
      if (Date.now() - lastWrite >= WRITE_EVERY_MS) write()
    },
    plan(p) {
      if (over) return
      status = {
        ...status,
        ...(p.frames !== undefined ? { frames: Math.max(0, Math.round(p.frames)) } : {}),
        ...(p.fps !== undefined ? { fps: p.fps } : {}),
        ...(p.workers !== undefined ? { workers: Math.max(1, Math.round(p.workers)) } : {})
      }
      write()
    },
    async end(state, extra) {
      if (over) return
      over = true
      window.clearInterval(timer)
      status = finished(status, Date.now(), state, extra)
      write()
      await chain
    }
  }
}
