// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The range band and its box (KAPSAM-AJAN-PLAN.md §6; the mock-up
// tasarim\maket-ajan, screens 3 and 4): a stretch of the timeline (or a few
// clips) the user gives the agent, with what to do there and whether the
// agent may change only that. What is sent is a work note (notes/model.ts,
// `only` when limited) put in the agent's inbox; the band stays on the
// timeline and says how the work stands. The band itself is a view: not in
// the project, not in the undo history. The user's own chips are kept in the
// profile (localStorage).
import { create } from 'zustand'
import { addNote } from '../notes/model'
import type { NoteKind, Project } from '../types'
import { instanceOf } from '../types'
import { useStore } from '../state/store'
import { sendToInbox } from './inbox'

/** The ready chips: what each asks, as a note's kind. */
export const READY_CHIPS = {
  animate: 'animate',
  shorten: 'cut',
  silences: 'cut',
  captions: 'fix',
  unrelated: 'fix',
  change: 'fix'
} as const satisfies Record<string, NoteKind>
export type ReadyChip = keyof typeof READY_CHIPS
/** The band's box offers these (the clip menu its own four). */
export const BAND_CHIPS: readonly ReadyChip[] = ['animate', 'shorten', 'silences', 'captions']
export const CLIP_CHIPS: readonly ReadyChip[] = ['animate', 'unrelated', 'change', 'shorten']

const CHIPS_KEY = 'snipp-agent-chips'
export const CUSTOM_MAX = 8
export const CUSTOM_LEN = 40

function savedChips(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHIPS_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, CUSTOM_LEN)).slice(0, CUSTOM_MAX) : []
  } catch {
    return []
  }
}
function saveChips(list: readonly string[]): void {
  try {
    localStorage.setItem(CHIPS_KEY, JSON.stringify(list))
  } catch {
    /* not remembered: fine */
  }
}

/** A chip picked: a ready one by its id, or one of the user's by its words. */
export type Picked = { ready: ReadyChip } | { own: string }

export interface Band {
  start: number
  end: number
  /** Made from clips (their ids): the box speaks of them, and "only" limits
   *  the work to them. */
  clips?: string[]
}

export interface BandState {
  band: Band | null
  /** "Range" pressed with nothing chosen: the next drag on the ruler draws. */
  armed: boolean
  /** The box under the band is open. */
  open: boolean
  only: boolean
  text: string
  chip: Picked | null
  /** The note it became, once sent. */
  sent: string | null
  /** The agent's draft was there while this work was out. */
  sawDraft: boolean
  custom: string[]
}

export const useScopeBand = create<BandState>(() => ({ band: null, armed: false, open: false, only: true, text: '', chip: null, sent: null, sawDraft: false, custom: typeof localStorage === 'undefined' ? [] : savedChips() }))

const set = useScopeBand.setState
const get = useScopeBand.getState

export const armBand = (on: boolean): void => set({ armed: on })

/** A new band over [a, b] (the old one goes; a sent one's note stays). */
export function drawBand(a: number, b: number, clips?: string[], only = true): void {
  const start = Math.max(0, Math.min(a, b))
  const end = Math.max(a, b)
  set({ band: { start, end, ...(clips?.length ? { clips } : {}) }, armed: false, open: true, only, text: '', chip: null, sent: null, sawDraft: false })
}

/** The band over some clips (the clip menu's "Leave a note…", "Work only on
 *  the selected clips…"). */
export function bandForClips(p: Project, ids: readonly string[], only: boolean): boolean {
  const clips = ids.map((id) => p.clips[id]).filter(Boolean)
  if (!clips.length) return false
  drawBand(Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.duration)), clips.map((c) => c.id), only)
  return true
}

export const closeBox = (): void => set(get().sent ? { open: false } : { open: false, band: null })
export const closeBand = (): void => set({ band: null, open: false, armed: false, sent: null, sawDraft: false })
export const setBandText = (text: string): void => set({ text })
export const setBandOnly = (only: boolean): void => set({ only })
export function pickChip(chip: Picked | null): void {
  const cur = get().chip
  const same = !!cur && !!chip && JSON.stringify(cur) === JSON.stringify(chip)
  set({ chip: same ? null : chip })
}

/** The words typed become one of the user's chips (kept in the profile). */
export function keepChip(words: string): boolean {
  const w = words.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_LEN)
  const list = get().custom
  if (!w || list.includes(w) || list.length >= CUSTOM_MAX) return false
  const next = [...list, w]
  saveChips(next)
  set({ custom: next, chip: { own: w }, text: '' })
  return true
}
export function dropChip(words: string): void {
  const next = get().custom.filter((x) => x !== words)
  saveChips(next)
  set((s) => ({ custom: next, chip: s.chip && 'own' in s.chip && s.chip.own === words ? null : s.chip }))
}

/** What a send would write: the note's kind and words. `label` gives a ready
 *  chip's words in the user's language (they are the user's words to the
 *  agent, as if typed). Null: nothing to send. */
export function noteOf(state: Pick<BandState, 'text' | 'chip'>, label: (c: ReadyChip) => string): { kind: NoteKind; text: string } | null {
  // (Its lines are kept: the box takes several, cila3 2a.)
  const typed = state.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
  const chip = state.chip
  const said = chip ? ('ready' in chip ? label(chip.ready) : chip.own) : ''
  if (!typed && !said) return null
  const kind: NoteKind = chip && 'ready' in chip ? READY_CHIPS[chip.ready] : 'fix'
  return { kind, text: said && typed ? `${said}: ${typed}` : said || typed }
}

/** Writes the note and puts it in the agent's inbox. Returns its id and
 *  whether a waiting agent took it at once; null when there is nothing. */
export function sendBand(label: (c: ReadyChip) => string): { id: string; taken: boolean; inbox: number } | null {
  const s = get()
  const b = s.band
  const what = noteOf(s, label)
  if (!b || !what) return null
  const id = writeNote(b, what, s.only)
  set({ sent: id, open: false, sawDraft: false })
  const r = sendToInbox({ kind: 'notes', notes: [id] })
  return { id, taken: r.taken, inbox: r.id }
}

/** A ready chip of the clip menu: a note on those clips, sent at once; the
 *  band shows how it stands. */
export function sendClipChip(ids: readonly string[], chip: ReadyChip, label: (c: ReadyChip) => string): { id: string; taken: boolean; inbox: number } | null {
  if (!bandForClips(useStore.getState().project, ids, false)) return null
  const b = get().band!
  const id = writeNote(b, { kind: READY_CHIPS[chip], text: label(chip) }, false)
  set({ sent: id, open: false })
  const r = sendToInbox({ kind: 'notes', notes: [id] })
  return { id, taken: r.taken, inbox: r.id }
}

function writeNote(b: Band, what: { kind: NoteKind; text: string }, only: boolean): string {
  let id = ''
  useStore.getState().editNotes((p) => {
    const insts = b.clips?.map((c) => p.clips[c]).filter(Boolean).map(instanceOf)
    const note = addNote(p, { start: b.start, end: b.end, kind: what.kind, text: what.text, ...(b.clips ? { prefer: b.clips } : {}), ...(only ? { only: insts?.length ? { clips: insts } : {} } : {}) })
    id = note.id
  })
  return id
}

export type BandStatus = 'new' | 'working' | 'draft' | 'done'

/** How the work of a sent band stands: its note, and the agent's draft. */
export function bandStatus(p: Project, sent: string | null, draft: boolean, sawDraft: boolean): BandStatus {
  if (!sent) return 'new'
  const n = p.notes?.find((x) => x.id === sent)
  if (!n || n.status === 'ready' || n.status === 'approved') return 'done'
  if (draft) return 'draft'
  return sawDraft ? 'done' : 'working'
}

/** Where the band lies now: a sent one rides its note (the edits move it). */
export function bandSpan(p: Project, s: Pick<BandState, 'band' | 'sent'>): [number, number] | null {
  if (!s.band) return null
  const n = s.sent ? p.notes?.find((x) => x.id === s.sent) : undefined
  return n ? [n.start, n.end] : [s.band.start, s.band.end]
}
