// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Pictures laid on the voice: numbered images on subtitle timing (Fit to
// voice and the agent, finishing touches included) and B-roll (the agent).
// Bodies as they were in state/store.ts and the old Automation window (phase 2A).
import type { Clip, Project, Track } from '../types'
import { isSubtitle, uid } from '../types'
import type { SubtitleImageMissingSlot, SubtitleImagePlacement } from '../subtitles/automation'
import type { BrollPlacement } from '../subtitles/broll'
import { placeSuggestions, type TemplateSuggestion } from '../subtitles/template-suggest'
import { containScale, findTrack, forgetClips, sortTrack } from './ops/base'
import { CommandError, defineCommand, type CommandEnv } from './core'
import { requireAsset } from './require'
import { cinematize, gentlePan, mixTransitions, risers, stillImageFx, transitionSfx } from './effects'
import { s } from './schema'

export interface AutomationOptions {
  replaceOverlaps?: boolean
  captionTextEdits?: Readonly<Record<string, string>>
  missingSlots?: readonly SubtitleImageMissingSlot[]
}

/** The finishing touches the dialog offers, on the layer the pictures land on. */
export interface AutomationFinish {
  motion?: 'none' | 'cinematic' | 'pan'
  transition?: 'none' | 'mix'
  glow?: boolean
  sound?: boolean
  /** Template suggestions kept (the dialog's Suggest panel). */
  suggestions?: readonly TemplateSuggestion[]
}

export interface AutomationPlan {
  ordered: SubtitleImagePlacement[]
  missingSlots: SubtitleImageMissingSlot[]
  captionTextEdits: [string, string][]
  existing: boolean
  trackId: string
  trackName: string
  replacedIds: Set<string>
  clipIds: string[]
  missingClipIds: string[]
}

/**
 * Checks a placement against the project and gives it its ids; null when it
 * cannot be laid down as asked (a missing or wrong picture, overlapping
 * spans, a locked or wrong target, an overlap not allowed to be replaced).
 */
export function planAutomation(
  project: Project,
  placements: readonly SubtitleImagePlacement[],
  target: string | 'new',
  opts: AutomationOptions = {}
): AutomationPlan | null {
  if (placements.length === 0 && !opts.missingSlots?.length) return null
  // A sorted copy: the store is the last line of defence for the timeline order.
  const ordered = [...placements].sort((a, b) => a.start - b.start || a.end - b.end)
  const missingSlots = [...(opts.missingSlots ?? [])].sort((a, b) => a.start - b.start || a.end - b.end)
  const intervals = [...ordered, ...missingSlots].sort((a, b) => a.start - b.start || a.end - b.end)
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  for (const placement of ordered) {
    const asset = assets.get(placement.assetId)
    if (
      !asset || asset.kind !== 'image' || asset.missing ||
      !Number.isFinite(placement.start) || !Number.isFinite(placement.end) ||
      placement.start < 0 || placement.end <= placement.start
    ) return null
  }
  for (let i = 0; i < intervals.length; i++) {
    const item = intervals[i]
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end) ||
      item.start < 0 || item.end <= item.start ||
      (i > 0 && item.start < intervals[i - 1].end - 1e-6)) return null
  }
  if (missingSlots.some((slot) => !Number.isInteger(slot.number) || slot.number < 1)) return null

  const placementCaptionIds = new Set(intervals.flatMap((item) => item.captionIds))
  const captionTextEdits = Object.entries(opts.captionTextEdits ?? {})
  for (const [captionId, text] of captionTextEdits) {
    const caption = project.captions.find((candidate) => candidate.id === captionId)
    // Text edits may only touch subtitle cues in this plan.
    if (!placementCaptionIds.has(captionId) || !caption || !isSubtitle(caption) || !text.trim()) return null
  }

  const existing = target === 'new' ? null : findTrack(project, target)
  if (target !== 'new' && (!existing || existing.kind !== 'video' || existing.locked)) return null

  const rangeStart = intervals[0].start
  const rangeEnd = intervals.reduce((end, item) => Math.max(end, item.end), intervals[0].end)
  const replacedIds = new Set<string>()
  if (existing) {
    for (const id of existing.clipIds) {
      const clip = project.clips[id]
      if (clip && clip.start < rangeEnd - 1e-6 && clip.start + clip.duration > rangeStart + 1e-6) replacedIds.add(id)
    }
    if (replacedIds.size > 0 && !opts.replaceOverlaps) return null
  }

  let trackId: string
  let trackName: string
  if (existing) {
    trackId = existing.id
    trackName = existing.name
  } else {
    const used = new Set(project.tracks.map((track) => track.name.toLocaleLowerCase()))
    trackName = 'AUTO'
    for (let n = 2; used.has(trackName.toLocaleLowerCase()); n++) trackName = `AUTO ${n}`
    trackId = uid()
  }
  const clipIds = ordered.map(() => uid())
  const missingClipIds = missingSlots.map(() => uid())
  return { ordered, missingSlots, captionTextEdits, existing: !!existing, trackId, trackName, replacedIds, clipIds, missingClipIds }
}

/** Lays a plan down, then the finishing touches. */
export function applyAutomation(p: Project, plan: AutomationPlan, finish: AutomationFinish | undefined, env: CommandEnv): void {
  const { ordered, missingSlots, captionTextEdits, trackId, trackName, replacedIds, clipIds, missingClipIds } = plan
  for (const [captionId, text] of captionTextEdits) {
    const caption = p.captions.find((candidate) => candidate.id === captionId)
    if (caption) caption.text = text.trim()
  }
  let track = findTrack(p, trackId)
  if (!track) {
    track = { id: trackId, kind: 'video', name: trackName, clipIds: [], autoPack: false }
    // Video tracks are stored top-first: the layer shows above the edit.
    p.tracks.unshift(track)
  } else {
    // Auto-pack would close intentional subtitle gaps on the next pack.
    track.autoPack = false
    if (replacedIds.size > 0) {
      track.clipIds = track.clipIds.filter((id) => !replacedIds.has(id))
      for (const id of replacedIds) delete p.clips[id]
      forgetClips(p, replacedIds)
    }
  }
  const { width, height } = p.settings
  ordered.forEach((placement, index) => {
    const asset = p.assets.find((candidate) => candidate.id === placement.assetId)!
    const clip: Clip = {
      id: clipIds[index],
      assetId: asset.id,
      trackId: track!.id,
      start: placement.start,
      inPoint: 0,
      duration: placement.end - placement.start,
      transform: { x: width / 2, y: height / 2, scale: containScale(p, asset), rotation: 0 },
      volume: 1
    }
    p.clips[clip.id] = clip
    track!.clipIds.push(clip.id)
  })
  missingSlots.forEach((slot, index) => {
    const clip: Clip = {
      id: missingClipIds[index],
      assetId: '',
      trackId: track!.id,
      start: slot.start,
      inPoint: 0,
      duration: slot.end - slot.start,
      transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0 },
      volume: 0,
      automationMissing: { number: slot.number, text: slot.text, captionIds: [...slot.captionIds] }
    }
    p.clips[clip.id] = clip
    track!.clipIds.push(clip.id)
  })
  sortTrack(p, track)

  if (!finish) return
  // The finishing touches, on the layer the pictures landed on (they were
  // separate store calls inside one undo step in the dialog).
  if (finish.motion === 'cinematic') cinematize.apply(p, { intensity: 0.5, trackId }, env)
  else if (finish.motion === 'pan') gentlePan.apply(p, { direction: 'left-to-right', amount: 6, trackId }, env)
  if (finish.transition === 'mix') mixTransitions.apply(p, { duration: 0.45, trackId }, env)
  if (finish.glow) stillImageFx.apply(p, { style: 'light-glow', amount: 0.35, trackId }, env)
  if (finish.sound) {
    // Heard, but under the voice: the transitions' sounds, the build-ups.
    if ((p.transitionSfx ?? 0.5) < 0.5) transitionSfx.apply(p, { level: 0.5 }, env)
    // A transition is silent unless given a sound (DENEME-3, V item 2): the
    // finish that asks for sound gives one to the transitions of its layer.
    for (const id of track?.clipIds ?? []) {
      const tr = p.clips[id]?.transitionOut
      if (tr && tr.sfx === undefined) tr.sfx = 1
    }
    if (!p.risers) risers.apply(p, { level: 0.6 }, env)
  }
  const kept = finish.suggestions ?? []
  if (kept.length) {
    // A run again replaces what the last one put at the same moments.
    p.templates = (p.templates ?? []).filter((t) => !kept.some((k) => k.kind === t.kind && Math.abs(k.start - t.start) < 0.3))
    placeSuggestions(p, kept, env.random)
  }
}

const span = {
  captionIds: s.array(s.id()),
  text: s.string({ max: 4000 }),
  start: s.time(),
  end: s.time(),
  duration: s.number({ min: 0 })
}

export const placeImages = defineCommand({
  name: 'automation.placeImages',
  summary: 'Lay numbered pictures on their subtitle spans (one picture per span) on a new AUTO layer or an existing video track, with optional finishing touches.',
  params: s.object({
    placements: s.array(s.object({ ...span, assetId: s.id(), assetName: s.string({ max: 400 }) })),
    target: s.id('"new" for a new layer, or a video track id'),
    replaceOverlaps: s.optional(s.boolean()),
    captionTextEdits: s.optional(s.record(s.string({ min: 1, max: 4000 }))),
    missingSlots: s.optional(s.array(s.object({ ...span, number: s.integer({ min: 1 }) }))),
    finish: s.optional(s.object({
      motion: s.optional(s.enum(['none', 'cinematic', 'pan'] as const)),
      transition: s.optional(s.enum(['none', 'mix'] as const)),
      glow: s.optional(s.boolean()),
      sound: s.optional(s.boolean()),
      suggestions: s.optional(s.array(s.object({
        key: s.optional(s.string({ max: 200 })),
        kind: s.string({ min: 1, max: 40, description: 'A template kind' }),
        start: s.time(),
        duration: s.number({ min: 0.3, max: 120 }),
        from: s.optional(s.integer({ min: 0 })),
        to: s.optional(s.integer({ min: 0 })),
        title: s.optional(s.string({ max: 300 })),
        word: s.optional(s.string({ max: 300 })),
        items: s.array(s.object({ title: s.string({ max: 300 }), note: s.optional(s.string({ max: 300 })), value: s.optional(s.number()), value2: s.optional(s.number()) }), { max: 40 })
      }), { max: 200 }))
    }))
  }),
  apply(p, a, env): { trackId: string; trackName: string; clipIds: string[] } {
    const plan = planAutomation(p, a.placements, a.target, a)
    if (!plan) throw new CommandError('automation.placeImages', 'the pictures cannot be placed as asked (a missing or non-image picture, overlapping spans, a locked or non-video target, or an overlap not allowed to be replaced)')
    applyAutomation(p, plan, a.finish as AutomationFinish | undefined, env)
    return { trackId: plan.trackId, trackName: plan.trackName, clipIds: plan.clipIds }
  }
})

/** The placements whose media can go on the timeline, in time order. */
export function usableBroll(p: Project, placements: readonly BrollPlacement[]): BrollPlacement[] {
  const assets = new Map(p.assets.map((a) => [a.id, a]))
  return [...placements]
    .filter((q) => {
      const a = assets.get(q.assetId)
      return a && !a.missing && (a.kind === 'image' || a.kind === 'video') && Number.isFinite(q.start) && q.end > q.start && q.start >= 0
    })
    .sort((a, b) => a.start - b.start)
}

export const placeBroll = defineCommand({
  name: 'broll.place',
  summary: 'Lay B-roll pictures or clips on a new B-ROLL layer at the times they were found, as a card beside the speaker or full frame.',
  params: s.object({
    placements: s.array(s.object({ assetId: s.id(), start: s.time(), end: s.time(), said: s.optional(s.string()), captionId: s.optional(s.string()) }), { min: 1 }),
    look: s.enum(['card', 'full'] as const)
  }),
  check(p, { placements }) {
    let prevEnd = 0
    placements.forEach((q, i) => {
      requireAsset(p, q.assetId, 'broll.place')
      if (q.end <= q.start) throw new CommandError('broll.place', `#${i + 1}: end must be after start`)
      if (q.start < prevEnd - 1e-6) throw new CommandError('broll.place', `#${i + 1} (${q.start}–${q.end}) overlaps the one before or is out of order: give them in time order, not overlapping`)
      prevEnd = q.end
    })
  },
  apply(p, { placements, look }): { trackId: string; trackName: string; clipIds: string[] } | null {
    const ordered = usableBroll(p, placements as unknown as BrollPlacement[])
    if (!ordered.length) return null
    const used = new Set(p.tracks.map((track) => track.name.toLocaleLowerCase()))
    let trackName = 'B-ROLL'
    for (let n = 2; used.has(trackName.toLocaleLowerCase()); n++) trackName = `B-ROLL ${n}`
    const trackId = uid()
    const clipIds = ordered.map(() => uid())
    const track: Track = { id: trackId, kind: 'video', name: trackName, clipIds: [], autoPack: false }
    p.tracks.unshift(track)
    const { width: W, height: H } = p.settings
    let prevEnd = 0
    ordered.forEach((q, i) => {
      const asset = p.assets.find((a) => a.id === q.assetId)!
      const aw = Math.max(1, asset.width)
      const ah = Math.max(1, asset.height)
      const card = look === 'card'
      // A card sits beside the speaker, sides taking turns; full frame covers.
      const scale = card ? Math.min((0.4 * W) / aw, (0.5 * H) / ah) : Math.max(W / aw, H / ah)
      const x = card ? W * (i % 2 === 0 ? 0.72 : 0.28) : W / 2
      const y = card ? H * 0.42 : H / 2
      const start = Math.max(prevEnd, q.start)
      prevEnd = q.end
      const clip: Clip = {
        id: clipIds[i],
        assetId: asset.id,
        trackId,
        start,
        inPoint: 0,
        duration: q.end - start,
        transform: { x, y, scale, rotation: 0 },
        volume: asset.kind === 'video' ? 0 : 1,
        anim: { in: card ? ('pop' as const) : ('fade' as const), inDur: 0.35, out: 'fade' as const, outDur: 0.3 }
      }
      p.clips[clip.id] = clip
      track.clipIds.push(clip.id)
    })
    sortTrack(p, track)
    return { trackId, trackName, clipIds }
  }
})
