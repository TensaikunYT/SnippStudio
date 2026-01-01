// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Transitions over a whole track, slow motion over stills (Cinematize, gentle
// pan), the still-image light, and the project-wide transition and riser
// sounds. Bodies as they were in state/store.ts (phase 2A); the random seeds
// come from env.random.
import type { Clip, StillImageFxStyle } from '../types'
import { JOIN_EPS } from '../playback/join'
import { generateChainMotion, generateGentlePanMotion, mergeCinematicMotion, mergeGentlePanMotion } from '../effects/cinematic'
import type { Project } from '../types'
import { defineCommand } from './core'
import { requireClip, requireTrack } from './require'

/** A command over the video tracks, or one of them: it must be a video track
 *  and not locked. */
const videoTrackOk = (cmd: string) => <T extends { trackId?: string; only?: string[] }>(p: Project, a: T): void => {
  if (a.trackId) requireTrack(p, a.trackId, cmd, { edit: true, kind: 'video' })
  for (const id of a.only ?? []) requireClip(p, id, cmd)
}
import { s } from './schema'
import { TRANSITION_LIMITS } from '../timeline/transition-links'
import { TRANSITION_TYPES } from './clips'

const trackId = s.optional(s.id('Only this video track (default: every video track)'))

export const mixTransitions = defineCommand({
  name: 'transitions.mix',
  summary: 'Put a mix (cross-dissolve) of `duration` seconds on every cut where two clips touch.',
  params: s.object({ duration: s.number({ min: TRANSITION_LIMITS.min, max: TRANSITION_LIMITS.max, description: 'seconds' }), trackId }),
  check: videoTrackOk('transitions.mix'),
  apply(p, { duration, trackId }): void {
    for (const track of p.tracks) {
      // (A locked track is left as it is: phase Ç2b.1, report L7.)
      if (track.locked) continue
      if (track.kind !== 'video') continue
      if (trackId && track.id !== trackId) continue
      const clips = track.clipIds
        .map((id) => p.clips[id])
        .filter(Boolean)
        .sort((a, b) => a.start - b.start)
      for (let i = 0; i < clips.length - 1; i++) {
        const cur = clips[i]
        const next = clips[i + 1]
        // Only where the next clip starts where this one ends, and not
        // between adjustment layers.
        if (cur.adjustment || next.adjustment) continue
        if (Math.abs(next.start - (cur.start + cur.duration)) < JOIN_EPS) {
          cur.transitionOut = { type: 'mix', duration }
        }
      }
    }
  }
})

export const presetTransitions = defineCommand({
  name: 'transitions.preset',
  summary: 'Put one kind of transition (0.05–5 s) on every cut where two clips touch.',
  params: s.object({ type: s.enum(TRANSITION_TYPES), duration: s.number({ min: TRANSITION_LIMITS.min, max: TRANSITION_LIMITS.max, description: 'seconds' }), trackId }),
  check: videoTrackOk('transitions.preset'),
  apply(p, { type, duration, trackId }): void {
    const safeDuration = Math.max(TRANSITION_LIMITS.min, Math.min(TRANSITION_LIMITS.max, duration))
    for (const track of p.tracks) {
      // (A locked track is left as it is: phase Ç2b.1, report L7.)
      if (track.locked) continue
      if (track.kind !== 'video' || (trackId && track.id !== trackId)) continue
      const clips = track.clipIds.map((id) => p.clips[id]).filter(Boolean).sort((a, b) => a.start - b.start)
      for (let i = 0; i < clips.length - 1; i++) {
        const cur = clips[i]
        const next = clips[i + 1]
        if (cur.adjustment || next.adjustment) continue
        if (Math.abs(next.start - (cur.start + cur.duration)) < JOIN_EPS) {
          cur.transitionOut = { type, duration: safeDuration, align: 'auto' }
        }
      }
    }
  }
})

export const clearTransitions = defineCommand({
  name: 'transitions.clear',
  summary: 'Remove every transition between clips.',
  params: s.object({}),
  apply(p): void {
    // (A locked track keeps its clips' transitions: Ç2b patch, item 4.)
    const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
    for (const clip of Object.values(p.clips)) if (!locked.has(clip.trackId)) delete clip.transitionOut
  }
})

export const cinematize = defineCommand({
  name: 'motion.cinematize',
  summary: 'Slow camera motion (push, pan) over every clip; back-to-back clips share one continuous move.',
  params: s.object({ intensity: s.number({ min: 0, max: 1 }), trackId }),
  check: videoTrackOk('motion.cinematize'),
  apply(p, { intensity, trackId }, env): void {
    let chainIndex = 0
    for (const track of p.tracks) {
      // (A locked track is left as it is: phase Ç2b.1, report L7.)
      if (track.locked) continue
      if (track.kind !== 'video') continue
      if (trackId && track.id !== trackId) continue
      const clips = track.clipIds
        .map((id) => p.clips[id])
        .filter(Boolean)
        .sort((a, b) => a.start - b.start)
      // Back-to-back clips form one chain that shares a single continuous
      // motion — no reset at the cuts.
      const sharedSeed = (env.random() * 0x7fffffff) | 0
      let chain: Clip[] = []
      const flush = () => {
        if (chain.length === 0) return
        const fxs = generateChainMotion(
          chain.map((c) => c.duration),
          chainIndex++,
          intensity,
          p,
          sharedSeed,
          chain[0].start
        )
        chain.forEach((c, i) => (c.motionFx = mergeCinematicMotion(c.motionFx, fxs[i])))
        chain = []
      }
      for (const clip of clips) {
        const prev = chain[chain.length - 1]
        if (prev && Math.abs(prev.start + prev.duration - clip.start) > 0.05) flush()
        chain.push(clip)
      }
      flush()
    }
  }
})

export const gentlePan = defineCommand({
  name: 'motion.gentlePan',
  summary: 'A gentle pan across every clip, in one direction (or mixed).',
  params: s.object({
    direction: s.enum(['left-to-right', 'right-to-left', 'bottom-to-top', 'top-to-bottom', 'alternate-horizontal', 'alternate-vertical', 'mixed'] as const),
    amount: s.number({ min: 0, max: 50, description: 'Percent of the frame' }),
    trackId
  }),
  check: videoTrackOk('motion.gentlePan'),
  apply(p, { direction, amount: amountPercent, trackId }, env): void {
    const mixedSeed = (env.random() * 0x7fffffff) | 0
    let mixedIndex = 0
    for (const track of p.tracks) {
      // (A locked track is left as it is: phase Ç2b.1, report L7.)
      if (track.locked) continue
      if (track.kind !== 'video') continue
      if (trackId && track.id !== trackId) continue
      const clips = track.clipIds
        .map((id) => p.clips[id])
        .filter(Boolean)
        .sort((a, b) => a.start - b.start)
      clips.forEach((clip, index) => {
        const sequenceIndex = direction === 'mixed' ? mixedIndex++ : index
        const gentle = generateGentlePanMotion(sequenceIndex, direction, amountPercent, p, mixedSeed)
        clip.motionFx = mergeGentlePanMotion(clip.motionFx, gentle)
      })
    }
  }
})

export const STILL_FX = ['window-light', 'golden-hour', 'anamorphic', 'haze', 'dust', 'light-glow', 'light-leak', 'shimmer'] as const

export const stillImageFx = defineCommand({
  name: 'fx.stillImage',
  summary: 'A light effect over the still pictures (not video): glow, golden hour, haze…',
  params: s.object({ style: s.enum(STILL_FX), amount: s.number({ min: 0, max: 1 }), trackId, only: s.optional(s.array(s.id())) }),
  check: videoTrackOk('fx.stillImage'),
  apply(p, { style, amount, trackId, only }, env): void {
    for (const track of p.tracks) {
      // (A locked track is left as it is: phase Ç2b.1, report L7.)
      if (track.locked) continue
      if (track.kind !== 'video') continue
      if (trackId && track.id !== trackId) continue
      const sharedSeed = (env.random() * 0x7fffffff) | 0
      for (const clipId of track.clipIds) {
        if (only && !only.includes(clipId)) continue
        const clip = p.clips[clipId]
        const asset = clip ? p.assets.find((candidate) => candidate.id === clip.assetId) : undefined
        if (!clip || asset?.kind !== 'image') continue
        clip.stillImageFx = {
          style: style as StillImageFxStyle,
          amount: Math.max(0.05, Math.min(1, amount)),
          seed: sharedSeed,
          timeOffset: clip.start
        }
      }
    }
  }
})

export const transitionSfx = defineCommand({
  name: 'audio.transitionSfx',
  summary: 'How loud the transitions\' own sounds are, 0–1 (a transition has one only when the user gives it one).',
  params: s.object({ level: s.number({ min: 0, max: 1 }) }),
  apply(p, { level }): void {
    p.transitionSfx = Math.max(0, Math.min(1, level))
  }
})

export const risers = defineCommand({
  name: 'audio.risers',
  summary: 'A build-up sound into every big moment, this loud (0 = none).',
  params: s.object({ level: s.number({ min: 0, max: 1 }) }),
  apply(p, { level }): void {
    const v = Math.max(0, Math.min(1, level))
    if (v > 0) p.risers = v
    else delete p.risers
  }
})
