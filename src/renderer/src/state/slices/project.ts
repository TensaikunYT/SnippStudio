// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's project actions: settings, mode, name, the media (add, update,
// replace, delete), backdrop, transcription settings, snapping. Moved out of
// state/store.ts in SnippStudio phase 2B (no change).
import { replaceTimelineImage } from '../../media/replace'
import { resizeProjectCanvas } from '../../project/resize'
import { assetInCompound, findTrack, forgetClips, newAssetsOf } from '../../commands/ops/base'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'
import { runKey } from '../shared'
import { firstVideoRate } from '../../timeline/rates'
import { setCodeEdits, setCodeParams, setProjectLook } from '../../commands/codefilm'
import { defaultEnv } from '../../commands/core'

export type ProjectActions = Pick<EditorState, 
  | 'setSettings'
  | 'setMode'
  | 'setProjectName'
  | 'addAssets'
  | 'replaceImageClip'
  | 'updateAsset'
  | 'setAssetDerived'
  | 'deleteAsset'
  | 'setBackdrop'
  | 'setTranscription'
  | 'setSnap'
  | 'setCodeParams'
  | 'setCodeEdits'
  | 'setProjectLook'
>

export function projectActions(set: SetState, get: GetState, mutate: Mutate): ProjectActions {
  return {
    setSettings: (patch) => {
      const current = get().project.settings
      if (
        (patch.width === undefined || patch.width === current.width) &&
        (patch.height === undefined || patch.height === current.height) &&
        (patch.fps === undefined || patch.fps === current.fps)
      ) return
      mutate((p) => {
        const width = patch.width ?? p.settings.width
        const height = patch.height ?? p.settings.height
        resizeProjectCanvas(p, width, height)
        if (patch.fps !== undefined) p.settings.fps = patch.fps
      })
    },

    // Phase 5f: a code page's parameter values and the project look (typing
    // in one field is one undo step: the same key joins it).
    setCodeParams: (assetId, values) => {
      if (!get().project.assets.some((a) => a.id === assetId && a.kind === 'code')) return
      mutate((p) => void setCodeParams.apply(p, { assetId, values }, defaultEnv()), false, runKey(`code-params:${assetId}`, values))
    },
    // Cila K: hand-made changes of a code page's constants (one field typed
    // in, or one colour dragged, is one undo step: the same key joins it).
    setCodeEdits: (assetId, put, drop = [], run) => {
      if (!get().project.assets.some((a) => a.id === assetId && a.kind === 'code')) return
      mutate((p) => void setCodeEdits.apply(p, { assetId, put: put as unknown as Record<string, unknown>[], drop }, defaultEnv()), false, run ? `code-edits:${assetId}:${run}` : undefined)
    },
    setProjectLook: (look) => mutate((p) => void setProjectLook.apply(p, { look }, defaultEnv()), false, runKey('project-look', look)),

    setMode: (mode) => mutate((p) => void (p.mode = mode)),
    setProjectName: (name) => mutate((p) => void (p.name = name), false, runKey('project-name')),

    addAssets: (assets) => {
      // Same file already imported: the existing asset is reused, and the
      // duplicate is reported back as NOT added so the caller doesn't waste
      // a filmstrip decode on an id the project has never heard of. Nothing new
      // is no edit at all: no undo step (it used to push an empty one, which
      // also threw the redo history away), and the project stays saved.
      const added = newAssetsOf(get().project, assets)
      // An empty project takes its first video's frame rate when it is a
      // listed one (phase Ç3a, decision 4), in the same step.
      const rate = firstVideoRate(get().project, added)
      if (added.length > 0)
        mutate((p) => {
          p.assets.push(...added)
          if (rate !== null) p.settings.fps = rate
        })
      return added
    },

    replaceImageClip: (clipId, replacement) => {
      const state = get()
      const clip = state.project.clips[clipId]
      const current = clip ? state.project.assets.find((asset) => asset.id === clip.assetId) : undefined
      const track = clip ? state.project.tracks.find((candidate) => candidate.id === clip.trackId) : undefined
      if (!clip || current?.kind !== 'image' || replacement.kind !== 'image' || replacement.missing || !track || track.locked) {
        return false
      }
      const samePath =
        !!replacement.path && current.path?.toLocaleLowerCase() === replacement.path.toLocaleLowerCase()
      if (samePath || current.id === replacement.id) return true

      let changed = false
      mutate((project) => {
        changed = replaceTimelineImage(project, clipId, replacement)?.changed ?? false
      })
      return changed
    },

    updateAsset: (id, patch) =>
      mutate((p) => {
        const asset = p.assets.find((a) => a.id === id)
        if (asset) Object.assign(asset, patch)
        // Where a media file lives (a relink) is no edit: no undo step
        // (phase Ç2a.1), undo does not move it (Ç2a.2, report P4), and the
        // model check does not take it for an edit (a shorter file can leave
        // clips past its end: the relink says so, media/relink-ui.ts).
      }, 'outside', undefined, { media: true }),

    setAssetDerived: (id, patch) =>
      set((s) => {
        if (!s.project.assets.some((a) => a.id === id)) return {}
        // A new project object, because its identity is what the preview and
        // the effect deps read as "something changed" — but a shallow one, and
        // WITHOUT dirty. Opening a project rebuilds every thumbnail and
        // filmstrip, and going through the normal write meant a project was
        // unsaved the moment it finished loading: close it and the app asked
        // to save work nobody had done.
        const assets = s.project.assets.map((a) => (a.id === id ? { ...a, ...patch } : a))
        const project = { ...s.project, assets }
        // (Still the project the file has, if it was.)
        return { project, ...(s.savedProject === s.project ? { savedProject: project } : {}) }
      }),

    deleteAsset: (id, outside) => {
      // Used inside a compound clip: refused (the caller says so).
      if (assetInCompound(get().project, id)) return false
      // (`outside`: no undo step of its own, the redo kept — a code film an
      // agent's create brought in that no clip uses any more, audit A3.)
      mutate((p) => {
        p.assets = p.assets.filter((a) => a.id !== id)
        // Drop every clip built from this asset, off its track.
        const clipIds = Object.values(p.clips)
          .filter((c) => c.assetId === id)
          .map((c) => c.id)
        for (const cid of clipIds) {
          const clip = p.clips[cid]
          const track = clip && findTrack(p, clip.trackId)
          if (track) track.clipIds = track.clipIds.filter((x) => x !== cid)
          delete p.clips[cid]
        }
        forgetClips(p, clipIds)
      }, outside ? 'outside' : true)
      set((s) => ({ selectedClipIds: s.selectedClipIds.filter((cid) => !!get().project.clips[cid]) }))
      return true
    },
    setBackdrop: (backdrop, commit = true) =>
      mutate((p) => {
        if (!backdrop || backdrop.style === 'black') delete p.backdrop
        else p.backdrop = { ...backdrop }
      }, commit, 'backdrop'),

    setTranscription: (patch) =>
      mutate((p) => {
        p.transcription = { model: 'english', language: 'auto', ...p.transcription, ...patch }
      }, false),

    // Clips on screen anywhere inside the range, arranged within the frame.

    setSnap: (patch) =>
      mutate((p) => {
        Object.assign(p.snap, patch)
        // Snapping is how the timeline behaves, not the film: no undo step.
      }, 'outside')
  }
}
