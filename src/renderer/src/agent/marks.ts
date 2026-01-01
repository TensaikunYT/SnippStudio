// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the timeline draws for each thing an agent's draft does (D22, worker
// C; YOL-HARITASI.md, part 4: "every operation has its mark on the
// timeline"). ONE table: the edit command an agent may send → the mark it
// leaves (MARK_OF), held to the list of agent commands by a unit test
// (src/test/d22-c-marks.test.ts: a new command without a mark fails it).
//
// The marks themselves are made from what an op DID (agent/draft-words.ts:
// the difference between the project it met and the one it left), not from
// its name: a ripple delete marks the clip that goes, a move with its sound
// marks both. Where a mark lies is found by id in the project the timeline
// shows: the live one ("Before") or the draft ("After"). Pure.
import type { Clip, Project } from '../types'
import { toDraft, toLive, type ChangeKind, type DraftChange, type Words } from './draft-words'

/** The marks the timeline knows how to draw. */
export type MarkKind =
  /** Its old place faded, a dashed box where it goes, "→ 3 s". */
  | 'move'
  /** A dashed box, "+ new" (a clip, a title, a code clip). */
  | 'add'
  /** The clip hatched across, "to be removed". */
  | 'remove'
  /** A hatched band over every lane, with the time won. */
  | 'cut'
  /** The trimmed end hatched. */
  | 'trim'
  /** A dashed line through the clip where it is split. */
  | 'split'
  /** A frame and a short badge ("vol 50 %", "1.5×"). */
  | 'set'
  /** A dashed badge on the join of two clips. */
  | 'transition'
  /** A dot on the subtitle's chip (old → new on hover). */
  | 'line'
  /** A pin on the ruler (a marker, a graphic of the G lane). */
  | 'pin'
  /** The lane's head framed. */
  | 'track'
  /** A badge at the start of the agent's trail (the whole film). */
  | 'film'

export const MARK_KINDS: readonly MarkKind[] = ['move', 'add', 'remove', 'cut', 'trim', 'split', 'set', 'transition', 'line', 'pin', 'track', 'film']

/**
 * Every edit command an agent may send (agent/families.ts FAMILIES) and the
 * mark(s) it leaves on the timeline, the usual one first. A command that is
 * not here is a red unit test.
 */
export const MARK_OF: Readonly<Record<string, readonly MarkKind[]>> = {
  'timeline.cutRanges': ['cut'],
  'timeline.cutRangeOnTrack': ['trim', 'split', 'remove'],
  'silence.apply': ['cut'],
  'clip.delete': ['remove'],
  'clip.move': ['move'],
  'clip.moveToTrack': ['move'],
  'clip.trimHead': ['trim'],
  'clip.trimEnd': ['trim'],
  'clip.slip': ['set'],
  'clip.keepRange': ['trim'],
  'clip.split': ['split'],
  'clip.add': ['add'],
  'clip.addMedia': ['add'],
  'clip.append': ['add'],
  'clip.duplicate': ['add'],
  'clip.set': ['set', 'transition'],
  'clip.setTransform': ['set'],
  'clip.setOpacity': ['set'],
  'clip.setVolume': ['set'],
  'clip.setMuted': ['set'],
  'clip.setSpeed': ['set'],
  'clip.setFades': ['set'],
  'clip.setTransition': ['transition'],
  'transitions.mix': ['transition'],
  'transitions.preset': ['transition'],
  'transitions.clear': ['transition'],
  'motion.cinematize': ['set'],
  'motion.gentlePan': ['set'],
  'fx.stillImage': ['set'],
  'audio.transitionSfx': ['film'],
  'audio.risers': ['film'],
  'text.add': ['add'],
  'shape.add': ['add'],
  'caption.update': ['line'],
  'caption.editLine': ['line'],
  'caption.delete': ['line'],
  'caption.setStyle': ['film'],
  'caption.setOwnStyle': ['line'],
  'caption.setShape': ['line'],
  'marker.add': ['pin'],
  'marker.update': ['pin'],
  'marker.delete': ['pin'],
  'track.add': ['track'],
  'track.delete': ['track'],
  'track.move': ['track'],
  'track.setMagnet': ['track'],
  'template.place': ['pin'],
  'automation.placeImages': ['add'],
  'broll.place': ['add']
}

/** The mark of each kind of change (agent/draft-words.ts). */
export const MARK_OF_CHANGE: Readonly<Record<ChangeKind, MarkKind>> = {
  gap: 'cut',
  cut: 'cut',
  move: 'move',
  track: 'move',
  add: 'add',
  title: 'add',
  remove: 'remove',
  trim: 'trim',
  split: 'split',
  slip: 'set',
  set: 'set',
  transition: 'transition',
  line: 'line',
  lines: 'film',
  markers: 'pin',
  tracks: 'track',
  other: 'film'
}

/** What a mark is drawn on. */
export type MarkShape =
  /** A clip of the project shown, by id. */
  | 'clip'
  /** A box on a lane (a clip that is not there in the project shown). */
  | 'box'
  /** A band over every lane. */
  | 'band'
  /** A subtitle or title chip of the project shown, by id. */
  | 'chip'
  /** A box on a subtitle lane (a line that is not there in the project shown). */
  | 'chipBox'
  /** A point on the ruler. */
  | 'pin'
  /** A lane's head, by track id; `fresh`: a lane that is not there yet. */
  | 'track'
  /** The whole film. */
  | 'film'

export interface Mark {
  /** Which review item (agent/review.ts) it belongs to. */
  item: number
  kind: MarkKind
  shape: MarkShape
  /** How it is drawn: `frame` (the agent's edge), `was` (an old place,
   *  faded), `ghost` (where it goes, dashed), `new` (dashed, added), `gone`
   *  (hatched across), `dot`, `seam` (a line at `seam`), `join` (on the
   *  clip's end). */
  variant: 'frame' | 'was' | 'ghost' | 'new' | 'gone' | 'dot' | 'seam' | 'join'
  /** shape clip / chip / track: its id. */
  id?: string
  /** shape box: the lane; chipBox: the subtitle layer. */
  trackId?: string
  layer?: number
  /** Seconds of the project shown. */
  start?: number
  end?: number
  /** shape clip: stretches of the clip that are hatched (a trim), in
   *  seconds from the clip's start; a line through it (a split). */
  regions?: [number, number][]
  seam?: number
  /** A lane that is not in the project shown (the draft adds it). */
  fresh?: boolean
  badge?: Words
  /** The change it shows (its sentence is the mark's tip). */
  change: DraftChange
}

export type View = 'before' | 'after'

export interface MarkInput {
  /** The op's changes, in the seconds of the project it met. */
  changes: readonly DraftChange[]
  /** The ranges it cut, in LIVE seconds (drafts.ts marksOf). */
  cuts?: readonly [number, number][]
}

const clipOf = (p: Project, id: string | undefined): Clip | undefined => (id !== undefined && Object.hasOwn(p.clips, id) ? p.clips[id] : undefined)

/**
 * The marks of a draft's items on the timeline as it is shown: `before` the
 * live project (what will go is hatched, what will come is dashed), `after`
 * the draft (what came is framed, what went is a faded ghost). `allCuts`:
 * every range the draft cuts, in live seconds.
 */
export function marksFor(view: View, live: Project, draft: Project, allCuts: readonly [number, number][], items: readonly MarkInput[]): Mark[] {
  const out: Mark[] = []
  const shown = view === 'before' ? live : draft
  /** A second of the live project, in the seconds of the project shown. */
  const fromLive = (t: number): number => (view === 'before' ? t : toDraft(t, allCuts))
  /** A second of the draft, in the seconds of the project shown. */
  const fromDraft = (t: number): number => (view === 'before' ? toLive(t, allCuts) : t)
  items.forEach((it, item) => {
    const cuts = [...(it.cuts ?? [])].sort((a, b) => a[0] - b[0])
    let cutAt = 0
    for (const change of it.changes) {
      const kind = MARK_OF_CHANGE[change.kind]
      const base = { item, kind, change, ...(change.badge ? { badge: change.badge } : {}) }
      const here = clipOf(shown, change.clipId)
      const inLive = clipOf(live, change.clipId)
      const inDraft = clipOf(draft, change.clipId)
      switch (change.kind) {
        case 'gap':
        case 'cut': {
          // (The op's own ranges, in live seconds; in order with its changes.)
          const r = cuts[cutAt++] ?? change.range
          if (!r) break
          if (view === 'before') out.push({ ...base, shape: 'band', variant: 'gone', start: r[0], end: r[1] })
          else out.push({ ...base, shape: 'band', variant: 'seam', start: fromLive(r[0]), end: fromLive(r[0]) })
          break
        }
        case 'move':
        case 'track':
          if (view === 'before') {
            if (inLive) out.push({ ...base, shape: 'clip', variant: 'was', id: inLive.id, badge: undefined })
            if (inDraft) out.push({ ...base, shape: 'box', variant: 'ghost', trackId: inDraft.trackId, fresh: !live.tracks.some((t) => t.id === inDraft.trackId), start: fromDraft(inDraft.start), end: fromDraft(inDraft.start) + inDraft.duration })
          } else {
            if (inLive) out.push({ ...base, shape: 'box', variant: 'was', trackId: inLive.trackId, fresh: !draft.tracks.some((t) => t.id === inLive.trackId), start: fromLive(inLive.start), end: fromLive(inLive.start) + inLive.duration, badge: undefined })
            if (inDraft) out.push({ ...base, shape: 'clip', variant: 'frame', id: inDraft.id })
          }
          break
        case 'add':
          if (here) out.push({ ...base, shape: 'clip', variant: 'new', id: here.id })
          else if (inDraft) out.push({ ...base, shape: 'box', variant: 'new', trackId: inDraft.trackId, fresh: !live.tracks.some((t) => t.id === inDraft.trackId), start: fromDraft(inDraft.start), end: fromDraft(inDraft.start) + inDraft.duration })
          break
        case 'remove':
          if (here) out.push({ ...base, shape: 'clip', variant: 'gone', id: here.id })
          else if (inLive) out.push({ ...base, shape: 'box', variant: 'gone', trackId: inLive.trackId, fresh: !draft.tracks.some((t) => t.id === inLive.trackId), start: fromLive(inLive.start), end: fromLive(inLive.start) + inLive.duration })
          break
        case 'trim': {
          if (!here) break
          const head = change.head ?? 0
          const tail = change.tail ?? 0
          // Before: what goes is hatched. After: the clip as it is, framed.
          const regions: [number, number][] = []
          if (view === 'before') {
            if (head > 0) regions.push([0, head])
            if (tail > 0) regions.push([here.duration - tail, here.duration])
          }
          out.push({ ...base, shape: 'clip', variant: 'frame', id: here.id, ...(regions.length ? { regions } : {}) })
          break
        }
        case 'split':
          if (!here || change.splitAt === undefined) break
          // (After, the clip ends where it was split.)
          out.push({ ...base, shape: 'clip', variant: 'seam', id: here.id, seam: view === 'before' ? change.splitAt : here.duration })
          break
        case 'slip':
        case 'set':
          if (here) out.push({ ...base, shape: 'clip', variant: 'frame', id: here.id })
          break
        case 'transition':
          if (here) out.push({ ...base, shape: 'clip', variant: 'join', id: here.id })
          break
        case 'title':
        case 'line': {
          const id = change.captionId
          const lc = live.captions.find((c) => c.id === id)
          const dc = draft.captions.find((c) => c.id === id)
          const cap = view === 'before' ? lc : dc
          const added = !lc
          if (cap) out.push({ ...base, kind: added ? 'add' : kind, shape: 'chip', variant: added ? 'new' : !dc ? 'gone' : 'dot', id })
          else if (lc || dc) {
            // (A line that is not in the project shown: a box where it lies
            // in the other one.)
            const o = (lc ?? dc)!
            const at = lc ? fromLive(lc.start) : fromDraft(o.start)
            out.push({ ...base, kind: added ? 'add' : kind, shape: 'chipBox', variant: lc ? 'gone' : 'new', layer: o.layer ?? 0, start: at, end: at + Math.max(0.05, o.end - o.start) })
          }
          break
        }
        case 'markers': {
          const lm = (live.markers ?? []).find((x) => x.id === change.markerId)
          const dm = (draft.markers ?? []).find((x) => x.id === change.markerId)
          const m = view === 'before' ? lm : dm
          if (!lm && !dm) break
          const at = m ? m.time : lm ? fromLive(lm.time) : fromDraft(dm!.time)
          out.push({ ...base, shape: 'pin', variant: !dm ? 'gone' : !lm ? 'new' : 'dot', start: at, end: at })
          break
        }
        case 'tracks': {
          const id = change.trackId
          if (id === undefined) out.push({ ...base, kind: 'track', shape: 'film', variant: 'frame' })
          else out.push({ ...base, shape: 'track', variant: change.gone ? 'gone' : live.tracks.some((t) => t.id === id) ? 'frame' : 'new', id, ...(shown.tracks.some((t) => t.id === id) ? {} : { fresh: true }) })
          break
        }
        case 'lines':
          break
        case 'other':
          if (change.to !== undefined) out.push({ ...base, kind: 'pin', shape: 'pin', variant: 'new', start: fromLive(change.to), end: fromLive(change.to) })
          else out.push({ ...base, shape: 'film', variant: 'frame' })
          break
      }
    }
  })
  return out
}

/** Where a mark starts in the project shown (seconds), or null (the whole film). */
export function markStart(m: Mark, shown: Project): number | null {
  if (m.shape === 'clip') {
    const c = clipOf(shown, m.id)
    return c ? c.start + (m.variant === 'join' ? c.duration : m.seam ?? m.regions?.[0]?.[0] ?? 0) : null
  }
  if (m.shape === 'chip') return shown.captions.find((c) => c.id === m.id)?.start ?? null
  return m.start ?? null
}

/** Where an item ends in the project shown (the strip's "play this change"
 *  runs to a little after it); null when it has no place. */
export function itemEnd(marks: readonly Mark[], item: number, shown: Project): number | null {
  let end: number | null = null
  for (const m of marks) {
    if (m.item !== item || m.variant === 'was') continue
    let e: number | null = null
    if (m.shape === 'clip') {
      const c = clipOf(shown, m.id)
      e = c ? c.start + (m.variant === 'seam' && m.seam !== undefined ? m.seam : c.duration) : null
    } else if (m.shape === 'chip') e = shown.captions.find((c) => c.id === m.id)?.end ?? null
    else e = m.end ?? m.start ?? null
    if (e !== null && (end === null || e > end)) end = e
  }
  return end
}

/** Where an item happens in the project shown: its first mark that has a
 *  place (the strip takes the playhead and the view there). */
export function itemStart(marks: readonly Mark[], item: number, shown: Project): number | null {
  let at: number | null = null
  for (const m of marks) {
    if (m.item !== item || m.variant === 'was') continue
    const s = markStart(m, shown)
    if (s !== null && (at === null || s < at)) at = s
  }
  if (at !== null) return at
  for (const m of marks) {
    if (m.item !== item) continue
    const s = markStart(m, shown)
    if (s !== null && (at === null || s < at)) at = s
  }
  return at
}
