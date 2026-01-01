// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's keyframe actions: a clip's transform and its keyframes (by
// channel and as groups), easing, masks and their keyframes, motion trackers.
// Moved out of state/store.ts in SnippStudio phase 2B (no change).
import { captionMotionAt, clipOpacityAt, clipTransformAt, maskGeomAt } from '../../playback/pose'
import { automationGainAt } from '../../audio/envelope'
import type { ClipMask, KfChannel } from '../../types'
import { KF_CHANNELS, uid } from '../../types'
import { upsertKf } from '../../commands/ops/keyframes'
import { dragKeys, type KeyRef } from '../../timeline/key-drag'
import { findTrack } from '../../commands/ops/base'
import { keyLocalAt, keyOnFrame, onFrameGrid } from '../../timeline/key-grid'
import type { Clip } from '../../types'
import { setTransform } from '../../commands/clips'
import { env, tellKeyedOffClip } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type KeyframeActions = Pick<EditorState, 
  | 'setClipTransform'
  | 'addClipKeyframe'
  | 'keyframeClips'
  | 'toggleKeyframeAtPlayhead'
  | 'addPropKeyframe'
  | 'setPropValue'
  | 'setPropValues'
  | 'dragClipKeyframe'
  | 'moveClipKeyframe'
  | 'deleteClipKeyframe'
  | 'moveKeyframeGroup'
  | 'dragKeyframes'
  | 'deleteKeyframes'
  | 'deleteKeyframeGroup'
  | 'readKeyframeGroup'
  | 'insertKeyframeGroup'
  | 'rippleKeyframes'
  | 'clearClipKeyframes'
  | 'setKeyframeEasing'
  | 'setClipMask'
  | 'editMaskGeom'
  | 'addMaskKeyframe'
  | 'deleteMaskKeyframe'
  | 'addMaskPoint'
  | 'addTracker'
  | 'renameTracker'
  | 'deleteTracker'
  | 'dragTracker'
  | 'deleteTrackerKeyframe'
  | 'setClipTracker'
>

export function keyframeActions(set: SetState, get: GetState, mutate: Mutate): KeyframeActions {
  return {
    setClipTransform: (clipId, patch, commit = true) =>
      mutate((p) => setTransform.apply(p, { clipId, transform: patch }, env()), commit),

    addClipKeyframe: (clipId) => {
      const { currentTime } = get()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (clip) keyframeAll(clip, currentTime, p.settings.fps)
      })
    },

    keyframeClips: (clipIds) => {
      const { currentTime, project } = get()
      const fps = project.settings.fps
      // Decided before the edit: a press that keys nothing makes no step.
      const ids = clipIds.filter((id) => {
        const c = project.clips[id]
        return !!c && !findTrack(project, c.trackId)?.locked && keyLocalAt(c, currentTime, fps) !== null
      })
      if (ids.length === 0) return 0
      mutate((p) => {
        for (const id of ids) {
          const clip = p.clips[id]
          if (!clip) continue
          if (findTrack(p, clip.trackId)?.kind === 'audio') {
            const local = keyLocalAt(clip, currentTime, fps)!
            clip.volumeKeyframes = clip.volumeKeyframes ?? []
            if (!keyOnFrame(clip.volumeKeyframes, local, fps)) {
              clip.volumeKeyframes.push({ id: uid(), time: local, value: automationGainAt(clip, local) })
              clip.volumeKeyframes.sort((a, b) => a.time - b.time)
            }
          } else keyframeAll(clip, currentTime, fps)
        }
      })
      return ids.length
    },

    toggleKeyframeAtPlayhead: () => {
      const { currentTime: t, project, selectedClipIds, selectedCaptionIds } = get()
      const fps = project.settings.fps
      const clips = selectedClipIds.map((id) => project.clips[id]).filter((c) => !!c && !findTrack(project, c.trackId)?.locked && keyLocalAt(c, t, fps) !== null)
      const caps = project.captions.filter((c) => selectedCaptionIds.includes(c.id) && keyLocalAt({ start: c.start, duration: c.end - c.start }, t, fps) !== null)
      if (clips.length === 0 && caps.length === 0) return 0
      // A key on the playhead's frame on any of them: those keys go; else
      // each gets one (phase Ç2c.2, decision 5). One undo step. Only the keys
      // the toggle adds count and go: a volume key on an audio clip, the
      // channels' keys on any other (Ç2c patch, item 5: a video's volume key
      // on the frame was deleted by a press meant to key its picture).
      const audio = (c: Clip): boolean => findTrack(project, c.trackId)?.kind === 'audio'
      const onFrame = (c: Clip): boolean => {
        const local = keyLocalAt(c, t, fps)!
        return audio(c) ? !!keyOnFrame(c.volumeKeyframes, local, fps) : KF_CHANNELS.some((ch) => !!keyOnFrame(c.channels?.[ch], local, fps))
      }
      const remove = clips.some(onFrame) || caps.some((c) => !!keyOnFrame(c.kfs, keyLocalAt({ start: c.start, duration: c.end - c.start }, t, fps)!, fps))
      if (!remove) {
        // One window, one undo step for the clips and the titles.
        get().undoable(() => {
          get().keyframeClips(clips.map((c) => c.id))
          if (caps.length > 0) mutate((p) => {
            for (const cap of p.captions) {
              if (!caps.some((c) => c.id === cap.id)) continue
              const local = keyLocalAt({ start: cap.start, duration: cap.end - cap.start }, t, fps)!
              cap.kfs = [...(cap.kfs ?? []), { ...captionMotionAt(cap, local), id: uid(), time: local }].sort((a, b) => a.time - b.time)
            }
          }, false)
        })
        return clips.length + caps.length
      }
      mutate((p) => {
        for (const c of clips) {
          const clip = p.clips[c.id]
          const local = keyLocalAt(clip, t, fps)!
          if (audio(c)) {
            const v = keyOnFrame(clip.volumeKeyframes, local, fps)
            if (v) {
              clip.volumeKeyframes = clip.volumeKeyframes!.filter((x) => x !== v)
              if (clip.volumeKeyframes.length === 0) delete clip.volumeKeyframes
            }
            continue
          }
          for (const ch of KF_CHANNELS) {
            const k = keyOnFrame(clip.channels?.[ch], local, fps)
            if (!k) continue
            clip.channels![ch] = clip.channels![ch]!.filter((x) => x !== k)
            if (clip.channels![ch]!.length === 0) delete clip.channels![ch]
          }
          if (clip.channels && Object.keys(clip.channels).length === 0) delete clip.channels
        }
        for (const cap of p.captions) {
          if (!caps.some((c) => c.id === cap.id) || !cap.kfs) continue
          const k = keyOnFrame(cap.kfs, keyLocalAt({ start: cap.start, duration: cap.end - cap.start }, t, fps)!, fps)
          if (k) cap.kfs = cap.kfs.filter((x) => x !== k)
          if (cap.kfs.length === 0) delete cap.kfs
        }
      })
      return -(clips.length + caps.length)
    },

    addPropKeyframe: (clipId, ch) => {
      const { currentTime } = get()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const fps = p.settings.fps
        const local = keyLocalAt(clip, currentTime, fps)
        if (local === null) return
        const val =
          ch === 'opacity' ? clipOpacityAt(clip, local) : (clipTransformAt(clip, local) as never)[ch]
        upsertKf(clip, ch, local, val as number, { fps })
      })
    },

    setPropValue: (clipId, ch, value, commit = true) => {
      const was = get().project.clips[clipId]
      if (was && (was.channels?.[ch]?.length ?? 0) > 0 && keyLocalAt(was, get().currentTime, get().project.settings.fps) === null) return tellKeyedOffClip()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        // Keyed channel → write a keyframe at the playhead; otherwise base.
        const keyed = (clip.channels?.[ch]?.length ?? 0) > 0
        if (keyed) {
          // The playhead off the clip writes no key (K19).
          const local = keyLocalAt(clip, get().currentTime, p.settings.fps)
          if (local !== null) upsertKf(clip, ch, local, value, { fps: p.settings.fps })
        } else if (ch === 'opacity') {
          clip.opacity = value
        } else {
          clip.transform[ch] = value
        }
      }, commit)
    },

    // Several channels at once, as ONE change (cila A): a move in the preview
    // is x and y, a corner pull x, y and scale, and each used to be a write
    // of its own (the follow passes, the version log and every subscriber
    // two or three times per pointer move). Each channel goes the way
    // setPropValue sends it: a key at the playhead where it is keyed, the
    // base value where it is not. `mergeKey`: a run of the same step (an
    // arrow key held or pressed again) is one undo step.
    setPropValues: (clipId, patch, commit = true, mergeKey) => {
      const was = get().project.clips[clipId]
      if (!was) return
      const entries = (Object.entries(patch) as [KfChannel, number | undefined][]).filter((e): e is [KfChannel, number] => typeof e[1] === 'number' && Number.isFinite(e[1]))
      if (entries.length === 0) return
      const offClip = keyLocalAt(was, get().currentTime, get().project.settings.fps) === null
      const keyedCh = (ch: KfChannel): boolean => (was.channels?.[ch]?.length ?? 0) > 0
      // The playhead off the clip writes no key (K19): said once, and the
      // channels without keys are still written.
      if (offClip && entries.some(([ch]) => keyedCh(ch))) tellKeyedOffClip()
      const writable = entries.filter(([ch]) => !(offClip && keyedCh(ch)))
      if (writable.length === 0) return
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const local = keyLocalAt(clip, get().currentTime, p.settings.fps)
        for (const [ch, value] of writable) {
          if ((clip.channels?.[ch]?.length ?? 0) > 0) {
            if (local !== null) upsertKf(clip, ch, local, value, { fps: p.settings.fps })
          } else if (ch === 'opacity') clip.opacity = value
          else clip.transform[ch] = value
        }
      }, commit, mergeKey)
    },

    dragClipKeyframe: (clipId, patch) => {
      const was = get().project.clips[clipId]
      if (was && keyLocalAt(was, get().currentTime, get().project.settings.fps) === null) return tellKeyedOffClip()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        const local = keyLocalAt(clip, get().currentTime, p.settings.fps)
        if (local === null) return
        for (const [ch, value] of Object.entries(patch)) {
          if (typeof value === 'number') upsertKf(clip, ch as KfChannel, local, value, { fps: p.settings.fps })
        }
      }, false)
    },

    moveClipKeyframe: (clipId, ch, keyframeId, time) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        const kfs = clip?.channels?.[ch]
        const kf = kfs?.find((k) => k.id === keyframeId)
        if (!clip || !kf) return
        kf.time = Math.min(clip.duration, Math.max(0, time))
        kfs!.sort((a, b) => a.time - b.time)
      }, false),

    deleteClipKeyframe: (clipId, ch, keyframeId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        const kfs = clip?.channels?.[ch]
        if (!clip || !kfs) return
        clip.channels![ch] = kfs.filter((k) => k.id !== keyframeId)
        if (clip.channels![ch]!.length === 0) delete clip.channels![ch]
      }),

    // Group ops. "Keyframe all" writes one keyframe per channel at the same
    // instant; the timeline shows them as ONE diamond, so retiming/deleting has
    // to act on the whole set — otherwise the others stay behind at the old time.
    moveKeyframeGroup: (clipId, fromTime, toTime) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.channels) return
        // By id: the keys at `fromTime` now, and only they (phase Ç2c.2,
        // decision 2; report K3: a key passed over was picked up).
        const keys = keysAt(clip, fromTime)
        if (keys.length === 0) return
        setChannels(clip, dragKeys({ base: clip.channels, keys, from: fromTime }, toTime, clip, p.settings.fps))
      }, false),

    dragKeyframes: (clipId, drag, toTime) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip || findTrack(p, clip.trackId)?.locked) return
        setChannels(clip, dragKeys(drag, toTime, clip, p.settings.fps))
      }, false),

    deleteKeyframes: (clipId, keys) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.channels) return
        const gone = new Set(keys.map((r) => `${r.ch}\u0000${r.id}`))
        for (const ch of KF_CHANNELS) {
          const kfs = clip.channels[ch]
          if (!kfs) continue
          clip.channels[ch] = kfs.filter((k) => !gone.has(`${ch}\u0000${k.id}`))
          if (clip.channels[ch]!.length === 0) delete clip.channels[ch]
        }
      }),

    deleteKeyframeGroup: (clipId, time) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.channels) return
        for (const ch of KF_CHANNELS) {
          const kfs = clip.channels[ch]
          if (!kfs) continue
          clip.channels[ch] = kfs.filter((k) => Math.abs(k.time - time) >= 1e-3)
          if (clip.channels[ch]!.length === 0) delete clip.channels[ch]
        }
      }),

    readKeyframeGroup: (clipId, time) => {
      const clip = get().project.clips[clipId]
      const out: Partial<Record<KfChannel, number>> = {}
      if (!clip?.channels) return out
      for (const ch of KF_CHANNELS) {
        const k = clip.channels[ch]?.find((kf) => Math.abs(kf.time - time) < 1e-3)
        if (k) out[ch] = k.value
      }
      return out
    },

    insertKeyframeGroup: (clipId, time, values) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        for (const [ch, v] of Object.entries(values)) {
          if (typeof v === 'number') upsertKf(clip, ch as KfChannel, time, v, { fps: p.settings.fps })
        }
      }),

    rippleKeyframes: (clipId, fromTime, delta) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.channels) return
        // Everything on the clip at or after `fromTime` by one delta, held so
        // the last key stays on the clip (phase Ç2c.2, decision 2: each key
        // was pushed onto the end, where they piled up); a key off the clip
        // stays where it is (phase Ç2c.1, decision 1).
        setChannels(clip, dragKeys({ base: clip.channels, keys: [], from: fromTime, ripple: true }, fromTime + delta, clip, p.settings.fps))
      }, false),

    clearClipKeyframes: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        delete clip.channels
        // And every key off the clip, which the Inspector counts with them
        // (Ç2c patch, item 7); the volume and mask keys on the clip are their
        // own sections'.
        // (On the clip as the diamonds and the count: ± 1 ms, components/timeline/shared.ts onClip.)
        const on = (k: { time: number }): boolean => k.time >= -1e-3 && k.time <= clip.duration + 1e-3
        if (clip.volumeKeyframes) {
          clip.volumeKeyframes = clip.volumeKeyframes.filter(on)
          if (clip.volumeKeyframes.length === 0) delete clip.volumeKeyframes
        }
        if (clip.mask?.keyframes) {
          clip.mask.keyframes = clip.mask.keyframes.filter(on)
          if (clip.mask.keyframes.length === 0) delete clip.mask.keyframes
        }
      }),

    setKeyframeEasing: (clipId, ch, kfId, easing) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        const kf = clip?.channels?.[ch]?.find((k) => k.id === kfId)
        if (kf) kf.easing = easing
      }),

    setClipMask: (clipId, patch) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        if (patch === null) {
          delete clip.mask
          return
        }
        const asset = p.assets.find((a) => a.id === clip.assetId)
        const aw = asset?.width || 400
        const ah = asset?.height || 400
        const base: ClipMask =
          clip.mask ?? { enabled: true, shape: 'ellipse', cx: 0, cy: 0, w: aw * 0.6, h: ah * 0.6, feather: 0 }
        clip.mask = { ...base, ...patch }
        // Switching to the pen shape starts with an editable diamond — unless
        // the user is hand-drawing, where they place the points themselves.
        if (clip.mask.shape === 'path' && (!clip.mask.points || clip.mask.points.length < 3) && !get().maskDrawMode) {
          const w = clip.mask.w / 2
          const h = clip.mask.h / 2
          clip.mask.points = [
            { x: clip.mask.cx, y: clip.mask.cy - h },
            { x: clip.mask.cx + w, y: clip.mask.cy },
            { x: clip.mask.cx, y: clip.mask.cy + h },
            { x: clip.mask.cx - w, y: clip.mask.cy }
          ]
        }
      }),

    editMaskGeom: (clipId, patch) => {
      const was = get().project.clips[clipId]
      if ((was?.mask?.keyframes?.length ?? 0) > 0 && keyLocalAt(was!, get().currentTime, get().project.settings.fps) === null) return tellKeyedOffClip()
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.mask) return
        const fps = p.settings.fps
        if (clip.mask.keyframes && clip.mask.keyframes.length > 0) {
          // On the frame grid, merged only on the same frame; none with the
          // playhead off the clip (phase Ç2c.2, decision 1, K7, K19).
          const local = keyLocalAt(clip, get().currentTime, fps)
          if (local === null) return
          const near = keyOnFrame(clip.mask.keyframes, local, fps)
          if (near) Object.assign(near, patch)
          else {
            const g = maskGeomAt(clip.mask, local)
            clip.mask.keyframes.push({ id: uid(), time: local, ...g, ...patch })
            clip.mask.keyframes.sort((a, b) => a.time - b.time)
          }
        } else {
          Object.assign(clip.mask, patch)
        }
      }, false)
    },

    addMaskKeyframe: (clipId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.mask) return
        const fps = p.settings.fps
        const local = keyLocalAt(clip, get().currentTime, fps)
        if (local === null) return
        const g = maskGeomAt(clip.mask, local)
        clip.mask.keyframes = clip.mask.keyframes ?? []
        const near = keyOnFrame(clip.mask.keyframes, local, fps)
        if (near) Object.assign(near, g)
        else {
          clip.mask.keyframes.push({ id: uid(), time: local, ...g })
          clip.mask.keyframes.sort((a, b) => a.time - b.time)
        }
      }),

    deleteMaskKeyframe: (clipId, kfId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.mask?.keyframes) return
        clip.mask.keyframes = clip.mask.keyframes.filter((k) => k.id !== kfId)
        if (clip.mask.keyframes.length === 0) delete clip.mask.keyframes
      }),

    addMaskPoint: (clipId, x, y) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip?.mask) return
        clip.mask.shape = 'path'
        clip.mask.points = [...(clip.mask.points ?? []), { x, y }]
      }, false),

    addTracker: () => {
      const id = uid()
      const { currentTime, project } = get()
      mutate((p) => {
        p.trackers = p.trackers ?? []
        p.trackers.push({
          id,
          name: `Tracker ${p.trackers.length + 1}`,
          keyframes: [
            { id: uid(), time: onFrameGrid(currentTime, p.settings.fps), x: project.settings.width / 2, y: project.settings.height / 2 }
          ]
        })
      })
      set({ selectedTrackerId: id })
      return id
    },

    renameTracker: (id, name) =>
      mutate((p) => {
        const trk = p.trackers?.find((t) => t.id === id)
        if (trk) trk.name = name
      }),

    deleteTracker: (id) => {
      mutate((p) => {
        p.trackers = (p.trackers ?? []).filter((t) => t.id !== id)
        if (p.trackers.length === 0) delete p.trackers
        for (const clip of Object.values(p.clips)) if (clip.trackerId === id) delete clip.trackerId
        p.captions = p.captions.map((c) => (c.trackerId === id ? { ...c, trackerId: undefined } : c))
      })
      if (get().selectedTrackerId === id) set({ selectedTrackerId: null })
    },

    dragTracker: (id, time, x, y) =>
      mutate((p) => {
        const trk = p.trackers?.find((t) => t.id === id)
        if (!trk) return
        const fps = p.settings.fps
        const at = onFrameGrid(time, fps)
        const near = keyOnFrame(trk.keyframes, at, fps)
        if (near) {
          near.x = x
          near.y = y
        } else {
          trk.keyframes.push({ id: uid(), time: at, x, y })
          trk.keyframes.sort((a, b) => a.time - b.time)
        }
      }, false),

    deleteTrackerKeyframe: (trackerId, kfId) =>
      mutate((p) => {
        const trk = p.trackers?.find((t) => t.id === trackerId)
        if (!trk) return
        if (trk.keyframes.length > 1) trk.keyframes = trk.keyframes.filter((k) => k.id !== kfId)
      }),

    setClipTracker: (clipId, trackerId) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip) return
        if (trackerId) clip.trackerId = trackerId
        else delete clip.trackerId
      })
  }
}

/**
 * "Keyframe all" at timeline time `t`: x, y, scale, rotation and opacity
 * keyed at what they show there, on the frame grid, as one set with a set id
 * of its own (phase Ç2c.2, decisions 1 and 2) — or the set already on that
 * frame. Nothing when `t` is not on the clip (K19). Whether it wrote.
 */
export function keyframeAll(clip: Clip, t: number, fps: number, newId: () => string = uid): boolean {
  const local = keyLocalAt(clip, t, fps)
  if (local === null) return false
  const tf = clipTransformAt(clip, local)
  const values: Record<KfChannel, number> = { x: tf.x, y: tf.y, scale: tf.scale, rotation: tf.rotation, opacity: clipOpacityAt(clip, local) }
  let group: string | undefined
  for (const ch of KF_CHANNELS) group = group ?? keyOnFrame(clip.channels?.[ch], local, fps)?.group
  for (const ch of KF_CHANNELS) upsertKf(clip, ch, local, values[ch], { fps, newId })
  // (The set id after the keys' own: a new key's id is the one it had.)
  group = group ?? newId()
  for (const ch of KF_CHANNELS) keyOnFrame(clip.channels![ch], local, fps)!.group = group
  return true
}

/** The keys on the frame-exact instant `time` (within a millisecond), by id. */
function keysAt(clip: Clip, time: number): KeyRef[] {
  const out: KeyRef[] = []
  for (const ch of KF_CHANNELS) for (const k of clip.channels?.[ch] ?? []) if (Math.abs(k.time - time) < 1e-3) out.push({ ch, id: k.id })
  return out
}

/** A clip's channels as worked out (none left: no channels at all). */
function setChannels(clip: Clip, channels: NonNullable<Clip['channels']>): void {
  if (Object.keys(channels).length > 0) clip.channels = channels
  else delete clip.channels
}
