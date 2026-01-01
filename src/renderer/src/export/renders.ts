// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Renders panel's status files: one JSON per export in
// <project>\cikti\.renders\<name>.json, written while it runs by whoever runs
// it (Snipp's export window, or a script driving a dev app), read by every
// Snipp that has the panel open. So a film exported from the command line
// shows in the app, with its time left and a Cancel.
//
// Pure and with no imports: the renderer, the tests and a script (which
// loads this file directly; Node strips the types) all use it.

/** The file's shape (v 1). Times are ms since the epoch. */
export interface RenderStatus {
  v: 1
  /** The file name without .json (from the film's name). */
  id: string
  /** The film's name, as shown. */
  name: string
  /** Who runs it: Snipp's export window or another program. */
  source: 'snipp' | 'script'
  /** Frames to draw (0: a sound-only export). */
  frames: number
  /** The film's frame rate. */
  fps: number
  /** Render lanes (the parallel export's windows; 1: one window). */
  workers: number
  startedAt: number
  /** The last write: a running job writes at least every few seconds, so
   *  an old one means its writer is gone. */
  updatedAt: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  /** 0..1, the export's own bar. */
  progress: number
  /** What it is doing now ("Drawing frame 812 of 25200"). */
  label: string
  /** [ms since the epoch, 0..1]: the bar over the last minutes, for the
   *  speed and the time left. */
  samples: [number, number][]
  /** The file written (or to be written). */
  output?: string
  error?: string
  endedAt?: number
  /** The writer's process (main adds it). */
  pid?: number
}

/** How far back the speed is measured: the last few minutes. */
export const ETA_WINDOW_MS = 3 * 60_000
/** Samples older than this are dropped from the file. */
const KEEP_MS = 10 * 60_000
/** Samples closer than this to the last are merged (the file stays small). */
const SAMPLE_GAP_MS = 2_000
/** A running job not written for this long has lost its writer. */
export const STALE_MS = 90_000

/** A file name Windows takes, from a film's name ("Osmanlı: 600 yıl" → "Osmanlı- 600 yıl"). */
export function renderId(name: string): string {
  const s = String(name ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 80)
  return s || 'render'
}

/** Whether a string can be a status file's id (no path in it). */
export function validRenderId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 80 && id === renderId(id) && !/^\.+$/.test(id)
}

export function newRenderStatus(info: { name: string; source: RenderStatus['source']; frames?: number; fps?: number; workers?: number; output?: string; now: number }): RenderStatus {
  return {
    v: 1,
    id: renderId(info.name),
    name: String(info.name),
    source: info.source,
    frames: Math.max(0, Math.round(info.frames ?? 0)),
    fps: info.fps ?? 0,
    workers: Math.max(1, Math.round(info.workers ?? 1)),
    startedAt: info.now,
    updatedAt: info.now,
    state: 'running',
    progress: 0,
    label: 'Getting ready',
    samples: [[info.now, 0]],
    ...(info.output ? { output: info.output } : {})
  }
}

/** The bar moved (or a heartbeat with no move): a sample, the old ones trimmed. */
export function withProgress(s: RenderStatus, now: number, fraction: number, label?: string): RenderStatus {
  const p = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : s.progress))
  const samples = s.samples.filter(([t]) => now - t <= KEEP_MS)
  const last = samples[samples.length - 1]
  // Two close samples: the newer replaces the older (but the first stays,
  // so a fresh job still has a start to measure from).
  if (last && samples.length > 1 && now - last[0] < SAMPLE_GAP_MS) samples[samples.length - 1] = [now, p]
  else samples.push([now, p])
  return { ...s, progress: p, label: label ?? s.label, samples, updatedAt: now }
}

/** The job is over. */
export function finished(s: RenderStatus, now: number, state: Exclude<RenderStatus['state'], 'running'>, extra: { error?: string; output?: string } = {}): RenderStatus {
  return {
    ...s,
    ...extra,
    state,
    progress: state === 'done' ? 1 : s.progress,
    label: state === 'done' ? 'Done' : state === 'cancelled' ? 'Cancelled' : 'Failed',
    updatedAt: now,
    endedAt: now
  }
}

/** A running job whose writer stopped writing (closed, crashed, killed). */
export function isStale(s: RenderStatus, now: number): boolean {
  return s.state === 'running' && now - s.updatedAt > STALE_MS
}

export interface RenderEta {
  /** Seconds left. */
  left: number
  /** ms since the epoch. */
  finishAt: number
  /** Frames drawn a second (0 when the job has no frames). */
  speed: number
}

/**
 * Time left and the finish time from how fast the bar moved over the last
 * few minutes (not since the start: the sound is mixed quickly and the
 * frames slowly, and a 3D stretch draws slower than a paper one). Null until
 * there is enough to say anything honest.
 */
export function renderEta(samples: [number, number][], frames: number, now: number, windowMs = ETA_WINDOW_MS): RenderEta | null {
  if (samples.length < 2) return null
  const [tN, pN] = samples[samples.length - 1]
  if (pN >= 1) return { left: 0, finishAt: tN, speed: 0 }
  // The oldest sample inside the window (at least the one before the last).
  let i = samples.length - 2
  while (i > 0 && tN - samples[i - 1][0] <= windowMs) i--
  const [t0, p0] = samples[i]
  const dt = (tN - t0) / 1000
  const dp = pN - p0
  if (dt < 1 || dp <= 0.002) return null
  const rate = dp / dt
  // Counted from the last sample, less the time since it.
  const left = Math.max(0, (1 - pN) / rate - Math.max(0, now - tN) / 1000)
  return { left, finishAt: now + left * 1000, speed: frames > 0 ? rate * frames : 0 }
}

/** Frames drawn so far: from the label when it says ("frame 812 of …"), else the bar. */
export function framesDone(s: Pick<RenderStatus, 'frames' | 'progress' | 'label' | 'state'>): number {
  if (s.state === 'done') return s.frames
  const m = /frame\s+(\d+)\s+of\s+(\d+)/i.exec(s.label)
  if (m && +m[2] === s.frames) return Math.min(s.frames, +m[1])
  return Math.min(s.frames, Math.round(s.progress * s.frames))
}

/** "14:32" (24-hour clock, this PC's time); a later day: "tomorrow 02:10". */
export function fmtClock(ms: number, now: number): string {
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = (x: number): number => {
    const t = new Date(x)
    return Math.floor(new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() / 86_400_000)
  }
  const days = Math.round(day(ms) - day(now))
  return days === 1 ? `tomorrow ${hm}` : days > 1 ? `in ${days} days, ${hm}` : hm
}

/** A status read from a file: checked field by field, or null. */
export function parseRenderStatus(text: string): RenderStatus | null {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(text)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || o.v !== 1 || !validRenderId(o.id)) return null
  const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
  const states = ['running', 'done', 'failed', 'cancelled'] as const
  const state = states.find((x) => x === o.state)
  if (!state) return null
  const samples = Array.isArray(o.samples)
    ? (o.samples as unknown[])
        .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .slice(-600)
    : []
  return {
    v: 1,
    id: o.id as string,
    name: str(o.name, 200) || (o.id as string),
    source: o.source === 'script' ? 'script' : 'snipp',
    frames: Math.max(0, Math.round(num(o.frames))),
    fps: num(o.fps),
    workers: Math.max(1, Math.round(num(o.workers, 1))),
    startedAt: num(o.startedAt),
    updatedAt: num(o.updatedAt),
    state,
    progress: Math.max(0, Math.min(1, num(o.progress))),
    label: str(o.label, 300) ?? '',
    samples,
    ...(str(o.output, 1000) ? { output: str(o.output, 1000) } : {}),
    ...(str(o.error, 2000) ? { error: str(o.error, 2000) } : {}),
    ...(typeof o.endedAt === 'number' ? { endedAt: o.endedAt } : {}),
    ...(typeof o.pid === 'number' ? { pid: o.pid } : {})
  }
}

/** The panel's order: running first (oldest start first), then the rest, newest first. */
export function sortRenders(list: RenderStatus[], now: number): RenderStatus[] {
  const live = (s: RenderStatus): boolean => s.state === 'running' && !isStale(s, now)
  return [...list].sort((a, b) => {
    const la = live(a)
    const lb = live(b)
    if (la !== lb) return la ? -1 : 1
    return la ? a.startedAt - b.startedAt : (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt)
  })
}
