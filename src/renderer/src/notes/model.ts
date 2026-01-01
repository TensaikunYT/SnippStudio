// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Work notes: the model (SnippStudio OZELLIKLER.md §0, FAZ1-PLAN.md).
//
// A note is a stretch of the timeline (or one frame), what the user wants
// there, and where the work on it stands. It is VideoHub's review note
// (server/notes.js) brought onto Snipp's timeline: there a note belonged to a
// rendered file and a frame number; here it belongs to the project and, when
// it sits on a clip, to that clip's own clock, so it stays on the same picture
// through every edit (notes/follow.ts).
//
// Pure: the functions that change a project take it as the store's draft (or
// a plain project in the tests) and change it in place.

import type { Asset, Clip, NoteKind, NoteShape, NoteStatus, Project, WorkNote } from '../types'
import { assetById, NOTE_KINDS, NOTE_STATUSES, uid } from '../types'
import { PRODUCT_NAME } from '../../../shared/product'
import { localAtMedia, mediaAtLocal } from '../timeline/media-time'
import { hasCurve } from '../timeline/speed-curve'

const EPS = 1e-6

export const KIND_LABEL: Record<NoteKind, string> = { fix: 'Fix', animate: 'Animate', cut: 'Cut', free: 'Free' }
export const KIND_HINT: Record<NoteKind, string> = {
  fix: 'Something here is wrong: say what, and how it should be',
  animate: 'Make an animation for this stretch',
  cut: 'Take this stretch out',
  free: 'Anything else'
}
export const STATUS_LABEL: Record<NoteStatus, string> = { open: 'Open', agent: 'With agent', ready: 'Ready', approved: 'Approved', still: 'Still there' }

/** The colours a drawing can be in (VideoHub's five). */
export const NOTE_COLORS = ['#ff4d4d', '#ffb02e', '#3ee089', '#5aa9ff', '#ffffff']

/** The longest a note's text or an agent's answer may be. */
export const NOTE_TEXT_MAX = 4000
/** A frame with its drawing is a few hundred kB at most; more is not ours. */
export const NOTE_IMAGE_MAX = 3_000_000

const speedOf = (c: Clip): number => Math.max(0.01, c.speed ?? 1)

/** Where timeline second `t` is on a clip's own clock: the second of its
 *  source it shows there (a still's clock runs from its in point too, so a
 *  split or a trim keeps every piece's clock in line with the whole). */
// (Along a speed curve the clock follows the curve, read forwards: core polish C.)
export const sourceAt = (c: Clip, t: number): number => (hasCurve(c) ? mediaAtLocal({ ...c, reversed: false }, t - c.start) : c.inPoint + (t - c.start) * speedOf(c))
/** The timeline second at which a clip shows second `m` of its source. */
export const timeOfSource = (c: Clip, m: number): number => (hasCurve(c) ? c.start + localAtMedia({ ...c, reversed: false }, m) : c.start + (m - c.inPoint) / speedOf(c))

/** The second of the picture a clip really shows at `t`: as `sourceAt`, but a
 *  frozen clip holds one frame and a reversed one runs backwards. For a code
 *  clip this is the film's own T. */
export function shownAt(c: Clip, t: number): number {
  if (c.freeze !== undefined) return c.freeze
  if (hasCurve(c)) return Math.max(0, mediaAtLocal(c, t - c.start))
  if (c.reversed) return Math.max(0, c.inPoint + (c.duration - (t - c.start)) * speedOf(c))
  return sourceAt(c, t)
}

const covers = (c: Clip, t: number): boolean => t >= c.start - EPS && t < c.start + c.duration - EPS

/**
 * The clip a note at `t` is about. In order: one of `prefer` (the selected
 * clips, or the clip the note already sat on) that is on screen there; a code
 * clip (its note names a folder an agent can work in); the topmost picture;
 * a sound. Hidden tracks and switched-off clips are not what the user sees.
 */
export function clipUnder(p: Project, t: number, prefer: readonly string[] = []): Clip | undefined {
  for (const id of prefer) {
    const c = p.clips[id]
    if (c && covers(c, t)) return c
  }
  let code: Clip | undefined
  let picture: Clip | undefined
  let sound: Clip | undefined
  for (const track of p.tracks) {
    if (track.hidden) continue
    for (const id of track.clipIds) {
      const c = p.clips[id]
      if (!c || c.disabled || !covers(c, t)) continue
      if (track.kind === 'audio') {
        sound ??= c
        continue
      }
      if (c.adjustment) continue
      if (!c.nested && assetById(p, c.assetId)?.kind === 'code') code ??= c
      picture ??= c
    }
  }
  return code ?? picture ?? sound
}

/** A note's tie to the clip under it (none over empty timeline). */
export function anchorFor(p: Project, start: number, end: number, prefer: readonly string[] = []): WorkNote['clip'] | undefined {
  const c = clipUnder(p, start, prefer) ?? (end > start ? clipUnder(p, (start + end) / 2, prefer) : undefined)
  if (!c) return undefined
  return { id: c.id, assetId: c.assetId, from: sourceAt(c, start), to: sourceAt(c, end) }
}

/** The clips a note's own clip may have become: itself, then the other clips
 *  of the same source (a cut leaves its far side under a new id). */
function kin(p: Project, tie: NonNullable<WorkNote['clip']>): string[] {
  const out = [tie.id]
  for (const id in p.clips) if (id !== tie.id && p.clips[id].assetId === tie.assetId) out.push(id)
  return out
}

/** A note with its tie made again from where it is now (it keeps its clip
 *  when that clip is still under it). */
export function reanchored(p: Project, n: WorkNote): WorkNote {
  const clip = anchorFor(p, n.start, n.end, n.clip ? kin(p, n.clip) : [])
  const same = !!clip && !!n.clip && clip.id === n.clip.id && clip.assetId === n.clip.assetId && clip.from === n.clip.from && clip.to === n.clip.to
  if (same || (!clip && !n.clip)) return n
  const out: WorkNote = { ...n }
  if (clip) out.clip = clip
  else delete out.clip
  return out
}

export interface NoteInput {
  start: number
  end: number
  kind: NoteKind
  text: string
  /** The frame the drawing is on, and the drawing. */
  at?: number
  shapes?: NoteShape[]
  /** Clips to prefer as the one it is about (the selection). */
  prefer?: readonly string[]
  /** The work on it is limited to its stretch (and these clips). */
  only?: { clips?: readonly string[] }
}

/** A note's limit as it may be stored: an object, its clips a short list of
 *  ids (KAPSAM-AJAN-PLAN.md §2). */
export function cleanOnly(v: unknown): WorkNote['only'] | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const raw = (v as { clips?: unknown }).clips
  const clips = Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 80))].slice(0, 200) : []
  return clips.length ? { clips } : {}
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A note's frame picture as it may be stored: a JPEG or PNG data URL of a
 *  sane size. */
export const isNoteImage = (v: unknown): v is string => typeof v === 'string' && v.length <= NOTE_IMAGE_MAX && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]/.test(v.slice(0, 40))

/** Puts a note's frame picture on it (once it is drawn, after the save). */
export function setNoteImage(p: Project, id: string, image: string): void {
  const n = p.notes?.find((x) => x.id === id)
  if (n && n.shapes?.length && isNoteImage(image)) n.regionImage = image
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

function cleanShapes(raw: unknown): NoteShape[] {
  if (!Array.isArray(raw)) return []
  const out: NoteShape[] = []
  for (const s of raw.slice(0, 200)) {
    if (!s || typeof s !== 'object') continue
    const { type, pts, color } = s as Partial<NoteShape>
    if (type !== 'rect' && type !== 'arrow' && type !== 'pen' && type !== 'pin') continue
    if (!Array.isArray(pts)) continue
    const points: [number, number][] = []
    for (const pt of pts.slice(0, 4000)) {
      if (Array.isArray(pt) && pt.length >= 2 && finite(pt[0]) && finite(pt[1])) points.push([clamp01(pt[0]), clamp01(pt[1])])
    }
    if (points.length < (type === 'pen' || type === 'pin' ? 1 : 2)) continue
    out.push({ type, pts: type === 'pen' ? points : type === 'pin' ? [points[0]] : [points[0], points[points.length - 1]], color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : NOTE_COLORS[0] })
  }
  return out
}

/** The number the next note added to `p` gets (the one a note being written
 *  shows on its pin in the watch mode). */
export function nextNoteNum(p: Pick<Project, 'notes' | 'noteSeq'>): number {
  const taken = (p.notes ?? []).reduce((m, n) => Math.max(m, n.num), 0)
  return Math.max(p.noteSeq ?? 0, taken) + 1
}

/** Adds a note (open, numbered, tied to the clip under it) and returns it. */
export function addNote(p: Project, input: NoteInput, now: Date = new Date()): WorkNote {
  const num = nextNoteNum(p)
  p.noteSeq = num
  const a = Math.max(0, Math.min(input.start, input.end))
  const b = Math.max(a, Math.max(input.start, input.end))
  const note: WorkNote = {
    id: uid(),
    num,
    start: a,
    end: b,
    kind: NOTE_KINDS.includes(input.kind) ? input.kind : 'free',
    text: String(input.text ?? '').trim().slice(0, NOTE_TEXT_MAX),
    status: 'open',
    created: now.toISOString()
  }
  const clip = anchorFor(p, a, b, input.prefer)
  if (clip) note.clip = clip
  const only = cleanOnly(input.only)
  if (only) note.only = only
  const shapes = cleanShapes(input.shapes)
  if (shapes.length > 0) {
    note.shapes = shapes
    note.at = Math.max(0, finite(input.at) ? input.at : a)
  }
  p.notes = [...(p.notes ?? []), note].sort(byStart)
  return note
}

const byStart = (x: WorkNote, y: WorkNote): number => x.start - y.start || x.num - y.num

export const findNote = (p: Project, id: string): WorkNote | undefined => p.notes?.find((n) => n.id === id)
export const noteByNum = (p: Project, num: number): WorkNote | undefined => p.notes?.find((n) => n.num === num)

/** Changes what a note says or where it is. Moving it ties it again to what
 *  is under it now (the drawing's frame moves with its start). */
export function updateNote(p: Project, id: string, patch: Partial<Pick<WorkNote, 'start' | 'end' | 'kind' | 'text'>>): WorkNote | undefined {
  const n = findNote(p, id)
  if (!n) return undefined
  if (patch.kind !== undefined && NOTE_KINDS.includes(patch.kind)) n.kind = patch.kind
  if (patch.text !== undefined) n.text = String(patch.text).slice(0, NOTE_TEXT_MAX)
  if (patch.start !== undefined || patch.end !== undefined) {
    const s0 = finite(patch.start) ? patch.start : n.start
    const e0 = finite(patch.end) ? patch.end : n.end
    const start = Math.max(0, Math.min(s0, e0))
    const end = Math.max(start, Math.max(s0, e0))
    if (n.at !== undefined) n.at = Math.max(0, n.at + (start - n.start))
    n.start = start
    n.end = end
    const clip = anchorFor(p, start, end, n.clip ? [n.clip.id] : [])
    if (clip) n.clip = clip
    else delete n.clip
    p.notes?.sort(byStart)
  }
  return n
}

export function deleteNote(p: Project, id: string): void {
  if (!p.notes) return
  p.notes = p.notes.filter((n) => n.id !== id)
  if (p.notes.length === 0) delete p.notes
}

/** Takes every note of one status off the list (the approved ones, done). */
export function clearNotes(p: Project, status: NoteStatus): number {
  const before = p.notes?.length ?? 0
  if (!p.notes) return 0
  p.notes = p.notes.filter((n) => n.status !== status)
  const gone = before - p.notes.length
  if (p.notes.length === 0) delete p.notes
  return gone
}

/** A range inside 0..∞, in order; null when it is not two numbers. */
function cleanRange(r: unknown): [number, number] | null {
  if (!Array.isArray(r) || r.length !== 2 || !finite(r[0]) || !finite(r[1])) return null
  const a = Math.max(0, Math.min(r[0], r[1]))
  return [a, Math.max(a, Math.max(r[0], r[1]))]
}

/** Where a note stands, with the agent's answer and what it changed. */
export function setNoteStatus(p: Project, id: string, status: NoteStatus, extra: { reply?: string; touched?: [number, number][] } = {}): WorkNote | undefined {
  const n = findNote(p, id)
  if (!n) return undefined
  if (NOTE_STATUSES.includes(status)) n.status = status
  if (extra.reply !== undefined) {
    const reply = extra.reply.trim().slice(0, NOTE_TEXT_MAX)
    if (reply) n.reply = reply
    else delete n.reply
  }
  if (extra.touched !== undefined) {
    const touched = extra.touched.map(cleanRange).filter((r): r is [number, number] => !!r).slice(0, 50)
    if (touched.length > 0) n.touched = touched.sort((x, y) => x[0] - y[0])
    else delete n.touched
  }
  return n
}

/** Open, or sent back: what "Send to agent" sends. */
export const isSendable = (n: WorkNote): boolean => n.status === 'open' || n.status === 'still'
export const notesToSend = (p: Project): WorkNote[] => (p.notes ?? []).filter(isSendable)

export type NoteFilter = 'open' | 'ready' | 'all'
/** The list as the panel shows it: waiting (open, with the agent, sent
 *  back), answered, or everything; in timeline order. */
export function filterNotes(notes: readonly WorkNote[], filter: NoteFilter): WorkNote[] {
  const keep = (n: WorkNote): boolean => (filter === 'all' ? true : filter === 'ready' ? n.status === 'ready' : n.status !== 'approved' && n.status !== 'ready')
  return notes.filter(keep).sort(byStart)
}

/** A note that is done: approved by the user (DENEME-2-PLAN-N.md, K2). */
export const isDone = (n: Pick<WorkNote, 'status'>): boolean => n.status === 'approved'

/** Whether a note's drawing (its pins, boxes, strokes) is shown over the
 *  preview: an open note's is, a done one's is not, but the note the review
 *  is on right now always is (DENEME-2-PLAN-N.md, K2). */
export const drawingShown = (n: Pick<WorkNote, 'id' | 'status'>, reviewing: string | null = null): boolean => n.id === reviewing || !isDone(n)

/** The notes the N lane draws: the done ones only while the Notes tab's
 *  filter shows them ("All"), and the note under review always
 *  (DENEME-2-PLAN-N.md, K3). */
export function laneNotes<N extends Pick<WorkNote, 'id' | 'status'>>(notes: readonly N[], filter: NoteFilter, reviewing: string | null = null): N[] {
  return filter === 'all' ? [...notes] : notes.filter((n) => n.id === reviewing || !isDone(n))
}

/** The stretches a review goes through for a note: what the agent said it
 *  changed, or the note's own range. */
export function reviewRanges(n: WorkNote): [number, number][] {
  return n.touched && n.touched.length > 0 ? n.touched : [[n.start, n.end]]
}

/** The notes with an answer to look at, in timeline order. */
export function reviewQueue(p: Project): WorkNote[] {
  return (p.notes ?? []).filter((n) => n.status === 'ready').sort((x, y) => reviewRanges(x)[0][0] - reviewRanges(y)[0][0] || x.num - y.num)
}

/** What a review plays for one note: its changed stretches with a lead-in and
 *  a tail, as one loop inside the timeline. */
export function reviewLoop(n: WorkNote, duration: number, lead = 1.5): [number, number] {
  const ranges = reviewRanges(n)
  const a = Math.min(...ranges.map((r) => r[0]))
  const b = Math.max(...ranges.map((r) => r[1]))
  const start = Math.max(0, a - lead)
  const end = Math.max(start + 0.5, Math.min(Math.max(duration, start + 0.5), b + lead))
  return [start, end]
}

export interface NoteContext {
  /** The clip it sits on, as it is now (none: over empty timeline, or its
   *  clip is gone). */
  clip?: Clip
  asset?: Asset
  /** A code clip: the note names its film's folder and its own seconds. */
  code: boolean
  /** The code film's folder. */
  folder?: string
  /** The seconds of the clip's picture at the note's two ends. */
  from?: number
  to?: number
}

/** What a note is on: its clip, and for a code clip the film's folder and
 *  the film's own time at the note (what an agent opens and looks for). */
export function noteContext(p: Project, n: WorkNote): NoteContext {
  const clip = n.clip ? p.clips[n.clip.id] : undefined
  if (!clip) return { code: false }
  const asset = assetById(p, clip.assetId)
  const code = !clip.nested && asset?.kind === 'code'
  const inside = (t: number): number => Math.min(Math.max(t, clip.start), clip.start + clip.duration)
  const from = shownAt(clip, inside(n.start))
  const to = shownAt(clip, inside(n.end))
  return { clip, asset, code, ...(code && asset?.path ? { folder: asset.path } : {}), from: Math.min(from, to), to: Math.max(from, to) }
}

/** 754.34 → "12:34.3" (one tenth is as close as a person reads a time). */
export function noteClock(t: number): string {
  const tenths = Math.round(Math.max(0, t) * 10)
  const m = Math.floor(tenths / 600)
  const s = (tenths - m * 600) / 10
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

/** A time as a person types it: "62.5", "1:02.5", "1:02:03". Null when it is
 *  not one. */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':')
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null
  const t = parts.reduce((sum, p) => sum * 60 + Number(p), 0)
  return Number.isFinite(t) ? t : null
}

/** "0:12.4" or "0:12.4–0:15.0". */
export const noteSpan = (n: Pick<WorkNote, 'start' | 'end'>): string => (n.end - n.start > 1e-3 ? `${noteClock(n.start)}–${noteClock(n.end)}` : noteClock(n.start))

/**
 * The short message "Send to agent" puts on the clipboard, for the user to
 * paste into their agent's chat (VideoHub's notes prompt, for Snipp's tools).
 * `server` is the name the agent knows this Snipp by.
 */
export function sendMessage(p: Project, projectPath: string | null, server: string): string {
  const open = notesToSend(p).sort(byStart)
  const n = open.length
  return [
    `${PRODUCT_NAME}: ${n} work note${n === 1 ? '' : 's'} waiting in "${p.name || 'Untitled'}" (${open.map((x) => '#' + x.num).join(', ')}).`,
    `Project file: ${projectPath ?? 'not saved yet'}`,
    // How to answer them is said once, in the notes tool's own description
    // (phase 4A: the instructions are not repeated here).
    `Use the ${server} notes tool.`
  ].join('\n')
}

/**
 * Notes as read from a file, made safe to draw and to send: whatever is
 * malformed is repaired or dropped (a hand-edited file, a project written by
 * another program). Old projects have none and are left as they are.
 */
export function sanitizeNotes(p: Project, now: Date = new Date()): number {
  const raw = (p as { notes?: unknown }).notes
  const seq = finite(p.noteSeq) && p.noteSeq > 0 ? Math.floor(p.noteSeq) : 0
  if (raw === undefined) {
    if (seq > 0) p.noteSeq = seq
    else delete p.noteSeq
    return 0
  }
  // What could not be read and went: a note, a stroke of a drawing (phase
  // 11b, A4: the opening says so; it went silently).
  let dropped = Array.isArray(raw) ? 0 : 1
  const out: WorkNote[] = []
  const ids = new Set<string>()
  const nums = new Set<number>()
  let top = seq
  if (Array.isArray(raw)) {
    for (const item of raw) if (item && typeof item === 'object' && finite((item as WorkNote).num)) top = Math.max(top, Math.floor((item as WorkNote).num))
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        dropped++
        continue
      }
      const r = item as Partial<WorkNote> & Record<string, unknown>
      if (!finite(r.start)) {
        dropped++
        continue
      }
      const start = Math.max(0, Math.min(r.start, finite(r.end) ? r.end : r.start))
      const end = Math.max(start, Math.max(r.start, finite(r.end) ? r.end : r.start))
      let id = typeof r.id === 'string' && r.id ? r.id : uid()
      if (ids.has(id)) id = uid()
      ids.add(id)
      let num = finite(r.num) && r.num >= 1 ? Math.floor(r.num) : 0
      if (num === 0 || nums.has(num)) num = ++top
      nums.add(num)
      const note: WorkNote = {
        id,
        num,
        start,
        end,
        kind: NOTE_KINDS.includes(r.kind as NoteKind) ? (r.kind as NoteKind) : 'free',
        text: typeof r.text === 'string' ? r.text.slice(0, NOTE_TEXT_MAX) : '',
        status: NOTE_STATUSES.includes(r.status as NoteStatus) ? (r.status as NoteStatus) : 'open',
        created: typeof r.created === 'string' && !Number.isNaN(Date.parse(r.created)) ? r.created : now.toISOString()
      }
      const c = r.clip
      if (c && typeof c === 'object' && typeof c.id === 'string' && typeof c.assetId === 'string' && finite(c.from) && finite(c.to)) {
        note.clip = { id: c.id, assetId: c.assetId, from: c.from, to: c.to }
      }
      const shapes = cleanShapes(r.shapes)
      if (Array.isArray(r.shapes)) dropped += Math.min(200, r.shapes.length) - shapes.length
      if (shapes.length > 0) {
        note.shapes = shapes
        note.at = Math.max(0, finite(r.at) ? r.at : start)
        // A picture, and only a picture (it is shown, and sent to an agent).
        if (isNoteImage(r.regionImage)) note.regionImage = r.regionImage
      }
      if (typeof r.reply === 'string' && r.reply.trim()) note.reply = r.reply.slice(0, NOTE_TEXT_MAX)
      const only = cleanOnly(r.only)
      if (only) note.only = only
      if (Array.isArray(r.touched)) {
        const touched = r.touched.map(cleanRange).filter((x): x is [number, number] => !!x).slice(0, 50)
        if (touched.length > 0) note.touched = touched
      }
      out.push(note)
    }
  }
  out.sort(byStart)
  if (out.length > 0) p.notes = out
  else delete p.notes
  if (top > 0) p.noteSeq = top
  else delete p.noteSeq
  return dropped
}
