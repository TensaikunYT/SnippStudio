// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The point before the agent (SnippStudio phase 4A, ANA-PLAN.md §3; reworked
// in phase 4A.8, FAZ4A-DUZELTME.md C, and in 4A.9, FAZ4A-YENIDEN.md B): the
// project as it was right before the agent's first change is written to the
// profile (agent-restore\) and kept apart from the rolling points; one call
// puts it back — as one undo step, so even that can be undone — and the
// project then is, byte for byte, the file that was written.
//
// - A point belongs to a PROJECT: its key finds it (a saved project's file
//   path, the same after it is opened again or the app is started again;
//   unsaved, this run's project session), and its identity (Project.uid,
//   kept in the file, in the point's name) says it is this project's (phase
//   4A.10, E1: a file saved over another path is not that path's old
//   project). Another project's point is not listed and not applied. A
//   project saved under another path (Save As, a rename, also of a closed
//   project) takes its points with it; the points the overwritten file had
//   there become session points first.
// - "Before the agent": per project, the state right before the agent's
//   first change that lands (a direct edit, or the accept of a draft). It
//   STAYS that point until the user goes back to it: opening the file again
//   or starting the app again does not write another over it (4A.9,
//   V-restore-transcribe-1: the only copy of the project before the agent
//   was deleted by the agent's next change after a reopen). Going back to it
//   ends the period; the agent's next change then writes a new one.
// - Session points: a session's first edit writes one only when the live
//   project changed since the last point for a reason that is not the agent's.
// - An unsaved project's points live while it is open; opening another
//   project lets them go (the files are cleared with the others).
// - Written atomically under a unique name; a point that cannot be written
//   refuses the edit ("could not write the restore point").
import type { Project } from '../types'
import { api } from '../platform'
import { projectSession, useStore } from '../state/store'
import { carryMedia } from '../state/history'
import { readProjectFile, serializeProject } from '../media/projectio'
import { getProjectKeyPath, onProjectMoved, onProjectSaved, takeOpenedFile } from '../media/projectio'
import { acceptDraft, dropDraft, onAdopt, onDraftGone, type AcceptOutcome, type AcceptPlan } from './drafts'

export type PointKind = 'pre' | 'pt'

export interface RestorePoint {
  name: string
  at: number
  session: string
  kind: PointKind
  /** The project it belongs to: the key written into its name (its file
   *  path, or the unsaved project of this run). */
  key: string
  /** The project itself and its file text: there while this window made or
   *  read the point; a point of an earlier run is read when it is needed. */
  project?: Project
  json?: string
}

/** Session points kept per project (besides its point before the agent). */
export const SESSION_POINTS = 5

/** The profile's files, as the page reaches them (a test puts its own). */
export interface RestoreIo {
  write?: (json: string, label: string) => Promise<{ name: string; over?: number } | null>
  read?: (name: string) => Promise<{ json: string } | null>
  list?: () => Promise<{ name: string }[]>
  /** `copy`: a Save As (the points are copied, the file saved from keeps
   *  its own: phase 4A.11, P2); else a rename (moved). */
  rekey?: (from: string, to: string, copy?: boolean) => Promise<Record<string, string>>
  demote?: (name: string) => Promise<string | null>
  /** The app saved the file of `key` with save id `id` (P3). */
  saved?: (key: string, id: string) => Promise<unknown>
  /** The file of `key` was opened holding save id `id`; its points before
   *  the agent that became session points (another id was known: the file
   *  was changed outside the app), new names by old (P3). */
  opened?: (key: string, id: string) => Promise<Record<string, string>>
}
const DEFAULT_IO = (): RestoreIo => ({
  write: api?.agent.restoreWrite,
  read: api?.agent.restoreRead,
  list: api?.agent.restoreList,
  rekey: api?.agent.restoreRekey,
  demote: api?.agent.restoreDemote,
  saved: api?.agent.restoreSaved,
  opened: api?.agent.restoreOpened
})
let io: RestoreIo = DEFAULT_IO()
/** Replaces the file access (tests); returns the function that puts the
 *  app's back. Forgets what is in memory, as a new window would. */
export function setRestoreIo(next: RestoreIo): () => void {
  io = next
  forgetAllPoints()
  return () => {
    io = DEFAULT_IO()
    forgetAllPoints()
  }
}

/** What the user is told about the points (the app shows it: host.ts). */
export type RestoreNotice = { key: 'agent.restoreFailed' } | { key: 'agent.restoreFull'; params: { count: number } }
const noticeFns: ((n: RestoreNotice) => void)[] = []
export function onRestoreNotice(fn: (n: RestoreNotice) => void): () => void {
  noticeFns.push(fn)
  return () => void noticeFns.splice(noticeFns.indexOf(fn), 1)
}
const tell = (n: RestoreNotice): void => noticeFns.forEach((fn) => fn(n))
/** How far over the cap the folder was when the user was last told (told
 *  once per growth, not at every write). */
let toldOver = 0

const points: RestorePoint[] = []
/** Which project session each agent session has its point on (D9). */
const madeFor = new Map<string, number>()
/** By project key: the point before the agent of the period that is open,
 *  and whether an agent change landed in it yet. */
const periods = new Map<string, { pre: RestorePoint; landed: boolean }>()
/** By project key: the point before the agent the user last went back to
 *  (the default to go back to until a new period has its own). */
const wentBackTo = new Map<string, RestorePoint>()
/** The project open now, as this file last saw it. */
let open: { ps: number; key: string } | null = null
/** A rename of points on disk that is under way. */
let renaming: Promise<unknown> = Promise.resolve()
/** The live project right after the agent's last change that landed (and
 *  its file text, made when first needed). */
let lastAgent: { projectSession: number; project: Project; text?: string } | null = null

function forgetAllPoints(): void {
  points.length = 0
  madeFor.clear()
  periods.clear()
  wentBackTo.clear()
  open = null
  lastAgent = null
}

/** FNV-1a, 32 bits, as 8 hex digits. */
function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** The open project's key: its file (the same on the next start of the
 *  app), or — unsaved — this run's project session. */
export function projectKey(path: string | null = getProjectKeyPath()): string {
  if (path) return `f${fnv(path.toLowerCase())}`
  return `u${fnv(`${useStore.getState().versionEpoch}:${projectSession()}`)}`
}

/** The key a point's file name carries (null for an older name). */
export const keyOfName = (name: string): string | null => /^\d{13}-(?:pre|pt)-([a-z0-9]{1,12})(?:\.[a-z0-9]{1,12})?-/.exec(name)?.[1] ?? null
/** The project identity a point's file name carries ('' when it has none). */
export const idOfName = (name: string): string => /^\d{13}-(?:pre|pt)-[a-z0-9]{1,12}\.([a-z0-9]{1,12})-/.exec(name)?.[1] ?? ''
/** A project's identity as point names carry it ('' for none). */
export const identityOf = (p: Project): string => (p.uid ? fnv(p.uid) : '')
const labelOf = (kind: PointKind, key: string, session: string, project: Project): string =>
  `${kind}-${key}${identityOf(project) ? `.${identityOf(project)}` : ''}-${session.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'agent'}`
const kindOfName = (name: string): PointKind => (/^\d{13}-pre-/.test(name) || /^memory-\d+-pre/.test(name) ? 'pre' : 'pt')

/**
 * Which project is open now, and its key. The key is taken when the project
 * is loaded (the path is set before that) and stays with it: while another
 * file is being opened the path already names that file, but the project in
 * the window is still this one — a point written then is this project's.
 * Another project than last time: the points of projects that are not this
 * one are let go (a closed project's are read from the profile when it is
 * open again; an unsaved one's are gone with it). The open project saved
 * under another path: onProjectMoved, below.
 */
/** A period's point before the agent becomes a session point (in memory and
 *  in the profile): no agent change followed it. */
function letGo(period: { pre: RestorePoint }): void {
  const was = period.pre
  was.kind = 'pt'
  if (io.demote && /^\d{13}-pre-/.test(was.name)) {
    renaming = renaming
      .then(() => io.demote!(was.name))
      .then((next) => void (next && (was.name = next)))
      .catch(() => undefined)
  }
}

function sync(path: string | null = getProjectKeyPath()): { ps: number; key: string } {
  const ps = projectSession()
  if (!open) {
    open = { ps, key: projectKey(path) }
    checkOpened(open.key)
  } else if (open.ps !== ps) {
    const key = projectKey(path)
    for (let i = points.length - 1; i >= 0; i--) if (points[i].key !== key) points.splice(i, 1)
    // (A period of the project that was open in which NO agent change
    // landed — its draft goes with the project: its point is not that
    // file's "before the agent"; it is let go as a session point, or the next
    // time the file is open "back to before the agent" would also take away
    // what the user did since: phase 4A.10, drafts#8.)
    for (const [k, period] of periods) if (k !== key && !period.landed) letGo(period)
    for (const k of [...periods.keys()]) if (k !== key) periods.delete(k)
    for (const k of [...wentBackTo.keys()]) if (k !== key) wentBackTo.delete(k)
    for (const [s, p] of madeFor) if (p !== ps) madeFor.delete(s)
    if (lastAgent && lastAgent.projectSession !== ps) lastAgent = null
    open = { ps, key }
    checkOpened(key)
  }
  return open
}

/**
 * The project just loaded is a file just opened (phase 4A.11, P3): the save
 * id it holds goes to the profile. When the profile knew the file with
 * another one, the file was changed outside the app since (another episode
 * copied over it, another program wrote it): its points before the agent are
 * not this file's any more and become session points (kept, listed), in
 * memory as in the profile.
 */
function checkOpened(key: string): void {
  const file = takeOpenedFile()
  if (!file || !io.opened || projectKey(file.file) !== key) return
  const ask = io.opened
  renaming = renaming
    .then(() => ask(key, file.saveId))
    .then((names) => {
      if (!names) return
      const period = periods.get(key)
      if (period && names[period.pre.name]) periods.delete(key)
      const back = wentBackTo.get(key)
      if (back && names[back.name]) wentBackTo.delete(key)
      for (const p of new Set([...points, ...(period ? [period.pre] : [])])) {
        if (p.key !== key || !names[p.name]) continue
        p.name = names[p.name]
        p.kind = 'pt'
      }
    })
    .catch(() => undefined)
}

// What the app saves goes to the profile with its save id (P3).
onProjectSaved((file, id) => {
  if (!io.saved) return
  const save = io.saved
  const key = projectKey(file)
  renaming = renaming.then(() => save(key, id)).catch(() => undefined)
})

// The key is taken the moment a project is loaded (not at the agent's next
// call, by when the path may name a file that is only being opened) — the
// first project of a run too (phase 4A.10, E1, safety#3: a Save As before
// the agent's first call of the run did not move the points).
useStore.subscribe(() => {
  if (!open || open.ps !== projectSession()) sync()
})

// Save As, the first save of a new project, a rename of the open project's
// file: its points go with it. (The path is already the new one here: the
// key it had is the one `from` gives, when this file has not seen it yet.)
onProjectMoved((from, to, how) => {
  const o = open && open.ps === projectSession() ? open : sync(from)
  const next = projectKey(to)
  if (o.key === next) return
  // A Save As of a file copies (the file saved from keeps its own points);
  // a rename, or the first save of an unsaved project, moves (P2).
  rekey(o.key, next, how === 'saveAs' && o.key.startsWith('f'))
  o.key = next
})

/** A CLOSED project's file was renamed (the Projects list): its points go
 *  with it on disk (phase 4A.10, E1, safety#3). */
export function movePointsWithFile(from: string, to: string): Promise<void> {
  const a = projectKey(from)
  const b = projectKey(to)
  if (a === b || !io.rekey) return Promise.resolve()
  renaming = renaming.then(() => io.rekey!(a, b)).catch(() => undefined)
  return renaming.then(() => undefined)
}

/** The points of key `from` become points of key `to` (Save As, a rename):
 *  in memory at once, on disk (copied or moved) as soon as that is through.
 *  A point before the agent that the profile made a session point there (the
 *  file had an older one of the same project: P1) is one in memory too. */
function rekey(from: string, to: string, copy = false): void {
  const mine = points.filter((p) => p.key === from)
  for (const p of mine) p.key = to
  const period = periods.get(from)
  if (period) {
    periods.delete(from)
    periods.set(to, period)
  }
  const back = wentBackTo.get(from)
  if (back) {
    wentBackTo.delete(from)
    wentBackTo.set(to, back)
  }
  if (!io.rekey) return
  renaming = renaming
    .then(() => io.rekey!(from, to, copy))
    .then((names) => {
      for (const p of mine) {
        if (!names || !names[p.name]) continue
        p.name = names[p.name]
        if (p.kind === 'pre' && /^\d{13}-pt-/.test(p.name)) {
          p.kind = 'pt'
          if (periods.get(to)?.pre === p) periods.delete(to)
        }
      }
    })
    .catch(() => undefined)
}

/** Keeps a project's points in memory: its point before the agent, and its
 *  last few session points. */
function keep(point: RestorePoint): void {
  points.push(point)
  const pre = periods.get(point.key)?.pre
  const back = wentBackTo.get(point.key)
  const mine = points.filter((p) => p.key === point.key && p !== pre && p !== back && p.kind === 'pt')
  for (const old of mine.slice(0, Math.max(0, mine.length - SESSION_POINTS))) points.splice(points.indexOf(old), 1)
  // Earlier periods' points before the agent: the last few only.
  const olderPre = points.filter((p) => p.key === point.key && p.kind === 'pre' && p !== pre && p !== back)
  for (const old of olderPre.slice(0, Math.max(0, olderPre.length - SESSION_POINTS))) points.splice(points.indexOf(old), 1)
}

async function write(kind: PointKind, session: string, project: Project, key: string): Promise<RestorePoint> {
  const json = serializeProject(project)
  const label = labelOf(kind, key, session, project)
  let name = `memory-${Date.now()}-${kind}`
  if (io.write) {
    const written = await io.write(json, label).catch(() => null)
    if (!written) throw new Error('could not write the restore point (the project as it was before the agent) into the profile; nothing was applied')
    name = written.name
    if (written.over && written.over > toldOver) tell({ key: 'agent.restoreFull', params: { count: written.over } })
    toldOver = written.over ?? 0
  }
  return { name, at: Date.now(), session, kind, key, project, json }
}

/** The point before the agent this file already has in the profile (from an
 *  earlier open or an earlier run, never gone back to): the newest. */
async function diskPre(key: string): Promise<RestorePoint | null> {
  if (!io.list || !key.startsWith('f')) return null
  const list = await io.list().catch(() => [])
  // (Only THIS project's: a point under this path with another identity is
  // of a file that was saved over: phase 4A.10, E1, safety#2.)
  const id = identityOf(useStore.getState().project)
  const names = list.map((x) => x.name).filter((n) => keyOfName(n) === key && idOfName(n) === id && /^\d{13}-pre-/.test(n)).sort()
  const name = names[names.length - 1]
  return name ? { name, at: Number(name.slice(0, 13)), session: '', kind: 'pre', key } : null
}

/**
 * Before a session's change: the point before the agent when this project
 * has none yet (in memory or in the profile), else a session point when the
 * live project changed since the last point for a reason that is not the
 * agent's. Throws when the point cannot be written.
 */
export async function ensureRestorePoint(session: string): Promise<RestorePoint | null> {
  const { ps, key } = sync()
  await renaming
  if (madeFor.get(session) === ps && periods.has(key)) return null
  const live = useStore.getState().project
  let period = periods.get(key)
  if (!period) {
    // The file's point before the agent from an earlier open or run stays
    // THE point: no new one is written over it.
    const known = await diskPre(key)
    if (projectSession() !== ps) return null
    if (known && !periods.has(key)) {
      const had = points.find((p) => p.name === known.name)
      period = { pre: had ?? known, landed: true }
      periods.set(key, period)
      if (!had) points.push(known)
    } else if (!periods.has(key)) {
      const pre = await write('pre', session, live, key)
      if (projectSession() !== ps) return null
      periods.set(key, { pre, landed: false })
      // The point last gone back to is an ordinary earlier point from now
      // on (not kept twice when the project still is that state).
      const back = wentBackTo.get(key)
      wentBackTo.delete(key)
      if (back) {
        back.kind = 'pt'
        if (back.json === pre.json && points.includes(back)) points.splice(points.indexOf(back), 1)
      }
      keep(pre)
      madeFor.set(session, ps)
      return pre
    } else period = periods.get(key)!
  }
  const mine = points.filter((p) => p.key === key)
  const latest = mine[mine.length - 1] ?? period.pre
  // Compared as the file would be written: what the app keeps for itself
  // while it runs (a media file's probed details) is not a change.
  const json = serializeProject(live)
  const agentText = (): string => (lastAgent!.text ??= serializeProject(lastAgent!.project))
  const byAgent = lastAgent?.projectSession === ps && (lastAgent.project === live || agentText() === json)
  if (latest.json === json || byAgent) {
    madeFor.set(session, ps)
    return null
  }
  const pt = await write('pt', session, live, key)
  if (projectSession() !== ps) return null
  keep(pt)
  madeFor.set(session, ps)
  return pt
}

/** Right before an agent's change lands (a direct edit, a draft accepted):
 *  the period's point before the agent is the live project NOW when no agent
 *  change landed yet and the user changed it since the point was taken (a
 *  draft waited while they worked). Synchronous: the file follows. */
export function beforeAgentLands(): void {
  const { key } = sync()
  const period = periods.get(key)
  const live = useStore.getState().project
  if (!period || period.landed || period.pre.project === live) return
  const json = serializeProject(live)
  if (json === period.pre.json) return
  const pre: RestorePoint = { ...period.pre, name: `memory-${Date.now()}-pre`, at: Date.now(), project: live, json }
  const i = points.indexOf(period.pre)
  if (i >= 0) points.splice(i, 1)
  period.pre = pre
  points.push(pre)
  if (io.write) {
    // (Normally written already, and waited for, by pointBeforeAccept; this
    // is the user's edit made in between: a failed write is told.)
    void io.write(json, labelOf('pre', pre.key, pre.session, live)).then(
      (w) => void (w ? (pre.name = w.name) : tell({ key: 'agent.restoreFailed' })),
      () => tell({ key: 'agent.restoreFailed' })
    )
  }
}

/**
 * Right before a draft is accepted (phase 4A.10, E2, safety#8): when the
 * period's point before the agent is no longer the live project (the user
 * worked while the draft waited), the live project is written as that
 * point NOW, and waited for. Throws when it cannot be written: then the
 * accept does not happen.
 */
export async function pointBeforeAccept(): Promise<void> {
  const { ps, key } = sync()
  await renaming
  const period = periods.get(key)
  const live = useStore.getState().project
  if (!period || period.landed || period.pre.project === live) return
  if (serializeProject(live) === period.pre.json) return
  const pre = await write('pre', period.pre.session || 'agent', live, key).catch((e) => {
    tell({ key: 'agent.restoreFailed' })
    throw e
  })
  if (projectSession() !== ps || periods.get(key) !== period) return
  const i = points.indexOf(period.pre)
  if (i >= 0) points.splice(i, 1)
  period.pre = pre
  points.push(pre)
}

/** The accept the draft card makes (4B): the point first, then the draft
 *  (drafts.ts acceptDraft). Nothing is accepted when the point cannot be
 *  written. */
export async function acceptSaved(seqs: readonly number[] | undefined, shown: AcceptPlan['shown'] | 'now', ops?: readonly string[]): Promise<AcceptOutcome> {
  try {
    await pointBeforeAccept()
  } catch {
    throw new Error('Nothing was accepted: the point before the agent (the project as it is now) could not be written to disk.')
  }
  return acceptDraft(seqs, shown, ops)
}

/** After an agent's change landed: the live project now is the agent's. */
export function agentLanded(): void {
  const { ps, key } = sync()
  const period = periods.get(key)
  if (period) period.landed = true
  lastAgent = { projectSession: ps, project: useStore.getState().project }
}

// A draft accepted is the agent's change landing.
onAdopt({ before: beforeAgentLands, after: agentLanded })

// A draft that ended without being adopted, in a period in which no agent
// change landed: there is nothing "before the agent" to go back to. The
// point is let go (a session point in the profile), so a later start of the
// app does not take it for the file's point before the agent, and the
// agent's next change writes one of the project as it is then.
onDraftGone(() => {
  const { ps, key } = sync()
  const period = periods.get(key)
  if (!period || period.landed) return
  periods.delete(key)
  for (const [s, p] of madeFor) if (p === ps) madeFor.delete(s)
  letGo(period)
})

/** The points of the project open now: its point before the agent first
 *  (the one of the open period, or the one last gone back to), then the
 *  others, newest first. */
export function restorePoints(): readonly RestorePoint[] {
  const { key } = sync()
  const first = periods.get(key)?.pre ?? wentBackTo.get(key)
  const mine = points.filter((p) => p.key === key)
  return first ? [first, ...mine.filter((p) => p !== first).reverse()] : mine.reverse()
}

/**
 * Back to a point, as one undo step. With no name: the point before the
 * agent — of the open period, else the one last gone back to, else the one
 * the file has in the profile; never a later point that holds the agent's
 * changes (4A.9, V-restore-transcribe-5). A point of an earlier run is read
 * from its file by name (media relinked by id from the project open now) —
 * only one of the project open now. Going back to the point before the agent
 * ends the period. Returns the point.
 */
export async function restoreTo(name?: string): Promise<RestorePoint> {
  const { ps, key } = sync()
  await renaming
  const mine = restorePoints()
  let point: RestorePoint | null | undefined = name ? mine.find((p) => p.name === name) : periods.get(key)?.pre ?? wentBackTo.get(key) ?? mine.find((p) => p.kind === 'pre')
  if (!point && name) {
    const k = keyOfName(name)
    if (k !== key) throw new Error(k ? `The restore point "${name}" belongs to another project.` : `"${name}" is not a restore point of this project.`)
    // (The same path, another project: a file that was saved over this one.)
    if (idOfName(name) !== identityOf(useStore.getState().project)) throw new Error(`The restore point "${name}" belongs to another project (a file once saved at this path).`)
    point = { name, at: Number(name.slice(0, 13)) || 0, session: '', kind: kindOfName(name), key }
  }
  if (!point && !name) point = await diskPre(key)
  if (!point) throw new Error(name ? `There is no restore point "${name}".` : 'There is no point before the agent for this project.')
  if (!point.project) {
    const r = await io.read?.(point.name)
    if (!r?.json) throw new Error(`There is no restore point "${point.name}".`)
    const { project } = readProjectFile(r.json)
    const urls = new Map(useStore.getState().project.assets.map((a) => [a.id, a.url]))
    for (const a of project.assets) {
      const url = urls.get(a.id)
      if (url) a.url = url
      else a.missing = true
    }
    point.project = project
    point.json = r.json
  }
  if (projectSession() !== ps) throw new Error('Another project was opened meanwhile; nothing was restored.')
  dropDraft('ended: the project was put back to before the agent')
  const st = useStore.getState()
  // Where the media lives now and what was read from it is the open
  // project's, not the point's (phase Ç2a.2, decision 1: a relink since is
  // kept, as undo keeps it).
  st.adoptCandidate(carryMedia(st.project, point.project), { baseVersion: st.projectVersion, epoch: st.versionEpoch })
  // Back to before the agent: the period is over (the agent's next change
  // writes a new point before it). This point stays the default to go back
  // to until then; in the profile it is a session point from now on, so a
  // later start of the app does not take it for a period still open.
  if (point.kind === 'pre') {
    periods.delete(key)
    wentBackTo.set(key, point)
    if (!points.includes(point)) points.push(point)
    for (const [s, p] of madeFor) if (p === ps) madeFor.delete(s)
    if (lastAgent?.projectSession === ps) lastAgent = null
    if (io.demote && /^\d{13}-pre-/.test(point.name)) {
      const was = point
      renaming = renaming
        .then(() => io.demote!(was.name))
        .then((next) => void (next && (was.name = next)))
        .catch(() => undefined)
    }
  }
  return point
}

/** Is the project now byte for byte the point's file? */
export const matchesPoint = (point: RestorePoint): boolean => serializeProject(useStore.getState().project) === point.json

/** A session ended (G9): its bookkeeping goes. */
export function forgetRestoreSession(session: string): void {
  madeFor.delete(session)
}

/** When the renames on disk that are under way are through (tests; a
 *  restore and a new point wait for them themselves). */
export const pointsSettled = (): Promise<void> => renaming.then(() => undefined)

/** How many points this window holds in memory (tests: closed projects' go). */
export const pointsInMemory = (): number => points.length
