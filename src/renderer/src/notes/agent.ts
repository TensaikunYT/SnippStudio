// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What an agent reads and writes of the work notes (the `notes`, `note_image`
// and `note_update` tools; main/agent-protocol.ts declares them, agent/host.ts
// runs them). VideoHub's hub_notes and hub_note_update (server/tools.js), for
// notes that live in the project. Short plain text, as the other tools give:
// an agent pays for every character. Pure: the tests check the wording an
// agent relies on.

import { sec } from '../agent/format'
import type { NoteStatus, Project, WorkNote } from '../types'
import { instanceOf, isSubtitle, NOTE_STATUSES, projectDuration } from '../types'
import { isSendable, noteByNum, noteContext, reviewLoop } from './model'
import { PRODUCT_NAME } from '../../../shared/product'

/** What each kind asks of the agent, in its own words. */
const KIND_ASKS: Record<WorkNote['kind'], string> = {
  fix: 'fix (something here is wrong)',
  animate: 'animate (make an animation for this stretch)',
  cut: 'cut (take this stretch out)',
  free: 'free'
}

/** What is said in [a, b]: the subtitle lines under it, as one sentence (the
 *  narration at a note tells an agent what the picture is about). */
export function spokenIn(p: Project, a: number, b: number, max = 280): string {
  const lo = Math.min(a, b) - 0.2
  const hi = Math.max(a, b) + 0.2
  const lines = p.captions
    .filter((c) => isSubtitle(c) && c.end > lo && c.start < hi)
    .sort((x, y) => x.start - y.start)
    .map((c) => c.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const text = lines.join(' ')
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

/** The one line that says the user limited the work on a note (agent/
 *  scope.ts keeps the limit). Null: not limited. */
export function onlyLine(p: Project, n: WorkNote): string | null {
  if (!n.only) return null
  const where = `${sec(n.start)}–${sec(n.end)} s`
  if (!n.only.clips?.length) return `   only here: the app applies no edit outside ${where}`
  const set = new Set(n.only.clips)
  const ids = Object.values(p.clips).filter((c) => set.has(instanceOf(c))).sort((a, b) => a.start - b.start).map((c) => c.id)
  return `   only clips ${(ids.length ? ids : n.only.clips).slice(0, 12).join(', ')} (${where}): the app applies no edit to anything else`
}

export type NotesFilter = 'open' | 'all' | NoteStatus

/** What the `notes` tool was asked for (default: what is waiting for work). */
export function notesFilter(raw: unknown): NotesFilter {
  if (raw === undefined || raw === null || raw === 'open') return 'open'
  if (raw === 'all' || NOTE_STATUSES.includes(raw as NoteStatus)) return raw as NotesFilter
  throw new Error(`status must be one of: open (the notes waiting for work), all, ${NOTE_STATUSES.join(', ')}.`)
}

/** The notes a filter picks, in timeline order. "open" is what the user's
 *  Send to agent sends: the open ones and those sent back. */
export function pickNotes(p: Project, filter: NotesFilter): WorkNote[] {
  const all = [...(p.notes ?? [])].sort((x, y) => x.start - y.start || x.num - y.num)
  if (filter === 'all') return all
  if (filter === 'open') return all.filter(isSendable)
  return all.filter((n) => n.status === filter)
}

const statusWord = (n: WorkNote): string => (n.status === 'still' ? 'STILL THERE: your earlier work on it was not enough' : n.status)
const span = (a: number, b: number): string => (b - a > 1e-3 ? `${sec(a)}–${sec(b)} s (${sec(b - a)} s)` : `${sec(a)} s (one frame)`)

/** One note as the agent reads it (the notes tool, and a wait that brings
 *  notes the user sent). */
export function noteLines(p: Project, n: WorkNote): string[] {
  // (An animation is asked for with the stretch, its length, the canvas and
  // what is said there: nothing on how to draw it. KAPSAM-AJAN-PLAN.md §5.)
  const canvas = n.kind === 'animate' ? ` · canvas ${p.settings.width}x${p.settings.height}` : ''
  const lines = [`#${n.num} [${statusWord(n)}] ${span(n.start, n.end)} · ${KIND_ASKS[n.kind]}${canvas}`]
  lines.push(n.text ? `   "${n.text.replace(/\s+/g, ' ').trim()}"` : '   (no text: see the drawing)')
  const limit = onlyLine(p, n)
  if (limit) lines.push(limit)
  const ctx = noteContext(p, n)
  if (ctx.clip) {
    const name = ctx.clip.nested ? 'a compound clip' : `"${ctx.asset?.name ?? 'unknown'}"`
    const where = ctx.to! - ctx.from! > 1e-3 ? `${sec(ctx.from!)}–${sec(ctx.to!)} s` : `${sec(ctx.from!)} s`
    if (ctx.code) lines.push(`   on code clip ${name} (clip ${ctx.clip.id}): film time ${where}${ctx.folder ? `, film folder ${ctx.folder}` : ''}`)
    else lines.push(`   on ${name} (clip ${ctx.clip.id}), its source at ${where}`)
  } else lines.push('   on no clip')
  // Short: the transcript tool has the rest (phase 4A).
  const said = spokenIn(p, n.start, n.end, 120)
  if (said) lines.push(`   said there: «${said}»`)
  if (n.shapes?.length) lines.push(`   drawn on the frame at ${sec(n.at ?? n.start)} s: notes {"image": ${n.num}}`)
  // The numbered pins (phase 11b): where each points, in frame fractions.
  const pins = (n.shapes ?? []).filter((s) => s.type === 'pin' && s.pts.length)
  if (pins.length) {
    const xy = (v: number): string => v.toFixed(2)
    const shown = pins.slice(0, 12).map((s, i) => `pin ${i + 1} at (${xy(s.pts[0][0])}, ${xy(s.pts[0][1])})`)
    lines.push(`   ${shown.join(', ')}${pins.length > 12 ? `, and ${pins.length - 12} more` : ''} (x, y of the frame, 0..1 from the top left)`)
  }
  if (n.reply) lines.push(`   your earlier answer: ${n.reply.replace(/\s+/g, ' ').trim()}`)
  return lines
}

/** The answer of the `notes` tool. `taken`: how many of these just became
 *  "with agent" by being read. */
export function notesText(p: Project, projectPath: string | null, filter: NotesFilter, taken = 0): string {
  const all = p.notes ?? []
  const notes = pickNotes(p, filter)
  const which = filter === 'open' ? 'waiting for work' : filter === 'all' ? 'in all' : `with status ${filter}`
  if (notes.length === 0) {
    return all.length === 0
      ? `"${p.name || 'Untitled'}" has no work notes. The user writes them in ${PRODUCT_NAME} (the N lane, the Notes tab).`
      : `"${p.name || 'Untitled'}" has no notes ${which} (${all.length} note${all.length === 1 ? '' : 's'} in all: ask with status "all").`
  }
  const lines: string[] = []
  lines.push(`Work notes of "${p.name || 'Untitled'}" (${projectPath ?? 'not saved yet'}): ${notes.length} ${which}, of ${all.length}. Times are timeline seconds.`)
  for (const n of notes) lines.push(...noteLines(p, n))
  if (taken > 0) lines.push(`${taken} of these ${taken === 1 ? 'is' : 'are'} now marked "with agent" in ${PRODUCT_NAME}.`)
  // How to answer is in the notes tool's description (phase 4A): not repeated.
  return lines.join('\n')
}

export interface NoteUpdate {
  note: WorkNote
  status?: NoteStatus
  reply?: string
  touched?: [number, number][]
  /** Said back to the agent (ranges dropped, and why). */
  remarks: string[]
}

/** The statuses an agent may set: it took the note, it is done with it, or
 *  it hands it back untouched. Approving is the user's. */
const AGENT_MAY_SET: NoteStatus[] = ['agent', 'ready', 'open']

/**
 * A `note_update` call checked against the project: which note, and what may
 * change. Throws with a sentence the agent can act on.
 */
export function planNoteUpdate(p: Project, args: Record<string, unknown>): NoteUpdate {
  const all = p.notes ?? []
  const id = args.id
  if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('id is required: the note\'s number, as the notes tool shows it (#3 is 3).')
  const note = noteByNum(p, id)
  if (!note) throw new Error(all.length === 0 ? 'This project has no work notes.' : `There is no note #${id}. The notes are: ${all.map((n) => n.num).sort((x, y) => x - y).map((n) => '#' + n).join(', ')}.`)
  const out: NoteUpdate = { note, remarks: [] }
  if (args.status !== undefined) {
    if (!AGENT_MAY_SET.includes(args.status as NoteStatus)) throw new Error('status must be "ready" (you are done with it), "agent" (you are working on it) or "open" (you hand it back untouched). Approving is the user\'s.')
    if (note.status === 'approved') throw new Error(`The user approved note #${id}: it is done, and its status is not yours to change.`)
    out.status = args.status as NoteStatus
  }
  if (args.reply !== undefined) {
    if (typeof args.reply !== 'string') throw new Error('reply must be text: one sentence on what you did.')
    out.reply = args.reply
  }
  if (args.touched !== undefined) {
    if (!Array.isArray(args.touched)) throw new Error('touched must be a list of [start, end] pairs, in timeline seconds.')
    const dur = projectDuration(p)
    const kept: [number, number][] = []
    let outside = 0
    for (const item of args.touched) {
      if (!Array.isArray(item) || item.length !== 2 || !item.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('Every touched range must be two numbers: [start, end] in timeline seconds.')
      const a = Math.min(item[0], item[1])
      const b = Math.max(item[0], item[1])
      if (b < 0 || a > dur) {
        outside++
        continue
      }
      kept.push([Math.max(0, a), Math.min(dur, b)])
    }
    if (outside > 0) out.remarks.push(`${outside} touched range${outside === 1 ? ' was' : 's were'} outside the timeline (0–${sec(dur)} s) and left out.`)
    out.touched = kept.slice(0, 50)
  }
  if (out.status === undefined && out.reply === undefined && out.touched === undefined) throw new Error('Nothing to update: give a status, a reply, or the touched ranges.')
  return out
}

/** The answer of `note_update`: what the note says now, and what the user
 *  will look at. `after` is the note as it is once updated. */
export function updateText(p: Project, after: WorkNote, remarks: readonly string[]): string {
  const lines = [`#${after.num} → ${after.status}${after.reply ? ` · ${after.reply.replace(/\s+/g, ' ').trim()}` : ''}`]
  if (after.status === 'ready') {
    const [a, b] = reviewLoop(after, projectDuration(p))
    lines.push(`The user will play ${sec(a)}–${sec(b)} s and approve it or send it back.`)
  }
  lines.push(...remarks)
  return lines.join('\n')
}
