// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's placing actions: media onto the timeline, tracks (add, move,
// delete, flags, level, packing), moving and grouping clips, automation
// placing ("Fit to voice"), sound effects. Moved out of state/store.ts in SnippStudio
// phase 2B (no change).
import { planTimelinePlacement } from '../../timeline/placement'
import type { Asset, Clip } from '../../types'
import { uid } from '../../types'
import { applyAutoPack, cascadeTrack, containScale, findTrack, gatherTrack, sortTrack } from '../../commands/ops/base'
import { sliceClipAutomation } from '../../timeline/slice'
import { headRoom, takePart } from '../../timeline/media-time'
import { appendAssetToTimeline, codeFilmMix } from '../../commands/ops/media'
import { addClip, addMedia, appendClip, moveClip, moveClipToTrack, placeClips, planMove } from '../../commands/clips'
import { tellLockedPartner } from './cutting'
import { notify } from '../../ui/toast-core'
import { t } from '../../ui/strings'
import { addTrack, deleteTrack, moveTrack, renameTrack, setMagnet } from '../../commands/tracks'
import { applyAutomation, planAutomation } from '../../commands/automation'
import { setAgentLock } from '../../commands/agent-lock'
import { setClipLabel } from '../../commands/clip-label'
import { env } from '../shared'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type PlacingActions = Pick<EditorState, 
  | 'addToTimeline'
  | 'addAllToTimeline'
  | 'addVideoTrack'
  | 'addAudioTrack'
  | 'moveClipToTrack'
  | 'addClipsAt'
  | 'placeSoundEffect'
  | 'placeAutomationImages'
  | 'fillAutomationMissingImage'
  | 'addClipAt'
  | 'moveClip'
  | 'applyTimelinePlacement'
  | 'nudgeSelection'
  | 'groupSelection'
  | 'ungroupSelection'
  | 'revealEarlier'
  | 'deleteTrack'
  | 'moveTrack'
  | 'setTrackFlags'
  | 'renameTrack'
  | 'setTrackLevel'
  | 'setClipsDisabled'
  | 'setClipsAgentLock'
  | 'setClipsLabel'
  | 'resolveTrackOverlaps'
  | 'packTrack'
  | 'setTrackMagnet'
  | 'packMainTrack'
>

export function placingActions(set: SetState, get: GetState, mutate: Mutate): PlacingActions {
  return {
    addToTimeline: (assetId, trackId) => mutate((p) => appendClip.apply(p, { assetId, trackId }, env())),

    addAllToTimeline: () =>
      mutate((p) => {
        // A code film's sound comes with its picture.
        const sounds = new Set(p.assets.map((a) => codeFilmMix(p, a)?.id).filter(Boolean))
        for (const asset of p.assets) if (!sounds.has(asset.id)) appendAssetToTimeline(p, asset.id)
        applyAutoPack(p)
      }),

    addVideoTrack: () => mutate((p) => void addTrack.apply(p, { kind: 'video' }, env())),

    addAudioTrack: () => mutate((p) => void addTrack.apply(p, { kind: 'audio' }, env())),

    moveClipToTrack: (clipId, trackId) => mutate((p) => moveClipToTrack.apply(p, { clipId, trackId }, env()), false),

    addClipsAt: (assetIds, trackId, start, opts) => {
      // ONE undo step for the whole drop: the files it brought in, the row it
      // made, every clip (commands/clips.ts, clip.addMedia).
      let out: { added: Asset[]; clipIds: string[] } = { added: [], clipIds: [] }
      mutate((p) => {
        out = addMedia.apply(p, { assetIds, trackId, start, assets: opts?.assets, newTrack: opts?.newTrack ?? null }, env())
      })
      return out
    },

    placeSoundEffect: (assetId, times, lead, volume) => {
      const asset = get().project.assets.find((candidate) => candidate.id === assetId)
      if (asset?.kind !== 'audio' || !Number.isFinite(asset.duration) || asset.duration <= 0) return 0
      const positions = [...times]
        .filter(Number.isFinite)
        .map((time) => Math.max(0, time - Math.max(0, Math.min(1, lead))))
        .sort((a, b) => a - b)
        .filter((time, index, sorted) => index === 0 || time - sorted[index - 1] > 0.05)
        .filter((time) => !Object.values(get().project.clips).some((clip) => clip.assetId === assetId && Math.abs(clip.start - time) < 0.05))
        .slice(0, 1000)
      if (positions.length === 0) return 0
      let placed = 0
      mutate((project) => {
        const sfxTracks = project.tracks.filter((track) => track.kind === 'audio' && track.role === 'sfx' && !track.locked)
        for (const start of positions) {
          let track = sfxTracks.find((candidate) => candidate.clipIds.every((id) => {
            const clip = project.clips[id]
            return !clip || clip.start + clip.duration <= start + 1e-5 || start + asset.duration <= clip.start + 1e-5
          }))
          if (!track) {
            track = { id: uid(), kind: 'audio', name: `SFX ${project.tracks.filter((x) => x.role === 'sfx').length + 1}`, clipIds: [], autoPack: false, role: 'sfx' }
            project.tracks.push(track)
            sfxTracks.push(track)
          }
          const clip: Clip = {
            id: uid(), assetId, trackId: track.id, start, inPoint: 0, duration: asset.duration,
            transform: { x: project.settings.width / 2, y: project.settings.height / 2, scale: 1, rotation: 0 },
            volume: Math.max(0, Math.min(1, volume))
          }
          project.clips[clip.id] = clip
          track.clipIds.push(clip.id)
          placed++
        }
      })
      return placed
    },

    placeAutomationImages: (placements, target, opts = {}) => {
      // Checked (and given its ids) before mutate(), so a rejected placement
      // makes neither a dirty project nor a phantom undo step.
      const plan = planAutomation(get().project, placements, target, opts)
      if (!plan) return null
      mutate((p) => applyAutomation(p, plan, opts.finish, env()))
      set({ selectedClipIds: [...plan.clipIds], selectedCaptionIds: [] })
      return { trackId: plan.trackId, trackName: plan.trackName, clipIds: plan.clipIds }
    },

    fillAutomationMissingImage: (clipId, image) => {
      const state = get()
      const clip = state.project.clips[clipId]
      const track = clip && findTrack(state.project, clip.trackId)
      if (!clip?.automationMissing || !track || track.kind !== 'video' || track.locked ||
        image.kind !== 'image' || image.missing) return false
      mutate((p) => {
        const current = p.clips[clipId]
        if (!current?.automationMissing) return
        const existing = p.assets.find((candidate) => candidate.kind === 'image' && !candidate.missing &&
          (candidate.id === image.id ||
            (!!candidate.path && !!image.path && candidate.path.toLocaleLowerCase() === image.path.toLocaleLowerCase())))
        const asset = existing ?? image
        if (!existing) p.assets.push(image)
        current.assetId = asset.id
        current.transform.scale = containScale(p, asset)
        current.volume = 1
        delete current.automationMissing
      })
      set({ selectedClipIds: [clipId], selectedCaptionIds: [] })
      return true
    },

    addClipAt: (assetId, trackId, start, commit = true) =>
      mutate((p) => void addClip.apply(p, { assetId, trackId, start }, env()), commit),

    moveClip: (clipId, newStart, commit = true) => {
      // The A/V link is the user's switch: read here, a parameter of the
      // command. A move a lock or a partner with no room holds is told.
      const link = get().linkAV
      if (tellLockedPartner(get().project, [clipId], link)) return
      if (!planMove(get().project, clipId, newStart, link)) {
        notify({ text: t('link.moveRefused'), kind: 'info' })
        return
      }
      mutate((p) => moveClip.apply(p, { clipId, start: newStart, linkAV: link }, env()), commit)
    },

    applyTimelinePlacement: (plan) => {
      if (!plan.changed && !plan.newTrack) return
      mutate((p) => placeClips.apply(p, { plan: plan as unknown as Record<string, unknown> }, env()), false)
    },

    nudgeSelection: (delta) => {
      const s = get()
      const ids = s.selectedClipIds.filter((id) => !!s.project.clips[id])
      // The plan's anchor: the earliest selected clip a lock does not hold.
      const anchor = ids
        .map((id) => s.project.clips[id])
        .filter((c) => !findTrack(s.project, c.trackId)?.locked)
        .sort((a, b) => a.start - b.start)[0]
      if (!anchor || !Number.isFinite(delta) || delta === 0) return
      // The drag's plan, so a nudge does what dragging by a frame would. Before,
      // each clip was moved alone, one undo step each plus an empty one, and
      // the first of two touching clips could not move into the second's place
      // (it stayed, and a gap opened between them).
      const plan = planTimelinePlacement(s.project, anchor.id, ids, delta, null, null, s.linkAV)
      if (!plan?.changed) return
      s.undoable(() => get().applyTimelinePlacement(plan))
    },

    groupSelection: () => {
      const ids = get().selectedClipIds
      if (ids.length < 2) return
      mutate((p) => {
        p.groups = (p.groups ?? []).filter((g) => !g.clipIds.some((id) => ids.includes(id)))
        p.groups.push({ id: uid(), clipIds: [...ids] })
      })
    },

    ungroupSelection: () => {
      const ids = get().selectedClipIds
      mutate((p) => {
        p.groups = (p.groups ?? []).filter((g) => !g.clipIds.some((id) => ids.includes(id)))
        if (p.groups.length === 0) delete p.groups
      })
    },

    revealEarlier: (clipId, seconds) =>
      mutate((p) => {
        const clip = p.clips[clipId]
        if (!clip || seconds <= 0) return
        // `seconds` is timeline time; the in point is media time. On a retimed
        // clip those differ by the speed factor, and mixing them revealed the
        // wrong amount of footage.
        const spd = clip.speed ?? 1
        // The clip grows at its end: never over the next clip on its track
        // (phase Ç2a.1: it used to run on top of it, model/check.ts).
        const end = clip.start + clip.duration
        const track = findTrack(p, clip.trackId)
        const room = Math.min(Infinity, ...(track?.clipIds ?? []).map((id) => p.clips[id]).filter((c) => c && c.id !== clip.id && c.start >= end - 1e-6).map((c) => c.start - end))
        const curved = !!clip.speedCurve && clip.freeze === undefined
        const ext = Math.min(seconds, curved ? headRoom(clip, Infinity) : clip.inPoint / spd, Math.max(0, room))
        if (ext <= 0.001) return
        // (Along a speed curve the revealed head plays at the curve's speeds:
        // core polish C.)
        if (curved) takePart(clip, clip, -ext, clip.duration)
        else clip.inPoint -= ext * spd
        clip.duration += ext
        // Existing motion stays with its content: every key moves later by
        // what was revealed (the mask's and the moves' too: phase Ç2c.1,
        // decision 1; report K17).
        sliceClipAutomation(clip, -ext, clip.duration - ext)
      }),

    deleteTrack: (trackId) => {
      // A locked track keeps its clips: not deleted, and said (Ç2b patch,
      // item 4). No edit, no undo step.
      const track = findTrack(get().project, trackId)
      if (track?.locked) {
        notify({ text: t('track.lockedNoDelete', { track: track.name }), kind: 'info' })
        return
      }
      let doomed: string[] = []
      mutate((p) => {
        doomed = deleteTrack.apply(p, { trackId }, env())
      })
      // The selection lets go of the clips that went with the track.
      if (doomed.length > 0) {
        set({ selectedClipIds: get().selectedClipIds.filter((id) => !doomed.includes(id)) })
      }
    },

    moveTrack: (trackId, dir) => mutate((p) => moveTrack.apply(p, { trackId, dir }, env())),
    renameTrack: (trackId, name) => mutate((p) => renameTrack.apply(p, { trackId, name }, env())),

    setTrackFlags: (trackId, patch) => {
      mutate((p) => {
        const track = p.tracks.find((t) => t.id === trackId)
        if (track) Object.assign(track, patch)
      }, false)
      // A locked track's clips leave the selection (phase Ç2b.1, decision 3:
      // one selected before the lock was still duplicated, retimed, moved).
      if (patch.locked) {
        const track = get().project.tracks.find((x) => x.id === trackId)
        const held = new Set(track?.clipIds ?? [])
        if (get().selectedClipIds.some((id) => held.has(id))) set({ selectedClipIds: get().selectedClipIds.filter((id) => !held.has(id)) })
      }
    },

    setTrackLevel: (trackId, level, commit = true) =>
      mutate((p) => {
        const track = p.tracks.find((t) => t.id === trackId)
        if (!track) return
        // A muted clip stays muted, at its own level.
        const clips = track.clipIds.map((id) => p.clips[id]).filter((c) => c && !c.muted)
        const top = Math.max(0, ...clips.map((c) => c.volume))
        const v = Math.max(0, Math.min(2, level))
        for (const c of clips) c.volume = top > 1e-4 ? Math.round((c.volume / top) * v * 1000) / 1000 : v
      }, commit, `track-level-${trackId}`),

    setClipsDisabled: (clipIds, disabled) =>
      mutate((p) => {
        for (const id of clipIds) {
          const clip = p.clips[id]
          if (!clip) continue
          if (disabled) clip.disabled = true
          else delete clip.disabled
        }
      }),

    setClipsAgentLock: (clipIds, locked) => {
      const ids = clipIds.filter((id) => !!get().project.clips[id])
      if (ids.length) mutate((p) => setAgentLock.apply(p, { ids, locked }, env()))
    },

    setClipsLabel: (clipIds, label) => {
      const ids = clipIds.filter((id) => !!get().project.clips[id] && (get().project.clips[id].label ?? null) !== label)
      if (ids.length) mutate((p) => setClipLabel.apply(p, { ids, label }, env()))
    },

    resolveTrackOverlaps: (trackId) =>
      mutate((p) => {
        const tracks = trackId ? p.tracks.filter((t) => t.id === trackId) : p.tracks
        for (const track of tracks) cascadeTrack(p, track)
        applyAutoPack(p)
      }, false),

    packTrack: (trackId) =>
      mutate((p) => {
        const track = findTrack(p, trackId)
        // Pressing the magnet collapses the whole track hard to 0 (fully left),
        // whatever kind it is — that's what "pack" means as a manual action
        // (commands/ops/base.ts gatherTrack; what it moved takes its linked
        // partner along, P11).
        if (track) gatherTrack(p, track)
      }),

    // The header's magnet button: the pure command (22 Nov; an agent's edit
    // can send the same). One undo step, as the button always was.
    setTrackMagnet: (trackId, on) => mutate((p) => void setMagnet.apply(p, { trackId, on }, env())),

    packMainTrack: () =>
      mutate((p) => {
        // "Main" = the original V1: the last video track in the array.
        const videoTracks = p.tracks.filter((t) => t.kind === 'video')
        const main = videoTracks[videoTracks.length - 1]
        if (!main) return
        const clips = main.clipIds
          .map((id) => p.clips[id])
          .filter(Boolean)
          .sort((a, b) => a.start - b.start)
        let cursor = 0
        for (const clip of clips) {
          clip.start = cursor
          cursor += clip.duration
        }
        sortTrack(p, main)
      }, false)
  }
}
