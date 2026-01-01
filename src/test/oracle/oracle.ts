// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The oracle (SnippStudio phase 4A.9, A8): what an agent's operation MEANT,
// taken by this file's own code from the project the agent saw, and whether
// a project made from the live one honours it. Written apart from the app's
// own checks on purpose: it reads projects by brute force (sample.ts) and
// imports nothing of the agent core (a test holds it to that).
//
// Intent is content, never seconds: "this instance's source second s". A
// check compares L (the live project a materialisation started from) with M
// (what came out) under the list of operations the app REPORTED as applied;
// anything in M that no reported operation meant is a silent wrong.
//
// What is exact and what is sampled: the voice track (one-to-one media, the
// thing the subtitles belong to) is judged with exact source windows: a cut's
// edges, where a title or a split sits, to 1e-6 s. A deviation up to 0.02 s is
// reported as its own kind ("…-inexact": a rounded time), a larger one as the
// wrong itself. The only allowance is the cut command's own 0.02 s rule (a
// located range shorter than that is left, two ranges closer than that are
// one). Other tracks ride along with the voice and are judged on a 0.02 s
// grid: they lose exactly what plays during the cuts and stay in step.
import type { Caption, Clip, Project } from '../../renderer/src/types'
import { instOf, wordTag, type Shape } from './fixture'
import { STEP, allAt, clipAtSource, clipsOn, contentAt, coverOf, filmSig, inter, isStill, lenOf, minus, samplesOf, speedOf, srcAt, timeAt, trackOf, union, windowOf, wordsOf, type Content, type Iv } from './sample'

export type Fam = 'cut' | 'place' | 'record' | 'split' | 'trimHead' | 'trimEnd' | 'delete' | 'lineText' | 'lineMarks' | 'lineSet' | 'lineDelete' | 'field' | 'add' | 'adding' | 'structural'

export interface Intent {
  fam: Fam
  name: string
  /** cut: the voice's source windows meant. */
  pieces?: { inst: string; iv: Iv }[]
  /** cut (a retake found by an analysis): what each such range cuts, and
   *  the take it is cut FOR (which must still be there). */
  takes?: { pieces: { inst: string; iv: Iv }[]; keep: { inst: string; iv: Iv }[] }[]
  /** place: other one-to-one footage under its time (when no talk is). */
  alt?: Content[]
  /** adding (an op that only puts new clips or a template on the timeline):
   *  each thing it adds — the media, the time it was written at and the
   *  talk under that time (null: none; no time: "at the end of a track"). */
  adds?: { inst?: string; t?: number; ref?: Content | null; alt?: Content[]; noVoice?: boolean }[]
  /** cut: did every range lie wholly on voice content? */
  covered?: boolean
  /** cut: markers and titles the ranges held or touched when the agent read. */
  seenIds?: Set<string>
  /** place: the voice content at the time (null: none there). */
  ref?: Content | null
  /** place: the voice's track was empty when the agent read (it deleted
   *  the talk): there is nothing to judge a time by. */
  noVoice?: boolean
  seenTime?: number
  /** The time was given by a word: its tag, and whether its end. */
  word?: { tag: string; end: boolean }
  recId?: string
  recKind?: 'caption' | 'marker'
  /** record / split / trim / delete: the clip named, as it was seen. */
  clipId?: string
  inst?: string
  track?: string
  window?: Iv
  /** The clip named is a still: it has no source seconds, so it is the clip
   *  of that id (a still cut in two is two things). */
  still?: boolean
  /** record: a setting of the clip. lineSet: 'text' or 'style.<name>' of a
   *  line or title. field: a field of the project ('captionStyle.<name>', 'risers'…). */
  field?: string
  value?: unknown
  /** A still named: the voice content it lay over when it was read (the
   *  pieces over that content are "the clip"; a still has no source). */
  under?: { inst: string; iv: Iv }[]
  /** transitionOut: the content that followed the clip (null: nothing did). */
  follow?: { inst: string; src: number } | null
  /** split / trim: the source second of the cut point. */
  at?: number
  /** trim / delete: the source window that goes. */
  gone?: Iv
  /** line: the line named, its words as they were seen. */
  lineId?: string
  /** The line named is a title (no words: it is the record of that id). */
  title?: boolean
  /** lineSet / field: the value read (what the agent saw before it wrote). */
  readValue?: unknown
  words?: W[]
  oldText?: string
  text?: string
  marks?: W[]
  /** lineMarks: the words that were marked when the line was read. */
  hadMarks?: W[]
}

/** A subtitle word as the oracle knows it: its tag (lost when a line is
 *  retyped: the app makes the words anew) and the voice content it starts
 *  on. Two words are the same by tag when both have one, else by content. */
export interface W {
  tag?: string
  key: string
  /** The voice content it starts on (when it is on any), and the content
   *  at its middle (a cut takes a word whose middle it takes). */
  inst?: string
  src?: number
  mid?: number
}
const sameW = (a: W, b: W): boolean => (a.tag && b.tag ? a.tag === b.tag : a.key === b.key)
const sameWs = (a: readonly W[], b: readonly W[]): boolean => a.length === b.length && a.every((w, i) => sameW(w, b[i]))

const EXACT = 1e-6
const SLIVER = 0.02

// ---- reading what the agent wrote, in the project it saw ---------------------

const TIME_RE = /^(.+?)#(\d+)(>)?$/

function wordIn(p: Project, id: string, i: number): { start: number; end: number } {
  const w = p.captions.find((c) => c.id === id)?.words?.[i]
  if (!w) throw new Error(`oracle: no word ${id}#${i} in the seen project`)
  return w
}

export function seenTime(p: Project, v: number | string): number {
  if (typeof v === 'number') return v
  const m = TIME_RE.exec(v)!
  const w = wordIn(p, m[1], Number(m[2]))
  return m[3] ? w.end : w.start
}

export function seenRange(p: Project, v: unknown): Iv {
  if (Array.isArray(v)) {
    const a = seenTime(p, v[0] as number | string)
    const b = typeof v[1] === 'string' && !v[1].endsWith('>') ? wordIn(p, TIME_RE.exec(v[1])![1], Number(TIME_RE.exec(v[1])![2])).end : seenTime(p, v[1] as number | string)
    return [a, b]
  }
  const s = String(v)
  const r = /^(.+?)#(\d+)-(\d+)$/.exec(s)
  if (r) return [wordIn(p, r[1], Number(r[2])).start, wordIn(p, r[1], Number(r[3])).end]
  const one = /^(.+?)#(\d+)$/.exec(s)
  if (one) {
    const w = wordIn(p, one[1], Number(one[2]))
    return [w.start, w.end]
  }
  const line = p.captions.find((c) => c.id === s)!
  return [line.start, line.end]
}

/** Is [a, b) wholly on voice content in `p`? */
export function voiceCovers(p: Project, voiceTrack: string, a: number, b: number): boolean {
  // (Talk: footage with a clock. A still the user dropped on the talk's track is none.)
  const spans = union(clipsOn(p, voiceTrack).filter((c) => !isStill(p, c)).map((c) => [c.start, c.start + c.duration] as Iv), 1e-6)
  return spans.some(([x, y]) => a >= x - 1e-6 && b <= y + 1e-6)
}

function wordsIn(p: Project, voice: string, c: Caption | undefined): W[] {
  return (c?.words ?? []).map((w) => {
    const at = contentAt(p, voice, w.start) ?? contentAt(p, voice, w.start, true)
    const tag = wordTag(w)
    return { ...(tag ? { tag } : {}), key: at ? `${at.inst}@${at.src.toFixed(2)}` : `none@${w.start.toFixed(2)}`, ...(at ? { inst: at.inst, src: at.src, mid: at.src + ((p.clips[at.clip]?.reversed ? -1 : 1) * (w.end - w.start) * speedOf(p.clips[at.clip] ?? ({} as Clip))) / 2 } : {}) }
  })
}
const isTitle = (c: Caption): boolean => !!c.manual || !!c.shape || !(c.words?.length)

/** The voice content under a clip (what a still, a title… lies over). */
export function underOf(p: Project, voice: string, a: number, b: number): { inst: string; iv: Iv }[] {
  const out: { inst: string; iv: Iv }[] = []
  for (const c of clipsOn(p, voice)) {
    const lo = Math.max(a, c.start)
    const hi = Math.min(b, c.start + c.duration)
    if (hi - lo <= 1e-9) continue
    const x = srcAt(c, lo)
    const y = srcAt(c, hi)
    out.push({ inst: instOf(c), iv: [Math.min(x, y), Math.max(x, y)] })
  }
  return out
}

/** The value a setting has on a clip, as the ops name it. */
/** A transition as a setting: what it is, not the clip it names (`to`,
 *  phase Ç2b.2: the app writes it from where the clips lie; whether the
 *  transition goes where it was put is judged by the content after it). */
const transitionSetting = (t: Clip['transitionOut']): unknown => {
  if (!t) return null
  const { to: _to, ...rest } = t
  return rest
}
export const settingOf = (c: Clip, field: string): unknown =>
  field === 'volume' ? c.volume : field === 'opacity' ? c.opacity ?? 1 : field === 'muted' ? !!c.muted : field === 'transitionOut' ? transitionSetting(c.transitionOut) : (c as unknown as Record<string, unknown>)[field]
const sameValue = (a: unknown, b: unknown): boolean => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 : JSON.stringify(a ?? null) === JSON.stringify(b ?? null))

/** The clip that starts where `c` ends on its track, as content. */
function followerOf(p: Project, c: Clip): { inst: string; src: number } | null {
  const next = clipsOn(p, c.trackId).find((x) => x.id !== c.id && Math.abs(x.start - (c.start + c.duration)) <= SLIVER)
  return next ? { inst: instOf(next), src: srcAt(next, next.start) } : null
}

// ---- what lay where: pairings and places ------------------------------------------

const PAIR = 0.005

/** Did second k*STEP of `inst` on `track` play over the voice content `v`
 *  in `p`? (The pairing of other footage with the talk: what a cut of the
 *  talk takes along.) */
export function hasPair(p: Project, voice: string, track: string, inst: string, k: number, v: Content): boolean {
  const times = samplesOf(p).get(`${track}|${inst}`)?.get(k)
  if (!times) return false
  return times.some((t) => [contentAt(p, voice, t), contentAt(p, voice, t, true)].some((c) => !!c && c.inst === v.inst && Math.abs(c.src - v.src) <= PAIR))
}

/** Did a still of `inst` lie over the voice content `v` in `p`? */
export function hasStill(p: Project, voice: string, inst: string, v: Content): boolean {
  for (const c of clipsOn(p, voice)) {
    if (instOf(c) !== v.inst) continue
    const [lo, hi] = windowOf(c)
    if (v.src < lo - 1e-7 || v.src > hi + 1e-7) continue
    const t = timeAt(c, v.src)
    if (Object.values(p.clips).some((x) => instOf(x) === inst && x.trackId !== voice && t >= x.start - PAIR && t <= x.start + x.duration + PAIR)) return true
  }
  return false
}

/** Where a marker, a title or a template is, as voice content: under its
 *  start and under its end (null: over no talk). */
export type Rel = [Content | null, Content | null]
export function relAt(p: Project, voice: string, a: number, b?: number): Rel {
  const at = (t: number, end: boolean): Content | null => (end ? contentAt(p, voice, t, true) ?? contentAt(p, voice, t) : contentAt(p, voice, t) ?? contentAt(p, voice, t, true))
  return [at(a, false), b === undefined ? null : at(b, true)]
}
const sameSpot = (a: Content | null, b: Content | null): boolean => (!a || !b ? !a && !b : a.inst === b.inst && Math.abs(a.src - b.src) <= SLIVER + EXACT)
export const sameRel = (a: Rel, b: Rel): boolean => sameSpot(a[0], b[0]) && sameSpot(a[1], b[1])

/** A record of the project that sits on the timeline, with its span. */
export function recordIn(p: Project, id: string): { a: number; b?: number } | null {
  const m = p.markers?.find((x) => x.id === id)
  if (m) return { a: m.time }
  const c = p.captions.find((x) => x.id === id)
  if (c) return { a: c.start, b: c.end }
  const t = p.templates?.find((x) => x.id === id)
  if (t) return { a: t.start, b: t.start + (t.duration ?? 0) }
  return null
}

/** What is the agent's own (the session's whose ops are judged). */
export interface Mine {
  /** Titles and markers its ops made; "line X" for a line it retyped. */
  ids: ReadonlySet<string>
  /** Where a record of its making was put, and where its own later edits
   *  left it (it is the agent's only there). */
  rel?: (id: string) => Rel[] | undefined
  /** Where its own edits that landed MOVED a record (anyone's: a cut of its
   *  own through a title): from where to where. A record it saw where it
   *  was, it has seen where its own edit left it. */
  moves?: (id: string) => [Rel, Rel][] | undefined
  /** Was this pairing of other footage with the talk made by one of its
   *  edits that landed (k null: a still)? */
  pair?: (track: string, inst: string, k: number | null, v: Content) => boolean
  /** The live project the materialisation started from, when the part
   *  judged starts later (after a structural op of the agent's): what is in
   *  the part's start and not in `base` is the agent's making. */
  base?: Project
}

/** What the raw operation (as it is sent to the edit tool) means in `seen`. */
export function capture(seen: Project, shape: Shape, raw: Record<string, unknown>): Intent {
  const name = String(raw.op)
  const clipPart = (id: string): Pick<Intent, 'clipId' | 'inst' | 'track' | 'window' | 'still'> => {
    const c = seen.clips[id]
    if (!c) throw new Error(`oracle: no clip ${id} in the seen project`)
    return { clipId: id, inst: instOf(c), track: c.trackId, window: windowOf(c), ...(isStill(seen, c) ? { still: true, under: underOf(seen, shape.voiceTrack, c.start, c.start + c.duration) } : {}) }
  }
  switch (name) {
    case 'timeline.cutRanges': {
      const ranges = (raw.ranges as unknown[]).map((r) => seenRange(seen, r))
      const pieces: { inst: string; iv: Iv }[] = []
      for (const [a, b] of ranges) {
        for (const c of clipsOn(seen, shape.voiceTrack)) {
          const lo = Math.max(a, c.start)
          const hi = Math.min(b, c.start + c.duration)
          if (hi - lo <= 1e-9) continue
          const x = srcAt(c, lo)
          const y = srcAt(c, hi)
          pieces.push({ inst: instOf(c), iv: [Math.min(x, y), Math.max(x, y)] })
        }
      }
      const seenIds = new Set<string>()
      for (const m of seen.markers ?? []) if (ranges.some(([a, b]) => m.time > a - 1e-6 && m.time < b + 1e-6)) seenIds.add(m.id)
      for (const c of seen.captions) if (isTitle(c) && ranges.some(([a, b]) => c.start < b + 1e-6 && c.end > a - 1e-6)) seenIds.add(c.id)
      const keeps = (raw.keeps as (Iv | null)[] | undefined) ?? []
      const takes = ranges.map(([a, b], i) => (keeps[i] ? { pieces: underOf(seen, shape.voiceTrack, a, b), keep: underOf(seen, shape.voiceTrack, keeps[i]![0], keeps[i]![1]) } : null)).filter((t): t is NonNullable<typeof t> => !!t)
      return { fam: 'cut', name, pieces, seenIds, covered: ranges.every(([a, b]) => voiceCovers(seen, shape.voiceTrack, a, b)), ...(takes.length ? { takes } : {}) }
    }
    case 'text.add':
    case 'marker.add': {
      const t = seenTime(seen, raw.time as number | string)
      // (The talk is one-to-one footage: a still on its track gives no place.)
      const on = contentAt(seen, shape.voiceTrack, t)
      const wm = typeof raw.time === 'string' ? TIME_RE.exec(raw.time) : null
      const wt = wm ? wordTag(seen.captions.find((c) => c.id === wm[1])?.words?.[Number(wm[2])] ?? {}) : undefined
      return { fam: 'place', name, ...(wm && wt ? { word: { tag: wt, end: !!wm[3] } } : {}), ref: on && !isStill(seen, seen.clips[on.clip]) ? on : null, alt: seen.tracks.filter((tr) => tr.id !== shape.voiceTrack && !tr.locked).map((tr) => contentAt(seen, tr.id, t)).filter((c): c is Content => !!c && !isStill(seen, seen.clips[c.clip])), seenTime: t, recKind: name === 'text.add' ? 'caption' : 'marker', ...(clipsOn(seen, shape.voiceTrack).length ? {} : { noVoice: true }) }
    }
    case 'clip.setVolume':
    case 'clip.setOpacity': {
      const field = name === 'clip.setVolume' ? 'volume' : 'opacity'
      return { fam: 'record', name, ...clipPart(String(raw.clipId)), field, value: raw[field] as number }
    }
    case 'clip.setMuted':
      return { fam: 'record', name, ...clipPart(String(raw.clipId)), field: 'muted', value: !!raw.muted }
    case 'clip.setTransition': {
      const part = clipPart(String(raw.clipId))
      return { fam: 'record', name, ...part, field: 'transitionOut', value: raw.transition ?? null, follow: followerOf(seen, seen.clips[part.clipId!]) }
    }
    case 'clip.split': {
      const id = (raw.clipIds as string[])[0]
      return { fam: 'split', name, ...clipPart(id), at: srcAt(seen.clips[id], seenTime(seen, raw.time as number | string)) }
    }
    case 'clip.trimHead':
    case 'clip.trimEnd': {
      const id = String(raw.clipId)
      const c = seen.clips[id]
      const head = name === 'clip.trimHead'
      const edge = head ? seenTime(seen, raw.edge as number | string) : c.start + c.duration + (raw.delta as number)
      const at = srcAt(c, edge)
      const far = srcAt(c, head ? c.start : c.start + c.duration)
      return { fam: head ? 'trimHead' : 'trimEnd', name, ...clipPart(id), at, gone: [Math.min(at, far), Math.max(at, far)] }
    }
    case 'clip.delete': {
      if (raw.ripple) return { fam: 'structural', name }
      const part = clipPart((raw.ids as string[])[0])
      return { fam: 'delete', name, ...part, gone: part.window }
    }
    case 'caption.editLine': {
      const line = seen.captions.find((c) => c.id === raw.id)
      return { fam: 'lineText', name, lineId: String(raw.id), words: wordsIn(seen, shape.voiceTrack, line), oldText: line?.text, text: raw.text as string }
    }
    case 'caption.delete': {
      const id = (raw.ids as string[])[0]
      const line = seen.captions.find((c) => c.id === id)
      return { fam: 'lineDelete', name, lineId: id, ...(line && isTitle(line) ? { title: true } : { words: wordsIn(seen, shape.voiceTrack, line) }) }
    }
    case 'caption.setOwnStyle':
    case 'caption.update': {
      const line = seen.captions.find((c) => c.id === raw.id)
      const patch = raw.patch as Record<string, unknown>
      if (name === 'caption.setOwnStyle' || patch.marks === undefined) {
        const key = name === 'caption.setOwnStyle' ? Object.keys(patch)[0] : 'text'
        const field = name === 'caption.setOwnStyle' ? `style.${key}` : 'text'
        return { fam: 'lineSet', name, lineId: String(raw.id), field, value: patch[key], readValue: line ? lineValue(line, field) : undefined, ...(line && isTitle(line) ? { title: true } : { words: wordsIn(seen, shape.voiceTrack, line) }) }
      }
      const words = wordsIn(seen, shape.voiceTrack, line)
      return { fam: 'lineMarks', name, lineId: String(raw.id), words, marks: ((raw.patch as { marks?: number[] }).marks ?? []).map((i) => words[i]).filter(Boolean), hadMarks: (line?.marks ?? []).map((i) => words[i]).filter(Boolean) }
    }
    case 'caption.setStyle': {
      const key = Object.keys(raw.patch as object)[0]
      return { fam: 'field', name, field: `captionStyle.${key}`, value: (raw.patch as Record<string, unknown>)[key], readValue: fieldValue(seen, `captionStyle.${key}`) }
    }
    case 'audio.risers':
      return { fam: 'field', name, field: 'risers', value: (raw.level as number) > 0 ? raw.level : undefined, readValue: fieldValue(seen, 'risers') }
    case 'audio.transitionSfx':
      return { fam: 'field', name, field: 'transitionSfx', value: raw.level, readValue: fieldValue(seen, 'transitionSfx') }
    case 'track.add':
      return { fam: 'add', name }
    case 'clip.add':
    case 'clip.append':
    case 'broll.place':
    case 'template.place': {
      const talkAt = (t: number): Content | null => {
        const on = contentAt(seen, shape.voiceTrack, t)
        return on && !isStill(seen, seen.clips[on.clip]) ? on : null
      }
      const timed = (inst: string | undefined, v: unknown): NonNullable<Intent['adds']>[number] => {
        const t = seenTime(seen, v as number | string)
        // (No talk under it: the other one-to-one footage under it; a talk
        // track that is empty gives nothing to judge a time by.)
        const alt = seen.tracks.filter((tr) => tr.id !== shape.voiceTrack).map((tr) => contentAt(seen, tr.id, t)).filter((c): c is Content => !!c && !isStill(seen, seen.clips[c.clip]))
        return { ...(inst ? { inst } : {}), t, ref: talkAt(t), alt, ...(clipsOn(seen, shape.voiceTrack).length ? {} : { noVoice: true }) }
      }
      if (name === 'clip.append') return { fam: 'adding', name, adds: [{ inst: String(raw.assetId) }] }
      if (name === 'clip.add') return { fam: 'adding', name, adds: [timed(String(raw.assetId), raw.start)] }
      if (name === 'template.place') return { fam: 'adding', name, adds: [timed(undefined, raw.time)] }
      return { fam: 'adding', name, adds: (raw.placements as { assetId: string; start: unknown }[]).map((q) => timed(q.assetId, q.start)) }
    }
    default:
      return { fam: 'structural', name }
  }
}

/** A field of a line ('text', 'style.<name>') and of the project ('a.b'). */
export const lineValue = (c: Caption, field: string): unknown => (field === 'text' ? c.text : (c.style as unknown as Record<string, unknown> | undefined)?.[field.slice(6)])
export const fieldValue = (p: Project, key: string): unknown => key.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), p)

// ---- checking a materialisation -------------------------------------------------

export interface Violation {
  kind: string
  op?: string
  detail: string
}

export interface Judged {
  key: string
  intent: Intent
  applied: boolean
  /** The user wrote the very field of the very content since the op's read. */
  userWrote?: boolean
  /** Structural ops and times on no voice content: is the project the op
   *  met (`before`) the one it was written for (no change of anyone else's
   *  since its read; on a replay: the very film it first ran on)? */
  contextOk?: (before: Project) => boolean
  /** The project the op was read in (what a cut saw in its ranges). */
  seen?: Project
  /** No one but its own agent changed the film since it was read: whatever
   *  lies in its ranges now, it saw there or its own edits put there. */
  clean?: boolean
  /** Its place among the ops of the materialisation, and the project it met. */
  n?: number
  met?: () => Project
  /** Phase 4A.11, K1: what of someone else's change made after its read
   *  this op destroyed going from `before` to `after` (null: nothing). */
  lost?: (before: Project, after: Project) => string | null
}

/** The clips of an instance (on any track) showing part of a source window. */
const piecesIn = (p: Project, inst: string, w: Iv): Clip[] =>
  Object.values(p.clips).filter((c) => instOf(c) === inst && lenOf(inter([windowOf(c)], [w])) > EXACT)
/** What a record op names, in `p`: the pieces of its content. A still has
 *  no source seconds: its pieces are those lying over the talk it lay over
 *  when it was read (a still the user cut in two is still the clip named;
 *  one dragged elsewhere is not); a still over no talk: the clip of that id. */
const namedIn = (p: Project, it: Intent, voice: string): Clip[] => {
  if (!it.still) return piecesIn(p, it.inst!, it.window!)
  const all = Object.values(p.clips).filter((c) => instOf(c) === it.inst)
  if (!it.under?.length) return all.filter((c) => c.id === it.clipId)
  return all.filter((c) => c.id === it.clipId || underOf(p, voice, c.start, c.start + c.duration).some((u) => it.under!.some((v) => v.inst === u.inst && lenOf(inter([u.iv], [v.iv])) > EXACT)))
}

/** Is the content the op was about still in `L` (so dropping it is a loss)?
 *  Content another applied op (`others`) takes anyway does not count. */
export function stillThere(intent: Intent, L: Project, shape: Shape, others: readonly Intent[] = []): boolean {
  const locked = !!L.tracks.find((t) => t.id === shape.voiceTrack)?.locked
  const taken = (inst: string): Iv[] => [
    ...others.flatMap((o) => (o.pieces ?? []).filter((p) => p.inst === inst).map((p) => p.iv)),
    ...others.filter((o) => o.gone && o.inst === inst).map((o) => o.gone!)
  ]
  switch (intent.fam) {
    case 'cut': {
      if (locked) return false
      let left = 0
      for (const inst of new Set(intent.pieces!.map((p) => p.inst))) {
        // (A still on the talk's track is no content a cut can follow.)
        const one = clipsOn(L, shape.voiceTrack).find((c) => instOf(c) === inst)
        if (one && isStill(L, one)) continue
        const meant = union(intent.pieces!.filter((p) => p.inst === inst).map((p) => p.iv))
        left += lenOf(minus(inter(meant, coverOf(L, shape.voiceTrack, inst)), taken(inst)))
      }
      return left >= 0.1
    }
    case 'place': {
      const r = intent.ref
      if (!r || locked) return false
      return lenOf(minus(inter([[r.src - 0.03, r.src + 0.03]], coverOf(L, shape.voiceTrack, r.inst)), taken(r.inst))) > 0.059
    }
    case 'record':
    case 'delete':
      if (intent.still) return namedIn(L, intent, shape.voiceTrack).length > 0 && !others.some((o) => o.fam === 'delete' && o.clipId === intent.clipId)
      // (A transition out sits on the clip's end: that end must be there.)
      if (intent.field === 'transitionOut') return lenOf(minus(inter([[intent.window![1] - 0.06, intent.window![1]]], union(piecesIn(L, intent.inst!, intent.window!).map(windowOf))), taken(intent.inst!))) > 0.059
      return lenOf(minus(union(piecesIn(L, intent.inst!, intent.window!).map(windowOf)), taken(intent.inst!))) >= 0.1
    case 'split':
    case 'trimHead':
    case 'trimEnd': {
      // (A split within 0.05 s of an edge is none: the command makes no
      // piece that short. An edge an earlier split of the agent's own left.)
      if (intent.fam === 'split') {
        const piece = clipAtSource(L, intent.track!, intent.inst!, intent.at!)
        const sp = piece ? speedOf(piece) : 1
        if (piece && (intent.at! - windowOf(piece)[0] < 0.05 * sp + 1e-9 || windowOf(piece)[1] - intent.at! < 0.05 * sp + 1e-9)) return false
      }
      const near: Iv = [intent.at! - 0.06, intent.at! + 0.06]
      return lenOf(minus(inter([near], coverOf(L, intent.track!, intent.inst!)), taken(intent.inst!))) > 0.119
    }
    case 'adding':
      // (Every talk second it was written on is still there.)
      return (intent.adds ?? []).every((a) => !a.ref || lenOf(minus(inter([[a.ref.src - 0.03, a.ref.src + 0.03]], coverOf(L, shape.voiceTrack, a.ref.inst)), taken(a.ref.inst))) > 0.059)
    case 'lineSet':
    case 'lineDelete':
      if (intent.title) return L.captions.some((c) => c.id === intent.lineId)
      // (Another op of the agent took a word of the line: it is not the line that was read.)
      if ((intent.words ?? []).some((w) => w.inst !== undefined && taken(w.inst).some(([a, b]) => (w.src! >= a - 0.02 && w.src! <= b + 0.02) || (w.mid! >= a - 0.02 && w.mid! <= b + 0.02)))) return false
      return L.captions.some((c) => sameWs(wordsIn(L, shape.voiceTrack, c), intent.words ?? []))
    case 'lineText':
    case 'lineMarks':
      // (Another op of the agent took a word of the line: the line is not
      // the one that was read, by the agent's own doing.)
      if ((intent.words ?? []).some((w) => w.inst !== undefined && taken(w.inst).some(([a, b]) => (w.src! >= a - 0.02 && w.src! <= b + 0.02) || (w.mid! >= a - 0.02 && w.mid! <= b + 0.02)))) return false
      return intent.fam === 'lineText'
        ? L.captions.some((c) => sameWs(wordsIn(L, shape.voiceTrack, c), intent.words!))
        : L.captions.some((c) => intent.marks!.every((m) => wordsIn(L, shape.voiceTrack, c).some((w) => sameW(w, m))))
    default:
      return true
  }
}

/** Where the voice content a cut meant plays in `L` now (timeline ranges). */
export function cutSpans(intent: Intent, L: Project, shape: Shape): Iv[] {
  const out: Iv[] = []
  for (const p of intent.pieces ?? []) {
    for (const c of clipsOn(L, shape.voiceTrack)) {
      if (instOf(c) !== p.inst) continue
      for (const [lo, hi] of inter([windowOf(c)], [p.iv])) out.push([Math.min(timeAt(c, lo), timeAt(c, hi)), Math.max(timeAt(c, lo), timeAt(c, hi))])
    }
  }
  return union(out, 1e-6)
}

/** The app's rule (phase Ç2b.1, K-3): no cut leaves a piece of a clip
 *  shorter than 0.05 s; such a sliver goes with the cut (on its own track,
 *  where it leaves a gap that short). */
const MIN_PIECE = 0.002

/**
 * L → M under the operations reported applied. Returns every way M departs
 * from what those operations meant, or does something none of them meant.
 */
export function check(L: Project, M: Project, ops: readonly Judged[], shape: Shape, own: Mine | ReadonlySet<string> = new Set()): Violation[] {
  const me: Mine = 'ids' in own ? own : { ids: own }
  const mine = me.ids
  const out: Violation[] = []
  const bad = (kind: string, detail: string, op?: Judged): void => void out.push({ kind, detail, ...(op ? { op: `${op.key} ${op.intent.name}` } : {}) })
  /** A deviation in seconds as a kind: nothing, "-inexact", or the wrong. */
  const grade = (dev: number, kind: string, detail: string, op?: Judged): void => {
    if (dev <= EXACT) return
    bad(dev <= SLIVER + EXACT ? `${kind.split('-')[0]}-inexact` : kind, `${detail} (off by ${dev.toFixed(4)} s)`, op)
  }
  const locked = new Set(L.tracks.filter((t) => t.locked).map((t) => t.id))
  const voice = shape.voiceTrack
  const applied = ops.filter((o) => o.applied)
  // A cut while the voice's track is locked follows no content: it is judged
  // as a structural op (only on the project it was written for).
  const voiceLocked = locked.has(shape.voiceTrack)
  const structural = applied.some((o) => o.intent.fam === 'structural' || (voiceLocked && o.intent.fam === 'cut'))
  const ctxOk = (o: Judged): boolean => !!o.contextOk?.(o.met?.() ?? L)
  const loose = applied.some((o) => o.intent.fam === 'cut' && !o.intent.covered)
  const cuts = applied.filter((o) => o.intent.fam === 'cut')
  const takers = applied.filter((o) => o.intent.gone && (o.intent.fam === 'delete' || o.intent.fam === 'trimHead' || o.intent.fam === 'trimEnd'))
  // (A clip is its content wherever it lies: a delete takes every piece of
  // what was named, on any track; a trim the piece that holds its point,
  // on the track that piece is on now.)
  const backwardsClip = (c: Clip): boolean => !!c.reversed
  const anyPiece = (p: Project, inst: string, m: number, endSide = false): Clip | undefined =>
    Object.values(p.clips).find((c) => instOf(c) === inst && !isStill(p, c) && (endSide ? m > windowOf(c)[0] + 1e-7 && m <= windowOf(c)[1] + 1e-7 : m >= windowOf(c)[0] - 1e-7 && m < windowOf(c)[1] - 1e-7))
  const trackOfTaker = (it: Intent): string => (it.fam === 'delete' ? '*' : (anyPiece(L, it.inst!, it.at!, it.fam === 'trimEnd') ?? anyPiece(L, it.inst!, it.at!, it.fam !== 'trimEnd'))?.trackId ?? it.track!)
  const goneOf = (track: string, inst: string): Iv[] => union(takers.filter((o) => o.intent.inst === inst && ['*', track].includes(trackOfTaker(o.intent))).map((o) => o.intent.gone!))

  // The stretches of L's timeline the cuts take: where the voice content
  // they meant plays now.
  let hull: Iv[] = []
  const removed = new Map<string, Iv[]>()

  if (!structural) {
    // 1. The voice track, exactly.
    for (const inst of new Set(clipsOn(L, voice).map(instOf))) {
      const covL = coverOf(L, voice, inst)
      const covM = coverOf(M, voice, inst)
      const went = minus(covL, covM)
      removed.set(inst, went)
      if (locked.has(voice)) {
        if (lenOf(went) > EXACT) bad('locked-track-cut', `${lenOf(went).toFixed(3)} s of ${inst} went from the locked ${voice}`)
        continue
      }
      const sp = speedOf(clipsOn(L, voice).find((c) => instOf(c) === inst)!)
      const meant = union(cuts.flatMap((o) => o.intent.pieces!.filter((p) => p.inst === inst).map((p) => p.iv)))
      const comps = inter(meant, covL)
      for (const comp of comps) {
        const kept = lenOf(inter([comp], covM))
        // (0.02 s of the timeline is SLIVER x the speed of the piece that
        // plays it, not of the first piece: pieces of one file at 1x and at
        // 50x, audit patch yama-c.)
        const spc = Math.max(sp, ...[L, M].flatMap((q) => clipsOn(q, voice).filter((c) => instOf(c) === inst && windowOf(c)[0] < comp[1] + EXACT && windowOf(c)[1] > comp[0] - EXACT).map(speedOf)))
        // A located range under 0.02 s is left by the command: a whole piece
        // that short, or what is left of a range between two cuts' edges.
        if (kept <= EXACT || comp[1] - comp[0] < SLIVER * spc + 1e-9) continue
        // (An edge is a cut's, or that of a trim or delete of the agent's own.)
        const edges = [...cuts.flatMap((o) => o.intent.pieces!.filter((p) => p.inst === inst).flatMap((p) => p.iv)), ...takers.filter((t) => t.intent.inst === inst).flatMap((t) => t.intent.gone!)]
        const atEdge = (x: number): boolean => edges.some((e) => Math.abs(e - x) <= EXACT)
        // (Or from a cut's edge to an edge of the piece in L: the part of a
        // range that still lies in L there is under 0.02 s, and the core
        // does not cut a span that short (replay.ts: "too short to cut").
        // Seed 2903: a range of the second op lay in L only as the last
        // 0.02 s of a piece, next to the first op's cut; phase Ç2b, E3.)
        const pieceEdges = clipsOn(L, voice).filter((c) => instOf(c) === inst).flatMap(windowOf)
        const atPiece = (x: number): boolean => pieceEdges.some((e) => Math.abs(e - x) <= EXACT)
        if (inter([comp], covM).every(([a, b]) => b - a < SLIVER * spc + 1e-9 && ((atEdge(a) && (atEdge(b) || atPiece(b))) || (atPiece(a) && atEdge(b))))) continue
        grade(kept, 'cut-kept', `${inst} source ${comp[0].toFixed(3)}–${comp[1].toFixed(3)} was meant to be cut; ${kept.toFixed(4)} s of it is still there`)
      }
      for (const x of minus(minus(went, meant), goneOf(voice, inst))) {
        const len = x[1] - x[0]
        // Two ranges closer than 0.02 s are one cut.
        const gap = comps.some((c) => Math.abs(c[1] - x[0]) <= EXACT) && comps.some((c) => Math.abs(c[0] - x[1]) <= EXACT)
        // (Or two meant stretches beside it on L's TIMELINE that are not
        // beside it in the source: an earlier cut took what lay between.)
        const meantAt = (t: number): boolean => {
          const c = contentAt(L, voice, t)
          return !!c && c.inst === inst && comps.some(([a, b]) => c.src >= a - EXACT && c.src <= b + EXACT)
        }
        const host = clipsOn(L, voice).find((c) => instOf(c) === inst && x[0] >= windowOf(c)[0] - EXACT && x[1] <= windowOf(c)[1] + EXACT)
        const span = host ? [timeAt(host, x[0]), timeAt(host, x[1])].sort((a, b) => a - b) : null
        const beside = !!span && meantAt(span[0] - 1e-3) && meantAt(span[1] + 1e-3)
        if (len <= EXACT || ((gap || beside) && len <= SLIVER * sp + EXACT)) continue
        // (The rest of a piece under 0.05 s the cut took with it, K-3: from
        // a cut's edge to the piece's edge, or between two cuts' edges.)
        if (len <= MIN_PIECE * sp + EXACT) {
          const cutEdges = [...comps.flat(), ...goneOf(voice, inst).flat()]
          // (A piece's edge: a clip's in L, or a split of the same call.)
          const pieceEdges = [...(host ? windowOf(host) : []), ...applied.filter((o) => o.intent.fam === 'split' && o.intent.inst === inst).map((o) => o.intent.at!)]
          const atCut = (v: number): boolean => cutEdges.some((e) => Math.abs(e - v) <= EXACT)
          const atPiece = (v: number): boolean => pieceEdges.some((e) => Math.abs(e - v) <= EXACT)
          if ((atCut(x[0]) && (atCut(x[1]) || atPiece(x[1]))) || (atPiece(x[0]) && atCut(x[1]))) continue
        }
        grade(len, 'deleted-unintended', `${inst} source ${x[0].toFixed(3)}–${x[1].toFixed(3)} went and no applied op meant it`)
      }
      // (What an earlier trim or delete of the agent's took is not a later cut's.)
      const byCuts: Iv[] = []
      applied.forEach((o, k) => {
        if (o.intent.fam !== 'cut') return
        const earlier = union(applied.slice(0, k).filter((x) => x.intent.gone && x.intent.track === voice && x.intent.inst === inst).map((x) => x.intent.gone!))
        byCuts.push(...minus(inter(went, o.intent.pieces!.filter((p) => p.inst === inst).map((p) => p.iv)), earlier))
      })
      for (const x of union(byCuts)) {
        for (const c of clipsOn(L, voice)) {
          if (instOf(c) !== inst) continue
          for (const [lo, hi] of inter([windowOf(c)], [x])) hull.push([Math.min(timeAt(c, lo), timeAt(c, hi)), Math.max(timeAt(c, lo), timeAt(c, hi))])
        }
      }
    }
    hull = union(hull, 1e-6)
    const inHull = (t: number): boolean => hull.some(([a, b]) => t >= a - STEP && t <= b + STEP)

    // 2. Every moment of L either goes — with a cut (it played where the cuts
    //    cut), or with a trim or a delete of the agent's own — or plays in M
    //    exactly as much earlier as the cuts before it took: no hole is left,
    //    nothing closes halfway, nothing else moves, nothing under a cut
    //    stays. A locked track stays as it is.
    const before = (t: number): number => hull.reduce((n, [a, b]) => n + Math.max(0, Math.min(t, b) - a), 0)
    const slack = hull.length * 0.021 + EXACT
    const deepInHull = (t: number): boolean => hull.some(([a, b]) => t > a + 2 * STEP && t < b - 2 * STEP)
    const sL = samplesOf(L)
    const sM = samplesOf(M)
    let offSync = ''
    for (const [key, have] of sL) {
      const tr = trackOf(key)
      const inst = key.slice(tr.length + 1)
      const now = sM.get(key)
      const fixed = locked.has(tr)
      const ok = goneOf(tr, inst)
      const takenBy = (k: number): boolean => ok.some(([a, b]) => k * STEP >= a - STEP && k * STEP <= b + STEP)
      let lostLocked = 0
      let kept = 0
      let unseen = 0
      const wrong: number[] = []
      /** A piece of this content under 0.05 s between a cut's edge and its
       *  own edge (or another cut's): it went with the cut (K-3). */
      const k3 = (t: number): boolean => {
        const c = Object.values(L.clips).find((x) => x.trackId === tr && instOf(x) === inst && t >= x.start - EXACT && t <= x.start + x.duration + EXACT)
        if (!c) return false
        const parts = minus([[c.start, c.start + c.duration]], hull)
        return parts.some(([a, b]) => b - a < MIN_PIECE + EXACT && t >= a - EXACT && t <= b + EXACT)
      }
      for (const [k, times] of have) {
        const left = [...(now?.get(k) ?? [])]
        for (const t of times) {
          const want = fixed ? t : t - before(t)
          const i = left.findIndex((u) => Math.abs(u - want) <= (fixed ? EXACT : slack + (inHull(t) ? STEP : 0)))
          if (i >= 0) {
            left.splice(i, 1)
            if (!fixed && tr !== voice && deepInHull(t)) kept++
            continue
          }
          if (fixed) {
            lostLocked++
            continue
          }
          if (takenBy(k)) continue
          if (k3(t)) continue
          if (inHull(t)) {
            // It went with a cut: the cut saw it there (it lay over that
            // very talk when the agent read), or the agent put it there.
            const v = tr === voice ? null : contentAt(L, voice, t) ?? contentAt(L, voice, t, true)
            if (v && !cuts.some((o) => o.clean || (o.seen && hasPair(o.seen, voice, tr, inst, k, v))) && !me.pair?.(tr, inst, k, v) && !(me.base && !hasPair(me.base, voice, tr, inst, k, v))) unseen++
            continue
          }
          const there = now?.get(k)?.length ?? 0
          // (What went from the voice's own track is judged exactly, above.)
          if (tr === voice && there < times.length) continue
          if (there >= times.length) offSync ||= `${key} source ${(k * STEP).toFixed(2)} played at ${t.toFixed(3)} s and plays at ${now!.get(k)!.map((u) => u.toFixed(3)).join(' / ')} s, not at ${want.toFixed(3)} s (the cuts before it take ${before(t).toFixed(3)} s)`
          else wrong.push(k)
        }
      }
      if (lostLocked) bad('locked-track-cut', `${lostLocked} steps of ${key} went from a locked track or moved on it`)
      if (loose) continue
      if (wrong.length > 1) bad('deleted-unintended', `${wrong.length} steps of ${key} (source ${(wrong[0] * STEP).toFixed(2)} s…) went that no applied op meant`)
      if (kept > 1) bad('cut-kept', `${kept} steps of ${key} played where the cuts cut and are still there`)
      if (unseen > 1) bad('deleted-unseen', `${unseen} steps of ${key} went with a cut that never saw them under that talk (the clip was put or moved there after the agent read)`)
    }
    if (offSync && !loose) bad('out-of-sync', offSync)
    // (And nothing plays in M that L did not have.)
    for (const [key, now] of sM) {
      const have = sL.get(key)
      let stray = 0
      for (const [k, times] of now) if (times.length > (have?.get(k)?.length ?? 0)) stray++
      if (stray > 1) bad('stray-content', `${stray} steps of ${key} play in the result that the live project did not have`)
    }

    // 2b. Stills (no source clock): where each was, moved up by the cuts
    //     before it, is where it is.
    const named = new Set(applied.filter((o) => o.intent.fam !== 'cut' && o.intent.fam !== 'record').map((o) => o.intent.inst))
    for (const tr of L.tracks) {
      if (tr.id === voice || tr.locked || loose) continue
      const stills = clipsOn(L, tr.id).filter((c) => isStill(L, c))
      for (const inst of new Set(stills.map(instOf))) {
        if (named.has(inst)) continue
        // (What the cuts leave of it, a piece under 0.05 s gone with them: K-3.)
        const want = union(stills.filter((c) => instOf(c) === inst).flatMap((c) => minus([[c.start, c.start + c.duration]], hull).filter(([a, b]) => b - a >= MIN_PIECE - 1e-9).map(([a, b]) => [a - before(a), b - before(b)] as Iv)), 1e-6)
        const have = union(clipsOn(M, tr.id).filter((c) => instOf(c) === inst).map((c) => [c.start, c.start + c.duration] as Iv), 1e-6)
        const d = lenOf(minus(want, have)) + lenOf(minus(have, want))
        if (d > hull.length * 0.021 + EXACT) bad('still-moved', `the still ${inst} on ${tr.id} is ${d.toFixed(3)} s off where the cuts leave it`)
        // What a cut takes of it, the cut saw there.
        let blind = 0
        for (const c of stills.filter((x) => instOf(x) === inst)) {
          for (const [a, b] of inter([[c.start, c.start + c.duration]], hull)) {
            // (Not a sliver where the still merely touches a cut.)
            if (b - a <= SLIVER) continue
            for (const f of [0.25, 0.5, 0.75]) {
              const v = contentAt(L, voice, a + f * (b - a))
              if (v && !cuts.some((o) => o.clean || (o.seen && hasStill(o.seen, voice, inst, v))) && !me.pair?.(tr.id, inst, null, v) && !(me.base && !hasStill(me.base, voice, inst, v))) blind++
            }
          }
        }
        if (blind > 1) bad('deleted-unseen', `the still ${inst} on ${tr.id} lost what a cut never saw under that talk (it was put or moved there after the agent read)`)
      }
    }

  }

  // A structural op may move anything: when one ran, only that it ran on
  // the project it was written for is judged.
  if (structural) {
    for (const o of applied) if ((o.intent.fam === 'structural' || (voiceLocked && o.intent.fam === 'cut')) && !ctxOk(o)) bad('structural-on-changed', `${o.intent.name} ran on a project that is not the one it was written for`, o)
    return out
  }

  // 4. Each applied op did what it meant. (What another applied op of the
  //    agent then cut away or set again is that op's doing, not a wrong.)
  const targets = new Set<string>()
  /** Content of another track that plays where the cuts cut. */
  const underCut = (track: string, inst: string, m: number): boolean => {
    const c = clipAtSource(L, track, inst, m) ?? clipAtSource(L, track, inst, m, true)
    if (!c) return false
    const t = timeAt(c, m)
    return hull.some(([a, b]) => t >= a - STEP && t <= b + STEP)
  }
  // (Within 0.05 s of a cut: a sliver it took with it, K-3.)
  const cutAway = (inst: string, m: number): boolean =>
    cuts.some((c) => c.intent.pieces!.some((p) => p.inst === inst && m >= p.iv[0] - MIN_PIECE && m <= p.iv[1] + MIN_PIECE)) || takers.some((t) => t.intent.inst === inst && m >= t.intent.gone![0] - MIN_PIECE && m <= t.intent.gone![1] + MIN_PIECE)
  const allCutAway = (inst: string, w: Iv): boolean => {
    const rest = minus(inter([w], union(piecesIn(L, inst, w).map(windowOf))), [
      ...cuts.flatMap((c) => c.intent.pieces!.filter((p) => p.inst === inst).map((p) => p.iv)),
      ...takers.filter((t) => t.intent.inst === inst).map((t) => t.intent.gone!)
    ])
    // (A piece under 0.05 s left between them went with a cut: K-3.)
    return rest.every(([a, b]) => b - a < MIN_PIECE + EXACT)
  }
  for (const o of applied) {
    const it = o.intent
    if (it.fam === 'place') {
      // (An op that named no id: run.ts gives it the id of the record it made.)
      const t = it.recKind === 'caption' ? M.captions.find((c) => c.id === it.recId)?.start : M.markers?.find((m) => m.id === it.recId)?.time
      // (A later op of the agent's own deleted the title it placed.)
      if (it.noVoice || (it.ref && cutAway(it.ref.inst, it.ref.src)) || applied.some((x) => x.intent.fam === 'lineDelete' && x.intent.lineId === it.recId)) continue
      if (t === undefined) {
        bad('place-missing', `${it.recId} is not in the project`, o)
        continue
      }
      // (The talk it was read on may be gone before this op ran: an earlier
      // edit of the agent's, a delete of the user's.)
      const refInL = !!it.ref && coverOf(L, voice, it.ref.inst).some(([a, b]) => it.ref!.src >= a - EXACT && it.ref!.src <= b + EXACT)
      if (!refInL || locked.has(voice)) {
        // (No talk under its time, but other footage: fine when the record
        // is on that footage still.)
        if ((it.alt ?? []).some((r) => [contentAt(M, r.track, t), contentAt(M, r.track, t, true)].some((c) => c && c.inst === r.inst && Math.abs(c.src - r.src) <= SLIVER))) continue
        // (The talk's track is locked, but the record lies on the talk that
        // was under its time: right, whatever else changed.)
        if (it.ref && [contentAt(M, voice, t), contentAt(M, voice, t, true)].some((c) => c && c.inst === it.ref!.inst && Math.abs(c.src - it.ref!.src) <= SLIVER)) continue
        // (Or one in which everything it was read with still lies as it lay.)
        if (!ctxOk(o) && !(o.seen && nothingMoved(o.seen, o.met?.() ?? L)) && !(o.seen && laysAsBefore(o.seen, o.met?.() ?? L, it, t, M))) bad('place-unanchored', `a time on no voice content was used on a project that is not the one it was written for (${it.seenTime} → ${t.toFixed(3)})`, o)
        continue
      }
      const ref = it.ref!
      // (Footage shown twice: the second meant is in two places, and the op
      // cannot know which.)
      if (clipsOn(L, voice).filter((c) => instOf(c) === ref.inst && ref.src > windowOf(c)[0] + EXACT && ref.src < windowOf(c)[1] - EXACT).length > 1) bad('ambiguous-applied', `${it.recId} was placed although ${ref.inst} ${ref.src.toFixed(3)} is on the timeline twice`, o)
      const dev = (c: Content | null): number => (c && c.inst === ref.inst ? Math.abs(c.src - ref.src) : Infinity)
      // (Clips may lie over each other on a track after a drag: any of them.)
      const under = clipsOn(M, voice).filter((c) => t >= c.start - 1e-7 && t <= c.start + c.duration + 1e-7).map((c): Content => ({ track: voice, inst: instOf(c), src: srcAt(c, t), clip: c.id }))
      const d = Math.min(dev(contentAt(M, voice, t)), dev(contentAt(M, voice, t, true)), ...under.map(dev))
      const c = contentAt(M, voice, t)
      if (d === Infinity) bad('place-wrong', `${it.recId} at ${t.toFixed(3)} s is on ${c ? `${c.inst} ${c.src.toFixed(3)}` : 'nothing'}, meant ${ref.inst} ${ref.src.toFixed(3)}`, o)
      else grade(d, 'place-wrong', `${it.recId} at ${t.toFixed(3)} s is on ${ref.inst} ${c?.src.toFixed(4)}, meant ${ref.src.toFixed(4)}`, o)
    } else if (it.fam === 'record') {
      const now = namedIn(M, it, voice)
      // A later op of the agent on the same content and field has the say.
      // (Setting the volume also unmutes: a later volume op has the say on "muted".)
      const later = applied.slice(applied.indexOf(o) + 1).some((x) => x.intent.fam === 'record' && x.intent.inst === it.inst && (x.intent.field === it.field || (it.field === 'muted' && x.intent.field === 'volume')))
      const deleted = applied.some((x) => x.intent.fam === 'delete' && x.intent.inst === it.inst)
      if (!now.length) {
        // (A still cut in pieces: the piece of that id may have gone with a cut.)
        // (Or, on a track that is not the voice's, it lay under the cuts.)
        const under = !it.still && [0, 0.25, 0.5, 0.75, 1].every((f) => underCut(it.track!, it.inst!, it.window![0] + f * (it.window![1] - it.window![0])))
        if (deleted || under || (it.still ? cuts.length > 0 : allCutAway(it.inst!, it.window!))) continue
        bad(namedIn(L, it, voice).length ? 'record-missing' : 'op-on-missing-content', `no clip shows ${it.inst} ${it.window![0].toFixed(2)}–${it.window![1].toFixed(2)}`, o)
        continue
      }
      // (A transition out sits on the piece the clip ends with.)
      const edge = it.field === 'transitionOut'
      for (const c of now) {
        targets.add(c.id)
        // (The piece the clip ends with on the timeline: for a clip played
        // backwards, the one that holds the LOW end of its source.)
        if (edge && !it.still && (backwardsClip(c) ? Math.abs(windowOf(c)[0] - it.window![0]) : Math.abs(windowOf(c)[1] - it.window![1])) > SLIVER) continue
        // (A transition goes with the clip it went into: a later cut, trim or
        // delete of the agent's own that took that clip took the transition.)
        if (edge && it.value && it.follow && (cutAway(it.follow.inst, it.follow.src) || applied.some((x) => x.intent.fam === 'delete' && x.intent.inst === it.follow!.inst))) continue
        const v = settingOf(c, it.field!)
        if (!later && !sameValue(v, it.value)) bad('record-not-covering', `${c.id} shows part of what ${it.clipId} was and has ${it.field} ${JSON.stringify(v)}, not ${JSON.stringify(it.value)}`, o)
        const over = it.still ? 0 : lenOf(minus([windowOf(c)], [it.window!]))
        if (over > SLIVER + EXACT) bad('record-wrong-piece', `${c.id} got ${it.field} ${JSON.stringify(it.value)} and shows ${over.toFixed(2)} s more of ${it.inst} than the clip the agent named did`, o)
        // A transition is into the clip that follows: the one that followed
        // when the agent read, not whatever lies there now.
        if (edge && it.value && !later && sameValue(v, it.value)) {
          const f = followerOf(M, c)
          // (What followed may have gone with a later cut, trim or delete of the agent's own.)
          // (Or a later cut of the agent's own closed a gap behind the clip.)
          const tookIt = (!!it.follow && (cutAway(it.follow.inst, it.follow.src) || applied.some((x) => x.intent.fam === 'delete' && x.intent.inst === it.follow!.inst))) || applied.slice(applied.indexOf(o) + 1).some((x) => x.intent.fam === 'cut')
          if (!tookIt && !(f && it.follow ? f.inst === it.follow.inst && Math.abs(f.src - it.follow.src) <= SLIVER + EXACT : !f && !it.follow)) bad('transition-into-other', `${c.id} got a transition into ${f ? `${f.inst} ${f.src.toFixed(2)}` : 'nothing'}; when it was read ${it.follow ? `${it.follow.inst} ${it.follow.src.toFixed(2)}` : 'nothing'} followed`, o)
        }
      }
      if (o.userWrote) bad('overwrote-user-value', `the user set ${it.field} of ${it.inst} after the agent read it; the op wrote ${it.value} over it`, o)
    } else if (it.fam === 'split') {
      const left = anyPiece(M, it.inst!, it.at!, true)
      const right = anyPiece(M, it.inst!, it.at!)
      if (Object.values(L.clips).filter((c) => instOf(c) === it.inst && it.at! > windowOf(c)[0] + EXACT && it.at! < windowOf(c)[1] - EXACT).length > 1) bad('ambiguous-applied', `a split was made although ${it.inst} ${it.at!.toFixed(3)} is on the timeline twice`, o)
      if (!left && !right) {
        if (!cutAway(it.inst!, it.at!) && !underCut(it.track!, it.inst!, it.at!) && !applied.some((x) => x.intent.fam === 'delete' && x.intent.inst === it.inst)) bad('op-on-missing-content', `the content it splits (${it.inst} ${it.at!.toFixed(3)}) is not in the project`, o)
      }
      else if (left && right && left.id === right.id) {
        const [a, b] = windowOf(left)
        const d = Math.min(Math.abs(a - it.at!), Math.abs(b - it.at!))
        if (d <= SLIVER + EXACT) bad('split-inexact', `the split is ${d.toFixed(4)} s from source ${it.at!.toFixed(4)} of ${it.inst}`, o)
        else bad('noop-kept', `no split at source ${it.at!.toFixed(3)} of ${it.inst}`, o)
      }
    } else if (it.fam === 'trimHead' || it.fam === 'trimEnd') {
      grade(lenOf(inter(coverOf(M, trackOfTaker(it), it.inst!), [it.gone!])), 'noop-kept', `${it.inst} source ${it.gone![0].toFixed(3)}–${it.gone![1].toFixed(3)} was to be trimmed away and part of it is still there`, o)
    } else if (it.fam === 'delete') {
      if (it.still ? namedIn(M, it, voice).length > 0 : lenOf(inter(union(Object.values(M.clips).filter((c) => instOf(c) === it.inst).map(windowOf)), [it.gone!])) > EXACT) bad('record-not-covering', `part of what ${it.clipId} was is still there`, o)
    } else if (it.fam === 'lineText' || it.fam === 'lineMarks') {
      const ws = (p: Project, c: Caption | undefined): W[] => wordsIn(p, voice, c)
      // The line is the one holding those words (the app may have split it
      // under a new id), else the one of that id.
      const find = (p: Project): Caption | undefined =>
        it.fam === 'lineText'
          ? p.captions.find((c) => sameWs(ws(p, c), it.words!)) ?? p.captions.find((c) => c.id === it.lineId)
          : p.captions.find((c) => c.id === it.lineId && it.marks!.every((m) => ws(p, c).some((w) => sameW(w, m)))) ?? p.captions.find((c) => it.marks!.length > 0 && it.marks!.every((m) => ws(p, c).some((w) => sameW(w, m)))) ?? p.captions.find((c) => c.id === it.lineId)
      const before = find(L)
      const after = find(M)
      // A later op of the agent on the same line has the say; a cut or trim
      // of its own through the line changed the words it read.
      const again = applied.slice(applied.indexOf(o) + 1).some((x) => (x.intent.fam === it.fam || x.intent.fam === 'lineDelete') && x.intent.lineId === it.lineId)
      const touched = (it.words ?? []).some((w) => w.inst !== undefined && cutAway(w.inst, w.src!))
      if (again) continue
      if (!after) {
        // The agent's own cut (or trim) took the line's words.
        const gone = (it.fam === 'lineText' ? it.words! : it.marks!).every((w) => w.inst === undefined || cutAway(w.inst, w.src!) || cutAway(w.inst, w.mid!))
        if (!gone) bad('record-missing', `line ${it.lineId} is not in the project`, o)
        continue
      }
      if (it.fam === 'lineText') {
        // New text is for the words that were read: not for a line that
        // lost or gained a word since.
        // (Word by word: a word an applied cut, trim or delete of the agent's
        // own took at its start or middle is not held against the line,
        // unless it is one of the words the agent read.)
        // (A word that hangs over no sound — the user trimmed its start away —
        // has no content to tell by: with a cut or trim applied it is not held
        // against the line either.)
        const took = (w: W): boolean => (w.inst !== undefined ? cutAway(w.inst, w.src!) || cutAway(w.inst, w.mid!) : cuts.length + takers.length > 0)
        const live = before ? ws(L, before).filter((w) => !took(w) || it.words!.some((v) => sameW(v, w))) : []
        if (before && !touched && !mine.has(`line ${it.lineId}`) && !applied.slice(0, applied.indexOf(o)).some((x) => x.intent.fam === 'lineText' && x.intent.lineId === it.lineId) && !sameWs(live, it.words!)) bad('line-words-changed', `line ${it.lineId} has other words than when it was read`, o)
        if (o.userWrote) bad('overwrote-user-value', `the user retyped line ${it.lineId} after the agent read it`, o)
        // (A cut of the same draft through the line rebuilds its text.)
        if (after.text !== it.text && (after.words?.length ?? 0) === it.words!.length) bad('record-not-covering', `line ${it.lineId} is "${after.text}"`, o)
      } else {
        // A mark is for a word: it must sit on that word, wherever in the
        // line the word is now.
        const here = ws(M, after)
        const got = (after.marks ?? []).map((i) => here[i]).filter(Boolean)
        // (A word whose start a cut of the agent's own took, its middle not,
        // is still that word: it starts where the cut ends.)
        const clipped = (g: W, m: W): boolean => !!g.inst && g.inst === m.inst && g.src !== undefined && m.src !== undefined && m.mid !== undefined && g.src > m.src && g.src < m.mid + EXACT && cutAway(m.inst, m.src)
        const same = (g: W, m: W): boolean => sameW(g, m) || clipped(g, m)
        const stray = got.find((g) => !it.marks!.some((m) => same(g, m)))
        const lost = it.marks!.find((m) => here.some((w) => same(w, m)) && !got.some((g) => same(g, m)))
        if (stray || lost) bad('mark-wrong-word', `line ${it.lineId} marks ${got.map((g) => g.tag ?? g.key).join(',')}, meant ${it.marks!.map((m) => m.tag ?? m.key).join(',')}`, o)
        // (Marks someone else set since the read — on words that are still in
        // the line and are not marked now.)
        const live = find(L)
        const theirs = live ? (live.marks ?? []).map((i) => ws(L, live)[i]).filter(Boolean) : []
        if (o.userWrote && theirs.some((m) => here.some((w) => same(w, m)) && !got.some((g) => same(g, m)))) bad('overwrote-user-value', `the user marked other words of line ${it.lineId} after the agent read it`, o)
      }
    } else if (it.fam === 'lineSet' || it.fam === 'lineDelete') {
      const find = (p: Project): Caption | undefined => (it.title ? p.captions.find((c) => c.id === it.lineId) : p.captions.find((c) => sameWs(wordsIn(p, voice, c), it.words ?? [])) ?? p.captions.find((c) => c.id === it.lineId && !isTitle(c)))
      const after = find(M)
      const again = applied.slice(applied.indexOf(o) + 1).some((x) => x.intent.lineId === it.lineId)
      if (it.fam === 'lineDelete') {
        if (after && (it.title || sameWs(wordsIn(M, voice, after), it.words ?? []))) bad('record-not-covering', `line ${it.lineId} was to be deleted and is still there`, o)
      } else if (!again) {
        if (!after) {
          // (A title that lay where the agent's own cuts cut went with them.)
          const was = it.title ? L.captions.find((c) => c.id === it.lineId) : undefined
          if (was && hull.some(([a, b]) => was.start < b + SLIVER && was.end > a - SLIVER)) continue
          if (find(L) && !applied.some((x) => (x.intent.fam === 'lineDelete' || x.intent.fam === 'lineText') && x.intent.lineId === it.lineId) && !(it.words ?? []).some((w) => w.inst !== undefined && (cutAway(w.inst, w.src!) || cutAway(w.inst, w.mid!)))) bad('record-missing', `line ${it.lineId} is not in the project`, o)
        } else if (!sameValue(lineValue(after, it.field!), it.value)) bad('record-not-covering', `${it.field} of ${it.lineId} is ${JSON.stringify(lineValue(after, it.field!))}, not ${JSON.stringify(it.value)}`, o)
        if (o.userWrote) bad('overwrote-user-value', `the user set ${it.field} of ${it.lineId} after the agent read it`, o)
      }
    } else if (it.fam === 'field') {
      const again = applied.slice(applied.indexOf(o) + 1).some((x) => x.intent.fam === 'field' && x.intent.field === it.field)
      if (!again && !sameValue(fieldValue(M, it.field!), it.value)) bad('record-not-covering', `${it.field} is ${JSON.stringify(fieldValue(M, it.field!))}, not ${JSON.stringify(it.value)}`, o)
      if (o.userWrote) bad('overwrote-user-value', `the user set ${it.field} after the agent read it`, o)
    } else if (it.fam === 'structural') {
      if (!ctxOk(o)) bad('structural-on-changed', `${it.name} ran on a project that is not the one it was written for`, o)
    }
  }

  if (structural) return out

  // 5. No other clip's settings changed.
  for (const [id, c] of Object.entries(L.clips)) {
    const d = M.clips[id]
    if (!d || d === c || targets.has(id)) continue
    if (d.volume !== c.volume || (d.opacity ?? 1) !== (c.opacity ?? 1) || !!d.muted !== !!c.muted) bad('other-record-changed', `${id} (${instOf(c)}) changed volume, opacity or mute and no applied op named it`)
    // A transition goes only where a cut, trim or delete of the agent's took
    // the clip's end or what followed it.
    if (JSON.stringify(transitionSetting(d.transitionOut)) !== JSON.stringify(transitionSetting(c.transitionOut)) && cuts.length + takers.length === 0 && !applied.some((x) => x.intent.fam === 'split')) bad('other-record-changed', `${id} (${instOf(c)}) lost or changed its transition and no applied op named it`)
  }

  // 6. Subtitles stay on their sound: a word that is still there starts on
  //    the same sound as before; one whose start was cut away and that lives
  //    on by the cut's midpoint rule starts where that cut closed. And a word
  //    is still there, unless a cut, trim or delete took its start or its
  //    middle. (Clips may lie over each other on the voice's track after a
  //    drag: the sound of any of them under the word is its sound.)
  const lineOps = new Set(applied.filter((o) => o.intent.lineId).map((o) => o.intent.lineId))
  const after = new Map(wordsOf(M).map((w) => [w.tag, w]))
  const startsIn = (p: Project, t: number): Content[] => allAt(p, voice, t).filter((c) => t < p.clips[c.clip].start + p.clips[c.clip].duration - 1e-7)
  // (A word starts at the high end of its source on a clip that plays
  // backwards: the stretch that went holds it from above.)
  const backwards = (inst: string): boolean => !!clipsOn(L, voice).find((c) => instOf(c) === inst)?.reversed
  const wentAt = (c: Content): Iv | undefined => removed.get(c.inst)?.find(([a, b]) => (backwards(c.inst) ? c.src > a + EXACT && c.src <= b + EXACT : c.src >= a - EXACT && c.src < b - EXACT))
  let off = 0
  let first = ''
  let lost = 0
  let firstLost = ''
  for (const w of wordsOf(L)) {
    if (lineOps.has(w.line)) continue
    const was = startsIn(L, w.start)
    if (!was.length) continue
    const now = after.get(w.tag)
    if (!now) {
      const mid = startsIn(L, (w.start + w.end) / 2)
      if (!was.some(wentAt) && !mid.some(wentAt) && !lost++) firstLost = `word ${w.tag} of line ${w.line} (on ${was[0].inst} ${was[0].src.toFixed(3)}) is gone and its sound is still there`
      continue
    }
    const is = allAt(M, voice, now.start)
    const hangs = startsIn(M, now.start).length === 0
    let d = Infinity
    for (const a of was) {
      const cut = wentAt(a)
      // (What plays after a cut is the source at its far side: the upper end
      // forwards, the lower end for a clip that plays backwards.)
      const back = backwards(a.inst)
      const want = cut ? (back ? cut[0] : cut[1]) : a.src
      for (const c of is) if (c.inst === a.inst) d = Math.min(d, Math.abs(c.src - want))
      // A word whose start was trimmed away keeps its place on its sound's own
      // clock (it hangs over the new edge), as the follow pass leaves it: only
      // where no sound is under it now.
      if (cut && d > EXACT && hangs) for (const c of clipsOn(M, voice)) if (instOf(c) === a.inst) d = Math.min(d, Math.abs(srcAt(c, now.start) - a.src))
      // Where that cut closed there may be no sound after it (the user had
      // deleted it): the word then starts at the end of what is before the cut.
      if (cut && d > EXACT && !coverOf(M, voice, a.inst).some(([x, y]) => want >= x - EXACT && want < y - EXACT)) for (const c of is) if (c.inst === a.inst) d = Math.min(d, Math.abs(c.src - (back ? cut[1] : cut[0])))
      // (A sliver under 0.05 s the cut took with it leaves that much gap
      // where the word now starts: K-3.)
      if (cut && hangs && d <= MIN_PIECE * speedOf(clipsOn(L, voice).find((c) => instOf(c) === a.inst) ?? ({} as Clip)) + EXACT) d = 0
    }
    if (d > EXACT && !off++) first = `word ${w.tag} was on ${was[0].inst} ${was[0].src.toFixed(3)}, is ${d === Infinity ? 'on other sound or none' : `${d.toFixed(4)} s off`}`
  }
  if (off) bad('caption-off-sound', `${off} words: ${first}`)
  if (lost) bad('caption-lost', `${lost} words: ${firstLost}`)

  // 7. The user's markers, titles and templates are not eaten or moved off
  //    their content by a cut that did not see them THERE: a record the
  //    agent read elsewhere (the user moved it since), or never read, is not
  //    the cut's to take.
  const sawIt = (id: string, a: number, b?: number): boolean => {
    const here = relAt(L, voice, a, b)
    if (me.base && !recordIn(me.base, id)) return true
    if (mine.has(id)) {
      const r = me.rel?.(id)
      if (!r || r.some((x) => sameRel(x, here))) return true
    }
    const moves = me.moves?.(id) ?? []
    /** Did the cut see it at `rel` — or where it was before the agent's own
     *  edits moved it there? */
    const sawAt = (o: Judged, rel: Rel, depth = 0): boolean => {
      const was = o.seen && recordIn(o.seen, id)
      if (was && sameRel(relAt(o.seen!, voice, was.a, was.b), rel)) return true
      return depth < 5 && moves.some(([from, to]) => sameRel(to, rel) && !sameRel(from, to) && sawAt(o, from, depth + 1))
    }
    // (In a part that starts after other ops of the same materialisation:
    // where it lay in the live project — those ops, the agent's own, moved
    // it from there.)
    const lay = me.base ? recordIn(me.base, id) : null
    const first = lay ? relAt(me.base!, voice, lay.a, lay.b) : null
    return cuts.some((o) => o.clean || sawAt(o, here) || (!!first && sawAt(o, first)))
  }
  const onVoice = (p: Project, t: number): Content | null => contentAt(p, voice, t) ?? contentAt(p, voice, t, true)
  const stays = (id: string, t0: number, end: number | undefined, t1: number | undefined, what: string): void => {
    if (t1 === undefined) {
      if (!sawIt(id, t0, end)) bad('user-record-lost', `${what} ${id} at ${t0.toFixed(2)} s went with a cut that never saw it there`)
      return
    }
    const was = onVoice(L, t0)
    if (!was || sawIt(id, t0, end) || removed.get(was.inst)?.some(([a, b]) => was.src >= a - EXACT && was.src <= b + EXACT)) return
    const is = onVoice(M, t1)
    if (!is || is.inst !== was.inst || Math.abs(is.src - was.src) > SLIVER) bad('record-off-content', `${what} ${id} was on ${was.inst} ${was.src.toFixed(2)}, is on ${is ? `${is.inst} ${is.src.toFixed(2)}` : 'nothing'}`)
  }
  for (const m of L.markers ?? []) stays(m.id, m.time, undefined, M.markers?.find((x) => x.id === m.id)?.time, 'marker')
  for (const c of L.captions) {
    if (!isTitle(c) || lineOps.has(c.id)) continue
    const d = M.captions.find((x) => x.id === c.id)
    stays(c.id, c.start, c.end, d?.start, 'title')
    if (d && d.end - d.start < c.end - c.start - EXACT && !sawIt(c.id, c.start, c.end)) bad('user-record-lost', `title ${c.id} was shortened by a cut that never saw it there`)
  }
  for (const t of L.templates ?? []) stays(t.id, t.start, t.start + (t.duration ?? 0), M.templates?.find((x) => x.id === t.id)?.start, 'template')

  // 7b. A retake is cut FOR the take that is kept: with that take gone, the
  //     cut would take the only one left.
  for (const o of cuts) {
    for (const take of o.intent.takes ?? []) {
      const went = take.pieces.some((x) => lenOf(inter(removed.get(x.inst) ?? [], [x.iv])) > SLIVER)
      const all = lenOf(take.keep.map((x) => x.iv))
      const there = take.keep.reduce((n, x) => n + lenOf(inter(coverOf(L, voice, x.inst), [x.iv])), 0)
      if (went && all > 0 && there < all / 2) bad('cut-without-kept-take', `a retake was cut although the take it was cut for is gone (${there.toFixed(2)} of ${all.toFixed(2)} s left)`, o)
    }
  }

  // 8. And nothing else happened: no title or marker that no applied op
  //    placed, no line retyped or marked that no applied op named, no clip
  //    cut in two where no applied op cut, no track or field of the project
  //    changed. (An op the app reported as dropped leaves no trace.)
  const placed = (kind: 'caption' | 'marker'): number => applied.filter((o) => o.intent.fam === 'place' && o.intent.recKind === kind).length
  const newMarkers = (M.markers ?? []).filter((m) => !(L.markers ?? []).some((x) => x.id === m.id))
  if (newMarkers.length > placed('marker')) bad('stray-record', `${newMarkers.length} new markers (${newMarkers.map((m) => m.id).join(', ')}) for ${placed('marker')} applied marker.add`)
  const newTitles = M.captions.filter((c) => isTitle(c) && !L.captions.some((x) => x.id === c.id))
  if (newTitles.length > placed('caption')) bad('stray-record', `${newTitles.length} new titles (${newTitles.map((c) => c.id).join(', ')}) for ${placed('caption')} applied text.add`)
  // (Marks go to the line that holds the marked words now: a cut may have
  // put them in a line of another id.)
  const marked = new Set<string>()
  for (const o of applied) if (o.intent.fam === 'lineMarks' && o.intent.marks?.length) for (const c of M.captions) if (o.intent.marks.every((m) => wordsIn(M, voice, c).some((w) => sameW(w, m)))) marked.add(c.id)
  for (const c of L.captions) {
    const d = M.captions.find((x) => x.id === c.id)
    if (!d || d === c || isTitle(c) || lineOps.has(c.id) || marked.has(c.id)) continue
    const tags = (x: Caption): string => (x.words ?? []).map((w) => wordTag(w) ?? '?').join(',')
    if (tags(c) !== tags(d) || tags(c).includes('?')) continue
    if (c.text !== d.text) bad('stray-change', `line ${c.id} was retyped ("${d.text}") and no applied op named it`)
    if ((c.marks ?? []).join() !== (d.marks ?? []).join()) bad('stray-change', `the marks of line ${c.id} changed and no applied op named it`)
  }
  const splitAt = applied.filter((o) => o.intent.fam === 'split')
  for (const tr of L.tracks) {
    for (const c of clipsOn(L, tr.id)) {
      if (isStill(L, c)) continue
      const inst = instOf(c)
      const [lo, hi] = windowOf(c)
      const sp = speedOf(c)
      const edges: number[] = [...(removed.get(inst) ?? []).flat(), ...goneOf(tr.id, inst).flat(), ...splitAt.filter((o) => o.intent.inst === inst).map((o) => o.intent.at!)]
      const covM = coverOf(M, tr.id, inst)
      for (const x of clipsOn(M, tr.id)) {
        if (instOf(x) !== inst) continue
        for (const m of windowOf(x)) {
          if (m <= lo + 0.021 * sp || m >= hi - 0.021 * sp) continue
          // (A cut in two: what is on both sides of it is still there.)
          if (!covM.some(([a, b]) => m > a + 0.021 * sp && m < b - 0.021 * sp)) continue
          if (edges.some((e) => Math.abs(e - m) <= 0.021 * sp)) continue
          // (An edge the live project had: footage shown twice has its pieces' edges inside each other.)
          if (clipsOn(L, tr.id).some((y) => instOf(y) === inst && windowOf(y).some((e) => Math.abs(e - m) <= 0.021 * sp))) continue
          // (On another track: where the cuts' edges fall on its footage.)
          // (Footage shown twice: any of the clips that show that second.)
          const near = (y: Clip): boolean => {
            const t = timeAt(y, m)
            return hull.some(([a, b]) => Math.abs(t - a) <= 0.021 || Math.abs(t - b) <= 0.021)
          }
          if (clipsOn(L, tr.id).some((y) => instOf(y) === inst && m > windowOf(y)[0] - 1e-7 && m < windowOf(y)[1] + 1e-7 && near(y))) continue
          bad('stray-split', `${inst} on ${tr.id} is cut at source ${m.toFixed(3)} and no applied op cut there`)
        }
      }
    }
  }
  const fieldOps = applied.some((o) => (o.intent.fam as string) === 'field')
  const addOps = applied.filter((o) => (o.intent.fam as string) === 'add').length
  const plain = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
  const SKIP = new Set(['tracks', 'clips', 'captions', 'markers', 'templates', 'notes', 'noteSeq', 'name', 'assets'])
  if (!fieldOps) for (const k of new Set([...Object.keys(L), ...Object.keys(M)])) if (!SKIP.has(k) && plain((L as unknown as Record<string, unknown>)[k]) !== plain((M as unknown as Record<string, unknown>)[k])) bad('stray-change', `the project's ${k} changed and no applied op named it`)
  const rows = (p: Project): string => p.tracks.map((t) => `${t.id}${t.locked ? 'L' : ''}${t.hidden ? 'H' : ''}${t.muted ? 'M' : ''}`).join(',')
  if (M.tracks.length !== L.tracks.length + addOps || (!addOps && rows(L) !== rows(M))) bad('stray-change', `the tracks changed (${rows(L)} -> ${rows(M)}) and no applied op named them`)
  if ((M.templates ?? []).length !== (L.templates ?? []).length) bad('stray-record', 'the templates changed and no applied op named them')
  return out
}

/** Does everything `seen` held (its clips, its lines) lie in `now` as it
 *  lay — only additions came since? A second over no talk is then still
 *  that second. */
/** A placement on no talk (the anchor the app follows is a locked track,
 *  or none): it is right when the moment it names means the same — given by
 *  a word, it lies at that word in M; given by a number, nothing at or
 *  before it moved (a later cut does not move it). (Phase Ç2b.1: shape 5,
 *  the talk with its own sound over a locked bed, joined the random runs.) */
export function laysAsBefore(seen: Project, now: Project, it: Intent, t: number, M: Project): boolean {
  if (it.word) {
    const w = M.captions.flatMap((c) => c.words ?? []).find((x) => wordTag(x) === it.word!.tag)
    return !!w && Math.abs((it.word.end ? w.end : w.start) - t) <= EXACT
  }
  if (it.seenTime === undefined || Math.abs(it.seenTime - t) > EXACT) return false
  const at = it.seenTime + EXACT
  const same = (a: Clip | undefined, b: Clip | undefined): boolean => !!a && !!b && a.trackId === b.trackId && Math.abs(a.start - b.start) <= EXACT && Math.abs(a.duration - b.duration) <= EXACT && Math.abs(a.inPoint - b.inPoint) <= EXACT
  // (Both ways: a clip that lies at or before it now lay there, as it is, when
  // it was read — the Ç2b patch, item 10: a clip moved from after it to
  // under it passed, being in `seen`.)
  return Object.values(seen.clips).filter((c) => c.start <= at).every((c) => same(c, now.clips[c.id]))
    && Object.values(now.clips).filter((c) => c.start <= at).every((c) => same(seen.clips[c.id], c))
}

export function nothingMoved(seen: Project, now: Project): boolean {
  const rows = (p: Project): Set<string> => new Set(filmSig(p).split(';').filter((r) => !r.startsWith('T')))
  const have = rows(now)
  return [...rows(seen)].every((r) => have.has(r))
}

/** A materialisation as the driver gives it: the live project, and the
 *  project each op met. */
export interface Trail {
  L: Project
  at: (n: number) => Project
}

/** Is the op one that follows no content (it runs literally, on the project
 *  it was written for): a structural command, a cut while the talk's track
 *  is locked, a cut reaching past the talk? */
export const literal = (it: Intent, L: Project, shape: Shape): boolean =>
  it.fam === 'structural' || (it.fam === 'cut' && (!it.covered || !!L.tracks.find((t) => t.id === shape.voiceTrack)?.locked))

/**
 * A whole materialisation: L → M under `ops` (each with its place `n` in
 * the order they ran). A literal op may move anything, so it is judged only
 * for running on the project it was written for; the ops BETWEEN two such
 * ops are judged in full, against the project the part started from and the
 * one it ended with (the driver replays the first n ops for those).
 */
export function examine(trail: Trail, M: Project, ops: readonly Judged[], shape: Shape, own: Mine): { violations: Violation[]; content: number; literal: number } {
  const out: Violation[] = []
  const order = [...ops].sort((a, b) => (a.n ?? 0) - (b.n ?? 0))
  const part: Judged[] = []
  let start = trail.L
  let content = 0
  let lit = 0
  const judge = (end: Project): void => {
    if (part.length || start !== end) out.push(...check(start, end, part, shape, start === trail.L ? own : { ...own, base: trail.L }))
    content += part.filter((o) => o.applied).length
    part.length = 0
  }
  // (K1: an op that deleted, shortened or wrote over a record whose setting
  // someone else made after its read, and that it read otherwise.)
  for (const o of order) {
    if (!o.applied || o.n === undefined || !o.lost) continue
    const why = o.lost(trail.at(o.n), trail.at(o.n + 1))
    if (why) out.push({ kind: 'user-change-lost', detail: why, op: `${o.key} ${o.intent.name}` })
  }
  for (const o of order) {
    if (o.applied && o.intent.fam === 'adding') {
      // An op that only adds: judged by its own effect, on the project it met.
      const before = trail.at(o.n ?? 0)
      judge(before)
      const after = trail.at((o.n ?? 0) + 1)
      out.push(...checkAdding(before, after, o, shape))
      content++
      start = after
      continue
    }
    if (!o.applied || !literal(o.intent, trail.L, shape)) {
      part.push({ ...o, met: () => trail.at(o.n ?? 0) })
      continue
    }
    const before = trail.at(o.n ?? 0)
    judge(before)
    lit++
    if (!o.contextOk?.(before)) out.push({ kind: 'structural-on-changed', detail: `${o.intent.name} ran on a project that is not the one it was written for`, op: `${o.key} ${o.intent.name}` })
    start = trail.at((o.n ?? 0) + 1)
  }
  judge(M)
  return { violations: out, content, literal: lit }
}

/**
 * An op that only ADDS (a clip, a row of B-roll, a template): what it did,
 * from the project it met to the one it left. Nothing that was there may be
 * changed; each thing it was to add is there once; what was written at a
 * time lies over the talk that was under that time when the agent read (a
 * time over no talk: only on the film it was written for); what goes "at
 * the end of a track" starts after everything on that track.
 */
export function checkAdding(before: Project, after: Project, o: Judged, shape: Shape): Violation[] {
  const out: Violation[] = []
  const bad = (kind: string, detail: string): void => void out.push({ kind, detail, op: `${o.key} ${o.intent.name}` })
  const voice = shape.voiceTrack
  const plain = (v: unknown): string => JSON.stringify(v, (k, x) => (k === 'clipIds' || k === 'height' || k === 'soundClip' ? undefined : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => (a < b ? -1 : 1))) : x))
  // 1. Everything that was there is there, as it was.
  for (const [id, c] of Object.entries(before.clips)) if (after.clips[id] !== c && plain(after.clips[id]) !== plain(c)) bad('adding-changed-others', `clip ${id} changed (or went) with an op that only adds`)
  const byId = <T extends { id: string }>(list: readonly T[] | undefined): Map<string, T> => new Map((list ?? []).map((x) => [x.id, x]))
  for (const [what, was, now] of [['line', before.captions, after.captions], ['marker', before.markers, after.markers], ['template', before.templates, after.templates], ['track', before.tracks, after.tracks]] as const) {
    const have = byId(now as readonly { id: string }[] | undefined)
    for (const x of (was ?? []) as readonly { id: string }[]) if (have.get(x.id) !== x && plain(have.get(x.id)) !== plain(x)) bad('adding-changed-others', `${what} ${x.id} changed (or went) with an op that only adds`)
  }
  const SKIP = new Set(['tracks', 'clips', 'captions', 'markers', 'templates', 'notes', 'noteSeq', 'name', 'assets'])
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (!SKIP.has(k) && plain((before as unknown as Record<string, unknown>)[k]) !== plain((after as unknown as Record<string, unknown>)[k])) bad('adding-changed-others', `the project's ${k} changed with an op that only adds`)
  // 2. What it added, and where.
  const fresh = Object.values(after.clips).filter((c) => !before.clips[c.id])
  const blocks = (after.templates ?? []).filter((t) => !(before.templates ?? []).some((x) => x.id === t.id))
  const onTalk = (t: number): Content | null => contentAt(after, voice, t) ?? contentAt(after, voice, t, true)
  const where = (a: NonNullable<Intent['adds']>[number], t: number, what: string): void => {
    if (a.t === undefined) return
    if (!a.ref && (a.noVoice || (a.alt ?? []).some((r) => [contentAt(after, r.track, t), contentAt(after, r.track, t, true)].some((c) => c && c.inst === r.inst && Math.abs(c.src - r.src) <= SLIVER)))) return
    if (!a.ref) {
      // (Over no talk: on the film it was written for — or on one in which
      // everything it was read with still lies as it lay: only additions
      // came since, and its second is still that second.)
      if (!o.contextOk?.(before) && !(o.seen && nothingMoved(o.seen, before))) bad('structural-on-changed', `${what} was put at a time over no talk, on a project that is not the one it was written for`)
      return
    }
    // (Clips may lie over each other on the talk's track: any of them.)
    const c = allAt(after, voice, t).find((x) => x.inst === a.ref!.inst && Math.abs(x.src - a.ref!.src) <= SLIVER + EXACT) ?? onTalk(t)
    if (!c || c.inst !== a.ref.inst || Math.abs(c.src - a.ref.src) > SLIVER + EXACT) bad('place-wrong', `${what} at ${t.toFixed(3)} s is on ${c ? `${c.inst} ${c.src.toFixed(3)}` : 'no talk'}, meant ${a.ref.inst} ${a.ref.src.toFixed(3)}`)
  }
  for (const a of o.intent.adds ?? []) {
    if (!a.inst) {
      if (blocks.length !== 1) bad('place-missing', `${blocks.length} new templates for one template.place`)
      else where(a, blocks[0].start, `template ${blocks[0].id}`)
      continue
    }
    const made = fresh.filter((c) => instOf(c) === a.inst)
    if (made.length !== 1) {
      bad(made.length ? 'stray-content' : 'place-missing', `${made.length} new clips of ${a.inst} for one added`)
      continue
    }
    const c = made[0]
    if (a.t === undefined) {
      // "At the end of a track": after everything that was on it.
      const end = Math.max(0, ...Object.values(before.clips).filter((x) => x.trackId === c.trackId).map((x) => x.start + x.duration))
      if (c.start < end - EXACT) bad('place-wrong', `${c.id} was appended at ${c.start.toFixed(3)} s, before the end of its track (${end.toFixed(3)} s)`)
    } else where(a, c.start, `clip ${c.id}`)
  }
  const known = new Set((o.intent.adds ?? []).map((a) => a.inst))
  const stray = fresh.filter((c) => !known.has(instOf(c)))
  if (stray.length) bad('stray-content', `${stray.length} clips were added that the op did not name (${stray.map((c) => instOf(c)).join(', ')})`)
  return out
}
