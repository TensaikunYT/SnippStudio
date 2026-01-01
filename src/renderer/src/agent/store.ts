// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's side of the app's state (SnippStudio phase 4A): the apply
// setting, the agent sessions, every tool call as an event (its start and its
// end), the estimated tokens, and the pending draft as the user sees it. Not
// the project and not its undo history: a store of its own, written twice per
// call (start, end), never per frame. Phase 4B draws the Agent tab from it.
import { create } from 'zustand'
import { tokensOf, textTokens, type AnswerSize } from './tokens'
import { withWorker } from './crew'
import type { Region } from './regions'

export type ApplyMode = 'draft' | 'direct'
export const AGENT_FRAME_WIDTHS = ['384', '512', '768'] as const
export type AgentFrameWidth = typeof AGENT_FRAME_WIDTHS[number]

const MODE_KEY = 'snipp-agent-apply'
const FRAME_WIDTH_KEY = 'snipp-agent-frame-width'

function frameWidthAtStart(): AgentFrameWidth {
  try {
    const saved = localStorage.getItem(FRAME_WIDTH_KEY)
    if (saved === '384' || saved === '768') return saved
  } catch {
    /* use the default */
  }
  return '512'
}

function modeAtStart(): ApplyMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'direct' ? 'direct' : 'draft'
  } catch {
    return 'draft'
  }
}

export interface ToolEvent {
  id: string
  session: string
  /** The agent program that called (kept on the call: its session may be
   *  gone when the agent bar still says what it did). */
  client?: string
  tool: string
  /** The worker that made the call (its optional `as`, cleaned: agent/crew.ts;
   *  EKIP-PLAN.md). Absent: the agent itself (no team). */
  as?: string
  /** The team mode (EKIP-PLAN.md): an edit of this worker's op that was
   *  dropped because ANOTHER worker's call changed the timeline first (the
   *  answer names that call): that worker ('' for the agent's unlabelled
   *  calls). Said to the user only. */
  after?: string
  /** The team mode, step 3: an op of this edit was not applied because it
   *  would change the region of this worker (the answer names it). */
  region?: string
  /** The analysis kind, the edit's first op, the job… */
  kind?: string
  /** The stretch of the timeline the call reads or changes, when it has one. */
  range?: [number, number]
  /** The moments a frames call looks at. */
  at?: number[]
  started: number
  ms?: number
  chars?: number
  images?: { width: number; height: number }[]
  tokens?: number
  error?: string
  /** An analysis' findings (its items' ranges): the timeline shows them. */
  found?: [number, number][]
  /** An edit of which nothing was applied (every op dropped): its step says
   *  so (DENEME-2: three "Edited" steps, nothing had changed). */
  nothing?: boolean
  /** What an edit changed, in the user's words (D22, the audit's A13:
   *  agent/said.ts): the Steps list says it instead of the commands' names. */
  said?: string
  /** An edit: how many operations the agent sent in it. */
  ops?: number
  /** What an edit wrote (D22, worker C; agent/activity.ts wroteOf): the
   *  stretches of the timeline, the clips, how many changes. Worked out by
   *  the app from the project before and after: the agent's answer is the
   *  same bytes. The ruler's flag, the trail under it and the frame on a
   *  changed clip are drawn from these. */
  wrote?: [number, number][]
  clips?: string[]
  changed?: number
  /** "Compared with raw" (TOKEN-PLAN.md): the tokens this answer would have
   *  weighed had the thing itself been sent (agent/raw.ts), worked out on
   *  the page from what the answer was made of. Absent: not measured (yet), and then no
   *  ratio is shown. Nothing of it reaches the agent. */
  raw?: number
  /** A wait that carried the agent's own plan (its steps not yet done,
   *  current first): not a delivery, only the plan. */
  plan?: string[]
  /** A wait that brought the user's notes: their ids (the job's progress). */
  sent?: string[]
  done: boolean
}

/** One finished job, kept in the profile (at most JOBS_KEPT): the Agent
 *  tab's list and "similar jobs took ≈ 3 min". */
export interface JobRecord {
  client: string
  /** What the job was: what the wait brought (notes, task, draft,
   *  handover), or 'free' when the agent worked unasked. */
  kind: string
  start: number
  ms: number
  steps: number
  changed: number
  tokens: number
  /** Its raw tokens, when every answer of it was measured. */
  raw?: number
}

export const JOBS_KEPT = 20
const JOBS_KEY = 'snipp-agent-jobs'

function jobsAtStart(): JobRecord[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(JOBS_KEY) ?? '[]')
    if (!Array.isArray(v)) return []
    return v.filter((r): r is JobRecord => !!r && typeof r === 'object' && typeof (r as JobRecord).start === 'number' && typeof (r as JobRecord).ms === 'number' && typeof (r as JobRecord).kind === 'string').slice(-JOBS_KEPT)
  } catch {
    return []
  }
}

/** The list with `rec` in it: a record of the same job (program and start)
 *  is replaced (a job that went on and finished again), the oldest go. */
export function withJob(list: readonly JobRecord[], rec: JobRecord): JobRecord[] {
  const rest = list.filter((r) => !(r.client === rec.client && r.start === rec.start))
  return [...rest, rec].sort((a, b) => a.start - b.start).slice(-JOBS_KEPT)
}

export interface SessionInfo {
  id: string
  /** The agent program (initialize's clientInfo.name). */
  client: string
  started: number
  lastCall: number
  calls: number
  /** Tokens of the tool answers so far (estimate). */
  tokens: number
  /** The tool definitions it was sent once (initialize + tools/list). */
  defsTokens: number
}

export interface DraftOpView {
  index: number
  name: string
  applied: boolean
  /** Why it drops (or what is said besides: a locked track left alone…). */
  reason?: string
  notes?: string[]
  /** A cut with more than one range: each can be left out (removeRange). */
  ranges?: number
  /** Dropped for good after the agent was told: it can be brought back. */
  revivable?: boolean
}

export interface DraftCallView {
  seq: number
  /** The worker that wrote the call (EKIP-PLAN.md). */
  as?: string
  label: string
  at: number
  /** Each op of the call as it stands now (phase 4B card). */
  ops?: DraftOpView[]
}

/** What the timeline draws of the draft (phase 4B.4), in LIVE seconds: the
 *  ranges it cuts and the clips it adds (dashed ghosts). */
export interface DraftMarks {
  cuts: [number, number][]
  ghosts: { id: string; trackId: string; start: number; duration: number; name: string }[]
}

/** A direct change of the agent, marked on the timeline for a moment. */
export interface AgentFlash {
  at: number
  clips: string[]
  ranges: [number, number][]
  label: string
  /** The film's length before and after (the warning when it jumps). */
  lengths: { before: number; after: number }
}

export interface DraftView {
  /** Which draft this is (a new one after a reject or an accept has another;
   *  its calls are numbered from 1 again). */
  id?: number
  session: string
  client: string
  calls: DraftCallView[]
  marks?: DraftMarks
  summary: { calls: number; cuts: number; seconds: number; addedClips: number; dropped: number; moved?: number }
  /** What it does, in the user's words (agent/draft-words.ts; DENEME-2). */
  changes?: import('./draft-words').DraftChange[]
  /** One item per op it applies now, in the order sent (D22, worker C: the
   *  review strip goes through them, the timeline marks them). */
  items?: import('./review').ReviewItem[]
  /** The draft's project and the live project it was last worked out on
   *  (the timeline's "After", and where the marks lie). */
  project?: import('../types').Project
  on?: import('../types').Project
  /** How many ops the user accepted and rejected one by one so far. */
  decided?: { accepted: number; rejected: number }
  /** The film's length now and with the draft (seconds). */
  lengths?: { live: number; draft: number }
  /** Every op that is not applied now, and why (index: its place in the
   *  call, 0-based). An op dropped for a change of the user's comes back by
   *  itself when they take the change back. */
  dropped: { seq: number; index?: number; label: string; reason: string; command?: string; revivable?: boolean; rejected?: boolean; as?: string; after?: string }[]
  /** The draft's version as the agent sees it. */
  version: string
  /** Agent access was turned off while it waited (it stays for the user). */
  disconnected?: boolean
  /** The live project changed and the draft was not worked out on it yet:
   *  what is shown is the draft as it WAS (the preview says so). */
  updating?: boolean
  /** The draft could not be worked out (a fault of the app's): it can be
   *  rejected. */
  broken?: string
}

/** How the user's last decision on a draft went (phase 4A.8, D5): what was
 *  dropped, and why, so the card can say it. */
export interface DraftOutcome {
  /** 'changed': the project or the outcome was no longer what the card
   *  showed; nothing was adopted (phase 4A.9, S12). */
  kind: 'accepted' | 'partial' | 'nothing' | 'rejected' | 'changed'
  dropped: { seq: number; index?: number; label: string; reason: string }[]
  at: number
}

const MAX_EVENTS = 500
/** Sessions the activity list keeps (as many as the server keeps). */
export const MAX_SESSIONS = 32

/** The agent's last change made straight on the timeline: the live version
 *  it left and when; `undone`: the version the bar's Undo left (the bar says
 *  "taken back" while the project stands there). */
export interface LastDirect {
  version: number
  at: number
  undone?: number
}

export interface AgentState {
  mode: ApplyMode
  setMode: (mode: ApplyMode) => void
  frameWidth: AgentFrameWidth
  setFrameWidth: (width: AgentFrameWidth) => void
  sessions: Record<string, SessionInfo>
  /** The workers of each agent program, in the order first seen (their
   *  colours: agent/crew.ts workerColour). */
  crew: Record<string, string[]>
  /** The stretches each program's workers took (agent/regions.ts,
   *  region-state.ts): kept while the work lasts, never in the project. */
  regions: Record<string, Region[]>
  setRegions: (client: string, list: Region[]) => void
  events: ToolEvent[]
  draft: DraftView | null
  outcome: DraftOutcome | null
  callStarted: (e: Omit<ToolEvent, 'done' | 'started' | 'raw'> & { client: string; defsChars: number }) => void
  /** Bumped to open the Inspector's Agent tab (the top bar's draft badge). */
  openTab: number
  requestTab: () => void
  /** The agent's last change straight onto the timeline, marked for a few
   *  seconds (DENEME-2, item 6): clips and ranges in live seconds. */
  flash: AgentFlash | null
  setFlash: (f: AgentFlash | null) => void
  callFinished: (id: string, out: { size?: AnswerSize; raw?: number | null; error?: string; found?: [number, number][]; nothing?: boolean; said?: string; wrote?: [number, number][]; clips?: string[]; changed?: number; after?: string; region?: string }) => void
  /** The agent bar's finished job the user closed (its start), or null
   *  (D22, worker C: "Done" stays until it is closed or new work comes). */
  barClosed: number | null
  closeBar: (jobStart: number | null) => void
  /** When the user pressed Stop on the agent bar (the bar says "Stopped"
   *  until the agent's next call). */
  stopped: number | null
  setStopped: (at: number | null) => void
  /** The review strip's item in focus ("seq:index"): the timeline lights
   *  its marks. */
  focusItem: string | null
  setFocusItem: (key: string | null) => void
  /** The agent bar is on screen (the timeline's own line): what the agent
   *  just changed is said THERE, once — no toast and no label on the lanes
   *  beside it (D22, worker C, the second pass). */
  barShown: boolean
  setBarShown: (on: boolean) => void
  /** The agent's last change made straight on the timeline: the live
   *  version it left (while the project still stands there, the bar's
   *  "Undo" takes exactly that change back). */
  lastDirect: LastDirect | null
  setLastDirect: (d: LastDirect | null) => void
  /** Finished jobs (the profile's, at most JOBS_KEPT). */
  jobs: JobRecord[]
  recordJob: (rec: JobRecord) => void
  setDraft: (draft: DraftView | null) => void
  setOutcome: (o: DraftOutcome | null) => void
  /** A session ended or was forgotten (G9): it leaves the list. */
  dropSession: (id: string) => void
}

export const useAgentStore = create<AgentState>((set, get) => ({
  mode: modeAtStart(),
  frameWidth: frameWidthAtStart(),
  setFrameWidth: (frameWidth) => {
    try {
      localStorage.setItem(FRAME_WIDTH_KEY, frameWidth)
    } catch {
      /* kept for this run */
    }
    set({ frameWidth })
  },
  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* kept for this run */
    }
    set({ mode })
  },
  sessions: {},
  crew: {},
  regions: {},
  setRegions: (client, list) =>
    set((st) => {
      if (!list.length && !st.regions[client]) return {}
      const regions = { ...st.regions }
      if (list.length) regions[client] = list
      else delete regions[client]
      return { regions }
    }),
  events: [],
  draft: null,
  callStarted: ({ client, defsChars, ...e }) => {
    const now = Date.now()
    const s = get().sessions[e.session]
    const session: SessionInfo = s
      ? { ...s, client: client || s.client, lastCall: now, calls: s.calls + 1, defsTokens: Math.round(textTokens(defsChars)) || s.defsTokens }
      : { id: e.session, client, started: now, lastCall: now, calls: 1, tokens: 0, defsTokens: Math.round(textTokens(defsChars)) }
    set((st) => {
      const sessions = { ...st.sessions, [e.session]: session }
      // The last few sessions only (G9): the oldest by its last call goes.
      const ids = Object.keys(sessions)
      if (ids.length > MAX_SESSIONS) {
        for (const id of ids.sort((a, b) => sessions[a].lastCall - sessions[b].lastCall).slice(0, ids.length - MAX_SESSIONS)) delete sessions[id]
      }
      const crew = e.as && !(st.crew[client] ?? []).includes(e.as) ? { crew: { ...st.crew, [client]: withWorker(st.crew[client] ?? [], e.as) } } : {}
      return { sessions, ...crew, events: [...st.events.slice(-(MAX_EVENTS - 1)), { ...e, ...(client ? { client } : {}), started: now, done: false }] }
    })
  },
  openTab: 0,
  requestTab: () => set((st) => ({ openTab: st.openTab + 1 })),
  flash: null,
  setFlash: (flash) => set({ flash }),
  callFinished: (id, out) => {
    const now = Date.now()
    const events = get().events
    const i = events.findIndex((e) => e.id === id)
    if (i < 0) return
    const e = events[i]
    const tokens = out.size ? tokensOf(out.size) : 0
    const done: ToolEvent = {
      ...e,
      done: true,
      ms: now - e.started,
      ...(out.size ? { chars: out.size.chars, images: out.size.images, tokens } : {}),
      ...(typeof out.raw === 'number' && Number.isFinite(out.raw) ? { raw: Math.round(out.raw) } : {}),
      ...(out.error ? { error: out.error } : {}),
      ...(out.found?.length ? { found: out.found.slice(0, 400) } : {}),
      ...(out.nothing ? { nothing: true } : {}),
      ...(out.said && !out.nothing ? { said: out.said.slice(0, 240) } : {}),
      ...(out.wrote?.length && !out.nothing ? { wrote: out.wrote.slice(0, 40) } : {}),
      ...(out.clips?.length && !out.nothing ? { clips: out.clips.slice(0, 200) } : {}),
      ...(out.changed && !out.nothing ? { changed: out.changed } : {}),
      ...(out.after !== undefined ? { after: out.after } : {}),
      ...(out.region ? { region: out.region } : {})
    }
    const s = get().sessions[e.session]
    set((st) => ({
      events: [...st.events.slice(0, i), done, ...st.events.slice(i + 1)],
      ...(s ? { sessions: { ...st.sessions, [e.session]: { ...s, lastCall: now, tokens: s.tokens + tokens } } } : {})
    }))
  },
  jobs: jobsAtStart(),
  recordJob: (rec) => {
    const old = get().jobs.find((r) => r.client === rec.client && r.start === rec.start)
    if (old && JSON.stringify(old) === JSON.stringify(rec)) return
    const jobs = withJob(get().jobs, rec)
    try {
      localStorage.setItem(JOBS_KEY, JSON.stringify(jobs))
    } catch {
      /* kept for this run */
    }
    set({ jobs })
  },
  setDraft: (draft) => set({ draft }),
  barClosed: null,
  closeBar: (barClosed) => set({ barClosed }),
  stopped: null,
  setStopped: (stopped) => set({ stopped }),
  focusItem: null,
  setFocusItem: (focusItem) => set((st) => (st.focusItem === focusItem ? {} : { focusItem })),
  barShown: false,
  setBarShown: (barShown) => set((st) => (st.barShown === barShown ? {} : { barShown })),
  lastDirect: null,
  setLastDirect: (lastDirect) => set({ lastDirect }),
  outcome: null,
  setOutcome: (outcome) => set({ outcome }),
  dropSession: (id) =>
    set((st) => {
      if (!st.sessions[id]) return {}
      const sessions = { ...st.sessions }
      delete sessions[id]
      return { sessions }
    })
}))

/** A session's total: the answers so far plus the definitions it was sent. */
export const sessionTokens = (s: SessionInfo): number => s.tokens + s.defsTokens

/** Said wherever the estimate is shown (4B's token meter): t('agent.tokensNote'). */
export const TOKENS_NOTE_KEY = 'agent.tokensNote'
