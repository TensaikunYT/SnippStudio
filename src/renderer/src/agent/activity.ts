// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the agent is doing now, worked out from the tool calls the app
// already records (agent/store.ts ToolEvent) and from nothing else: the
// agent is never asked, not one character more is sent to it (D22, worker
// C; YOL-HARITASI.md 1.1, 1.2; the audit's A7, L5). The agent bar over the
// timeline, the one chip of the top bar, the flag on the ruler and the trail
// under it are all drawn from this. Pure (src/test/d22-c-activity.test.ts).
//
// A JOB is a run of calls: those after the last `wait` that brought the
// agent something from the user (the job they sent), or, without one, the
// last run of calls with no gap longer than ten minutes.
// Its PHASE:
//   working  a call is open (not a wait), or the last one ended less than
//            8 s ago (the same clock as the light round the preview);
//   quiet    8–60 s since the last call, no wait open: an agent thinks
//            between its calls — "done" would be a lie, so would "working";
//   done     the agent's wait is open (it said the turn is the user's), or
//            it has been quiet for over a minute, or its session is gone.
//            It stays until the user closes it or new work comes; a call
//            after it carries the same job on.
// The old "working for 120 s after the last call" is gone.
import { toDraft, type DraftChange } from './draft-words'
import type { JobRecord, ToolEvent } from './store'
import { PIXELS_PER_TOKEN } from './tokens'

/** After a call: still "working" this long (the agent is about to call again). */
export const WORK_GAP_MS = 8000
/** After that: "quiet" until this long since the last call, then "done". */
export const QUIET_MS = 60_000
/** A gap longer than this between two calls starts a new job. */
export const JOB_GAP_MS = 10 * 60_000

export type Phase = 'none' | 'working' | 'quiet' | 'done'

export interface Job {
  /** The job's calls, oldest first (the wait that brought it is not one). */
  events: ToolEvent[]
  /** When it began: the moment the user's send was taken, else its first call. */
  start: number
  /** The user sent it (a wait brought it). */
  sent: boolean
  /** The agent just took something the user sent and has not called since:
   *  that wait. The job shown is still the one before it (its "Done" stays
   *  until new work really starts: the agent's first call after it). */
  took?: ToolEvent
  /** The wait that brought this job (what the user sent: its kind, its
   *  notes). */
  by?: ToolEvent
}

const endOf = (e: ToolEvent): number => e.started + (e.ms ?? 0)
/** A wait that brought the agent something (a wait that brought nothing is
 *  not recorded at all: agent/host.ts). A wait that only carried the
 *  agent's own plan brought nothing: it is a step of the job. */
const delivered = (e: ToolEvent): boolean => e.tool === 'wait' && e.done && !e.error && e.plan === undefined

/** The latest job among `events` (one agent program's calls, oldest first);
 *  null: none yet. */
export function jobOf(events: readonly ToolEvent[]): Job | null {
  if (!events.length) return null
  let from = events.length
  let to = events.length
  let start = 0
  let sent = false
  let took: ToolEvent | undefined
  let by: ToolEvent | undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (delivered(e)) {
      // (The last thing that happened: the job before it is still the one shown.)
      if (i === events.length - 1) {
        took = e
        from = to = i
        continue
      }
      start = endOf(e)
      sent = true
      by = e
      break
    }
    const next = events[i + 1]
    if (next && next !== took && next.started - endOf(e) > JOB_GAP_MS) break
    from = i
    start = e.started
  }
  return { events: events.slice(from, to), start: start || (took ? endOf(took) : events[events.length - 1].started), sent, ...(took ? { took } : {}), ...(by ? { by } : {}) }
}

export interface PhaseNow {
  phase: Phase
  /** When the phase may change by itself (a timer is due then); null: only
   *  a new call or a wait changes it. */
  until: number | null
  /** The call that says what the agent does: the open one, else the last. */
  current: ToolEvent | null
  /** When the job's last call ended (now, while one is open). */
  lastEnd: number
}

/** The phase of a job at `now`. `waiting`: this agent's wait is open;
 *  `alive`: one of its sessions is still there. */
export function phaseOf(job: Job | null, waiting: boolean, alive: boolean, now: number): PhaseNow {
  if (!job) return { phase: 'none', until: null, current: null, lastEnd: 0 }
  const open = [...job.events].reverse().find((e) => !e.done)
  const last = job.took ?? job.events[job.events.length - 1] ?? null
  if (open) return { phase: 'working', until: null, current: open, lastEnd: now }
  const lastEnd = Math.max(job.took ? endOf(job.took) : 0, job.events.reduce((m, e) => Math.max(m, endOf(e)), job.start))
  if (waiting) return { phase: job.events.length ? 'done' : 'none', until: null, current: last, lastEnd }
  const since = now - lastEnd
  if (since < WORK_GAP_MS) return { phase: 'working', until: lastEnd + WORK_GAP_MS, current: last, lastEnd }
  if (alive && since < QUIET_MS) return { phase: 'quiet', until: lastEnd + QUIET_MS, current: last, lastEnd }
  return { phase: job.events.length ? 'done' : 'none', until: null, current: last, lastEnd }
}

export interface JobTotals {
  /** Its calls. */
  steps: number
  /** What the app sent the agent for them (estimate): the answers, and the
   *  tool definitions when the job holds the session's first call. */
  tokens: number
  /** How long: to now while it runs, to its last call when done. */
  ms: number
  /** What its edits changed (the sentences they said), and how many of
   *  them applied nothing. */
  changed: number
}

export function totalsOf(job: Job, phase: PhaseNow, now: number, defsTokens: (session: string) => number, firstCall: (session: string) => string | undefined): JobTotals {
  let tokens = 0
  let changed = 0
  const ids = new Set(job.events.map((e) => e.id))
  const sessions = new Set<string>()
  for (const e of job.events) {
    tokens += e.tokens ?? 0
    changed += e.changed ?? 0
    sessions.add(e.session)
  }
  // (The definitions are sent once, with a session's first call: counted in
  // the job that holds that call.)
  for (const s of sessions) {
    const first = firstCall(s)
    if (first !== undefined && ids.has(first)) tokens += defsTokens(s)
  }
  // (Done: to the job's own last call, not to a send taken after it.)
  const end = job.events.reduce((m, e) => Math.max(m, endOf(e)), job.start)
  return { steps: job.events.length, tokens: Math.round(tokens), ms: Math.max(0, (phase.phase === 'done' ? end : now) - job.start), changed }
}

/** What the flag on the ruler shows: reading, looking at frames, writing. */
export type Doing = 'read' | 'look' | 'write'

export function doingOf(e: ToolEvent): Doing {
  if (e.tool === 'frames') return 'look'
  if (e.tool === 'edit' || (e.tool === 'code_clip' && e.kind !== 'check') || (e.tool === 'job' && e.kind !== 'wait')) return 'write'
  return 'read'
}

/** Where a call touched the timeline: the start of what it wrote, read or
 *  looked at; null when it has no place (the notes, a job). `whole`: the
 *  film's length, for a call that reads all of it. */
export function placeOf(e: ToolEvent): number | null {
  if (e.wrote?.length) return e.wrote[0][0]
  if (e.at?.length) return Math.min(...e.at)
  if (e.range) return e.range[0]
  if (e.tool === 'project' || e.tool === 'transcript' || e.tool === 'analyze') return 0
  return null
}

/** The flag: the job's last call that has a place, and what it was doing. */
export function flagOf(job: Job | null): { at: number; doing: Doing; event: ToolEvent } | null {
  if (!job) return null
  for (let i = job.events.length - 1; i >= 0; i--) {
    const e = job.events[i]
    if (e.error) continue
    const at = placeOf(e)
    if (at !== null) return { at, doing: doingOf(e), event: e }
  }
  return null
}

export interface TrailPart {
  from: number
  to: number
  /** Written (solid) or only read or looked at (faint). */
  wrote: boolean
  /** The calls that touched it, oldest first. */
  events: ToolEvent[]
}

/** The agent's trail of a job: every stretch it read (faint) and every
 *  stretch it wrote (solid), stretches of one sort that touch joined, each
 *  with its calls. `length`: the film's length (a read of the whole film). */
export function trailOf(job: Job | null, length: number): TrailPart[] {
  if (!job) return []
  const parts: TrailPart[] = []
  const add = (from: number, to: number, wrote: boolean, e: ToolEvent): void => {
    const a = Math.max(0, Math.min(from, to))
    const b = Math.max(a, Math.max(from, to))
    const hit = parts.find((p) => p.wrote === wrote && a <= p.to + 0.05 && b >= p.from - 0.05)
    if (hit) {
      hit.from = Math.min(hit.from, a)
      hit.to = Math.max(hit.to, b)
      if (!hit.events.includes(e)) hit.events.push(e)
    } else parts.push({ from: a, to: b, wrote, events: [e] })
  }
  for (const e of job.events) {
    if (e.error) continue
    for (const [a, b] of e.wrote ?? []) add(a, b, true, e)
    if (e.wrote?.length) continue
    if (e.tool === 'frames') for (const t of e.at ?? []) add(t, t, false, e)
    else if (e.range) add(e.range[0], e.range[1], false, e)
    else if (e.tool === 'project' || e.tool === 'transcript' || e.tool === 'analyze') add(0, length, false, e)
  }
  // (Joined again: a stretch that grew may touch another now.)
  parts.sort((x, y) => Number(x.wrote) - Number(y.wrote) || x.from - y.from)
  const out: TrailPart[] = []
  for (const p of parts) {
    const prev = out[out.length - 1]
    if (prev && prev.wrote === p.wrote && p.from <= prev.to + 0.05) {
      prev.to = Math.max(prev.to, p.to)
      for (const e of p.events) if (!prev.events.includes(e)) prev.events.push(e)
    } else out.push({ ...p, events: [...p.events] })
  }
  return out.slice(0, 200)
}

/** The clips a job's edits changed (the timeline frames them). */
export function touchedOf(job: Job | null): string[] {
  const out = new Set<string>()
  for (const e of job?.events ?? []) for (const id of e.clips ?? []) out.add(id)
  return [...out]
}

/** What an edit wrote, for its event: the stretches (seconds of the project
 *  AFTER it) and the clips, from its changes. Kept small. */
export function wroteOf(changes: readonly DraftChange[], before: { clips: Record<string, { start: number; duration: number }> }, after: { clips: Record<string, { start: number; duration: number }> }, cuts: readonly [number, number][]): { wrote: [number, number][]; clips: string[] } {
  const spans: [number, number][] = []
  const clips = new Set<string>()
  const clipSpan = (id: string | undefined): void => {
    if (id === undefined) return
    const c = Object.hasOwn(after.clips, id) ? after.clips[id] : undefined
    const b = Object.hasOwn(before.clips, id) ? before.clips[id] : undefined
    if (c) {
      spans.push([c.start, c.start + c.duration])
      clips.add(id)
    } else if (b) spans.push([toDraft(b.start, cuts), toDraft(b.start, cuts) + b.duration])
  }
  for (const ch of changes) {
    if (ch.range) {
      const at = toDraft(ch.range[0], cuts)
      spans.push([at, at + Math.max(0.2, ch.range[1] - ch.range[0])])
    } else if (ch.clipId !== undefined) clipSpan(ch.clipId)
    else if (ch.to !== undefined) spans.push([toDraft(ch.to, cuts), toDraft(ch.end ?? ch.to + 0.2, cuts)])
  }
  spans.sort((x, y) => x[0] - y[0])
  const wrote: [number, number][] = []
  for (const [a, b] of spans) {
    const prev = wrote[wrote.length - 1]
    if (prev && a <= prev[1] + 0.05) prev[1] = Math.max(prev[1], b)
    else wrote.push([Math.round(a * 1000) / 1000, Math.round(Math.max(a, b) * 1000) / 1000])
  }
  return { wrote: wrote.slice(0, 40), clips: [...clips].slice(0, 200) }
}

// ---- tokens, their parts, raw (TOKEN-PLAN.md; YOL-HARITASI.md 1.3) ---------

export interface TokenParts {
  /** The tool definitions, when this job holds the session's first call. */
  defs: number
  /** The answers' words and their pictures. */
  text: number
  images: number
  /** defs + text + images: the bar's number (totalsOf's tokens). */
  total: number
  /** What the same answers would have weighed raw (agent/raw.ts), the
   *  definitions as they are; null when one answer was not measured. */
  raw: number | null
}

/** The parts of what the app sent for a job's finished calls. `defsTokens`
 *  and `firstCall` as for totalsOf. */
export function tokenPartsOf(job: Job, defsTokens: (session: string) => number, firstCall: (session: string) => string | undefined): TokenParts {
  let answers = 0
  let pics = 0
  let raw: number | null = 0
  const ids = new Set(job.events.map((e) => e.id))
  const sessions = new Set<string>()
  for (const e of job.events) {
    sessions.add(e.session)
    if (!e.done) continue
    answers += e.tokens ?? 0
    for (const im of e.images ?? []) pics += (im.width * im.height) / PIXELS_PER_TOKEN
    raw = raw === null || e.raw === undefined ? null : raw + e.raw
  }
  let defs = 0
  for (const s of sessions) {
    const first = firstCall(s)
    if (first !== undefined && ids.has(first)) defs += defsTokens(s)
  }
  const images = Math.min(Math.round(answers), Math.round(pics))
  const text = Math.round(answers) - images
  const total = Math.round(defs) + text + images
  return { defs: Math.round(defs), text, images, total, raw: raw === null ? null : Math.round(defs) + Math.round(raw) }
}

/** "−62 %": how much smaller the job's answers were than raw, in whole
 *  per cent; null when raw is unknown, or it saved nothing. */
export function savedPercent(parts: TokenParts): number | null {
  if (parts.raw === null || parts.raw <= 0 || parts.raw <= parts.total) return null
  const p = Math.round((1 - parts.total / parts.raw) * 100)
  return p >= 1 ? p : null
}

// ---- progress (YOL-HARITASI.md 1.4): three honest sources, no countdown -------

/** The agent's own plan, from the job's last wait that carried one: the
 *  steps not done yet, current first. Its step number counts from the
 *  longest plan the job was given. Null: no plan, or nothing left. */
export function planOf(job: Job | null): { step: number; of: number; name: string } | null {
  if (!job) return null
  let of = 0
  let left: string[] | undefined
  for (const e of job.events) {
    if (e.plan === undefined || e.error || !e.done) continue
    of = Math.max(of, e.plan.length)
    left = e.plan
  }
  if (!left || !left.length) return null
  return { step: of - left.length + 1, of, name: left[0] }
}

/** The user's notes the job came with, and how many of them are done
 *  (ready or approved). `statusOf`: a note's status now (undefined: gone). */
export function notesProgressOf(job: Job | null, statusOf: (id: string) => string | undefined): { done: number; of: number } | null {
  const ids = job?.by?.sent
  if (!ids?.length) return null
  let of = 0
  let done = 0
  for (const id of ids) {
    const s = statusOf(id)
    if (s === undefined) continue
    of++
    if (s === 'ready' || s === 'approved') done++
  }
  return of ? { done, of } : null
}

/** What a job was, for "similar jobs": what brought it. */
export const jobKindOf = (job: Job): string => job.by?.kind || 'free'

/** How long similar jobs took (ms): the median of the last five finished
 *  jobs of the same kind and program; null under two of them. */
export function similarMs(history: readonly JobRecord[], client: string, kind: string, notStart?: number): number | null {
  const same = history.filter((r) => r.client === client && r.kind === kind && r.start !== notStart && r.ms > 0).slice(-5).map((r) => r.ms).sort((a, b) => a - b)
  if (same.length < 2) return null
  const m = same.length >> 1
  return same.length % 2 ? same[m] : Math.round((same[m - 1] + same[m]) / 2)
}
