// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The project's invariants in one pure function (SnippStudio phase Ã‡2a.1,
// report D4). Every command keeps them by itself; this says, after the fact,
// whether it did. Tests run it after every command and every random sequence
// step; a development build runs it after every edit (state/store.ts).
//
// It never changes the project. `repairProject` (model/repair.ts) is the one
// that mends a damaged file on open.
import type { Clip, Project } from '../types'
import { curveProblem } from '../timeline/speed-curve'

export interface Problem {
  /** What kind of rule is broken (stable: tests and the repair report key on it). */
  code:
    | 'shape'
    | 'track-clip-missing'
    | 'track-clip-elsewhere'
    | 'clip-not-on-track'
    | 'clip-on-two-tracks'
    | 'clip-key'
    | 'track-unsorted'
    | 'track-overlap'
    | 'duplicate-id'
    | 'missing-asset'
    | 'missing-track'
    | 'missing-tracker'
    | 'missing-group-clip'
    | 'bad-time'
    | 'outside-media'
    | 'link-alone'
    | 'keys-unsorted'
    | 'bad-key'
  /** Where: an id or a path such as `clip ab12.channels.x`. */
  where: string
  detail: string
  /** The clips it is about, when there are two (an overlap, an order). */
  clips?: [string, string]
}

/** Two clips on one track overlap by more than this (seconds): float noise
 *  from a sum of starts and durations is not an overlap. */
export const OVERLAP_EPS = 1e-6
/** A clip's source window may pass its media's end by this much (seconds):
 *  `inPoint + duration * speed` is a product of rounded numbers. */
export const MEDIA_EPS = 1e-3

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Every rule of the model that `p` breaks (empty: none). */
export function checkProject(p: Project): Problem[] {
  const out: Problem[] = []
  const say = (code: Problem['code'], where: string, detail: string, clips?: [string, string]): void => void out.push({ code, where, detail, ...(clips ? { clips } : {}) })
  // The shape first: without these, nothing below can be read.
  if (!p || typeof p !== 'object') return [{ code: 'shape', where: 'project', detail: 'not an object' }]
  if (!Array.isArray(p.tracks)) say('shape', 'tracks', 'not a list')
  if (!p.clips || typeof p.clips !== 'object' || Array.isArray(p.clips)) say('shape', 'clips', 'not a map')
  if (!Array.isArray(p.assets)) say('shape', 'assets', 'not a list')
  if (!Array.isArray(p.captions)) say('shape', 'captions', 'not a list')
  if (!p.settings || !finite(p.settings.width) || !finite(p.settings.height) || !finite(p.settings.fps) || p.settings.width <= 0 || p.settings.height <= 0 || p.settings.fps <= 0) say('shape', 'settings', 'width, height and fps must be numbers above 0')
  if (out.length) return out
  for (const t of p.tracks) if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !Array.isArray(t.clipIds) || (t.kind !== 'video' && t.kind !== 'audio')) say('shape', `track ${String(t?.id)}`, 'a track needs an id, a kind and a clip list')
  for (const [key, c] of Object.entries(p.clips)) if (!c || typeof c !== 'object' || typeof c.id !== 'string') say('shape', `clip ${key}`, 'not a clip')
  for (const a of p.assets) if (!a || typeof a !== 'object' || typeof a.id !== 'string') say('shape', 'asset', 'not an asset')
  for (const c of p.captions) if (!c || typeof c !== 'object' || typeof c.id !== 'string') say('shape', 'caption', 'not a caption')
  if (out.length) return out

  // -- ids: unique at every depth ------------------------------------------
  const unique = (kind: string, ids: string[]): void => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) say('duplicate-id', `${kind} ${id}`, `two ${kind}s have this id`)
      seen.add(id)
    }
  }
  unique('track', p.tracks.map((t) => t.id))
  unique('asset', p.assets.map((a) => a.id))
  unique('caption', p.captions.map((c) => c.id))
  unique('template', (p.templates ?? []).map((t) => t.id))
  unique('marker', (p.markers ?? []).map((m) => m.id))
  unique('tracker', (p.trackers ?? []).map((t) => t.id))
  const allClips: { clip: Clip; where: string; nestedIn?: Clip }[] = []
  const walk = (clips: Clip[], parent: Clip | undefined, depth: number): void => {
    for (const c of clips) {
      allClips.push({ clip: c, where: parent ? `clip ${parent.id} > ${c.id}` : `clip ${c.id}`, ...(parent ? { nestedIn: parent } : {}) })
      if (c.nested && Array.isArray(c.nested.clips) && depth < 8) walk(c.nested.clips, c, depth + 1)
    }
  }
  walk(Object.values(p.clips), undefined, 0)
  unique('clip', allClips.map((x) => x.clip.id))

  // -- tracks â‡” clips -----------------------------------------------------------
  const trackIds = new Set(p.tracks.map((t) => t.id))
  const onTrack = new Map<string, string>()
  for (const t of p.tracks) {
    for (const id of t.clipIds) {
      const c = p.clips[id]
      if (!c) {
        say('track-clip-missing', `track ${t.id}`, `lists clip ${id}, which does not exist`)
        continue
      }
      if (onTrack.has(id)) say('clip-on-two-tracks', `clip ${id}`, `listed on ${onTrack.get(id)} and ${t.id}`)
      else onTrack.set(id, t.id)
      if (c.trackId !== t.id) say('track-clip-elsewhere', `clip ${id}`, `listed on ${t.id} but says it is on ${c.trackId}`)
    }
    const listed = t.clipIds.map((id) => p.clips[id]).filter((c): c is Clip => !!c && finite(c.start) && finite(c.duration))
    for (let i = 1; i < listed.length; i++) {
      const a = listed[i - 1]
      const b = listed[i]
      if (b.start < a.start - OVERLAP_EPS) say('track-unsorted', `track ${t.id}`, `${b.id} (at ${b.start}) is listed after ${a.id} (at ${a.start})`, [a.id, b.id])
      else if (a.start + a.duration > b.start + OVERLAP_EPS) say('track-overlap', `track ${t.id}`, `${a.id} [${a.start}, ${a.start + a.duration}) overlaps ${b.id} at ${b.start}`, [a.id, b.id])
    }
  }
  for (const [key, c] of Object.entries(p.clips)) {
    if (key !== c.id) say('clip-key', `clip ${key}`, `stored under ${key} but its id is ${c.id}`)
    if (!trackIds.has(c.trackId)) say('missing-track', `clip ${c.id}`, `its track ${c.trackId} does not exist`)
    else if (!onTrack.has(c.id)) say('clip-not-on-track', `clip ${c.id}`, `not listed on its track ${c.trackId}`)
  }

  // -- references -----------------------------------------------------------------
  const assets = new Map(p.assets.map((a) => [a.id, a]))
  const trackers = new Set((p.trackers ?? []).map((t) => t.id))
  for (const { clip: c, where } of allClips) {
    // A compound, an adjustment layer and automation's empty slot carry no media.
    const noMedia = !!c.nested || !!c.adjustment || !!c.automationMissing
    if (!noMedia && !assets.has(c.assetId)) say('missing-asset', where, `its asset ${c.assetId} does not exist`)
    if (c.trackerId && !trackers.has(c.trackerId)) say('missing-tracker', where, `follows tracker ${c.trackerId}, which does not exist`)
  }
  for (const g of p.groups ?? []) for (const id of g.clipIds) if (!p.clips[id]) say('missing-group-clip', `group ${g.id}`, `lists clip ${id}, which does not exist`)

  // -- times ------------------------------------------------------------------------
  for (const { clip: c, where, nestedIn } of allClips) {
    if (!finite(c.start) || (!nestedIn && c.start < 0)) say('bad-time', where, `start ${c.start}`)
    if (!finite(c.duration) || c.duration <= 0) say('bad-time', where, `duration ${c.duration}`)
    if (!finite(c.inPoint) || c.inPoint < -MEDIA_EPS) say('bad-time', where, `in point ${c.inPoint}`)
    if (c.speed !== undefined && (!finite(c.speed) || c.speed <= 0)) say('bad-time', where, `speed ${c.speed}`)
    // A speed curve (core polish C): its points in order, its speeds > 0.
    if (c.speedCurve !== undefined) { const bad = curveProblem(c.speedCurve); if (bad) say('bad-time', where, `speed curve: ${bad}`) }
    // The source window inside the media (a still has none; a compound's is
    // its children's; a freeze shows one frame).
    const a = assets.get(c.assetId)
    if (a && !c.nested && (a.kind === 'video' || a.kind === 'audio') && finite(a.duration) && a.duration > 0 && finite(c.inPoint) && finite(c.duration)) {
      if (c.freeze !== undefined) {
        if (!finite(c.freeze) || c.freeze < -MEDIA_EPS || c.freeze > a.duration + MEDIA_EPS) say('outside-media', where, `freezes ${c.freeze} s of a ${a.duration} s file`)
      } else {
        const end = c.inPoint + c.duration * (c.speed ?? 1)
        if (end > a.duration + MEDIA_EPS) say('outside-media', where, `plays to ${end} s of a ${a.duration} s file`)
      }
    }
  }
  for (const c of p.captions) if (!finite(c.start) || !finite(c.end) || c.end < c.start) say('bad-time', `caption ${c.id}`, `[${c.start}, ${c.end}]`)
  for (const t of p.templates ?? []) if (!finite(t.start) || !finite(t.duration) || t.duration <= 0) say('bad-time', `template ${t.id}`, `start ${t.start}, duration ${t.duration}`)

  // -- links: a link joins two clips or more -------------------------------------------
  const links = new Map<string, number>()
  for (const c of Object.values(p.clips)) if (c.linkId) links.set(c.linkId, (links.get(c.linkId) ?? 0) + 1)
  for (const [id, n] of links) if (n < 2) say('link-alone', `link ${id}`, 'only one clip carries this link')

  // -- keys: sorted, finite ---------------------------------------------------------------
  const keys = (where: string, list: { time: number }[] | undefined, value?: (k: never) => unknown[]): void => {
    if (!list) return
    if (!Array.isArray(list)) return say('bad-key', where, 'not a list')
    let last = -Infinity
    for (const k of list) {
      if (!k || !finite(k.time)) {
        say('bad-key', where, `time ${k?.time}`)
        continue
      }
      if (value && !value(k as never).every(finite)) say('bad-key', where, `a value at ${k.time} is not a number`)
      if (k.time < last) say('keys-unsorted', where, `${k.time} after ${last}`)
      last = Math.max(last, k.time)
    }
  }
  for (const { clip: c, where } of allClips) {
    for (const [ch, list] of Object.entries(c.channels ?? {})) keys(`${where}.channels.${ch}`, list, (k: { value: unknown }) => [k.value])
    for (const [key, list] of Object.entries(c.fxKeys ?? {})) keys(`${where}.fxKeys.${key}`, list, (k: { value: unknown }) => [k.value])
    keys(`${where}.volumeKeyframes`, c.volumeKeyframes, (k: { value: unknown }) => [k.value])
    keys(`${where}.mask.keyframes`, c.mask?.keyframes)
  }
  for (const c of p.captions) keys(`caption ${c.id}.kfs`, c.kfs)
  keys('shorts.keyframes', p.shorts?.keyframes)
  for (const s of p.shortSegments ?? []) keys(`short ${s.id}.keyframes`, s.keyframes)
  for (const t of p.trackers ?? []) keys(`tracker ${t.id}.keyframes`, t.keyframes)
  return out
}

/** One line per problem, for an assertion message or a log. */
export const describeProblems = (list: readonly Problem[]): string => list.map((x) => `${x.code} Â· ${x.where} Â· ${x.detail}`).join('\n')

/** The problems of `after` that `before` did not have: what an edit broke. */
export function newProblems(before: Project, after: Project): Problem[] {
  const had = new Set(checkProject(before).map((x) => `${x.code}|${x.where}`))
  return checkProject(after).filter((x) => !had.has(`${x.code}|${x.where}`))
}
