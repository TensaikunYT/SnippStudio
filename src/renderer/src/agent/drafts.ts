// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent's draft in the app (SnippStudio phase 4A.9, FAZ4A-YENIDEN.md
// A3–A5): one session's edits waiting for the user. A draft is nothing but
// its entries; the project it shows is always replay(live project, entries)
// (replay.ts). There is no "base" it was built on and no stale state: when
// the user edits the live project the entries are simply replayed on it, each
// op finding its content again or dropping with its reason — and coming back
// by itself when the user takes the change back.
//
// Accepting all of it, some of it, or all but one range of a cut is the same
// replay with fewer entries (or a narrower op), adopted as ONE undo step.
//
// Versions an agent holds ("v 3fa1c-12") are names of projects it was shown.
// The last 8 it was given are kept per client program with their projects:
// an edit says which one its seconds come from (`base`), and what it means
// is read off that project as content. A number that is not kept is refused
// plainly ("too old: read again"); nothing is ever carried from one frame of
// seconds to another.
import type { Clip, Project } from '../types'
import { instanceOf, projectDuration } from '../types'
import { useStore, projectSession } from '../state/store'
import { env as storeEnv, versions as liveVersions } from '../state/shared'
import { cutsOfSegments, diffProjects, segmentsAfterCuts, type Changes } from '../history/versions'
import { draftChanges, type DraftChange } from './draft-words'
import { candidate } from '../playback/candidate'
import { replay, type Entry, type Inside, type Op, type Outcome, type Replayed, type ReplayContext } from './replay'
import { useAgentStore, type DraftMarks, type DraftOpView, type DraftView } from './store'
import { itemOf, type ReviewItem, type TraceStep } from './review'
import { seams } from './seams'
import { collidedAfter } from './drop-words'
import { regionsFor } from './region-state'

export type { Entry, Op, Outcome }

// ---- versions kept per client -------------------------------------------------

export interface Kept {
  project: Project
  /** The live version it stood on. */
  live: number
  /** The draft it showed (0: the live project). */
  draft: number
  projectSession: number
  /** A draft was read: the live project it stood on (K1 holds an op to the
   *  records as they were there, with the session's own writes on top). */
  under?: Project
  /** And the draft's calls it held (T7). */
  seqs?: number[]
}

interface Client {
  kept: Map<string, Kept>
  /** The version of its newest read (code_clip create's base: audit A2). */
  last?: string
}

/** What is a SESSION's own (phase 4A.10, A3): not its program's — a second
 *  window of the same program is someone else. Only what LANDED on the live
 *  project is kept here; what a waiting draft wrote lives with the draft
 *  (and goes with it when it is rejected). */
interface Own {
  /** Its own last writes (content|field → value): replay.ts ReplayContext. */
  own: Map<string, unknown>
  /** What its ops put on the timeline, and where. */
  made: Inside[]
  /** Where its ops moved records (from, to). */
  moved: [Inside, Inside][]
}
interface Sess extends Own {
  client: string
  /** How many edits of its went straight onto the timeline (their seeds). */
  direct: number
  projectSession: number
}

export const KEEP_VERSIONS = 8
const clients = new Map<string, Client>()
const sessions = new Map<string, Sess>()
/** Drafts that ended without becoming the live project, and how. */
const dead = new Map<number, string>()
/** Live versions an agent's change made, and which session's it was (of
 *  the project that is open: a version number means nothing in another). */
const agentVersions = new Map<number, string>()
let versionsOf = -1

function clientOf(name: string): Client {
  let c = clients.get(name)
  if (!c) {
    clients.set(name, (c = { kept: new Map() }))
    // (Only the last programs seen are kept: one that is gone keeps nothing.)
    while (clients.size > 32) clients.delete(clients.keys().next().value as string)
  }
  return c
}

function sessOf(session: string, client: string): Sess {
  let s = sessions.get(session)
  // (Another project: what it wrote in the one before is not its own here.)
  if (!s || s.projectSession !== projectSession()) {
    sessions.set(session, (s = { client, own: new Map(), made: [], moved: [], direct: s?.direct ?? 0, projectSession: projectSession() }))
    while (sessions.size > 64) sessions.delete(sessions.keys().next().value as string)
  }
  return s
}
const copyOf = (o: Own): Own => ({ own: new Map(o.own), made: [...o.made], moved: [...o.moved] })

/** A version handed to a client (a read's answer): kept, the oldest of more
 *  than eight forgotten; those of a project that was closed are let go. */
export function keep(client: string, token: string, k: Kept): void {
  const c = clientOf(client)
  for (const [t, x] of c.kept) if (x.projectSession !== k.projectSession) c.kept.delete(t)
  c.kept.delete(token)
  c.kept.set(token, k)
  c.last = token
  while (c.kept.size > KEEP_VERSIONS) c.kept.delete(c.kept.keys().next().value as string)
}

/** The version a client read last (still kept), or undefined: what code_clip
 *  create's seconds come from (audit A2: create takes no base; its times are
 *  of the agent's newest read, carried or dropped as any edit's). */
export function lastRead(client: string): string | undefined {
  const c = clients.get(client)
  return c?.last && c.kept.has(c.last) ? c.last : undefined
}

/** code_clip create brought a film into the live project (derived data, the
 *  clip's media): the versions it read are given that film (a clip of it can
 *  be read there), and the live versions the bringing in made are the
 *  session's own (not "someone else changed the film"). */
export function filmCameIn(client: string, session: string, asset: Project['assets'][number], liveFrom: number, liveTo: number): void {
  const c = clients.get(client)
  for (const k of c?.kept.values() ?? []) {
    if (!k.project.assets.some((a) => a.id === asset.id)) k.project = { ...k.project, assets: [...k.project.assets, asset] }
    if (k.under && !k.under.assets.some((a) => a.id === asset.id)) k.under = { ...k.under, assets: [...k.under.assets, asset] }
  }
  if (versionsOf !== projectSession()) {
    agentVersions.clear()
    versionsOf = projectSession()
  }
  for (let v = liveFrom + 1; v <= liveTo; v++) agentVersions.set(v, session)
}

/** The version an agent sent, as written: "v 4987d-2", copied as a read
 *  prints it, is "4987d-2" (phase 4A.10, contract#11). */
const givenOf = (token: unknown): string => (typeof token === 'string' ? token.trim().replace(/^v\s+/i, '') : '')

/** The project a version an agent sends back names. Throws a sentence the
 *  agent can act on when it names nothing here. */
export function keptOf(client: string, token: unknown, field: 'base' | 'since' = 'base'): Kept {
  // (Said in the words of the tool that asked — edit's base, changes' since
  // — with the version the agent last read as the example: phase 4A.10,
  // contract#11. "v 4987d-2", copied as a read prints it, is that version.)
  const example = (): string => [...(clients.get(client)?.kept.keys() ?? [])].pop() ?? liveToken()
  const again = field === 'base' ? 'send the edit with that v' : 'call changes again with that v'
  const given = givenOf(token)
  if (!given) throw new Error(`${field} is required: the v of the read your seconds and word numbers come from (it looks like "${example()}"). Call project or transcript.`)
  if (!/^[0-9a-z]{1,10}-\d+$/i.test(given)) throw new Error(`${field} "${String(token).slice(0, 40)}" is not a version: send the v of a read, like "${example()}".`)
  const c = clientOf(client)
  const k = c.kept.get(given)
  if (!k) throw new Error(`version ${given} is too old or not one you were given here: read again (project, transcript) and ${again}.`)
  if (k.projectSession !== projectSession()) throw new Error(`version ${given} belongs to another project (one was opened since): read again (project, transcript).`)
  if (dead.has(k.draft)) throw new Error(`version ${given} belongs to a draft that was ${dead.get(k.draft)}: read again (project, transcript).`)
  // Used again: the last to be forgotten.
  c.kept.delete(given)
  c.kept.set(given, k)
  return k
}

/** The draft's calls a kept version held, without touching the keeping
 *  order (the team mode's collision reading: EKIP-PLAN.md); undefined when
 *  the version is not kept or held none. */
export function heldBy(client: string, token: unknown): number[] | undefined {
  const given = givenOf(token)
  return clients.get(client)?.kept.get(given)?.seqs
}

/** The draft's calls: their worker and whether they may move or cut. */
export const callsMoving = (d: Pick<Draft, 'entries'>): { seq: number; as: string; moves: boolean }[] => d.entries.map((e) => ({ seq: e.seq, as: e.as ?? '', moves: e.ops.some((op) => op.family !== 'add' && op.family !== 'field' && op.family !== 'line') }))

/** A client's kept versions (tests, the memory measurement). */
export const keptCount = (client: string): number => clients.get(client)?.kept.size ?? 0

/** Did anyone but `session` change the film after that live version: the
 *  user, another program, another session of the same program, a draft of
 *  another's that the user accepted? */
function changedByOthers(session: string, live: number): boolean {
  if (versionsOf !== projectSession()) agentVersions.clear()
  const after = liveVersions.entriesAfter(live)
  if (!after) return true
  return after.some((e) => agentVersions.get(e.version) !== session)
}

/** A replay's context: the session's own, as `scratch` holds it (a copy the
 *  replay writes to; whoever keeps the replay's result keeps the copy). */
function contextOf(session: string, scratch: Own): ReplayContext {
  const e = storeEnv(true)
  // (The team mode, step 3: the regions the program's workers took.)
  const client = sessions.get(session)?.client
  const regions = client ? regionsFor(client) : []
  return { own: scratch.own, made: scratch.made, moved: scratch.moved, userChangedSince: (live) => changedByOthers(session, live), ...(regions.length ? { regions } : {}), ...(e.measureText ? { extra: { measureText: e.measureText } } : {}) }
}

/** The replay context of a session, on a copy of what it has landed (tests'
 *  driver: replays of the first n ops of a draft, to see the project each op
 *  met; nothing is kept of it). */
export const contextFor = (session: string, client: string): ReplayContext => contextOf(session, copyOf(sessOf(session, client)))

/** A session ended (or its program is gone): what was kept for it goes
 *  (phase 4A.10, drafts#13). `lastOfClient`: no other session of that
 *  program is left, so its kept versions go too. */
export function forgetAgentSession(session: string, client?: string, lastOfClient = false): void {
  if (draft?.session !== session) sessions.delete(session)
  if (client && lastOfClient && draft?.client !== client) clients.delete(client)
}

// ---- the draft -------------------------------------------------------------------

export interface Draft {
  /** Its number among this window's drafts (in its versions' names). */
  id: number
  /** Mixed into the seed of each entry's ids (two drafts never share ids). */
  salt: number
  epoch: string
  session: string
  client: string
  /** The project session (store.projectSession()) it was made in. */
  projectSession: number
  entries: Entry[]
  /** The live project the entries were last replayed on, and what came out. */
  on: Project
  project: Project
  outcomes: Outcome[]
  /** Counts replays and new entries: the draft's version number. */
  version: number
  /** The live film or a track lock changed since the last replay. */
  stale: boolean
  /** How long the last full replay took (ms). */
  lastMs: number
  /** What the draft's own ops wrote and made (the session's landed own, and
   *  the ops of the draft as last replayed): gone with the draft. */
  mine: Own
  /** The last replay failed with an error no one foresaw: the draft is
   *  shown as it last was, can be rejected, and reads go on. */
  broken?: string
  /** Drops the agent has been told ("seq:index" → reason; a range of a cut
   *  left out: "seq:index:rN"). */
  told: Map<string, string>
  news: string[]
  seq: number
  /** Agent access was turned off while it waited (G7): it stays for the
   *  user to accept or reject. */
  disconnected?: boolean
  /** Every op the last replay applied, with the project it met and the one
   *  it left (D22, worker C: the review strip's items). */
  trace: TraceStep[]
  /** What the user decided op by op in the review strip: how many ops they
   *  accepted and rejected, and the lines the agent is told of it. */
  decided: { accepted: number; rejected: number; lines: string[] }
}

let draft: Draft | null = null
let draftSeq = 0
let adopting = false

/** An agent's change is landing on the live project right now (the film's
 *  gate lets it through: components/agent/shown.ts). */
export const adoptingNow = (): boolean => adopting

export const liveToken = (): string => `${useStore.getState().versionEpoch.slice(0, 5)}-${useStore.getState().projectVersion}`
const draftToken = (d: Draft): string => `${d.epoch}-${d.version}`
const locksOf = (p: Project): string => p.tracks.map((t) => `${t.id}:${t.locked ? 1 : 0}`).join(',')
const keyOf = (o: { seq: number; index: number }): string => `${o.seq}:${o.index}`

/** The entries again on the live project as it is now. A replay that fails
 *  with an error no one foresaw leaves the draft as it last was, marked
 *  broken (it can still be read and rejected; the fault is on the console). */
function refresh(d: Draft): void {
  const st = useStore.getState()
  const t0 = performance.now()
  const scratch = copyOf(sessOf(d.session, d.client))
  const trace: TraceStep[] = []
  let r: Replayed
  try {
    r = replay(st.project, d.entries, { ...contextOf(d.session, scratch), trace })
  } catch (e) {
    console.error('agent draft: the replay failed', e)
    d.broken = e instanceof Error ? e.message : String(e)
    d.stale = false
    d.on = st.project
    publish()
    return
  }
  delete d.broken
  d.lastMs = performance.now() - t0
  d.on = st.project
  d.project = r.project
  d.outcomes = r.outcomes
  d.trace = trace
  d.mine = scratch
  d.version++
  d.stale = false
  note(d)
  publish()
}

/** What is not applied of the draft as it stands: every dropped op, and
 *  every range an applied cut left out ("seq:index:rN"), with its sentence. */
function droppedNow(outcomes: readonly Outcome[]): Map<string, { o: Outcome; what: string; why: string; news: string }> {
  const out = new Map<string, { o: Outcome; what: string; why: string; news: string }>()
  // (The news name the call and the op as the agent sent it: T5.)
  const opOf = (o: Outcome): string => `call #${o.seq} op #${(o.sent ?? o.index) + 1} ${o.name}`
  for (const o of outcomes) {
    // (An op the user decided by itself is not a drop.)
    if (o.settled) continue
    if (!o.applied) out.set(keyOf(o), { o, what: `#${o.seq} ${o.name}`, why: o.reason ?? '', news: opOf(o) })
    else {
      for (const i of o.left ?? []) {
        const said = (o.notes ?? []).find((n) => n.startsWith(`range ${i + 1}:`))
        out.set(`${keyOf(o)}:r${i}`, { o, what: `range ${i + 1} of #${o.seq} ${o.name}`, why: said ? said.slice(said.indexOf(':') + 2) : 'not cut', news: `range ${i + 1} of ${opOf(o)}` })
      }
    }
  }
  return out
}

/** News for the agent: what was dropped (or came back) since it was last
 *  told — ops, and single ranges of a cut — grouped by reason, each with its
 *  call number; not one line per op per replay. */
function note(d: Draft): void {
  const now = droppedNow(d.outcomes)
  const groups = new Map<string, string[]>()
  for (const [k, x] of now) {
    if (d.told.has(k)) continue
    groups.set(x.why, [...(groups.get(x.why) ?? []), x.news])
  }
  let back = 0
  for (const k of [...d.told.keys()]) {
    if (now.has(k)) continue
    d.told.delete(k)
    back++
  }
  d.news = d.news.filter((n) => !n.startsWith('dropped ') && !n.startsWith('back in the draft'))
  for (const [why, what] of groups) d.news.push(`dropped ${what.slice(0, 6).join(', ')}${what.length > 6 ? ` +${what.length - 6}` : ''}: ${why}`)
  if (back) d.news.push(`back in the draft: ${back} op${back === 1 ? '' : 's'} or range${back === 1 ? '' : 's'} dropped before (a change was taken back)`)
}

export const currentDraft = (): Draft | null => {
  if (draft && draft.projectSession !== projectSession()) end('discarded: the project it was made on was closed')
  if (draft && (draft.stale || locksOf(useStore.getState().project) !== locksOf(draft.on))) refresh(draft)
  return draft
}

/** The draft as the preview and the card should show it: replayed now when
 *  the live project changed under it (a replay too slow for the timer waits
 *  for this: B7). */
export const freshDraft = (): Draft | null => currentDraft()

export interface View {
  kind: 'draft' | 'live'
  project: Project
  token: string
}

/** What a read shows: the draft (default, when there is one) or the live
 *  project. With `client`, the version is kept for it (an edit may name it). */
export function view(state?: unknown, client?: string): View {
  const d = state === 'live' ? null : currentDraft()
  const st = useStore.getState()
  const v: View = d ? { kind: 'draft', project: d.project, token: draftToken(d) } : { kind: 'live', project: st.project, token: liveToken() }
  if (client) keep(client, v.token, { project: v.project, live: st.projectVersion, draft: d ? d.id : 0, projectSession: projectSession(), ...(d ? { under: d.on, seqs: d.entries.map((e) => e.seq) } : {}) })
  return v
}

/**
 * What changed from a version the client was given to what it sees now (the
 * changes tool): by id. Information for the agent; nothing is decided by it.
 */
export function changesFor(client: string, token: string, state?: unknown): { changes: Changes; to: string } {
  const from = keptOf(client, token, 'since')
  const v = view(state, client)
  // The cut ranges, when only whole-timeline cuts lie between two live versions.
  const st = useStore.getState()
  // (And, to a draft, the draft's own cuts when it only cut, titled and
  // marked: each list in the times the one before left.)
  const shift = from.draft === 0 ? st.shiftTable(from.live) : null
  const d = v.kind === 'draft' ? draft : null
  const plain = !d || d.outcomes.every((o) => !o.applied || o.cuts || o.command === 'text.add' || o.command === 'marker.add' || o.command.startsWith('caption.') || o.command.startsWith('clip.set'))
  const lists = shift && shift.table && plain ? [shift.table.cuts, ...(d ? d.outcomes.filter((o) => o.applied && o.cuts).map((o) => o.cuts!.map(([a, b]) => [a, b] as [number, number])) : [])].filter((l) => l.length) : []
  const merged = lists.length ? cutsOfSegments(segmentsAfterCuts(lists)) : []
  const cuts = merged.length ? merged : undefined
  return { changes: { from: from.live, to: st.projectVersion, ...(cuts ? { cuts } : {}), ...diffProjects(from.project, v.project) }, to: v.token }
}

/** The card's rows of one call: each op, applied or dropped and why. */
function opsOf(d: Draft, e: Entry): DraftOpView[] {
  return d.outcomes
    .filter((o) => o.seq === e.seq)
    .map((o) => {
      const op = e.ops[o.index]
      return {
        index: o.index,
        name: o.name,
        applied: o.applied,
        ...(o.reason ? { reason: o.reason } : {}),
        ...(o.notes?.length ? { notes: o.notes.slice(0, 6) } : {}),
        ...(op?.family === 'cut' && (op.ranges?.length ?? 0) >= 2 ? { ranges: op.ranges!.length } : {}),
        ...(op?.retired && !op.uncaptured && op.settled !== 'accepted' ? { revivable: true } : {})
      }
    })
}

/** A draft time in live seconds: the draft's earlier cuts (live) put back. */
function toLive(t: number, removed: readonly [number, number][]): number {
  let x = t
  for (const [a, b] of removed) {
    if (a <= x + 1e-9) x += b - a
    else break
  }
  return x
}

/** The draft's cuts and added clips in live seconds (the timeline's hatch
 *  and ghosts). Each cut ran on the project as the ops before it left it. */
export function marksOf(d: Pick<Draft, 'outcomes' | 'project' | 'on'>, byOp?: Map<string, [number, number][]>): DraftMarks {
  const removed: [number, number][] = []
  for (const o of d.outcomes) {
    if (!o.applied || !o.cuts?.length) continue
    const live = o.cuts.map(([a, b]): [number, number] => [toLive(a, removed), toLive(b, removed)])
    byOp?.set(keyOf(o), live.map(([a, b]): [number, number] => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]))
    for (const r of live) removed.push(r)
    removed.sort((x, y) => x[0] - y[0])
  }
  // (A piece a cut left of a live clip is not an added clip: same footage,
  // same track.)
  const live = Object.values(d.on.clips)
  const pieceOfLive = (c: Clip): boolean => live.some((l) => l.assetId === c.assetId && l.trackId === c.trackId && c.inPoint >= l.inPoint - 1e-6 && c.inPoint <= l.inPoint + l.duration * (l.speed ?? 1) + 1e-6)
  const ghosts = Object.values(d.project.clips)
    .filter((c) => !d.on.clips[c.id] && !pieceOfLive(c))
    .slice(0, 200)
    .map((c) => ({ id: c.id, trackId: c.trackId, start: toLive(c.start, removed), duration: c.duration, name: d.project.assets.find((a) => a.id === c.assetId)?.name ?? c.id }))
  return { cuts: removed.slice(0, 600).map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]), ghosts }
}

function publish(): void {
  const d = draft
  if (!d) {
    useAgentStore.getState().setDraft(null)
    return
  }
  let cuts = 0
  let seconds = 0
  for (const o of d.outcomes) {
    if (!o.applied || !o.cuts) continue
    cuts += o.cuts.length
    seconds += o.cuts.reduce((n, [a, b]) => n + b - a, 0)
  }
  const liveClips = d.on.clips
  // (A clip "added" is one of new footage: the pieces a cut makes of a clip
  // that was there are not counted: phase 11b, C22.)
  const liveInst = new Set(Object.values(liveClips).map(instanceOf))
  const liveCuts = new Map<string, [number, number][]>()
  const marks = marksOf(d, liveCuts)
  let changes: DraftChange[] = []
  try {
    changes = draftChanges(d.on, d.project, marks.cuts)
  } catch {
    /* the strip still has the items */
  }
  // (D22, worker C: one item per op that is applied now, in the order sent.)
  const steps = new Map(d.trace.map((x) => [`${x.seq}:${x.index}`, x]))
  // (The worker of each call, when the agent named its workers: EKIP-PLAN.md.)
  const asOf = new Map(d.entries.filter((e) => e.as).map((e) => [e.seq, e.as!]))
  const team = (seq: number, reason: string): { as?: string; after?: string } => {
    if (!asOf.size) return {}
    const as = asOf.get(seq)
    const after = collidedAfter(reason, as, callsMoving(d).filter((c) => c.seq < seq), d.entries.find((e) => e.seq === seq)?.on)
    return { ...(as ? { as } : {}), ...(after !== undefined ? { after } : {}) }
  }
  const items: ReviewItem[] = d.outcomes.flatMap((o) => {
    const step = o.applied ? steps.get(keyOf(o)) : undefined
    if (!step) return []
    const op = d.entries.find((e) => e.seq === o.seq)?.ops[o.index]
    const sent = op?.family === 'cut' && (op.ranges?.length ?? 0) >= 2 && Array.isArray(op.params.ranges) ? (op.params.ranges as unknown[]).filter((r): r is [number, number] => Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'number') : []
    const as = asOf.get(o.seq)
    return [{ ...itemOf(step, o.command, o.cuts ?? [], liveCuts.get(keyOf(o))), ...(sent.length >= 2 ? { ranges: sent.map(([a, b]): [number, number] => [a, b]) } : {}), ...(as ? { as } : {}) }]
  })
  const view: DraftView = {
    id: d.id,
    session: d.session,
    client: d.client,
    calls: d.entries.map((e) => ({ seq: e.seq, label: e.label, at: e.at, ops: opsOf(d, e), ...(e.as ? { as: e.as } : {}) })),
    marks,
    // (DENEME-2: what the draft does in the user's words, and the lengths.)
    changes,
    lengths: { live: projectDuration(d.on), draft: projectDuration(d.project) },
    items,
    project: d.project,
    on: d.on,
    summary: { calls: d.entries.length, cuts, seconds: Math.round(seconds * 100) / 100, addedClips: Object.values(d.project.clips).filter((c) => !liveClips[c.id] && !liveInst.has(instanceOf(c))).length, dropped: d.outcomes.filter((o) => !o.applied && !o.settled).length, moved: changes.filter((c) => c.kind === 'move' || c.kind === 'track').length },
    // (Every dropped op, and every range a cut left out; then what the user
    // rejected by itself: it can be brought back.)
    dropped: [
      ...[...droppedNow(d.outcomes)].map(([k, x]) => {
        const op = d.entries.find((e) => e.seq === x.o.seq)?.ops[x.o.index]
        return { seq: x.o.seq, index: x.o.index, label: x.o.applied ? `${x.o.name}, range ${Number(k.split(':r')[1]) + 1}` : x.o.name, command: x.o.command, reason: x.why, ...(!x.o.applied && op?.retired && !op.uncaptured ? { revivable: true } : {}), ...team(x.o.seq, x.why) }
      }),
      ...d.outcomes.filter((o) => o.settled === 'rejected').map((o) => ({ seq: o.seq, index: o.index, label: o.name, command: o.command, reason: o.reason ?? '', rejected: true, revivable: true, ...team(o.seq, '') }))
    ],
    decided: { accepted: d.decided.accepted, rejected: d.decided.rejected },
    version: draftToken(d),
    ...(d.disconnected ? { disconnected: true } : {}),
    // (The live project changed and the draft was not replayed on it yet:
    // what is shown is the draft as it was, not as it is.)
    ...(d.stale ? { updating: true } : {}),
    ...(d.broken ? { broken: d.broken } : {})
  }
  useAgentStore.getState().setDraft(view)
  const st = useStore.getState()
  candidate.set(d.project, { baseVersion: st.projectVersion, epoch: st.versionEpoch, session: d.projectSession })
}

/** Makes a new edit's entry on `head` and applies it there (replay.ts enter). */
export type Build = (head: Project, seq: number, seed: number, ctx: ReplayContext) => Replayed & { entry: Entry }

export interface Added {
  entry: Entry
  outcomes: Outcome[]
  /** A draft was started by this entry. */
  created: boolean
  /** The session took over the draft of one that is gone. */
  took?: boolean
}

/**
 * One edit call into the draft (made when there is none). `build` makes the
 * entry on the draft's project as it is (the ops' intents may need it).
 * Throws when another session's draft waits. An entry of which no op could
 * be applied is not kept (its outcomes say why).
 */
/** Would addToDraft refuse this session (another session's draft waits)?
 *  Asked before anything is written for the edit: a refused edit leaves no
 *  restore point behind (D9). Throws with the refusal. */
export function mayAdd(session: string, client: string, alive?: (session: string) => boolean): void {
  const d = currentDraft()
  if (d && d.session !== session && !(d.client === client && alive && !alive(d.session))) throw new Error(`another agent session (${d.client}) has a draft waiting: the user must accept or reject the waiting draft first`)
}

export function addToDraft(session: string, client: string, build: Build, alive?: (session: string) => boolean, guard?: () => void): Added {
  let d = currentDraft()
  let took = false
  if (d && d.session !== session) {
    if (d.client === client && alive && !alive(d.session)) {
      // (The session that reconnects takes over the DRAFT of the one that is
      // gone, and nothing else: what that one landed — its versions, its own
      // writes and what it made — stays someone else's (phase 4A.11, K3). A
      // second window of the same program is another session.)
      sessions.delete(d.session)
      d.session = session
      d.disconnected = false
      took = true
      // (Its ops are replayed as this session's: what the gone one landed is
      // not this one's own.)
      refresh(d)
    } else throw new Error(`another agent session (${d.client}) has a draft waiting: the user must accept or reject the waiting draft first`)
  }
  const st = useStore.getState()
  const created = !d
  if (!d) {
    const id = ++draftSeq
    // (Its own salt for the ids its ops make: from the id seam, not from the
    // window's count of drafts, so a test's run is the same run again.)
    const mark = seams.newId().replace(/[^0-9a-z]/gi, '')
    let salt = 0x811c9dc5
    for (let i = 0; i < mark.length; i++) salt = Math.imul(salt ^ mark.charCodeAt(i), 0x01000193)
    d = { id, salt, epoch: `d${id.toString(36)}x${mark.slice(-3)}`, session, client, projectSession: projectSession(), entries: [], on: st.project, project: st.project, outcomes: [], version: 0, stale: false, lastMs: 0, mine: copyOf(sessOf(session, client)), told: new Map(), news: [], seq: 0, trace: [], decided: { accepted: 0, rejected: 0, lines: [] } }
  }
  const seq = d.seq + 1
  // (The seed of an entry's ids: its place in its draft, and which draft.)
  // The entry is made on a copy of what is the draft's own: kept only when
  // the entry is.
  const scratch = copyOf(d.mine)
  const trace: TraceStep[] = []
  const r = build(d.project, seq, (seams.entrySeed(seq) ^ d.salt) | 0, { ...contextOf(session, scratch), live: st.project, trace })
  // (The server gave up on the call while the entry was being made: nothing
  // of it is kept — safety#4.)
  guard?.()
  const entry = r.entry
  if (!r.outcomes.some((o) => o.applied)) return { entry, outcomes: r.outcomes, created: false, ...(took ? { took } : {}) }
  d.mine = scratch
  // A drop the agent was told of does not come back by itself once it has
  // sent a later edit (it may have sent the same thing again: B11).
  for (const o of d.outcomes) {
    if (o.applied || !d.told.has(keyOf(o))) continue
    const op = d.entries.find((e) => e.seq === o.seq)?.ops[o.index]
    if (op && !op.retired) op.retired = `${o.reason} (dropped before your later edit; the user can bring it back)`
  }
  d.seq = seq
  d.entries.push(entry)
  d.project = r.project
  d.outcomes = [...d.outcomes, ...r.outcomes]
  d.trace = [...d.trace, ...trace]
  d.version++
  for (const [k, x] of droppedNow(r.outcomes)) d.told.set(k, x.why)
  draft = d
  publish()
  return { entry, outcomes: r.outcomes, created, ...(took ? { took } : {}) }
}

/** An edit straight onto the timeline (the user's "apply directly"): the
 *  same replay, adopted at once as one undo step. */
export function applyDirect(session: string, client: string, build: Build, guard?: () => void): { outcomes: Outcome[]; applied: boolean; entry?: Entry } {
  const st = useStore.getState()
  const me = sessOf(session, client)
  const scratch = copyOf(me)
  // (The seed: this session's count of such edits, not the version number,
  // which a test's second run of the same steps does not start at again.)
  // (And which session: two sessions' n-th edits make different ids.)
  let salt = 0x5bd1e995
  for (let i = 0; i < session.length; i++) salt = Math.imul(salt ^ session.charCodeAt(i), 0x01000193)
  const r = build(st.project, 1, (seams.entrySeed(++me.direct) ^ salt) | 0, contextOf(session, scratch))
  guard?.()
  if (!r.outcomes.some((o) => o.applied)) return { outcomes: r.outcomes, applied: false }
  land(r.project, r.outcomes, session)
  // (What landed is the session's own from here on.)
  me.own = scratch.own
  me.made = scratch.made
  me.moved = scratch.moved
  return { outcomes: r.outcomes, applied: true, entry: r.entry }
}

/** An agent's change lands on the live project: one undo step, a version of
 *  that SESSION's making (to everyone else, a change they did not make). */
function land(project: Project, outcomes: readonly Outcome[], session: string): number {
  const st = useStore.getState()
  const applied = outcomes.filter((o) => o.applied)
  const cuts = applied.length > 0 && applied.every((o) => o.cuts) ? applied.map((o) => o.cuts!.map(([a, b]) => [a, b] as [number, number])) : undefined
  adopting = true
  let v: number
  try {
    landing.before()
    v = st.adoptCandidate(project, { baseVersion: st.projectVersion, epoch: st.versionEpoch, ...(cuts ? { cuts } : {}) })
  } finally {
    adopting = false
  }
  if (versionsOf !== projectSession()) {
    agentVersions.clear()
    versionsOf = projectSession()
  }
  agentVersions.set(v, session)
  if (agentVersions.size > 4000) for (const k of [...agentVersions.keys()].slice(0, 2000)) agentVersions.delete(k)
  landing.after()
  return v
}

// ---- the live project changed under the draft ------------------------------

let timer: (() => void) | null = null
/** A replay slower than this is not run on the timer while the user edits:
 *  only when the agent reads, on accept, and for the preview (B7). */
export const REPLAY_ON_TIMER_MS = 100

/** Watches the live project: when its film or a track's lock changes, the
 *  draft is replayed on it (soon, not per frame of a drag; at once when the
 *  agent next reads). Notes, a row's height and the name do not. */
export function watchLive(): () => void {
  return useStore.subscribe((s, prev) => {
    if (!draft || adopting) return
    if (projectSession() !== draft.projectSession) {
      end('discarded: the project it was made on was closed')
      return
    }
    const locks = s.project !== prev.project && locksOf(s.project) !== locksOf(draft.on)
    if (!locks && s.projectVersion === prev.projectVersion) return
    draft.stale = true
    // (Until it is replayed, what the preview and the card show is the draft
    // as it WAS: said so — drafts#12.)
    const shown = useAgentStore.getState().draft
    if (shown && !shown.updating) useAgentStore.getState().setDraft({ ...shown, updating: true })
    timer?.()
    timer = seams.schedule(() => {
      timer = null
      // (A fault in a replay is the draft's "broken", never an uncaught
      // error of the timer: refresh keeps it.)
      if (draft?.stale && draft.lastMs <= REPLAY_ON_TIMER_MS) refresh(draft)
    }, 400)
  })
}

/** Tells the session's agent what happened to its draft since it last asked. */
export function takeNews(session: string): string[] {
  const out: string[] = []
  if (draft?.session === session && draft.news.length) {
    out.push(...draft.news.splice(0))
    for (const [k, x] of droppedNow(draft.outcomes)) draft.told.set(k, x.why)
  }
  const mine = endedNews.get(session)
  if (mine?.length) out.push(...mine.splice(0))
  if (mine && mine.length === 0) endedNews.delete(session)
  return out
}
const endedNews = new Map<string, string[]>()

/** A session ended or was forgotten (G9): its untold news go with it. */
export function forgetSessionNews(session: string): void {
  endedNews.delete(session)
}

function end(why: string | null, news: string[] = [], first?: string): void {
  const d = draft
  if (!d) return
  draft = null
  timer?.()
  timer = null
  if (why) {
    dead.set(d.id, why)
    while (dead.size > 64) dead.delete(dead.keys().next().value as number)
  }
  // (Ended without becoming the live project: restore.ts lets a point
  // before the agent go that no agent change ever followed.)
  if (why) for (const h of endHooks) h()
  const list = endedNews.get(d.session) ?? []
  list.push(first ?? (why ? `your draft was ${why}` : 'the user accepted your draft: it is the live project now'), ...news)
  endedNews.set(d.session, list)
  // Only the last few sessions' untold news are kept.
  while (endedNews.size > 32) endedNews.delete(endedNews.keys().next().value as string)
  candidate.clear()
  publish()
}

// ---- the user's decision ----------------------------------------------------

export interface AcceptPlan {
  /** The entries of which something will be applied (seq and label). */
  apply: { seq: number; label: string }[]
  /** Every op that will not be applied, and why (a range a cut leaves out:
   *  a row of its own). Ops dropped for good because the agent sent them
   *  again are not listed one by one: `replaced` counts them. */
  drop: { seq: number; index: number; label: string; reason: string }[]
  replaced: number
  project: Project
  outcomes: Outcome[]
  /** Everything of the draft will be applied. */
  all: boolean
  /** What the card shows: the live version, the track locks (a lock is no
   *  version, but it changes what a cut does) and which ops apply. Accepting
   *  carries these: the user gets what they saw, or nothing (S12). */
  shown: { live: number; signature: string; locks: string }
  /** What the session's own is when this is adopted. */
  mine: Own
}

const signatureOf = (outcomes: readonly Outcome[]): string => outcomes.map((o) => `${keyOf(o)}${o.applied ? '+' : '-'}${o.cuts ? o.cuts.length : ''}${o.left?.length ? `/${o.left.join(',')}` : ''}`).join(' ')

/** The op "seq:index" of the draft. */
const opAt = (d: Draft, key: string): Op | undefined => {
  const [seq, index] = key.split(':').map(Number)
  return d.entries.find((e) => e.seq === seq)?.ops[index]
}

function selection(d: Draft, seqs?: readonly number[], ops?: readonly string[]): Entry[] {
  if (ops) {
    // Chosen op by op (D22, worker C): the entries that hold a chosen op,
    // their other ops left out for this replay. Every op keeps its place
    // (and so its seed and the ids it makes).
    const set = new Set(ops)
    const unknown = ops.filter((k) => !opAt(d, k))
    if (unknown.length) throw new Error(`The draft has no op ${unknown.join(', ')}.`)
    return d.entries
      .filter((e) => e.ops.some((_, i) => set.has(`${e.seq}:${i}`)))
      .map((e) => ({ ...e, ops: e.ops.map((op, i) => (set.has(`${e.seq}:${i}`) || op.retired ? op : { ...op, retired: 'not selected' })) }))
  }
  if (!seqs) return d.entries
  const set = new Set(seqs)
  const known = new Set(d.entries.map((e) => e.seq))
  const unknown = [...set].filter((s) => !known.has(s))
  if (unknown.length) throw new Error(`The draft has no call ${unknown.map((s) => `#${s}`).join(', ')} (it has ${[...known].map((s) => `#${s}`).join(', ')}).`)
  return d.entries.filter((e) => set.has(e.seq))
}

/**
 * What accepting would do, without doing it (the 4B card's "what will be
 * applied, what dropped and why"): the chosen entries replayed on the live
 * project. An op that leans on an entry not chosen drops by itself.
 */
export function acceptPreview(seqs?: readonly number[], ops?: readonly string[]): AcceptPlan {
  const d = currentDraft()
  if (!d) throw new Error('There is no draft.')
  const st = useStore.getState()
  const chosen = selection(d, seqs, ops)
  const whole = !ops && chosen.length === d.entries.length
  const reuse = whole && d.on === st.project && !d.broken
  const scratch = reuse ? d.mine : copyOf(sessOf(d.session, d.client))
  const r0 = reuse ? { project: d.project, outcomes: d.outcomes } : replay(st.project, chosen, contextOf(d.session, scratch))
  // (T7: an op of an accepted call that drops because a call it was written
  // on is not accepted says so.)
  const r = { project: r0.project, outcomes: seqs && !ops ? r0.outcomes.map((o) => {
    const on = d.entries.find((e) => e.seq === o.seq)?.on ?? []
    const gone = on.find((s) => !chosen.some((e) => e.seq === s) && d.entries.some((e) => e.seq === s))
    return !o.applied && gone !== undefined && !o.reason?.startsWith('call #') ? { ...o, reason: `call #${gone}, which it was written on, was not accepted: resend if still wanted (${o.reason ?? 'dropped'})` } : o
  }) : r0.outcomes }
  const label = new Map(d.entries.map((e) => [e.seq, e.label]))
  // (An op the agent sent again after it was told of the drop is not shown
  // as a drop of its own: the copy that replaced it speaks for it.)
  const opOf = (o: Outcome): Op | undefined => d.entries.find((e) => e.seq === o.seq)?.ops[o.index]
  const replaced = r.outcomes.filter((o) => !o.applied && !!opOf(o)?.retired?.includes('dropped before your later edit')).length
  const drop = [
    ...[...droppedNow(r.outcomes).values()].filter((x) => x.o.applied || !opOf(x.o)?.retired?.includes('dropped before your later edit')).map((x) => ({ seq: x.o.seq, index: x.o.index, label: x.o.applied ? x.what.replace(/ of #\d+/, ' of') : x.o.name, reason: x.why })),
    ...d.entries.filter((e) => !chosen.some((c) => c.seq === e.seq)).map((e) => ({ seq: e.seq, index: -1, label: e.label, reason: 'not selected' }))
  ].sort((a, b) => a.seq - b.seq || a.index - b.index)
  const applied = new Set(r.outcomes.filter((o) => o.applied).map((o) => o.seq))
  return {
    apply: [...applied].map((seq) => ({ seq, label: label.get(seq) ?? '' })),
    drop,
    replaced,
    project: r.project,
    outcomes: r.outcomes,
    all: whole && r.outcomes.every((o) => o.settled || (o.applied && !o.left?.length)),
    shown: { live: st.projectVersion, signature: signatureOf(r.outcomes), locks: locksOf(st.project) },
    mine: scratch
  }
}

/**
 * What accepting these ops by themselves would do to the REST of the draft
 * (D22, worker C): the ops that are applied now and would not be any more —
 * an op that moves things is held to the very project it was written on, so
 * landing another op first ends it. The review strip does not accept one
 * item when that would silently cost another: the user decides that one
 * first. Nothing is changed by asking (the rest is replayed on copies).
 */
export function acceptWould(ops: readonly string[]): { plan: AcceptPlan; lost: string[] } {
  const plan = acceptPreview(undefined, ops)
  const d = draft
  if (!d) return { plan, lost: [] }
  const chosen = new Set(ops)
  const now = new Set(d.outcomes.filter((o) => o.applied).map(keyOf))
  // The rest, as it would be replayed after the accept: the chosen ops
  // decided, every other op a copy (a replay writes what it met on an op).
  const rest: Entry[] = d.entries.map((e) => ({ ...e, ops: e.ops.map((op, i) => (chosen.has(`${e.seq}:${i}`) ? { ...op, retired: 'accepted by the user: it is in the live project', settled: 'accepted' as const } : { ...op, ...(op.ranges ? { ranges: op.ranges.map((r) => ({ ...r })) } : {}) })) }))
  let after: Outcome[]
  try {
    after = replay(plan.project, rest, { ...contextOf(d.session, copyOf(plan.mine)), live: plan.project }).outcomes
  } catch {
    return { plan, lost: [] }
  }
  const still = new Set(after.filter((o) => o.applied).map(keyOf))
  return { plan, lost: [...now].filter((k) => !chosen.has(k) && !still.has(k)) }
}

export interface AcceptOutcome {
  /** The new live version; null when nothing was adopted (nothing left to
   *  accept, or the project changed since the card was shown). */
  version: number | null
  /** The ops applied ("seq:index"). */
  applied: string[]
  dropped: AcceptPlan['drop']
  /** The project or the outcome is not what `shown` said: look again. */
  changed?: boolean
  /** What became of every op of the chosen entries. */
  outcomes?: Outcome[]
  /** Accepted op by op, and nothing of the draft waits any more: how it
   *  ended (what the agent is answered). */
  ended?: 'accepted' | 'partial' | 'rejected'
}

/** Who wants to know when an agent's change lands on the live project (the
 *  restore points: restore.ts), right before and right after. */
const adoptHooks: { before: () => void; after: () => void }[] = []
export function onAdopt(h: { before: () => void; after: () => void }): () => void {
  adoptHooks.push(h)
  return () => void adoptHooks.splice(adoptHooks.indexOf(h), 1)
}
const endHooks: (() => void)[] = []
/** Called when a draft ends without being adopted (rejected, dropped). */
export function onDraftGone(h: () => void): () => void {
  endHooks.push(h)
  return () => void endHooks.splice(endHooks.indexOf(h), 1)
}
export const landing = {
  before: (): void => adoptHooks.forEach((h) => h.before()),
  after: (): void => adoptHooks.forEach((h) => h.after())
}

/**
 * All of the draft, or the chosen entries, as ONE undo step — and always
 * "what you see is what you accept" (S12; phase 4A.10, B1): `shown` is what
 * acceptPreview gave the card (the live version, the locks, which ops and
 * ranges apply). When the project or the outcome is no longer that, nothing
 * is adopted and the card is to be drawn again. A caller with no card (a
 * test, a script) says 'now': the preview made at this very moment.
 * The entries not chosen stay as the draft.
 */
export function acceptDraft(seqs: readonly number[] | undefined, shown: AcceptPlan['shown'] | 'now', ops?: readonly string[]): AcceptOutcome {
  const d = currentDraft()
  if (!d) throw new Error('There is no draft.')
  if (d.broken) throw new Error(`The draft could not be worked out on the project as it is (${d.broken}): it can be rejected, not accepted.`)
  const plan = acceptPreview(seqs, ops)
  const store = useAgentStore.getState()
  if (shown !== 'now' && (shown.live !== plan.shown.live || shown.signature !== plan.shown.signature || shown.locks !== plan.shown.locks)) {
    store.setOutcome({ kind: 'changed', dropped: plan.drop, at: seams.now() })
    return { version: null, applied: [], dropped: plan.drop, changed: true }
  }
  const lost = plan.drop.filter((x) => x.reason !== 'not selected')
  // Nothing survives — or nothing but tracks with nothing on them (what was
  // to go on them was dropped): nothing is adopted; the agent and the user
  // are told.
  const kept = plan.outcomes.filter((o) => o.applied)
  const hollow = kept.length > 0 && kept.every((o) => o.command === 'track.add') && lost.length > 0
  if (!kept.length || hollow) {
    for (const x of lost) d.news.push(`accept: ${x.label} (#${x.seq}) would be dropped: ${x.reason}`)
    if (hollow) d.news.push('accept: only empty tracks would be left of the draft: nothing was adopted')
    store.setOutcome({ kind: 'nothing', dropped: plan.drop, at: seams.now() })
    return { version: null, applied: [], dropped: plan.drop }
  }
  const v = land(plan.project, plan.outcomes, d.session)
  // (What landed is the session's own from here on.)
  const me = sessOf(d.session, d.client)
  me.own = plan.mine.own
  me.made = plan.mine.made
  me.moved = plan.mine.moved
  const applied = plan.outcomes.filter((o) => o.applied).map(keyOf)
  if (ops) {
    // Op by op (D22, worker C): the chosen ops are decided — what applied is
    // in the live project, what dropped at the accept is told — and stay in
    // their entries, retired; the other ops still wait.
    const told: string[] = []
    for (const k of ops) {
      const op = opAt(d, k)
      if (!op) continue
      const [seq, index] = k.split(':').map(Number)
      const landed = applied.includes(k)
      op.retired = landed ? 'accepted by the user: it is in the live project' : 'dropped when the user accepted it'
      op.settled = 'accepted'
      d.told.delete(k)
      if (landed) d.decided.accepted++
      told.push(landed ? `the user accepted call #${seq} op #${(op.sent ?? index) + 1} ${op.name}: it is in the live project now` : `call #${seq} op #${(op.sent ?? index) + 1} ${op.name} was dropped when the user accepted it: ${lost.find((x) => x.seq === seq && x.index === index)?.reason ?? 'not applied'}`)
    }
    d.decided.lines.push(...told)
    store.setOutcome({ kind: 'partial', dropped: plan.drop, at: seams.now() })
    const how = settle(d, told)
    return { version: v, applied, dropped: plan.drop, outcomes: plan.outcomes, ...(how ? { ended: how } : {}) }
  }
  const chosen = new Set(plan.outcomes.map((o) => o.seq))
  const rejectedBefore = d.decided.rejected > 0
  const rest = d.entries.filter((e) => !chosen.has(e.seq))
  // (Told once, in words the draft's own news do not wipe: what of the
  // accepted calls did NOT land.)
  const said = lost.map((x) => `accept: ${x.label} (#${x.seq}) was dropped at the accept: ${x.reason}`)
  if (rest.length === 0) end(null, [...d.decided.lines, ...said])
  else {
    // The part not chosen still waits, on the project as it is now. What the
    // agent was told of it stays told (B11 holds across a partial accept).
    d.entries = rest
    for (const k of [...d.told.keys()]) if (chosen.has(Number(k.split(':')[0]))) d.told.delete(k)
    d.news.push(`the user accepted calls ${[...chosen].map((s) => `#${s}`).join(', ')}: ${lost.length ? 'what was not dropped of them is' : 'they are'} in the live project now; ${rest.map((e) => `#${e.seq}`).join(', ')} still wait${rest.length === 1 ? 's' : ''}`, ...said)
    refresh(d)
  }
  // (Part of it was rejected item by item before: accepted "in part".)
  store.setOutcome({ kind: plan.all && !rejectedBefore ? 'accepted' : 'partial', dropped: plan.drop, at: seams.now() })
  return { version: v, applied, dropped: plan.drop, outcomes: plan.outcomes }
}

/**
 * After the user decided an op by itself: the entries with nothing left to
 * decide go, the rest is replayed on the project as it is now. When no op
 * that waits is applied any more, the draft ends: accepted (every decision
 * was an accept), rejected (none was), or in part. Answers how it ended, or
 * null while something still waits.
 */
function settle(d: Draft, told: string[]): 'accepted' | 'partial' | 'rejected' | null {
  d.entries = d.entries.filter((e) => e.ops.some((op) => !op.settled))
  d.news.push(...told)
  if (d.entries.length) refresh(d)
  if (d.entries.length && d.outcomes.some((o) => o.applied)) return null
  const { accepted, rejected, lines } = d.decided
  const how = accepted === 0 ? 'rejected' : rejected === 0 && !d.outcomes.some((o) => !o.applied && !o.settled) ? 'accepted' : 'partial'
  const left = d.outcomes.filter((o) => !o.applied && !o.settled).map((o) => `call #${o.seq} op #${(o.sent ?? o.index) + 1} ${o.name} was not applied: ${o.reason ?? 'dropped'}`)
  if (how === 'rejected') end('rejected', left)
  else end(null, [...lines, ...left], how === 'accepted' ? undefined : 'the user went through your draft op by op; nothing of it waits any more')
  return how
}

/**
 * The user rejects ONE op of the draft in the review strip (D22, worker C):
 * it leaves the draft (the user can bring it back while the draft waits),
 * the rest is replayed without it — an op that leaned on it drops by itself
 * and says so. Answers how the draft ended when nothing waits any more.
 */
export function rejectOp(seq: number, index: number): { done: boolean; ended?: 'accepted' | 'partial' | 'rejected' } {
  return rejectOps([{ seq, index }])
}

/** Several ops rejected at once (a worker's group: EKIP-PLAN.md): one
 *  replay, one answer to the agent when nothing waits any more. */
export function rejectOps(keys: readonly { seq: number; index: number }[]): { done: boolean; ended?: 'accepted' | 'partial' | 'rejected' } {
  const d = currentDraft()
  if (!d) return { done: false }
  const lines: string[] = []
  for (const { seq, index } of keys) {
    const op = d.entries.find((e) => e.seq === seq)?.ops[index]
    if (!op || op.settled) continue
    op.retired = 'rejected by the user'
    op.settled = 'rejected'
    d.told.delete(`${seq}:${index}`)
    d.decided.rejected++
    lines.push(`the user rejected call #${seq} op #${(op.sent ?? index) + 1} ${op.name}: it is out of the draft`)
  }
  if (!lines.length) return { done: false }
  d.decided.lines.push(...lines)
  const how = settle(d, lines)
  if (how) useAgentStore.getState().setOutcome({ kind: how === 'rejected' ? 'rejected' : 'partial', dropped: [], at: seams.now() })
  return { done: true, ...(how ? { ended: how } : {}) }
}

/** The user takes one range out of a cut of the draft (the others stay). */
export function removeRange(seq: number, index: number, range: number): boolean {
  const d = currentDraft()
  const op = d?.entries.find((e) => e.seq === seq)?.ops[index]
  if (!d || !op || op.family !== 'cut' || !op.ranges || op.ranges.length < 2 || range < 0 || range >= op.ranges.length) return false
  op.ranges = op.ranges.filter((_, i) => i !== range)
  op.params = { ...op.params, ranges: (op.params.ranges as unknown[]).filter((_, i) => i !== range) }
  d.news.push(`the user took range ${range + 1} out of ${op.from ? `apply ${op.from}` : op.name} (#${seq})`)
  refresh(d)
  return true
}

/** The user brings back an op that was dropped for good (B11). */
export function reviveOp(seq: number, index: number): boolean {
  const d = currentDraft()
  const op = d?.entries.find((e) => e.seq === seq)?.ops[index]
  // (An op that could not be read at all — it named something that was not
  // there — is nothing to bring back: drafts#10.)
  if (!d || !op?.retired || op.uncaptured || op.settled === 'accepted') return false
  // (One the user rejected by itself comes back as it was.)
  if (op.settled === 'rejected') {
    d.decided.rejected = Math.max(0, d.decided.rejected - 1)
    const line = `the user brought call #${seq} op #${(op.sent ?? index) + 1} ${op.name} back into the draft`
    d.decided.lines.push(line)
    d.news.push(line)
  }
  delete op.settled
  delete op.retired
  refresh(d)
  return true
}

export function rejectDraft(): void {
  // (Not replayed first: a draft whose replay fails can still be rejected.)
  if (draft && draft.projectSession !== projectSession()) end('discarded: the project it was made on was closed')
  if (!draft) return
  // (What the user accepted or rejected of it one by one before: told with it.)
  end('rejected', draft.decided.lines)
  useAgentStore.getState().setOutcome({ kind: 'rejected', dropped: [], at: seams.now() })
}

/** Ended by a restore to the point before the agent. */
export const dropDraft = (why: string): void => end(why)

/** Agent access was turned off (G7): the waiting draft stays for the user,
 *  marked so. */
export function markDisconnected(): void {
  if (!draft) return
  draft.disconnected = true
  publish()
}

/** For tests and phase 4B: the draft's own record (not replayed first). */
export const draftState = (): Draft | null => draft

/** A session moved to another project: what it wrote in the one before is
 *  not "its own" here. (Its program's kept versions of that project go with
 *  the next read; naming one is refused plainly.) */
export function forgetOwnWrites(session: string): void {
  sessions.delete(session)
}
