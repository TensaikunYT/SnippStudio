// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Subtitles follow the sound they were heard in.
//
// A subtitle's words are moments of a recording: "kılıyorsun" is 1.24 s into
// the voice file, wherever that file sits on the timeline. So when the voice
// clip is moved, trimmed, split, cut out (ripple) or sped up, its subtitles
// and their word times go with it, and the words whose sound was cut away go
// too — no new transcription. Before, captions stayed at their timeline
// seconds and the first edit to the voice left them talking over the wrong
// picture.
//
// How: every project edit goes through the store's `mutate`, which calls
// `followClipEdits(before, after)`. For each subtitle whose own times the edit
// did not touch, the recording under it in BEFORE is found (kept in
// `caption.soundClip` as a hint), each word's timeline time is turned into
// that recording's own time through the clip that played it, and placed again
// through that clip as it is AFTER the edit (or the piece of it a split made).
// Idempotent; undo is the store's snapshot; an edit that moves the captions
// itself (a whole-timeline ripple cut) is left alone. Pure: the tests drive it.

import type { Caption, CaptionWord, Clip, Project } from '../types'
import { flattenClips, instanceOf, isSubtitle, uid } from '../types'
import { localAtMedia, mediaAtLocal } from '../timeline/media-time'
import { hasCurve, sameCurve } from '../timeline/speed-curve'

const EPS = 1e-6
/** How far a subtitle may hang over its clip's edge and still be its. */
const EDGE = 0.25

const speedOf = (c: Clip): number => c.speed ?? 1
// (Forwards or backwards: timeline/media-time.ts, phase Ç2b.1 decision 4.)
const mediaAt = (c: Clip, t: number): number => mediaAtLocal(c, t - c.start)
// (Along a speed curve the curve's own inverse: core polish C.)
const timeAt = (c: Clip, m: number): number => hasCurve(c) ? c.start + localAtMedia(c, m) : (c.reversed ? c.start + c.duration - (m - c.inPoint) / speedOf(c) : c.start + (m - c.inPoint) / speedOf(c))
const holdsMedia = (c: Clip, m: number): boolean => m >= c.inPoint - EPS && m <= c.inPoint + c.duration * speedOf(c) + EPS
const covers = (c: Clip, t: number): boolean => t >= c.start - EPS && t <= c.start + c.duration + EPS

function sameLayout(a: Clip, b: Clip): boolean {
  return a.start === b.start && a.duration === b.duration && a.inPoint === b.inPoint && speedOf(a) === speedOf(b) && a.assetId === b.assetId && sameCurve(a.speedCurve, b.speedCurve)
}

/** True when no clip moved, changed length, speed or media (the usual case:
 *  most edits are to looks or text). */
export function clipsLaidOutSame(prev: Project, next: Project): boolean {
  const a = prev.clips
  const b = next.clips
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const id of ka) {
    const x = a[id]
    const y = b[id]
    if (!y || !sameLayout(x, y)) return false
    if ((x.nested || y.nested) && JSON.stringify(x.nested) !== JSON.stringify(y.nested)) return false
  }
  return true
}

function sameTiming(a: Caption, b: Caption): boolean {
  if (a.start !== b.start || a.end !== b.end) return false
  const wa = a.words ?? []
  const wb = b.words ?? []
  if (wa.length !== wb.length) return false
  for (let i = 0; i < wa.length; i++) if (wa[i].start !== wb[i].start || wa[i].end !== wb[i].end) return false
  return true
}

/** Clips that carry sound a subtitle can belong to. */
function soundClips(p: Project, leaves: Clip[]): Clip[] {
  const assets = new Map(p.assets.map((a) => [a.id, a]))
  return leaves.filter((c) => {
    const a = assets.get(c.assetId)
    return !!a && a.kind !== 'image' && a.hasAudio && !c.audioExtracted && c.freeze === undefined && !c.adjustment
  })
}

/**
 * The sound clip a subtitle belongs to in `p`: one under it, preferring the
 * one it already belonged to, then sound on an audio track (a voice) over a
 * video's own sound, one that holds the whole line, one that is heard, the
 * track the other subtitles already follow, and the higher track.
 *
 * A line whose hint (`soundClip`) names a clip `p` has is the voice of THAT
 * clip's source file (phase Ç2b.1, 4A's K-1): only a piece of that file can
 * be its sound — a cut or a split leaves the hint on one piece while the line
 * lies over another, and the music bed under it (another file) used to win
 * the score, so deleting the voice piece left the line behind. None of that
 * file under it: the line has no sound here (it is left as it is).
 */
function voiceOf(p: Project, sound: Clip[], cap: Caption, trackVotes: Map<string, number>, byId?: ReadonlyMap<string, Clip>): Clip | null {
  const a = cap.start
  const b = Math.max(cap.start, cap.end)
  const mid = (a + b) / 2
  let under = sound.filter((c) => mid >= c.start - EDGE && mid <= c.start + c.duration + EDGE)
  let named = cap.soundClip ? (byId?.get(cap.soundClip) ?? sound.find((c) => c.id === cap.soundClip)) : undefined
  // A video whose sound was extracted after the line was made: its voice is
  // the sound clip linked to it now (Ç2b patch, item 9; the extracted clip
  // may be of another file, the video's own sound is off).
  if (named?.audioExtracted && named.linkId) {
    const link = named.linkId
    const partners = sound.filter((c) => c.linkId === link)
    named = partners.find((c) => mid >= c.start - EDGE && mid <= c.start + c.duration + EDGE) ?? partners[0] ?? named
  }
  if (named) {
    under = under.filter((c) => c.assetId === named.assetId)
    // (The same placement of that file first: its pieces share an instance.)
    const same = under.filter((c) => instanceOf(c) === instanceOf(named))
    if (same.length) under = same
  }
  if (under.length === 0) return null
  const hinted = cap.soundClip ? under.find((c) => c.id === cap.soundClip) : undefined
  if (hinted) return hinted
  const trackIndex = new Map(p.tracks.map((t, i) => [t.id, i]))
  const kindOf = new Map(p.tracks.map((t) => [t.id, t.kind]))
  const score = (c: Clip): number =>
    (kindOf.get(c.trackId) === 'audio' ? 8 : 0) +
    (c.start <= a + EDGE && c.start + c.duration >= b - EDGE ? 4 : 0) +
    (!c.muted && (c.volume > 0 || (c.volumeKeyframes?.length ?? 0) > 0) && !c.disabled ? 2 : 0) +
    (trackVotes.get(c.trackId) ? 1 : 0)
  return [...under].sort((x, y) => score(y) - score(x) || (trackIndex.get(x.trackId) ?? 99) - (trackIndex.get(y.trackId) ?? 99))[0]
}

interface Ctx {
  /** Clips of the voice's recording in BEFORE (a split leaves several). */
  pieces: Clip[]
  voice: Clip
  nextById: Map<string, Clip>
  /** Clips this edit made of the recording (a split's right part, …). */
  born: Clip[]
}

/** The clip that played timeline moment `t` in BEFORE. */
function playedBy(x: Ctx, t: number): Clip {
  return (covers(x.voice, t) ? x.voice : x.pieces.find((c) => covers(c, t))) ?? x.voice
}

/** Where a moment of the recording sits AFTER the edit, or null when its
 *  sound was cut away. `from` is the clip that played it before. */
function placeAfter(x: Ctx, from: Clip, m: number): Clip | null {
  const same = x.nextById.get(from.id)
  if (same && same.assetId === from.assetId && holdsMedia(same, m)) return same
  const piece = x.born.find((c) => holdsMedia(c, m))
  if (piece) return piece
  // Played before and not now: trimmed or cut away (or the clip was deleted).
  if (holdsMedia(from, m)) return null
  // Already hanging over the clip's edge before: carried along with it.
  return same ?? null
}

/**
 * Where a word (or a wordless line) whose middle is at timeline moment `mid`
 * of BEFORE, played by `from`, sits AFTER the edit, on `to`: a function of
 * its timeline moments. A word hanging past the edge of a clip whose clock
 * the edit changed (its speed, its curve, its direction) stays as far past
 * `to`'s edge: its moments are no moments of the clip's media, so carried as
 * such, a word hanging 0.01 s over the end of a 100x clip was a second of
 * media, and back at 0.5x it came back 2 s off the clip (audit patch yama-c,
 * Y1's other half). Otherwise through the media, as always.
 */
function placer(mid: number, from: Clip, to: Clip): (t: number) => number {
  if (to.id === from.id && (speedOf(from) !== speedOf(to) || !sameCurve(from.speedCurve, to.speedCurve) || !!from.reversed !== !!to.reversed)) {
    const end = from.start + from.duration
    if (mid > end + EPS) return (t) => to.start + to.duration + (t - end)
    if (mid < from.start - EPS) return (t) => to.start + (t - from.start)
  }
  return (t) => timeAt(to, mediaAt(from, t))
}

/** The shortest a subtitle line is laid out (on the timeline). */
const FLOOR = 0.05
/** The longest floor any edit gives a line (a cut's rebuilt line: 0.1 s,
 *  timeline/timed-lists.ts). */
const FLOORS_UP_TO = 0.1

/** One subtitle laid out again after its sound changed: one or more pieces
 *  (none when all its sound was cut away).
 *
 *  A line at a floor (its sound played faster than the floor: ≈ 22x for a
 *  1.1 s line) ends later than its sound does, so its end is no moment of the
 *  recording: turned into media and carried, at 1x the floor came back 100
 *  times as long, over the next line and off the clip, and the film ran on to
 *  it (audit patch, Y1). Such a line (no longer than a floor, and ending
 *  after its last word; one without words: no longer than a floor) keeps its
 *  length on the timeline instead, its end made again from its sound: the
 *  last word's end. */
function follow(cap: Caption, x: Ctx): Caption[] {
  const words = cap.words ?? []
  const length = cap.end - cap.start
  const floored = length <= FLOORS_UP_TO + EPS && (words.length === 0 || cap.end > words[words.length - 1].end + EPS)
  const least = floored ? Math.max(FLOOR, length) : FLOOR
  if (words.length === 0) {
    const mid = (cap.start + cap.end) / 2
    const from = playedBy(x, mid)
    const to = placeAfter(x, from, mediaAt(from, mid))
    if (!to) return []
    const at = placer(mid, from, to)
    const start = at(cap.start)
    const end = floored ? start : at(cap.end)
    return [{ ...cap, start, end: Math.max(start + least, end), soundClip: to.id }]
  }
  // Each word through the clip that played it (a split may send the two
  // halves of a line apart).
  const placed: { word: CaptionWord; index: number; to: Clip; was: CaptionWord }[] = []
  let leadIn = cap.start
  let tail = cap.end
  words.forEach((w, index) => {
    const mid = (w.start + w.end) / 2
    const from = playedBy(x, mid)
    const to = placeAfter(x, from, mediaAt(from, mid))
    if (!to) return
    const at = placer(mid, from, to)
    const start = at(w.start)
    const end = at(w.end)
    if (index === 0) leadIn = at(cap.start)
    if (index === words.length - 1) tail = floored ? Math.max(start, end) : at(cap.end)
    placed.push({ word: { ...w, start, end: Math.max(start, end) }, index, to, was: w })
  })
  if (placed.length === 0) return []
  // Runs of words that still sit together (the same gap between them as
  // before): one subtitle each. A split alone keeps the line whole.
  const groups: (typeof placed)[] = []
  for (const p of placed) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    const together =
      !!prev &&
      (prev.to.id === p.to.id ||
        (prev.index === p.index - 1 && Math.abs(p.word.start - prev.word.start - (p.was.start - prev.was.start)) < 1e-4))
    if (together) last.push(p)
    else groups.push([p])
  }
  const whole = groups.length === 1 && placed.length === words.length
  return groups.map((g, k) => {
    const first = g[0]
    const last = g[g.length - 1]
    const start = first.index === 0 ? Math.min(first.word.start, leadIn) : first.word.start
    const end = last.index === words.length - 1 ? Math.max(last.word.end, tail) : last.word.end
    const kept = g.map((p) => p.index)
    const out: Caption = {
      ...cap,
      id: k === 0 ? cap.id : uid(),
      start,
      end: Math.max(start + least, end),
      words: g.map((p) => p.word),
      soundClip: first.to.id
    }
    if (!whole) {
      out.text = g.map((p) => p.word.text.trim()).filter(Boolean).join(' ')
      if (cap.marks) out.marks = cap.marks.map((i) => kept.indexOf(i)).filter((i) => i >= 0)
    }
    return out
  })
}

/** The clips the subtitles are the voice of (the speech: not music, effects
 *  or a B-roll's own sound), by the same choice the subtitles follow edits
 *  with. Phase 4A.8: the filler finder listens only to these. */
export function voiceClipIds(p: Project): Set<string> {
  const leaves = flattenClips(Object.values(p.clips))
  const sound = soundClips(p, leaves)
  const byId = new Map(leaves.map((c) => [c.id, c]))
  const votes = new Map<string, number>()
  for (const c of p.captions) {
    const clip = c.soundClip ? byId.get(c.soundClip) : undefined
    if (clip) votes.set(clip.trackId, (votes.get(clip.trackId) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const cap of p.captions) {
    if (!isSubtitle(cap)) continue
    const v = voiceOf(p, sound, cap, votes, byId)
    if (v) out.add(v.id)
  }
  return out
}

/** How many subtitle lines have their voice on each track (the same choice,
 *  line by line). The track with the most is the one the subtitles are
 *  about: a line or two taken for the music bed do not make the bed the
 *  voice (phase 4A.9: the agent's edits follow that track's content). */
export function voiceTrackVotes(p: Project): Map<string, number> {
  const leaves = flattenClips(Object.values(p.clips))
  const sound = soundClips(p, leaves)
  const byId = new Map(leaves.map((c) => [c.id, c]))
  const hints = new Map<string, number>()
  for (const c of p.captions) {
    const clip = c.soundClip ? byId.get(c.soundClip) : undefined
    if (clip) hints.set(clip.trackId, (hints.get(clip.trackId) ?? 0) + 1)
  }
  const out = new Map<string, number>()
  for (const cap of p.captions) {
    if (!isSubtitle(cap)) continue
    // The clip the line was last made to follow says which track its voice
    // is on, even when the line no longer lies under that clip (a line left
    // behind by an edit lies over the music bed only).
    const v = (cap.soundClip ? byId.get(cap.soundClip) : undefined) ?? voiceOf(p, sound, cap, hints, byId)
    if (v) out.set(v.trackId, (out.get(v.trackId) ?? 0) + 1)
  }
  return out
}

/**
 * Moves the subtitles of every sound clip this edit changed (in place on
 * `next`). `prev` is the project before the edit.
 */
export function followClipEdits(prev: Project, next: Project): void {
  if (!next.captions.some(isSubtitle)) return
  if (clipsLaidOutSame(prev, next)) return
  const prevLeaves = flattenClips(Object.values(prev.clips))
  const nextLeaves = flattenClips(Object.values(next.clips))
  const prevById = new Map(prevLeaves.map((c) => [c.id, c]))
  const nextById = new Map(nextLeaves.map((c) => [c.id, c]))
  // The clips this edit touched: changed or gone; and the new ones.
  const changed = new Set(
    prevLeaves.filter((c) => {
      const n = nextById.get(c.id)
      return !n || !sameLayout(c, n)
    }).map((c) => c.id)
  )
  const added = nextLeaves.filter((c) => !prevById.has(c.id))
  if (changed.size === 0 && added.length === 0) return
  const sound = soundClips(prev, prevLeaves)
  const prevCaps = new Map(prev.captions.map((c) => [c.id, c]))
  const votes = new Map<string, number>()
  for (const c of prev.captions) {
    const clip = c.soundClip ? prevById.get(c.soundClip) : undefined
    if (clip) votes.set(clip.trackId, (votes.get(clip.trackId) ?? 0) + 1)
  }
  // (The touched clips as they were, once: a trim's every step went through
  // every clip for every subtitle, 300 x 600 on a heavy project; phase 3c.T.)
  const changedBefore = prevLeaves.filter((c) => changed.has(c.id))
  let touched = false
  const out: Caption[] = []
  for (const cap of next.captions) {
    // Only a subtitle over a clip this edit touched can have to move. (Asked
    // first, as it is the cheaper question; either way a line that is left
    // goes out as it is.)
    const lo = cap.start - EDGE
    const hi = Math.max(cap.start, cap.end) + EDGE
    if (!changedBefore.some((c) => c.start < hi && c.start + c.duration > lo)) {
      out.push(cap)
      continue
    }
    const before = prevCaps.get(cap.id)
    // Not a subtitle, new, or moved by the edit itself: as it is.
    if (!isSubtitle(cap) || !before || !sameTiming(before, cap)) {
      out.push(cap)
      continue
    }
    const voice = voiceOf(prev, sound, cap, votes, prevById)
    if (!voice) {
      out.push(cap)
      continue
    }
    const pieces = sound.filter((c) => c.assetId === voice.assetId && c.start < hi && c.start + c.duration > lo)
    const born = added.filter((c) => c.assetId === voice.assetId)
    // None of the clips playing it changed (another clip under it did).
    if (born.length === 0 && pieces.every((c) => !changed.has(c.id))) {
      if (cap.soundClip !== voice.id) {
        out.push({ ...cap, soundClip: voice.id })
        touched = true
      } else out.push(cap)
      continue
    }
    touched = true
    out.push(...follow(cap, { pieces, voice, nextById, born }))
  }
  // A hint left on a clip this edit removed (a cut took the piece, a
  // delete): the line's file is known from BEFORE, so it is pointed at the
  // piece of that file under it now — never left naming nothing, where the
  // next edit would have to guess its sound (K-1).
  for (let i = 0; i < out.length; i++) {
    const cap = out[i]
    if (!isSubtitle(cap) || !cap.soundClip || nextById.has(cap.soundClip)) continue
    const was = prevById.get(cap.soundClip)
    if (!was) continue
    const mid = (cap.start + Math.max(cap.start, cap.end)) / 2
    const now = nextLeaves.filter((c) => c.assetId === was.assetId && mid >= c.start - EDGE && mid <= c.start + c.duration + EDGE)
      .sort((x, y) => Number(instanceOf(y) === instanceOf(was)) - Number(instanceOf(x) === instanceOf(was)))[0]
    if (now) {
      out[i] = { ...cap, soundClip: now.id }
      touched = true
    }
  }
  if (!touched) return
  // The subtitles back in time order among themselves; text layers and
  // shapes keep their places (their order is their stacking).
  const slots: number[] = []
  out.forEach((c, i) => {
    if (isSubtitle(c)) slots.push(i)
  })
  const subs = slots.map((i) => out[i]).sort((a, b) => a.start - b.start)
  slots.forEach((slot, k) => (out[slot] = subs[k]))
  next.captions = out
}

/**
 * Subtitles worked out on project `from` (a transcription takes minutes, read
 * from the timeline as it was when it started), placed onto `to` (the project
 * as it is now): where the voice clips were moved, trimmed, cut or sped up in
 * the meantime, the lines go with their words, as they would have if they had
 * been there during those edits; words whose sound was cut away go too.
 */
export function carryCaptionsAcross(from: Project, to: Project, caps: Caption[]): Caption[] {
  if (from === to || caps.length === 0) return caps
  const before: Project = { ...from, captions: [...caps] }
  const after: Project = { ...to, captions: [...caps] }
  followClipEdits(before, after)
  return after.captions
}
