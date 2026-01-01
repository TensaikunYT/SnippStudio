// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's many-clip effects: transitions and their sound, speed ramps,
// cinematic and gentle motion, still and ambient effects, picture moves,
// motion layers, the camera look and look layers, risers. Moved out of
// state/store.ts in SnippStudio phase 2B (no change).
import { generateMotionFx, removeMotionLayer } from '../../effects/cinematic'
import type { Clip } from '../../types'
import { isPictureAsset, neutralGrade, uid } from '../../types'
import { sortTrack } from '../../commands/ops/base'
import { setTransition } from '../../commands/clips'
import { cinematize, clearTransitions, gentlePan, mixTransitions, presetTransitions, risers, stillImageFx, transitionSfx } from '../../commands/effects'
import { env, runKey } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type EffectActions = Pick<EditorState, 
  | 'applyMixTransitions'
  | 'clearTransitions'
  | 'setTransitionOut'
  | 'cinematizeAll'
  | 'applyTransitionPreset'
  | 'applyRampInOut'
  | 'applyGentlePan'
  | 'applyStillImageFx'
  | 'clearStillImageFx'
  | 'applyAmbientFx'
  | 'clearAmbientFx'
  | 'editClipMoves'
  | 'setClipLook'
  | 'clearAllMotionFx'
  | 'setMotionFx'
  | 'rerollMotionFx'
  | 'removeClipMotionLayer'
  | 'setCameraLook'
  | 'setLayerLook'
  | 'setLookOver'
  | 'addLookLayer'
  | 'setRisers'
  | 'setTransitionSfx'
>

/** The merge key of a change of a clip's transition (Ç2a patch, item 6): by
 *  the clip and the fields that change, so a slider's run (its sound) is one
 *  undo step and a change of another field is a step of its own. Removing
 *  the transition has none. */
function transitionKey(was: Clip['transitionOut'], clipId: string, next: Clip['transitionOut'] | null): string | undefined {
  if (!next) return undefined
  const a = (was ?? {}) as Record<string, unknown>
  const b = next as Record<string, unknown>
  const changed = Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => [k, b[k]]))
  return runKey(`transition:${clipId}`, changed)
}

export function effectActions(set: SetState, get: GetState, mutate: Mutate): EffectActions {
  return {
    applyMixTransitions: (duration, trackId) => mutate((p) => mixTransitions.apply(p, { duration, trackId }, env())),

    clearTransitions: () => mutate((p) => clearTransitions.apply(p, {}, env())),

    setTransitionOut: (clipId, transition) =>
      mutate((p) => setTransition.apply(p, { clipId, transition: (transition ?? null) as never }, env()), false, transitionKey(get().project.clips[clipId]?.transitionOut, clipId, transition)),

    cinematizeAll: (intensity, trackId) => mutate((p) => cinematize.apply(p, { intensity, trackId }, env())),

    applyTransitionPreset: (type, duration, trackId) => mutate((p) => presetTransitions.apply(p, { type, duration, trackId }, env())),

    applyRampInOut: (direction, duration, trackId) =>
      mutate((p) => {
        const safeDuration = Math.max(0.1, Math.min(1.5, duration))
        for (const track of p.tracks) {
          if (track.kind !== 'video' || track.locked || (trackId && track.id !== trackId)) continue
          for (const clipId of track.clipIds) {
            const clip = p.clips[clipId]
            const asset = clip ? p.assets.find((candidate) => candidate.id === clip.assetId) : undefined
            if (!clip || !isPictureAsset(asset)) continue
            clip.anim = { ...clip.anim, in: direction, out: direction, inDur: safeDuration, outDur: safeDuration }
          }
        }
      }),

    applyGentlePan: (direction, amountPercent, trackId) =>
      mutate((p) => gentlePan.apply(p, { direction, amount: amountPercent, trackId }, env())),

    applyStillImageFx: (style, amount, trackId, only) => mutate((p) => stillImageFx.apply(p, { style, amount, trackId, only }, env())),

    clearStillImageFx: (trackId, only) =>
      mutate((p) => {
        for (const track of p.tracks) {
          if (track.kind !== 'video') continue
          if (trackId && track.id !== trackId) continue
          for (const clipId of track.clipIds) {
            if (only && !only.includes(clipId)) continue
            const clip = p.clips[clipId]
            if (clip) delete clip.stillImageFx
          }
        }
      }),

    applyAmbientFx: (style, amount, trackId, mediaKind, only) =>
      mutate((p) => {
        for (const track of p.tracks) {
          if (track.kind !== 'video' || (trackId && track.id !== trackId)) continue
          const sharedSeed = (Math.random() * 0x7fffffff) | 0
          for (const clipId of track.clipIds) {
            if (only && !only.includes(clipId)) continue
            const clip = p.clips[clipId]
            const asset = clip ? p.assets.find((candidate) => candidate.id === clip.assetId) : undefined
            if (!clip || !isPictureAsset(asset) || (mediaKind && asset.kind !== mediaKind)) continue
            clip.ambientFx = {
              style,
              amount: Math.max(0.05, Math.min(1, amount)),
              seed: clip.ambientFx?.timeOffset !== undefined ? clip.ambientFx.seed : sharedSeed,
              timeOffset: clip.start
            }
          }
        }
      }),

    clearAmbientFx: (trackId, mediaKind, style, only) =>
      mutate((p) => {
        for (const track of p.tracks) {
          if (track.kind !== 'video' || (trackId && track.id !== trackId)) continue
          for (const clipId of track.clipIds) {
            if (only && !only.includes(clipId)) continue
            const clip = p.clips[clipId]
            const asset = clip ? p.assets.find((candidate) => candidate.id === clip.assetId) : undefined
            if (clip && (!mediaKind || asset?.kind === mediaKind) && (!style || clip.ambientFx?.style === style)) delete clip.ambientFx
          }
        }
      }),

    editClipMoves: (clipId, fn, commit = true) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const mv = clip.moves ?? { actions: [] }
        fn(mv)
        mv.actions.sort((a, b) => a.time - b.time)
        if (mv.actions.length) clip.moves = mv
        else delete clip.moves
      }, commit),

    setClipLook: (ids, look) =>
      mutate((p) => {
        for (const id of ids) {
          const clip = p.clips[id]
          if (!clip || clip.adjustment) continue
          if (look) clip.look = { ...look }
          else delete clip.look
        }
      }),

    clearAllMotionFx: () =>
      mutate((p) => {
        for (const clip of Object.values(p.clips)) delete clip.motionFx
      }),

    setMotionFx: (clipId, patch) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        if (patch === null) {
          delete clip.motionFx
        } else if (clip.motionFx) {
          Object.assign(clip.motionFx, patch)
        } else {
          clip.motionFx = { ...generateMotionFx(0, 1, p), ...patch }
        }
      }, false, runKey(`motion-fx:${clipId}`, patch)),

    rerollMotionFx: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.motionFx) return
        clip.motionFx.seed = (Math.random() * 2 ** 31) | 0
      }),

    removeClipMotionLayer: (clipId, layer) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const next = removeMotionLayer(clip.motionFx, layer)
        if (next) clip.motionFx = next
        else delete clip.motionFx
      }),

    setCameraLook: (look, commit = true) =>
      mutate((p) => {
        if (!look) delete p.cameraLook
        else p.cameraLook = { ...look }
      }, commit, 'camera-look'),

    setLayerLook: (clipId, look, commit = true) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c?.adjustment) return
        if (!look) delete c.cameraLook
        else c.cameraLook = { ...look }
      }, commit, `layer-look:${clipId}`),

    setLookOver: (clipId, over) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c?.adjustment) return
        if (over === 'below') delete c.lookOver
        else c.lookOver = over
      }),

    addLookLayer: (look, start, end, over = 'below') => {
      const id = uid()
      const a = Math.max(0, start)
      const b = Math.max(a + 0.5, end)
      mutate((p) => {
        const free = (t: (typeof p.tracks)[number]): boolean =>
          t.clipIds.every((cid) => {
            const c = p.clips[cid]
            return !c || c.start >= b - 1e-6 || c.start + c.duration <= a + 1e-6
          })
        // The top video track if that stretch of it is free (and it holds
        // only layers), else a new track on top: it lies over the footage.
        let track = p.tracks.find((t) => t.kind === 'video')
        const onlyLayers = track ? track.clipIds.every((cid) => p.clips[cid]?.adjustment) : false
        if (!track || track.locked || track.hidden || !free(track) || !onlyLayers) {
          const count = p.tracks.filter((t) => t.kind === 'video').length
          track = { id: uid(), kind: 'video', name: `V${count + 1}`, clipIds: [] }
          p.tracks.unshift(track)
        }
        const { width, height } = p.settings
        const clip: Clip = {
          id,
          assetId: '',
          adjustment: true,
          trackId: track.id,
          start: a,
          inPoint: 0,
          duration: b - a,
          transform: { x: width / 2, y: height / 2, scale: 1, rotation: 0 },
          volume: 0,
          grade: neutralGrade(),
          ...(look ? { cameraLook: { ...look } } : {}),
          ...(over !== 'below' ? { lookOver: over } : {})
        }
        p.clips[id] = clip
        track.clipIds.push(id)
        sortTrack(p, track)
      })
      set({ selectedClipIds: [id], templateSel: null })
      return id
    },

    // (A slider: a run of moves is one step, Ç2a patch, item 6.)
    setRisers: (level, commit = true) => mutate((p) => risers.apply(p, { level }, env()), commit, 'risers'),

    setTransitionSfx: (level, commit = true) => mutate((p) => transitionSfx.apply(p, { level }, env()), commit, 'transition-sfx')
  }
}
