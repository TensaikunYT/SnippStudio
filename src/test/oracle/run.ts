// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// One sequence of agent and user steps over the draft core, judged by the
// oracle after every step (SnippStudio phase 4A.9, A8). Steps are plain data
// (so a failing sequence can be printed, replayed and shrunk); `Run` executes
// them through the driver and the store.
//
// Phase 4A.10 (F): several agents (two sessions of one program, a second
// program): what another agent landed is, to an agent, a change it did not
// make. Every materialisation is judged in parts (oracle.ts examine): the
// ops between two literal (structural) ops in full, a literal op for running
// on the very film it was written for. Whether a dropped op is a loss is
// decided here, from the projects — never from the reason the core gives.
import { closeEditWindows, useStore } from '../../renderer/src/state/store'
import type { Asset, Clip, Project } from '../../renderer/src/types'
import { addNote } from '../../renderer/src/notes/model'
import { instOf, wordTag, type Shape } from './fixture'
import { capture, check, cutSpans, examine, fieldValue, hasPair, hasStill, lineValue, literal, recordIn, relAt, settingOf, stillThere, type Intent, type Judged, type Mine, type Rel, type Violation } from './oracle'
import { STEP, allAt, clipAtSource, contentAt, filmSig, inter, isStill, lenOf, minus, speedOf, srcAt, timeAt, union, windowOf, type Content, type Iv } from './sample'
import { makeDriver, type Driver, type Mat, type Seen } from './driver'
import { describeProblems, newProblems } from '../../renderer/src/model/check'
import { newLineProblems } from './lines'
import { speedProblems } from './speed'

/** The whole film as one string: everything but the notes, the name, a
 *  row's height and a line's note of its voice clip; numbers to 1e-5. Two
 *  projects with the same string are the same film to a structural op. */
const films = new WeakMap<Project, string>()
const SKIP = new Set(['notes', 'noteSeq', 'name', 'snap', 'height', 'soundClip', 'assets', 'instance', '__inst', '__w'])
function filmOf(p: Project): string {
  let s = films.get(p)
  if (s === undefined) {
    s = JSON.stringify(p, (k, x) => {
      if (SKIP.has(k) || x === false) return undefined
      if (typeof x === 'number') return Math.round(x * 1e5) / 1e5
      if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      return x
    })
    films.set(p, s)
  }
  return s
}
const layoutSig = (p: Project): string => filmSig(p).split(';').filter((r) => !r.startsWith('C')).join(';')

const S = useStore.getState

export type UserAct =
  | { t: 'cut'; range: Iv }
  /** A cut that leaves the music bed alone (çekirdek cila S: the silence
   *  window's and the transcript's "music is not cut"); `end`: the bed's
   *  clips end with the rest. */
  | { t: 'cutKeep'; range: Iv; keep: string[]; end: boolean }
  /** The silence window's cut of pauses in the picked clips, leaving the
   *  `keep` tracks alone (none: every unlocked track): audit patch yama-c. */
  | { t: 'silenceKeep'; regions: { clipId: string; start: number; end: number }[]; picked: string[]; keep: string[]; end: boolean }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'batch'; name: string; params: Record<string, unknown> }
  /** A speed curve put on, changed or taken away (core polish C): the
   *  inspector's store action (the command is the app's own). */
  | { t: 'curve'; clipId: string; curve: { points: { u: number; v: number }[]; linear?: boolean } | null }
  | { t: 'copy'; clipId: string }
  | { t: 'note'; start: number }
  | { t: 'lock'; track: string }
  /** A setting the editor makes with a store action of its own (a grade, a
   *  blend mode, a mask, a keyframe, a picture put in a placeholder). */
  | { t: 'store'; fn: 'grade' | 'blend' | 'mask' | 'keyframe' | 'fill'; clipId: string; asset?: string }

export type Step =
  | { k: 'read'; who?: number }
  /** `keeps`: per range, the take it is cut for (a retake). */
  | { k: 'analyze'; ranges: Iv[]; who?: number; keeps?: (Iv | null)[] }
  /** `from`: the read its numbers come from: 0 the latest, 1 the one before. */
  | { k: 'edit'; from: 0 | 1; ops: Record<string, unknown>[]; who?: number }
  | { k: 'user'; cls: string; act: UserAct }
  /** `late`: a change of the user's between the card being drawn and the
   *  accept (the accept carries what the card showed). */
  | { k: 'accept'; seqs?: number[]; late?: { cls: string; act: UserAct } }
  | { k: 'remove'; seq: number; op: number; range: number }
  | { k: 'revive'; seq: number; op: number }
  | { k: 'reject' }
  /** The user's setting: agent edits wait as a draft, or land at once. */
  | { k: 'mode'; mode: 'draft' | 'direct' }

export interface OpRec {
  key: string
  seq?: number
  index: number
  /** Which agent sent it. */
  who: number
  intent: Intent
  raw: Record<string, unknown>
  refused: boolean
  /** The step of the read its numbers came from. */
  readStep: number
  /** Why the core dropped it, as it said last (reported, never judged by). */
  reason?: string
  /** The ranges of a cut the core said it left out. */
  left?: number[]
  /** The film it met when it first ran (a literal op). */
  metFilm?: string
  seen: Project
  /** K1: the read the call was written on (for an applied result too: what
   *  the agent saw of the records is its latest read, the call's base). */
  k1Step?: number
  k1Seen?: Project
  /** The whole live film at its read (a change the user took back since is
   *  no change). */
  readFilm: string
  /** The literal ops of its own draft that the view it was read in held. */
  readHeld: string[]
  /** The step it was sent at. */
  at: number
  /** Was it applied when last looked at; was its agent told it was dropped;
   *  did the agent send a later edit after that (it then stays dropped: B11);
   *  did the user bring it back. */
  lastApplied?: boolean
  told?: boolean
  retired?: boolean
}

export interface Obs {
  fam: string
  name: string
  applied: boolean
  /** The kinds of change since the op's read that its agent did not make,
   *  joined ("" = none). */
  classes: string
  /** After the user accepted a part or took a range out (a drop may be
   *  their choice's). */
  afterChoice: boolean
  step: number
  /** Why the core dropped it (when it says): reported only. */
  reason?: string
  /** Why the drop is no loss, by the oracle's own reckoning: 'already' (the
   *  project already is as the op would make it), 'tiny' (the command makes
   *  no clip that short), 'retired' (told and replaced: B11), 'ownMoved' (a
   *  literal op whose ids and seconds an earlier edit of the same agent moved). */
  own?: string
}

export interface Found extends Violation {
  step: number
}

export interface SeenAt extends Seen {
  step: number
  film: string
  /** The literal ops of the reader's own waiting draft that were applied in
   *  what was read (their keys): the view is what they made of the project. */
  held: string[]
}

/** A seeded generator (mulberry32). */
export function rngOf(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const realUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto)

// ---- phase 4A.11, K1: a change of someone else's that an op destroys --------
//
// The oracle's own reckoning, apart from the core's: a SETTING is a field of a
// record that changed while the record stayed where it was (a clip: the same
// id, the same source window and start; a line, a marker, a template: the same
// id and times). A cut, a split, a trim or a drag is no setting: what they do
// to a record's fields follows from where it lies. An op that deletes or
// shortens a record whose setting someone else made after the agent read
// (and the agent read another value), or writes over that setting, has lost
// that someone's change: `user-change-lost`.

export interface K1Set {
  step: number
  by: number
  kind: 'clip' | 'caption' | 'marker' | 'template'
  id: string
  inst?: string
  win?: Iv
  field: string
  /** Set by an undo or a redo (it gives back a value someone had set). */
  restore?: boolean
  /** The value set, as JSON. */
  value: string
  /** The value before, as JSON. */
  old?: string
  /** A clip's keys: the source seconds of the keys the setting made, changed or removed. */
  keys?: number[]
}

/** The keys of field `f` of `c`, each as "source second=value". */
function k1Keys(c: Clip, f: string): Map<string, number> {
  const out = new Map<string, number>()
  const src = (t: number): number => (c.speedCurve ? srcAt(c, c.start + t) : c.reversed ? c.inPoint + (c.duration - t) * speedOf(c) : c.inPoint + t * speedOf(c))
  const walk = (x: unknown, path: string): void => {
    if (Array.isArray(x)) x.forEach((y) => walk(y, path))
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      if (typeof o.time === 'number') out.set(`${path}@${src(o.time).toFixed(3)}=${JSON.stringify(o, (k, y) => (k === 'id' || k === 'time' ? undefined : typeof y === 'number' ? Math.round(y * 1e4) / 1e4 : y))}`, src(o.time))
      else for (const [k, y] of Object.entries(o)) walk(y, `${path}.${k}`)
    }
  }
  walk((c as unknown as Record<string, unknown>)[f], f)
  return out
}
/** The source seconds of the keys that differ between `x` and `y`. */
function k1KeysChanged(x: Clip, y: Clip, f: string): number[] {
  const a = k1Keys(x, f)
  const b = k1Keys(y, f)
  return [...[...a].filter(([k]) => !b.has(k)), ...[...b].filter(([k]) => !a.has(k))].map(([, m]) => m)
}

const K1_CLIP_PLACE = new Set(['id', 'start', 'inPoint', 'duration', 'instance', 'transitionOut', '__inst', '__w'])
const K1_LINE_PLACE = new Set(['id', 'start', 'end', 'soundClip', 'layer'])
/** What cutting a clip in pieces changes of its fields (its edges' fades and
 *  ways in / out, its keyframes, a new link between new halves). */
const K1_CUT_FIELDS = ['fadeIn', 'fadeOut', 'anim', 'channels', 'keyframes', 'volumeKeyframes', 'mask', 'motionFx', 'moves', 'linkId', 'autoDucking', 'nested']
const k1Json = (v: unknown): string => JSON.stringify(v ?? null, (k, x) => (k === 'start' || k === 'end' || k === '__w' ? undefined : x))
/** A field of a record as the oracle compares it (a line's words: their texts). */
const k1Field = (r: Record<string, unknown>, f: string): string => k1Json(f === 'words' ? ((r.words as { text: string }[] | undefined) ?? []).map((w) => w.text) : r[f])
const k1Fields = (a: Record<string, unknown>, b: Record<string, unknown>, place: Set<string>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => !place.has(f) && k1Field(a, f) !== k1Field(b, f))

/** The settings made between two projects (`by` made them). */
export function settingsBetween(before: Project, after: Project, step: number, by: number): K1Set[] {
  const out: K1Set[] = []
  const near = (x: number, y: number): boolean => Math.abs(x - y) <= 1e-6
  if (before.clips !== after.clips) {
    for (const [id, y] of Object.entries(after.clips)) {
      const x = before.clips[id]
      if (!x || x === y) continue
      const wx = windowOf(x)
      const wy = windowOf(y)
      // (Moved, cut or trimmed as well — an undo of a cut and a setting
      // together: the fields that cutting does not touch.)
      const placed = near(x.start, y.start) && near(wx[0], wy[0]) && near(wx[1], wy[1])
      const skip0 = placed ? K1_CLIP_PLACE : new Set([...K1_CLIP_PLACE, ...K1_CUT_FIELDS])
      // (Along a speed curve the speed is the window's average: a cut gives
      // each piece its own, as it gives each its own in point. The setting is
      // the curve: core polish C.)
      const skip = y.speedCurve ? new Set([...skip0, 'speed']) : skip0
      for (const f of k1Fields(x as never, y as never, skip)) {
        // (Keys: the ones this setting made or changed, at their source seconds
        // — a speed change only stretches the clip's own clock under them.)
        const keys = K1_TIMED.includes(f) ? k1KeysChanged(x, y, f) : undefined
        if (keys && !keys.length) continue
        out.push({ step, by, kind: 'clip', id, inst: instOf(x), win: placed ? wx : wy, field: f, value: k1Field(y as never, f), old: k1Field(x as never, f), ...(keys ? { keys } : {}) })
      }
    }
  }
  if (before.captions !== after.captions) {
    const was = new Map(before.captions.map((c) => [c.id, c]))
    for (const y of after.captions) {
      const x = was.get(y.id)
      if (!x || x === y || !near(x.start, y.start) || !near(x.end, y.end)) continue
      for (const f of k1Fields(x as never, y as never, K1_LINE_PLACE)) out.push({ step, by, kind: 'caption', id: y.id, field: f, value: k1Field(y as never, f), old: k1Field(x as never, f) })
    }
  }
  const byId = <T extends { id: string }>(kind: 'marker' | 'template', a: readonly T[] | undefined, b: readonly T[] | undefined, same: (x: T, y: T) => boolean, place: Set<string>): void => {
    if (a === b) return
    const was = new Map((a ?? []).map((x) => [x.id, x]))
    for (const y of b ?? []) {
      const x = was.get(y.id)
      if (!x || x === y || !same(x, y)) continue
      for (const f of k1Fields(x as never, y as never, place)) out.push({ step, by, kind, id: y.id, field: f, value: k1Field(y as never, f) })
    }
  }
  byId('marker', before.markers, after.markers, (x, y) => near(x.time, y.time), new Set(['id', 'time']))
  byId('template', before.templates, after.templates, (x, y) => near(x.start, y.start) && near(x.duration ?? 0, y.duration ?? 0), new Set(['id', 'start', 'duration']))
  return out
}

type K1Rec = Record<string, unknown> & { id: string }
/** The records of `p` a setting was made on: a clip of that id, or a piece
 *  of the same content over the same source; a line, marker, template by id. */
function k1Holders(p: Project, s: K1Set): K1Rec[] {
  if (s.kind === 'clip') {
    return Object.values(p.clips).filter((c) => c.id === s.id || (instOf(c) === s.inst && Math.min(windowOf(c)[1], s.win![1]) - Math.max(windowOf(c)[0], s.win![0]) > 1e-6)) as never
  }
  const list = (s.kind === 'caption' ? p.captions : s.kind === 'marker' ? p.markers : p.templates) as readonly K1Rec[] | undefined
  return (list ?? []).filter((x) => x.id === s.id)
}

/** K1b (the oracle's own reckoning): did going from `before` to `after`
 *  LOSE the setting `s` someone made on record `r`? Lost: (a) the record is
 *  gone whole; (b) the field is set to something else on what is left; (c)
 *  for a clip, keys of its automation at source seconds that went, or a fade
 *  / a way in or out at an edge that went; for a line, a word the setting
 *  changed or marked that went, or a text of its own (not its words joined)
 *  that is rebuilt. Made shorter or cut in pieces, the rest of it as set: not
 *  lost. */
const K1_TIMED = ['channels', 'keyframes', 'volumeKeyframes', 'mask']
function k1Destroyed(s: K1Set, r: K1Rec, before: Project, after: Project, seen: Project): boolean {
  if (s.kind === 'clip') {
    const c = r as unknown as Clip
    const inst = instOf(c)
    const w = windowOf(c)
    const covered = (p: Project): Iv[] => union(Object.values(p.clips).filter((x) => instOf(x) === inst && x.trackId === c.trackId).map((x) => inter([windowOf(x)], [w])).flat())
    const went = minus(covered(before), covered(after)).filter(([x, y]) => y - x > 1e-4)
    // (A sliver of a cut — the command layer's K-3 — is nothing anyone set.)
    if (c.duration < 0.021) return false
    // (a) gone whole
    if (lenOf(covered(after)) <= 0.021 && lenOf(covered(before)) > 0.021) return true
    // (b) written over: the clip itself, or the pieces made of it
    const same = after.clips[c.id]
    const cutFrom = (x: Clip): boolean => K1_CUT_FIELDS.includes(s.field) && (Math.abs(windowOf(x)[0] - w[0]) > 1e-6 || Math.abs(windowOf(x)[1] - w[1]) > 1e-6)
    const pieces = same ? [same] : Object.values(after.clips).filter((x) => !before.clips[x.id] && instOf(x) === inst && Math.min(windowOf(x)[1], w[1]) - Math.max(windowOf(x)[0], w[0]) > 1e-6)
    if (pieces.some((x) => !cutFrom(x) && k1Field(x as never, s.field) !== s.value)) return true
    // (A still has no source seconds: what it holds goes only with it.)
    if (!went.length || isStill(before, c)) return false
    // (c) what went: keys there, an edge's own fields
    const at = (m: number): boolean => went.some(([x, y]) => m > x - 1e-4 && m < y + 1e-4)
    const src = (t: number): number => (c.reversed ? c.inPoint + (c.duration - t) * speedOf(c) : c.inPoint + t * speedOf(c))
    if (K1_TIMED.includes(s.field)) return (s.keys ?? []).some((m) => at(m))
    void src
    const head = at(c.reversed ? w[1] : w[0])
    const tail = at(c.reversed ? w[0] : w[1])
    return (s.field === 'fadeIn' && head) || (s.field === 'fadeOut' && tail) || (s.field === 'anim' && (head || tail))
  }
  const list = (s.kind === 'caption' ? after.captions : s.kind === 'marker' ? after.markers : after.templates) as readonly K1Rec[] | undefined
  const y = (list ?? []).find((x) => x.id === r.id)
  if (!y) return true
  if (s.kind !== 'caption') return k1Field(y, s.field) !== s.value
  // A line: the words that went (it keeps the others, in order).
  const rw = ((r.words as { text: string }[] | undefined) ?? []).map((x) => x.text)
  const yw = ((y.words as { text: string }[] | undefined) ?? []).map((x) => x.text)
  if (!rw.length || yw.length >= rw.length) return k1Field(y, s.field) !== s.value
  const goneIdx: number[] = []
  let j = 0
  rw.forEach((t, i) => {
    if (j < yw.length && yw[j] === t) j++
    else goneIdx.push(i)
  })
  if (s.field === 'words') {
    // (A word not among the words the agent read on that line: someone else's.)
    const read = ((seen.captions.find((x) => x.id === r.id)?.words ?? []) as { text: string }[]).map((x) => x.text)
    return goneIdx.some((i) => !read.includes(rw[i]))
  }
  if (s.field === 'marks') return goneIdx.some((i) => ((r.marks as number[] | undefined) ?? []).includes(i))
  if (s.field === 'text') {
    // (A text of its own — not its words joined — is rebuilt from the words left.)
    return (r.text as string) !== rw.join(' ') && k1Field(y, 'text') !== s.value
  }
  return k1Field(y, s.field) !== s.value
}

/** Did the agent read another value of that field there (it had the record,
 *  and not with what `s` set)? */
function k1ReadOther(seen: Project, s: K1Set, r: K1Rec): boolean {
  if (s.kind === 'clip') {
    const c = r as unknown as Clip
    const byId = seen.clips[c.id]
    const list = byId && instOf(byId) === instOf(c) ? [byId] : Object.values(seen.clips).filter((x) => instOf(x) === instOf(c) && Math.min(windowOf(x)[1], windowOf(c)[1]) - Math.max(windowOf(x)[0], windowOf(c)[0]) > 1e-6)
    // (A placeholder filled: the content changed with the setting; the clip is the one of that id.)
    const list2 = list.length ? list : byId ? [byId] : []
    return list2.length > 0 && list2.some((x) => k1Field(x as never, s.field) !== s.value)
  }
  const list = (s.kind === 'caption' ? seen.captions : s.kind === 'marker' ? seen.markers : seen.templates) as readonly K1Rec[] | undefined
  const x = (list ?? []).find((y) => y.id === r.id)
  return !!x && k1Field(x, s.field) !== s.value
}

type J = Judged & { rec: OpRec }

interface Agent {
  seen: SeenAt | null
  old: SeenAt | null
  /** Titles and markers its ops made (and "line X" for lines it retyped). */
  ids: Set<string>
  /** Where each record of its making was when it landed, and where its own
   *  later landings left it. */
  rel: Map<string, Rel[]>
  /** What of its has landed on the live project, and at which step. */
  done: { step: number; intent: Intent; structural: boolean; read: number }[]
  /** Its landings: the live project before and after. */
  landings: [Project, Project][]
  /** Records its landings moved (anyone's), from where to where. */
  moves: Map<string, [Rel, Rel][]>
}

export class Run {
  readonly d: Driver
  readonly log: string[] = []
  readonly violations: Found[] = []
  readonly obs: Obs[] = []
  /** Applied ops judged in full (content) and for their context only (literal). */
  readonly judged = { content: 0, literal: 0 }
  /** The ops of the draft that waits. */
  ops: OpRec[] = []
  readonly agents: Agent[]
  private changes: { step: number; cls: string; film: boolean; by: number }[] = []
  private writes: { step: number; by: number; what: string; value?: unknown; lineId?: string; text?: string }[] = []
  /** Every field someone set on a record that stayed where it was (phase
   *  4A.11, K1): a clip (its id, its content and source window), a line, a
   *  marker, a template; with the value set and by whom (-1: the user). */
  private sets: K1Set[] = []
  private results: { id: string; seen: SeenAt; ranges: Iv[]; who: number; keeps?: (Iv | null)[] }[] = []
  private lastPair: [Project, Project] | null = null
  private copies = 0
  private chose = false
  step = 0

  constructor(
    readonly shape: Shape,
    readonly mode: 'draft' | 'direct',
    seed: number
  ) {
    // The user's own new ids, from the run's seed (the store's actions make
    // them with crypto.randomUUID).
    const r = rngOf(seed ^ 0x5bd1e995)
    const hex = (w: number): string => Math.floor(r() * 16 ** w).toString(16).padStart(w, '0')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}` })
    this.d = makeDriver(seed)
    this.agents = Array.from({ length: this.d.agents }, () => ({ seen: null, old: null, ids: new Set<string>(), rel: new Map<string, Rel[]>(), done: [], landings: [], moves: new Map<string, [Rel, Rel][]>() }))
    this.d.reset(shape.project, mode)
  }

  /** The first agent's reads (the generator of one-agent runs). */
  get seen(): SeenAt | null {
    return this.agents[0].seen
  }
  get old(): SeenAt | null {
    return this.agents[0].old
  }

  dispose(): void {
    this.d.dispose()
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: realUUID })
  }

  private say(line: string): void {
    this.log.push(`${this.step} ${line}`)
  }

  private found(list: Violation[]): void {
    for (const v of list) this.violations.push({ ...v, step: this.step })
  }

  /** The kinds of change since `step` that agent `who` did not make. */
  private classesSince(step: number, who: number): string {
    return [...new Set(this.changes.filter((u) => u.step > step && u.by !== who).map((u) => u.cls))].sort().join('+')
  }

  /** Did someone else change the film since the op's read (and not take it back)? */
  private clean(rec: OpRec, L: Project): boolean {
    return !this.changes.some((u) => u.film && u.step > rec.readStep && u.by !== rec.who) || filmOf(L) === rec.readFilm
  }

  private mineOf(who: number): Mine {
    const a = this.agents[who]
    const voice = this.shape.voiceTrack
    return {
      ids: a.ids,
      rel: (id) => a.rel.get(id),
      moves: (id) => a.moves.get(id),
      pair: (track, inst, k, v) => a.landings.some(([before, after]) => (k === null ? hasStill(after, voice, inst, v) && !hasStill(before, voice, inst, v) : hasPair(after, voice, track, inst, k, v) && !hasPair(before, voice, track, inst, k, v)))
    }
  }

  private wrote(rec: OpRec, L: Project, earlier: readonly OpRec[] = []): boolean {
    const it = rec.intent
    // (A value of someone else's that the agent itself has since read and
    // written over — an earlier op of its own, on a newer read — is no
    // longer theirs: this op writes over the agent's own.)
    const sameTarget = (x: Intent): boolean => x.fam === it.fam && x.field === it.field && x.inst === it.inst && x.lineId === it.lineId
    const knew = (step: number): boolean => earlier.some((e) => e.who === rec.who && e.readStep >= step && sameTarget(e.intent)) || this.agents[rec.who].done.some((d) => d.read >= step && sameTarget(d.intent))
    const others = this.writes.filter((w) => w.step > rec.readStep && w.by !== rec.who && !knew(w.step))
    if (it.fam === 'record') {
      // A value SOMEONE ELSE wrote on that content after the agent read,
      // still in force on the live project, and neither the value the agent
      // read nor the one it writes.
      const was = rec.seen.clips[it.clipId!]
      const read = was ? settingOf(was, it.field!) : undefined
      const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      const over = (c: { inPoint: number; duration: number; speed?: number }, lo: number, hi: number): boolean => c.inPoint < hi - 1e-6 && c.inPoint + c.duration * (c.speed ?? 1) > lo + 1e-6
      const [lo, hi] = it.window!
      return others.some((w) => {
        if (w.what !== `${it.inst}.${it.field}` || same(w.value, read) || same(w.value, it.value)) return false
        // (A transition out is the END of a clip's: the one of the clip that
        // ends where the named one ended.)
        const ends = (c: { inPoint: number; duration: number; speed?: number }): boolean => it.field !== 'transitionOut' || it.still === true || Math.abs(c.inPoint + c.duration * (c.speed ?? 1) - hi) <= 0.021
        return Object.values(L.clips).some((c) => instOf(c) === it.inst && (it.still ? c.id === it.clipId : over(c, lo, hi)) && ends(c) && same(settingOf(c, it.field!), w.value))
      })
    }
    if (it.fam === 'lineMarks') {
      // Marks someone else set on that line since, still in force, and not
      // the marks the agent read.
      const line = L.captions.find((c) => c.id === it.lineId)
      const now = (line?.marks ?? []).map((i) => wordTag(line!.words?.[i] ?? {}) ?? `#${i}`).sort().join(',')
      const read = (it.hadMarks ?? []).map((w) => w.tag ?? w.key).sort().join(',')
      return others.some((w) => w.what === `marks:${it.lineId}` && w.text === now && now !== read)
    }
    if (it.fam === 'field' || it.fam === 'lineSet') {
      // The same field, written by someone else since the read, still in
      // force, and neither the value read nor the one the agent writes.
      const what = it.fam === 'field' ? `field:${it.field}` : `line:${it.lineId}:${it.field}`
      const line = it.fam === 'lineSet' ? L.captions.find((c) => c.id === it.lineId) : undefined
      const now = it.fam === 'field' ? fieldValue(L, it.field!) : line ? lineValue(line, it.field!) : undefined
      const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
      return others.some((w) => w.what === what && same(w.value, now) && !same(now, it.readValue) && !same(now, it.value))
    }
    if (it.fam !== 'lineText') return false
    const tags = it.words!.map((w) => w.tag).filter(Boolean)
    // (Still in force: the line has the text the user typed, and that is
    // not the text the agent read. A retype the user took back is no write.)
    return others.some((w) => w.what.startsWith('line:') && w.what.slice(5).split(',').some((t) => tags.includes(t)) && w.text !== it.oldText && L.captions.find((c) => c.id === w.lineId)?.text === w.text)
  }

  /** K1: the settings made after the op's read by anyone but its agent. */
  private theirSets(rec: OpRec): K1Set[] {
    // (An undo or a redo that gives back the very value this agent had set
    // there itself is no setting of someone else's.)
    const same = (a: K1Set, b: K1Set): boolean => a.kind === b.kind && a.field === b.field && a.value === b.value && (a.id === b.id || (!!a.inst && a.inst === b.inst && !!a.win && !!b.win && Math.min(a.win[1], b.win[1]) - Math.max(a.win[0], b.win[0]) > 1e-6))
    return this.sets.filter((s) => s.step > (rec.k1Step ?? rec.readStep) && s.by !== rec.who && !(s.restore && this.sets.some((o) => o.by === rec.who && o.step <= s.step && same(o, s))))
  }

  /** K1: a setting of someone else's (still in force in `before`, the agent
   *  read another value) that the op destroyed going to `after`. */
  private lostBy(rec: OpRec, theirs: readonly K1Set[], before: Project, after: Project): string | null {
    for (const s of theirs) {
      for (const r of k1Holders(before, s)) {
        if (k1Field(r, s.field) !== s.value || !k1ReadOther(rec.k1Seen ?? rec.seen, s, r)) continue
        if (k1Destroyed(s, r, before, after, rec.k1Seen ?? rec.seen)) return `${s.kind} ${r.id}: ${s.field} set by ${s.by < 0 ? 'the user' : `agent ${s.by}`} at step ${s.step} (after the read at ${rec.readStep}) was deleted, shortened or written over`
      }
    }
    return null
  }

  /** K1, for a dropped op: does it reach a record whose setting someone else
   *  made after its read, still in force in `met`, that the agent read
   *  otherwise? Such a drop is no loss (the op would have destroyed it). */
  private userChanged(rec: OpRec, it: Intent, met: Project): boolean {
    const theirs = this.theirSets(rec)
    if (!theirs.length) return false
    const spans = it.fam === 'cut' ? cutSpans(it, met, this.shape) : []
    const hit = (a: number, b: number): boolean => spans.some(([x, y]) => a < y + 1e-6 && b > x - 1e-6)
    // (K1b: would the op LOSE that setting? Gone whole, the very field
    // written, keys or an edge in what goes, words of a line that go.)
    const covers = (a0: number, b0: number): boolean => lenOf(inter([[a0, b0]], spans)) >= b0 - a0 - 0.021
    const inSpans = (t: number): boolean => spans.some(([x, y]) => t > x - 1e-4 && t < y + 1e-4)
    const keyTimes = (v: unknown): number[] => {
      const out: number[] = []
      const walk = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(walk)
        else if (x && typeof x === 'object') {
          const o = x as Record<string, unknown>
          if (typeof o.time === 'number') out.push(o.time)
          for (const [k, y] of Object.entries(o)) if (k !== 'time') walk(y)
        }
      }
      walk(v)
      return out
    }
    const reaches = (s: K1Set, r: K1Rec): boolean => {
      if (s.kind === 'clip') {
        const c = r as unknown as Clip
        const w = windowOf(c)
        const over = (inst: string | undefined, win: Iv | undefined): boolean => !!win && instOf(c) === inst && Math.min(w[1], win[1]) - Math.max(w[0], win[0]) > 1e-6
        const v = (c as unknown as Record<string, unknown>)[s.field]
        if (it.fam === 'cut') {
          if (!hit(c.start, c.start + c.duration)) return false
          if (covers(c.start, c.start + c.duration)) return true
          if (K1_TIMED.includes(s.field)) return (s.keys ?? []).some((m) => inSpans(timeAt(c, m)))
          return (s.field === 'fadeIn' && inSpans(c.start)) || (s.field === 'fadeOut' && inSpans(c.start + c.duration)) || (s.field === 'anim' && (inSpans(c.start) || inSpans(c.start + c.duration)))
        }
        const named = c.id === it.clipId || over(it.inst, it.window)
        if (!named) return false
        if (it.fam === 'delete') return true
        if (it.fam === 'record') return s.field === it.field
        if (it.fam === 'trimHead' || it.fam === 'trimEnd') {
          const gone = it.gone!
          if (w[0] >= gone[0] - 1e-4 && w[1] <= gone[1] + 1e-4) return true
          const src = (t: number): number => (c.reversed ? c.inPoint + (c.duration - t) * speedOf(c) : c.inPoint + t * speedOf(c))
          if (K1_TIMED.includes(s.field)) return (s.keys ?? []).some((m) => m > gone[0] - 1e-4 && m < gone[1] + 1e-4)
          void src
          void keyTimes
          void v
          return (s.field === 'fadeIn' && it.fam === 'trimHead') || (s.field === 'fadeOut' && it.fam === 'trimEnd') || s.field === 'anim'
        }
        return false
      }
      if (s.kind === 'caption') {
        if (it.fam === 'cut') {
          if (!hit(r.start as number, r.end as number)) return false
          const words = (r.words as { text: string; start: number; end: number }[] | undefined) ?? []
          if (covers(r.start as number, r.end as number)) return true
          if (!words.length) return false
          const goneIdx = words.map((x, i) => (inSpans((x.start + x.end) / 2) ? i : -1)).filter((i) => i >= 0)
          if (!goneIdx.length) return false
          if (s.field === 'words') {
            const read = (((rec.k1Seen ?? rec.seen).captions.find((x) => x.id === r.id)?.words ?? []) as { text: string }[]).map((x) => x.text)
            return goneIdx.some((i) => !read.includes(words[i].text))
          }
          if (s.field === 'marks') return goneIdx.some((i) => ((r.marks as number[] | undefined) ?? []).includes(i))
          if (s.field === 'text') return (r.text as string) !== words.map((x) => x.text).join(' ')
          return false
        }
        if (r.id !== it.lineId) return false
        if (it.fam === 'lineDelete') return true
        if (it.fam === 'lineText') return s.field === 'text' || s.field === 'words'
        if (it.fam === 'lineSet') return s.field === (it.field === 'text' ? 'text' : 'style')
        if (it.fam === 'lineMarks') return s.field === 'marks'
        return false
      }
      if (s.kind === 'marker') return it.fam === 'cut' && hit(r.time as number, r.time as number)
      return it.fam === 'cut' && covers(r.start as number, (r.start as number) + ((r.duration as number) ?? 0))
    }
    return theirs.some((s) => k1Holders(met, s).some((r) => k1Field(r, s.field) === s.value && k1ReadOther(rec.k1Seen ?? rec.seen, s, r) && reaches(s, r)))
  }

  /** The range list an op's cut was written with (an applied result: its items'). */
  private rangesOf(rec: OpRec): { ranges: unknown[]; keeps?: (Iv | null)[] } | null {
    if (rec.raw.op === 'apply') {
      const r = this.resultOf(rec.raw.result)
      return r ? { ranges: r.ranges, ...(r.keeps ? { keeps: r.keeps } : {}) } : null
    }
    return Array.isArray(rec.raw.ranges) ? { ranges: rec.raw.ranges as unknown[] } : null
  }

  private judge(recs: readonly OpRec[], applied: (r: OpRec) => boolean, L: Project, mat?: Mat): J[] {
    // A cut of which the core left some ranges out (and said so) is judged
    // as meaning the ranges it did cut. (The ranges left are counted as
    // dropped, each on its own: observe.)
    const meant = (rec: OpRec): Intent => {
      if (!rec.left?.length || rec.intent.fam !== 'cut') return rec.intent
      const src = this.rangesOf(rec)
      if (!src) return rec.intent
      const keep = (_: unknown, i: number): boolean => !rec.left!.includes(i)
      return { ...capture(rec.seen, this.shape, { op: 'timeline.cutRanges', ranges: src.ranges.filter(keep), ...(src.keeps ? { keeps: src.keeps.filter(keep) } : {}) }), name: rec.intent.name }
    }
    const place = new Map((mat?.ops ?? []).map((o, n) => [`${o.seq}:${o.index}`, n]))
    const before: OpRec[] = []
    return recs.map((rec, i) => {
      const on = applied(rec)
      const earlier = [...before]
      if (on) before.push(rec)
      // A literal op: on its first run, no one else changed the film since
      // its read (an op the core refused at the call and runs later: on the
      // layout it was read on); on a later run, the very film it first met.
      const contextOk = (before: Project): boolean => {
        const film = filmOf(before)
        if (rec.metFilm === undefined) {
          const ok = this.clean(rec, L) && (!rec.refused || layoutSig(before) === layoutSig(rec.seen))
          if (on) rec.metFilm = film
          return ok
        }
        return film === rec.metFilm
      }
      const n = rec.seq === undefined ? i : place.get(`${rec.seq}:${rec.index}`)
      const theirs = this.theirSets(rec)
      const lost = theirs.length ? (b: Project, a: Project): string | null => this.lostBy(rec, theirs, b, a) : undefined
      return { key: rec.key, intent: meant(rec), applied: on, userWrote: this.wrote(rec, L, earlier), contextOk, seen: rec.seen, clean: this.clean(rec, L), ...(n !== undefined ? { n } : {}), ...(lost ? { lost } : {}), rec }
    })
  }

  /** L → M under the judged ops: the oracle's verdict (in parts, when the
   *  driver can show the project each op met). */
  private verdict(L: Project, M: Project, judged: readonly J[], who: number, mat?: Mat): void {
    const mine = this.mineOf(who)
    if (!mat || judged.some((j) => j.n === undefined)) {
      this.found(check(L, M, judged, this.shape, mine))
      return
    }
    const r = examine(mat, M, judged, this.shape, mine)
    this.found(r.violations)
    this.judged.content += r.content
    this.judged.literal += r.literal
    // (The replay of all the ops is the materialisation itself.)
    if (r.literal && filmOf(mat.at(mat.ops.length)) !== filmOf(M)) this.found([{ kind: 'replay-diverged', detail: 'replaying the same ops on the same project gives another film' }])
    // B11: an op its agent was told is dropped, and replaced, stays dropped.
    for (const j of judged) if (j.applied && j.rec.retired) this.found([{ kind: 'retired-came-back', detail: `${j.intent.name} was dropped, told, and the agent sent a later edit: it came back by itself`, op: `${j.key} ${j.intent.name}` }])
  }

  /** Is the project already as the op would make it (nothing left to do)? */
  private already(it: Intent, L: Project): boolean {
    const voice = this.shape.voiceTrack
    switch (it.fam) {
      case 'record': {
        const now = it.still ? Object.values(L.clips).filter((c) => c.id === it.clipId) : Object.values(L.clips).filter((c) => instOf(c) === it.inst && c.inPoint < it.window![1] - 1e-6 && c.inPoint + c.duration * speedOf(c) > it.window![0] + 1e-6)
        const at = it.field === 'transitionOut' && !it.still ? now.filter((c) => Math.abs(c.inPoint + c.duration * speedOf(c) - it.window![1]) <= 0.02) : now
        return at.length > 0 && at.every((c) => JSON.stringify(settingOf(c, it.field!) ?? null) === JSON.stringify(it.value ?? null))
      }
      case 'split': {
        const left = clipAtSource(L, it.track!, it.inst!, it.at!, true)
        const right = clipAtSource(L, it.track!, it.inst!, it.at!)
        return !!left && !!right && left.id !== right.id
      }
      case 'lineText':
        return L.captions.some((c) => c.id === it.lineId && c.text === it.text)
      case 'lineSet':
        return L.captions.some((c) => c.id === it.lineId && JSON.stringify(lineValue(c, it.field!) ?? null) === JSON.stringify(it.value ?? null))
      case 'field':
        return JSON.stringify(fieldValue(L, it.field!) ?? null) === JSON.stringify(it.value ?? null)
      case 'lineMarks': {
        const line = L.captions.find((c) => c.id === it.lineId)
        const now = (line?.marks ?? []).map((i) => wordTag(line!.words?.[i] ?? {})).sort().join(',')
        return !!line && now === it.marks!.map((w) => w.tag).sort().join(',')
      }
      default:
        void voice
        return false
    }
  }

  /** With no one else's change since the read: is what the op leans on
   *  gone by the agent's own doing — the clip a transition went into, the
   *  take a retake was cut for? */
  private ownTook(it: Intent, met: Project): boolean {
    const voice = this.shape.voiceTrack
    if (it.fam === 'record' && it.field === 'transitionOut' && it.value && !it.still) {
      const piece = Object.values(met.clips).find((c) => instOf(c) === it.inst && Math.abs(c.inPoint + c.duration * speedOf(c) - it.window![1]) <= 0.02)
      if (!piece) return true
      const next = Object.values(met.clips).find((x) => x.trackId === piece.trackId && x.id !== piece.id && Math.abs(x.start - (piece.start + piece.duration)) <= 0.02)
      const f = next ? { inst: instOf(next), src: srcAt(next, next.start) } : null
      return !(f && it.follow ? f.inst === it.follow.inst && Math.abs(f.src - it.follow.src) <= 0.021 : !f && !it.follow)
    }
    if (it.fam === 'cut' && it.takes?.length) {
      return it.takes.every((t) => {
        const all = t.keep.reduce((n, x) => n + x.iv[1] - x.iv[0], 0)
        const there = t.keep.reduce((n, x) => n + Object.values(met.clips).filter((c) => c.trackId === voice && instOf(c) === x.inst).reduce((m, c) => m + Math.max(0, Math.min(x.iv[1], c.inPoint + c.duration * speedOf(c)) - Math.max(x.iv[0], c.inPoint)), 0), 0)
        return all > 0 && there < all / 2
      })
    }
    return false
  }

  /** A title's own length (2.5 s) from its time: is there, in `L`, talk
   *  under it that was not under it when it was read, BEFORE the last of
   *  what was (footage that came back or was put there: S11)? */
  private cameBack(it: Intent, seen: Project, L: Project): boolean {
    if (it.recKind !== 'caption' || !it.ref || it.seenTime === undefined) return false
    const voice = this.shape.voiceTrack
    const under = (p: Project, a: number, b: number): { inst: string; lo: number; hi: number }[] =>
      Object.values(p.clips)
        .filter((c) => c.trackId === voice && !isStill(p, c) && c.start < b - 1e-6 && c.start + c.duration > a + 1e-6)
        .sort((x, y) => x.start - y.start)
        .map((c) => ({ inst: instOf(c), lo: srcAt(c, Math.max(a, c.start)), hi: srcAt(c, Math.min(b, c.start + c.duration)) }))
    const was = under(seen, it.seenTime, it.seenTime + 2.5)
    const host = Object.values(L.clips).find((c) => c.trackId === voice && instOf(c) === it.ref!.inst && it.ref!.src >= c.inPoint - 1e-6 && it.ref!.src < c.inPoint + c.duration * speedOf(c) - 1e-6)
    if (!host) return false
    const t = host.speedCurve ? timeAt(host, it.ref.src) : host.start + (it.ref.src - host.inPoint) / speedOf(host)
    const now = under(L, t, t + 2.5)
    const meant = (x: { inst: string; lo: number; hi: number }): number => was.filter((w) => w.inst === x.inst).reduce((n, w) => n + Math.max(0, Math.min(w.hi, x.hi) - Math.max(w.lo, x.lo)), 0)
    const last = now.map((x) => meant(x) > 1e-6).lastIndexOf(true)
    if (now.slice(0, Math.max(0, last)).some((x) => Math.abs(x.hi - x.lo) - meant(x) > 0.021)) return true
    // (And inside ONE piece: footage of it that was not under the title and
    // plays before footage that was — an undone cut gives the piece back
    // whole, with the cut-out part in the middle of the title's length.)
    for (const x of now) {
      const rev = x.lo > x.hi
      let parts: [number, number][] = [[Math.min(x.lo, x.hi), Math.max(x.lo, x.hi)]]
      const mine = was.filter((w) => w.inst === x.inst).map((w) => [Math.min(w.lo, w.hi), Math.max(w.lo, w.hi)] as [number, number])
      for (const [a, b] of mine) parts = parts.flatMap(([u, v]) => (b <= u || a >= v ? [[u, v]] : [[u, Math.min(v, a)], [Math.max(u, b), v]]).filter(([p, q]) => q - p > 1e-9) as [number, number][])
      for (const [u, v] of parts) {
        if (v - u <= 0.021) continue
        if (rev ? mine.some((w) => w[0] < v - 1e-6) : mine.some((w) => w[1] > u + 1e-6)) return true
      }
    }
    return false
  }

  /** A placement or a split on footage the project shows twice; a setting
   *  of a clip part of whose footage another piece shows too. */
  private twice(it: Intent, met: Project): boolean {
    // (A cut of talk the project shows in two places: one of them is not
    // the place the agent read it in.)
    if (it.fam === 'cut') {
      return (it.pieces ?? []).some((x) => {
        const list = Object.values(met.clips).filter((c) => instOf(c) === x.inst && !isStill(met, c) && c.inPoint < x.iv[1] - 1e-6 && c.inPoint + c.duration * speedOf(c) > x.iv[0] + 1e-6)
        return list.some((a) => list.some((b) => a !== b && Math.min(a.inPoint + a.duration * speedOf(a), b.inPoint + b.duration * speedOf(b), x.iv[1]) - Math.max(a.inPoint, b.inPoint, x.iv[0]) > 1e-6))
      })
    }
    if ((it.fam === 'record' || it.fam === 'delete') && !it.still) {
      const list = Object.values(met.clips).filter((c) => instOf(c) === it.inst && !isStill(met, c) && c.inPoint < it.window![1] - 1e-6 && c.inPoint + c.duration * speedOf(c) > it.window![0] + 1e-6)
      return list.some((a) => list.some((b) => a !== b && Math.min(a.inPoint + a.duration * speedOf(a), b.inPoint + b.duration * speedOf(b)) - Math.max(a.inPoint, b.inPoint) > 1e-6))
    }
    const cutting = it.fam === 'split' || it.fam === 'trimHead' || it.fam === 'trimEnd'
    const inst = it.fam === 'place' ? it.ref?.inst : cutting ? it.inst : undefined
    const m = it.fam === 'place' ? it.ref?.src : it.at
    if (!inst || m === undefined) return false
    return Object.values(met.clips).filter((c) => instOf(c) === inst && !isStill(met, c) && m > c.inPoint + 1e-6 && m < c.inPoint + c.duration * speedOf(c) - 1e-6).length > 1
  }

  /** A trim that would leave less of the piece than the command makes (0.1 s). */
  private tiny(it: Intent, L: Project): boolean {
    if (it.fam !== 'trimHead' && it.fam !== 'trimEnd') return false
    const piece = clipAtSource(L, it.track!, it.inst!, it.at!) ?? clipAtSource(L, it.track!, it.inst!, it.at!, true)
    if (!piece) return false
    const [lo, hi] = windowOf(piece)
    return (it.fam === 'trimHead' ? hi - it.at! : it.at! - lo) < 0.1 * speedOf(piece) + 1e-6
  }

  private observe(L: Project, judged: readonly J[], M: Project = L, mat?: Mat): void {
    for (const j of judged) {
      j.rec.lastApplied = j.applied
      if (j.applied) j.rec.told = false
    }
    for (const j of judged) {
      const who = j.rec.who
      const done = this.agents[who].done
      // A dropped op is a loss only when its content is still in what came
      // out (what another op took, or the agent's own earlier edit, is not).
      const others = [...judged.filter((o) => o !== j && o.applied).map((o) => o.intent), ...done.filter((x) => x.step > j.rec.readStep).map((x) => x.intent)]
      // (The ranges of a cut the core left out: each a dropped cut of its own.)
      if (j.applied && j.rec.left?.length && j.rec.intent.fam === 'cut') {
        const src = this.rangesOf(j.rec)
        for (const i of j.rec.left) {
          if (!src || src.ranges[i] === undefined) continue
          const one = capture(j.rec.seen, this.shape, { op: 'timeline.cutRanges', ranges: [src.ranges[i]], ...(src.keeps ? { keeps: [src.keeps[i]] } : {}) })
          if (!stillThere(one, L, this.shape, others) || !stillThere(one, M, this.shape)) continue
          // (A retake whose kept take is gone is rightly left; so is talk
          // that is on the timeline twice.)
          const metP = mat && j.n !== undefined ? mat.at(j.n) : L
          if (this.ownTook(one, metP) || this.twice(one, L)) continue
          const cls = this.classesSince(j.rec.readStep, who)
          // (K1: the range reaches a record whose setting someone else made
          // since the read: rightly left — counted, not a loss.)
          if (this.userChanged(j.rec, one, metP)) {
            this.obs.push({ fam: 'cut', name: `${j.intent.name} (a range left out)`, applied: false, classes: cls, afterChoice: this.chose, step: this.step, own: 'userChanged', ...(j.rec.reason ? { reason: j.rec.reason } : {}) })
            continue
          }
          const lapped = Object.values(L.clips).filter((c) => c.trackId === this.shape.voiceTrack).sort((a, b) => a.start - b.start).some((c, k, list) => k > 0 && c.start < list[k - 1].start + list[k - 1].duration - 1e-6)
          const extra = [...(this.putInside({ ...j.rec, intent: one }, L) ? ['inside'] : []), ...(j.rec.readHeld.some((k) => judged.some((o) => o.key === k && !o.applied)) || done.some((x) => x.step > j.rec.readStep && x.structural) ? ['ownStructural'] : []), ...(lapped ? ['overlap'] : [])]
          this.obs.push({ fam: 'cut', name: `${j.intent.name} (a range left out)`, applied: false, classes: [...new Set([...cls.split('+').filter(Boolean), ...extra])].sort().join('+'), afterChoice: this.chose, step: this.step, ...(j.rec.reason ? { reason: j.rec.reason } : {}) })
        }
      }
      if (!stillThere(j.intent, L, this.shape, others) || (!j.applied && !stillThere(j.intent, M, this.shape))) continue
      // (Marks or new text for a line the agent itself retyped after that
      // read: the words it numbered are not the line's words any more.)
      const retyped = (it: Intent): boolean => it.fam === 'lineText' && it.lineId === j.intent.lineId
      if (!j.applied && j.intent.lineId && (judged.some((o) => o !== j && o.applied && retyped(o.intent) && o.rec.at > j.rec.readStep) || done.some((x) => x.step > j.rec.readStep && retyped(x.intent)))) continue
      // No loss, by the projects: the op would change nothing; the command
      // makes no clip that short; the agent was told and sent a later edit.
      const cls = this.classesSince(j.rec.readStep, who)
      let own: string | undefined
      if (!j.applied) {
        // (The project the op met: the live one and the ops before it.)
        const met = mat && j.n !== undefined ? mat.at(j.n) : L
        const lit = literal(j.intent, L, this.shape)
        if (this.already(j.intent, met)) own = 'already'
        else if (this.tiny(j.intent, met)) own = 'tiny'
        else if (j.rec.retired) own = 'retired'
        else if (cls === '' && this.ownTook(j.intent, met)) own = 'ownTook'
        // (A retake whose kept take is gone, whoever took it; a time on
        // footage that is on the timeline twice: rightly not made.)
        else if (j.intent.takes?.length && this.ownTook(j.intent, met)) own = 'keptGone'
        else if (this.twice(j.intent, met)) own = 'twice'
        // (K1: it would delete, shorten or write over a record whose setting
        // someone else made after its read.)
        else if (this.userChanged(j.rec, j.intent, met)) own = 'userChanged'
        else if (cls === '' && filmOf(met) !== filmOf(j.rec.seen)) {
          // An earlier edit of the agent's own moved things since its read.
          // A literal op's ids and seconds are then no longer the project's
          // (counted: "framed"). A trim, delete or split the core runs
          // literally (it also moves subtitles, a packed track…) the same:
          // reported in a bucket of its own. A cut, a placement, a setting
          // or a line op is never excused this way.
          // (An op that only adds, written by seconds or ids: after an own
          // edit that MOVED what was there, the same.)
          if (lit || j.intent.fam === 'adding') own = 'ownMoved'
          else if (['trimHead', 'trimEnd', 'delete', 'split'].includes(j.intent.fam)) own = 'ownMovedTrim'
          // (A line with a word over no sound cannot be told by its words.)
          else if (j.intent.lineId && (j.intent.words ?? []).some((w) => w.inst === undefined)) own = 'ownMovedHang'
        } else if (cls === '' && lit) own = 'literalNoop'
      }
      // (A cut sent on an older read, into whose range someone has put
      // something since: its own kind of change, whatever the step was.)
      // (And an op that meets a structural edit of the agent's own, made
      // after its read: literal work on the whole timeline, after which
      // what was read is no longer what is there. Its own kind as well.)
      const isStructural = (it: Intent): boolean => literal(it, L, this.shape)
      // (Or the other way round: the view it was read in held a literal op
      // of the agent's own that is dropped now — the project it was written
      // for is not there to be had.)
      const viewGone = (rec: OpRec): boolean => rec.readHeld.some((k) => judged.some((o) => o.key === k && !o.applied))
      const ownStructural = !j.applied && (judged.some((o) => o !== j && o.applied && isStructural(o.intent)) || done.some((x) => x.step > j.rec.readStep && x.structural) || viewGone(j.rec))
      // (And the state the command layer's fault K-1 leaves (plan 7.4): lines
      // whose sound the app has noted as a clip that is not the talk's (the
      // music bed). The core then cannot tell which track the talk is on,
      // and says so; such a drop is K-1's, counted on its own.)
      // (The same fault from its other side: taking the bed away from under
      // lines the command layer reads as the bed's.)
      const bedOp = !j.applied && !!this.shape.bed && (j.intent.fam === 'delete' || j.intent.fam === 'trimHead' || j.intent.fam === 'trimEnd') && j.intent.track !== this.shape.voiceTrack
      const bedLines = bedOp || (!j.applied && [j.rec.seen, L].some((p) => p.captions.some((c) => !c.manual && !c.shape && c.soundClip && p.clips[c.soundClip] && p.clips[c.soundClip].trackId !== this.shape.voiceTrack)))
      // (A placement: other footage slid under its moment since the read —
      // the moment is not the one that was read.)
      const moment = !j.applied && j.intent.fam === 'place' && j.intent.ref ? { ...j.rec, intent: { ...j.intent, pieces: [{ inst: j.intent.ref.inst, iv: [j.intent.ref.src, j.intent.ref.src + 0.03] as Iv }] } } : null
      // (Clips lying over each other on the talk's track — a linked drag,
      // plan 7.4 K-4: a cut there has no one meaning. And a title whose
      // length footage came back under: S11.)
      const voiceClips = Object.values(L.clips).filter((c) => c.trackId === this.shape.voiceTrack).sort((a, b) => a.start - b.start)
      const over = !j.applied && voiceClips.some((c, i) => i > 0 && c.start < voiceClips[i - 1].start + voiceClips[i - 1].duration - 1e-6)
      const extra = [...(!j.applied && j.intent.fam === 'cut' && this.putInside(j.rec, L) ? ['inside'] : []), ...(moment && (this.putInside(moment, L) || this.cameBack(j.intent, j.rec.seen, L)) ? ['inside'] : []), ...(ownStructural ? ['ownStructural'] : []), ...(bedLines ? ['bedLines'] : []), ...(over ? ['overlap'] : [])]
      const classes = extra.length ? [...new Set([...cls.split('+').filter(Boolean), ...extra])].sort().join('+') : cls
      // (A cut that follows no footage — past the talk, on a locked talk —
      // is a literal op: counted with the structural ones.)
      this.obs.push({ fam: literal(j.intent, L, this.shape) ? 'structural' : j.intent.fam, name: j.intent.name, applied: j.applied, classes, afterChoice: this.chose, step: this.step, ...(j.applied || !j.rec.reason ? {} : { reason: j.rec.reason }), ...(own ? { own } : {}) })
    }
  }

  /** An agent's ops landed on the live project (L → M). */
  private land(judged: readonly J[], L: Project, M: Project, who: number): void {
    const a = this.agents[who]
    const voice = this.shape.voiceTrack
    for (const j of judged) {
      if (!j.applied) continue
      const it = j.intent
      a.done.push({ step: this.step, intent: it, structural: literal(it, L, this.shape), read: j.rec.readStep })
      // What it wrote is, to the other agents, a value they did not write.
      if (it.fam === 'record') this.writes.push({ step: this.step, by: who, what: `${it.inst}.${it.field}`, value: it.value })
      if (it.fam === 'lineText') this.writes.push({ step: this.step, by: who, what: `line:${it.words!.map((w) => w.tag ?? '').join(',')}`, lineId: it.lineId, text: it.text })
      if (it.fam === 'lineMarks') this.writes.push({ step: this.step, by: who, what: `marks:${it.lineId}`, text: it.marks!.map((w) => w.tag ?? w.key).sort().join(',') })
      if (it.fam === 'field') this.writes.push({ step: this.step, by: who, what: `field:${it.field}`, value: it.value })
      if (it.fam === 'lineSet') this.writes.push({ step: this.step, by: who, what: `line:${it.lineId}:${it.field}`, value: it.value })
    }
    if (M === L) return
    // (K1: what it set is, to every other agent, a setting it did not make.)
    this.sets.push(...settingsBetween(L, M, this.step, who))
    a.landings.push([L, M])
    if (a.landings.length > 12) a.landings.shift()
    // Where its records are: its own only while they stay there. (A record
    // of its making that its own later edit moved is still where IT put it.)
    for (const id of a.ids) {
      const r = recordIn(M, id)
      if (!r) continue
      const was = recordIn(L, id)
      const here = was ? relAt(L, voice, was.a, was.b) : null
      const kept = a.rel.get(id) ?? []
      const same = (x: Rel, y: Rel): boolean => [0, 1].every((i) => (!x[i] || !y[i] ? !x[i] && !y[i] : x[i]!.inst === y[i]!.inst && Math.abs(x[i]!.src - y[i]!.src) <= 0.021))
      if (!was || !kept.length || !here || kept.some((k) => same(k, here))) a.rel.set(id, [...kept, relAt(M, voice, r.a, r.b)].slice(-8))
    }
    // Records its landing moved (a cut through a title…): from where to where.
    for (const id of [...(M.markers ?? []).map((m) => m.id), ...M.captions.filter((c) => c.manual || c.shape || !c.words?.length).map((c) => c.id), ...(M.templates ?? []).map((t) => t.id)]) {
      const was = recordIn(L, id)
      const is = recordIn(M, id)
      if (!was || !is) continue
      const from = relAt(L, voice, was.a, was.b)
      const to = relAt(M, voice, is.a, is.b)
      if (JSON.stringify(from) !== JSON.stringify(to)) a.moves.set(id, [...(a.moves.get(id) ?? []), [from, to] as [Rel, Rel]].slice(-8))
    }
    // To everyone else, a change of the film they did not make.
    if (filmOf(L) !== filmOf(M)) this.changes.push({ step: this.step, cls: 'otherAgent', film: true, by: who })
  }

  /** Is there, where this cut would cut in `L`, a marker, a title or a clip
   *  of another track that was not there (under that talk) when the agent
   *  read? Judged from the two projects alone. */
  private putInside(rec: OpRec, L: Project): boolean {
    const voice = this.shape.voiceTrack
    const seen = rec.seen
    const mine = this.mineOf(rec.who)
    const spans = cutSpans(rec.intent, L, this.shape)
    const hit = (a: number, b: number): boolean => spans.some(([x, y]) => a < y - 1e-6 && b > x + 1e-6)
    const same = (x: Content | null, y: Content | null): boolean => (!x || !y ? !x && !y : x.inst === y.inst && Math.abs(x.src - y.src) <= 0.021)
    /** A record that lies there now and did not (there) when the agent read. */
    const fresh = (id: string, a: number, b?: number): boolean => {
      const here = relAt(L, voice, a, b)
      const was = recordIn(seen, id)
      if (was) {
        const r = relAt(seen, voice, was.a, was.b)
        if (same(r[0], here[0]) && same(r[1], here[1])) return false
      }
      const made = mine.ids.has(id) ? mine.rel?.(id) : undefined
      return !(mine.ids.has(id) && (!made || made.some((r) => same(r[0], here[0]) && same(r[1], here[1]))))
    }
    if ((L.markers ?? []).some((m) => hit(m.time, m.time + 1e-3) && fresh(m.id, m.time))) return true
    if (L.captions.some((c) => (c.manual || c.shape || !c.words?.length) && hit(c.start, c.end) && fresh(c.id, c.start, c.end))) return true
    if ((L.templates ?? []).some((t) => hit(t.start, t.start + (t.duration ?? 0)) && fresh(t.id, t.start, t.start + (t.duration ?? 0)))) return true
    for (const c of Object.values(L.clips)) {
      if (c.trackId === voice) continue
      for (const [x, y] of spans) {
        const a = Math.max(x, c.start)
        const b = Math.min(y, c.start + c.duration)
        if (b - a <= 1e-6) continue
        for (const f of [0.1, 0.5, 0.9]) {
          const t = a + f * (b - a)
          const v = contentAt(L, voice, t)
          if (!v) continue
          if (isStill(L, c)) {
            if (!hasStill(seen, voice, instOf(c), v) && !mine.pair?.(c.trackId, instOf(c), null, v)) return true
          } else {
            const k = Math.round(srcAt(c, t) / STEP)
            const near = [k - 1, k, k + 1].some((q) => {
              const tq = c.speedCurve ? timeAt(c, q * STEP) : c.start + (q * STEP - c.inPoint) / speedOf(c)
              const vq = contentAt(L, voice, tq)
              return !!vq && (hasPair(seen, voice, c.trackId, instOf(c), q, vq) || !!mine.pair?.(c.trackId, instOf(c), q, vq))
            })
            if (!near) return true
          }
        }
      }
    }
    // (More of a clip of another track lies in the range now than when the
    // agent read, and not by the agent's doing: the core cuts none of the
    // footage someone else put into a range after the read, however little
    // (replay.ts `known`, to 1e-4 s), and the samples above, a STEP apart,
    // miss it at the range's edge. Seed 1437: the user's undo of the
    // agent's own trim gave a clip back its tail, 0.02 s of it inside the
    // range; phase Ç2b, E3.)
    const seenSpans = cutSpans(rec.intent, seen, this.shape)
    const overlapOf = (c: Clip, list: readonly Iv[]): number => lenOf(inter([[c.start, c.start + c.duration]], [...list]))
    const touched = (c: Clip): boolean =>
      this.agents[rec.who].done.some((d) => d.step > rec.readStep && d.intent.clipId === c.id) ||
      this.ops.some((o) => o.who === rec.who && o.seq !== undefined && o.seq === rec.seq && o.index < rec.index && o.intent.clipId === c.id)
    for (const c of Object.values(L.clips)) {
      if (c.trackId === voice || mine.ids.has(c.id) || isStill(L, c)) continue
      const was = seen.clips[c.id]
      if (!was || was.trackId !== c.trackId || (was.speed ?? 1) !== (c.speed ?? 1) || JSON.stringify(was.speedCurve) !== JSON.stringify(c.speedCurve) || touched(c)) continue
      if (overlapOf(c, spans) > overlapOf(was, seenSpans) + 1e-4) return true
    }
    return false
  }

  /** Does [a, b) of `track` lie where a waiting cut will cut? */
  private insideCut(L: Project, track: string, span: Iv): boolean {
    if (track === this.shape.voiceTrack) return false
    return this.ops.some((o) => o.intent.fam === 'cut' && !o.refused && cutSpans(o.intent, L, this.shape).some(([a, b]) => span[0] < b - 1e-6 && span[1] > a + 1e-6))
  }

  read(who = 0): SeenAt {
    this.step++
    const a = this.agents[who]
    a.old = a.seen
    const got = this.d.read(who)
    const mine = this.d.draft()
    a.seen = { ...got, step: this.step, film: filmOf(S().project), held: mine && mine.who === who ? this.ops.filter((o) => o.lastApplied && literal(o.intent, S().project, this.shape)).map((o) => o.key) : [] }
    // (The same version name as the read before — nothing but a lock or a
    // note changed: the app keeps ONE project under a name, the newer.)
    if (a.old && a.old.token === a.seen.token) a.old = a.seen
    // (Two sessions of one program share its kept versions: the other one's
    // read of that name is the newer project too.)
    for (const [i, b] of this.agents.entries()) {
      if (b === a || i > 1 || who > 1) continue
      if (b.seen && b.seen.token === a.seen.token) b.seen = a.seen
      if (b.old && b.old.token === a.seen.token) b.old = a.seen
    }
    // (A read tells the draft's owner what was dropped since.)
    const dn = this.d.draft()
    if (dn && dn.who === who) for (const o of this.ops) if (o.lastApplied === false) o.told = true
    this.say(`A${who || ''} read v ${a.seen.token}`)
    return a.seen
  }

  /** Executes one step; false when it could not be made (nothing happened).
   *  After it, the model's rules (model/check.ts, phase Ç2a.1): a rule the
   *  step broke is a violation of its own kind. */
  async exec(st: Step): Promise<boolean> {
    const before = S().project
    const made = await this.execStep(st)
    const after = S().project
    const fresh = newProblems(before, after)
    if (fresh.length) this.found([{ kind: 'model-check', detail: describeProblems(fresh) }])
    // A user's speed change (or its undo / redo): the clip stays inside its
    // media and what rides on it stays on its moment (core polish B).
    if (st.k === 'user' && (st.act.t === 'undo' || st.act.t === 'redo' || st.act.t === 'curve' || (st.act.t === 'batch' && st.act.name === 'clip.setSpeed'))) this.found(speedProblems(before, after, this.shape.voiceTrack, st.act.t === 'batch' || st.act.t === 'curve'))
    // The subtitle lines (audit patch yama-c, Y1): no step makes a line
    // shorter than the floor, lay it over the next, off its sound, around
    // words it does not hold, past its last word, or run the film on for it
    // — but the user's own retiming of a line's end (capTime: the user's
    // choice; after one, a line's end past its last word is the user's) and
    // a lock (a cut before it moved the lines and not the locked sound).
    if (st.k === 'user' && st.cls === 'capTime') this.retimed = true
    else if (!(st.k === 'user' && st.cls === 'lock')) this.found(newLineProblems(before, after, { tail: !this.retimed }).map((x) => ({ kind: `line-${x.what}`, detail: x.detail })))
    return made
  }


  private async execStep(st: Step): Promise<boolean> {
    closeEditWindows()
    switch (st.k) {
      case 'read':
        this.read(st.who ?? 0)
        return true
      case 'analyze': {
        const who = st.who ?? 0
        const seen = this.read(who)
        const id = this.d.analysis(seen, st.ranges, who, st.keeps)
        this.results.push({ id, seen, ranges: st.ranges, who, ...(st.keeps ? { keeps: st.keeps } : {}) })
        this.say(`A${who || ''} analyze ${id} ${JSON.stringify(st.ranges)}${st.keeps ? ` kept for ${JSON.stringify(st.keeps)}` : ''}`)
        return true
      }
      case 'edit': {
        const a = this.agents[st.who ?? 0]
        const src = st.from === 1 ? a.old : a.seen
        return !!src && this.edit(st.ops, src, st.who ?? 0)
      }
      case 'user':
        return this.user(st.cls, st.act)
      case 'accept':
        return this.accept(st.seqs, st.late)
      case 'remove':
        return this.removeRange(st.seq, st.op, st.range)
      case 'revive':
        return this.revive(st.seq, st.op)
      case 'reject':
        return this.reject()
      case 'mode':
        this.step++
        this.d.setMode(st.mode)
        this.say(`U mode ${st.mode}`)
        return true
    }
  }

  /** The n-th analysis of the run (ops name them "r1", "r2"… as the driver does). */
  private resultOf(id: unknown): { id: string; seen: SeenAt; ranges: Iv[]; who: number; keeps?: (Iv | null)[] } | undefined {
    return this.results.find((r) => r.id === id)
  }

  resultIds(who = 0): string[] {
    return this.results.filter((r) => r.who === who).map((r) => r.id)
  }

  /** One edit call: `raws` as the agent sends them, written against `src`. */
  private async edit(raws: Record<string, unknown>[], src: SeenAt, who: number): Promise<boolean> {
    let intents: Intent[]
    try {
      intents = raws.map((raw) => {
        if (raw.op !== 'apply') return capture(src.project, this.shape, raw)
        const r = this.resultOf(raw.result)
        if (!r || r.who !== who) throw new Error('no such result')
        return { ...capture(r.seen.project, this.shape, { op: 'timeline.cutRanges', ranges: r.ranges, ...(r.keeps ? { keeps: r.keeps } : {}) }), name: `apply ${raw.result}` }
      })
    } catch {
      return false
    }
    this.step++
    const agent = this.agents[who]
    for (const it of intents) if (it.recId) agent.ids.add(it.recId)
    this.say(`A${who || ''} edit base=${src.token} (read at ${src.step}) ${JSON.stringify(raws)}`)
    const from = (raw: Record<string, unknown>): SeenAt => (raw.op === 'apply' ? this.resultOf(raw.result)!.seen : src)
    const L = S().project
    const before = this.d.draft()
    const hadDraft = !!before
    // B11: what the agent was told is dropped stays dropped once it sends a
    // later edit (one that is kept).
    const toRetire = before && before.who === who ? this.ops.filter((o) => o.told && o.lastApplied === false) : []
    const rep = await this.d.edit(raws, src.token, who)
    if (rep.error) {
      // The call was refused whole, with a sentence (a version that names
      // nothing here…): nothing was applied and nothing waits.
      this.say(`  → error: ${rep.error.split('\n').slice(0, 3).join(' | ')}`)
      return true
    } else if (rep.refused.size) this.say(`  → refused ${[...rep.refused].map((i) => `#${i + 1}`).join(' ')}: ${rep.answer.split('\n').filter((l) => /^#\d/.test(l)).join(' | ').slice(0, 300)}`)
    const recs: OpRec[] = raws.map((raw, i) => ({
      key: `${rep.seq ?? `x${this.step}`}:${i}`,
      seq: rep.seq,
      index: i,
      who,
      intent: intents[i],
      raw,
      refused: !!rep.error || rep.refused.has(i),
      readStep: from(raw).step,
      seen: from(raw).project,
      // (K1: the later of the result's read and the call's base.)
      k1Step: Math.max(src.step, from(raw).step),
      k1Seen: from(raw).step > src.step ? from(raw).project : src.project,
      readFilm: from(raw).film,
      readHeld: from(raw).held,
      at: this.step,
      ...(rep.reasons?.has(i) ? { reason: rep.reasons.get(i) } : {}),
      ...(rep.left?.has(i) ? { left: rep.left.get(i) } : {})
    }))
    // A title or marker placed without an id: the record it made (the new
    // one of its kind nearest to where it was meant) is the agent's from here
    // on, and must keep that id on every replay.
    const made = rep.seq !== undefined ? this.d.draft()?.project : S().project
    if (made) this.claim(recs.filter((r) => !r.refused), L, made, rep.seq !== undefined ? this.d.draft()?.mat : rep.mat)
    if (!hadDraft && rep.seq === undefined) {
      // Straight onto the timeline (or nothing of it was applied).
      const M = S().project
      const judged = this.judge(recs, (r) => !r.refused, L, rep.mat)
      // (What landed is what replaying the same ops on the same project gives.)
      if (rep.mat && M !== L && filmOf(rep.mat.again()) !== filmOf(M)) this.found([{ kind: 'replay-diverged', detail: 'replaying the ops that landed on the project they landed on gives another film' }])
      // (Always: an op reported applied on a project that did not change is a wrong.)
      this.verdict(L, M, judged, who, rep.mat)
      this.observe(L, judged, M, rep.mat)
      this.land(judged, L, M, who)
      for (const it of intents) if (it.fam === 'lineText') agent.ids.add(`line ${it.lineId}`)
      return true
    }
    if (rep.seq !== undefined) for (const o of toRetire) o.retired = true
    // (The answer told the agent which of these were dropped.)
    for (const r of recs) if (r.refused) r.told = true
    this.ops.push(...recs)
    this.settle(true)
    // (The answer's news told the agent everything that is dropped now.)
    for (const o of this.ops) if (o.lastApplied === false) o.told = true
    // (A line the agent retyped has words of its own making from here on.)
    for (const it of intents) if (it.fam === 'lineText') agent.ids.add(`line ${it.lineId}`)
    // A call of which nothing was applied left nothing in the draft: its ops
    // were refused then and there (and counted once, above).
    this.ops = this.ops.filter((o) => o.seq !== undefined)
    return true
  }

  private claim(recs: readonly OpRec[], L0: Project, M0: Project, mat?: Mat): void {
    const voice = this.shape.voiceTrack
    const taken = new Set(this.agents.flatMap((a) => [...a.ids]))
    const place = new Map((mat?.ops ?? []).map((o, n) => [`${o.seq}:${o.index}`, n]))
    for (const rec of recs) {
      const it = rec.intent
      if (it.fam !== 'place' || it.recId) continue
      // (With the projects between the ops at hand: the record this very op
      // made — a later op of the agent's may have moved or taken it.)
      const n = mat ? (rec.seq === undefined ? rec.index : place.get(`${rec.seq}:${rec.index}`)) : undefined
      const L = mat && n !== undefined ? mat.at(n) : L0
      const M = mat && n !== undefined ? mat.at(n + 1) : M0
      const fresh = it.recKind === 'marker' ? (M.markers ?? []).filter((m) => !(L.markers ?? []).some((x) => x.id === m.id)).map((m) => ({ id: m.id, t: m.time })) : M.captions.filter((c) => (c.manual || c.shape || !c.words?.length) && !L.captions.some((x) => x.id === c.id)).map((c) => ({ id: c.id, t: c.start }))
      // (An id an agent's record had may be made again once that record is gone.)
      const free = fresh.filter((x) => !taken.has(x.id) || !recordIn(L, x.id))
      if (!free.length) continue
      const dev = (t: number): number => {
        // (Clips may lie over each other on the talk's track: any of them.)
        const on = it.ref ? allAt(M, voice, t).filter((c) => c.inst === it.ref!.inst).map((c) => Math.abs(c.src - it.ref!.src)) : []
        return on.length ? Math.min(...on) : 1e6 + Math.abs(t - (it.seenTime ?? 0))
      }
      const best = free.sort((x, y) => dev(x.t) - dev(y.t))[0]
      // (Only a record that lies where this op meant: one of several ops
      // without an id may have lost its record to a later cut of the agent's.)
      if (it.ref && dev(best.t) > 0.05) continue
      it.recId = best.id
      taken.add(best.id)
      this.agents[rec.who].ids.add(best.id)
    }
  }

  /** A cut that left the bed alone was made in this run. */
  private keptCut = false
  /** The user set a line's end by hand in this run (capTime). */
  private retimed = false

  /** A user's change of the live project. */
  private user(cls: string, act: UserAct, settle = true): boolean {
    const before = S().project
    const v = S().projectVersion
    let film = true
    try {
      if (act.t === 'cut') S().rippleDeleteMany([act.range])
      else if (act.t === 'cutKeep') S().rippleDeleteMany([act.range], { keepTracks: act.keep, endBeds: act.end })
      else if (act.t === 'silenceKeep') S().applySilenceCuts(act.regions, { picked: act.picked, ...(act.keep.length ? { keepTracks: act.keep, endBeds: act.end } : {}) })
      else if (act.t === 'undo') S().undo()
      else if (act.t === 'redo') S().redo()
      else if (act.t === 'batch') S().runBatch([{ name: act.name, params: act.params }])
      else if (act.t === 'curve') {
        // (With its linked partner, as the speed changes are made.)
        const link = S().linkAV
        S().setLinkAV(true)
        try {
          S().setClipSpeedCurve(act.clipId, act.curve)
        } finally {
          S().setLinkAV(link)
        }
      }
      else if (act.t === 'lock') {
        const tr = before.tracks.find((t) => t.id === act.track)
        if (!tr) return false
        S().setTrackFlags(tr.id, { locked: !tr.locked })
      } else if (act.t === 'note') {
        film = false
        S().editNotes((p) => void addNote(p, { start: act.start, end: act.start + 1, kind: 'free', text: 'n' }, new Date(0)))
      } else if (act.t === 'copy') {
        if (!this.copyClip(act.clipId)) return false
      } else if (act.t === 'store') {
        if (!this.storeAct(act)) return false
      }
    } catch {
      return false
    }
    const L = S().project
    if (L === before && S().projectVersion === v) return false
    // (An undo or redo of a note, or of nothing in the film, is no change of the film.)
    if ((act.t === 'undo' || act.t === 'redo') && filmOf(L) === filmOf(before)) film = false
    // (A linked drag may leave two clips of a track lying over each other:
    // plan 7.4, K-4. Such a project is part of the runs: the core cuts
    // nothing on such a track, and the oracle reads every clip under a time.)
    this.step++
    // (K1: the settings this step made, the user's.)
    this.sets.push(...settingsBetween(before, L, this.step, -1).map((s) => (act.t === 'undo' || act.t === 'redo' ? { ...s, restore: true } : s)))
    // The kind of change, told apart where the model treats it apart: a
    // record put (or a clip dragged) where a waiting cut will cut; a setting
    // of content a waiting op set too.
    let kind = cls
    if (act.t === 'batch') {
      const p = act.params
      if (act.name === 'marker.add' || act.name === 'text.add') {
        const t = p.time as number
        if (this.insideCut(L, '', [t, act.name === 'text.add' ? t + 2.5 : t + 1e-3])) kind = 'markInside'
      }
      // (A template placed, a title or a marker moved: where it is now.)
      if (act.name === 'template.place') {
        const made = (L.templates ?? []).find((t) => !(before.templates ?? []).some((x) => x.id === t.id))
        if (made && this.insideCut(L, '', [made.start, made.start + (made.duration ?? 0)])) kind = 'markInside'
      }
      if (act.name === 'marker.update' || (act.name === 'caption.update' && cls === 'titleMove')) {
        const r = recordIn(L, String(p.id))
        if (r && this.insideCut(L, '', [r.a, r.b ?? r.a + 1e-3])) kind = 'markInside'
      }
      if (act.name === 'caption.setStyle') for (const [k, v] of Object.entries(p.patch as object)) this.writes.push({ step: this.step, by: -1, what: `field:captionStyle.${k}`, value: v })
      if (act.name === 'caption.update' && cls === 'titleText') this.writes.push({ step: this.step, by: -1, what: `line:${String(p.id)}:text`, value: (p.patch as { text?: string }).text })
      const clipId = (p.clipId as string | undefined) ?? (p.ids as string[] | undefined)?.[0] ?? (p.clipIds as string[] | undefined)?.[0]
      const c = clipId ? L.clips[clipId] : undefined
      if ((act.name === 'clip.move' || act.name === 'clip.add') && cls !== 'moveUnlinked') {
        const made = act.name === 'clip.add' ? Object.values(L.clips).find((x) => !before.clips[x.id]) : c
        if (made && this.insideCut(L, made.trackId, [made.start, made.start + made.duration])) kind = `${cls}Inside`
      }
      const setting: Record<string, [string, unknown]> = { 'clip.setVolume': ['volume', p.volume], 'clip.setOpacity': ['opacity', p.opacity], 'clip.setMuted': ['muted', !!p.muted], 'clip.setTransition': ['transitionOut', p.transition ?? null] }
      if (setting[act.name] && c) {
        const [field, value] = setting[act.name]
        this.writes.push({ step: this.step, by: -1, what: `${instOf(c)}.${field}`, value })
        if (this.ops.some((o) => o.intent.fam === 'record' && o.intent.inst === instOf(c) && o.intent.field === field)) kind = 'propSame'
      }
      if (act.name === 'caption.editLine' && p.text !== undefined && before.captions.find((x) => x.id === p.id)?.text !== L.captions.find((x) => x.id === p.id)?.text) {
        const line = before.captions.find((x) => x.id === p.id)
        this.writes.push({ step: this.step, by: -1, what: `line:${(line?.words ?? []).map((w) => wordTag(w) ?? '').join(',')}`, lineId: String(p.id), text: L.captions.find((x) => x.id === p.id)?.text })
      }
      if (act.name === 'caption.update' && (p.patch as { marks?: number[] } | undefined)?.marks) {
        const line = L.captions.find((x) => x.id === p.id)
        this.writes.push({ step: this.step, by: -1, what: `marks:${String(p.id)}`, text: (line?.marks ?? []).map((i) => wordTag(line!.words?.[i] ?? {}) ?? `#${i}`).sort().join(',') })
      }
    }
    // An undo or a redo is the kind of change it takes back or makes again.
    const also: string[] = []
    if (act.t === 'cutKeep' || (act.t === 'silenceKeep' && act.keep.length)) this.keptCut = true
    if (act.t === 'undo' || act.t === 'redo') {
      // (A cut that kept the bed, taken back or made again: the bed is out
      // of step with the rest as after the cut itself.)
      if (this.keptCut) also.push('cutKeep')
      if (L.tracks.some((t) => !!t.locked !== !!before.tracks.find((x) => x.id === t.id)?.locked)) also.push('lock')
      if (L.tracks.map((t) => t.id).join() !== before.tracks.map((t) => t.id).join()) also.push('reorder')
      const moved = Object.values(L.clips).filter((c) => {
        const was = before.clips[c.id]
        return !was || was.start !== c.start || was.duration !== c.duration || was.trackId !== c.trackId
      })
      if (Object.values(L.clips).some((c) => before.clips[c.id] && ((before.clips[c.id].speed ?? 1) !== (c.speed ?? 1) || JSON.stringify(before.clips[c.id].speedCurve) !== JSON.stringify(c.speedCurve)))) also.push('speed')
      if (moved.some((c) => this.insideCut(L, c.trackId, [c.start, c.start + c.duration]))) also.push('addInside')
      const marks = [...(L.markers ?? []).filter((m) => !(before.markers ?? []).some((x) => x.id === m.id && x.time === m.time)).map((m): Iv => [m.time, m.time + 1e-3]), ...L.captions.filter((c) => (c.manual || c.shape) && !before.captions.some((x) => x.id === c.id && x.start === c.start && x.end === c.end)).map((c): Iv => [c.start, c.end])]
      if (marks.some((iv) => this.insideCut(L, '', iv))) also.push('markInside')
      for (const c of Object.values(L.clips)) {
        const was = before.clips[c.id]
        if (was && was.volume !== c.volume && this.ops.some((o) => o.intent.fam === 'record' && o.intent.inst === instOf(c) && o.intent.field === 'volume')) also.push('propSame')
      }
    }
    this.changes.push({ step: this.step, cls: kind, film, by: -1 })
    for (const k of new Set(also)) this.changes.push({ step: this.step, cls: k, film, by: -1 })
    this.say(`U ${[kind, ...new Set(also)].join('+')} ${JSON.stringify(act)}`)
    if (settle) this.settle(true)
    return true
  }

  /** A setting the editor makes with a store action (K1's user steps). */
  private storeAct(act: Extract<UserAct, { t: 'store' }>): boolean {
    const p = S().project
    const c = p.clips[act.clipId]
    if (!c || p.tracks.find((t) => t.id === c.trackId)?.locked) return false
    switch (act.fn) {
      case 'grade':
        S().setClipGrade(c.id, { brightness: 0, contrast: 0.1, saturation: -1, warmth: 0 })
        break
      case 'blend':
        S().setClipBlendMode(c.id, c.blendMode === 'screen' ? 'multiply' : 'screen')
        break
      case 'mask':
        S().setClipMask(c.id, { enabled: true, shape: 'ellipse', feather: 4 })
        break
      case 'keyframe':
        // A move of the picture: two keys of its scale, inside the clip.
        if (c.duration < 0.8) return false
        S().undoable(() => {
          S().setTime(c.start + 0.2)
          S().addPropKeyframe(c.id, 'scale')
          S().setTime(c.start + c.duration - 0.2)
          S().setPropValue(c.id, 'scale', 1.3)
        })
        break
      case 'fill': {
        const a = p.assets.find((x) => x.id === act.asset)
        if (!a || !c.automationMissing) return false
        return S().fillAutomationMissingImage(c.id, a)
      }
    }
    return true
  }

  /** The user duplicates a clip to the end of its track. The copy is NEW
   *  content: the file is registered again under a new asset id first, so
   *  every asset stays in one instance. */
  private copyClip(clipId: string): boolean {
    const p = S().project
    const src = p.clips[clipId]
    const a = src && p.assets.find((x) => x.id === src.assetId)
    if (!src || !a) return false
    const end = Math.max(0, ...p.tracks.find((t) => t.id === src.trackId)!.clipIds.map((id) => p.clips[id]).filter(Boolean).map((c) => c.start + c.duration))
    const copy: Asset = { ...a, id: `${a.id.split('~')[0]}~${++this.copies}` }
    S().addAssets([copy])
    let made = ''
    // (One clip is copied, as an Alt-drag with the link off does: the oracle
    // names content by asset, one placement each.)
    const link = S().linkAV
    useStore.setState({ linkAV: false })
    try {
      S().undoable(() => {
        made = S().duplicateClipsInPlace([clipId])[0]
        if (made) S().runBatch([{ name: 'clip.move', params: { clipId: made, start: end + 0.5 } }])
      })
    } finally {
      useStore.setState({ linkAV: link })
    }
    if (!made) return false
    const now = S().project
    useStore.setState({ project: { ...now, clips: { ...now.clips, [made]: { ...now.clips[made], assetId: copy.id } } } })
    return true
  }

  /** After a step: the delayed replay runs, the draft is judged against the
   *  live project. */
  settle(observe = false): void {
    const dn = this.d.draft()
    if (!dn) {
      this.ops = []
      this.lastPair = null
      return
    }
    const L = S().project
    if (this.lastPair && this.lastPair[0] === L && this.lastPair[1] === dn.project) return
    this.lastPair = [L, dn.project]
    if (dn.reason) for (const r of this.ops) if (r.seq !== undefined) r.reason = dn.reason(r.seq, r.index)
    if (dn.left) for (const r of this.ops) if (r.seq !== undefined) r.left = dn.left(r.seq, r.index)
    this.claim(this.ops.filter((r) => r.seq !== undefined && dn.applied(r.seq, r.index)), L, dn.project, dn.mat)
    const judged = this.judge(this.ops, (r) => r.seq !== undefined && dn.applied(r.seq, r.index), L, dn.mat)
    this.verdict(L, dn.project, judged, dn.who, dn.mat)
    if (observe) this.observe(L, judged, dn.project, dn.mat)
    else for (const j of judged) j.rec.lastApplied = j.applied
  }

  /** The user accepts all of the draft, or the entries `seqs`. */
  private accept(want?: number[], late?: { cls: string; act: UserAct }): boolean {
    const dn = this.d.draft()
    if (!dn) return false
    const seqs = want?.filter((s) => dn.seqs.includes(s))
    if (seqs && (seqs.length === 0 || seqs.length === dn.seqs.length)) return false
    // The card is drawn; the user changes something; then presses accept.
    const card = late ? this.d.preview(seqs) : null
    if (late && (!card || !this.user(late.cls, late.act, false))) return false
    this.step++
    this.say(`D accept ${seqs ? seqs.join(',') : 'all'}${late ? ' (with what the card showed before that change)' : ''}`)
    if (seqs) this.chose = true
    const who = dn.who
    const L = S().project
    let r: ReturnType<Driver['accept']>
    try {
      r = this.d.accept(seqs, card?.shown)
    } catch (e) {
      this.say(`  → error: ${e instanceof Error ? e.message : String(e)}`)
      return true
    }
    if (r.adopted) {
      const M = S().project
      if (r.left) for (const o of this.ops) if (o.seq !== undefined && !o.refused) o.left = r.left(o.seq, o.index)
      const chosen = this.ops.filter((o) => o.seq !== undefined && (!seqs || seqs.includes(o.seq)))
      this.claim(chosen.filter((o) => r.applied(o.seq!, o.index)), L, M, r.mat)
      const judged = this.judge(chosen, (o) => r.applied(o.seq!, o.index), L, r.mat)
      this.verdict(L, M, judged, who, r.mat)
      // What the user accepted is what the card showed.
      if (card && filmOf(card.project) !== filmOf(M)) this.found([{ kind: 'accepted-unseen', detail: 'the film that was adopted is not the film the card showed (the project changed between the card and the accept)' }])
      this.observe(L, judged, M, r.mat)
      this.land(judged, L, M, who)
    } else this.say(`  → nothing adopted${r.changed ? ' (not what the card showed)' : ''}`)
    // What still waits (a part not accepted) stays in play.
    const left = this.d.draft()
    this.ops = left ? this.ops.filter((o) => o.seq !== undefined && left.seqs.includes(o.seq) && !(r.adopted && r.applied(o.seq, o.index))) : []
    this.lastPair = null
    this.settle()
    return true
  }

  /** The user takes one range out of a cut list of the draft. */
  private removeRange(seq: number, opIndex: number, range: number): boolean {
    if (!this.d.removeRange || !this.d.draft()) return false
    const op = this.ops.find((o) => o.seq === seq && o.index === opIndex && !o.refused && o.raw.op === 'timeline.cutRanges')
    const ranges = op?.raw.ranges as unknown[] | undefined
    if (!op || !ranges || ranges.length < 2 || range >= ranges.length) return false
    if (!this.d.removeRange(seq, opIndex, range)) return false
    this.step++
    this.chose = true
    this.say(`D remove range ${range} of ${op.key}`)
    // The op now means its other ranges only.
    const rest = ranges.filter((_, k) => k !== range)
    op.intent = { ...capture(op.seen, this.shape, { op: 'timeline.cutRanges', ranges: rest }), name: op.intent.name }
    op.raw = { ...op.raw, ranges: rest }
    this.lastPair = null
    this.settle()
    return true
  }

  /** The user brings back an op that was dropped for good. */
  private revive(seq: number, opIndex: number): boolean {
    const op = this.ops.find((o) => o.seq === seq && o.index === opIndex)
    if (!op || !this.d.revive || !this.d.draft()) return false
    if (!this.d.revive(seq, opIndex)) return false
    this.step++
    this.chose = true
    op.retired = false
    op.told = false
    this.say(`D bring back ${op.key}`)
    this.lastPair = null
    this.settle()
    return true
  }

  private reject(): boolean {
    if (!this.d.draft()) return false
    this.step++
    this.say('D reject')
    this.d.reject()
    this.ops = []
    this.lastPair = null
    return true
  }

  /** Voice content at `t` in the live project (for the generator). */
  voiceAt(p: Project, t: number): boolean {
    return !!contentAt(p, this.shape.voiceTrack, t)
  }
}
