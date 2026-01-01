// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The one register of the project's timeline-timed lists (phase Ç2c.2,
// decision 3; report D8, K10, K11, K16, K17, K18).
//
// A whole-timeline cut (`rippleRange` with no track scope: ripple delete,
// Q / W, the cut marks, the silence cut, the agent's cuts) and time put in
// (`insertTimeElsewhere`: the freeze frame) must move every list that holds
// timeline times with the footage. Each path used to name the lists it knew
// by hand, and each forgot some: the motion trackers moved with nothing (a
// title riding one drifted off the object after a silence cut), a title's
// keys did not follow its start, a map's camera keys did not follow its
// block, the Shorts pan stayed put on a freeze. Now both paths walk this one
// list. `src/test/c2c2-register.test.ts` reads the Project type and fails
// when a timed field is in no entry here (nor in the clip pass, nor in the
// list of numbers that are not timeline times).
//
// Times in a list that is relative to its own span (a caption's keys, a
// template's camera keys and box times) follow the content they sit on: a
// key the cut takes the time of is kept off its span where the span lost
// that side (before its new start, after its new end, as a clip keeps its
// keys: phase Ç2c.1) and dropped only when the cut went through the middle.
// Absolute lists (markers, trackers, the Shorts pan) lose what lay inside the
// cut. Pure.

import type { Caption, Project } from '../types'
import { isSubtitle } from '../types'
import { shiftNotesForCut, shiftNotesForInsert } from '../notes/follow'
import { rippleTemplates } from '../templates/model'
import { cutShift, cutSpanKey } from './cut-shift'

export { cutShift, cutSpanKey }

export interface TimedList {
  /** What it is. */
  name: string
  /** The Project fields it moves (the register test's names: `.` for a
   *  field, `[]` for a list, `{}` for a map). */
  fields: readonly string[]
  /** [a, b] taken out of the whole timeline (the rest moves up by b − a). */
  cut(p: Project, a: number, b: number): void
  /** `hold` seconds put in at `t` (what is after it moves on). */
  insert(p: Project, t: number, hold: number): void
}

/** A caption's keys after [a, b] went (its start was `was`, now `c.start`). */
function cutCaptionKeys(c: Caption, was: { start: number; end: number }, a: number, b: number): Caption {
  if (!c.kfs || c.kfs.length === 0) return c
  const kfs = c.kfs.flatMap((k) => {
    const time = cutSpanKey(k.time, was, c.start, a, b)
    return time === null ? [] : [{ ...k, time }]
  })
  const out = { ...c }
  if (kfs.length > 0) out.kfs = kfs
  else delete out.kfs
  return out
}

/**
 * The captions with [a, b] taken out of the timeline: those inside go, those
 * after move up, and a line the cut runs through loses the words inside it
 * (its text and timing rebuilt from the rest). Word times move with their
 * lines: left behind, word pop-ups and karaoke fired late, and the next voice
 * edit re-placed the lines from the stale times. A line's motion keys follow
 * what they sit on (report K11: a cut through a title moved its start and
 * left its keys counted from the old one).
 */
export function rippleCaptions(p: Project, a: number, b: number): void {
  const shift = cutShift(a, b)
  p.captions = p.captions.flatMap((c) => {
    if (c.start >= a && c.end <= b) return []
    const was = { start: c.start, end: c.end }
    if (c.words && c.words.length > 0 && c.start < b && c.end > a) {
      // Partially cut caption with word timing: drop the removed words and
      // rebuild the line's text/timing from the survivors.
      const keep = (w: { start: number; end: number }): boolean => (w.start + w.end) / 2 <= a || (w.start + w.end) / 2 >= b
      const survivors = c.words.filter(keep)
      if (survivors.length === 0) return []
      // Key words are word indices: the ones kept move to their new places
      // (word order is an address since phase 2A.3).
      const kept = c.words.map((w, i) => (keep(w) ? i : -1)).filter((i) => i >= 0)
      const remap = (list: number[] | undefined): number[] | undefined => list?.map((i) => kept.indexOf(i)).filter((i) => i >= 0)
      const marks = remap(c.marks)
      const marker = c.style?.marker?.words ? { ...c.style.marker, words: remap(c.style.marker.words)! } : undefined
      const words = survivors.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }))
      const start = Math.min(...words.map((w) => w.start))
      const end = Math.max(start + 0.1, ...words.map((w) => w.end))
      const text = survivors.map((w) => w.text.trim()).filter(Boolean).join(' ')
      return [cutCaptionKeys({ ...c, start, end, words, text, ...(marks ? { marks } : {}), ...(marker && c.style ? { style: { ...c.style, marker } } : {}) }, was, a, b)]
    }
    const start = shift(c.start)
    const words = c.words?.map((w) => ({ ...w, start: shift(w.start), end: shift(w.end) }))
    // A line wholly before or after the cut keeps its keys as they are, and
    // its length: a line shorter than the floor (its sound at a high speed)
    // grown to it here ended after its sound, and the next voice edit carried
    // that end as a moment of the recording (audit patch yama-c, Y1).
    const outside = c.end <= a || c.start >= b
    const moved = { ...c, start, end: outside ? shift(c.end) : Math.max(start + 0.1, shift(c.end)), ...(words ? { words } : {}) }
    return [outside ? moved : cutCaptionKeys(moved, was, a, b)]
  })
}

/** Keys of an absolute (timeline-time) list after [a, b] went: those inside
 *  go, those after move up. */
function cutAbsolute<K extends { time: number }>(keys: readonly K[], a: number, b: number): K[] {
  const shift = cutShift(a, b)
  return keys.filter((k) => !(k.time > a && k.time < b)).map((k) => ({ ...k, time: shift(k.time) }))
}

/** …and after `hold` seconds were put in at t. */
function insertAbsolute<K extends { time: number }>(keys: readonly K[], t: number, hold: number): K[] {
  return keys.map((k) => (k.time >= t ? { ...k, time: k.time + hold } : k))
}

/**
 * The captions after `hold` seconds were put in at t. Subtitles follow their
 * voice clip (subtitles/follow.ts, after every edit). Every other line — a
 * title, a shape — moves on when it starts at or after t, and one running
 * through t is held as long, its words and keys after t moving on with what
 * they were timed to (Ç2c patch, item 4: it stayed behind while the
 * footage, the markers and the trackers moved; as a still is, report K18).
 */
function insertCaptions(p: Project, t: number, hold: number): void {
  if (!(hold > 0)) return
  const later = (x: number): number => (x >= t ? x + hold : x)
  p.captions = p.captions.map((c) => {
    if (isSubtitle(c) || c.end <= t) return c
    const words = c.words?.map((w) => ({ ...w, start: later(w.start), end: later(w.end) }))
    if (c.start >= t) return { ...c, start: c.start + hold, end: c.end + hold, ...(words ? { words } : {}) }
    const at = t - c.start
    const kfs = c.kfs?.map((k) => (k.time > at ? { ...k, time: k.time + hold } : k))
    return { ...c, end: c.end + hold, ...(words ? { words } : {}), ...(kfs ? { kfs } : {}) }
  })
}

/** The template blocks after `hold` seconds were put in at t: a block after
 *  t moves on (its own seconds go with it); one running through t is held
 *  as long, its camera keys, box times and exit after t moving on (Ç2c
 *  patch, item 4: they stayed, so the camera ran ahead of the footage). */
function insertTemplates(p: Project, t: number, hold: number): void {
  if (!p.templates || !(hold > 0)) return
  p.templates = p.templates.map((tb) => {
    if (tb.start >= t) return { ...tb, start: tb.start + hold }
    if (tb.start + tb.duration <= t) return tb
    const at = t - tb.start
    const out = { ...tb, duration: tb.duration + hold }
    if (tb.cams) out.cams = tb.cams.map((k) => (k.t > at ? { ...k, t: k.t + hold } : k))
    if (tb.items.some((it) => it.at !== undefined && it.at > at)) out.items = tb.items.map((it) => (it.at !== undefined && it.at > at ? { ...it, at: it.at + hold } : it))
    if (tb.cut !== undefined && tb.cut > at) out.cut = tb.cut + hold
    return out
  })
}

/** The register. */
export const TIMED_LISTS: readonly TimedList[] = [
  {
    name: 'captions (subtitles, titles, shapes: their times, word times and motion keys)',
    fields: ['captions[].start', 'captions[].end', 'captions[].words[].start', 'captions[].words[].end', 'captions[].kfs[].time'],
    cut: rippleCaptions,
    insert: insertCaptions
  },
  {
    name: 'markers',
    fields: ['markers[].time'],
    cut(p, a, b) {
      // Leaving them behind meant every ripple delete slid them off the
      // moment they marked.
      if (!p.markers) return
      p.markers = cutAbsolute(p.markers, a, b)
      if (p.markers.length === 0) delete p.markers
    },
    insert(p, t, hold) {
      if (p.markers) p.markers = insertAbsolute(p.markers, t, hold)
    }
  },
  {
    name: 'work notes',
    fields: ['notes[].start', 'notes[].end', 'notes[].at'],
    // One inside the cut stays, as a single frame at the join (notes/follow.ts).
    cut: shiftNotesForCut,
    insert: shiftNotesForInsert
  },
  {
    name: 'Shorts bands and the Shorts pan',
    fields: ['shortSegments[].start', 'shortSegments[].end', 'shortSegments[].keyframes[].time', 'shorts.keyframes[].time'],
    cut(p, a, b) {
      const shift = cutShift(a, b)
      if (p.shortSegments) {
        p.shortSegments = p.shortSegments
          // A band whose whole span was removed has nothing left to mark.
          .filter((s) => !(s.start >= a && s.end <= b))
          .map((s) => {
            const start = shift(s.start)
            // Pan keyframes are absolute timeline times.
            return { ...s, start, end: Math.max(start + 0.5, shift(s.end)), keyframes: cutAbsolute(s.keyframes ?? [], a, b) }
          })
        if (p.shortSegments.length === 0) delete p.shortSegments
      }
      if (p.shorts?.keyframes) p.shorts.keyframes = cutAbsolute(p.shorts.keyframes, a, b)
    },
    insert(p, t, hold) {
      if (p.shortSegments) {
        p.shortSegments = p.shortSegments.map((seg) => ({
          ...seg,
          start: seg.start >= t ? seg.start + hold : seg.start,
          end: seg.end > t ? seg.end + hold : seg.end,
          ...(seg.keyframes ? { keyframes: insertAbsolute(seg.keyframes, t, hold) } : {})
        }))
      }
      // (The project's own pan stayed put: the window panned to the
      // picture before the hold.)
      if (p.shorts?.keyframes) p.shorts.keyframes = insertAbsolute(p.shorts.keyframes, t, hold)
    }
  },
  {
    name: 'motion trackers',
    fields: ['trackers[].keyframes[].time'],
    // Report K10: a tracker's path (timeline times) moved with nothing, so a
    // title riding it drifted off the object after a cut or a freeze frame.
    // A tracker keeps one key at least: one whose every key the cut took
    // keeps the last of them, at the join.
    cut(p, a, b) {
      if (!p.trackers) return
      p.trackers = p.trackers.map((trk) => {
        const keys = cutAbsolute(trk.keyframes, a, b)
        if (keys.length > 0) return { ...trk, keyframes: keys }
        const last = trk.keyframes[trk.keyframes.length - 1]
        return { ...trk, keyframes: last ? [{ ...last, time: a }] : [] }
      })
    },
    insert(p, t, hold) {
      if (p.trackers) p.trackers = p.trackers.map((trk) => ({ ...trk, keyframes: insertAbsolute(trk.keyframes, t, hold) }))
    }
  },
  {
    name: 'templates (their places, camera keys and box times)',
    fields: ['templates[].start', 'templates[].cams[].t', 'templates[].items[].at', 'templates[].cut'],
    cut: rippleTemplates,
    insert: insertTemplates
  }
]

/**
 * The clips' timed fields: moved by the clip pass of the cut and of the
 * insert (commands/ops/ripple.ts), their clip-local keys by the window
 * (timeline/slice.ts).
 */
export const CLIP_FIELDS: readonly string[] = [
  'clips{}.start',
  'clips{}.channels.x[].time',
  'clips{}.channels.y[].time',
  'clips{}.channels.scale[].time',
  'clips{}.channels.rotation[].time',
  'clips{}.channels.opacity[].time',
  // ("cila" part D: the keys on the effect amounts, moved as the channels' are.)
  'clips{}.fxKeys.bloom[].time',
  'clips{}.fxKeys.halation[].time',
  'clips{}.fxKeys.mosaic[].time',
  'clips{}.fxKeys.isolate[].time',
  'clips{}.volumeKeyframes[].time',
  'clips{}.autoDucking.originalVolumeKeyframes[].time',
  'clips{}.mask.keyframes[].time',
  'clips{}.moves.actions[].time'
]

/** Numbers named like times that are no timeline times, and why. */
export const NOT_TIMELINE: Readonly<Record<string, string>> = {
  'clips{}.crop.t': 'the crop from the top (0..1 of the picture)',
  'notes[].clip.from': "seconds of the source of the clip a note sits on (the note rides the clip: notes/follow.ts)",
  'notes[].clip.to': "seconds of the source of the clip a note sits on (the note rides the clip: notes/follow.ts)",
  'templates[].clock.start': "the video player template's own clock (what its display counts from)"
}

/** [a, b] taken out of the whole timeline: every list of the register. */
export function cutTimedLists(p: Project, a: number, b: number): void {
  for (const list of TIMED_LISTS) list.cut(p, a, b)
}

/** `hold` seconds put in at t: every list of the register. */
export function insertTimedLists(p: Project, t: number, hold: number): void {
  for (const list of TIMED_LISTS) list.insert(p, t, hold)
}
