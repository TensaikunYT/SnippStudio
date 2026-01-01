// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's one-clip actions: its look (crop, chroma, LUT, blur, grade,
// blend, effects), animation, framing, speed, sound (volume, fades, keyframes,
// cleaning, extracting, ducking) and pasted attributes. Moved out of
// state/store.ts in SnippStudio phase 2B (no change).
import { planDuckingKeyframes } from '../../audio/ducking'
import { automationGainAt } from '../../audio/envelope'
import type { Asset, Clip, FxKey } from '../../types'
import { defaultAudioFx, defaultBloom, defaultHalation, defaultIsolate, neutralGrade, neutralTone, uid } from '../../types'
import { fxAmountAt } from '../../playback/pose'
import { setFxBase } from '../../timeline/slice'
import { clone, freeTrackAt, sortTrack } from '../../commands/ops/base'
import { localAt, poseClip } from '../../commands/ops/keyframes'
import { keyLocalAt, keyOnFrame } from '../../timeline/key-grid'
import { setFades, setMuted, setOpacity, setSpeed, setSpeedCurve, setVolume } from '../../commands/clips'
import { env, runKey, tellKeyedOffClip } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type ClipActions = Pick<EditorState, 
  | 'toggleReverse'
  | 'setClipFlip'
  | 'rotate90'
  | 'setClipCrop'
  | 'setClipChroma'
  | 'setClipAudioFx'
  | 'setClipLut'
  | 'setClipLutAmount'
  | 'setClipTone'
  | 'setClipFx'
  | 'toggleFxKey'
  | 'addProjectLut'
  | 'updateProjectLut'
  | 'setClipBlur'
  | 'setClipAnim'
  | 'setClipIdle'
  | 'fillFrame'
  | 'fitFrame'
  | 'centerClip'
  | 'setClipBlendMode'
  | 'setClipEffect'
  | 'setClipSpeed'
  | 'setClipKeepPitch'
  | 'setClipSpeedCurve'
  | 'setClipGrade'
  | 'setClipVolume'
  | 'toggleClipMute'
  | 'setClipOpacity'
  | 'setClipFades'
  | 'setVolumeKeyframes'
  | 'addVolumeKeyframe'
  | 'dragVolumeKeyframe'
  | 'deleteVolumeKeyframe'
  | 'clearVolumeKeyframes'
  | 'applyCleanedAudio'
  | 'restoreOriginalAudio'
  | 'extractAudio'
  | 'applyAutoDucking'
  | 'clearAutoDucking'
  | 'pasteAttributes'
>

/** What a newly made key starts with: the chroma keyer ("cila" part D). */
const NEW_KEY = { method: 'chroma' as const, spill: 0.5, similarity: 0.4, smoothness: 0.1 }

export function clipActions(set: SetState, get: GetState, mutate: Mutate): ClipActions {
  /** Fit / Fill / Center write a key on a keyed channel; with the playhead
   *  off the clip none is written: say so (Ç2c patch, item 6). */
  const tellIfKeyedOff = (clipId: string, chs: ('x' | 'y' | 'scale')[]): void => {
    const c = get().project.clips[clipId]
    if (c && chs.some((ch) => (c.channels?.[ch]?.length ?? 0) > 0) && keyLocalAt(c, get().currentTime, get().project.settings.fps) === null) tellKeyedOffClip()
  }
  return {
    toggleReverse: (clipId) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (c) c.reversed = !c.reversed || undefined
      }),

    setClipFlip: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (patch.h !== undefined) c.flipH = patch.h || undefined
        if (patch.v !== undefined) c.flipV = patch.v || undefined
      }),

    rotate90: (clipId) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        // A keyed rotation turns every key (phase Ç2c.2, report K13: the
        // static value moved and nothing on screen did).
        const keys = c.channels?.rotation
        if (keys?.length) for (const k of keys) k.value += Math.PI / 2
        else c.transform.rotation += Math.PI / 2
      }),

    setClipCrop: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (patch === null) {
          delete c.crop
          return
        }
        c.crop = { l: 0, t: 0, r: 0, b: 0, ...c.crop, ...patch }
      }, false, runKey(`crop:${clipId}`, patch)),

    setClipChroma: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (patch === null) {
          delete c.chroma
          return
        }
        // A key made now is the chroma keyer's (the CbCr plane, despill); one
        // a project already has keeps its own method ("cila" part D).
        c.chroma = c.chroma ? { ...c.chroma, ...patch } : { enabled: true, color: '#00d000', ...NEW_KEY, ...patch }
      }, false, runKey(`chroma:${clipId}`, patch)),

    setClipAudioFx: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (patch === null) {
          delete c.audioFx
          return
        }
        const base = c.audioFx ?? defaultAudioFx()
        // comp/gate are patched field-by-field: the UI sends `{ comp: { ratio } }`
        // and must not wipe the threshold sitting beside it. `gate` also has to
        // survive projects saved before it existed.
        const gateBase = base.gate ?? defaultAudioFx().gate!
        c.audioFx = {
          ...base,
          ...patch,
          comp: { ...base.comp, ...(patch.comp ?? {}) },
          gate: { ...gateBase, ...(patch.gate ?? {}) }
        }
      }, false, runKey(`audio-fx:${clipId}`, patch)),

    setClipLut: (clipId, lut) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (lut) c.lut = lut
        else delete c.lut
      }),

    setClipLutAmount: (clipId, amount) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const v = Math.min(1, Math.max(0, amount))
        if (v >= 0.9995) delete c.lutAmount
        else c.lutAmount = v
      }, false, runKey(`lut-amount:${clipId}`)),

    setClipTone: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (patch === null) {
          delete c.tone
          return
        }
        c.tone = { ...neutralTone(), ...c.tone, ...patch }
      }, false, runKey(`tone:${clipId}`, patch)),

    setClipFx: (clipId, patch) => {
      const was = get().project.clips[clipId]
      if (!was) return
      const fps = get().project.settings.fps
      const local = keyLocalAt(was, get().currentTime, fps)
      // A keyed amount with the playhead off the clip: no key is written; say so.
      const keyedOff = (key: FxKey, v: unknown): boolean => v !== undefined && v !== null && (was.fxKeys?.[key]?.length ?? 0) > 0 && local === null
      if (keyedOff('bloom', patch.bloom?.amount) || keyedOff('halation', patch.halation?.amount) || keyedOff('mosaic', patch.mosaic) || keyedOff('isolate', patch.isolate?.amount)) tellKeyedOffClip()
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        /** An amount onto its key at the playhead, when it has keys (true: it had). */
        const onKey = (key: FxKey, v: number): boolean => {
          const keys = c.fxKeys?.[key]
          if (!keys?.length) return false
          if (local === null) return true
          const near = keyOnFrame(keys, local, fps)
          if (near) near.value = v
          else {
            keys.push({ id: uid(), time: local, value: v })
            keys.sort((a, b) => a.time - b.time)
          }
          return true
        }
        const dropKeys = (key: FxKey): void => {
          if (!c.fxKeys) return
          delete c.fxKeys[key]
          if (Object.keys(c.fxKeys).length === 0) delete c.fxKeys
        }
        if (patch.bloom !== undefined) {
          if (patch.bloom === null) {
            delete c.bloom
            dropKeys('bloom')
          } else {
            const { amount, ...rest } = patch.bloom
            c.bloom = { ...defaultBloom(), ...c.bloom, ...rest }
            if (amount !== undefined && !onKey('bloom', amount)) c.bloom.amount = amount
          }
        }
        if (patch.halation !== undefined) {
          if (patch.halation === null) {
            delete c.halation
            dropKeys('halation')
          } else {
            const { amount, ...rest } = patch.halation
            c.halation = { ...defaultHalation(), ...c.halation, ...rest }
            if (amount !== undefined && !onKey('halation', amount)) c.halation.amount = amount
          }
        }
        if (patch.mosaic !== undefined) {
          if (patch.mosaic === null) {
            delete c.mosaic
            dropKeys('mosaic')
          } else if (!onKey('mosaic', patch.mosaic)) {
            if (patch.mosaic <= 0) delete c.mosaic
            else c.mosaic = patch.mosaic
          }
        }
        if (patch.isolate !== undefined) {
          if (patch.isolate === null) {
            delete c.isolate
            dropKeys('isolate')
          } else {
            const { amount, ...rest } = patch.isolate
            c.isolate = { ...defaultIsolate(), ...c.isolate, ...rest }
            if (amount !== undefined && !onKey('isolate', amount)) c.isolate.amount = amount
          }
        }
      }, false, runKey(`fx:${clipId}`, patch))
    },

    toggleFxKey: (clipId, key) => {
      const was = get().project.clips[clipId]
      if (!was) return
      const fps = get().project.settings.fps
      const local = keyLocalAt(was, get().currentTime, fps)
      if (local === null) return tellKeyedOffClip()
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const keys = c.fxKeys?.[key] ?? []
        const near = keyOnFrame(keys, local, fps)
        if (!near) {
          c.fxKeys = c.fxKeys ?? {}
          c.fxKeys[key] = [...keys, { id: uid(), time: local, value: fxAmountAt(c, key, local) }].sort((a, b) => a.time - b.time)
          return
        }
        const left = keys.filter((k) => k !== near)
        if (left.length > 0) {
          c.fxKeys![key] = left
          return
        }
        // The last key: what it showed stays, as the effect's own amount.
        delete c.fxKeys![key]
        if (Object.keys(c.fxKeys!).length === 0) delete c.fxKeys
        setFxBase(c, key, near.value)
      })
    },

    addProjectLut: (lut, clipId) =>
      mutate((p) => {
        p.luts = [...(p.luts ?? []).filter((l) => l.name !== lut.name), { ...lut }]
        const c = clipId ? p.clips[clipId] : undefined
        if (c) c.lut = lut.name
      }),

    updateProjectLut: (name, patch) =>
      mutate((p) => {
        const lut = p.luts?.find((l) => l.name === name)
        if (lut) Object.assign(lut, patch)
        // (Where a file lives is no edit: as updateAsset.)
      }, 'outside', undefined, { media: true }),

    setClipBlur: (clipId, blur) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (blur <= 0.1) delete c.blur
        else c.blur = blur
      }, false, runKey(`blur:${clipId}`)),

    setClipAnim: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const next = { in: 'none' as const, out: 'none' as const, inDur: 0.5, outDur: 0.5, ...c.anim, ...patch }
        if (next.in === 'none' && next.out === 'none') delete c.anim
        else c.anim = next
      }, false, runKey(`anim:${clipId}`, patch)),

    setClipIdle: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const next = { style: 'none' as const, amount: 0.5, speed: 1, ...c.idle, ...patch }
        if (next.style === 'none' || next.amount <= 0) delete c.idle
        else c.idle = next
      }, false, runKey(`idle:${clipId}`, patch)),

    fillFrame: (clipId) => {
      const time = get().currentTime
      tellIfKeyedOff(clipId, ['x', 'y', 'scale'])
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const asset = p.assets.find((a) => a.id === c.assetId)
        const aw = c.nested ? p.settings.width : asset?.width
        const ah = c.nested ? p.settings.height : asset?.height
        if (!aw || !ah) return
        poseClip(c, localAt(c, time, p.settings.fps), {
          x: p.settings.width / 2,
          y: p.settings.height / 2,
          scale: Math.max(p.settings.width / aw, p.settings.height / ah)
        }, p.settings.fps)
      })
    },

    fitFrame: (clipId) => {
      const time = get().currentTime
      tellIfKeyedOff(clipId, ['x', 'y', 'scale'])
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const asset = p.assets.find((a) => a.id === c.assetId)
        const aw = c.nested ? p.settings.width : asset?.width
        const ah = c.nested ? p.settings.height : asset?.height
        if (!aw || !ah) return
        poseClip(c, localAt(c, time, p.settings.fps), {
          x: p.settings.width / 2,
          y: p.settings.height / 2,
          scale: Math.min(p.settings.width / aw, p.settings.height / ah)
        }, p.settings.fps)
      })
    },

    centerClip: (clipId) => {
      const time = get().currentTime
      tellIfKeyedOff(clipId, ['x', 'y'])
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        poseClip(c, localAt(c, time, p.settings.fps), { x: p.settings.width / 2, y: p.settings.height / 2 }, p.settings.fps)
      })
    },

    setClipBlendMode: (clipId, mode) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        if (mode === 'normal') delete c.blendMode
        else c.blendMode = mode
      }, false),

    setClipEffect: (clipId, patch) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        const rec = c as unknown as Record<string, unknown>
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === 0 || v === undefined) delete rec[k]
          else rec[k] = v
        }
      }, false, runKey(`effect:${clipId}`, patch)),

    setClipSpeed: (clipId, speed) =>
      // (A slider's gesture makes it one step; typed or alone, a run of it is one.)
      mutate((p) => setSpeed.apply(p, { clipId, speed, linkAV: get().linkAV }, env()), false, runKey(`speed:${clipId}`)),

    setClipSpeedCurve: (clipId, curve) =>
      // (The editor's drag is one gesture: one step.)
      mutate((p) => setSpeedCurve.apply(p, { clipId, curve, linkAV: get().linkAV }, env()), false, runKey(`speedcurve:${clipId}`)),

    setClipKeepPitch: (clipId, keep) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        // Only ever stored as `false`: absent is "keep" (types.ts).
        if (keep) delete c.keepPitch
        else c.keepPitch = false
      }),

    setClipGrade: (clipId, patch) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        if (patch === null) {
          delete clip.grade
          return
        }
        clip.grade = { ...neutralGrade(), ...clip.grade, ...patch }
      }, false, runKey(`grade:${clipId}`, patch)),

    setClipVolume: (clipId, volume) => mutate((p) => setVolume.apply(p, { clipId, volume }, env()), false, runKey(`volume:${clipId}`)),

    toggleClipMute: (clipId) => mutate((p) => setMuted.apply(p, { clipId, muted: !p.clips[clipId]?.muted }, env())),

    setClipOpacity: (clipId, opacity) => mutate((p) => setOpacity.apply(p, { clipId, opacity }, env()), false, runKey(`opacity:${clipId}`)),

    setClipFades: (clipId, patch) => mutate((p) => setFades.apply(p, { clipId, ...patch }, env()), false, runKey(`fades:${clipId}`, patch)),

    setVolumeKeyframes: (clipId, kfs) =>
      mutate((p) => {
        const c = p.clips[clipId]
        if (!c) return
        c.volumeKeyframes = kfs.map((k) => ({ id: uid(), time: k.time, value: k.value }))
        if (c.volumeKeyframes.length === 0) delete c.volumeKeyframes
        delete c.autoDucking
      }),

    addVolumeKeyframe: (clipId) => {
      const { currentTime } = get()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        // On the frame grid, merged only on the same frame; none with the
        // playhead off the clip (phase Ç2c.2, decision 1, K7, K19).
        const local = keyLocalAt(clip, currentTime, p.settings.fps)
        if (local === null) return
        clip.volumeKeyframes = clip.volumeKeyframes ?? []
        const near = keyOnFrame(clip.volumeKeyframes, local, p.settings.fps)
        if (!near) {
          // Preserve the curve when inserting between two existing points.
          // Using clip.volume here created an audible jump at the new keyframe.
          clip.volumeKeyframes.push({ id: uid(), time: local, value: automationGainAt(clip, local) })
          clip.volumeKeyframes.sort((a, b) => a.time - b.time)
        }
      })
    },

    dragVolumeKeyframe: (clipId, value) => {
      const { currentTime } = get()
      const was = get().project.clips[clipId]
      if (was && keyLocalAt(was, currentTime, get().project.settings.fps) === null) tellKeyedOffClip()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        // Same rule as setClipVolume: touching the fader means "I want to hear
        // this". Without it, a muted keyframed clip stayed silent while the
        // slider moved, which just looks broken.
        // (Unmuted with the playhead off the clip too, where no key is
        // written: Ç2c patch, item 6.)
        if (clip.muted) delete clip.muted
        const local = keyLocalAt(clip, currentTime, p.settings.fps)
        if (local === null) return
        clip.volumeKeyframes = clip.volumeKeyframes ?? []
        const near = keyOnFrame(clip.volumeKeyframes, local, p.settings.fps)
        if (near) near.value = value
        else {
          clip.volumeKeyframes.push({ id: uid(), time: local, value })
          clip.volumeKeyframes.sort((a, b) => a.time - b.time)
        }
      }, false, runKey(`volume-key:${clipId}`))
    },

    deleteVolumeKeyframe: (clipId, keyframeId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (clip?.volumeKeyframes) {
          clip.volumeKeyframes = clip.volumeKeyframes.filter((k) => k.id !== keyframeId)
          if (clip.volumeKeyframes.length === 0) delete clip.volumeKeyframes
        }
      }),

    clearVolumeKeyframes: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (clip) {
          delete clip.volumeKeyframes
          delete clip.autoDucking
        }
      }),

    applyCleanedAudio: (clipId, file, settings) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const from = clip.cleaned?.from ?? clip.assetId
        const src = p.assets.find((a) => a.id === from)
        if (!src) return
        const asset: Asset = { id: uid(), kind: 'audio', name: file.name, path: file.path, url: file.url, size: file.size, duration: src.duration, width: 0, height: 0, hasAudio: true, ...(src.folder ? { folder: src.folder } : {}) }
        p.assets.push(asset)
        clip.assetId = asset.id
        clip.cleaned = { from, noise: settings.noise, ess: settings.ess }
      }),

    restoreOriginalAudio: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.cleaned) return
        if (p.assets.some((a) => a.id === clip.cleaned!.from)) clip.assetId = clip.cleaned.from
        delete clip.cleaned
      }),

    extractAudio: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        const asset = clip ? p.assets.find((a) => a.id === clip.assetId) : undefined
        if (!clip || !asset?.hasAudio) return
        // A sibling asset for the same file, treated as pure audio.
        let audioAsset = p.assets.find((a) => a.kind === 'audio' && a.path === asset.path && a.id !== asset.id)
        if (!audioAsset) {
          audioAsset = { ...asset, id: uid(), kind: 'audio', name: `${asset.name} (audio)`, thumbnail: undefined }
          p.assets.push(audioAsset)
        }
        // An audio track free under the clip (a new one if none is): pushed
        // onto the first one and cascaded, the extracted sound landed after
        // the voice-over already there, out of sync with its picture, or moved
        // the user's own audio along.
        const track = freeTrackAt(p, 'audio', null, clip.start, clip.start + clip.duration)
        const linkId = uid()
        const audioClip: Clip = {
          id: uid(),
          assetId: audioAsset.id,
          trackId: track.id,
          start: clip.start,
          inPoint: clip.inPoint,
          duration: clip.duration,
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          volume: clip.volume > 0 ? clip.volume : 1,
          linkId,
          // It plays what the video clip played: its speed, direction, fades
          // and volume curve.
          ...(clip.speed !== undefined ? { speed: clip.speed } : {}),
          ...(clip.keepPitch === false ? { keepPitch: false as const } : {}),
          ...(clip.speedCurve ? { speedCurve: clone(clip.speedCurve) } : {}),
          ...(clip.reversed ? { reversed: true } : {}),
          ...(clip.fadeIn ? { fadeIn: clip.fadeIn } : {}),
          ...(clip.fadeOut ? { fadeOut: clip.fadeOut } : {}),
          ...(clip.volumeKeyframes ? { volumeKeyframes: clone(clip.volumeKeyframes) } : {}),
          ...(clip.muted ? { muted: true } : {})
        }
        p.clips[audioClip.id] = audioClip
        track.clipIds.push(audioClip.id)
        sortTrack(p, track)
        // The video clip carries no sound anymore; the linked audio clip does.
        clip.audioExtracted = true
        clip.linkId = linkId
      }),

    applyAutoDucking: (sourceTrackId, targetTrackId, activity, options) => {
      const state = get()
      const source = state.project.tracks.find((track) => track.id === sourceTrackId)
      const target = state.project.tracks.find((track) => track.id === targetTrackId)
      if (
        !source ||
        !target ||
        source.id === target.id ||
        source.kind !== 'audio' ||
        target.kind !== 'audio' ||
        target.locked ||
        activity.length === 0
      ) return 0

      const updates = new Map<
        string,
        {
          original: Clip['volumeKeyframes']
          planned: ReturnType<typeof planDuckingKeyframes>
        }
      >()
      let changed = 0
      for (const clipId of target.clipIds) {
        const clip = state.project.clips[clipId]
        if (!clip) continue
        const original = clip.autoDucking
          ? clip.autoDucking.originalVolumeKeyframes?.map((keyframe) => ({ ...keyframe }))
          : clip.volumeKeyframes?.map((keyframe) => ({ ...keyframe }))
        const planned = planDuckingKeyframes(clip, activity, options, original)
        if (planned) changed++
        if (planned || clip.autoDucking) updates.set(clipId, { original, planned })
      }
      // No overlap and no older automatic envelope to clear: no dirty flag and
      // no empty Undo entry.
      if (updates.size === 0) return 0

      mutate((project) => {
        for (const [clipId, update] of updates) {
          const clip = project.clips[clipId]
          if (!clip) continue
          const { original, planned } = update
          if (!planned) {
            if (clip.autoDucking) {
              if (original?.length) clip.volumeKeyframes = original.map((keyframe) => ({ ...keyframe }))
              else delete clip.volumeKeyframes
              delete clip.autoDucking
            }
            continue
          }
          clip.autoDucking = {
            sourceTrackId,
            originalVolumeKeyframes: original,
            duckRatio: options.duckRatio,
            attack: options.attack,
            hold: options.hold,
            release: options.release
          }
          clip.volumeKeyframes = planned.map((keyframe) => ({ ...keyframe, id: uid() }))
        }
      })
      return changed
    },

    clearAutoDucking: (targetTrackId) => {
      const state = get()
      const target = state.project.tracks.find((track) => track.id === targetTrackId)
      if (!target || target.kind !== 'audio' || target.locked) return 0
      const count = target.clipIds.filter((id) => !!state.project.clips[id]?.autoDucking).length
      if (count === 0) return 0
      mutate((project) => {
        const track = project.tracks.find((candidate) => candidate.id === targetTrackId)!
        for (const clipId of track.clipIds) {
          const clip = project.clips[clipId]
          if (!clip?.autoDucking) continue
          const original = clip.autoDucking.originalVolumeKeyframes
          if (original?.length) clip.volumeKeyframes = original.map((keyframe) => ({ ...keyframe }))
          else delete clip.volumeKeyframes
          delete clip.autoDucking
        }
      })
      return count
    },

    pasteAttributes: () => {
      const s = get()
      const src = s.clipboard?.[0]
      if (!src || s.selectedClipIds.length === 0) return
      mutate((p) => {
        for (const id of s.selectedClipIds) {
          const c = p.clips[id]
          if (!c || c.id === src.id) continue
          c.grade = src.grade ? clone(src.grade) : undefined
          c.motionFx = src.motionFx ? clone(src.motionFx) : undefined
          c.chroma = src.chroma ? clone(src.chroma) : undefined
          c.mask = src.mask ? clone(src.mask) : undefined
          c.audioFx = src.audioFx ? clone(src.audioFx) : undefined
          c.lut = src.lut
          // ("cila" part D: the LUT's amount, the colour dials and the four
          // effects are part of the look; their keys are not carried, as the
          // transform's are not.)
          c.lutAmount = src.lutAmount
          c.tone = src.tone ? clone(src.tone) : undefined
          c.bloom = src.bloom ? clone(src.bloom) : undefined
          c.halation = src.halation ? clone(src.halation) : undefined
          c.mosaic = src.mosaic
          c.isolate = src.isolate ? clone(src.isolate) : undefined
          delete c.fxKeys
          // The whole Effects block, which this never carried. It claimed to
          // paste "the look" and left behind everything in that panel —
          // sharpen, vignette, grain, glow, aberration, duotone, blur, blend —
          // so a clip you had graded by eye came out looking like a different
          // shot from the one you copied.
          c.sharpen = src.sharpen
          c.vignette = src.vignette
          c.grain = src.grain
          c.glow = src.glow
          c.chromaAb = src.chromaAb
          c.blur = src.blur
          c.duotone = src.duotone ? clone(src.duotone) : undefined
          c.blendMode = src.blendMode
          c.videoFx = src.videoFx ? clone(src.videoFx) : undefined
          c.stillImageFx = src.stillImageFx ? clone(src.stillImageFx) : undefined
          // (Into the clip after THIS one: the copied one named its own
          // partner. Phase Ç2b.2, decision 1.)
          c.transitionOut = src.transitionOut ? clone(src.transitionOut) : undefined
          if (c.transitionOut) delete c.transitionOut.to
          // A keyed scale or rotation takes the same change on every key
          // (phase Ç2c.2, report K13: the static value changed and nothing
          // on screen did): scale by the ratio, rotation by the difference.
          const rot = c.channels?.rotation
          if (rot?.length) for (const k of rot) k.value += src.transform.rotation - c.transform.rotation
          const sc = c.channels?.scale
          if (sc?.length && c.transform.scale > 0) for (const k of sc) k.value *= src.transform.scale / c.transform.scale
          c.transform = { ...c.transform, scale: src.transform.scale, rotation: src.transform.rotation }
          c.flipH = src.flipH
          c.flipV = src.flipV
          c.crop = src.crop ? clone(src.crop) : undefined
        }
      })
    }
  }
}
