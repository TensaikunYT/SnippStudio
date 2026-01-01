// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a draft does, in the user's words (DENEME-2-PLAN-T.md, item 2 and
// "Ek 2"): the review strip, the timeline's marks and the toast of a direct
// edit say what changes, where and what follows from it, not which command
// ran. Made from two projects (before and after) and the cuts between them
// in the first one's seconds, never from the command names: one sentence per
// change, as a string key and its parameters (the page says it with t()).
// Pure (src/test/den2t.test.ts, d22-c-words.test.ts).
//
// D22, worker C (the audit's A4): a split says "is split", a speed says the
// speed, a setting names what was set, a subtitle's text says old → new, a
// deleted line says so; lines are compared on what the user sees (never the
// inner anchors a clip's move rewrites), and a draft with cuts still says
// its changed lines and markers. A clip only carried along by a removal
// before it is not a change of its own. Each change also names what the
// timeline marks for it (agent/marks.ts): a clip, a line, a marker, a track.
import { isSubtitle, type Caption, type Clip, type Project, type Track } from '../types'
import { form } from './count'

export type ChangeKind = 'gap' | 'cut' | 'move' | 'track' | 'add' | 'remove' | 'trim' | 'slip' | 'split' | 'set' | 'transition' | 'title' | 'line' | 'lines' | 'tracks' | 'markers' | 'other'

/** A short label (a badge on the timeline): a key and its parameters. */
export interface Words {
  key: string
  params: Record<string, string | number>
}

/** One change, as the user reads it. `at` is where it happens in the first
 *  project's seconds (the preview goes there); a moved clip also has where
 *  it goes. A row with an empty `key` is said with another (a linked
 *  partner, one of many lines): it is marked on the timeline, not counted. */
export interface DraftChange {
  key: string
  params: Record<string, string | number>
  at: number
  kind: ChangeKind
  /** The clip it is about (the timeline's ghost and old place). */
  clipId?: string
  /** A move: from (live) and to (draft start in live seconds), the track it lands on. */
  from?: number
  to?: number
  trackId?: string
  duration?: number
  name?: string
  /** A cut: its range (live seconds) and whether anything lay there. */
  range?: [number, number]
  /** What the timeline writes on its mark ("vol 50 %", "2×"). */
  badge?: Words
  /** A trim: the seconds taken off the clip's start and its end (negative:
   *  that end was drawn out). A split: where, in the clip's own seconds. */
  head?: number
  tail?: number
  splitAt?: number
  /** A subtitle or a title: its id, and where it lies (a line that is gone:
   *  where it lay). */
  captionId?: string
  layer?: number
  end?: number
  /** A line's text before and after. */
  was?: string
  now?: string
  /** A marker or a graphic of the G lane: its id. */
  markerId?: string
  /** A record that is gone from the second project (a line, a marker, a track). */
  gone?: boolean
}

/** Seconds as the user reads them: "0:10", "3:20", "1:02:05". */
export function mmss(t: number): string {
  const s = Math.max(0, Math.round(t))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** A moment of a short stretch, to the tenth: "0:02.6" (a cut of under ten
 *  seconds would read "0:03–0:03" on the whole-second clock). */
export function mmssT(t: number): string {
  const x = Math.max(0, Math.round(t * 10) / 10)
  const m = Math.floor(x / 60)
  const r = x - m * 60
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`
}
/** A moment: whole seconds when it is on one ("0:09"), else to the tenth
 *  ("0:09.5": said as "0:10" it would be half a second off). */
const when = (t: number): string => (Math.abs(t - Math.round(t)) < 0.05 ? mmss(t) : mmssT(t))
/** The two ends of a stretch on one clock: whole seconds, or tenths when it is short. */
const ends = (a: number, b: number): [string, string] => (b - a < 10 ? [mmssT(a), mmssT(b)] : [mmss(a), mmss(b)])

/** A length as the user reads it: "10 s", "3:20". */
export function span(d: number): string {
  const a = Math.abs(d)
  return a < 60 ? `${Number(a.toFixed(a < 10 ? 1 : 0))} s` : mmss(a)
}

const EPS = 1e-3

/** A live time in the draft's seconds: the cuts before it taken out. */
export function toDraft(t: number, removed: readonly [number, number][]): number {
  let x = t
  for (const [a, b] of removed) {
    if (b <= t + 1e-9) x -= b - a
    else if (a < t) x -= t - a
  }
  return x
}

/** A draft time in live seconds: the cuts before it put back. */
export function toLive(t: number, removed: readonly [number, number][]): number {
  let x = t
  for (const [a, b] of [...removed].sort((p, q) => p[0] - q[0])) {
    if (a <= x + 1e-9) x += b - a
    else break
  }
  return x
}

const nameOf = (p: Project, c: Clip): string => p.assets.find((a) => a.id === c.assetId)?.name ?? (c.adjustment ? 'adjustment layer' : c.id)
const trackName = (p: Project, id: string): string => p.tracks.find((t) => t.id === id)?.name ?? id
const clipEnd = (c: Clip): number => c.start + c.duration
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const pct = (v: number): number => Math.round(v * 100)
const short = (s: string, n = 32): string => {
  const x = s.replace(/\s+/g, ' ').trim()
  return x.length > n ? `${x.slice(0, n - 1)}…` : x
}
const times = (v: number): string => `${Number(v.toFixed(2))}`

// ---- what was set on a clip --------------------------------------------------

/** The settings of a clip, by what the user calls them. A field not listed
 *  is "its settings". */
const SET_GROUPS: Readonly<Record<string, string>> = {
  volume: 'volume', volumeKeyframes: 'volume', autoDucking: 'volume', channels: 'volume',
  muted: 'muted',
  speed: 'speed', speedCurve: 'speed', keepPitch: 'speed',
  opacity: 'opacity',
  transform: 'transform',
  fadeIn: 'fade', fadeOut: 'fade',
  grade: 'grade', lut: 'grade', blendMode: 'grade',
  blur: 'effect', sharpen: 'effect', vignette: 'effect', grain: 'effect', glow: 'effect', chromaAb: 'effect', motionFx: 'effect', stillImageFx: 'effect', ambientFx: 'effect', idle: 'effect', mask: 'effect', crop: 'effect', chroma: 'effect', effects: 'effect',
  anim: 'anim',
  disabled: 'disabled'
}
/** In the order they are said. */
const GROUP_ORDER = ['speed', 'volume', 'muted', 'opacity', 'transform', 'fade', 'grade', 'effect', 'anim', 'disabled', 'other']

/** The fields of a clip that are not where it lies. */
function fieldsChanged(a: Clip, b: Clip): string[] {
  const skip = new Set(['start', 'duration', 'inPoint', 'trackId', 'transitionOut', 'instance'])
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].filter((k) => !skip.has(k) && !same((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]))
}

function setChange(live: Project, l: Clip, c: Clip, fields: readonly string[]): DraftChange {
  const groups = [...new Set(fields.map((f) => SET_GROUPS[f] ?? 'other'))].sort((x, y) => GROUP_ORDER.indexOf(x) - GROUP_ORDER.indexOf(y))
  const name = nameOf(live, l)
  const base = { at: l.start, kind: 'set' as const, clipId: c.id, name }
  const g = groups[0]
  const more = groups.length - 1
  const one = ((): { key: string; params: Record<string, string | number>; badge: Words } => {
    switch (g) {
      case 'speed': {
        const x = times(c.speed ?? 1)
        return { key: 'd22c.change.speed', params: { name, x, was: span(l.duration), d: span(c.duration) }, badge: { key: 'd22c.badge.speed', params: { x } } }
      }
      case 'volume':
        return fields.includes('volume') && fields.filter((f) => SET_GROUPS[f] === 'volume').length === 1
          ? { key: 'd22c.change.volume', params: { name, was: pct(l.volume), now: pct(c.volume) }, badge: { key: 'd22c.badge.volume', params: { now: pct(c.volume) } } }
          : { key: 'd22c.change.sound', params: { name }, badge: { key: 'd22c.badge.sound', params: {} } }
      case 'muted':
        return { key: c.muted ? 'd22c.change.muted' : 'd22c.change.unmuted', params: { name }, badge: { key: c.muted ? 'd22c.badge.muted' : 'd22c.badge.unmuted', params: {} } }
      case 'opacity':
        return { key: 'd22c.change.opacity', params: { name, was: pct(l.opacity ?? 1), now: pct(c.opacity ?? 1) }, badge: { key: 'd22c.badge.opacity', params: { now: pct(c.opacity ?? 1) } } }
      case 'transform': {
        const { scale: s0, ...rest0 } = l.transform as unknown as Record<string, unknown>
        const { scale: s1, ...rest1 } = c.transform as unknown as Record<string, unknown>
        return typeof s0 === 'number' && typeof s1 === 'number' && s0 !== s1 && same(rest0, rest1)
          ? { key: 'd22c.change.scale', params: { name, was: pct(s0), now: pct(s1) }, badge: { key: 'd22c.badge.scale', params: { now: pct(s1) } } }
          : { key: 'd22c.change.transform', params: { name }, badge: { key: 'd22c.badge.transform', params: {} } }
      }
      case 'fade':
        return { key: 'd22c.change.fade', params: { name }, badge: { key: 'd22c.badge.fade', params: {} } }
      case 'grade':
        return { key: 'd22c.change.grade', params: { name }, badge: { key: 'd22c.badge.grade', params: {} } }
      case 'effect':
        return { key: 'd22c.change.effect', params: { name }, badge: { key: 'd22c.badge.effect', params: {} } }
      case 'anim':
        return { key: 'd22c.change.anim', params: { name }, badge: { key: 'd22c.badge.anim', params: {} } }
      case 'disabled':
        return { key: c.disabled ? 'd22c.change.disabled' : 'd22c.change.enabled', params: { name }, badge: { key: c.disabled ? 'd22c.badge.disabled' : 'd22c.badge.enabled', params: {} } }
      default:
        return { key: 'den2t.change.clipSet', params: { name }, badge: { key: 'd22c.badge.set', params: {} } }
    }
  })()
  // Several things at once: the first said whole, the rest counted.
  return more > 0
    ? { ...base, key: `d22c.change.setMore.${form(more)}`, params: { ...one.params, first: one.key, n: more }, badge: { key: 'd22c.badge.more', params: { ...one.badge.params, first: one.badge.key, n: more } } }
    : { ...base, key: one.key, params: one.params, badge: one.badge }
}

// ---- lines ---------------------------------------------------------------------

/** A line as the user sees it: not its id, not the inner anchors a clip's
 *  move or a split rewrites (soundClip, the words' own times). */
function lineLook(c: Caption): unknown {
  const { id: _id, start: _s, end: _e, text: _t, words: _w, soundClip: _sc, manual: _m, ...look } = c as unknown as Record<string, unknown>
  return look
}

/** The changes of a draft, in order of where they happen. */
export function draftChanges(live: Project, draft: Project, removed: readonly [number, number][]): DraftChange[] {
  const out: DraftChange[] = []
  const cuts = [...removed].sort((a, b) => a[0] - b[0])
  // The cuts: an empty stretch, or a cut through clips.
  for (const [a, b] of cuts) {
    const under = Object.values(live.clips).filter((c) => c.start < b - EPS && clipEnd(c) > a + EPS)
    const d = span(b - a)
    const [from, to] = ends(a, b)
    const badge: Words = { key: 'd22c.badge.cut', params: { d } }
    if (!under.length) out.push({ key: 'den2t.change.gap', params: { from, to, d }, at: a, kind: 'gap', range: [a, b], badge })
    else {
      const names = [...new Set(under.map((c) => nameOf(live, c)))]
      const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '')
      out.push({ key: 'den2t.change.cut', params: { from, to, names: shown, d }, at: a, kind: 'cut', range: [a, b], badge })
    }
  }
  const inCut = (c: Clip): boolean => cuts.some(([a, b]) => c.start >= a - EPS && clipEnd(c) <= b + EPS)
  const touchedByCut = (c: Clip): boolean => cuts.some(([a, b]) => c.start < b - EPS && clipEnd(c) > a + EPS)
  const liveList = Object.values(live.clips)
  const draftList = Object.values(draft.clips)
  const said = new Set<string>()
  // (A piece also starts inside the clip it came from, in live seconds; a
  // copy of a clip — clip.duplicate, cogalt 23 Nov — starts at its end or
  // elsewhere and is new: it was said nowhere and marked nowhere.)
  const pieceOfLive = (c: Clip): boolean => {
    const at = toLive(c.start, cuts)
    return liveList.some((l) => l.assetId === c.assetId && l.trackId === c.trackId && c.inPoint >= l.inPoint - 1e-6 && c.inPoint <= l.inPoint + l.duration * (l.speed ?? 1) + 1e-6 && at >= l.start - 1e-6 && at < clipEnd(l) - 1e-6)
  }
  /** The linked partner of a live clip. */
  const partnerOf = (l: Clip): Clip | undefined => (l.linkId ? liveList.find((o) => o.id !== l.id && o.linkId === l.linkId) : undefined)

  // What takes time out of a lane (a clip removed, shortened or sped up):
  // the clips after it that close up by that much are carried, not moved.
  const causes: { at: number; delta: number; change?: DraftChange }[] = []
  const clipRows: DraftChange[] = []

  for (const l of liveList) {
    const c = draft.clips[l.id]
    if (!c || said.has(l.id)) continue
    if (c.trackId !== l.trackId || touchedByCut(l)) continue
    // Split: the same clip, shorter, and the rest of it right after as a new clip.
    const piece = !cuts.length && c.duration < l.duration - EPS && Math.abs(c.start - l.start) < EPS
      ? draftList.find((p) => !live.clips[p.id] && p.assetId === l.assetId && p.trackId === l.trackId && Math.abs(p.start - clipEnd(c)) < EPS && Math.abs(c.duration + p.duration - l.duration) < 1e-2 && (p.speed ?? 1) === (l.speed ?? 1))
      : undefined
    if (piece) {
      const mate = partnerOf(l)
      const mateSplit = mate && !said.has(mate.id) && draft.clips[mate.id] && Math.abs(draft.clips[mate.id].duration - c.duration) < EPS && Math.abs(mate.start - l.start) < EPS
      const row: DraftChange = { key: 'd22c.change.split', params: { name: nameOf(live, l), at: when(piece.start), partner: mateSplit ? 1 : 0 }, at: piece.start, kind: 'split', clipId: l.id, name: nameOf(live, l), splitAt: c.duration, badge: { key: 'd22c.badge.split', params: {} } }
      clipRows.push(row)
      said.add(l.id)
      if (mateSplit && mate) {
        clipRows.push({ key: '', params: {}, at: piece.start, kind: 'split', clipId: mate.id, name: nameOf(live, mate), splitAt: c.duration })
        said.add(mate.id)
      }
    }
  }

  // Clips: moved, to another lane, trimmed, slipped, set, removed, added.
  for (const c of draftList) {
    const l = live.clips[c.id]
    if (!l) {
      if (pieceOfLive(c)) continue
      const at = toLive(c.start, cuts)
      clipRows.push({ key: 'den2t.change.added', params: { name: nameOf(draft, c), track: trackName(draft, c.trackId), at: when(at), d: span(c.duration) }, at, kind: 'add', clipId: c.id, to: at, trackId: c.trackId, duration: c.duration, name: nameOf(draft, c), badge: { key: 'd22c.badge.new', params: {} } })
      continue
    }
    const name = nameOf(live, l)
    const fields = touchedByCut(l) ? [] : fieldsChanged(l, c)
    // A transition is said on its own (the timeline marks the join).
    if (!touchedByCut(l) && !same(l.transitionOut, c.transitionOut)) {
      const next = c.transitionOut?.to ? draft.clips[c.transitionOut.to] : undefined
      const d = c.transitionOut ? span(c.transitionOut.duration) : ''
      const key = !c.transitionOut ? 'd22c.change.transitionOff' : !l.transitionOut ? (next ? 'd22c.change.transitionOnTo' : 'd22c.change.transitionOn') : 'd22c.change.transitionSet'
      clipRows.push({ key, params: { name, d, ...(next && key === 'd22c.change.transitionOnTo' ? { next: nameOf(draft, next) } : {}) }, at: clipEnd(l), kind: 'transition', clipId: c.id, name, gone: !c.transitionOut, badge: { key: c.transitionOut ? 'd22c.badge.transition' : 'd22c.badge.transitionOff', params: {} } })
    }
    if (said.has(c.id)) continue
    const expected = toDraft(l.start, cuts)
    const to = toLive(c.start, cuts)
    if (c.trackId !== l.trackId) {
      clipRows.push({ key: 'den2t.change.toTrack', params: { name, track: trackName(draft, c.trackId), at: mmss(to) }, at: Math.min(l.start, to), kind: 'track', clipId: c.id, from: l.start, to, trackId: c.trackId, duration: c.duration, name, badge: { key: 'd22c.badge.toTrack', params: { track: trackName(draft, c.trackId) } } })
      said.add(c.id)
      continue
    }
    const speedSet = fields.some((f) => SET_GROUPS[f] === 'speed')
    const endSame = Math.abs(toDraft(clipEnd(l), cuts) - clipEnd(c)) < EPS
    const startSame = Math.abs(c.start - expected) < EPS
    const lengthSame = Math.abs(c.duration - l.duration) < EPS
    if (!touchedByCut(l) && !lengthSame && !speedSet && (startSame || endSame || Math.abs(c.inPoint - l.inPoint) > EPS)) {
      // Trimmed (or drawn out) at its start, its end, or both. (A start
      // trimmed with what follows closing up leaves the clip where it was:
      // its footage tells which end it was.)
      const inShift = (c.inPoint - l.inPoint) / (l.speed ?? 1)
      const rippledHead = startSame && inShift > EPS && Math.abs(inShift - (l.duration - c.duration)) < 1e-2
      const head = rippledHead ? inShift : startSame ? 0 : c.start - expected
      const tail = rippledHead ? 0 : clipEnd(l) - (l.start + head + c.duration)
      const len = span(c.duration)
      const mate = partnerOf(l)
      const dm = mate ? draft.clips[mate.id] : undefined
      const withMate = !!mate && !!dm && !said.has(mate.id) && Math.abs(dm.duration - c.duration) < EPS && Math.abs(dm.start - c.start) < EPS && Math.abs(mate.start - l.start) < EPS
      const key = Math.abs(head) > EPS && Math.abs(tail) > EPS ? 'd22c.change.trimBoth' : Math.abs(head) > EPS ? (head > 0 ? 'd22c.change.trimHead' : 'd22c.change.growHead') : tail > 0 ? 'd22c.change.trimTail' : 'd22c.change.growTail'
      const row: DraftChange = { key, params: { name, d: span(Math.abs(head) > EPS && Math.abs(tail) <= EPS ? head : tail), len, was: span(l.duration), partner: withMate ? 1 : 0 }, at: l.start, kind: 'trim', clipId: c.id, name, head, tail, badge: { key: c.duration < l.duration ? 'd22c.badge.trim' : 'd22c.badge.grow', params: { d: span(c.duration - l.duration) } } }
      clipRows.push(row)
      said.add(c.id)
      causes.push({ at: clipEnd(l) - EPS, delta: c.duration - l.duration, change: row })
      if (withMate && mate) {
        clipRows.push({ key: '', params: {}, at: mate.start, kind: 'trim', clipId: mate.id, name: nameOf(live, mate), head, tail })
        said.add(mate.id)
      }
    } else if (!startSame) {
      const d = c.start - expected
      // Its linked partner moved the same: said once, "with its sound".
      const partner = l.linkId ? draftList.find((o) => o.id !== c.id && o.linkId === l.linkId && live.clips[o.id] && !said.has(o.id) && Math.abs(o.start - toDraft(live.clips[o.id].start, cuts) - d) < EPS) : undefined
      if (partner) said.add(partner.id)
      const badge: Words = { key: d > 0 ? 'den2t.tl.later' : 'den2t.tl.earlier', params: { d: span(d) } }
      clipRows.push({ key: d > 0 ? 'den2t.change.moveLater' : 'den2t.change.moveEarlier', params: { name, d: span(d), from: mmss(l.start), to: mmss(to), partner: partner ? 1 : 0 }, at: Math.min(l.start, to), kind: 'move', clipId: c.id, from: l.start, to, trackId: c.trackId, duration: c.duration, name, badge })
      if (partner) {
        const pl = live.clips[partner.id]
        clipRows.push({ key: '', params: {}, at: Math.min(pl.start, toLive(partner.start, cuts)), kind: 'move', clipId: partner.id, from: pl.start, to: toLive(partner.start, cuts), trackId: partner.trackId, duration: partner.duration, name: nameOf(live, pl), badge })
      }
      said.add(c.id)
    } else if (!touchedByCut(l) && lengthSame && Math.abs(c.inPoint - l.inPoint) > EPS) {
      const d = c.inPoint - l.inPoint
      clipRows.push({ key: 'den2t.change.slipped', params: { name, d: span(d), way: d > 0 ? 'later' : 'earlier' }, at: l.start, kind: 'slip', clipId: c.id, name, badge: { key: 'd22c.badge.slip', params: {} } })
      said.add(c.id)
    }
    if (fields.length) {
      const row = setChange(live, l, c, fields)
      clipRows.push(row)
      if (speedSet && !lengthSame) causes.push({ at: clipEnd(l) - EPS, delta: c.duration - l.duration, change: row })
    }
  }
  for (const l of liveList) {
    if (draft.clips[l.id] || inCut(l)) continue
    // (A clip a cut made pieces of: its pieces are in the draft.)
    if (touchedByCut(l) && draftList.some((c) => c.assetId === l.assetId && c.trackId === l.trackId)) continue
    if (said.has(l.id)) continue
    const mate = partnerOf(l)
    const withMate = !!mate && !draft.clips[mate.id] && !said.has(mate.id) && !inCut(mate)
    const row: DraftChange = { key: 'den2t.change.removed', params: { name: nameOf(live, l), from: mmss(l.start), to: mmss(clipEnd(l)), partner: withMate ? 1 : 0 }, at: l.start, kind: 'remove', clipId: l.id, name: nameOf(live, l), trackId: l.trackId, from: l.start, duration: l.duration, gone: true, badge: { key: 'd22c.badge.gone', params: {} } }
    clipRows.push(row)
    said.add(l.id)
    causes.push({ at: l.start - EPS, delta: -l.duration, change: row })
    if (withMate && mate) {
      clipRows.push({ key: '', params: {}, at: mate.start, kind: 'remove', clipId: mate.id, name: nameOf(live, mate), trackId: mate.trackId, from: mate.start, duration: mate.duration, gone: true })
      said.add(mate.id)
    }
  }
  // Carried along: a clip after a removal (a trim, a speed) that closes up
  // by exactly that much did not move by itself.
  const carried = new Set<DraftChange>()
  for (const m of clipRows) {
    if (m.kind !== 'move' || m.from === undefined || m.to === undefined) continue
    const cause = causes.find((x) => m.from! >= x.at && Math.abs(m.to! - m.from! - x.delta) < 1e-2)
    if (!cause) continue
    carried.add(m)
    if (cause.change && cause.change.key) cause.change.params = { ...cause.change.params, closes: 1 }
  }
  out.push(...clipRows.filter((m) => !carried.has(m)))
  const clipsMoved = clipRows.some((m) => m.kind !== 'set' && m.kind !== 'transition')

  // Titles and subtitles: added, gone, their words, their time, their look.
  const liveCaps = new Map(live.captions.map((c) => [c.id, c]))
  const draftCaps = new Set(draft.captions.map((c) => c.id))
  const lines: DraftChange[] = []
  const sub = (c: Caption, a: string, b: string): string => (isSubtitle(c) ? a : b)
  for (const c of draft.captions) {
    const l = liveCaps.get(c.id)
    const at = toLive(c.start, cuts)
    const where = { captionId: c.id, layer: c.layer ?? 0, to: at, end: toLive(c.end, cuts) }
    if (!l) {
      if (!isSubtitle(c)) out.push({ key: 'den2t.change.titleAdded', params: { text: (c.text ?? '').slice(0, 40), at: when(at) }, at, kind: 'title', ...where, badge: { key: 'd22c.badge.newTitle', params: {} } })
      else lines.push({ key: 'd22c.change.subAdded', params: { text: short(c.text ?? ''), at: when(at) }, at, kind: 'line', ...where, now: c.text ?? '', badge: { key: 'd22c.badge.new', params: {} } })
      continue
    }
    const text = short(l.text ?? '')
    if ((l.text ?? '') !== (c.text ?? '')) lines.push({ key: sub(c, 'd22c.change.subText', 'd22c.change.titleText'), params: { was: text, now: short(c.text ?? '') }, at: l.start, kind: 'line', ...where, was: l.text ?? '', now: c.text ?? '' })
    else if (!cuts.length && !clipsMoved && (Math.abs(c.start - l.start) > EPS || Math.abs(c.end - l.end) > EPS || (c.layer ?? 0) !== (l.layer ?? 0))) lines.push({ key: sub(c, 'd22c.change.subTime', 'd22c.change.titleTime'), params: { text, from: when(c.start), to: when(c.end) }, at: Math.min(l.start, c.start), kind: 'line', ...where })
    else if (!same(lineLook(l), lineLook(c))) lines.push({ key: sub(c, 'd22c.change.subLook', 'd22c.change.titleLook'), params: { text }, at: l.start, kind: 'line', ...where })
  }
  for (const l of live.captions) {
    if (draftCaps.has(l.id) || cuts.some(([a, b]) => l.start >= a - EPS && l.end <= b + EPS)) continue
    lines.push({ key: sub(l, 'd22c.change.subGone', 'd22c.change.titleGone'), params: { text: short(l.text ?? ''), at: when(l.start) }, at: l.start, kind: 'line', captionId: l.id, layer: l.layer ?? 0, to: l.start, end: l.end, was: l.text ?? '', gone: true })
  }
  // Many lines at once are said as a count; each is still marked.
  if (lines.length > 6) {
    out.push({ key: `d22c.change.lines.${form(lines.length)}`, params: { n: lines.length }, at: Math.min(...lines.map((x) => x.at)), kind: 'lines' })
    out.push(...lines.map((x) => ({ ...x, key: '' })))
  } else out.push(...lines)

  // Tracks: new, gone, renamed or switched, their order.
  const liveTracks = new Map(live.tracks.map((t) => [t.id, t]))
  const trackLook = (t: Track): unknown => ({ name: t.name, kind: t.kind, hidden: !!t.hidden, muted: !!t.muted, locked: !!t.locked, solo: !!t.solo })
  for (const t of draft.tracks) {
    const l = liveTracks.get(t.id)
    if (!l) out.push({ key: t.kind === 'audio' ? 'd22c.change.trackAddedAudio' : 'd22c.change.trackAddedVideo', params: { name: t.name }, at: 0, kind: 'tracks', trackId: t.id, badge: { key: 'd22c.badge.new', params: {} } })
    else if (!same(trackLook(l), trackLook(t))) out.push({ key: 'd22c.change.trackSet', params: { name: l.name }, at: 0, kind: 'tracks', trackId: t.id, badge: { key: 'd22c.badge.set', params: {} } })
    // A track's magnet switched (track.setMagnet, 22 Nov, worker B): said by the track's name.
    if (l && !!l.autoPack !== !!t.autoPack) out.push({ key: t.autoPack ? 'd22b.change.magnetOn' : 'd22b.change.magnetOff', params: { track: t.name }, at: 0, kind: 'tracks', trackId: t.id, badge: { key: 'd22c.badge.set', params: {} } })
  }
  for (const l of live.tracks) if (!draft.tracks.some((t) => t.id === l.id)) out.push({ key: 'd22c.change.trackGone', params: { name: l.name }, at: 0, kind: 'tracks', trackId: l.id, gone: true, badge: { key: 'd22c.badge.gone', params: {} } })
  const kept = (p: Project, other: Project): string => p.tracks.filter((t) => other.tracks.some((x) => x.id === t.id)).map((t) => t.id).join(',')
  if (kept(live, draft) !== kept(draft, live)) out.push({ key: 'd22c.change.trackOrder', params: {}, at: 0, kind: 'tracks' })

  // Markers: new, gone, moved or renamed.
  const liveMarks = new Map((live.markers ?? []).map((m) => [m.id, m]))
  for (const m of draft.markers ?? []) {
    const l = liveMarks.get(m.id)
    const label = short(m.label || m.note || '', 24)
    const at = toLive(m.time, cuts)
    if (!l) out.push({ key: label ? 'd22c.change.markerAddedNamed' : 'd22c.change.markerAdded', params: { at: when(at), ...(label ? { label } : {}) }, at, kind: 'markers', markerId: m.id, to: at, badge: { key: 'd22c.badge.marker', params: {} } })
    else if (!same({ ...l, time: 0 }, { ...m, time: 0 }) || (!cuts.length && !clipsMoved && Math.abs(l.time - m.time) > EPS)) out.push({ key: 'd22c.change.markerSet', params: { at: when(l.time) }, at: l.time, kind: 'markers', markerId: m.id, to: at, badge: { key: 'd22c.badge.marker', params: {} } })
  }
  for (const l of live.markers ?? []) {
    if ((draft.markers ?? []).some((m) => m.id === l.id) || cuts.some(([a, b]) => l.time >= a - EPS && l.time <= b + EPS)) continue
    out.push({ key: 'd22c.change.markerGone', params: { at: when(l.time) }, at: l.time, kind: 'markers', markerId: l.id, to: l.time, gone: true, badge: { key: 'd22c.badge.gone', params: {} } })
  }

  // The whole film: the subtitles' look, the sounds of transitions, the G lane, the settings.
  if (!same(live.captionStyle, draft.captionStyle) || !same(live.captionStyleShorts, draft.captionStyleShorts)) out.push({ key: 'd22c.change.captionStyle', params: {}, at: 0, kind: 'other', badge: { key: 'd22c.badge.captionStyle', params: {} } })
  if (!same(live.transitionSfx, draft.transitionSfx) || !same(live.risers, draft.risers)) out.push({ key: 'd22c.change.filmSound', params: {}, at: 0, kind: 'other', badge: { key: 'd22c.badge.filmSound', params: {} } })
  const liveT = new Map((live.templates ?? []).map((t) => [t.id, t]))
  let graphics = 0
  let firstGraphic = Infinity
  for (const t of draft.templates ?? []) {
    const l = liveT.get(t.id)
    const moved = !!l && !cuts.length && !clipsMoved && (Math.abs(l.start - t.start) > EPS || Math.abs(l.duration - t.duration) > EPS)
    if (l && !moved && same({ ...l, start: 0, duration: 0 }, { ...t, start: 0, duration: 0 })) continue
    graphics++
    firstGraphic = Math.min(firstGraphic, toLive(t.start, cuts))
  }
  for (const l of live.templates ?? []) {
    if ((draft.templates ?? []).some((t) => t.id === l.id) || cuts.some(([a, b]) => l.start >= a - EPS && l.start + l.duration <= b + EPS)) continue
    graphics++
    firstGraphic = Math.min(firstGraphic, l.start)
  }
  if (graphics) out.push({ key: `d22c.change.graphics.${form(graphics)}`, params: { n: graphics, at: mmss(firstGraphic) }, at: firstGraphic, kind: 'other', to: firstGraphic, markerId: 'g', badge: { key: 'd22c.badge.graphic', params: {} } })
  const other: string[] = []
  if (!same(live.settings, draft.settings)) other.push('settings')
  if (!same(live.backdrop, draft.backdrop) || !same(live.look, draft.look) || !same(live.cameraLook, draft.cameraLook)) other.push('look')
  if (other.length) out.push({ key: other.includes('settings') ? 'd22c.change.settings' : 'd22c.change.filmLook', params: {}, at: 0, kind: 'other', badge: { key: 'd22c.badge.film', params: {} } })
  return out.sort((a, b) => a.at - b.at)
}

/** How many changes the user is told of (a partner's row is not one). */
export const changeCount = (changes: readonly DraftChange[]): number => changes.filter((c) => c.key).length
