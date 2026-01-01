// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Mends a project read from a file (phase Ç2a.1, report P8 / D4.2) so that
// it keeps the model's rules (model/check.ts), and says what it changed.
//
// Project files come from other programs too (a film tool, an agent, the
// inbox), so a damaged one is expected input. The rule is: keep the user's
// work wherever its meaning is clear, drop only what cannot be placed or
// shown, and never touch a sound file (read → repair → write gives the file
// back as it was).
//
// `repairShape` runs first, on the raw object (the lists and the settings
// everything else reads); `repairProject` after the format conversions and
// the defaults, on the structure.
import type { Asset, Clip, Project, Track } from '../types'
import { CLIP_LABELS, FX_KEYS, defaultCaptionStyle, defaultProject, uid } from '../types'
import { MEDIA_EPS, OVERLAP_EPS } from './check'
import { EPS } from '../timeline/eps'
import { curveProblem } from '../timeline/speed-curve'
import { dropLoneLinks } from '../commands/ops/base'
import { cleanEdits } from '../../../shared/codeval/edits'
import { PROJECT_LIMITS } from './limits'

/** What a repair changed: a kind and how many times. */
export interface RepairNote {
  code:
    | 'shape'
    | 'settings'
    | 'clip-time'
    | 'clip-dropped-time'
    | 'clip-dropped-asset'
    | 'track-made'
    | 'track-list'
    | 'duplicate-id'
    | 'overlap'
    | 'media-end'
    | 'link'
    | 'reference'
    | 'keys'
    | 'caption-dropped'
    | 'note-dropped'
    | 'template-unknown'
    | 'template-dropped'
    | 'uid'
    | 'limits'
    | 'look'
  count: number
}

/**
 * The most a project holds (security patch, item 9; S4). A project file is
 * input from anywhere: one that says its canvas is 1e9 pixels wide, runs at
 * 1e9 frames a second or holds a clip 1e308 seconds long would have the
 * preview and the export ask for a canvas, a frame count or a loop no
 * computer has. Such a value is brought back to the limit and the user is
 * told ('limits'). The limits lie far outside any real project: a side of
 * 16…8192 pixels (8K is 7680), 1…240 frames a second, 100 hours on the
 * timeline, a clip speed of 0.01…10 000. (The commands offer 0.1…100, but
 * taking a compound apart multiplies a child's speed by the compound's: a
 * 20x child of a 10x compound plays at 200x, a legitimate clip the repair
 * used to slow to 100x, showing half its media, on every open, recovery and
 * restore point; audit patch yama-c, O1. The square of the commands' range
 * holds whatever two of them make.)
 */
export { PROJECT_LIMITS } from './limits'

export class Repairs {
  private readonly counts = new Map<RepairNote['code'], number>()
  add(code: RepairNote['code'], n = 1): void {
    if (n > 0) this.counts.set(code, (this.counts.get(code) ?? 0) + n)
  }
  list(): RepairNote[] {
    return [...this.counts].map(([code, count]) => ({ code, count }))
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const within = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** The lists and settings everything reads: a list that is missing or not a
 *  list becomes an empty one; unreadable settings take the defaults. */
export function repairShape(raw: Record<string, unknown>, fixed: Repairs): void {
  const d = defaultProject()
  if (!Array.isArray(raw.tracks)) {
    if (raw.tracks !== undefined || isObj(raw.clips)) fixed.add('shape')
    raw.tracks = []
  }
  if (Array.isArray(raw.clips)) {
    // A list of clips (another program's way) is a map by id.
    const map: Record<string, unknown> = {}
    for (const c of raw.clips) if (isObj(c) && typeof c.id === 'string') map[c.id] = c
    raw.clips = map
    fixed.add('shape')
  } else if (!isObj(raw.clips)) {
    if (raw.clips !== undefined) fixed.add('shape')
    raw.clips = {}
  }
  for (const key of ['assets', 'captions'] as const) {
    if (!Array.isArray(raw[key])) {
      if (raw[key] !== undefined) fixed.add('shape')
      raw[key] = []
    }
  }
  for (const key of ['markers', 'groups', 'trackers', 'shortSegments', 'notes', 'templates'] as const) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) {
      delete raw[key]
      fixed.add('shape')
    }
  }
  if (!isObj(raw.captionStyle)) {
    if (raw.captionStyle !== undefined) fixed.add('shape')
    raw.captionStyle = defaultCaptionStyle()
  }
  if (raw.captionStyleShorts !== undefined && !isObj(raw.captionStyleShorts)) {
    delete raw.captionStyleShorts
    fixed.add('shape')
  }
  if (!isObj(raw.snap)) {
    if (raw.snap !== undefined) fixed.add('shape')
    raw.snap = { ...d.snap }
  }
  if (typeof raw.name !== 'string') raw.name = d.name
  const s = isObj(raw.settings) ? raw.settings : {}
  const good = (v: unknown): v is number => finite(v) && v > 0
  if (!good(s.width) || !good(s.height) || !good(s.fps)) {
    raw.settings = { width: good(s.width) ? s.width : d.settings.width, height: good(s.height) ? s.height : d.settings.height, fps: good(s.fps) ? s.fps : d.settings.fps }
    fixed.add('settings')
  }
  // A readable size or rate beyond what a project can hold: the limit
  // (security patch, item 9; PROJECT_LIMITS above).
  {
    const L = PROJECT_LIMITS
    const st = raw.settings as { width: number; height: number; fps: number }
    const held = { width: within(st.width, L.minSide, L.maxSide), height: within(st.height, L.minSide, L.maxSide), fps: within(st.fps, L.minFps, L.maxFps) }
    const n = (held.width !== st.width ? 1 : 0) + (held.height !== st.height ? 1 : 0) + (held.fps !== st.fps ? 1 : 0)
    if (n) {
      raw.settings = { ...st, ...held }
      fixed.add('limits', n)
    }
  }
  if (raw.mode !== 'frame' && raw.mode !== 'shorts' && raw.mode !== 'canvas') {
    raw.mode = 'frame'
    fixed.add('shape')
  }
}

/** The structure: clips, tracks, ids, references, times, keys. Returns what
 *  it changed (nothing for a sound project). */
export interface RepairOptions {
  /** An asset whose stored duration is not to be trusted (its file changed
   *  on disk since: phase Ç2a.2, decision 2). Its clips are not shortened to
   *  that duration; the file is read again after the open. */
  untrustedDuration?: (a: Asset) => boolean
}

/** A text style's `italic` is a boolean or is not there (a file may say
 *  "yes", 1 or null: no slant can be read from that, the text stands upright).
 *  True when it took the field off. */
function uprightUnlessBoolean(style: unknown): boolean {
  if (!isObj(style) || !('italic' in style) || typeof style.italic === 'boolean') return false
  delete style.italic
  return true
}

export function repairProject(p: Project, fixed = new Repairs(), opts: RepairOptions = {}): RepairNote[] {
  if (p.mode !== 'frame' && p.mode !== 'shorts') {
    p.mode = 'frame'
    fixed.add('shape')
  }
  // -- assets: one per id ------------------------------------------------------
  const assetIds = new Set<string>()
  const assets: Asset[] = []
  for (const a of p.assets) {
    if (!isObj(a) || typeof a.id !== 'string' || assetIds.has(a.id)) {
      fixed.add(isObj(a) && typeof a.id === 'string' ? 'duplicate-id' : 'shape')
      continue
    }
    assetIds.add(a.id)
    assets.push(a)
  }
  if (assets.length !== p.assets.length) p.assets = assets
  const assetOf = new Map(assets.map((a) => [a.id, a]))
  // (A length no file has: the limit. Security patch, item 9.)
  const MAX_T = PROJECT_LIMITS.maxTime
  for (const a of assets) {
    if (finite(a.duration) && a.duration > MAX_T) {
      a.duration = MAX_T
      fixed.add('limits')
    }
    // (Cila K: a code film's hand-set values are kept only as clean values
    // of their kind, bounded; a project file comes from anywhere.)
    if (isObj(a.code) && a.code.edits !== undefined) {
      const clean = cleanEdits(a.code.edits)
      if (!Array.isArray(a.code.edits) || clean.length !== a.code.edits.length) fixed.add('shape')
      if (clean.length) a.code.edits = clean
      else delete a.code.edits
    }
  }

  // -- clips: readable, placed, of existing media ---------------------------------
  const allIds = new Set<string>()
  const keep = (c: Clip, nested: boolean): boolean => {
    if (!isObj(c) || typeof c.id !== 'string') {
      fixed.add('shape')
      return false
    }
    if (!finite(c.start) || !finite(c.duration) || c.duration <= 0) {
      fixed.add('clip-dropped-time')
      return false
    }
    const noMedia = !!c.nested || !!c.adjustment || !!c.automationMissing
    if (!noMedia && !assetOf.has(c.assetId)) {
      fixed.add('clip-dropped-asset')
      return false
    }
    if (!nested && c.start < 0) {
      c.start = 0
      fixed.add('clip-time')
    }
    if (!finite(c.inPoint) || c.inPoint < 0) {
      c.inPoint = 0
      fixed.add('clip-time')
    }
    if (c.speed !== undefined && (!finite(c.speed) || c.speed <= 0)) {
      delete c.speed
      fixed.add('clip-time')
    }
    // A speed curve the model cannot take goes (the clip plays at its average).
    if (c.speedCurve !== undefined && curveProblem(c.speedCurve)) {
      delete c.speedCurve
      fixed.add('clip-time')
    }
    // Times and a speed beyond what a project can hold (security patch, item
    // 9): a clip that starts past the limit is nowhere on a timeline and
    // goes; one that runs past it ends there; the rest take the limit.
    if (Math.abs(c.start) >= MAX_T) {
      fixed.add('clip-dropped-time')
      return false
    }
    if (c.duration > MAX_T - Math.max(0, c.start)) {
      c.duration = MAX_T - Math.max(0, c.start)
      fixed.add('limits')
    }
    if (c.inPoint > MAX_T) {
      c.inPoint = 0
      fixed.add('limits')
    }
    if (c.speed !== undefined && (c.speed < PROJECT_LIMITS.minSpeed || c.speed > PROJECT_LIMITS.maxSpeed)) {
      c.speed = within(c.speed, PROJECT_LIMITS.minSpeed, PROJECT_LIMITS.maxSpeed)
      fixed.add('limits')
    }
    // A transition with no kind (or one that is no name) or without a readable
    // length goes: the cut is drawn straight. Kept, it threw in the drawing
    // list on every frame of its window, the preview's and the export's
    // (Faz 11b, DG1). (A name the app does not know draws as a mix, as before.)
    // A label that is none of the six colours goes (KOLAY-PLAN.md, item 3).
    if (c.label !== undefined && !(CLIP_LABELS as readonly unknown[]).includes(c.label)) {
      delete c.label
      fixed.add('shape')
    }
    const tr = c.transitionOut as unknown
    if (tr !== undefined && (!isObj(tr) || typeof tr.type !== 'string' || !finite(tr.duration) || tr.duration <= 0)) {
      delete c.transitionOut
      fixed.add('reference')
    }
    if (c.nested) {
      if (!isObj(c.nested) || !Array.isArray(c.nested.clips)) {
        c.nested = { clips: [] }
        fixed.add('shape')
      }
      c.nested.clips = c.nested.clips.filter((x) => keep(x, true))
    }
    return true
  }
  const clips: Record<string, Clip> = {}
  for (const [key, c] of Object.entries(p.clips)) {
    if (!keep(c, false)) continue
    if (key !== c.id || clips[c.id]) {
      fixed.add('duplicate-id')
      if (clips[c.id]) c.id = uid()
    }
    clips[c.id] = c
  }
  // Unique ids at every depth: a child that shares one gets a new one.
  for (const c of Object.values(clips)) allIds.add(c.id)
  const freshen = (list: Clip[]): void => {
    for (const ch of list) {
      if (allIds.has(ch.id)) {
        ch.id = uid()
        fixed.add('duplicate-id')
      }
      allIds.add(ch.id)
      if (ch.nested) freshen(ch.nested.clips)
    }
  }
  for (const c of Object.values(clips)) if (c.nested) freshen(c.nested.clips)

  // -- tracks: one per id, every clip on the track it names ------------------------
  const tracks: Track[] = []
  const trackOf = new Map<string, Track>()
  for (const t of p.tracks) {
    if (!isObj(t) || typeof t.id !== 'string' || (t.kind !== 'video' && t.kind !== 'audio')) {
      fixed.add('shape')
      continue
    }
    if (!Array.isArray(t.clipIds)) t.clipIds = []
    const seen = trackOf.get(t.id)
    if (seen) {
      // A second track of one id: its clips are the first one's.
      seen.clipIds = [...seen.clipIds, ...t.clipIds]
      fixed.add('duplicate-id')
      continue
    }
    if (typeof t.name !== 'string') t.name = t.id
    trackOf.set(t.id, t)
    tracks.push(t)
  }
  const listedOn = new Map<string, string>()
  for (const t of tracks) for (const id of t.clipIds) if (!listedOn.has(id)) listedOn.set(id, t.id)
  for (const c of Object.values(clips)) {
    if (typeof c.trackId === 'string' && trackOf.has(c.trackId)) continue
    const listed = listedOn.get(c.id)
    if (listed) {
      c.trackId = listed
      fixed.add('track-list')
      continue
    }
    // A track nobody has: made again, so the clip keeps its place.
    const kind: Track['kind'] = assetOf.get(c.assetId)?.kind === 'audio' ? 'audio' : 'video'
    const id = typeof c.trackId === 'string' && c.trackId ? c.trackId : uid()
    const n = tracks.filter((t) => t.kind === kind).length + 1
    const t: Track = { id, kind, name: `${kind === 'audio' ? 'A' : 'V'}${n}`, clipIds: [] }
    trackOf.set(id, t)
    // Video tracks are stored top first: a new one goes on top of the videos.
    if (kind === 'video') tracks.splice(0, 0, t)
    else tracks.push(t)
    c.trackId = id
    fixed.add('track-made')
  }
  if (!tracks.some((t) => t.kind === 'video')) tracks.unshift({ id: uid(), kind: 'video', name: 'V1', clipIds: [] })
  if (!tracks.some((t) => t.kind === 'audio')) tracks.push({ id: uid(), kind: 'audio', name: 'A1', clipIds: [] })
  if (tracks.length !== p.tracks.length) fixed.add('shape')
  // The lists come from the clips, in time order (the old order breaks ties).
  for (const t of tracks) {
    const order = new Map(t.clipIds.map((id, i) => [id, i]))
    const now = Object.values(clips)
      .filter((c) => c.trackId === t.id)
      .sort((a, b) => a.start - b.start || (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
      .map((c) => c.id)
    if (now.length !== t.clipIds.length || now.some((id, i) => id !== t.clipIds[i])) {
      t.clipIds = now
      fixed.add('track-list')
    }
  }
  p.tracks = tracks
  p.clips = clips

  // -- the source window inside the media ------------------------------------------
  const inMedia = (c: Clip): boolean => {
    const a = assetOf.get(c.assetId)
    if (!a || c.nested || (a.kind !== 'video' && a.kind !== 'audio') || !finite(a.duration) || a.duration <= 0) return true
    if (opts.untrustedDuration?.(a)) return true
    const sp = c.speed ?? 1
    if (c.freeze !== undefined) {
      if (!finite(c.freeze) || c.freeze < 0 || c.freeze > a.duration) {
        c.freeze = Math.min(a.duration, Math.max(0, finite(c.freeze) ? c.freeze : 0))
        fixed.add('media-end')
      }
      return true
    }
    if (c.inPoint + c.duration * sp <= a.duration + MEDIA_EPS) return true
    fixed.add('media-end')
    if (c.inPoint > a.duration - MEDIA_EPS) c.inPoint = Math.max(0, a.duration - c.duration * sp)
    if (c.inPoint + c.duration * sp > a.duration) c.duration = (a.duration - c.inPoint) / sp
    return c.duration > 1e-6
  }
  const trimNested = (list: Clip[]): Clip[] => list.filter((ch) => {
    if (ch.nested) ch.nested.clips = trimNested(ch.nested.clips)
    return inMedia(ch)
  })
  for (const c of Object.values(clips)) {
    if (c.nested) c.nested.clips = trimNested(c.nested.clips)
    if (!inMedia(c)) {
      delete clips[c.id]
      const t = trackOf.get(c.trackId)
      if (t) t.clipIds = t.clipIds.filter((x) => x !== c.id)
    }
  }

  // -- no two clips of a track on top of each other: the later one moves right ---
  for (const t of tracks) {
    let end = -Infinity
    for (const id of t.clipIds) {
      const c = clips[id]
      if (c.start < end - OVERLAP_EPS) {
        c.start = end
        fixed.add('overlap')
      }
      end = c.start + c.duration
    }
  }
  // (A clip moved past the limit by the step above: gone, or ending at it.
  // Security patch, item 9.)
  for (const t of tracks) {
    for (const id of [...t.clipIds]) {
      const c = clips[id]
      if (c.start >= MAX_T) {
        delete clips[id]
        t.clipIds = t.clipIds.filter((x) => x !== id)
        fixed.add('clip-dropped-time')
      } else if (c.start + c.duration > MAX_T) {
        c.duration = MAX_T - c.start
        fixed.add('limits')
      }
    }
  }

  // -- references ------------------------------------------------------------------
  const before = Object.values(clips).filter((c) => c.linkId).length
  dropLoneLinks(p)
  fixed.add('link', before - Object.values(clips).filter((c) => c.linkId).length)
  const trackerIds = new Set((p.trackers ?? []).filter(isObj).map((t) => t.id))
  for (const { clip } of walkAll(clips)) {
    if (clip.trackerId && !trackerIds.has(clip.trackerId)) {
      delete clip.trackerId
      fixed.add('reference')
    }
  }
  if (p.groups) {
    const groups = p.groups
      .filter(isObj)
      .map((g) => ({ ...g, clipIds: (Array.isArray(g.clipIds) ? g.clipIds : []).filter((id) => !!clips[id]) }))
      .filter((g) => g.clipIds.length > 1)
    if (JSON.stringify(groups) !== JSON.stringify(p.groups)) {
      fixed.add('reference')
      if (groups.length) p.groups = groups
      else delete p.groups
    }
  }

  // -- captions: readable times, one per id -------------------------------------------
  const capIds = new Set<string>()
  const captions = p.captions.filter((c) => {
    if (!isObj(c) || !finite(c.start) || !finite(c.end) || c.end < c.start) {
      fixed.add('caption-dropped')
      return false
    }
    // (Past the limit: a text that starts there goes, one that runs past it
    // ends there, its words with it. Security patch, item 9.)
    if (Math.abs(c.start) >= MAX_T) {
      fixed.add('caption-dropped')
      return false
    }
    if (c.end > MAX_T) {
      c.end = MAX_T
      fixed.add('limits')
    }
    if (Array.isArray(c.words)) {
      for (const w of c.words) {
        if (!isObj(w)) continue
        if (finite(w.start) && Math.abs(w.start) > MAX_T) w.start = within(w.start, 0, MAX_T)
        if (finite(w.end) && Math.abs(w.end) > MAX_T) w.end = within(w.end, 0, MAX_T)
      }
    }
    if (typeof c.id !== 'string' || capIds.has(c.id)) {
      c.id = uid()
      fixed.add('duplicate-id')
    }
    capIds.add(c.id)
    if (uprightUnlessBoolean(c.style)) fixed.add('shape')
    return true
  })
  if (uprightUnlessBoolean(p.captionStyle)) fixed.add('shape')
  if (uprightUnlessBoolean(p.captionStyleShorts)) fixed.add('shape')
  if (captions.length !== p.captions.length) p.captions = captions

  // -- markers and Shorts ranges: no time past the limit (security patch, item 9) --------
  for (const m of p.markers ?? []) {
    if (isObj(m) && finite(m.time) && Math.abs(m.time) > MAX_T) {
      m.time = within(m.time, 0, MAX_T)
      fixed.add('limits')
    }
  }
  for (const s of p.shortSegments ?? []) {
    if (!isObj(s)) continue
    for (const k of ['start', 'end'] as const) {
      if (finite(s[k]) && Math.abs(s[k]) > MAX_T) {
        s[k] = within(s[k], 0, MAX_T)
        fixed.add('limits')
      }
    }
  }

  // -- ids of the other lists ---------------------------------------------------------
  // (An entry that is no object goes from its list: kept, `checkProject` and
  // the timeline's marker drawing threw on it. Faz 11b, DG3.)
  for (const key of ['markers', 'trackers', 'templates', 'shortSegments'] as const) {
    const all = p[key] as unknown[] | undefined
    if (!Array.isArray(all)) continue
    const objects = all.filter(isObj)
    if (objects.length !== all.length) {
      ;(p as unknown as Record<string, unknown>)[key] = objects
      fixed.add('shape', all.length - objects.length)
    }
  }
  for (const list of [p.markers, p.trackers, p.templates, p.shortSegments] as ({ id: string }[] | undefined)[]) {
    if (!list) continue
    const ids = new Set<string>()
    for (const x of list) {
      if (!isObj(x)) continue
      if (typeof x.id !== 'string' || ids.has(x.id)) {
        x.id = uid()
        fixed.add('duplicate-id')
      }
      ids.add(x.id)
    }
  }

  // -- the looks of "cila" part D: a value that cannot be read goes (the clip is
  // drawn without it), one out of its range is held to it --------------------
  fixed.add('look', repairLooks(p))

  // -- keys: readable, in time order, one per instant (phase Ç2c.1, decision 3: sanitizeKeyframes, report K25) --
  // Unreadable keys go; the rest are sorted (stable: keys at one time keep
  // their order); of keys at one instant (within 1e-6 s) the first stays —
  // the value drawn at that instant — and the others go (two keys at one
  // time drew a jump no one could separate again, report K3); an opacity
  // key is held to 0..1.
  const keys = <K extends { time: number }>(list: K[] | undefined, values: (k: K) => unknown[] = () => [], clamp?: (k: K) => K): K[] | undefined => {
    if (list === undefined) return undefined
    if (!Array.isArray(list)) {
      fixed.add('keys')
      return []
    }
    const ok = list.filter((k) => isObj(k) && finite(k.time) && values(k).every(finite))
    const sorted = ok.every((k, i) => i === 0 || ok[i - 1].time <= k.time) ? ok : [...ok].sort((a, b) => a.time - b.time)
    const single = sorted.filter((k, i) => i === 0 || k.time - sorted[i - 1].time > EPS)
    const held = clamp ? single.map(clamp) : single
    if (held.length !== list.length || held.some((k, i) => k !== list[i])) {
      fixed.add('keys')
      return held
    }
    return list
  }
  const unit = <K extends { value: number }>(k: K): K => (k.value >= 0 && k.value <= 1 ? k : { ...k, value: Math.min(1, Math.max(0, k.value)) })
  const unitMotion = <K extends { opacity: number }>(k: K): K => (!finite(k.opacity) || (k.opacity >= 0 && k.opacity <= 1) ? k : { ...k, opacity: Math.min(1, Math.max(0, k.opacity)) })
  for (const { clip } of walkAll(clips)) {
    // (Channels that are no object go: the keys below were written into them. Faz 11b, DG2.)
    if (clip.channels !== undefined && !isObj(clip.channels)) {
      delete clip.channels
      fixed.add('keys')
    }
    if (clip.channels) for (const ch of Object.keys(clip.channels) as (keyof NonNullable<Clip['channels']>)[]) clip.channels[ch] = keys(clip.channels[ch], (k) => [k.value], ch === 'opacity' ? unit : undefined)
    if (clip.fxKeys) for (const key of Object.keys(clip.fxKeys) as (keyof NonNullable<Clip['fxKeys']>)[]) clip.fxKeys[key] = keys(clip.fxKeys[key], (k) => [k.value])
    if (clip.volumeKeyframes) clip.volumeKeyframes = keys(clip.volumeKeyframes, (k) => [k.value])
    if (clip.mask?.keyframes) clip.mask.keyframes = keys(clip.mask.keyframes)
  }
  for (const c of p.captions) if (c.kfs) c.kfs = keys(c.kfs, () => [], unitMotion)
  if (p.shorts?.keyframes) p.shorts.keyframes = keys(p.shorts.keyframes)!
  for (const s of p.shortSegments ?? []) if (isObj(s) && s.keyframes) s.keyframes = keys(s.keyframes)!
  for (const t of p.trackers ?? []) if (isObj(t) && t.keyframes) t.keyframes = keys(t.keyframes)!
  return fixed.list()
}

/** Mends the fields of "cila" part D on every clip and the project's LUT
 *  list; the number of things it changed. */
export function repairLooks(p: Project): number {
  let n = 0
  const hold = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
  /** An object's numeric fields, each held to its range; null when one is no number. */
  const nums = <T extends Record<string, number>>(v: unknown, ranges: { [K in keyof T]: [number, number] }): T | null => {
    if (!isObj(v)) return null
    const out = { ...v } as Record<string, unknown>
    for (const [k, [lo, hi]] of Object.entries(ranges) as [string, [number, number]][]) {
      if (!finite(v[k])) return null
      out[k] = hold(v[k] as number, lo, hi)
    }
    return out as T
  }
  const same = (a: object, b: object): boolean => JSON.stringify(a) === JSON.stringify(b)
  for (const { clip } of walkAll(p.clips)) {
    const c = clip as Clip & Record<string, unknown>
    const field = <T extends object>(key: 'tone' | 'bloom' | 'halation' | 'isolate', mended: T | null): void => {
      if (c[key] === undefined) return
      if (mended === null) {
        delete c[key]
        n++
      } else if (!same(mended, c[key] as object)) {
        ;(c as Record<string, unknown>)[key] = mended
        n++
      }
    }
    field('tone', nums(c.tone, { exposure: [-2, 2], tint: [-1, 1], highlights: [-1, 1], shadows: [-1, 1] }))
    field('bloom', nums(c.bloom, { amount: [0, 1], threshold: [0, 1], radius: [0, 1] }))
    field('halation', nums(c.halation, { amount: [0, 1], size: [0, 1] }))
    field('isolate', isObj(c.isolate) && typeof c.isolate.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.isolate.color) ? nums(c.isolate, { range: [0, 0.5], amount: [0, 1] }) : null)
    for (const [key, lo, hi] of [['lutAmount', 0, 1], ['mosaic', 0, 400]] as const) {
      const v = c[key]
      if (v === undefined) continue
      if (!finite(v) || (key === 'mosaic' && v <= 0)) {
        delete c[key]
        n++
      } else if (v < lo || v > hi) {
        c[key] = hold(v, lo, hi)
        n++
      }
    }
    if (c.lut !== undefined && typeof c.lut !== 'string') {
      delete c.lut
      n++
    }
    if (isObj(c.chroma)) {
      const ch = c.chroma as Record<string, unknown>
      if (ch.method !== undefined && ch.method !== 'chroma') {
        delete ch.method
        n++
      }
      if (ch.spill !== undefined && (!finite(ch.spill) || ch.spill < 0 || ch.spill > 1)) {
        if (finite(ch.spill)) ch.spill = hold(ch.spill, 0, 1)
        else delete ch.spill
        n++
      }
    }
    if (c.fxKeys !== undefined) {
      if (!isObj(c.fxKeys)) {
        delete c.fxKeys
        n++
      } else {
        for (const key of Object.keys(c.fxKeys)) {
          if ((FX_KEYS as string[]).includes(key)) continue
          delete (c.fxKeys as Record<string, unknown>)[key]
          n++
        }
      }
    }
  }
  const raw = p as Project & { luts?: unknown }
  if (raw.luts !== undefined) {
    const names = new Set<string>()
    const list = (Array.isArray(raw.luts) ? raw.luts : []).filter((l) => {
      const ok = isObj(l) && typeof l.name === 'string' && !!l.name && typeof l.path === 'string' && !!l.path && !names.has(l.name)
      if (ok) names.add((l as { name: string }).name)
      return ok
    })
    if (!Array.isArray(raw.luts) || list.length !== raw.luts.length) {
      n += Array.isArray(raw.luts) ? raw.luts.length - list.length : 1
      p.luts = list as Project['luts']
    }
  }
  return n
}

function walkAll(clips: Record<string, Clip>): { clip: Clip }[] {
  const out: { clip: Clip }[] = []
  const walk = (list: Clip[]): void => {
    for (const c of list) {
      out.push({ clip: c })
      if (c.nested) walk(c.nested.clips)
    }
  }
  walk(Object.values(clips))
  return out
}
