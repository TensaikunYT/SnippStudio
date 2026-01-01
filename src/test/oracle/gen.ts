// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The random sequences (SnippStudio phase 4A.9, A8): an agent that reads,
// measures and edits (with the version it read, an older one, two calls on
// one read), a user who cuts, undoes, drags, trims, splits, duplicates,
// deletes, locks and retypes meanwhile, and the user's decisions on the
// draft. One seed, one sequence. Every step made is kept as plain data, so a
// failing sequence can be replayed without the generator and shrunk to the
// few steps that matter.
import { useStore } from '../../renderer/src/state/store'
import { planMove } from '../../renderer/src/commands/clips'
import type { Clip, Project } from '../../renderer/src/types'
import { SHAPES, VARIANTS, type Shape } from './fixture'
import { voiceCovers } from './oracle'
import { bedTracks } from '../../renderer/src/commands/timeline'
import { isStill, type Iv } from './sample'
import { Run, rngOf, type Found, type Obs, type Step, type UserAct } from './run'

const S = useStore.getState

export interface SequenceOptions {
  seed: number
  /** The user's cuts leave the music bed alone where there is one
   *  (çekirdek cila S: keepTracks; the full run otherwise). */
  keep?: boolean
  /** No user steps (decisions stay). */
  agentOnly?: boolean
  /** The command layer alone: straight onto the timeline, one op per call,
   *  each written on a fresh read. A violation here is the command's. */
  pure?: boolean
  shape?: number
  /** Another shape than the four (one left out of the random runs). */
  make?: () => Shape
  /** Changes the shape before the run (a reversed clip, a sped-up one…). */
  vary?: (s: Shape) => void
  minSteps?: number
  maxSteps?: number
  /** Which op kinds the agent may send (default: all). */
  ops?: readonly string[]
  /** Several agents: two sessions of one program and another program; the
   *  user switches between "as a draft" and "straight onto the timeline". */
  two?: boolean
  /** Core polish B: the user's speed changes reach over the whole range
   *  (0.1x – 100x), not only 0.8x / 1.25x (default: on). */
  speeds?: boolean
  /** Core polish C: some of the user's speed changes are a speed curve put
   *  on, changed or taken away (drawn from a stream of their own; default: on). */
  curves?: boolean
  /** Phase 4A.11, K1: the user's settings of a record's other fields (a
   *  grade, a blend mode, a mask, keyframes, a title retyped, a picture put
   *  in an empty placeholder). Drawn from a stream of their own, so a seed
   *  without them is the sequence it was (default: on). */
  k1?: boolean
  /** Audit patch yama-c (D5): with `keep`, the user's changes of a voice
   *  clip go through a high speed (22x – 100x: the subtitle floor), a speed
   *  curve, and cuts that leave the music bed alone — a transcript delete
   *  (whole words) and a silence cut — in one sequence, drawn from a stream
   *  of their own. The plain kinds never made the three together (0 / 200). */
  wild?: boolean
}

export interface SequenceResult {
  seed: number
  shape: number
  shapeName: string
  mode: 'draft' | 'direct'
  steps: Step[]
  log: string[]
  violations: Found[]
  obs: Obs[]
  /** Applied ops judged in full, and literal ops judged for their context. */
  judged: { content: number; literal: number }
}

const r2 = (x: number): number => Math.round(x * 100) / 100
const endOf = (p: Project): number => Math.max(0, ...Object.values(p.clips).map((c) => c.start + c.duration))

/** Media only the agent places (each at most once: an asset is one instance). */
const AGENT_MEDIA = 14

/** The speeds a user's change may take besides the two mild ones. */
const SPEEDS = [0.1, 0.25, 0.5, 2, 4, 10, 50, 100] as const

export const AGENT_OPS = ['clipAdd', 'append', 'broll', 'broll', 'cut', 'cut', 'cut', 'cut', 'apply', 'apply', 'text', 'text', 'text', 'marker', 'marker', 'prop', 'prop', 'prop', 'split', 'split', 'trimHead', 'trimEnd', 'delete', 'lineText', 'lineMarks', 'structural', 'mute', 'transition', 'lineDelete', 'title', 'field', 'trackAdd', 'cutPast', 'template'] as const

export async function runSequence(o: SequenceOptions): Promise<SequenceResult> {
  const rng = rngOf(o.seed * 2654435761)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]
  const between = (a: number, b: number): number => a + rng() * (b - a)
  // (The four shapes the kept sequences were made on stay at their numbers.)
  // (Shape 5, a talking video with its own sound over a music bed, joined
  // the random runs in phase Ç2b.1: K-1 is fixed.)
  // (wild: two in three on the shape with an unlocked music bed, so a cut
  // can leave it alone.)
  const shapeIndex = o.shape ?? (o.wild && o.seed % 3 !== 0 ? 1 : o.seed % 11 === 10 ? 5 : o.seed % 7 === 6 ? 4 : o.seed % 4)
  const shape = o.make ? o.make() : SHAPES[shapeIndex]()
  o.vary?.(shape)
  // (A voice clip that plays backwards, in one sequence of 13: the
  // material's reversed clips joined the random runs in phase Ç2b.1, K-2.)
  if (!o.vary && !o.make && o.seed % 13 === 12) VARIANTS.reversed(shape)
  const mode: 'draft' | 'direct' = o.pure ? 'direct' : rng() < (o.two ? 0.5 : 0.75) ? 'draft' : 'direct'
  const run = new Run(shape, mode, o.seed)
  const want = Math.floor(between(o.minSteps ?? 10, (o.maxSteps ?? 30) + 1))
  const steps: Step[] = []
  const pool = [...shape.pool]
  const voice = shape.voiceTrack
  // (The agent's own media: silent footage and pictures.)
  const mine: string[] = []
  for (let i = 0; i < AGENT_MEDIA; i++) {
    const id = `ag${i}`
    shape.project.assets.push({ id, kind: i % 2 ? 'image' : 'video', name: `${id}.${i % 2 ? 'png' : 'mp4'}`, url: `media://${id}`, size: 1, duration: i % 2 ? 0 : 9, width: 1920, height: 1080, hasAudio: false } as never)
    mine.push(id)
  }

  // (Every clip on an unlocked track may be named: since phase Ç2b.1 no cut
  // leaves a sliver behind, K-3.)
  const unlocked = (p: Project): Clip[] => Object.values(p.clips).filter((c) => !p.tracks.find((t) => t.id === c.trackId)?.locked)
  const wordLines = (p: Project) => p.captions.filter((c) => !c.manual && !c.shape && (c.words?.length ?? 0) > 1)
  /** A time on voice content (the agent works on the talk), now and then elsewhere. */
  const timeOn = (p: Project): number => {
    const d = endOf(p)
    for (let i = 0; i < 8; i++) {
      const t = r2(between(0.2, Math.max(0.3, d - 0.2)))
      if (run.voiceAt(p, t) || rng() < 0.04) return t
    }
    return r2(between(0.2, Math.max(0.3, d - 0.2)))
  }
  const rangeOn = (p: Project, maxLen: number): Iv | null => {
    const d = endOf(p)
    if (d < 3) return null
    for (let i = 0; i < 8; i++) {
      const a = r2(between(0.2, d - 1))
      const b = r2(Math.min(d, a + between(0.25, maxLen)))
      if (b - a > 0.1 && voiceCovers(p, voice, a, b)) return [a, b]
    }
    return null
  }

  /** One op as the agent would write it on `p`, or null when `p` has
   *  nothing for it. */
  const opOn = (p: Project, kind: string): Record<string, unknown> | null => {
    const lines = wordLines(p)
    const clips = unlocked(p)
    // A split or a trim of a still is not sent: a still has no content
    // clock to judge the point by (plan 7.6).
    const still = (c: Clip): boolean => isStill(p, c)
    // (Over a music bed the voice's clips are deleted, trimmed and
    // silence-cut too: since phase Ç2b.1 a line's sound is known by its
    // file, K-1.)
    const time = (): number | string => {
      if (lines.length && rng() < 0.3) {
        const l = pick(lines)
        return `${l.id}#${Math.floor(rng() * l.words!.length)}${rng() < 0.4 ? '>' : ''}`
      }
      return timeOn(p)
    }
    switch (kind) {
      case 'cut': {
        const ranges: unknown[] = []
        const n = 1 + Math.floor(rng() * 3)
        for (let i = 0; i < n; i++) {
          const x = rng()
          if (lines.length && x < 0.15) {
            const l = pick(lines)
            const a = Math.floor(rng() * l.words!.length)
            const b = Math.min(l.words!.length - 1, a + Math.floor(rng() * 2))
            ranges.push(a === b ? `${l.id}#${a}` : `${l.id}#${a}-${b}`)
          } else if (lines.length && x < 0.25) {
            const l = pick(lines)
            const i0 = Math.floor(rng() * l.words!.length)
            const b = r2(l.words![i0].start + between(0.3, 2))
            if (voiceCovers(p, voice, l.words![i0].start, b)) ranges.push([`${l.id}#${i0}`, b])
          } else if (lines.length && x < 0.3) ranges.push(pick(lines).id)
          else {
            const r = rangeOn(p, 2.2)
            if (r) ranges.push(r)
          }
        }
        return ranges.length ? { op: 'timeline.cutRanges', ranges } : null
      }
      case 'apply': {
        const ids = run.resultIds(who)
        return ids.length ? { op: 'apply', result: pick(ids) } : null
      }
      case 'text':
        // (No id: the app makes the ids of what an op creates, the same on every replay.)
        return { op: 'text.add', time: time(), text: 'Title' }
      case 'marker':
        return { op: 'marker.add', time: time(), note: 'm' }
      case 'mute': {
        if (!clips.length) return null
        const c = pick(clips)
        // (Not the talk of a project with no subtitles: its sound off, the
        // talk is no anchor any more — K5 — and the oracle knows the talk by
        // its one track. Unit tests hold that case.)
        if (silencing(p, c, !c.muted)) return { op: 'clip.setOpacity', clipId: c.id, opacity: 0.5 }
        return { op: 'clip.setMuted', clipId: c.id, muted: !c.muted }
      }
      case 'transition': {
        const c = pick(clips.filter((x) => !still(x)))
        return c ? { op: 'clip.setTransition', clipId: c.id, transition: c.transitionOut ? null : { type: 'mix', duration: 0.4 } } : null
      }
      case 'lineDelete': {
        const titles = p.captions.filter((c) => c.manual || c.shape || !c.words?.length)
        const l = rng() < 0.5 && titles.length ? pick(titles) : pick(lines)
        return l ? { op: 'caption.delete', ids: [l.id] } : null
      }
      case 'title': {
        const t = pick(p.captions.filter((c) => c.manual || c.shape || !c.words?.length))
        if (!t) return null
        return rng() < 0.5 ? { op: 'caption.update', id: t.id, patch: { text: `${t.text}!` } } : { op: 'caption.setOwnStyle', id: t.id, patch: { fontSize: 40 + Math.floor(rng() * 60) } }
      }
      case 'field': {
        const x = rng()
        if (x < 0.6) return { op: 'caption.setStyle', patch: { fontSize: 30 + Math.floor(rng() * 90) } }
        return x < 0.8 ? { op: 'audio.risers', level: r2(0.1 + rng() * 0.8) } : { op: 'audio.transitionSfx', level: r2(rng()) }
      }
      case 'trackAdd':
        return { op: 'track.add', kind: rng() < 0.5 ? 'video' : 'audio' }
      case 'clipAdd':
      case 'append': {
        // (On a video track that is not the talk's: the oracle knows the talk by its one track.)
        const tr = pick(p.tracks.filter((t) => t.kind === 'video' && t.id !== voice && !t.locked))
        const a = mine.pop()
        if (!tr || !a) return null
        return kind === 'append' ? { op: 'clip.append', assetId: a, trackId: tr.id } : { op: 'clip.add', assetId: a, trackId: tr.id, start: time() }
      }
      case 'broll': {
        const n = 1 + Math.floor(rng() * 2)
        const placements: Record<string, unknown>[] = []
        let from = 0
        for (let i = 0; i < n && mine.length; i++) {
          const l = lines.filter((x) => x.start > from + 0.1)
          if (l.length && rng() < 0.6) {
            const line = l[Math.floor(rng() * Math.min(3, l.length))]
            placements.push({ assetId: mine.pop(), start: `${line.id}#0`, end: `${line.id}#1>` })
            from = line.words![1].end
          } else {
            const t = r2(Math.max(from + 0.2, timeOn(p)))
            placements.push({ assetId: mine.pop(), start: t, end: r2(t + between(0.6, 2)) })
            from = t + 2
          }
        }
        return placements.length ? { op: 'broll.place', look: rng() < 0.5 ? 'card' : 'full', placements } : null
      }
      case 'cutPast': {
        // A range that reaches past the end of the talk.
        const end = Math.max(0, ...p.tracks.filter((t) => t.id === voice).flatMap((t) => t.clipIds.map((id) => p.clips[id]).filter(Boolean).map((c) => c.start + c.duration)))
        return end > 2 ? { op: 'timeline.cutRanges', ranges: [[r2(end - between(0.3, 1.2)), r2(end + between(0.2, 2))]] } : null
      }
      case 'template':
        return { op: 'template.place', kind: 'stat', time: timeOn(p) }
      case 'prop': {
        if (!clips.length) return null
        const c = pick(clips)
        if (rng() < 0.6) return { op: 'clip.setVolume', clipId: c.id, volume: silencing(p, c, r2((c.volume + 0.37) % 1.5) === 0) ? 0.05 : r2((c.volume + 0.37) % 1.5) }
        return { op: 'clip.setOpacity', clipId: c.id, opacity: r2(((c.opacity ?? 1) + 0.37) % 1) }
      }
      case 'split': {
        const c = pick(clips.filter((x) => x.duration > 1.2 && !still(x)))
        return c ? { op: 'clip.split', clipIds: [c.id], time: r2(c.start + between(0.4, c.duration - 0.4)) } : null
      }
      case 'trimHead': {
        const c = pick(clips.filter((x) => x.duration > 2 && !still(x)))
        return c ? { op: 'clip.trimHead', clipId: c.id, edge: r2(c.start + between(0.3, Math.min(1.5, c.duration - 1))) } : null
      }
      case 'trimEnd': {
        const c = pick(clips.filter((x) => x.duration > 2 && !still(x)))
        return c ? { op: 'clip.trimEnd', clipId: c.id, delta: -r2(between(0.3, Math.min(1.5, c.duration - 1))) } : null
      }
      case 'delete': {
        const c = pick(clips)
        return c ? { op: 'clip.delete', ids: [c.id] } : null
      }
      case 'lineText': {
        const l = pick(lines)
        return l ? { op: 'caption.editLine', id: l.id, text: l.words!.map((w, i) => (i === 0 ? w.text.toUpperCase() : w.text)).join(' ') + '!' } : null
      }
      case 'lineMarks': {
        const l = pick(lines)
        return l ? { op: 'caption.update', id: l.id, patch: { marks: [Math.floor(rng() * l.words!.length)] } } : null
      }
      case 'structural': {
        const x = rng()
        const c = pick(clips.filter((k) => k.duration > 3))
        if (x < 0.4) return { op: 'transitions.mix', duration: 0.4 }
        if (x < 0.7 && c) return { op: 'silence.apply', regions: [{ clipId: c.id, start: r2(c.start + 1), end: r2(c.start + 1.8) }] }
        const k = pick(clips)
        return k ? { op: 'clip.delete', ids: [k.id], ripple: true } : null
      }
    }
    return null
  }

  /** Would this turn the talk of a project with no subtitles silent? */
  function silencing(p: Project, c: Clip, off: boolean): boolean {
    return off && !p.captions.some((l) => l.words?.length) && c.trackId === voice
  }

  const kinds = o.ops ?? AGENT_OPS
  let who = 0
  const W = (): { who?: number } => (who ? { who } : {})
  const editStep = (from: 0 | 1, count: number): Step | null => {
    const src = from === 1 ? run.agents[who].old : run.agents[who].seen
    if (!src) return null
    const ops: Record<string, unknown>[] = []
    for (let i = 0; i < count; i++) {
      const raw = opOn(src.project, pick(kinds))
      if (raw) ops.push(raw)
    }
    return ops.length ? { k: 'edit', from, ops, ...W() } : null
  }

  // (K1's user steps: their own stream — a run that draws none of them is
  // the run it was before.)
  const rngK = rngOf((o.seed ^ 0x4b31a7) * 2246822519)
  // (The wide speeds' stream.)
  const rngS = rngOf((o.seed ^ 0x51ed27) * 3266489917)
  // (The speed curves' stream.)
  const rngC = rngOf((o.seed ^ 0x3c5a91) * 2654435789)
  const CURVE_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 20] as const
  const pickK = <T>(list: readonly T[]): T => list[Math.floor(rngK() * list.length)]
  const k1Step = (): Step | null => {
    const p = S().project
    const clips = unlocked(p)
    const titles = p.captions.filter((k) => k.manual || k.shape || !k.words?.length)
    const holes = clips.filter((k) => k.automationMissing)
    const y = rngK()
    const u = (cls: string, act: UserAct): Step => ({ k: 'user', cls, act })
    if (y < 0.12) {
      // An empty placeholder of the picture automation, on a new layer (its
      // own undo step), to be filled later.
      const d = endOf(p)
      if (d < 4 || holes.length) return null
      const a = r2(0.5 + rngK() * (d - 3))
      return u('placeholder', { t: 'batch', name: 'automation.placeImages', params: { placements: [], target: 'new', missingSlots: [{ start: a, end: r2(a + 2), number: 1, text: 'slot', captionIds: [] }] } })
    }
    if (y < 0.24) {
      const h = pickK(holes)
      // (A picture of the user's pool: every asset is used by one clip at most.)
      const pic = pool.find((id) => p.assets.find((x) => x.id === id)?.kind === 'image')
      if (!h || !pic) return null
      pool.splice(pool.indexOf(pic), 1)
      return u('fill', { t: 'store', fn: 'fill', clipId: h.id, asset: pic })
    }
    if (y < 0.36) {
      const t = pickK(titles)
      return t ? u('titleText', { t: 'batch', name: 'caption.update', params: { id: t.id, patch: { text: `${t.text}+` } } }) : null
    }
    const c = pickK(clips)
    if (!c) return null
    const fn = pickK(['grade', 'blend', 'mask', 'keyframe'] as const)
    return u(fn, { t: 'store', fn, clipId: c.id })
  }

  // (wild's stream, and its turn: a high speed, a kept-bed transcript
  // delete, a curve, a speed back down, a kept-bed silence cut, in turn.)
  const rngW = rngOf((o.seed ^ 0x7a3e55) * 2654435741)
  const pickW = <T>(list: readonly T[]): T => list[Math.floor(rngW() * list.length)]
  let wildTurn = 0
  const wildStep = (): Step | null => {
    const p = S().project
    const u = (cls: string, act: UserAct): Step => ({ k: 'user', cls, act })
    const talk = unlocked(p).filter((k) => k.trackId === voice && !isStill(p, k))
    const c = talk.length ? pickW(talk) : undefined
    const beds = bedTracks(p, talk.map((k) => k.id))
    const turn = wildTurn++ % 5
    if (turn === 0 || turn === 3) {
      if (!c) return null
      const speed = turn === 0 ? pickW([22, 30, 50, 100] as const) : pickW([1, 1, 0.5, 2] as const)
      return u('speed', { t: 'batch', name: 'clip.setSpeed', params: { clipId: c.id, speed, linkAV: true } })
    }
    if (turn === 2) {
      if (!c) return null
      const n = 2 + Math.floor(rngW() * 3)
      const points = Array.from({ length: n }, (_, i) => ({ u: i === 0 ? 0 : i === n - 1 ? 1 : r2(rngW()), v: pickW([0.5, 1, 4, 22, 50, 100] as const) })).sort((a, b) => a.u - b.u)
      return u('speed', { t: 'curve', clipId: c.id, curve: { points } })
    }
    if (turn === 1) {
      // A transcript delete: one or two whole words of a line.
      const l = pickW(wordLines(p))
      if (!l) return null
      const i = Math.floor(rngW() * l.words!.length)
      const j = Math.min(l.words!.length - 1, i + Math.floor(rngW() * 2))
      const range: Iv = [l.words![i].start, l.words![j].end]
      if (range[1] - range[0] < 0.02) return null
      return beds.length ? u('cutKeep', { t: 'cutKeep', range, keep: beds, end: rngW() < 0.5 }) : u('cut', { t: 'cut', range })
    }
    // A silence cut in one voice clip.
    if (!c || c.duration < 1.5) return null
    const a = r2(c.start + 0.3 + rngW() * (c.duration - 1.2))
    const b = r2(Math.min(c.start + c.duration - 0.3, a + 0.2 + rngW() * 0.8))
    if (b - a < 0.1) return null
    return u(beds.length ? 'cutKeep' : 'silence', { t: 'silenceKeep', regions: [{ clipId: c.id, start: a, end: b }], picked: [c.id], keep: beds, end: rngW() < 0.5 })
  }

  const userStep = (): Step | null => {
    if (o.wild && rngW() < 0.6) {
      const st = wildStep()
      if (st) return st
    }
    if ((o.k1 ?? true) && rngK() < 0.14) return k1Step()
    const p = S().project
    const d = endOf(p)
    const clips = unlocked(p)
    const c = clips.length ? pick(clips) : undefined
    const u = (cls: string, act: UserAct): Step => ({ k: 'user', cls, act })
    const batch = (cls: string, name: string, params: Record<string, unknown>): Step => u(cls, { t: 'batch', name, params })
    const x = rng() * 25.5
    if (x >= 21.5) {
      const titles = p.captions.filter((k) => k.manual || k.shape || !k.words?.length)
      const y = (x - 21.5) / 4
      // Footage shown twice: an end pulled out again, a head pulled back, a slip.
      if (y < 0.12) return c && !isStill(p, c) ? batch('extend', 'clip.trimEnd', { clipId: c.id, delta: r2(between(0.5, 3)) }) : null
      if (y < 0.2) return c && !isStill(p, c) ? batch('extend', 'clip.trimHead', { clipId: c.id, edge: r2(Math.max(0, c.start - between(0.5, 2))) }) : null
      if (y < 0.3) return c && !isStill(p, c) ? batch('slip', 'clip.slip', { clipId: c.id, delta: r2(between(-3, 3)) }) : null
      if (y < 0.4) {
        // (Nor onto the talk's track: the oracle knows the talk by its one track.)
        const other = c ? p.tracks.filter((t) => t.id !== c.trackId && t.id !== voice && !t.locked && t.kind === p.tracks.find((k) => k.id === c.trackId)?.kind) : []
        // (Not a clip of the talk: the oracle knows the talk by its one track.)
        return c && c.trackId !== voice && other.length ? batch('moveTrack', 'clip.moveToTrack', { clipId: c.id, trackId: pick(other).id }) : null
      }
      if (y < 0.5) {
        const l = pick(wordLines(p))
        return l ? batch('capMarks', 'caption.update', { id: l.id, patch: { marks: [Math.floor(rng() * l.words!.length)] } }) : null
      }
      if (y < 0.6) {
        const t = pick(titles)
        if (!t) return null
        const a = r2(between(0, Math.max(0.1, d)))
        return rng() < 0.6 ? batch('titleMove', 'caption.update', { id: t.id, patch: { start: a, end: r2(a + (t.end - t.start)) } }) : batch('titleText', 'caption.update', { id: t.id, patch: { text: `${t.text}?` } })
      }
      if (y < 0.68) {
        const m = pick(p.markers ?? [])
        return m ? batch('markMove', 'marker.update', { id: m.id, patch: { time: r2(between(0, Math.max(0.1, d))) } }) : null
      }
      if (y < 0.74) {
        const m = pick(p.markers ?? [])
        const t = pick(titles)
        return m && rng() < 0.5 ? batch('recDelete', 'marker.delete', { id: m.id }) : t ? batch('recDelete', 'caption.delete', { ids: [t.id] }) : null
      }
      if (y < 0.82) return c && !isStill(p, c) ? batch('transition', 'clip.setTransition', { clipId: c.id, transition: c.transitionOut ? null : { type: 'mix', duration: 0.3 } }) : null
      if (y < 0.88) {
        if (!c) return null
        const name = rng() < 0.5 ? 'clip.setOpacity' : 'clip.setMuted'
        const params = rng() < 0.5 ? { clipId: c.id, opacity: r2(rng()) } : { clipId: c.id, muted: !c.muted }
        return name === 'clip.setMuted' && silencing(p, c, !c.muted) ? batch('prop', 'clip.setOpacity', { clipId: c.id, opacity: 0.5 }) : batch('prop', name, params)
      }
      if (y < 0.94) return batch('mark', 'template.place', { kind: 'stat', time: r2(between(0, Math.max(0.1, d))) })
      return batch('style', 'caption.setStyle', { patch: { fontSize: 30 + Math.floor(rng() * 90) } })
    }
    if (x < 4) {
      if (d < 3) return null
      const a = r2(between(0.2, d - 1.2))
      const range: Iv = [a, r2(a + between(0.2, 2))]
      // (The kept tracks are the app's own choice for a cut made for the
      // talk: commands/timeline.ts bedTracks. No draw of the random stream.)
      const beds = o.keep ? bedTracks(p, Object.values(p.clips).filter((k) => k.trackId === voice).map((k) => k.id)) : []
      if (beds.length) return u('cutKeep', { t: 'cutKeep', range, keep: beds, end: Math.round(a * 100) % 2 === 0 })
      return u('cut', { t: 'cut', range })
    }
    if (x < 6.5) return S().past.length > 0 ? u('undo', { t: 'undo' }) : null
    if (x < 8) return S().future.length > 0 ? u('redo', { t: 'redo' }) : null
    if (x < 10) {
      if (!c) return null
      const linked = !!c.linkId && rng() < 0.8
      const start = r2(Math.max(0, c.start + between(-4, 4)))
      // (Since phase Ç2b.1 a move is laid out as a drag: landing on other
      // clips it pushes them later, which can put footage the agent never
      // saw there into its ranges — that move is a class of its own.)
      const plan = planMove(p, c.id, start, linked)
      const own = new Set([c.id, ...(linked ? Object.values(p.clips).filter((x) => x.linkId && x.linkId === c.linkId).map((x) => x.id) : [])])
      const pushes = !!plan && Object.entries(plan.positions).some(([id, pos]) => !own.has(id) && Math.abs(pos.start - p.clips[id].start) > 1e-6)
      return batch(pushes ? 'movePush' : c.linkId && !linked ? 'moveUnlinked' : 'move', 'clip.move', { clipId: c.id, start, ...(linked ? { linkAV: true } : {}) })
    }
    if (x < 11.5) {
      if (!c || c.duration < 2) return null
      return rng() < 0.5 ? batch('trim', 'clip.trimHead', { clipId: c.id, edge: r2(c.start + between(0.2, 0.8)) }) : batch('trim', 'clip.trimEnd', { clipId: c.id, delta: -r2(between(0.2, 0.8)) })
    }
    if (x < 13.5) {
      if (!c || c.duration < 1.2) return null
      return batch('split', 'clip.split', { clipIds: [c.id], time: r2(c.start + between(0.4, c.duration - 0.4)), linkAV: true })
    }
    if (x < 14.1) {
      if (!c) return null
      const mild = rng() < 0.5 ? 1.25 : 0.8
      // (Core polish B: half of them anywhere in 0.1x – 100x, drawn from a
      // stream of their own, so the other draws of a seed stay what they were.)
      const speed = (o.speeds ?? true) && rngS() < 0.5 ? SPEEDS[Math.floor(rngS() * SPEEDS.length)] : mild
      // (Core polish C: a third of them a speed curve instead — 2 to 4 points,
      // or none again — from a stream of their own.)
      if ((o.curves ?? true) && rngC() < 0.34) {
        if (rngC() < 0.15) return u('speed', { t: 'curve', clipId: c.id, curve: null })
        const n = 2 + Math.floor(rngC() * 3)
        const points = Array.from({ length: n }, (_, i) => ({ u: i === 0 ? 0 : i === n - 1 ? 1 : r2(rngC()), v: CURVE_SPEEDS[Math.floor(rngC() * CURVE_SPEEDS.length)] })).sort((a, b) => a.u - b.u)
        return u('speed', { t: 'curve', clipId: c.id, curve: { points, ...(rngC() < 0.3 ? { linear: true } : {}) } })
      }
      return batch('speed', 'clip.setSpeed', { clipId: c.id, speed, linkAV: true })
    }
    if (x < 14.9) return c ? u('copy', { t: 'copy', clipId: c.id }) : null
    if (x < 15.9) {
      if (!c) return null
      const ripple = rng() < 0.2
      return batch(ripple ? 'rippleDelete' : 'delete', 'clip.delete', { ids: [c.id], ...(ripple ? { ripple } : {}) })
    }
    if (x < 16.5) {
      const a = pool.pop()
      return a ? batch('add', 'clip.add', { assetId: a, trackId: null, start: r2(between(0, d)) }) : null
    }
    if (x < 18) {
      const t = r2(between(0, Math.max(0.1, d)))
      const y = rng()
      if (y < 0.34) return batch('mark', 'marker.add', { time: t })
      if (y < 0.67) return batch('mark', 'text.add', { time: t, text: 'User title' })
      return u('note', { t: 'note', start: t })
    }
    if (x < 18.8) return u('lock', { t: 'lock', track: pick(p.tracks).id })
    if (x < 19.1) return batch('reorder', 'track.move', { trackId: pick(p.tracks).id, dir: rng() < 0.5 ? -1 : 1 })
    if (x < 19.8) {
      const l = pick(wordLines(p))
      if (!l) return null
      // A typo fix that keeps the words, or one that splits a word in two.
      return batch('capText', 'caption.editLine', { id: l.id, text: rng() < 0.5 ? `${l.text}.` : l.text.replace(/(\w{2})(\w{2,})/, '$1 $2') })
    }
    if (x < 20.3) {
      // (wild: no line's end set by hand, so a line's end past its last
      // word is always the app's: oracle/lines.ts, tail.)
      if (o.wild) return null
      const l = pick(wordLines(p))
      return l ? batch('capTime', 'caption.editLine', { id: l.id, end: r2(l.end + 0.15) }) : null
    }
    return c ? batch('prop', 'clip.setVolume', { clipId: c.id, volume: r2((c.volume + 0.21) % 1.5) }) : null
  }

  const cutsOn = (p: Project): Iv[] => {
    const out: Iv[] = []
    for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) {
      const r = rangeOn(p, 1.5)
      if (r) out.push(r)
    }
    return out
  }

  const next = (): Step[] => {
    // Which agent acts (with several: mostly the first session, then the
    // other program, then a second session of the first).
    if (o.two) {
      const y = rng()
      who = y < 0.45 ? 0 : y < 0.8 ? 2 : 1
      if (rng() < 0.06) return [{ k: 'mode', mode: rng() < 0.5 ? 'draft' : 'direct' }]
    }
    const me = run.agents[who]
    if (!me.seen) return [{ k: 'read', ...W() }]
    if (o.wild) {
      // (wild is the user's: the agent only reads now and then. Its edits on
      // the clips this kind takes to 100x and back are another hunt — the
      // first such run is in the audit patch's report.)
      if (rng() < 0.08) return [{ k: 'read' }]
      const st = userStep()
      return st ? [st] : []
    }
    if (o.pure) {
      // A fresh read, then one op written on it.
      return [{ k: 'read' }]
    }
    const x = rng() * (o.agentOnly ? 12 : 21)
    if (x < 2) return [{ k: 'read', ...W() }]
    if (x < 2.8) {
      const view = run.d.read(who)
      const ranges = cutsOn(view.project)
      // (Now and then a retake: the first range is cut FOR another stretch.)
      const kept = ranges.length && rng() < 0.3 ? rangeOn(view.project, 2) : null
      const keeps = kept && (kept[1] <= ranges[0][0] || kept[0] >= ranges[0][1]) ? [kept, ...ranges.slice(1).map(() => null)] : undefined
      return ranges.length ? [{ k: 'analyze', ranges, ...(keeps ? { keeps } : {}), ...W() }] : []
    }
    if (x < 8.8) {
      // Mostly on the version just read; sometimes on the one before.
      const st = editStep(me.old && rng() < (o.two ? 0.3 : 0.15) ? 1 : 0, 1 + Math.floor(rng() * 3))
      return st ? [st] : []
    }
    if (x < 9.8) {
      // Two calls on one read, one after the other (both written before
      // either is sent).
      return [editStep(0, 1 + Math.floor(rng() * 2)), editStep(0, 1 + Math.floor(rng() * 2))].filter((s): s is Step => !!s)
    }
    if (x < 12) {
      const dn = run.d.draft()
      if (!dn) return []
      const y = rng()
      // (Now and then the user changes something between the card and the
      // accept: a lock, a marker.)
      const late = (): { late?: { cls: string; act: UserAct } } => {
        if (o.agentOnly || rng() > 0.2) return {}
        const tr = pick(S().project.tracks)
        return { late: rng() < 0.7 ? { cls: 'lock', act: { t: 'lock', track: tr.id } } : { cls: 'mark', act: { t: 'batch', name: 'marker.add', params: { time: r2(between(0, 20)) } } } }
      }
      if (dn.retired.length && rng() < 0.15) {
        const q = pick(dn.retired)
        return [{ k: 'revive', seq: q.seq, op: q.index }]
      }
      if (y < 0.45) return [{ k: 'accept', ...late() }]
      if (y < 0.7) return [{ k: 'accept', seqs: dn.seqs.filter(() => rng() < 0.5), ...late() }]
      if (y < 0.88) {
        const cuts = run.ops.filter((q) => !q.refused && q.seq !== undefined && q.raw.op === 'timeline.cutRanges' && (q.raw.ranges as unknown[]).length > 1)
        if (!cuts.length) return []
        const q = pick(cuts)
        return [{ k: 'remove', seq: q.seq!, op: q.index, range: Math.floor(rng() * (q.raw.ranges as unknown[]).length) }]
      }
      return [{ k: 'reject' }]
    }
    const st = userStep()
    return st ? [st] : []
  }

  try {
    let guard = 0
    while (run.step < want && guard++ < want * 8) {
      for (const st of next()) if (await run.exec(st)) steps.push(st)
      if (o.pure && run.seen) {
        who = 0
        const st = editStep(0, 1)
        if (st && (await run.exec(st))) steps.push(st)
      }
    }
    return { seed: o.seed, shape: shapeIndex, shapeName: shape.name, mode, steps, log: run.log, violations: run.violations, obs: run.obs, judged: run.judged }
  } finally {
    run.dispose()
  }
}

/** The same steps again, without the generator. */
export async function replaySteps(c: { seed: number; shape: number; mode: 'draft' | 'direct'; steps: readonly Step[]; vary?: (s: Shape) => void; make?: () => Shape }): Promise<SequenceResult> {
  const shape = c.make ? c.make() : SHAPES[c.shape]()
  c.vary?.(shape)
  const run = new Run(shape, c.mode, c.seed)
  const done: Step[] = []
  try {
    for (const st of c.steps) if (await run.exec(st)) done.push(st)
    return { seed: c.seed, shape: c.shape, shapeName: shape.name, mode: c.mode, steps: done, log: run.log, violations: run.violations, obs: run.obs, judged: run.judged }
  } finally {
    run.dispose()
  }
}

/** A failing sequence with every step that is not needed for a violation of
 *  the same kind taken out. */
export async function shrink(r: SequenceResult, vary?: (s: Shape) => void, make?: () => Shape): Promise<SequenceResult> {
  const kind = r.violations[0]?.kind
  if (!kind) return r
  const fails = (x: SequenceResult): boolean => x.violations.some((v) => v.kind === kind)
  let best = r
  for (let changed = true; changed; ) {
    changed = false
    for (let i = best.steps.length - 1; i >= 0; i--) {
      const steps = best.steps.filter((_, k) => k !== i)
      const t = await replaySteps({ seed: r.seed, shape: r.shape, mode: r.mode, steps, vary, make })
      if (fails(t)) {
        best = t
        changed = true
      }
    }
    // An edit with several ops: one op at a time.
    for (let i = 0; i < best.steps.length; i++) {
      const st = best.steps[i]
      if (st.k !== 'edit' || st.ops.length < 2) continue
      for (let j = st.ops.length - 1; j >= 0 && (best.steps[i] as typeof st).ops.length > 1; j--) {
        const cur = best.steps[i] as typeof st
        const steps = best.steps.map((s, k) => (k === i ? { ...cur, ops: cur.ops.filter((_, q) => q !== j) } : s))
        const t = await replaySteps({ seed: r.seed, shape: r.shape, mode: r.mode, steps, vary, make })
        if (fails(t) && t.steps.length === steps.length) {
          best = t
          changed = true
        }
      }
    }
  }
  return best
}

// ---- many sequences, counted ---------------------------------------------------

export interface Tally {
  sequences: number
  steps: number
  failing: number
  /** Sequences with at least one violation of the kind. */
  byKind: Record<string, number>
  /** Per kind of user change since the op was read (alone, or the mix): how
   *  many cut and placement ops whose content was still there, and how many
   *  of those were dropped. */
  liveness: Record<string, { ops: number; dropped: number }>
  /** Ops dropped with no user step since their read and before any choice
   *  of the user's (accept a part, take a range out), by op name. */
  agentDrops: Record<string, number>
  /** Structural ops: sent, dropped (by the user's kinds of change). */
  structural: { ops: number; dropped: number }
  /** Structural ops with ids or seconds dropped because an earlier edit of
   *  the agent's own changed the layout they were written on (reported; the
   *  content families have no such drop). */
  framed?: number
  /** Drops that are no loss by the oracle's own reckoning (never by the
   *  reason the core gave): already done, a clip too short to make, told and
   *  replaced (B11), a literal op after the agent's own layout change. */
  exempt: Record<string, number>
  /** Applied ops judged in full (content) and for their context only (literal). */
  judged: { content: number; literal: number }
  firstFailures: { seed: number; shape: string; mode: string; kind: string; step: number; op?: string; detail: string }[]
  firstDrops: { seed: number; step: number; name: string }[]
  /** Cut and placement ops dropped (their classes and the core's reason),
   *  the first ones: where a must-stay-alive break comes from. */
  liveDrops?: { seed: number; step: number; name: string; classes: string; reason?: string }[]
  /** Sequences with a user's high speed (22x or more, a curve's point
   *  included), a speed curve, a cut that left the music bed alone, and all
   *  three (audit patch yama-c, D5). */
  mix?: { high: number; curve: number; keptCut: number; all: number }
  ms: number
}

export const emptyTally = (): Tally => ({ sequences: 0, steps: 0, failing: 0, byKind: {}, liveness: {}, agentDrops: {}, structural: { ops: 0, dropped: 0 }, exempt: {}, judged: { content: 0, literal: 0 }, firstFailures: [], firstDrops: [], ms: 0 })

/** Which of the audit's three a sequence holds (Tally.mix). */
export function mixOf(steps: readonly Step[]): { high: boolean; curve: boolean; keptCut: boolean } {
  const acts = steps.flatMap((s) => (s.k === 'user' ? [s.act] : []))
  const high = acts.some((a) => (a.t === 'batch' && a.name === 'clip.setSpeed' && Number(a.params.speed) >= 22) || (a.t === 'curve' && !!a.curve?.points.some((x) => x.v >= 22)))
  const curve = acts.some((a) => a.t === 'curve' && !!a.curve)
  const keptCut = acts.some((a) => a.t === 'cutKeep' || (a.t === 'silenceKeep' && a.keep.length > 0))
  return { high, curve, keptCut }
}

export function addTo(tally: Tally, r: SequenceResult): void {
  tally.sequences++
  const m = mixOf(r.steps)
  const mix = (tally.mix ??= { high: 0, curve: 0, keptCut: 0, all: 0 })
  if (m.high) mix.high++
  if (m.curve) mix.curve++
  if (m.keptCut) mix.keptCut++
  if (m.high && m.curve && m.keptCut) mix.all++
  tally.steps += r.steps.length
  tally.judged.content += r.judged.content
  tally.judged.literal += r.judged.literal
  if (r.violations.length) {
    tally.failing++
    for (const kind of new Set(r.violations.map((v) => v.kind))) tally.byKind[kind] = (tally.byKind[kind] ?? 0) + 1
    if (tally.firstFailures.length < 12) {
      const v = r.violations[0]
      tally.firstFailures.push({ seed: r.seed, shape: r.shapeName, mode: r.mode, kind: v.kind, step: v.step, ...(v.op ? { op: v.op } : {}), detail: v.detail })
    }
  }
  for (const ob of r.obs) {
    if (ob.fam === 'structural') {
      tally.structural.ops++
      if (!ob.applied) tally.structural.dropped++
    }
    if (ob.own) {
      tally.exempt[ob.own] = (tally.exempt[ob.own] ?? 0) + 1
      if (ob.own === 'ownMoved') tally.framed = (tally.framed ?? 0) + 1
      continue
    }
    if (!ob.applied && ob.classes === '' && !ob.afterChoice) {
      tally.agentDrops[ob.name.split(' ')[0]] = (tally.agentDrops[ob.name.split(' ')[0]] ?? 0) + 1
      if (tally.firstDrops.length < 8) tally.firstDrops.push({ seed: r.seed, step: ob.step, name: ob.name })
    }
    if (ob.fam !== 'cut' && ob.fam !== 'place') continue
    if (ob.afterChoice) continue
    const row = (tally.liveness[ob.classes || 'none'] ??= { ops: 0, dropped: 0 })
    row.ops++
    if (!ob.applied) {
      row.dropped++
      const list = (tally.liveDrops ??= [])
      const MUST = ['none', 'cut', 'undo', 'redo', 'split', 'move', 'trim', 'delete', 'add', 'mark', 'note', 'prop', 'capText']
      if (list.length < 40 && (ob.classes || 'none').split('+').every((k) => MUST.includes(k))) list.push({ seed: r.seed, step: ob.step, name: ob.name, classes: ob.classes || 'none', ...(ob.reason ? { reason: ob.reason.slice(0, 200) } : {}) })
    }
  }
}

export async function runMany(seeds: Iterable<number>, base: Omit<SequenceOptions, 'seed'> = {}): Promise<Tally & { failed: SequenceResult[] }> {
  const t0 = Date.now()
  const tally = emptyTally()
  const failed: SequenceResult[] = []
  for (const seed of seeds) {
    const r = await runSequence({ ...base, seed })
    addTo(tally, r)
    if (r.violations.length) failed.push(r)
  }
  tally.ms = Date.now() - t0
  return { ...tally, failed }
}

/** The user's changes after which a cut or a placement whose content is
 *  still there must never be dropped (A8). */
export const ALWAYS_ALIVE = ['none', 'cut', 'undo', 'redo', 'split', 'move', 'trim', 'delete', 'add', 'mark', 'note', 'prop', 'capText']

/** The dropped ops among those that had to stay alive (a mix of kinds counts
 *  when every kind in it is on the list). */
export function livenessBreaks(t: Tally): { classes: string; dropped: number; ops: number }[] {
  return Object.entries(t.liveness)
    .filter(([k, v]) => v.dropped > 0 && k.split('+').every((c) => ALWAYS_ALIVE.includes(c)))
    .map(([classes, v]) => ({ classes, ...v }))
}
