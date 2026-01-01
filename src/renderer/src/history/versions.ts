// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The project's version number and what changed between two versions
// (SnippStudio phase 2A.3, ANA-PLAN.md §2 rules 4–5).
//
// Every edit of the film gets the next number (the session's own count: it
// is not saved and never goes back, undo included). A note's text or status,
// the selection, the playhead and the view do not count. The log keeps, per
// version, what kind of change made it — and for a cut out of the whole
// timeline, the ranges — so a request made against an older version can be
// moved to today's times when nothing but cuts happened in between
// (`shiftTable`), and an agent can ask for just the difference
// (`changesSince`) instead of reading the project again.
import type { Project } from '../types'
import { sameValue } from './equal'

export type VersionKind = 'edit' | 'cut' | 'undo' | 'redo' | 'load'

export interface VersionEntry {
  version: number
  kind: VersionKind
  /** For a cut: each cut list applied, in the times of the version before
   *  it (one list per timeline.cutRanges, merged and sorted). */
  cuts?: [number, number][][]
  /** Locked tracks with clips after the cut: a cut leaves them where they
   *  are, so their times did not move with the rest. */
  fixedTracks?: string[]
}

/** One kept stretch of the old timeline and how far it moved left. */
export interface ShiftSegment {
  from: number
  to: number
  shift: number
}

export interface ShiftTable {
  from: number
  to: number
  /** The ranges cut out, in the old version's times, merged and sorted. */
  cuts: [number, number][]
  segments: ShiftSegment[]
  /** Locked tracks the cuts did not move: times on them stay as they were
   *  (do not map them). */
  fixedTracks: string[]
}

/** An old time in today's times; `removed` when it was strictly inside a
 *  cut (then `time` is where that cut closed up). A time on a cut's edge
 *  stays, as a marker there does. */
export function mapTime(table: ShiftTable, t: number): { time: number; removed: boolean } {
  for (const seg of table.segments) {
    if (t >= seg.from - 1e-9 && t <= seg.to + 1e-9) return { time: t - seg.shift, removed: false }
    if (t < seg.from) return { time: seg.from - seg.shift, removed: true }
  }
  const last = table.segments[table.segments.length - 1]
  return { time: last ? Math.max(0, last.to - last.shift) : t, removed: true }
}

const IDENTITY = (): ShiftSegment[] => [{ from: 0, to: Infinity, shift: 0 }]

/** The segments after one more cut list (in the times of the latest version). */
function cutSegments(segments: ShiftSegment[], cuts: readonly (readonly [number, number])[]): ShiftSegment[] {
  const out: ShiftSegment[] = []
  for (const seg of segments) {
    // This stretch, in the times the cuts are given in.
    let a = seg.from - seg.shift
    const b = seg.to - seg.shift
    for (const [ca, cb] of cuts) {
      if (cb <= a || ca >= b) continue
      if (ca > a) out.push(piece(seg, a, ca, cuts))
      a = Math.max(a, cb)
    }
    if (b > a) out.push(piece(seg, a, b, cuts))
  }
  return out
}

/** The part [a, b) (latest times) of an old segment, shifted further by the
 *  cuts before it. */
function piece(seg: ShiftSegment, a: number, b: number, cuts: readonly (readonly [number, number])[]): ShiftSegment {
  let before = 0
  for (const [ca, cb] of cuts) if (cb <= a + 1e-9) before += cb - ca
  return { from: a + seg.shift, to: b === Infinity ? Infinity : b + seg.shift, shift: seg.shift + before }
}

/** The kept stretches after several cut lists, each in the times of the
 *  timeline the one before left (phase 4A: the agent's drafts compose their
 *  own calls' cuts the same way). */
export function segmentsAfterCuts(lists: readonly (readonly (readonly [number, number])[])[]): ShiftSegment[] {
  let segments = IDENTITY()
  for (const list of lists) segments = cutSegments(segments, list)
  return segments
}

/** The cut ranges a segment list leaves out, in the first timeline's times. */
export function cutsOfSegments(segments: readonly ShiftSegment[]): [number, number][] {
  const cuts: [number, number][] = []
  for (let i = 0; i < segments.length; i++) {
    const gapStart = i === 0 ? 0 : segments[i - 1].to
    if (segments[i].from > gapStart + 1e-9) cuts.push([gapStart, segments[i].from])
  }
  return cuts
}

/** A capped id list: how many, the first ones, and whether there were more. */
export interface IdList {
  count: number
  ids: string[]
  truncated?: true
}

export interface IdChanges {
  added: IdList
  removed: IdList
  /** Only their times moved (as the shift table says, for a cut). */
  moved: IdList
  /** Their content changed. */
  changed: IdList
}

export interface CaptionChanges extends IdChanges {
  /** Lines whose word list changed: word positions in them given against the
   *  older version no longer address the same words. */
  wordsChanged: IdList
}

export interface Changes {
  from: number
  to: number
  /** Only whole-timeline cuts happened in between: the cut ranges in the old
   *  version's times. Absent otherwise. */
  cuts?: [number, number][]
  /** Locked tracks the cuts did not move: their clips kept their times. */
  fixedTracks?: string[]
  clips: IdChanges
  /** Subtitle lines, titles and shapes. */
  captions: CaptionChanges
  tracks: IdChanges
  markers: IdChanges
  templates: IdChanges
  /** Other parts of the project that changed (settings, captionStyle…). */
  other: string[]
}

/** How many ids a list names before it says "truncated". */
export const ID_CAP = 50

const capped = (ids: string[]): IdList => (ids.length > ID_CAP ? { count: ids.length, ids: ids.slice(0, ID_CAP), truncated: true } : { count: ids.length, ids })

type Kind = 'moved' | 'changed' | 'wordsChanged' | 'same'

/** The object without its time fields (each kind has its own), and its times. */
function timesOff(kind: 'clip' | 'caption' | 'marker' | 'template' | 'track', x: Record<string, unknown>): { rest: Record<string, unknown>; times: number[] } {
  if (kind === 'clip') {
    const { start, ...rest } = x
    return { rest, times: [start as number] }
  }
  if (kind === 'marker') {
    const { time, ...rest } = x
    return { rest, times: [time as number] }
  }
  if (kind === 'template') {
    const { start, ...rest } = x
    return { rest, times: [start as number] }
  }
  if (kind === 'caption') {
    // soundClip is the app's own note of which clip a line follows (set on
    // the first edit after the lines came): not a change of the line
    // (phase 4A: an agent's stale edit of the line is not refused for it).
    const { start, end, words, soundClip: _sc, ...rest } = x as { start: number; end: number; soundClip?: string; words?: { text: string; start: number; end: number }[] }
    const w = (words ?? []).map(({ start: _s, end: _e, ...o }) => o)
    return { rest: { ...rest, words: w }, times: [start, end, ...(words ?? []).flatMap((o) => [o.start, o.end])] }
  }
  return { rest: x, times: [] }
}

/** How an object changed: only its times by one shift (moved), its word list
 *  (captions), or anything else. */
function howChanged(kind: Parameters<typeof timesOff>[0], a: Record<string, unknown>, b: Record<string, unknown>): Kind {
  const x = timesOff(kind, a)
  const y = timesOff(kind, b)
  if (kind === 'caption') {
    const wa = (x.rest.words as { text: string }[]).map((w) => w.text)
    const wb = (y.rest.words as { text: string }[]).map((w) => w.text)
    if (!sameValue(wa, wb)) return 'wordsChanged'
  }
  if (!sameValue(x.rest, y.rest) || x.times.length !== y.times.length || x.times.length === 0) return 'changed'
  const d = y.times[0] - x.times[0]
  if (!x.times.every((t, i) => Math.abs(y.times[i] - t - d) < 1e-6)) return 'changed'
  // Only bookkeeping differed (a caption's soundClip): not a change.
  return Math.abs(d) < 1e-9 ? 'same' : 'moved'
}

function diffById<T extends { id: string }>(kind: Parameters<typeof timesOff>[0], a: readonly T[] | undefined, b: readonly T[] | undefined): IdChanges & { wordsChanged: string[] } {
  const before = new Map((a ?? []).map((x) => [x.id, x]))
  const after = new Map((b ?? []).map((x) => [x.id, x]))
  const out = { added: [] as string[], removed: [] as string[], moved: [] as string[], changed: [] as string[], wordsChanged: [] as string[] }
  for (const [id, x] of after) {
    const old = before.get(id)
    if (!old) out.added.push(id)
    else if (old !== x && !sameValue(old, x)) {
      const how = howChanged(kind, old as unknown as Record<string, unknown>, x as unknown as Record<string, unknown>)
      if (how !== 'same') out[how].push(id)
    }
  }
  for (const id of before.keys()) if (!after.has(id)) out.removed.push(id)
  return out as unknown as IdChanges & { wordsChanged: string[] }
}

const cap = (d: { added: unknown; removed: unknown; moved: unknown; changed: unknown }): IdChanges => ({
  added: capped(d.added as string[]),
  removed: capped(d.removed as string[]),
  moved: capped(d.moved as string[]),
  changed: capped(d.changed as string[])
})

const LISTED = new Set(['clips', 'captions', 'tracks', 'markers', 'templates', 'notes', 'noteSeq'])

/** What differs between two projects, by id. */
export function diffProjects(a: Project, b: Project): Omit<Changes, 'from' | 'to' | 'cuts' | 'fixedTracks'> {
  const other: string[] = []
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (LISTED.has(k)) continue
    const x = (a as unknown as Record<string, unknown>)[k]
    const y = (b as unknown as Record<string, unknown>)[k]
    if (x !== y && !sameValue(x, y)) other.push(k)
  }
  const tracksA = a.tracks.map(({ height: _h, ...t }) => t)
  const tracksB = b.tracks.map(({ height: _h, ...t }) => t)
  const caps = diffById('caption', a.captions, b.captions)
  // A track's clip list moving with its clips is not a change of the track.
  const tracks = diffById('track', tracksA, tracksB)
  return {
    clips: cap(diffById('clip', Object.values(a.clips), Object.values(b.clips))),
    captions: { ...cap(caps), wordsChanged: capped(caps.wordsChanged) },
    tracks: cap(tracks),
    markers: cap(diffById('marker', a.markers, b.markers)),
    templates: cap(diffById('template', a.templates, b.templates)),
    other: other.sort()
  }
}

/**
 * The log. Numbers for every version are kept (a few thousand: cheap); the
 * project itself only for the latest `keepProjects` versions and for
 * versions pinned by a reader (an agent holding a version number), since an
 * undone-to project shares nothing with its neighbours.
 */
export class VersionLog {
  private entries: VersionEntry[] = []
  private projects = new Map<number, Project>()
  private pinned: number[] = []
  private latest = 0
  /** This session's log: version numbers start again at 1 when the page
   *  reloads, so a number means something only with its epoch. */
  readonly epoch: string = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') + Date.now().toString(36)

  constructor(
    private readonly keepEntries = 5000,
    private readonly keepProjects = 100,
    private readonly keepPinned = 16
  ) {}

  get version(): number {
    return this.latest
  }

  /** A new version of the film; returns its number. */
  record(kind: VersionKind, project: Project, cuts?: [number, number][][], fixedTracks?: string[]): number {
    const version = ++this.latest
    this.entries.push({ version, kind, ...(kind === 'cut' && cuts?.length ? { cuts } : {}), ...(kind === 'cut' && fixedTracks?.length ? { fixedTracks } : {}) })
    if (this.entries.length > this.keepEntries) this.entries.splice(0, this.entries.length - this.keepEntries)
    this.projects.set(version, project)
    // Forget the projects of versions no longer among the latest, unless pinned.
    const oldest = version - this.keepProjects
    for (const v of this.projects.keys()) if (v <= oldest && !this.pinned.includes(v)) this.projects.delete(v)
    return version
  }

  /** Keep this version's project even when it gets old (a reader holds it). */
  pin(version: number): void {
    if (!this.projects.has(version) || this.pinned.includes(version)) return
    this.pinned.push(version)
    while (this.pinned.length > this.keepPinned) {
      const v = this.pinned.shift()!
      if (v <= this.latest - this.keepProjects) this.projects.delete(v)
    }
  }

  projectAt(version: number): Project | undefined {
    return this.projects.get(version)
  }

  entriesAfter(version: number): VersionEntry[] | null {
    if (version > this.latest || version < 0) return null
    if (version === this.latest) return []
    const first = this.entries[0]
    if (!first || first.version > version + 1) return null
    return this.entries.filter((e) => e.version > version)
  }

  /**
   * Old times to today's, when everything since `from` was a cut out of the
   * whole timeline; otherwise null and why.
   */
  shiftTable(from: number, epoch?: string): { table: ShiftTable } | { table: null; reason: string } {
    if (epoch !== undefined && epoch !== this.epoch) return { table: null, reason: `version ${from} is of another session (epoch ${epoch}, now ${this.epoch})` }
    const after = this.entriesAfter(from)
    if (!after) return { table: null, reason: from > this.latest ? `version ${from} is newer than the project (${this.latest})` : `version ${from} is too old to follow` }
    const other = after.find((e) => e.kind !== 'cut')
    if (other) return { table: null, reason: `version ${other.version} was ${other.kind === 'edit' ? 'an edit' : other.kind === 'load' ? 'another project opened' : `an ${other.kind}`}, not a cut` }
    const segments = segmentsAfterCuts(after.flatMap((e) => e.cuts ?? []))
    const cuts = cutsOfSegments(segments)
    const fixedTracks = [...new Set(after.flatMap((e) => e.fixedTracks ?? []))]
    return { table: { from, to: this.latest, cuts, segments, fixedTracks } }
  }

  /** What changed since `from`: by id, and the cuts when only cuts happened.
   *  `{ tooOld: true }` when that version's project is no longer kept. */
  changesSince(from: number, current: Project, epoch?: string): Changes | { from: number; to: number; tooOld: true } | { from: number; to: number; otherEpoch: true } {
    if (epoch !== undefined && epoch !== this.epoch) return { from, to: this.latest, otherEpoch: true }
    const then = from === this.latest ? current : this.projects.get(from)
    if (!then) return { from, to: this.latest, tooOld: true }
    const shift = this.shiftTable(from)
    return {
      from,
      to: this.latest,
      ...(shift.table && shift.table.cuts.length ? { cuts: shift.table.cuts } : {}),
      ...(shift.table && shift.table.fixedTracks.length ? { fixedTracks: shift.table.fixedTracks } : {}),
      ...diffProjects(then, current)
    }
  }
}
