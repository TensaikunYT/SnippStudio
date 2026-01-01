// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Content-addressed replay (SnippStudio phase 4A.9, FAZ4A-YENIDEN.md A0–A2):
// the one primitive of the agent's edits. Pure.
//
//   replay(project, entries) → the project, and for every op: applied, or
//   dropped with its reason.
//
// A draft is its entries replayed on the live project; so are accepting all
// or some of it, taking one range out of a cut, an edit sent with an old
// version, an analysis applied, and an edit made straight on the timeline.
//
// An op is taken in the project the agent read (`captureOp`): what it means
// there as content, and — by running it there once — what it does (the
// reference). To apply it, its content is found in the project as it is
// (content.ts), the real command runs with what was found, and the result is
// held against the reference. Whatever does not hold is rolled back (the
// project before is kept: projects are immutable) and dropped with a
// reason. When unsure: drop and say. A dropped op is not a fault; a silent
// wrong is.
//
// Families (families.ts says which, by command and parameters):
//   cut         whole-timeline ranges, found by the content of the anchor
//               track; only what was meant goes
//   place       a new title or marker at a moment of anchor content
//   record      settings of clips named by id: applied to every piece that
//               shows the content the named clip showed
//   own         a point in a named clip's own content (split, trims)
//   line        a subtitle line or title named by id: a line is found by its
//               words' content
//   field       a field of the project
//   add         makes something new and touches nothing (a track)
//   structural  everything else: applied only on the very project it first
//               ran on, giving the very result it first gave
// An op whose reference run reaches past what its family allows (a packed
// track that slides, subtitles that follow a trimmed voice, a transition
// taken off a neighbour) is structural for that call.
import type { Caption, Clip, Project } from '../types'
import { channelKfs, instanceOf, KF_CHANNELS, projectDuration } from '../types'
import { mergeCutRanges } from '../commands/timeline'
import { deletableClipIds, keyedSay, ownTrackClosePlan, rippleLeavesGap, setClipKeyed } from '../commands/clips'
import { applySequence, checkBatch, commandByName, CommandError, defaultEnv, seededIds, seededRandom, type CommandCall, type CommandEnv } from '../commands'
import { sameValue } from '../history/equal'
import { shownAt } from '../notes/model'
import { localAtMedia, mediaAtLocal } from '../timeline/media-time'
import { curveScale, curveSig, hasCurve, sameCurve } from '../timeline/speed-curve'
import { familyOf, type Family } from './families'
import { lockedNamed, scopeBreach, scopeOf, type ScopeNote } from './scope'
import { carryRegion, opInside, placedIn, regionBreach, slab, type Region } from './regions'
import { countTimes, hasTimes, idsIn, lastingId, mapIds, mapTimes, setAt, type WordTime } from './address'
import { overlapOn, anchorTrack, clipsOn, coverOf, isLocked, lenOf, locate, merge, oneToOne, overlap, piecesIn, piecesOf, pointAt, spansOf, windowOf, without, type Iv, type Piece, type Point } from './content'

export type { Family }

/** A clip an op names, as content. */
export interface ClipRef {
  id: string
  inst: string
  /** The source seconds it showed (one-to-one media); for other clips the
   *  clip is the one of that id. */
  lo: number
  hi: number
  solid: boolean
  /** Not solid (a still, a held frame): the anchor content it lay over when
   *  it was read, or (no anchor) its place on the timeline. Its pieces are
   *  the clip of that id and whatever of it lies over that content now. */
  over?: Piece[]
  span?: Iv
}

export interface Op {
  name: string
  /** As written: word addresses resolved to seconds of the version read. */
  params: Record<string, unknown>
  family: Family
  /** Why a content family became structural for this call. */
  demoted?: string
  /** The anchor track of the project it was read in. */
  anchor?: string
  /** cut: per range, its anchor content and what else was inside it, each
   *  with WHERE it lay on the anchor's content (when it was read; `met`: when
   *  it first ran, after the session's own earlier edits). `keep`: the take
   *  a retake is cut for (it must still be there). */
  ranges?: { pieces: Piece[]; had: Inside[]; met?: Inside[]; keep?: Piece[]; twice?: boolean }[]
  /** place: the anchor content at its time. */
  point?: Point
  /** place: the anchor content its whole length lies over (a title's own
   *  2.5 s), and the other sound that lay under its start. */
  span?: Piece[]
  under?: Inside[]
  metUnder?: Inside[]
  /** place: its time was the very start of the footage, or its end. */
  edge?: 'start' | 'end'
  /** record: the clip that followed the named one (a transition goes into
   *  it); the transitions the reference run took off other clips. */
  follow?: Point | null
  lost?: Record<string, unknown>
  /** record on a clip with no clock of its own: how its pieces lay. */
  lay?: string
  metLay?: string
  /** The live version its numbers stand on, when not the edit's base (an
   *  analysis result: the version it was measured on). */
  baseLive?: number
  /** It could not be read at all (it names something that is not there):
   *  it can never be brought back. */
  uncaptured?: true
  /** record / own: the clips named. */
  clips?: ClipRef[]
  /** own: the op's points in the named clips' content. */
  points?: Point[]
  /** line: the lines named (a title: by id). */
  lines?: { id: string; keys: string[] | null; marks?: string[]; had?: string[] }[]
  /** What the reference run wrote on what it named: field → [before, after]. */
  writes?: Record<string, [unknown, unknown]>
  /** The values met when it first applied (what a replay expects). */
  met?: Record<string, unknown>
  /** structural: the project it first ran on and what it made of it.
   *  `adds`: it only ADDED records there (clips, titles, markers, templates,
   *  tracks) and changed nothing that was there — such an op is held to its
   *  effect on a replay, not to the whole film (phase 4A.10, C5). */
  ref?: { before: Project; after: Project; adds?: true }
  /** structural: what it does in the version it was read in, when it only
   *  adds there: it may first run on a project someone else changed, held
   *  to that effect. Gone once it has run. */
  read?: { before: Project; after: Project }
  /** structural: its times that were given by a word, each as that word's
   *  content (anchor content under its start + its text): found again in
   *  the project as it is (C4). */
  addr?: { path: string; key: string; end: boolean; point: Point }[]
  /** structural, while its call is being entered: the ops of the call
   *  before it only ADDED records to the project the call was written on
   *  (C3: its seconds and ids still mean what they meant). */
  fresh?: true
  /** structural, naming ids or times: the project those were read in (they
   *  mean nothing on another film). Dropped once the op has run. */
  frame?: Project
  /** structural: which tracks were locked when it was read (a lock is not
   *  a version of the film, but it changes what a command does). */
  locks?: string
  /** Dropped for good (its drop was told and the agent sent a later edit). */
  retired?: string
  /** The user decided this op by itself in the review strip (D22, worker
   *  C): accepted, it is in the live project; rejected, it is out of the
   *  draft. It stays in its entry (the places and seeds of the other ops do
   *  not change), `retired`, and is not listed among the dropped. */
  settled?: 'accepted' | 'rejected'
  /** An analysis result it came from ("r3"), for the answers. */
  from?: string
  /** The version the agent read it in (K1: what it may destroy or write
   *  over is what was there so in this version). */
  seen?: Project
  /** That version was a draft: the live project it stood on (a value of the
   *  draft's own that is not in force now — its op was dropped — is the
   *  live one again). */
  liveUnder?: Project
  /** Its place among the ops as the agent sent them (0-based; an applied
   *  result may be several commands). */
  sent?: number
  /** The other ops (as sent, 0-based) made with it as one move (D22, A1). */
  also?: number[]
  /** The notes the user limited that were out with the agent when it came
   *  in: what it changes lies inside them (KAPSAM-AJAN-PLAN.md §3). */
  scope?: ScopeNote[]
  /** structural, written by a worker inside its region (the team mode,
   *  step 3): the region where the op first ran (seconds of `ref.before`)
   *  and its parameters as it ran there. On a project that is not that one
   *  it is held to its region instead of to the whole film (`byRegion`). */
  zone?: { range: Iv; params: Record<string, unknown> }
}

export interface Entry {
  seq: number
  ops: Op[]
  /** For each op's ids and random choices (with its place in the entry). */
  seed: number
  label: string
  at: number
  /** The live version the agent's base stood on. */
  baseLive: number
  /** The draft's calls the version it was written on held (T7). */
  on?: number[]
  /** The worker that wrote it (EKIP-PLAN.md: the draft's groups). */
  as?: string
}

export interface Outcome {
  seq: number
  index: number
  /** Its place among the ops as the agent sent them (0-based). */
  sent?: number
  /** The other ops (as sent) that were made with it as one move. */
  also?: number[]
  /** As the agent wrote it ("apply r3" for an applied result). */
  name: string
  /** The command it is. */
  command: string
  applied: boolean
  reason?: string
  /** Parts left out or said besides (a range of a cut that was dropped…). */
  notes?: string[]
  result?: unknown
  /** cut: the ranges cut, in the times of the project it ran on. */
  cuts?: Iv[]
  /** cut: the ranges (0-based, as sent) that were NOT cut. */
  left?: number[]
  /** It failed with an error no one foresaw (a fault of the app's). */
  fault?: true
  /** A setting of clips: how much it reached ("1 clip, 0.00–2.76 s"). */
  scope?: string
  /** The user decided it by itself (Op.settled): not a drop to be told. */
  settled?: 'accepted' | 'rejected'
}

export interface ReplayContext {
  /** This SESSION's own last writes that are in force (content|field →
   *  value): not someone else's change. */
  own: Map<string, unknown>
  /** Did anyone but this session change the film after that live version
   *  (the user, another program, another session of the same program, a
   *  draft of another's that the user accepted)? */
  userChangedSince: (live: number) => boolean
  /** What this session's own ops in force put on the timeline, each with
   *  where it put it: a cut may take those THERE; it never takes what was
   *  put or moved into its range by anyone else after the agent read. */
  made?: Inside[]
  /** Where this session's own ops MOVED a marker, title or template (a cut
   *  of its own through a title): from where it lay to where it lies. A
   *  record that lay where it may be taken, lies so still after that. */
  moved?: [Inside, Inside][]
  extra?: Partial<CommandEnv>
  /** The ops this replay applied, in order (what each did), and the call
   *  being replayed now: a structural op that drops because an earlier op
   *  of the agent's moved what it names says which (phase 4A.10,
   *  liveness#6). */
  steps?: { name: string; sent: number; seq: number; before: Project; after: Project }[]
  now?: number
  /** The live project this replay (or new entry) stands on: what is gone
   *  from it was taken by someone, not by this replay's ops (K7). */
  live?: Project
  /** When given: every op this replay applied, with the project it met and
   *  the one it left (D22, worker C: the review strip says and marks each
   *  op by that difference). The caller's own list; nothing is cut off it. */
  trace?: { seq: number; index: number; before: Project; after: Project }[]
  /** The team mode, step 3 (EKIP-3-PLAN.md): the stretches the program's
   *  workers took, and the worker whose call is being replayed now. */
  regions?: readonly Region[]
  as?: string
}

/** The latest op of this replay that did more than add: what moved or cut
 *  what a later op named. */
function moverOf(ctx: ReplayContext): string {
  const steps = ctx.steps ?? []
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i]
    if (!addsOnly(diff(s.before, s.after))) return ` (#${s.sent + 1} ${s.name} of ${s.seq === ctx.now ? 'this call' : `your call #${s.seq}`})`
  }
  return ' (in an earlier call)'
}

/** Something that lies in a range besides the anchor's own content, and
 *  where: for a clip of another track, how its source runs against the
 *  anchor's (a clip slid or slipped under the same talk is another thing);
 *  for a marker, a title or a template, the anchor content under its start
 *  and end. */
export interface Inside {
  id: string
  at: number[]
}
// (An id ending in "#": `at` starts with a stretch [lo, hi] of the anchor's
// source the thing lies over — the same thing when it lies over no MORE than
// it did: a cut through it takes some away, a clip made longer lies over
// more. Every other number of `at` is to be equal.)
const sameInside = (a: Inside, b: Inside): boolean => {
  if (a.id !== b.id || a.at.length !== b.at.length) return false
  const from = a.id.endsWith('#') ? 2 : 0
  if (from && !(a.at[0] >= b.at[0] - 1e-4 && a.at[1] <= b.at[1] + 1e-4)) return false
  return a.at.slice(from).every((x, i) => Math.abs(x - b.at[from + i]) <= 1e-4)
}
/** Is `x` among `list` (for a stretch: within one of them)? */
const within = (list: readonly Inside[] | undefined, x: Inside): boolean => !!list?.some((y) => sameInside(x, y))
const MADE_MAX = 20_000
/** Is `x` where it may be taken: in one of `lists`, or moved there by the
 *  session's own ops from where it was? */
function known(x: Inside, lists: readonly (readonly Inside[] | undefined)[], moved: readonly [Inside, Inside][] | undefined, depth = 0): boolean {
  if (lists.some((l) => within(l, x))) return true
  return depth < 6 && !!moved?.some(([from, to]) => sameInside(x, to) && !sameInside(from, to) && known(from, lists, moved, depth + 1))
}

const SLIVER = 0.02
const EXACT = 1e-6

// ---- what an edit changed ------------------------------------------------------

interface Diff {
  clips: { added: string[]; removed: string[]; changed: string[] }
  captions: { added: string[]; removed: string[]; changed: string[] }
  markers: { added: string[]; removed: string[]; changed: string[] }
  templates: { added: string[]; removed: string[]; changed: string[] }
  tracks: { added: string[]; removed: string[]; changed: string[] }
  other: string[]
}

const LISTS = new Set(['clips', 'captions', 'markers', 'templates', 'tracks', 'notes', 'noteSeq'])

function listDiff<T extends { id: string }>(a: readonly T[] | undefined, b: readonly T[] | undefined, same: (x: T, y: T) => boolean): Diff['clips'] {
  const out = { added: [] as string[], removed: [] as string[], changed: [] as string[] }
  if (a === b) return out
  const before = new Map((a ?? []).map((x) => [x.id, x]))
  const seen = new Set<string>()
  for (const y of b ?? []) {
    seen.add(y.id)
    const x = before.get(y.id)
    if (!x) out.added.push(y.id)
    else if (x !== y && !same(x, y)) out.changed.push(y.id)
  }
  for (const id of before.keys()) if (!seen.has(id)) out.removed.push(id)
  return out
}

/** Equal but for float noise in a number (a time put through a clip's clock
 *  and back) and a subtitle's `soundClip` (the app's own note of the clip it
 *  follows). */
function nearly(x: unknown, y: unknown): boolean {
  if (x === y) return true
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= EXACT
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return (x ?? undefined) === (y ?? undefined)
  if (Array.isArray(x) !== Array.isArray(y)) return false
  if (Array.isArray(x)) {
    const z = y as unknown[]
    return x.length === z.length && x.every((v, i) => nearly(v, z[i]))
  }
  const p = x as Record<string, unknown>
  const q = y as Record<string, unknown>
  for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) if (k !== 'soundClip' && !nearly(p[k], q[k])) return false
  return true
}
const sameCaption = (x: Caption, y: Caption): boolean => nearly(x, y)
const worded = (c: Caption | undefined): boolean => !!c && !!c.words?.length && !c.manual && !c.shape

function diff(a: Project, b: Project): Diff {
  const other: string[] = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (LISTS.has(k)) continue
    const x = (a as unknown as Record<string, unknown>)[k]
    const y = (b as unknown as Record<string, unknown>)[k]
    if (x !== y && !sameValue(x, y)) other.push(k)
  }
  return {
    clips: listDiff(a.clips === b.clips ? undefined : Object.values(a.clips), a.clips === b.clips ? undefined : Object.values(b.clips), sameValue),
    captions: listDiff(a.captions, b.captions, sameCaption),
    markers: listDiff(a.markers, b.markers, sameValue),
    templates: listDiff(a.templates, b.templates, sameValue),
    // A track whose clip list changed with its clips is not a change of the track.
    tracks: listDiff(a.tracks, b.tracks, (x, y) => sameValue({ ...x, clipIds: 0, height: 0 }, { ...y, clipIds: 0, height: 0 })),
    other
  }
}

const none = (d: { added: string[]; removed: string[]; changed: string[] }): boolean => !d.added.length && !d.removed.length && !d.changed.length
/** Deleting a clip takes the transition into it off the clip before: the
 *  only change of another clip a delete may make. */
const onlyLostTransition = (before: Project, after: Project, ids: readonly string[]): boolean =>
  ids.every((id) => {
    const f = fieldsChanged(before.clips[id], after.clips[id])
    return f.length === 1 && f[0] === 'transitionOut' && after.clips[id].transitionOut === undefined
  })
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

/** Which fields of a record differ. */
function fieldsChanged(a: object, b: object): string[] {
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k] && !sameValue(x[k], y[k]))
}

/** Two projects as the same film (S8): every time within 1e-6 s, everything
 *  else equal; not the notes, the name, a row's height, a subtitle's note of
 *  its voice clip, a clip's lock against agents. */
export function sameFilm(a: Project, b: Project): boolean {
  if (a === b) return true
  const near = (x: unknown, y: unknown, key: string): boolean => {
    if (x === y) return true
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= EXACT
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return (x ?? undefined) === (y ?? undefined)
    if (Array.isArray(x) !== Array.isArray(y)) return false
    if (Array.isArray(x)) {
      const z = y as unknown[]
      return x.length === z.length && x.every((v, i) => near(v, z[i], key))
    }
    const p = x as Record<string, unknown>
    const q = y as Record<string, unknown>
    for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) {
      if (k === 'soundClip' || k === 'height' || k === 'agentLock' || k === 'label' || (key === '' && (k === 'notes' || k === 'noteSeq' || k === 'name' || k === 'snap'))) continue
      if (!near(p[k], q[k], k)) return false
    }
    return true
  }
  return near(a, b, '')
}

const locksOf = (p: Project): string => p.tracks.filter((t) => t.locked).map((t) => t.id).join(',')

/** Do ids and times of `a` mean the same in `b`: the same clips in the same
 *  places showing the same source, the same lines, markers and templates at
 *  the same times, the same tracks in the same order with the same locks?
 *  (Not their settings: a volume changed is the same layout.) */
export function sameLayout(a: Project, b: Project): boolean {
  if (a === b) return true
  const near = (x: number | undefined, y: number | undefined): boolean => Math.abs((x ?? 0) - (y ?? 0)) <= EXACT
  if (a.tracks.length !== b.tracks.length || a.tracks.some((t, i) => t.id !== b.tracks[i].id || !!t.locked !== !!b.tracks[i].locked || !!t.autoPack !== !!b.tracks[i].autoPack)) return false
  if (a.clips !== b.clips) {
    const ka = Object.keys(a.clips)
    if (ka.length !== Object.keys(b.clips).length) return false
    for (const id of ka) {
      const x = a.clips[id]
      const y = b.clips[id]
      if (x === y) continue
      if (!y || x.trackId !== y.trackId || x.assetId !== y.assetId || !near(x.start, y.start) || !near(x.duration, y.duration) || !near(x.inPoint, y.inPoint) || (x.speed ?? 1) !== (y.speed ?? 1) || !sameCurve(x.speedCurve, y.speedCurve) || !!x.reversed !== !!y.reversed || x.linkId !== y.linkId) return false
    }
  }
  if (a.captions !== b.captions) {
    if (a.captions.length !== b.captions.length) return false
    for (let i = 0; i < a.captions.length; i++) {
      const x = a.captions[i]
      const y = b.captions[i]
      if (x === y) continue
      if (x.id !== y.id || !near(x.start, y.start) || !near(x.end, y.end) || (x.words?.length ?? 0) !== (y.words?.length ?? 0) || (x.words ?? []).some((w, k) => !near(w.start, y.words![k].start))) return false
    }
  }
  const times = <T extends { id: string }>(x: readonly T[] | undefined, y: readonly T[] | undefined, t: (v: T) => number): boolean =>
    x === y || ((x?.length ?? 0) === (y?.length ?? 0) && (x ?? []).every((v, i) => v.id === y![i].id && near(t(v), t(y![i]))))
  return times(a.markers, b.markers, (m) => m.time) && times(a.templates, b.templates, (t) => t.start)
}

// ---- capture: an op in the project the agent read ------------------------------

/** Every id a project uses (records and what they hold). */
const idSets = new WeakMap<Project, Set<string>>()
function idsOf(p: Project): Set<string> {
  let s = idSets.get(p)
  if (s) return s
  s = new Set<string>(Object.keys(p.clips))
  for (const list of [p.tracks, p.captions, p.markers ?? [], p.templates ?? [], p.assets, p.notes ?? []]) for (const x of list as { id: string }[]) s.add(x.id)
  idSets.set(p, s)
  return s
}

/** An op's own source of ids and random choices: the same on every replay
 *  (seeded by its entry and its place in it), and never an id the project
 *  it runs on already uses. */
function envFor(seed: number, index: number, on: Project, extra?: Partial<CommandEnv>): CommandEnv {
  const s = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) | 0
  const next = seededIds(s)
  const used = idsOf(on)
  const given = new Set<string>()
  const newId = (): string => {
    for (;;) {
      const id = next()
      if (used.has(id) || given.has(id)) continue
      given.add(id)
      return id
    }
  }
  return { ...defaultEnv(), ...extra, random: seededRandom(s), newId }
}

/** One command call on a project: the project after, or the error thrown. */
function run(p: Project, calls: readonly CommandCall[], env: CommandEnv): { project: Project; results: unknown[] } {
  return applySequence(p, checkBatch(calls), env)
}

const clipIdsOf = (name: string, params: Record<string, unknown>): string[] =>
  name === 'clip.delete' ? (params.ids as string[]) : name === 'clip.split' ? (params.clipIds as string[]) : [params.clipId as string]

/** A clip by id: the project's own (never a name of the map's prototype). */
const clipOf = (p: Project, id: string): Clip | undefined => (Object.hasOwn(p.clips, id) ? p.clips[id] : undefined)

function refOf(p: Project, id: string): ClipRef | null {
  const c = clipOf(p, id)
  if (!c) return null
  const [lo, hi] = windowOf(c)
  const solid = oneToOne(p, c)
  if (solid) return { id, inst: instanceOf(c), lo, hi, solid }
  const anchor = anchorTrack(p)
  return { id, inst: instanceOf(c), lo, hi, solid, span: [c.start, c.start + c.duration], ...(anchor ? { over: piecesIn(p, anchor, c.start, c.start + c.duration).pieces } : {}) }
}

/** A subtitle word as content: the anchor content at its start. */
const wordKey = (p: Project, anchor: string, t: number): string | null => {
  const pt = pointAt(p, anchor, t)
  return pt ? `${pt.inst}@${pt.m.toFixed(4)}` : null
}
/** A line's words as content: where each starts on the anchor's footage,
 *  and what it says (a cut on a locked voice track slides the subtitles
 *  along the sound: the word over that sound is then another word). */
const keysOf = (p: Project, anchor: string, c: Caption): (string | null)[] =>
  (c.words ?? []).map((w) => {
    const k = wordKey(p, anchor, w.start)
    return k === null ? null : `${k}|${w.text}`
  })

const lineIdsOf = (name: string, params: Record<string, unknown>): string[] => (name === 'caption.delete' ? (params.ids as string[]) : [params.id as string])
/** Fields of a line that say where it is, not what it is: they move with
 *  every cut before the line, so they are no "value the user changed". */
const PLACE_FIELDS = new Set(['soundClip', 'words', 'start', 'end'])

/**
 * The op as content and as a reference, taken in `base` (the project the
 * agent read). `head` is the project the op will first meet: a record the
 * agent names that an earlier op of the same edit made is found there.
 * Throws a CommandError when the op cannot be made at all (it names
 * something that is not there, its parameters are refused).
 */
export function captureOp(base: Project, head: Project, call: CommandCall, seed: number, index: number, extra?: Partial<CommandEnv>, keeps?: readonly (readonly Iv[])[], words?: readonly WordTime[], plus: Project = base): Op {
  const cmd = commandByName(call.name)
  const params = (call.params ?? {}) as Record<string, unknown>
  const op: Op = { name: call.name, params, family: familyOf(call.name, params) }
  // (Its ids and seconds tie a structural op to the version it was read in —
  // but not the id of a media item or of a track: C2.)
  const anchor0 = anchorTrack(base)
  // Times given by a word are kept as that word (C4): they do not tie the
  // op to the seconds of the version read.
  const addr = (words ?? []).map((w) => {
    const word = base.captions.find((c) => c.id === w.line)?.words?.[w.i]
    const key = word && anchor0 ? wordKey(base, anchor0, word.start) : null
    // (The time itself is the footage under it, as for a placement: the end
    // of a word is the footage under that end.)
    const point = word && anchor0 ? pointAt(base, anchor0, w.end ? word.end : word.start, w.end) ?? pointAt(base, anchor0, w.end ? word.end : word.start, !w.end) : null
    return key === null || !word || !point ? null : { path: w.path, key: `${key}|${word.text}`, end: w.end, point }
  })
  const byWord = addr.length > 0 && addr.every(Boolean) && addr.length === countTimes(cmd.params as never, params)
  const tied = idsIn(cmd.params as never, params, lastingId).length > 0 || (hasTimes(cmd.params as never, params) && !byWord)
  const structural = (why?: string): Op => {
    const out: Op = { name: op.name, params, family: 'structural', locks: locksOf(base), ...(why ? { demoted: why } : {}), ...(tied ? { frame: base } : {}), ...(addr.length && addr.every(Boolean) ? { addr: addr as NonNullable<Op['addr']> } : {}) }
    // What it does in the version it was read in: when it only adds there,
    // it is held to that effect (and may run on a project changed since).
    try {
      // (K4: on the version read with what the call's earlier ops added
      // there — a track made earlier in the call is named by this one.)
      const env0 = envFor(seed, index, plus, extra)
      cmd.check?.(plus, params as never)
      const after = run(plus, [call], env0).project
      if (addsOnly(diff(plus, after))) out.read = { before: plus, after }
    } catch {
      // (It cannot run on the version read — it names what an earlier op
      // of the call makes: it runs on what that op left, or not at all.)
    }
    return out
  }
  /** A reference run that loses subtitle words whose sound stays is no
   *  edit to make at all (the command layer's fault, plan 7.4 K-1). */
  const lossy = (why: string | null): boolean => !!why && why.startsWith(LOST_WORD)
  const env = envFor(seed, index, base, extra)
  const anchor = anchor0
  /** The reference run: what the command does in the project it was written for. */
  const reference = (src: Project): { after: Project; d: Diff } => {
    cmd.check?.(src, params as never)
    const after = run(src, [call], env).project
    return { after, d: diff(src, after) }
  }
  switch (op.family) {
    case 'cut': {
      if (!anchor || isLocked(base, anchor)) return structural('there is no unlocked sound or footage to follow')
      op.anchor = anchor
      op.locks = locksOf(base)
      op.ranges = []
      const ranges = params.ranges as Iv[]
      for (let i = 0; i < ranges.length; i++) {
        const [a, b] = ranges[i]
        const { pieces, covered } = piecesIn(base, anchor, a, b)
        if (!covered) return structural('a range reaches past the footage the edit follows')
        // (A retake: the take it is cut for, as content.)
        const keep = (keeps?.[i] ?? []).flatMap(([x, y]) => piecesIn(base, anchor, x, y).pieces)
        op.ranges.push({ pieces, had: insideOf(base, anchor, a, b), ...(keep.length ? { keep } : {}) })
      }
      return op
    }
    case 'place': {
      const t = params.time as number
      const ends = anchor ? clipsOn(base, anchor).filter((c) => oneToOne(base, c)) : []
      const first = ends[0]?.start
      const last = Math.max(0, ...ends.map((c) => c.start + c.duration))
      // The very end of the footage is a place of its own ("at the end").
      const atEnd = ends.length > 0 && Math.abs(t - last) <= EXACT
      const pt = anchor && !isLocked(base, anchor) ? pointAt(base, anchor, t) ?? (atEnd ? pointAt(base, anchor, t, true) : null) : null
      if (!anchor || !pt) return structural('its time is on no footage the edit can follow')
      op.anchor = anchor
      op.point = pt
      op.locks = locksOf(base)
      if (atEnd) op.edge = 'end'
      else if (first !== undefined && Math.abs(t - first) <= EXACT) op.edge = 'start'
      // What it lies over for its whole length (a title: the command's own
      // 2.5 s), and the other sound under its start.
      const { after, d } = reference(base)
      const made = op.name === 'marker.add' ? undefined : after.captions.find((c) => d.captions.added.includes(c.id))
      if (made) op.span = piecesIn(base, anchor, made.start, made.end).pieces
      op.under = soundUnder(base, anchor, t)
      return op
    }
    case 'record':
    case 'own': {
      const ids = clipIdsOf(op.name, params)
      const src = ids.every((id) => clipOf(base, id)) ? base : head
      const refs = ids.map((id) => refOf(src, id))
      if (refs.some((r) => !r)) throw new CommandError(op.name, `there is no clip ${ids.find((id) => !clipOf(src, id))} in the version you read`)
      op.clips = refs as ClipRef[]
      const { after, d } = reference(src)
      if (op.family === 'record') {
        const del = op.name === 'clip.delete'
        if (!none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || d.clips.added.length) return structural('it also changes other things')
        const off = subtitlesOff(src, after, d, del ? anchor : null)
        if (lossy(off)) throw new CommandError(op.name, `${off}: not made`)
        if (off) return structural('it also changes subtitles')
        // A clip with no clock of its own is the clip of that id, as it lay.
        if (!op.clips[0].solid) op.lay = layOf(src, op.clips[0], src === base ? anchor : anchorTrack(src))
        if (del) {
          // (The transitions a delete takes off the clips before: which, and what they were.)
          op.lost = {}
          for (const id of d.clips.changed) if (src.clips[id].transitionOut !== undefined && after.clips[id]?.transitionOut === undefined) op.lost[instanceOf(src.clips[id])] = src.clips[id].transitionOut
        }
        if (del ? !sameSet(d.clips.removed, ids) || !onlyLostTransition(src, after, d.clips.changed) : d.clips.removed.length > 0 || !d.clips.changed.every((id) => ids.includes(id))) return structural('it also changes other clips')
        if (!del) {
          const c = src.clips[ids[0]]
          const now = after.clips[ids[0]]
          op.writes = {}
          for (const f of fieldsChanged(c, now)) op.writes[f] = [(c as unknown as Record<string, unknown>)[f], (now as unknown as Record<string, unknown>)[f]]
          // Fades and a transition out are measured from the clip's edges.
          // (Phase 11b, KF4: a transition ALONE on a clip with no clock of its
          // own stays a record. Its lay is asked at every replay — cut in two,
          // moved or made longer or shorter by anyone else, it is not made —
          // and the clip that follows it by `follow`, so its edges are the
          // ones it was measured from; as a structural op any unrelated edit
          // of the user's, a marker, dropped it.)
          const transitionAlone = op.name === 'clip.setTransition' && Object.keys(op.writes).length === 1 && 'transitionOut' in op.writes
          if ((op.name === 'clip.setFades' || op.name === 'clip.setTransition' || 'fadeIn' in op.writes || 'fadeOut' in op.writes || 'transitionOut' in op.writes) && !op.clips[0].solid && !transitionAlone) return structural('it is measured from the clip\'s edges')
          // A transition goes into the clip that follows: that clip is part
          // of what was meant.
          if ('transitionOut' in op.writes && op.writes.transitionOut[1] != null) op.follow = followerOf(src, c)
        }
        return op
      }
      // A point of the clip's own content.
      if (op.clips.some((r) => !r.solid)) return structural('the clip has no clock of its own (a still, a held frame)')
      if (!none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || d.clips.removed.length) return structural('it also changes other things (a packed track)')
      const off2 = subtitlesOff(src, after, d, anchor)
      if (lossy(off2)) throw new CommandError(op.name, `${off2}: not made`)
      if (off2) return structural('it also changes subtitles')
      if (!d.clips.changed.every((id) => ids.includes(id))) return structural('it also moves other clips')
      const at = (id: string, t: number): Point => ({ inst: instanceOf(src.clips[id]), m: shownAt(src.clips[id], t) })
      const inside = (id: string, t: number): boolean => t > src.clips[id].start + EXACT && t < src.clips[id].start + src.clips[id].duration - EXACT
      if (op.name === 'clip.split') {
        const t = params.time as number
        if (d.clips.added.length !== ids.length || !ids.every((id) => inside(id, t))) return structural('it does not cut every clip it names')
        op.points = ids.map((id) => at(id, t))
      } else if (op.name === 'clip.trimHead') {
        if (!inside(ids[0], params.edge as number)) return structural('it reveals footage (the edge is outside the clip)')
        op.points = [at(ids[0], params.edge as number)]
      } else if (op.name === 'clip.trimEnd') {
        const c = src.clips[ids[0]]
        const end = c.start + c.duration + (params.delta as number)
        if (!inside(ids[0], end)) return structural('it reveals footage (the end moves outside the clip)')
        op.points = [at(ids[0], end)]
      } else {
        const [a, b] = params.range as Iv
        const c = src.clips[ids[0]]
        const lo = Math.max(c.start, a)
        const hi = Math.min(c.start + c.duration, b)
        if (hi - lo < 0.05) return structural('its range is not inside the clip')
        op.points = [at(ids[0], lo), at(ids[0], hi)]
      }
      if (d.clips.added.length && op.name !== 'clip.split') return structural('it also makes clips')
      return op
    }
    case 'line': {
      const ids = lineIdsOf(op.name, params)
      const src = ids.every((id) => base.captions.some((c) => c.id === id)) ? base : head
      const srcAnchor = src === base ? anchor : anchorTrack(src)
      op.lines = []
      for (const id of ids) {
        const c = src.captions.find((x) => x.id === id)
        if (!c) throw new CommandError(op.name, `there is no subtitle line or title ${id} in the version you read`)
        if (!c.words?.length || c.manual || c.shape) {
          op.lines.push({ id, keys: null })
          continue
        }
        const keys = srcAnchor ? keysOf(src, srcAnchor, c) : [null]
        if (keys.some((k) => k === null)) return structural('a word of the line is on no footage the edit can follow')
        const marks = (params.patch as { marks?: number[] } | undefined)?.marks
        // (Marks are for words: the words marked now, and those that were.)
        op.lines.push({ id, keys: keys as string[], ...(marks ? { marks: marks.map((i) => (keys as string[])[i]).filter(Boolean), had: (c.marks ?? []).map((i) => (keys as string[])[i]).filter(Boolean) } : {}) })
      }
      op.anchor = srcAnchor ?? undefined
      const { after, d } = reference(src)
      const del = op.name === 'caption.delete'
      if (!none(d.clips) || !none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || d.captions.added.length) return structural('it also changes other things')
      if (del ? !sameSet(d.captions.removed, ids) || d.captions.changed.length > 0 : d.captions.removed.length > 0 || !d.captions.changed.every((id) => ids.includes(id))) return structural('it also changes other lines')
      if (!del) {
        const c = src.captions.find((x) => x.id === ids[0])!
        const now = after.captions.find((x) => x.id === ids[0])!
        op.writes = {}
        for (const f of fieldsChanged(c, now)) if (!PLACE_FIELDS.has(f)) op.writes[f] = [(c as unknown as Record<string, unknown>)[f], (now as unknown as Record<string, unknown>)[f]]
      }
      return op
    }
    case 'field': {
      const { after, d } = reference(base)
      if (!none(d.clips) || !none(d.captions) || !none(d.markers) || !none(d.templates) || !none(d.tracks)) return structural('it also changes other things')
      op.writes = {}
      for (const k of d.other) op.writes[k] = [(base as unknown as Record<string, unknown>)[k], (after as unknown as Record<string, unknown>)[k]]
      return op
    }
    case 'add':
      return op
    default:
      return structural()
  }
}

/** The anchor content under a time, as [instance, source second] ("-": none). */
function spot(p: Project, anchor: string, t: number, endSide = false): [string, number] {
  const pt = pointAt(p, anchor, t, endSide) ?? pointAt(p, anchor, t, !endSide)
  return pt ? [pt.inst, pt.m] : ['-', 0]
}

/** Does a second of these pieces of content play in more than one place
 *  (two clips of the instance show it)? */
function shownTwice(p: Project, pieces: readonly Piece[]): boolean {
  return pieces.some((x) => {
    const list = piecesOf(p, x.inst).filter((c) => oneToOne(p, c)).map((c) => overlap([windowOf(c)], [[x.lo, x.hi]])).filter((o) => lenOf(o) > EXACT)
    return list.some((a, i) => list.some((b, j) => j > i && lenOf(overlap(a, b)) > SLIVER))
  })
}

/** A record of the timeline as something lying on the anchor's content. */
function recordAs(p: Project, anchor: string, kind: 'marker' | 'title' | 'template', id: string, start: number, end?: number): Inside {
  const a = spot(p, anchor, start)
  if (end === undefined) return { id: `${kind} ${id}~${a[0]}`, at: [a[1]] }
  const b = spot(p, anchor, end, true)
  return { id: `${kind} ${id}~${a[0]}~${b[0]}`, at: [a[1], b[1]] }
}

/** A clip of another track over [a, b) of the anchor: one item per anchor
 *  clip it lies over there. */
function clipAs(p: Project, anchor: string, c: Clip, a: number, b: number): Inside[] {
  const out: Inside[] = []
  const solid = oneToOne(p, c)
  for (const ac of clipsOn(p, anchor)) {
    const lo = Math.max(a, c.start, ac.start)
    const hi = Math.min(b, c.start + c.duration, ac.start + ac.duration)
    if (hi - lo <= EXACT || !oneToOne(p, ac)) continue
    if (!solid) {
      // A still, a held frame: the stretch of the anchor's footage it lies over.
      const x = shownAt(ac, lo)
      const y = shownAt(ac, hi)
      out.push({ id: `clip ${instanceOf(c)}@${c.trackId}~${instanceOf(ac)}#`, at: [Math.min(x, y), Math.max(x, y)] })
      continue
    }
    // Footage with a clock: the stretch of the anchor's footage it lies
    // over, and how its clock runs against the anchor's (its source second =
    // rate × the anchor's + offset: the same wherever both are cut, whatever
    // their speeds).
    const x = shownAt(ac, lo)
    const y = shownAt(ac, hi)
    const rate = ((c.reversed ? -1 : 1) * Math.max(0.01, c.speed ?? 1)) / ((ac.reversed ? -1 : 1) * Math.max(0.01, ac.speed ?? 1))
    // (A speed curve on either: its points are part of what it is, so a
    // curve changed in between is not the same thing — core polish C. The
    // rate is then the averages': a cut through it changes them, and the
    // cut is not carried: safe, not silent.)
    if (hasCurve(c) || hasCurve(ac)) {
      // Along a speed curve the two clocks are no straight line: what they
      // are is both curves (by their points, tied to the media), each one's
      // pace (k, or the speed) and where they meet — the second of its own
      // source this clip shows when the anchor shows second 0 of its (both
      // clocks carried on past their windows as the curves go). A cut through
      // either leaves all of it as it was (core polish C).
      const pace = (k: Clip): number => curveScale(k) ?? Math.max(0.01, k.speed ?? 1)
      const meet = mediaAtLocal(c, ac.start + localAtMedia(ac, 0) - c.start)
      out.push({ id: `clip ${instanceOf(c)}@${c.trackId}~${instanceOf(ac)}~${curveSig(c.speedCurve)}~${curveSig(ac.speedCurve)}${c.reversed ? 'R' : ''}${ac.reversed ? 'R' : ''}#`, at: [Math.min(x, y), Math.max(x, y), pace(c), pace(ac), meet] })
      continue
    }
    out.push({ id: `clip ${instanceOf(c)}@${c.trackId}~${instanceOf(ac)}#`, at: [Math.min(x, y), Math.max(x, y), rate, shownAt(c, lo) - rate * x] })
  }
  return out
}

/** What lies in [a, b) besides the anchor's own content: markers, titles and
 *  shapes, templates, and the clips of the other tracks — each with where it
 *  lies on the anchor's content. A cut that would take something that was
 *  NOT there (so) when the agent read is not made. */
function insideOf(p: Project, anchor: string, a: number, b: number): Inside[] {
  const out: Inside[] = []
  for (const m of p.markers ?? []) if (m.time > a + EXACT && m.time < b - EXACT) out.push(recordAs(p, anchor, 'marker', m.id, m.time))
  for (const c of p.captions) if ((!c.words?.length || c.manual || c.shape) && c.start < b - EXACT && c.end > a + EXACT) out.push(recordAs(p, anchor, 'title', c.id, c.start, c.end))
  for (const t of p.templates ?? []) if (t.start < b - EXACT && t.start + (t.duration ?? 0) > a + EXACT) out.push(recordAs(p, anchor, 'template', t.id, t.start, t.start + (t.duration ?? 0)))
  for (const tr of p.tracks) {
    if (tr.id === anchor || tr.locked) continue
    for (const c of clipsOn(p, tr.id)) if (c.start < b - EXACT && c.start + c.duration > a + EXACT) out.push(...clipAs(p, anchor, c, a, b))
  }
  return out
}

/** How an Inside item reads in a sentence. */
const sayInside = (x: Inside): string => x.id.split('~')[0].split('@')[0]

/** The other sound (not the anchor's, not on a locked track) under a time. */
function soundUnder(p: Project, anchor: string, t: number): Inside[] {
  const out: Inside[] = []
  const assets = new Map(p.assets.map((x) => [x.id, x]))
  for (const tr of p.tracks) {
    if (tr.id === anchor || tr.locked) continue
    for (const c of clipsOn(p, tr.id)) {
      const a = assets.get(c.assetId)
      if (!a || !oneToOne(p, c) || c.muted || (c.volume ?? 1) <= 0 || !(a.kind === 'audio' || (a.hasAudio && !c.audioExtracted))) continue
      if (t >= c.start - EXACT && t < c.start + c.duration - EXACT) out.push(...clipAs(p, anchor, c, t, t + 2 * EXACT + 1e-3))
    }
  }
  return out
}

/** The clip that starts where `c` ends on its track, as content. */
function followerOf(p: Project, c: Clip): Point | null {
  const next = clipsOn(p, c.trackId).find((x) => x.id !== c.id && Math.abs(x.start - (c.start + c.duration)) <= SLIVER)
  return next ? { inst: instanceOf(next), m: oneToOne(p, next) ? shownAt(next, next.start) : 0 } : null
}

/** How the pieces of a clip with no clock of its own lie: which track, over
 *  which anchor content, how long each (no anchor: at which time). */
function layOf(p: Project, r: ClipRef, anchor: string | null): string {
  return piecesOf(p, r.inst)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c) => {
      const at = anchor ? [spot(p, anchor, c.start), spot(p, anchor, c.start + c.duration, true)].map(([i, m]) => `${i}:${m.toFixed(3)}`).join('>') : c.start.toFixed(3)
      return `${c.trackId}|${at}|${c.duration.toFixed(3)}`
    })
    .join(';')
}

// ---- K1 (phase 4A.11): an op destroys or writes over only what the agent saw ----
//
// One rule after every op, in place of lists of fields: from the project the
// op met to the one it made, every record it DELETED, SHORTENED or CHANGED a
// field of (a clip, a line or title, a marker, a template) is looked up in
// the version the agent read — a clip by its content (instance and source
// window), the others by id — and compared field by field, every field but
// those that say where it lies. A record with no counterpart there, or with a
// field that differs and is not this session's own write, was changed by
// someone else after the agent read: the op (for a cut: that range) is not
// made. What cutting a record in pieces does to its fields (a fade at an edge
// that is no longer its edge, keyframes rebased, a new link between two new
// halves) is no change: those are compared as what they show.

/** A clip's fields that say where it lies (and its transition out, which a
 *  cut moves to the piece that ends where it ended). */
// (And the user's lock against agents: no value of the film.)
const CLIP_PLACE = new Set(['id', 'start', 'inPoint', 'duration', 'instance', 'transitionOut', 'agentLock', 'label'])
/** A line's: its times, its words' times, the app's note of its voice clip. */
const LINE_PLACE = new Set(['id', 'start', 'end', 'soundClip', 'layer'])
const K1_SAY = 'something you did not make was changed there after you read it'

/** Deep equality, numbers to 1e-6, ids of what a record holds left out
 *  (a piece cut off gets new ones). */
function sameDeep(x: unknown, y: unknown, depth = 0): boolean {
  if (x === y) return true
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= EXACT
  if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return (x ?? undefined) === (y ?? undefined)
  if (Array.isArray(x) !== Array.isArray(y)) return false
  if (Array.isArray(x)) {
    const z = y as unknown[]
    return x.length === z.length && x.every((v, i) => sameDeep(v, z[i], depth + 1))
  }
  const p = x as Record<string, unknown>
  const q = y as Record<string, unknown>
  for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) if (!(depth > 0 && k === 'id') && !sameDeep(p[k], q[k], depth + 1)) return false
  return true
}
const omit = (o: unknown, ...keys: string[]): unknown => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : o)


/**
 * K1: the fields in which clip `a` differs from `b`, a piece of the same
 * content (one may be cut from the other), apart from where each lies. With
 * other edges or another window, a fade or a way in / out at an edge that is
 * not shared is left out, and keyframes are compared as the values they give
 * at the same source seconds.
 */
export function clipDiffers(a: Clip, b: Clip, solid: boolean): string[] {
  const out = new Set<string>()
  const [a0, a1] = windowOf(a)
  const [b0, b1] = windowOf(b)
  const head = (c: Clip, w: Iv): number => (c.reversed ? w[1] : w[0])
  const tail = (c: Clip, w: Iv): number => (c.reversed ? w[0] : w[1])
  const sameHead = solid ? Math.abs(head(a, [a0, a1]) - head(b, [b0, b1])) <= 1e-6 : Math.abs(a.duration - b.duration) <= EXACT
  const sameTail = solid ? Math.abs(tail(a, [a0, a1]) - tail(b, [b0, b1])) <= 1e-6 : Math.abs(a.duration - b.duration) <= EXACT
  const whole = sameHead && sameTail
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (CLIP_PLACE.has(k)) continue
    let x = ra[k]
    let y = rb[k]
    if (k === 'linkId') {
      // (Two halves cut together are linked anew: linked or not is what counts.)
      if (!!x !== !!y) out.add(k)
      continue
    }
    if ((k === 'fadeIn' && !sameHead) || (k === 'fadeOut' && !sameTail)) continue
    if (k === 'anim') {
      x = omit(x, ...(sameHead ? [] : ['in', 'inDur']), ...(sameTail ? [] : ['out', 'outDur']))
      y = omit(y, ...(sameHead ? [] : ['in', 'inDur']), ...(sameTail ? [] : ['out', 'outDur']))
    }
    if (!whole && (k === 'keyframes' || k === 'channels' || k === 'volumeKeyframes')) continue
    if (!whole && k === 'motionFx') {
      const cut = ['zoomFrom', 'zoomTo', 'panFrom', 'panTo', 'gentlePanFrom', 'gentlePanTo', 'ease', 'timeOffset']
      x = omit(x, ...cut)
      y = omit(y, ...cut)
    }
    if (!whole && k === 'moves') {
      if (!!x !== !!y) out.add(k)
      continue
    }
    if (!whole && k === 'mask') {
      x = omit(x, 'keyframes')
      y = omit(y, 'keyframes')
    }
    if (!whole && k === 'autoDucking') {
      x = omit(x, 'originalVolumeKeyframes')
      y = omit(y, 'originalVolumeKeyframes')
    }
    if (!sameDeep(x, y)) out.add(k)
  }
  if (!whole) {
    // Keyframes as the keys they hold, each at its source second. Every piece
    // of a clip carries the whole list (the lossless keys, phase Ç2c.1), so
    // the keys outside the window too: a change of those still moves what is
    // inside (Ç2c patch, item 3: rotate 90 of a cut piece was not seen).
    const speed = (c: Clip): number => Math.max(0.01, c.speed ?? 1)
    const keys = (c: Clip, what: 'channels' | 'volumeKeyframes' | 'mask'): string => {
      const list: string[] = []
      const put = (name: string, t: number, v: unknown): void => {
        const m = hasCurve(c) ? mediaAtLocal(c, t) : c.reversed ? c.inPoint + (c.duration - t) * speed(c) : c.inPoint + t * speed(c)
        list.push(`${name}@${m.toFixed(4)}=${JSON.stringify(v, (k, x) => (k === 'id' || k === 'time' ? undefined : typeof x === 'number' ? Math.round(x * 1e5) / 1e5 : x))}`)
      }
      if (what === 'channels') for (const ch of KF_CHANNELS) for (const k of channelKfs(c, ch) ?? []) put(ch, k.time, k)
      if (what === 'volumeKeyframes') for (const k of c.volumeKeyframes ?? []) put('v', k.time, k)
      if (what === 'mask') for (const k of c.mask?.keyframes ?? []) put('m', k.time, k)
      return list.sort().join(';')
    }
    // (Keyed or not, whatever window. A still has no source seconds to lay
    // the keys of two pieces against each other: only whether it is keyed.)
    const keyed = (c: Clip, what: 'channels' | 'volumeKeyframes' | 'mask'): boolean => (what === 'channels' ? KF_CHANNELS.some((ch) => (channelKfs(c, ch)?.length ?? 0) > 0) : what === 'volumeKeyframes' ? (c.volumeKeyframes?.length ?? 0) > 0 : (c.mask?.keyframes?.length ?? 0) > 0)
    for (const what of ['channels', 'volumeKeyframes', 'mask'] as const) if (keyed(a, what) !== keyed(b, what) || (solid && keys(a, what) !== keys(b, what))) out.add(what)
  }
  return [...out]
}

const wordTexts = (c: Caption): string[] => (c.words ?? []).map((w) => w.text)
/** A field of a line as K1 holds it (its words: their texts). */
const lineVal = (c: Caption, k: string): unknown => (k === 'words' ? wordTexts(c) : (c as unknown as Record<string, unknown>)[k])
/** Is `a` a subsequence of `b`? */
function within2(a: readonly string[], b: readonly string[]): boolean {
  let j = 0
  for (const x of a) {
    while (j < b.length && b[j] !== x) j++
    if (j++ >= b.length) return false
  }
  return true
}

/** K1: the fields in which line `a` differs from `b` (the same line), apart
 *  from where it lies. A subtitle line that lost words to a cut (its words
 *  the read one's, fewer, its text rebuilt from them) differs in nothing. */
export function lineDiffers(a: Caption, b: Caption, live?: Caption): string[] {
  const out: string[] = []
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  const wa = wordTexts(a)
  const wb = wordTexts(b)
  const both = worded(a) && worded(b)
  // (Fewer words, the text rebuilt from them: a cut took some. More words,
  // the read ones among them: footage came back under it — an undone cut.)
  const cut = both && ((wa.length < wb.length && within2(wa, wb) && a.text === a.words!.map((w) => w.text.trim()).filter(Boolean).join(' ')) || (wa.length > wb.length && within2(wb, wa) && (!live || within2(wa, wordTexts(live)))))
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (LINE_PLACE.has(k)) continue
    if (k === 'words') {
      if (!cut && (wa.length !== wb.length || wa.some((t, i) => t !== wb[i]))) out.push(k)
      continue
    }
    if (cut && k === 'text') continue
    if (cut && k === 'marks') {
      // (Marks follow their words: the marks of the words both have.)
      const [short, long] = wa.length < wb.length ? [a, b] : [b, a]
      const sw = wordTexts(short)
      const map: number[] = []
      let j = 0
      wordTexts(long).forEach((t, i) => {
        if (j < sw.length && sw[j] === t) map[j++] = i
      })
      const fromShort = new Set((short.marks ?? []).map((i) => map[i]))
      const fromLong = new Set((long.marks ?? []).filter((i) => map.includes(i)))
      if (fromShort.size !== fromLong.size || [...fromShort].some((i) => !fromLong.has(i))) out.push(k)
      continue
    }
    const x = cut && k === 'style' ? omit(ra[k], 'marker') : ra[k]
    const y = cut && k === 'style' ? omit(rb[k], 'marker') : rb[k]
    if (!sameDeep(x, y)) out.push(k)
  }
  return out
}

/** What the session's own ops wrote and made (K1), kept in its own map:
 *  "k1|<instance or record>|<field>" → the writes (per source window for a
 *  clip), "k1 made|<instance or record>" → it made it (as it made it). */
const k1Key = (what: string, field: string): string => `k1|${what}|${field}`
const recKey = (kind: string, id: string): string => `${kind} ${id}`

function k1Own(ctx: ReplayContext, what: string, field: string, lo: number, hi: number, cur: unknown): boolean {
  const list = (ctx.own.get(k1Key(what, field)) as OwnWrite[] | undefined) ?? []
  for (let i = list.length - 1; i >= 0; i--) if (Math.min(hi, list[i].hi) - Math.max(lo, list[i].lo) > EXACT || (list[i].lo === -Infinity && lo === -Infinity)) return sameDeep(cur, list[i].value)
  return false
}
function k1Write(ctx: ReplayContext, what: string, field: string, lo: number, hi: number, value: unknown): void {
  const list = ((ctx.own.get(k1Key(what, field)) as OwnWrite[] | undefined) ?? []).filter((w) => w.lo !== lo || w.hi !== hi)
  list.push({ lo, hi, value })
  ctx.own.set(k1Key(what, field), list.slice(-OWN_WRITES))
}

/** The clips of `p` showing content of `c` (`c` a clip of another project). */
function piecesLike(p: Project, c: Clip, solid: boolean): Clip[] {
  // (A still has no source seconds: the clip of that id, or — cut in pieces —
  // the pieces of the same content.)
  if (!solid) return Object.hasOwn(p.clips, c.id) && instanceOf(p.clips[c.id]) === instanceOf(c) ? [p.clips[c.id]] : piecesOf(p, instanceOf(c)).filter((x) => !oneToOne(p, x))
  const [lo, hi] = windowOf(c)
  return piecesOf(p, instanceOf(c)).filter((x) => oneToOne(p, x) && Math.min(hi, windowOf(x)[1]) - Math.max(lo, windowOf(x)[0]) > EXACT)
}

/** K1: the counterpart of clip `c` in `p`: the clip of that id when it is
 *  the same content, else the pieces of that content on its track, else
 *  anywhere. */
function counterpart(p: Project, c: Clip, solid: boolean): Clip[] {
  const byId = Object.hasOwn(p.clips, c.id) ? p.clips[c.id] : undefined
  if (byId && instanceOf(byId) === instanceOf(c)) return [byId]
  const all = piecesLike(p, c, solid)
  const mine = all.filter((x) => x.trackId === c.trackId)
  return mine.length ? mine : all
}

type K1Record = { kind: 'clip'; clip: Clip; solid: boolean } | { kind: 'line'; line: Caption } | { kind: 'marker' | 'template'; rec: { id: string } & Record<string, unknown> }

/** The records the op deleted, shortened or changed a field of, as they
 *  were in `before`. */
function touchedBy(before: Project, after: Project): K1Record[] {
  const out: K1Record[] = []
  if (before.clips !== after.clips) {
    for (const [id, b] of Object.entries(before.clips)) {
      if (after.clips[id] === b) continue
      const solid = oneToOne(before, b)
      const now = piecesLike(after, b, solid)
      const cover = (p: Project): number => (solid ? lenOf(overlap(coverOf(p, instanceOf(b)), [windowOf(b)])) : Object.hasOwn(p.clips, id) ? p.clips[id].duration : 0)
      if (!now.length || cover(after) < cover(before) - 1e-4 || now.some((x) => clipDiffers(x, b, solid).length > 0)) out.push({ kind: 'clip', clip: b, solid })
    }
  }
  if (before.captions !== after.captions) {
    const next = new Map(after.captions.map((c) => [c.id, c]))
    for (const b of before.captions) {
      const a = next.get(b.id)
      if (a === b) continue
      if (!a || a.end - a.start < b.end - b.start - 1e-6 || (a.words?.length ?? 0) < (b.words?.length ?? 0) || lineDiffers(a, b).length) out.push({ kind: 'line', line: b })
    }
  }
  const byId = (kind: 'marker' | 'template', x: readonly ({ id: string } & object)[] | undefined, y: readonly ({ id: string } & object)[] | undefined, place: string[], len?: string): void => {
    if (x === y) return
    const next = new Map((y ?? []).map((r) => [r.id, r as { id: string } & Record<string, unknown>]))
    for (const b0 of x ?? []) {
      const b = b0 as { id: string } & Record<string, unknown>
      const a = next.get(b.id)
      if (a === b) continue
      if (!a || (len && ((a[len] as number) ?? 0) < ((b[len] as number) ?? 0) - 1e-6) || !sameDeep(omit(a, ...place), omit(b, ...place))) out.push({ kind, rec: b })
    }
  }
  byId('marker', before.markers, after.markers, ['time'])
  // (A template's start and length are where it lies: a cut shortens it.)
  byId('template', before.templates, after.templates, ['start', 'duration'], 'duration')
  return out
}

/**
 * K1: the op went from `before` to `after`; `seen` is the version the agent
 * read. What of someone else's it destroyed or wrote over (a sentence), or
 * null. A difference from the version read that is the session's own write,
 * or a record the session made, is its own.
 */
export function lostChange(before: Project, after: Project, seen: Project, ctx: ReplayContext, under?: Project): string | null {
  /** Is `cur` the value of the live project under the draft read, and the
   *  session has no write of that field there in force (its draft's op that
   *  wrote it is dropped now)? */
  const fromUnder = (what: string, k: string, lo: number, hi: number, cur: unknown, there: () => unknown[]): boolean => {
    if (!under) return false
    const list = (ctx.own.get(k1Key(what, k)) as OwnWrite[] | undefined) ?? []
    if (list.some((w) => Math.min(hi, w.hi) - Math.max(lo, w.lo) > EXACT)) return false
    const vals = there()
    return vals.length > 0 && vals.every((v) => sameDeep(v, cur))
  }
  for (const r of touchedBy(before, after)) {
    if (r.kind === 'clip') {
      const c = r.clip
      // (A sliver a cut left behind — the command layer's K-3 — is nothing anyone set.)
      if (c.duration < SLIVER) continue
      const inst = instanceOf(c)
      // (Not there when read: the session made it — then as it made it.)
      const made = ctx.own.get(`k1 made|${inst}`) as Clip | undefined
      // (The clip of that id when it is the same content; else the pieces of
      // it on its track; else anywhere — footage shown twice is two clips.
      // Not there when read: made by the session since — as it made it.)
      const was = counterpart(seen, c, r.solid)
      if (!was.length && made) was.push(made)
      if (!was.length && under) was.push(...counterpart(under, c, r.solid))
      if (!was.length) return `${K1_SAY} (clip ${c.id} was not there so when you read it)`
      const [lo, hi] = r.solid ? windowOf(c) : [-Infinity, Infinity]
      const cur = (k: string): unknown => (c as unknown as Record<string, unknown>)[k]
      const live = (k: string): unknown[] => (under ? counterpart(under, c, r.solid).map((x) => (clipDiffers(c, x, r.solid).includes(k) ? Symbol('other') : cur(k))) : [])
      for (const w of was) {
        // (K1b: of what someone else changed, only what the op loses.)
        const theirs = clipDiffers(c, w, r.solid).filter((k) => !k1Own(ctx, inst, k, lo, hi, cur(k)) && !fromUnder(inst, k, lo, hi, cur(k), () => live(k)))
        const f = theirs.length ? clipLoses(c, w, r.solid, theirs, before, after) : null
        if (f) return `${K1_SAY} (the ${f} of clip ${c.id})`
      }
      continue
    }
    if (r.kind === 'line') {
      const l = r.line
      // (A subtitle line of another id that holds words of a line that was
      // read — a line a trim or a cut divided — is that line.)
      const was = seen.captions.find((x) => x.id === l.id) ?? (ctx.own.get(`k1 made|${recKey('line', l.id)}`) as Caption | undefined) ?? under?.captions.find((x) => x.id === l.id) ?? (worded(l) ? seen.captions.find((x) => worded(x) && within2(wordTexts(l), wordTexts(x))) : undefined)
      if (!was) return `${K1_SAY} (line ${l.id} was not there when you read it)`
      const lu = under?.captions.find((x) => x.id === l.id)
      const theirs = lineDiffers(l, was, lu).filter((k) => !k1Own(ctx, recKey('line', l.id), k, -Infinity, Infinity, lineVal(l, k)) && !fromUnder(recKey('line', l.id), k, -Infinity, Infinity, lineVal(l, k), () => (lu ? [lineDiffers(l, lu).includes(k) ? Symbol('other') : lineVal(l, k)] : [])))
      const f = theirs.length ? lineLoses(l, was, theirs, after) : null
      if (f) return `${K1_SAY} (the ${f} of ${worded(l) ? 'line' : 'title'} ${l.id})`
      continue
    }
    const list = (r.kind === 'marker' ? seen.markers : seen.templates) as readonly ({ id: string } & Record<string, unknown>)[] | undefined
    const listU = (r.kind === 'marker' ? under?.markers : under?.templates) as readonly ({ id: string } & Record<string, unknown>)[] | undefined
    const ru = (listU ?? []).find((x) => x.id === r.rec.id)
    const was = (list ?? []).find((x) => x.id === r.rec.id) ?? (ctx.own.get(`k1 made|${recKey(r.kind, r.rec.id)}`) as ({ id: string } & Record<string, unknown>) | undefined) ?? ru
    if (!was) return `${K1_SAY} (${r.kind} ${r.rec.id} was not there when you read it)`
    const place = r.kind === 'marker' ? ['id', 'time'] : ['id', 'start', 'duration']
    const theirs = Object.keys({ ...r.rec, ...was }).filter((k) => !place.includes(k) && !sameDeep(r.rec[k], was[k]) && !k1Own(ctx, recKey(r.kind, r.rec.id), k, -Infinity, Infinity, r.rec[k]) && !fromUnder(recKey(r.kind, r.rec.id), k, -Infinity, Infinity, r.rec[k], () => (ru ? [ru[k]] : [])))
    // (Deleted, or the very field written over; a template only made shorter loses nothing.)
    const nowRec = ((r.kind === 'marker' ? after.markers : after.templates) as readonly ({ id: string } & Record<string, unknown>)[] | undefined)?.find((x) => x.id === r.rec.id)
    const f = theirs.find((k) => !nowRec || !sameDeep(nowRec[k], r.rec[k]))
    if (f) return `${K1_SAY} (the ${f} of ${r.kind} ${r.rec.id})`
  }
  return null
}

// ---- K1b: is a change of someone else's LOST by the op? -----------------------
//
// The rule protects the change, not the record: a record the op only made
// shorter or split, that is still there with the changed field as it was,
// has lost nothing. A change is lost when (a) the record is deleted whole;
// (b) the op writes the very field that was changed; (c) the changed data
// lies in what is taken away or on an edge that is moved: keys of a clip's
// automation (its channels, its legacy keyframes, its volume keys, its mask
// keys) at source seconds the op removes; a fade or the way in / out of an
// edge the op takes away; words of a line that go. A field whose data has
// no place in time (a grade, a blend mode, an opacity, a volume, motionFx,
// a picture's moves…) is lost only with the record (or written over).

const TIMED = new Set(['channels', 'keyframes', 'volumeKeyframes', 'mask'])

/** The keys of one kind of automation of `c` at source seconds inside `at`. */
function keysWithin(c: Clip, what: string, at: readonly Iv[]): string {
  const list: string[] = []
  const put = (name: string, t: number, v: unknown): void => {
    const m = shownAt(c, c.start + t)
    if (at.some(([a, b]) => m > a - 1e-6 && m < b + 1e-6)) list.push(`${name}@${m.toFixed(4)}=${JSON.stringify(v, (k, x) => (k === 'id' || k === 'time' ? undefined : typeof x === 'number' ? Math.round(x * 1e5) / 1e5 : x))}`)
  }
  if (what === 'channels' || what === 'keyframes') for (const ch of KF_CHANNELS) for (const k of channelKfs(c, ch) ?? []) put(ch, k.time, k)
  if (what === 'volumeKeyframes') for (const k of c.volumeKeyframes ?? []) put('v', k.time, k)
  // (A mask's shape itself has no place in time: only its keys do.)
  if (what === 'mask') for (const k of c.mask?.keyframes ?? []) put('m', k.time, k)
  return list.sort().join(';')
}

/** K1b for a clip: `c` as the op met it, `w` its counterpart in the version
 *  read, `fields` those someone else changed since. The first one the op
 *  loses, or null. */
function clipLoses(c: Clip, w: Clip, solid: boolean, fields: readonly string[], before: Project, after: Project): string | null {
  // (a) Deleted whole: nothing of its content is left (a still: the clip of that id is gone).
  // (Its own pieces only: the clip of its id, or a new one inside its window
  // on its track that was cut from it — not the same content playing in
  // another place. A new piece comes from the older piece just before it on
  // the track, when that one holds its content.)
  const [w0, w1] = windowOf(c)
  const inside = (x: Clip, y: Clip): boolean => windowOf(x)[0] >= windowOf(y)[0] - EXACT && windowOf(x)[1] <= windowOf(y)[1] + EXACT
  const cutFrom = (x: Clip): Clip | undefined => {
    const older = clipsOn(after, x.trackId).filter((y) => y !== x && Object.hasOwn(before.clips, y.id) && y.start <= x.start + EXACT)
    const y = older.sort((a, b) => b.start - a.start)[0]
    const was = y && before.clips[y.id]
    return was && instanceOf(was) === instanceOf(x) && inside(x, was) ? was : undefined
  }
  const now = solid
    ? piecesLike(after, c, solid).filter((x) => x.id === c.id || (!Object.hasOwn(before.clips, x.id) && x.trackId === c.trackId && inside(x, c) && (cutFrom(x)?.id ?? c.id) === c.id))
    : Object.hasOwn(after.clips, c.id) ? [after.clips[c.id]] : []
  const kept = merge(now.map(windowOf))
  const left = solid ? lenOf(overlap(kept, [[w0, w1]])) : now.reduce((n, x) => n + x.duration, 0)
  // (A sliver a cut leaves — under 0.02 s — is nothing left.)
  if (!now.length || left <= SLIVER + EXACT) return fields[0]
  // (b) The op writes the very field.
  const wrote = new Set(now.flatMap((x) => clipDiffers(x, c, solid)))
  const over = fields.find((k) => wrote.has(k))
  if (over) return over
  if (!solid) return null
  // (c) What it takes away: keys there, and the edges it moves.
  const gone = without([[w0, w1]], kept).filter(([a, b]) => b - a > 1e-4)
  if (!gone.length) return null
  const at = (m: number): boolean => gone.some(([a, b]) => m > a - 1e-4 && m < b + 1e-4)
  const head = at(c.reversed ? w1 : w0)
  const tail = at(c.reversed ? w0 : w1)
  for (const k of fields) {
    if (TIMED.has(k) && keysWithin(c, k, gone) !== keysWithin(w, k, gone)) return k
    if ((k === 'fadeIn' && head) || (k === 'fadeOut' && tail) || (k === 'anim' && (head || tail))) return k
  }
  return null
}

/** K1b for a line or a title: `l` as the op met it, `w` its counterpart in
 *  the version read. */
function lineLoses(l: Caption, w: Caption, fields: readonly string[], after: Project): string | null {
  const a = after.captions.find((x) => x.id === l.id)
  // (a) Gone whole.
  if (!a) return fields[0]
  // (b) The op writes the very field (a line that only lost words writes none).
  const wrote = new Set(lineDiffers(a, l))
  const over = fields.find((k) => wrote.has(k))
  if (over) return over
  if (!worded(l) || (a.words?.length ?? 0) >= (l.words?.length ?? 0)) return null
  // (c) The words that go: one someone retyped, or marked, goes with them; a
  // text of their own (not the words joined) is rebuilt from the words left.
  const kept = new Set<number>()
  let j = 0
  const aw = wordTexts(a)
  wordTexts(l).forEach((t, i) => {
    if (j < aw.length && aw[j] === t) {
      kept.add(i)
      j++
    }
  })
  const goneIdx = (l.words ?? []).map((_, i) => i).filter((i) => !kept.has(i))
  const read = wordTexts(w)
  if ((fields.includes('words') || fields.includes('text')) && goneIdx.some((i) => !read.includes(l.words![i].text))) return 'words'
  if (fields.includes('marks') && goneIdx.some((i) => (l.marks ?? []).includes(i))) return 'marks'
  if (fields.includes('text') && l.text !== l.words!.map((x) => x.text.trim()).filter(Boolean).join(' ') && a.text !== l.text) return 'text'
  return null
}

/** K1: what an op of the session wrote and made, noted as its own (going
 *  from `before` to `after`). */
function noteK1(before: Project, after: Project, ctx: ReplayContext): void {
  if (before.clips !== after.clips) {
    for (const [id, a] of Object.entries(after.clips)) {
      const b0 = Object.hasOwn(before.clips, id) ? before.clips[id] : undefined
      if (b0 === a) continue
      const solid = oneToOne(after, a)
      const inst = instanceOf(a)
      const was = piecesLike(before, a, solid)
      if (!piecesOf(before, inst).length) {
        ctx.own.set(`k1 made|${inst}`, a)
        continue
      }
      const [lo, hi] = solid ? windowOf(a) : [-Infinity, Infinity]
      for (const w of was) for (const k of clipDiffers(a, w, solid)) k1Write(ctx, inst, k, lo, hi, (a as unknown as Record<string, unknown>)[k])
    }
  }
  if (before.captions !== after.captions) {
    const was = new Map(before.captions.map((c) => [c.id, c]))
    for (const a of after.captions) {
      const b = was.get(a.id)
      if (b === a) continue
      if (!b) ctx.own.set(`k1 made|${recKey('line', a.id)}`, a)
      else {
        // (Its own words and text, also where it only took words out: a later
        // retype of its own is then still the session's.)
        const fields = new Set([...lineDiffers(a, b), ...(['words', 'text', 'marks'] as const).filter((k) => !sameDeep(lineVal(a, k), lineVal(b, k)))])
        for (const k of fields) k1Write(ctx, recKey('line', a.id), k, -Infinity, Infinity, lineVal(a, k))
      }
    }
  }
  for (const kind of ['marker', 'template'] as const) {
    const x = (kind === 'marker' ? before.markers : before.templates) as readonly ({ id: string } & Record<string, unknown>)[] | undefined
    const y = (kind === 'marker' ? after.markers : after.templates) as readonly ({ id: string } & Record<string, unknown>)[] | undefined
    if (x === y) continue
    const was = new Map((x ?? []).map((r) => [r.id, r]))
    const place = kind === 'marker' ? ['id', 'time'] : ['id', 'start', 'duration']
    for (const a of y ?? []) {
      const b = was.get(a.id)
      if (b === a) continue
      if (!b) ctx.own.set(`k1 made|${recKey(kind, a.id)}`, a)
      else for (const k of Object.keys({ ...a, ...b })) if (!place.includes(k) && !sameDeep(a[k], b[k])) k1Write(ctx, recKey(kind, a.id), k, -Infinity, Infinity, a[k])
    }
  }
}

/** Two pieces of one content set alike: every field but where they lie is
 *  the same, or the difference is the session's own write on either. */
function setAlike(c: Clip, ref: Clip, ctx: ReplayContext): boolean {
  const inst = instanceOf(c)
  const own = (x: Clip, k: string): boolean => k1Own(ctx, inst, k, windowOf(x)[0], windowOf(x)[1], (x as unknown as Record<string, unknown>)[k])
  return clipDiffers(c, ref, true).every((k) => own(c, k) || own(ref, k))
}

/** K1 on an op's run from `p` to `q`, before anything of it is kept: a drop
 *  with the sentence when it destroyed or wrote over someone else's change. */
function k1(p: Project, q: Project, op: Op, ctx: ReplayContext): void {
  const lost = op.seen ? lostChange(p, q, op.seen, ctx, op.liveUnder) : null
  if (lost) drop(lost)
}

// ---- apply: the op on the project as it is ---------------------------------------

type Applied = { project: Project; result?: unknown; cuts?: Iv[]; notes?: string[]; left?: number[]; scope?: string }
class Drop extends Error {}
const drop = (reason: string): never => {
  throw new Drop(reason)
}

const LOST_WORD = 'a subtitle word whose sound is still there would be lost'
const errorText = (e: unknown): string => (e instanceof Error ? e.message.split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] : String(e))

/** May an op that is not a cut change these subtitles? Only worded lines,
 *  and only as their sound went (a clip trimmed or deleted under them):
 *  `anchor` null says the op may not change subtitles at all. Returns what
 *  is wrong, or null. */
function subtitlesOff(before: Project, after: Project, d: Diff, anchor: string | null | undefined): string | null {
  if (none(d.captions)) return null
  if (!anchor) return 'it would change subtitles'
  const was = new Map(before.captions.map((c) => [c.id, c]))
  const now = new Map(after.captions.map((c) => [c.id, c]))
  for (const id of [...d.captions.changed, ...d.captions.removed]) if (!worded(was.get(id))) return 'it would change a title'
  for (const id of d.captions.added) if (!worded(now.get(id))) return 'it would add a title'
  return wordsHold(before, after, anchor, [], true)
}

/** Subtitles stay on their sound (A2, invariant 1): every word of a line the
 *  op changed starts on a second of anchor content a word started on before
 *  — or, where a cut took that very second, where the cut closed. With
 *  `both`, also: no word whose sound is still there was lost. */
/** A literal run that loses a subtitle word whose sound stays (4A's K-1
 *  guard; since Ç2b.1 fixed K-1 no command trips it, a test calls it). */
export function losesWords(before: Project, after: Project, anchor: string | null): boolean {
  return !!anchor && wordsHold(before, after, anchor, [], true) === LOST_WORD
}

export function wordsHold(before: Project, after: Project, anchor: string, closed: readonly Piece[], both = false): string | null {
  if (before.captions === after.captions) return null
  const was = new Map(before.captions.map((c) => [c.id, c]))
  const starts = new Map<string, number[]>()
  /** Each word's start and middle, as content of one instance. */
  const whole = new Map<string, [number, number][]>()
  // Words already over nothing (a trim's leftover, a line the user moved):
  // not this op's doing. Only MORE of them is.
  let bare = 0
  for (const c of before.captions) {
    if (!c.words?.length || c.manual || c.shape) continue
    for (const w of c.words) {
      const pt = pointAt(before, anchor, w.start) ?? pointAt(before, anchor, w.start, true)
      if (!pt) {
        bare++
        continue
      }
      const list = starts.get(pt.inst)
      if (list) list.push(pt.m)
      else starts.set(pt.inst, [pt.m])
      const mid = pointAt(before, anchor, (w.start + w.end) / 2)
      whole.set(pt.inst, [...(whole.get(pt.inst) ?? []), [pt.m, mid && mid.inst === pt.inst ? mid.m : pt.m]])
    }
  }
  for (const list of starts.values()) list.sort((x, y) => x - y)
  const has = (inst: string, m: number): boolean => {
    const list = starts.get(inst)
    if (!list) return false
    let lo = 0
    let hi = list.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (Math.abs(list[mid] - m) <= 1e-4) return true
      if (list[mid] < m) lo = mid + 1
      else hi = mid - 1
    }
    return false
  }
  for (const c of after.captions) {
    if (!c.words?.length || c.manual || c.shape) continue
    const same = was.get(c.id) === c
    for (const w of c.words) {
      const pt = pointAt(after, anchor, w.start) ?? pointAt(after, anchor, w.start, true)
      if (!pt) {
        if (--bare < 0) return `the word "${w.text}" would be left with no sound under it`
        continue
      }
      if (same) continue
      if (has(pt.inst, pt.m)) continue
      if (closed.some((p) => p.inst === pt.inst && (Math.abs(p.hi - pt.m) <= 1e-4 || Math.abs(p.lo - pt.m) <= 1e-4))) continue
      return `the subtitle word "${w.text}" would come off its sound`
    }
  }
  if (!both) return null
  // The other way round: a word whose sound is still on the timeline is
  // still a word.
  const kept = new Map<string, number[]>()
  for (const c of after.captions) {
    if (!worded(c)) continue
    for (const w of c.words!) {
      const pt = pointAt(after, anchor, w.start) ?? pointAt(after, anchor, w.start, true)
      if (pt) kept.set(pt.inst, [...(kept.get(pt.inst) ?? []), pt.m])
    }
  }
  // (A word whose start OR middle went with its sound may go with it; one
  // whose sound is all still there may not.)
  for (const [inst, list] of whole) {
    const cover = coverOf(after, inst)
    const have = kept.get(inst) ?? []
    // (A word that starts with a piece of its sound is on that sound.)
    const there = (m: number): boolean => cover.some(([a, b]) => m >= a - 1e-4 && m < b - 1e-3)
    for (const [m, mid] of list) {
      if (!there(m) || !there(mid)) continue
      if (!have.some((x) => Math.abs(x - m) <= 1e-4)) return LOST_WORD
    }
  }
  return null
}

function applyCut(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext, baseLive: number): Applied {
  const anchor = op.anchor!
  // What the agent's own earlier edits put into a range is not the user's:
  // on the first run, with no change of the user's since the read, whatever
  // lies in a range lies there by the agent's doing.
  const first = !op.ranges!.some((r) => r.met)
  // (A lock is no version of the film, but a track unlocked since the read
  // is footage the agent did not see go with its cut.)
  const foreign = ctx.userChangedSince(op.baseLive ?? baseLive) || (op.locks !== undefined && op.locks !== locksOf(p))
  const lenient = first && !foreign
  if (isLocked(p, anchor)) drop(`track ${anchor} is locked: left as it is`)
  const over = overlapOn(p, anchor)
  if (over) drop(`clips ${over[0]} and ${over[1]} lie over each other on track ${anchor}: a cut there has no one meaning; not cut`)
  const notes: string[] = []
  const left = new Set<number>()
  const seen: Inside[][] = []
  const twiceAt: boolean[] = []
  const located: { range: number; span: Iv }[] = []
  let slivers = 0
  op.ranges!.forEach((r, i) => {
    // A retake is cut FOR the take that is kept: with that take gone (less
    // than half of it still plays), this would cut the only one left.
    if (r.keep?.length) {
      const all = r.keep.reduce((n, k) => n + k.hi - k.lo, 0)
      const there = r.keep.reduce((n, k) => n + lenOf(overlap(coverOf(p, k.inst), [[k.lo, k.hi]])), 0)
      if (all > 0 && there < all / 2) {
        notes.push(`range ${i + 1}: the take it was cut for is gone; not cut`)
        left.add(i)
        return
      }
    }
    // K2: footage that plays in two places now and did not when the cut was
    // first made: the place that came later is not cut — nor, since which
    // one that is cannot be told for sure, the first (said). Footage in two
    // places at the first run is cut in both, and said so.
    const twice = shownTwice(p, r.pieces)
    if (!first && twice && r.twice === false) {
      notes.push(`range ${i + 1}: its footage plays in more than one place now (a piece was slipped, extended or put back after it was cut first): not cut`)
      left.add(i)
      return
    }
    if (first) twiceAt[i] = twice
    // A range is cut whole or not at all (it may lie in several places now).
    const mine: { range: number; span: Iv }[] = []
    let put: Inside | undefined
    for (const span of spansOf(p, r.pieces)) {
      if (span[1] - span[0] < SLIVER) {
        slivers++
        continue
      }
      const inside = insideOf(p, anchor, span[0], span[1])
      // What lies in it now and did not lie there SO when it was read (new,
      // or moved against the footage the edit follows), and is not there by
      // this session's own doing.
      const fresh = lenient ? [] : inside.filter((x) => !known(x, [r.had, r.met, ctx.made], ctx.moved))
      if (lenient) seen[i] = [...(seen[i] ?? []), ...inside]
      if (fresh.length) put ??= fresh[0]
      else mine.push({ range: i, span })
    }
    if (put) {
      notes.push(`range ${i + 1}: ${sayInside(put)} lies in it now and did not (there) when you read it (something you did not make); not cut`)
      left.add(i)
    } else located.push(...mine)
  })
  // (Whose doing it is that nothing is left to cut: said as it is.)
  if (!located.length) drop(notes.length ? notes.join('; ') : slivers ? 'too short to cut (under 0.02 s)' : foreign ? 'already cut: its footage is no longer on the timeline (it was removed after you read it)' : 'already cut by your own earlier edit: its footage is gone, nothing to resend')
  const done = (r: Applied): Applied => {
    if (first) op.ranges!.forEach((x, i) => ((x.met = seen[i] ?? []), (x.twice = twiceAt[i] ?? false)))
    return r
  }
  /** A track that is locked stays as it is under a cut: said, when it has
   *  footage from the first cut on (it is out of step with the rest now). */
  const lockedNote = (spans: readonly Iv[]): { notes?: string[] } => {
    const from = Math.min(...spans.map((x) => x[0]))
    const stay = p.tracks.filter((t) => t.id !== anchor && t.locked && clipsOn(p, t.id).some((c) => c.start + c.duration > from + EXACT))
    return stay.length ? { notes: stay.map((t) => `track ${t.id} is locked: left as it is (it is out of step with the cut footage now)`) } : {}
  }
  const meant = new Map<string, Iv[]>()
  for (const r of op.ranges!) for (const x of r.pieces) meant.set(x.inst, [...(meant.get(x.inst) ?? []), [x.lo, x.hi]])
  const closed = op.ranges!.flatMap((r) => r.pieces)
  /** The cut of these spans, when it takes what was meant and nothing else. */
  const attempt = (spans: readonly Iv[]): { project: Project; result: unknown } | string => {
    let out: { project: Project; results: unknown[] }
    try {
      out = run(p, [{ name: op.name, params: { ranges: spans } }], env)
    } catch (e) {
      return errorText(e)
    }
    const q = out.project
    for (const inst of new Set(clipsOn(p, anchor).filter((c) => oneToOne(p, c)).map(instanceOf))) {
      const sp = Math.max(0.01, piecesOf(p, inst)[0]?.speed ?? 1)
      const before = coverOf(p, inst)
      const went = without(before, coverOf(q, inst))
      const want = merge(meant.get(inst) ?? [])
      if (without(went, want).some(([a, b]) => b - a > SLIVER * sp + EXACT)) return 'it would cut footage the edit did not mean'
    }
    const bad = wordsHold(p, q, anchor, closed)
    if (bad) return bad
    // K1: nothing of someone else's that the agent did not see goes with it.
    const lost = op.seen ? lostChange(p, q, op.seen, ctx, op.liveUnder) : null
    return lost ?? { project: q, result: out.results[0] }
  }
  const all = located.map((x) => x.span)
  let got = attempt(all)
  // (A range is cut whole or not at all: the halving goes by ranges, each
  // with every place it lies in now.)
  const byRange: { range: number; spans: Iv[] }[] = []
  for (const x of located) {
    const same = byRange.find((y) => y.range === x.range)
    if (same) same.spans.push(x.span)
    else byRange.push({ range: x.range, spans: [x.span] })
  }
  if (typeof got === 'string' && byRange.length > 1) {
    // One bad range does not take the others with it: found by halving.
    const good: Iv[] = []
    const solve = (list: { range: number; spans: Iv[] }[]): void => {
      const r = attempt(list.flatMap((x) => x.spans))
      if (typeof r !== 'string') good.push(...list.flatMap((x) => x.spans))
      else if (list.length === 1) {
        notes.push(`range ${list[0].range + 1}: ${r}; not cut`)
        left.add(list[0].range)
      } else {
        solve(list.slice(0, list.length >> 1))
        solve(list.slice(list.length >> 1))
      }
    }
    solve(byRange)
    // (Why each range was not cut is said, not only that none was.)
    got = good.length ? attempt(good.sort((x, y) => x[0] - y[0])) : `none of its ranges could be cut as meant: ${notes.join('; ')}`
    if (typeof got !== 'string') return done({ project: got.project, result: got.result, cuts: cutOf(got.result) ?? mergeCutRanges(good), ...lockedNote(good), ...(notes.length ? { notes: [...notes, ...(lockedNote(good).notes ?? [])], left: [...left] } : {}) })
  }
  if (typeof got === 'string') return drop(got)
  // What was meant and is still there went (but for a sliver the command leaves).
  for (const [inst, list] of meant) {
    const sp = Math.max(0.01, piecesOf(p, inst)[0]?.speed ?? 1)
    const dropped = notes.length > 0
    if (!dropped && overlap(merge(list), coverOf(got.project, inst)).some(([a, b]) => b - a > SLIVER * sp + EXACT)) return drop('it would leave footage it meant to cut')
  }
  return done({ project: got.project, result: got.result, cuts: cutOf(got.result) ?? mergeCutRanges(all), ...lockedNote(all), ...(notes.length ? { notes: [...notes, ...(lockedNote(all).notes ?? [])], left: [...left] } : {}) })
}

function applyPlace(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext, baseLive: number): Applied {
  const anchor = op.anchor!
  if (isLocked(p, anchor)) drop(`track ${anchor} is locked now: the edit cannot follow its footage`)
  const foreign = ctx.userChangedSince(op.baseLive ?? baseLive) || (op.locks !== undefined && op.locks !== locksOf(p))
  let at = locate(p, op.point!, op.edge === 'end')
  let time: number
  if (at === 'ambiguous') return drop('the footage at its time is on the timeline more than once')
  if (at === 'gone' && !op.edge) {
    // (T6: the session's own op of this replay cut that very footage.)
    const by = [...(ctx.steps ?? [])].reverse().find((s) => locate(s.before, op.point!) !== 'gone' && locate(s.after, op.point!) === 'gone')
    if (by) drop(`the footage at its time was cut by your own op #${by.sent + 1} (${by.name}${by.seq === ctx.now ? '' : ` of call #${by.seq}`}): place it on the take that stays`)
  }
  if (at === 'gone') {
    // "At the start" and "at the end" of the footage are places of their
    // own: the session's own cut of that very footage does not take them
    // away. Someone else's change does — on the first run and on every
    // replay after it (K7): the edge is then no longer the one that was read.
    // (Taken by someone else: gone from the live project the replay starts
    // from, with a change of someone else's since the read.)
    const list = clipsOn(p, anchor).filter((c) => oneToOne(p, c))
    const theirs = foreign && (!ctx.live || locate(ctx.live, op.point!, op.edge === 'end') === 'gone')
    if (!op.edge || !list.length || theirs) return drop(op.edge && list.length ? `the ${op.edge} of the footage was changed after you read it (not by you): the footage at its time is gone; not placed` : 'content was removed: the footage at its time is no longer on the timeline')
    time = op.edge === 'start' ? list[0].start : Math.max(...list.map((c) => c.start + c.duration))
  } else time = at.time
  // The other sound under it lies as it lay against the footage it follows
  // (a music bed slid under the talk: the moment is another one to the ear).
  const under = soundUnder(p, anchor, time)
  const lenient = op.metUnder === undefined && !foreign
  const moved = lenient ? undefined : under.find((x) => !within(op.under, x) && !within(op.metUnder, x) && !within(ctx.made, x))
  if (moved) drop(`${sayInside(moved)} lies under it now and did not (there) when you read it (something you did not make): the moment is not the one you read`)
  const out = run(p, [{ name: op.name, params: { ...op.params, time } }], env)
  const d = diff(p, out.project)
  const made = op.name === 'marker.add' ? d.markers : d.captions
  const rest = op.name === 'marker.add' ? d.captions : d.markers
  if (made.added.length !== 1 || made.removed.length || made.changed.length || !none(rest) || !none(d.clips) || !none(d.templates) || !none(d.tracks) || d.other.length) drop('it would now also change other things')
  // Its whole length lies over the footage it lay over when it was read:
  // footage that came back (or was put) under it is not what was titled.
  if (op.span) {
    const now = out.project.captions.find((c) => c.id === made.added[0])!
    // (Footage that plays AFTER all it lay over — later in its source, or
    // another clip — is what a cut inside its length pulled under its end:
    // that is how a title of a fixed length behaves. Footage of a clip that
    // plays BEFORE footage it lay over, and was not under it, came back or
    // was put there.)
    const meant = new Map<string, Iv[]>()
    for (const x of op.span) meant.set(x.inst, [...(meant.get(x.inst) ?? []), [x.lo, x.hi]])
    for (const c of clipsOn(out.project, anchor)) {
      const lo = Math.max(now.start, c.start)
      const hi = Math.min(now.end, c.start + c.duration)
      const was = merge(meant.get(instanceOf(c)) ?? [])
      if (hi - lo <= EXACT || !oneToOne(out.project, c) || !was.length) continue
      const a = shownAt(c, lo)
      const b = shownAt(c, hi)
      for (const [x, y] of without([[Math.min(a, b), Math.max(a, b)]], was)) {
        const before = c.reversed ? was.some((w) => w[0] < y - EXACT) : was.some((w) => w[1] > x + EXACT)
        if (before && y - x > (SLIVER + EXACT) * Math.max(0.01, c.speed ?? 1)) drop('footage came back (or was put) under its length after you read it: it would lie over footage it was not written for')
      }
    }
  }
  k1(p, out.project, op, ctx)
  if (op.metUnder === undefined) op.metUnder = under
  return { project: out.project, result: out.results[0] }
}

/** The clips that show now what a named clip showed. */
function targetsOf(p: Project, r: ClipRef): Clip[] {
  // A clip with no clock of its own (a still, a held frame): every piece of
  // it (whether it is still the clip that was read is asked by its lay).
  if (!r.solid) {
    const anchor = anchorTrack(p)
    const meets = (c: Clip): boolean =>
      r.over?.length && anchor
        ? piecesIn(p, anchor, c.start, c.start + c.duration).pieces.some((x) => r.over!.some((y) => y.inst === x.inst && Math.min(x.hi, y.hi) - Math.max(x.lo, y.lo) > EXACT))
        : !!r.span && c.start < r.span[1] - EXACT && c.start + c.duration > r.span[0] + EXACT
    return piecesOf(p, r.inst).filter((c) => c.id === r.id || meets(c))
  }
  return piecesOf(p, r.inst).filter((c) => oneToOne(p, c) && lenOf(overlap([windowOf(c)], [[r.lo, r.hi]])) > EXACT)
}

function expected(op: Op, key: string, field: string, cur: unknown, ctx: ReplayContext): boolean {
  // As it was read (an earlier edit of the session this one first ran after
  // may not be there: the user accepted this one alone).
  if (sameValue(cur, op.writes![field][0])) return true
  if (op.met) return sameValue(cur, op.met[field])
  // What this session wrote itself is not the user's change.
  return ctx.own.has(`${key}|${field}`) && sameValue(cur, ctx.own.get(`${key}|${field}`))
}

/** This session's own writes of one field on one instance: each with the
 *  source window of the piece it was written on (a clip the session split
 *  may carry a value per piece). */
type OwnWrite = { lo: number; hi: number; value: unknown }
const OWN_WRITES = 64

function ownWrote(ctx: ReplayContext, key: string, field: string, c: Clip, solid: boolean, cur: unknown): boolean {
  const list = (ctx.own.get(`${key}|${field}`) as OwnWrite[] | undefined) ?? []
  const [lo, hi] = solid ? windowOf(c) : [-Infinity, Infinity]
  // The last one written on footage this piece shows.
  for (let i = list.length - 1; i >= 0; i--) if (Math.min(hi, list[i].hi) - Math.max(lo, list[i].lo) > EXACT) return sameValue(cur, list[i].value)
  return false
}

function noteOwn(ctx: ReplayContext, key: string, field: string, c: Clip, solid: boolean, value: unknown): void {
  const [lo, hi] = solid ? windowOf(c) : [-Infinity, Infinity]
  const list = ((ctx.own.get(`${key}|${field}`) as OwnWrite[] | undefined) ?? []).filter((w) => w.lo !== lo || w.hi !== hi)
  list.push({ lo, hi, value })
  ctx.own.set(`${key}|${field}`, list.slice(-OWN_WRITES))
}

function applyRecord(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext, baseLive: number): Applied {
  const del = op.name === 'clip.delete'
  let targets: Clip[] = []
  let edge: Clip | undefined
  // A clip with no clock of its own has only its id and how it lay: cut in
  // two, moved or made longer or shorter by anyone but this session since
  // it was read, it is not the clip the op named.
  if (op.lay !== undefined) {
    const now = layOf(p, op.clips![0], anchorTrack(p))
    const ok = op.metLay !== undefined ? now === op.metLay : now === op.lay || !ctx.userChangedSince(op.baseLive ?? baseLive)
    if (!ok) drop(`${op.clips![0].id} was cut in two, moved or changed in length after you read it (it has no footage of its own to be found by): not changed`)
    op.metLay ??= now
  }
  let apart: string | undefined
  for (const r of op.clips!) {
    const list = targetsOf(p, r)
    if (!list.length) drop(`content was removed: ${r.id} is no longer on the timeline`)
    for (const c of list) {
      if (r.solid) {
        const [lo, hi] = windowOf(c)
        if (lo < r.lo - SLIVER || hi > r.hi + SLIVER) drop(`${r.id} is part of a longer clip now (${c.id}): it would reach footage the edit did not name`)
      }
      if (isLocked(p, c.trackId)) drop(`track ${c.trackId} is locked: left as it is`)
      if (!targets.includes(c)) targets.push(c)
    }
    // (P2) A piece other than the one named is the clip named only while it
    // still belongs to it: on its track, joined to it (through the other
    // pieces of it), set as it is. A piece someone carried off or restyled
    // is theirs: the op is not made. (With no one else's change since the
    // read, every piece lies where the session's own edits left it.)
    if (r.solid && ctx.userChangedSince(op.baseLive ?? baseLive)) {
      const mine = targets.filter((c) => instanceOf(c) === r.inst)
      const named = mine.find((c) => c.id === r.id) ?? [...mine].sort((a, b) => a.start - b.start)[0]
      const row = mine.filter((c) => c.trackId === named.trackId).sort((a, b) => a.start - b.start)
      const at = row.indexOf(named)
      let lo = at
      let hi = at
      while (lo > 0 && Math.abs(row[lo - 1].start + row[lo - 1].duration - row[lo].start) <= 1e-3) lo--
      while (hi < row.length - 1 && Math.abs(row[hi].start + row[hi].duration - row[hi + 1].start) <= 1e-3) hi++
      const joined = new Set(row.slice(lo, hi + 1))
      const off = mine.find((c) => c !== named && (!joined.has(c) || !setAlike(c, named, ctx)))
      if (off) apart ??= `${r.id} was cut in pieces and ${off.id}, part of it, was moved or changed since you read it: ${K1_SAY}`
    }
  }
  if (!del) {
    // The edges of a clip cut in pieces are not the edges the op measured from.
    const r0 = op.clips![0]
    if ('fadeIn' in op.writes! || 'fadeOut' in op.writes! || ('transitionOut' in op.writes! && Object.keys(op.writes!).length > 1)) {
      if (targets.length !== 1 || Math.abs(windowOf(targets[0])[0] - r0.lo) > EXACT || Math.abs(windowOf(targets[0])[1] - r0.hi) > EXACT) drop('the clip was cut or trimmed: its edges are not the ones this was measured from')
    } else if ('transitionOut' in op.writes!) {
      // A transition out sits on the piece the clip ENDS with, and goes into
      // the clip that followed it when it was read.
      const last = targets.find((c) => Math.abs((c.reversed ? windowOf(c)[0] : windowOf(c)[1]) - (c.reversed ? r0.lo : r0.hi)) <= EXACT)
      if (!last) drop('the clip was cut or trimmed at its end: the edge this transition was set on is gone')
      if (op.follow !== undefined) {
        const f = followerOf(p, last!)
        const same = f && op.follow ? f.inst === op.follow.inst && Math.abs(f.m - op.follow.m) <= SLIVER : !f && !op.follow
        if (!same) drop('the clip that follows it is not the one that followed when you read it: the transition would go into other footage')
      }
      edge = last!
    }
  }
  // (The pieces of a clip the session split may each have a value: `met`
  // holds every value met. A transition is asked of EVERY piece — a cut
  // leaves it on the piece before the cut — and set on the last.)
  const met: Record<string, unknown[]> = {}
  const solid = op.clips![0].solid
  if (!del) {
    const key = op.clips![0].inst
    for (const c of targets) {
      for (const f of Object.keys(op.writes!)) {
        const cur = (c as unknown as Record<string, unknown>)[f]
        // (A piece that is not the clip's last: it has no transition, or one
        // this session set on the clip — a cut leaves it on the piece before.)
        const inner = f === 'transitionOut' && !!edge && c !== edge && (cur === undefined || ((ctx.own.get(`${key}|${f}`) as OwnWrite[] | undefined) ?? []).some((w) => sameValue(cur, w.value)))
        const ok = inner || sameValue(cur, op.writes![f][0]) || (op.met ? ((op.met[f] as unknown[] | undefined) ?? []).some((v) => sameValue(cur, v)) : ownWrote(ctx, key, f, c, solid, cur))
        if (!ok) drop(`${f} of this clip was changed after you read it (not by you)`)
        if (!(met[f] ??= []).some((v) => sameValue(cur, v))) met[f].push(cur)
      }
    }
  }
  // (Said after what the op itself writes was asked: that sentence is the plainer one.)
  if (apart) drop(apart)
  if (edge) targets = [edge]
  const ids = targets.map((c) => c.id)
  const calls: CommandCall[] = del ? [{ name: op.name, params: { ...op.params, ids } }] : ids.map((clipId) => ({ name: op.name, params: { ...op.params, clipId } }))
  const out = run(p, calls, env)
  // (clip.set leaves a keyed channel and sets the rest: said, and what it
  // leaves is not asked to have its value. Ç2c patch, item 8.)
  const keyed = new Map(op.name === 'clip.set' ? targets.map((c) => [c.id, setClipKeyed(c, op.params as { transform?: object; opacity?: number })] as const).filter(([, k]) => k.length > 0) : [])
  const left = (c: Clip, f: string): boolean => !!keyed.get(c.id)?.some((ch) => (ch === 'opacity' ? f === 'opacity' : f === 'transform'))
  const d = diff(p, out.project)
  if (!none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || d.clips.added.length) drop('it would now also change other things')
  const off = subtitlesOff(p, out.project, d, del ? anchorTrack(p) : null)
  if (off) drop(off)
  if (del ? !sameSet(d.clips.removed, ids) || !onlyLostTransition(p, out.project, d.clips.changed) : d.clips.removed.length > 0 || !d.clips.changed.every((id) => ids.includes(id))) drop('it would now also change other clips')
  if (del) {
    // A transition the delete takes off the clip before: only one it took
    // off in the version that was read, and still the one that was read.
    for (const id of d.clips.changed) {
      const c = p.clips[id]
      const was = op.lost?.[instanceOf(c)]
      if (was === undefined || !sameValue(was, c.transitionOut)) drop(`a transition into this clip was set on ${id} after you read it (not by you): deleting the clip would take it away`)
    }
  }
  if (!del) {
    for (const c of targets) {
      const now = out.project.clips[c.id]
      const fields = fieldsChanged(c, now)
      // (A field it did not change when it was sent: only one this session
      // set itself since — setting the volume of a clip it muted unmutes it.)
      const extra = fields.find((f) => !(f in op.writes!) && !ownWrote(ctx, op.clips![0].inst, f, c, solid, (c as unknown as Record<string, unknown>)[f]))
      if (extra) drop(`it would now also change ${extra}, which it did not when you sent it`)
      for (const f of Object.keys(op.writes!)) if (!left(c, f) && !sameValue((now as unknown as Record<string, unknown>)[f], op.writes![f][1])) drop(`it would set ${f} to another value than when you sent it`)
    }
  }
  k1(p, out.project, op, ctx)
  if (!del) {
    if (!op.met) op.met = met
    for (const c of targets) for (const f of Object.keys(op.writes!)) noteOwn(ctx, op.clips![0].inst, f, c, solid, left(c, f) ? (out.project.clips[c.id] as unknown as Record<string, unknown>)[f] : op.writes![f][1])
  }
  // (How much it reached: one piece of a talk cut in six is not "the talk".)
  const from = Math.min(...targets.map((c) => c.start))
  const to = Math.max(...targets.map((c) => c.start + c.duration))
  return { project: out.project, result: out.results[del ? 0 : out.results.length - 1], scope: `${ids.length} clip${ids.length === 1 ? '' : 's'}, ${from.toFixed(2)}–${to.toFixed(2)} s`, ...(keyed.size ? { notes: [...keyed].map(([id, k]) => keyedSay(id, k)) } : {}) }
}

function applyOwn(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext): Applied {
  const find = (pt: Point, endSide = false): { clip: Clip; time: number } => {
    const at = locate(p, pt, endSide)
    if (at === 'gone') return drop('content was removed: the footage at its point is no longer on the timeline')
    if (at === 'ambiguous') return drop('the footage at its point is on the timeline more than once')
    if (isLocked(p, at.clip.trackId)) return drop(`track ${at.clip.trackId} is locked: left as it is`)
    return at
  }
  /** The other pieces of the clip that lie wholly in what the op takes
   *  away (the clip was cut up since: they go with the trim). A piece only
   *  partly in it cannot be: the op is dropped. */
  const whole = (r: ClipRef, gone: Iv, keep: Clip): string[] => {
    const out: string[] = []
    for (const c of piecesOf(p, r.inst)) {
      if (c === keep || lenOf(overlap([windowOf(c)], [gone])) <= EXACT) continue
      const [lo, hi] = windowOf(c)
      if (lo < gone[0] - EXACT || hi > gone[1] + EXACT || isLocked(p, c.trackId)) drop(`the clip was cut in pieces: part of what this trims away is in ${c.id} now`)
      out.push(c.id)
    }
    // A piece goes with the trim only where it still belongs to the clip:
    // on its track, joined to it (through the other pieces that go), and set
    // as it is. A piece someone carried off or restyled is theirs.
    const chain = [keep, ...out.map((id) => p.clips[id])].sort((a, b) => a.start - b.start)
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i]
      const apart = i > 0 && Math.abs(c.start - (chain[i - 1].start + chain[i - 1].duration)) > 1e-3
      // (Set as it is: every field but where it lies — K1's comparison, no list.)
      const other = c.trackId !== keep.trackId || !setAlike(c, keep, ctx)
      if (c !== keep && (apart || other)) drop(`the clip was cut in pieces and ${c.id}, part of what this trims away, was moved or changed since: not trimmed`)
      if (c === keep && apart && out.length) drop(`the clip was cut in pieces and one of them was moved since: not trimmed`)
    }
    return out
  }
  let calls: CommandCall[]
  let touched: string[]
  let also: string[] = []
  let gone: { r: ClipRef; iv: Iv } | null = null
  if (op.name === 'clip.split') {
    const at = op.points!.map((pt) => find(pt))
    for (const x of at) if (x.time - x.clip.start < 0.05 || x.clip.start + x.clip.duration - x.time < 0.05) drop('its point is within 0.05 s of a clip edge now')
    calls = at.map((x) => ({ name: op.name, params: { ...op.params, clipIds: [x.clip.id], time: x.time } }))
    touched = at.map((x) => x.clip.id)
  } else if (op.name === 'clip.trimHead') {
    const r = op.clips![0]
    const x = find(op.points![0])
    const iv: Iv = x.clip.reversed ? [op.points![0].m, r.hi] : [r.lo, op.points![0].m]
    also = whole(r, iv, x.clip)
    gone = { r, iv }
    calls = [{ name: op.name, params: { ...op.params, clipId: x.clip.id, edge: x.time } }]
    touched = [x.clip.id]
  } else if (op.name === 'clip.trimEnd') {
    const r = op.clips![0]
    const x = find(op.points![0], true)
    const iv: Iv = x.clip.reversed ? [r.lo, op.points![0].m] : [op.points![0].m, r.hi]
    also = whole(r, iv, x.clip)
    gone = { r, iv }
    const delta = x.time - (x.clip.start + x.clip.duration)
    if (delta > -EXACT) drop('nothing left to do: the clip already ends there')
    calls = [{ name: op.name, params: { ...op.params, clipId: x.clip.id, delta } }]
    touched = [x.clip.id]
  } else {
    const r = op.clips![0]
    const a = find(op.points![0])
    const b = find(op.points![1], true)
    if (a.clip !== b.clip) drop('the clip was cut in pieces: its range is in more than one now')
    const lo = Math.min(op.points![0].m, op.points![1].m)
    const hi = Math.max(op.points![0].m, op.points![1].m)
    for (const c of piecesOf(p, r.inst)) if (c !== a.clip && lenOf(overlap([windowOf(c)], [[r.lo, r.hi]])) > EXACT) drop(`the clip was cut in pieces: part of it is in ${c.id} now`)
    gone = { r, iv: [r.lo, lo] }
    calls = [{ name: op.name, params: { ...op.params, clipId: a.clip.id, range: [a.time, b.time] } }]
    touched = [a.clip.id]
    void hi
  }
  if (also.length) calls = [{ name: 'clip.delete', params: { ids: also } }, ...calls]
  const out = run(p, calls, env)
  const d = diff(p, out.project)
  if (!none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || !sameSet(d.clips.removed, also)) drop('it would now also change other things (a packed track)')
  const off = subtitlesOff(p, out.project, d, anchorTrack(p))
  if (off) drop(off)
  if (!d.clips.changed.every((id) => touched.includes(id)) || d.clips.added.length !== (op.name === 'clip.split' ? touched.length : 0)) drop('it would now also change other clips')
  if (op.name === 'clip.split' && d.clips.changed.length !== touched.length) drop('nothing left to do: there is a cut at its point already')
  // A trim takes what it meant and nothing more (the clip may be longer now
  // than the one that was read: a cut of the agent's own not applied, a cut
  // the user took back).
  if (op.name !== 'clip.split') {
    const r = op.clips![0]
    const meant: Iv[] = op.name === 'clip.keepRange' ? without([[r.lo, r.hi]], [[Math.min(op.points![0].m, op.points![1].m), Math.max(op.points![0].m, op.points![1].m)]]) : [gone!.iv]
    const went = without(coverOf(p, r.inst), coverOf(out.project, r.inst))
    // (Not even a sliver: 0.02 s the user brought back went with the trim,
    // silently. Phase 11b, B17.)
    if (lenOf(without(went, meant)) > EXACT) drop('the clip is longer now than when you read it: the trim would take footage it did not mean')
  }
  if (gone && lenOf(overlap(coverOf(out.project, gone.r.inst), [gone.iv])) > EXACT && op.name !== 'clip.keepRange') drop('the command cannot trim that far (a clip is never shorter than 0.1 s): it would leave footage it meant to trim away')
  if (op.name !== 'clip.split' && !d.clips.changed.length) drop('nothing left to do')
  k1(p, out.project, op, ctx)
  return { project: out.project, result: out.results[out.results.length - 1] }
}

function applyLine(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext): Applied {
  const del = op.name === 'caption.delete'
  const anchor = op.anchor
  const targets: Caption[] = []
  let marks: number[] | undefined
  for (const l of op.lines!) {
    let t: Caption | undefined
    if (!l.keys) t = p.captions.find((c) => c.id === l.id)
    else if (anchor) {
      const same = (c: Caption): boolean => (c.words?.length ?? 0) === l.keys!.length && keysOf(p, anchor, c).every((k, i) => k === l.keys![i])
      const own = p.captions.find((c) => c.id === l.id)
      // A line this session retyped itself (its words were made anew) is
      // still the line it read.
      const mine = own && ctx.own.get(`line ${l.id}|keys`) === keysOf(p, anchor, own).join(' ')
      const found = own && (same(own) || mine) ? [own] : p.captions.filter((c) => !c.manual && !c.shape && same(c))
      if (found.length === 1) t = found[0]
      else if (l.marks && op.writes && Object.keys(op.writes).every((f) => f === 'marks')) {
        // Marks alone: the line that still holds every marked word.
        const holds = p.captions.filter((c) => !c.manual && !c.shape && c.words?.length && l.marks!.every((k) => keysOf(p, anchor, c).includes(k)))
        if (holds.length === 1) {
          t = holds[0]
          const keys = keysOf(p, anchor, t)
          marks = l.marks.map((k) => keys.indexOf(k))
        }
      }
    }
    if (!t && l.keys && anchor) {
      // The same words on the same sound, saying something else: retyped.
      const own = p.captions.find((c) => c.id === l.id)
      const where = (k: string | null): string | null => (k === null ? null : k.slice(0, k.indexOf('|')))
      if (own && (own.words?.length ?? 0) === l.keys.length && keysOf(p, anchor, own).every((k, i) => where(k) === where(l.keys![i]))) drop('the text of this line was changed after you read it (not by you)')
    }
    if (!t) drop(l.keys ? `line ${l.id} is not as you read it: its words changed, moved off their sound or are gone` : `there is no ${l.id} any more`)
    if (l.marks && l.keys && anchor && !marks) {
      // A mark is for a word: it goes where that word is in the line now.
      const keys = keysOf(p, anchor, t!)
      const at = l.marks.map((k) => keys.indexOf(k))
      if (at.some((i) => i < 0)) drop(`a word of line ${l.id} this marks is no longer in it`)
      marks = at
    }
    targets.push(t!)
  }
  const met: Record<string, unknown> = {}
  if (!del) {
    for (const f of Object.keys(op.writes!)) {
      if (f === 'marks' && marks) {
        // Marks are for words: the words marked now are those that were
        // marked when it was read (or this session marked them itself).
        const l = op.lines![0]
        const keys = keysOf(p, anchor!, targets[0])
        const cur = (targets[0].marks ?? []).map((i) => keys[i]).filter(Boolean).sort().join(' ')
        const own = ctx.own.get(`line ${l.id}|marked`)
        const ok = cur === [...(l.had ?? [])].sort().join(' ') || (op.met ? cur === op.met.marked : cur === own)
        if (!ok) drop('the marks of this line were changed after you read it (not by you)')
        met.marked = cur
        continue
      }
      const cur = (targets[0] as unknown as Record<string, unknown>)[f]
      if (!expected(op, `line ${op.lines![0].id}`, f, cur, ctx)) drop(`the ${f} of this line was changed after you read it (not by you)`)
      met[f] = cur
    }
  }
  const ids = targets.map((c) => c.id)
  const params: Record<string, unknown> = del ? { ...op.params, ids } : { ...op.params, id: ids[0] }
  if (marks) params.patch = { ...(op.params.patch as object), marks }
  const out = run(p, [{ name: op.name, params }], env)
  const d = diff(p, out.project)
  if (!none(d.clips) || !none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.length || d.captions.added.length) drop('it would now also change other things')
  if (del ? !sameSet(d.captions.removed, ids) || d.captions.changed.length > 0 : d.captions.removed.length > 0 || !d.captions.changed.every((id) => ids.includes(id))) drop('it would now also change other lines')
  if (!del) {
    const now = out.project.captions.find((c) => c.id === ids[0])!
    const extra = fieldsChanged(targets[0], now).find((f) => !PLACE_FIELDS.has(f) && !(f in op.writes!))
    if (extra) drop(`it would now also change the line's ${extra}, which it did not when you sent it`)
  }
  k1(p, out.project, op, ctx)
  if (!del) {
    const now = out.project.captions.find((c) => c.id === ids[0])!
    if (!op.met) op.met = met
    if (anchor && op.lines![0].keys) ctx.own.set(`line ${op.lines![0].id}|keys`, keysOf(out.project, anchor, now).join(' '))
    if (anchor && marks) ctx.own.set(`line ${op.lines![0].id}|marked`, (now.marks ?? []).map((i) => keysOf(out.project, anchor, now)[i]).filter(Boolean).sort().join(' '))
    for (const f of Object.keys(op.writes!)) ctx.own.set(`line ${op.lines![0].id}|${f}`, op.writes![f][1])
  }
  return { project: out.project, result: out.results[0] }
}

function applyField(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext): Applied {
  const met: Record<string, unknown> = {}
  for (const k of Object.keys(op.writes!)) {
    const cur = (p as unknown as Record<string, unknown>)[k]
    if (!expected(op, 'project', k, cur, ctx)) drop(`${k} was changed after you read it (not by you)`)
    met[k] = cur
  }
  const out = run(p, [{ name: op.name, params: op.params }], env)
  const d = diff(p, out.project)
  if (!none(d.clips) || !none(d.captions) || !none(d.markers) || !none(d.templates) || !none(d.tracks) || d.other.some((k) => !(k in op.writes!))) drop('it would now also change other things')
  if (!op.met) op.met = met
  for (const k of Object.keys(op.writes!)) ctx.own.set(`project|${k}`, op.writes![k][1])
  return { project: out.project, result: out.results[0] }
}

/** `p` with the magnets that `frame` had on and `p` has off switched back
 *  on (`p` itself when there is none): what `p` would be had no magnet been
 *  switched off since `frame`. Switching one off moves nothing. */
function magnetsBack(frame: Project, p: Project): Project {
  let any = false
  const tracks = p.tracks.map((t) => {
    if (t.autoPack || !frame.tracks.find((f) => f.id === t.id)?.autoPack) return t
    any = true
    return { ...t, autoPack: true }
  })
  return any ? { ...p, tracks } : p
}

/** Did the op only ADD records, and change nothing that was there? */
function addsOnly(d: Diff): boolean {
  const lists = [d.clips, d.captions, d.markers, d.templates, d.tracks]
  if (lists.some((l) => l.removed.length || l.changed.length)) return false
  if (d.other.some((k) => k !== 'assets')) return false
  return lists.some((l) => l.added.length > 0)
}

/** Every record of `frame` is in `p` as it was (same place, same footage),
 *  and its tracks in the same order: only additions lie between the two —
 *  the seconds and ids of `frame` still mean in `p` what they meant (C3). */
function onlyAddedSince(frame: Project, p: Project): boolean {
  if (frame === p) return true
  const near = (x: number | undefined, y: number | undefined): boolean => Math.abs((x ?? 0) - (y ?? 0)) <= EXACT
  const rows = p.tracks.filter((t) => frame.tracks.some((f) => f.id === t.id))
  if (rows.length !== frame.tracks.length || rows.some((t, i) => t.id !== frame.tracks[i].id || !!t.locked !== !!frame.tracks[i].locked || !!t.autoPack !== !!frame.tracks[i].autoPack)) return false
  for (const [id, x] of Object.entries(frame.clips)) {
    const y = clipOf(p, id)
    if (x === y) continue
    if (!y || x.trackId !== y.trackId || x.assetId !== y.assetId || !near(x.start, y.start) || !near(x.duration, y.duration) || !near(x.inPoint, y.inPoint) || (x.speed ?? 1) !== (y.speed ?? 1) || !sameCurve(x.speedCurve, y.speedCurve) || !!x.reversed !== !!y.reversed || x.linkId !== y.linkId) return false
  }
  const lines = new Map(p.captions.map((c) => [c.id, c]))
  for (const x of frame.captions) {
    const y = lines.get(x.id)
    if (x === y) continue
    if (!y || !near(x.start, y.start) || !near(x.end, y.end) || (x.words?.length ?? 0) !== (y.words?.length ?? 0) || (x.words ?? []).some((w, k) => !near(w.start, y.words![k].start))) return false
  }
  const marks = new Map((p.markers ?? []).map((m) => [m.id, m]))
  for (const x of frame.markers ?? []) if (!marks.has(x.id) || !near(marks.get(x.id)!.time, x.time)) return false
  const blocks = new Map((p.templates ?? []).map((t) => [t.id, t]))
  for (const x of frame.templates ?? []) if (!blocks.has(x.id) || !near(blocks.get(x.id)!.start, x.start)) return false
  return true
}

/** `target` with the records that going from `before` to `after` added (an
 *  op that only adds): in `after`'s order (K4). */
function withAdded(target: Project, before: Project, after: Project): Project {
  const d = diff(before, after)
  const clips = { ...target.clips }
  for (const id of d.clips.added) clips[id] = after.clips[id]
  const merged = <T extends { id: string }>(was: readonly T[] | undefined, now: readonly T[] | undefined, added: readonly string[]): T[] => {
    const have = new Map((was ?? []).map((x) => [x.id, x]))
    const fresh = new Set(added)
    const out = (now ?? []).filter((x) => have.has(x.id) || fresh.has(x.id)).map((x) => have.get(x.id) ?? x)
    for (const x of was ?? []) if (!out.includes(x)) out.push(x)
    return out
  }
  const tracks = merged(target.tracks, after.tracks, d.tracks.added).map((t) => {
    if (d.tracks.added.includes(t.id)) return { ...t, clipIds: t.clipIds.filter((id) => d.clips.added.includes(id)) }
    const more = d.clips.added.filter((id) => after.clips[id].trackId === t.id)
    return more.length ? { ...t, clipIds: [...t.clipIds, ...more] } : t
  })
  const assets = [...target.assets, ...after.assets.filter((a) => !target.assets.some((x) => x.id === a.id))]
  return { ...target, clips, tracks, assets, captions: merged(target.captions, after.captions, d.captions.added), markers: merged(target.markers, after.markers, d.markers.added), templates: merged(target.templates, after.templates, d.templates.added) }
}

/** A subtitle word found again by its content (anchor content under its
 *  start + its text): its start or end now; null when it is gone, was
 *  changed, or is there twice. */
const wordIndex = new WeakMap<Project, Map<string, { start: number; end: number }[]>>()
function wordNow(p: Project, anchor: string, key: string, end: boolean): number | null {
  let index = wordIndex.get(p)
  if (!index) {
    index = new Map()
    for (const c of p.captions) {
      if (!worded(c)) continue
      for (const w of c.words!) {
        const k = wordKey(p, anchor, w.start)
        if (k === null) continue
        const full = `${k}|${w.text}`
        index.set(full, [...(index.get(full) ?? []), w])
      }
    }
    wordIndex.set(p, index)
  }
  const hits = index.get(key)
  return hits?.length === 1 ? (end ? hits[0].end : hits[0].start) : null
}

/** A clip of a code film that an op added is as long as it was when the op
 *  was sent (audit A1): a film that learnt another length since (its page
 *  ran, the user put another folder in) does not make it longer or shorter
 *  (a code clip has no media end: any length plays). The length is set
 *  absolutely, from what the op did where it was sent. */
function heldLength(ref: { before: Project; after: Project }, q: Project): Project {
  let clips: Project['clips'] | null = null
  for (const id of diff(ref.before, ref.after).clips.added) {
    const x = ref.after.clips[id]
    const y = clipOf(q, id)
    if (!x || !y || x === y || Math.abs(x.duration - y.duration) <= EXACT) continue
    if (q.assets.find((a) => a.id === y.assetId)?.kind !== 'code' || x.assetId !== y.assetId) continue
    clips ??= { ...q.clips }
    clips[id] = { ...y, duration: x.duration }
  }
  return clips ? { ...q, clips } : q
}

/** An op that only adds, held to its effect (C5): on `p` it adds the very
 *  records it added in `ref` — the same ids, the same values, on the same
 *  tracks, over the same footage of the anchor, beside the same clips — and
 *  changes nothing else. What is wrong, or null. */
function sameAdding(ref: { before: Project; after: Project }, p: Project, q: Project): string | null {
  const d = diff(p, q)
  if (!addsOnly(d)) return 'it would now also change what is there'
  const r = diff(ref.before, ref.after)
  for (const k of ['clips', 'captions', 'markers', 'templates', 'tracks'] as const) if (!sameSet(d[k].added, r[k].added)) return 'it would not add now what it added when you sent it'
  const a0 = anchorTrack(ref.before)
  const a1 = anchorTrack(p)
  // The footage of the anchor under a time, before the op added anything.
  const under = (was: boolean, t: number, endSide = false): [string, number] => {
    const anchor = was ? a0 : a1
    return anchor ? spot(was ? ref.before : p, anchor, t, endSide) : ['-', 0]
  }
  /** The same place: over the same footage. Over none in both: the same
   *  second — and that second is the same place only while nothing that was
   *  there has moved (there is no footage to tell it by). */
  let still: boolean | undefined
  const samePlace = (t0: number, t1: number, endSide = false): boolean => {
    const x = under(true, t0, endSide)
    const y = under(false, t1, endSide)
    if (x[0] !== y[0]) return false
    if (x[0] !== '-') return Math.abs(x[1] - y[1]) <= 1e-4
    return Math.abs(t0 - t1) <= EXACT && (still ??= onlyAddedSince(ref.before, p))
  }
  const but = (o: object, ...keys: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
  const beside = (project: Project, c: Clip, added: readonly string[]): string => {
    const list = clipsOn(project, c.trackId).filter((x) => !added.includes(x.id))
    const prev = [...list].reverse().find((x) => x.start + x.duration <= c.start + EXACT)
    const next = list.find((x) => x.start >= c.start + c.duration - EXACT)
    return `${prev ? instanceOf(prev) : '-'}>${next ? instanceOf(next) : '-'}`
  }
  for (const id of d.clips.added) {
    const x = ref.after.clips[id]
    const y = q.clips[id]
    // (Phase 5e: a code clip's film learns its own size and length when its
    // page first runs — derived data, not an edit; the clip's fit and length
    // follow it. Only those may differ then.)
    const sized = (pr: Project): string => {
      const a = pr.assets.find((z) => z.id === x.assetId)
      return a?.kind === 'code' ? `${a.width}x${a.height}x${a.duration}` : ''
    }
    // (Its length is the one sent: held by heldLength, never the film's new
    // one — audit A1.)
    const refitted = sized(ref.after) !== '' && sized(ref.after) !== sized(q) && nearly(but(x, 'start', 'transform'), but(y, 'start', 'transform'))
    if (!refitted && !nearly(but(x, 'start'), but(y, 'start'))) return 'it would put a clip otherwise than when you sent it (another track, another length)'
    if (!samePlace(x.start, y.start)) return 'the footage under where it puts a clip is not the footage that was there when you sent it'
    if (beside(ref.after, x, r.clips.added) !== beside(q, y, d.clips.added)) return 'the clips beside where it puts a clip are not the ones that were there when you sent it'
  }
  const lines = new Map(q.captions.map((c) => [c.id, c]))
  for (const x of ref.after.captions) {
    if (!r.captions.added.includes(x.id)) continue
    const y = lines.get(x.id)!
    if (!nearly(but(x, 'start', 'end', 'words'), but(y, 'start', 'end', 'words')) || Math.abs(x.end - x.start - (y.end - y.start)) > EXACT) return 'it would add a title otherwise than when you sent it'
    if (!samePlace(x.start, y.start)) return 'the footage under where it puts a title is not the footage that was there when you sent it'
  }
  const marks = new Map((q.markers ?? []).map((m) => [m.id, m]))
  for (const x of ref.after.markers ?? []) if (r.markers.added.includes(x.id) && (!nearly(but(x, 'time'), but(marks.get(x.id)!, 'time')) || !samePlace(x.time, marks.get(x.id)!.time))) return 'the footage under its marker is not the footage that was there when you sent it'
  const blocks = new Map((q.templates ?? []).map((t) => [t.id, t]))
  for (const x of ref.after.templates ?? []) if (r.templates.added.includes(x.id) && (!nearly(but(x, 'start'), but(blocks.get(x.id)!, 'start')) || !samePlace(x.start, blocks.get(x.id)!.start))) return 'the footage under its G lane item is not the footage that was there when you sent it'
  const rows = new Map(q.tracks.map((t) => [t.id, t]))
  for (const x of ref.after.tracks) if (r.tracks.added.includes(x.id) && rows.get(x.id)!.kind !== x.kind) return 'it would add another kind of track'
  return null
}

/** The ranges a timeline.cutRanges really took out (its result: widened
 *  over slivers, phase Ç2b.1 K-3). */
function cutOf(result: unknown): Iv[] | undefined {
  const r = (result as { ranges?: Iv[] } | undefined)?.ranges
  return Array.isArray(r) ? r : undefined
}

/** Commands that cut time out by ranges: a word that starts in a range and
 *  lives on by its middle is theirs to move. */
const CUTTERS = new Set(['timeline.cutRanges', 'timeline.cutRangeOnTrack', 'silence.apply'])

/** K6: every time of the op is given by a word, and every clip it names
 *  lies in `p` as it lay in the version read (one piece, the same content). */
function byWordWhole(op: Op, p: Project): boolean {
  if (!op.addr?.length || !op.frame || op.addr.length !== countTimes(commandByName(op.name).params as never, op.params)) return false
  const ids = idsIn(commandByName(op.name).params as never, op.params, lastingId)
  return ids.every((id) => {
    const was = clipOf(op.frame!, id)
    const now = clipOf(p, id)
    if (!was) return false
    if (!now || instanceOf(now) !== instanceOf(was) || piecesOf(p, instanceOf(now)).length !== 1 || now.trackId !== was.trackId) return false
    const [a0, a1] = windowOf(was)
    const [b0, b1] = windowOf(now)
    return Math.abs(a0 - b0) <= EXACT && Math.abs(a1 - b1) <= EXACT
  })
}

/**
 * The region rule's ONE decision (the team mode, step 3; EKIP-3-PLAN.md §3).
 * `was` is the region of the op's worker as it lay in `from` — the version
 * the op was written in, or the project it first ran on — and `params` the
 * op in that project's seconds. The op may run on `p` when
 *   - the region is found in `p` and has only moved whole (the same length),
 *   - every second and every record the op names lies inside it, and
 *   - what is inside is the same there and here, counted from the region's
 *     start: the same layout for a first run (what sameLayout asks of the
 *     whole film), the same film for a replay (`exact`: what sameFilm asks).
 * Then its seconds are carried by exactly as much as the region moved — no
 * other mapping. Null: the rule does not hold (today's rule decides).
 */
function byRegion(op: Op, p: Project, from: Project, was: Iv | null, params: Record<string, unknown>, exact: boolean): { range: Iv; params: Record<string, unknown> } | null {
  if (!was || op.addr?.length) return null
  const now = carryRegion(from, p, was)
  if (!now || Math.abs(now[1] - now[0] - (was[1] - was[0])) > EXACT) return null
  if (!opInside(from, op.name, params, was)) return null
  const a = slab(from, was)
  const b = slab(p, now)
  if (!(exact ? sameFilm(a, b) : sameLayout(a, b))) return null
  const d = now[0] - was[0]
  return { range: now, params: d === 0 ? params : (mapTimes(commandByName(op.name).params as never, params, (t) => t + d) as Record<string, unknown>) }
}

function applyStructural(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext, baseLive: number): Applied {
  const why = op.demoted ? ` (${op.demoted})` : ''
  // Times that were given by a word: where that word is now (C4).
  // (An op that ran in its worker's region: as it ran there.)
  let params = op.zone?.params ?? op.params
  if (op.addr?.length) {
    const anchor = anchorTrack(p)
    for (const a of op.addr) {
      // The word is still there and says the same; the time is where the
      // footage that was under it is now.
      if (!anchor || wordNow(p, anchor, a.key, a.end) === null) drop('a word one of its times was given by is gone, was changed or is there twice: read again and resend')
      const at = locate(p, a.point, a.end)
      if (typeof at === 'string') drop(at === 'gone' ? 'the footage under a word one of its times was given by is gone: read again and resend' : 'the footage under a word one of its times was given by is on the timeline more than once')
      else params = setAt(params, a.path, at.time) as Record<string, unknown>
    }
  }
  const go = (): { project: Project; results: unknown[] } => run(p, [{ name: op.name, params }], env)
  /** A code clip it adds keeps the length it was sent with (audit A1). */
  const held = (o: { project: Project; results: unknown[] }, ref: { before: Project; after: Project }): { project: Project; results: unknown[] } => ({ ...o, project: heldLength(ref, o.project) })
  /** A literal run still may not lose a subtitle word whose sound stays. */
  const made = (out: { project: Project; results: unknown[] }): Applied => {
    const anchor = CUTTERS.has(op.name) || op.name.startsWith('caption.') ? null : anchorTrack(p)
    if (losesWords(p, out.project, anchor)) drop(`${LOST_WORD}: not made`)
    // (A cut that could follow no footage still cut: said with what it cut.)
    const end = projectDuration(p)
    const cuts = op.name === 'timeline.cutRanges' ? mergeCutRanges((cutOf(out.results[0]) ?? (params.ranges as Iv[])).map(([a, b]): Iv => [Math.max(0, a), Math.min(b, end)])) : undefined
    // A ripple delete with material on other tracks leaves the gap (Ç2b
    // patch, item 3): said with what it did.
    const gap = op.name === 'clip.delete' && !!params.ripple && !params.onlyItsTrack && rippleLeavesGap(p, deletableClipIds(p, (params.ids as string[]) ?? []))
    // A track-only close that could not keep a linked pair in step leaves
    // its gap too (22 Nov, K3): a range cut out of one track (its result
    // says it), a ripple delete on the clips' own tracks (its plan does).
    const name = (id: string | undefined): string => p.tracks.find((t) => t.id === id)?.name ?? String(id)
    const left = op.name === 'timeline.cutRangeOnTrack' ? (out.results[0] as { closed?: boolean; inTheWay?: string } | undefined) : undefined
    const stuck = op.name === 'clip.delete' && !!params.ripple && !!params.onlyItsTrack ? ownTrackClosePlan(p, deletableClipIds(p, (params.ids as string[]) ?? [])).blockedBy : undefined
    const notes = [
      ...(gap ? ['other tracks have material in that time: deleted without ripple, the gap stays (onlyItsTrack:true closes their own tracks)'] : []),
      ...(left && left.closed === false ? [`a linked clip after the range could not move up (track ${name(left.inTheWay)} is locked or has material there): the range was cut out, the gap stays (timeline.cutRanges closes every track)`] : []),
      ...(stuck !== undefined ? [`a linked clip after them could not move up (track ${name(stuck)} is locked or has material there): deleted, the gaps stay`] : [])
    ]
    return { project: out.project, result: out.results[0], ...(cuts?.length ? { cuts } : {}), ...(notes.length ? { notes } : {}) }
  }
  if (!op.ref) {
    // Its first run. On the project as it was read (no one else changed the
    // film, the locks are the same, and nothing that was there has moved —
    // earlier ops of this session may have ADDED: C3) it runs as written.
    const foreign = ctx.userChangedSince(op.baseLive ?? baseLive)
    const locked = op.locks !== undefined && op.locks !== locksOf(p)
    // (K6: an op whose every time is given by a word, naming clips that
    // still lie whole — the same content, not cut in pieces — is not moved by
    // the session's own edits: the words are found where they are now.)
    // (22 Nov: a track's magnet switched OFF since the version it was written
    // on moved nothing; the ids and times of that version mean what they
    // meant. So "track.setMagnet off, then move the clips" holds in one call,
    // and the user sees both in the draft. Switched ON is a move: not this.)
    const unpacked = op.frame ? magnetsBack(op.frame, p) : p
    const magnetOnly = !!op.frame && unpacked !== p && (sameLayout(unpacked, op.frame) || onlyAddedSince(op.frame, unpacked))
    const moved = !!op.frame && !sameLayout(p, op.frame) && !(op.fresh && onlyAddedSince(op.frame, p)) && !byWordWhole(op, p) && !magnetOnly
    // (The team mode, step 3: an op of a worker inside its own region runs
    // when only the region as a whole has moved since — byRegion; its
    // seconds are carried with the region.)
    const mine = ctx.as && !foreign && !locked && op.frame ? ctx.regions?.find((r) => r.as === ctx.as) : undefined
    const held0 = mine ? byRegion(op, p, op.frame!, placedIn(mine, op.frame!), params, false) : null
    const zone = held0 && (moved || held0.params === params) ? held0 : null
    if (!foreign && !locked && (!moved || zone)) {
      if (zone) params = zone.params
      const out = go()
      if (out.project === p || sameValue(p, out.project)) drop('nothing to do: it changes nothing')
      const r = made(out)
      k1(p, out.project, op, ctx)
      op.ref = { before: p, after: out.project, ...(addsOnly(diff(p, out.project)) ? { adds: true as const } : {}) }
      if (zone) op.zone = zone
      delete op.frame
      delete op.read
      return r
    }
    // Otherwise only an op that just ADDS, held to what it did in the
    // version it was read in (C5).
    if (op.read) {
      const out = held(go(), op.read)
      const off = sameAdding(op.read, p, out.project)
      if (off) drop(`${off}: read again and resend`)
      const r = made(out)
      k1(p, out.project, op, ctx)
      op.ref = { before: op.read.before, after: op.read.after, adds: true }
      delete op.frame
      delete op.read
      return r
    }
    if (foreign) drop(`the project was changed since you read it (not by you) and this edit depends on how everything lies${why}: read again and resend (an edit like this holds only while no one else changes the film)`)
    if (locked) drop(`a track was locked or unlocked since you read the project and this edit depends on how everything lies${why}: read again and resend`)
    // (K6: times given by words carry it only while every clip it names lies whole.)
    const words = op.addr?.length ? ' (times given by words carry an edit like this only while every clip it names lies whole and the same: one it names was cut in pieces or changed)' : ''
    // (T3: an op of this very call moved it: one op that moves or retimes per call.)
    const mover = moverOf(ctx)
    const here = mover.includes('of this call')
    drop(`its ids and times are of the version you read, and an earlier edit of yours${mover} moved or cut what was there${why}${words}: ${here ? 'send it in a call of its own, after reading again' : 'read again and send it with that v'} (what only ADDS — a clip, a title, a track — does not move anything)`)
  }
  const ref = op.ref!
  if (op.zone && !sameFilm(p, ref.before)) {
    // (The team mode, step 3: not the project it first ran on — another
    // worker's group was accepted first, or left out. Its region is as it
    // was, only elsewhere: it runs there, and must do there what it did.)
    const z = byRegion(op, p, ref.before, op.zone.range, op.zone.params, true)
    if (z) {
      params = z.params
      const out = ref.adds ? held(go(), ref) : go()
      const did = carryRegion(ref.before, ref.after, op.zone.range)
      const does = carryRegion(p, out.project, z.range)
      if (!did || !does || !sameFilm(slab(ref.after, did), slab(out.project, does))) drop('it would not do now in its region what it did when it was sent: read again and resend')
      k1(p, out.project, op, ctx)
      return made(out)
    }
  }
  if (ref.adds) {
    const out = held(go(), ref)
    const off = sameAdding(ref, p, out.project)
    if (off) drop(`${off}: read again and resend`)
    k1(p, out.project, op, ctx)
    return made(out)
  }
  if (!sameFilm(p, ref.before)) drop(`the project is not as it was when this was sent and it depends on how everything lies${why}: read again and resend (an edit like this holds only while no one else changes the film)`)
  const out = go()
  if (!sameFilm(out.project, ref.after)) drop('it would not do now what it did when it was sent: read again and resend')
  k1(p, out.project, op, ctx)
  return made(out)
}

/** One op on `p`: the project after and what the command returned; a Drop
 *  (with the reason) when it cannot be made as meant. */
function applyOp(p: Project, op: Op, env: CommandEnv, ctx: ReplayContext, baseLive: number): Applied {
  switch (op.family) {
    case 'cut':
      return applyCut(p, op, env, ctx, baseLive)
    case 'place':
      return applyPlace(p, op, env, ctx, baseLive)
    case 'record':
      return applyRecord(p, op, env, ctx, baseLive)
    case 'own':
      return applyOwn(p, op, env, ctx)
    case 'line':
      return applyLine(p, op, env, ctx)
    case 'field':
      return applyField(p, op, env, ctx)
    case 'add': {
      const out = run(p, [{ name: op.name, params: op.params }], env)
      k1(p, out.project, op, ctx)
      return { project: out.project, result: out.results[0] }
    }
    default:
      return applyStructural(p, op, env, ctx, baseLive)
  }
}

export interface Replayed {
  project: Project
  outcomes: Outcome[]
}

/** One op of an entry on `cur`: the project after (the same one when it was
 *  dropped) and what became of it. */
function step(cur: Project, entry: Pick<Entry, 'seq' | 'seed' | 'baseLive' | 'as'>, op: Op, index: number, ctx: ReplayContext): { project: Project; outcome: Outcome } {
  const head = { seq: entry.seq, index, name: op.from ? `apply ${op.from}` : op.name, command: op.name, ...(op.sent !== undefined ? { sent: op.sent } : {}), ...(op.also?.length ? { also: op.also } : {}) }
  if (op.retired) return { project: cur, outcome: { ...head, applied: false, reason: op.retired, ...(op.settled ? { settled: op.settled } : {}) } }
  try {
    ctx.now = entry.seq
    ctx.as = entry.as
    // (A clip the user locked against agents, and the stretch or clips the
    // user limited this work to: agent/scope.ts.)
    const held = lockedNamed(cur, op)
    if (held) drop(held)
    const r = applyOp(cur, op, envFor(entry.seed, index, cur, ctx.extra), ctx, entry.baseLive)
    if (r.project === cur || sameValue(cur, r.project)) return { project: cur, outcome: { ...head, applied: false, reason: 'nothing to do: the project already is as this would make it' } }
    const off = scopeBreach(cur, r.project, op, r.cuts)
    if (off) drop(off)
    // (The team mode, step 3: what is inside another worker's region is not
    // changed — shifted whole by a cut elsewhere, it is not changed.)
    const theirs = ctx.regions?.length ? regionBreach(cur, r.project, ctx.regions, entry.as, sameFilm) : null
    if (theirs) drop(theirs)
    // (K1: what it wrote and made is the session's own from here on.)
    noteK1(cur, r.project, ctx)
    ;(ctx.steps ??= []).push({ name: op.name, sent: op.sent ?? index, seq: entry.seq, before: cur, after: r.project })
    if (ctx.steps.length > 64) ctx.steps.shift()
    ctx.trace?.push({ seq: entry.seq, index, before: cur, after: r.project })
    if (ctx.made) {
      // What it put on the timeline, and where: the session's own THERE.
      const q = r.project
      const anchor = anchorTrack(q)
      const d = diff(cur, q)
      if (anchor) {
        for (const m of q.markers ?? []) if (d.markers.added.includes(m.id)) ctx.made.push(recordAs(q, anchor, 'marker', m.id, m.time))
        for (const c of q.captions) if (d.captions.added.includes(c.id) && (!c.words?.length || c.manual || c.shape)) ctx.made.push(recordAs(q, anchor, 'title', c.id, c.start, c.end))
        for (const t of q.templates ?? []) if (d.templates.added.includes(t.id)) ctx.made.push(recordAs(q, anchor, 'template', t.id, t.start, t.start + (t.duration ?? 0)))
        // (A clip of new footage — not a piece a cut split off footage that
        // was there: that is whoever's the footage was, where it lay.)
        for (const id of d.clips.added) if (q.clips[id].trackId !== anchor && !piecesOf(cur, instanceOf(q.clips[id])).length) ctx.made.push(...clipAs(q, anchor, q.clips[id], q.clips[id].start, q.clips[id].start + q.clips[id].duration))
      }
      if (ctx.made.length > MADE_MAX) ctx.made.splice(0, ctx.made.length - MADE_MAX)
      // Records it moved (a cut through a title shortens it, pulls it along):
      // from where to where.
      const before = anchorTrack(cur)
      if (ctx.moved && anchor && before) {
        const note = (kind: 'marker' | 'title' | 'template', id: string, a0: number, b0: number | undefined, a1: number, b1: number | undefined): void => {
          const from = recordAs(cur, before, kind, id, a0, b0)
          const to = recordAs(q, anchor, kind, id, a1, b1)
          if (!sameInside(from, to)) ctx.moved!.push([from, to])
        }
        // (Every record that was there before and after: the op may have
        // moved it, or taken the footage from under it.)
        const was = { m: new Map((cur.markers ?? []).map((x) => [x.id, x])), c: new Map(cur.captions.map((x) => [x.id, x])), t: new Map((cur.templates ?? []).map((x) => [x.id, x])) }
        if (cur.markers !== q.markers || cur.clips !== q.clips) for (const m of q.markers ?? []) if (was.m.has(m.id)) note('marker', m.id, was.m.get(m.id)!.time, undefined, m.time, undefined)
        if (cur.captions !== q.captions || cur.clips !== q.clips) for (const c of q.captions) if ((!c.words?.length || c.manual || c.shape) && was.c.has(c.id)) note('title', c.id, was.c.get(c.id)!.start, was.c.get(c.id)!.end, c.start, c.end)
        if (cur.templates !== q.templates || cur.clips !== q.clips) for (const t of q.templates ?? []) if (was.t.has(t.id)) note('template', t.id, was.t.get(t.id)!.start, was.t.get(t.id)!.start + (was.t.get(t.id)!.duration ?? 0), t.start, t.start + (t.duration ?? 0))
        if (ctx.moved.length > 4000) ctx.moved.splice(0, ctx.moved.length - 4000)
      }
    }
    return { project: r.project, outcome: { ...head, applied: true, result: r.result, ...(r.cuts ? { cuts: r.cuts } : {}), ...(r.notes ? { notes: r.notes } : {}), ...(r.left?.length ? { left: r.left } : {}), ...(r.scope ? { scope: r.scope } : {}) } }
  } catch (e) {
    // (An error no one foresaw is a drop too — said, and written to the
    // console: one fault must not leave a draft that can be neither read,
    // accepted nor rejected. Nothing of the op is in the project.)
    if (!(e instanceof Drop) && !(e instanceof CommandError)) {
      console.error('agent replay: an op failed unexpectedly', op.name, e)
      return { project: cur, outcome: { ...head, applied: false, reason: `internal error, not applied (${errorText(e).slice(0, 120)})`, fault: true } }
    }
    return { project: cur, outcome: { ...head, applied: false, reason: errorText(e).replace(new RegExp(`^${op.name.replace('.', '\\.')}: `), '') } }
  }
}

/**
 * The entries on `project`, op by op. An op that cannot be made as it was
 * meant is rolled back and dropped with its reason; the rest go on.
 */
export function replay(project: Project, entries: readonly Entry[], ctx: ReplayContext): Replayed {
  ctx.live ??= project
  let cur = project
  const outcomes: Outcome[] = []
  for (const entry of entries) {
    entry.ops.forEach((op, index) => {
      const r = step(cur, entry, op, index, ctx)
      cur = r.project
      outcomes.push(r.outcome)
    })
  }
  return { project: cur, outcomes }
}

/** A call of a new edit: the command, the project its numbers were read in,
 *  the analysis it came from. */
export interface NewCall {
  call: CommandCall
  base: Project
  from?: string
  sent?: number
  /** The live version `base` stood on, when it is not the edit's (an
   *  analysis result is read, and its "no one changed it" asked, in the
   *  version it was measured on). */
  baseLive?: number
  /** cut: per range, the takes it is cut for (a retake). */
  keeps?: Iv[][]
  /** A name the agent gave to what this op makes: later ops of the SAME
   *  call may name it where an id goes (the app makes the real id; S14). */
  alias?: string
  /** Its times that were given by a word. */
  words?: WordTime[]
  /** K1: the version the agent read the records in, when it is not `base`
   *  (an analysis result: the call's base, the agent's latest read). */
  seen?: Project
  /** K1: the version read was a draft: the live project under it. */
  under?: Project
  /** It cannot be made at all, and why (an apply that chose nothing): held
   *  as a dropped op, so the answer names it. */
  refused?: string
  /** The other ops (as sent, 0-based) made with it as one move. */
  also?: number[]
}

/** The first id a command returned (a new clip, title, marker, track…). */
function firstId(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map(firstId).find(Boolean)
  if (v && typeof v === 'object') for (const k of ['id', 'clipId', 'clipIds', 'trackId']) if (k in (v as object)) return firstId((v as Record<string, unknown>)[k])
  return undefined
}

/**
 * A new edit entering on `head` (the draft's project, or the live one): each
 * call is taken as content in the project it was read in, then applied on
 * what the calls before it left. A call that names something an earlier call
 * of the same edit made is read off the project that call left.
 */
export function enter(head: Project, meta: Omit<Entry, 'ops'>, calls: readonly NewCall[], ctx: ReplayContext): Replayed & { entry: Entry } {
  const entry: Entry = { ...meta, ops: [] }
  ctx.live ??= head
  // (The notes the user limited that are out with the agent now bound every
  // op of this call, on every replay: agent/scope.ts.)
  const scope = scopeOf(head)
  let cur = head
  const outcomes: Outcome[] = []
  /** What earlier ops of this call made, by the name the agent gave it. */
  const named = new Map<string, { index: number; id?: string }>()
  /** Each version the call was written on, with what its applied ops added. */
  const frames = new Map<Project, Project>()
  const frameOf = (b: Project): Project => {
    if (!frames.has(b)) frames.set(b, b)
    return frames.get(b)!
  }
  calls.forEach((c, index) => {
    let op: Op
    try {
      if (c.refused) throw new CommandError(c.call.name, c.refused)
      // (A name given earlier in the call, where an id goes: the id made.)
      let call = c.call
      const cmd = commandByName(call.name)
      const used = named.size ? idsIn(cmd.params as never, call.params).filter((v) => named.has(v)) : []
      if (used.length) {
        const gone = used.find((v) => !named.get(v)!.id)
        if (gone) throw new CommandError(call.name, `it needs what op #${named.get(gone)!.index + 1} of this call makes ("${gone}"), and that op was dropped`)
        call = { name: call.name, params: mapIds(cmd.params as never, call.params, (v) => named.get(v)?.id ?? v) as CommandCall['params'] }
      }
      if (c.alias !== undefined && (idsOf(c.base).has(c.alias) || idsOf(cur).has(c.alias) || named.has(c.alias))) throw new CommandError(call.name, `"${c.alias}" is the id of something in the project (or a name used twice): give what it makes another name`)
      // (K4: read on the version written for, with what the call's earlier
      // ops ADDED there: a track or a clip made earlier in the call is named.)
      op = captureOp(c.base, cur, call, meta.seed, index, ctx.extra, c.keeps, c.words, frameOf(c.base))
    } catch (e) {
      if (!(e instanceof CommandError)) throw e
      // (What it means could not be read: it is not held as an op that
      // could ever run — the user cannot bring it back either.)
      op = { name: c.call.name, params: (c.call.params ?? {}) as Record<string, unknown>, family: 'structural', retired: errorText(e).replace(new RegExp(`^${c.call.name.replace('.', '\\.')}: `), ''), uncaptured: true }
    }
    if (c.baseLive !== undefined) op.baseLive = c.baseLive
    op.seen = c.seen ?? c.base
    if (c.under) op.liveUnder = c.under
    if (c.from) op.from = c.from
    if (c.sent !== undefined) op.sent = c.sent
    if (c.also?.length) op.also = c.also
    if (scope) op.scope = scope
    entry.ops.push(op)
    // (C3: so far the call's ops — and the session's entries before it —
    // have moved nothing that was in the version it was written on.)
    if (onlyAddedSince(c.base, cur)) op.fresh = true
    const before = cur
    const r = step(cur, entry, op, index, ctx)
    delete op.fresh
    cur = r.project
    outcomes.push(r.outcome)
    if (c.alias !== undefined && !named.has(c.alias)) named.set(c.alias, { index, ...(r.outcome.applied ? { id: firstId(r.outcome.result) } : {}) })
    // (What it only added is, to the later ops of the call, part of what
    // they were written on — K4. Whether anyone else changed the film is
    // asked apart, from the versions.)
    if (r.outcome.applied && r.project !== before && addsOnly(diff(before, r.project))) for (const [b, f] of frames) frames.set(b, withAdded(f, before, r.project))
  })
  return { project: cur, outcomes, entry }
}
