// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's view actions: what is selected, where the playhead is, playing,
// zoom, tools and modes, previews and overlays, status lines. No undo step.
// Moved out of state/store.ts in SnippStudio phase 2B (no change).
import { setProxyMode } from '../../media/sources'
import { setScrubAdaptive } from '../../playback/scrub'
import { projectDuration } from '../../types'
import type { EditorState } from '../editor-state'
import { langOf, setLang } from '../../ui/strings'
import { localizeMessage } from '../../ui/errors'
import type { GetState, Mutate, SetState } from './types'

export type ViewActions = Pick<EditorState, 
  | 'setPreviewQuality'
  | 'setAdaptiveQuality'
  | 'setPreviewView'
  | 'setTrackHeight'
  | 'setSilencePreview'
  | 'setAudioDrift'
  | 'focusInspector'
  | 'setDirty'
  | 'setProxiesEnabled'
  | 'setEyedropper'
  | 'setMaskOverlay'
  | 'setClipTabActive'
  | 'setLoopRange'
  | 'setDragPreview'
  | 'setSnapGuide'
  | 'setRangePreview'
  | 'setPlayheadSnap'
  | 'setLinkAV'
  | 'setShowGuideOverlay'
  | 'setUiLang'
  | 'setCutterMode'
  | 'setSplitToolMode'
  | 'setSlipToolMode'
  | 'setMapPick'
  | 'setScopeKind'
  | 'setTime'
  | 'setPlaying'
  | 'selectClip'
  | 'selectClips'
  | 'selectAll'
  | 'selectCaptions'
  | 'requestCaptionEdit'
  | 'setPxPerSec'
  | 'setTimelineMagnet'
  | 'setTranscribeStatus'
  | 'setTranscribeProgress'
  | 'setExportStatus'
  | 'setMaskDrawMode'
  | 'setSelectedTracker'
  | 'selectTemplate'
  | 'toggleExportQueue'
  | 'clearExportQueue'
  | 'reorderExportQueue'
>

export function viewActions(set: SetState, get: GetState, mutate: Mutate): ViewActions {
  return {
    setPreviewQuality: (previewQuality) => set({ previewQuality }),
    setAdaptiveQuality: (adaptiveQuality) => {
      localStorage.setItem('snipp-adaptive-quality', adaptiveQuality ? 'on' : 'off')
      // The decoder has a cheap tier of its own — the one that made scrubbing
      // look like mud. Both sides of the preview answer to this one switch.
      setScrubAdaptive(adaptiveQuality)
      set({ adaptiveQuality })
    },
    setPreviewView: (v) => set((s) => ({ previewView: { ...s.previewView, ...v } })),

    setTrackHeight: (trackId, height) =>
      mutate((p) => {
        const track = p.tracks.find((t) => t.id === trackId)
        // (No height: the lane's own kind's again, as before it was dragged.)
        if (track && height === undefined) delete track.height
        else if (track) track.height = Math.max(30, Math.min(200, height as number))
        // A row's height is the view: no undo step (phase Ç2a.1, decision 4).
      }, 'outside'),

    setSilencePreview: (silencePreview) => set({ silencePreview }),
    setAudioDrift: (audioDrift) => set({ audioDrift }),
    focusInspector: (section) =>
      set((s) => ({ inspectorFocus: { section, nonce: (s.inspectorFocus?.nonce ?? 0) + 1 } })),
    // (Saved: this project is the file's. Made unsaved by hand: the file has
    // no project this one returns to.)
    setDirty: (dirty) => set((s) => (dirty ? { dirty, editSeq: s.editSeq + 1, savedProject: null } : { dirty, savedProject: s.project })),
    setProxiesEnabled: (on) => {
      setProxyMode(on)
      set({ proxiesEnabled: on })
    },
    setEyedropper: (eyedropperClip) => set({ eyedropperClip }),
    setMaskOverlay: (maskOverlay) => set({ maskOverlay }),
    setClipTabActive: (clipTabActive) => set({ clipTabActive }),
    setLoopRange: (loopRange) => set({ loopRange }),
    setDragPreview: (dragPreview) => set({ dragPreview }),
    setSnapGuide: (snapGuide) => set((s) => (s.snapGuide === snapGuide ? s : { snapGuide })),
    setRangePreview: (rangePreview) => set({ rangePreview }),
    setPlayheadSnap: (playheadSnap) => {
      localStorage.setItem('autocut-playhead-snap', playheadSnap ? 'on' : 'off')
      set({ playheadSnap })
    },
    setLinkAV: (linkAV) => {
      localStorage.setItem('autocut-link-av', linkAV ? 'on' : 'off')
      set({ linkAV })
    },
    setShowGuideOverlay: (showGuideOverlay) => {
      localStorage.setItem('autocut-guides', showGuideOverlay ? 'on' : 'off')
      set({ showGuideOverlay })
    },
    setUiLang: (lang) => {
      const uiLang = langOf(lang)
      try {
        localStorage.setItem('snipp-ui-lang', uiLang)
      } catch {
        /* storage blocked: the choice lasts this session */
      }
      setLang(uiLang)
      set({ uiLang })
    },
    // The tools are mutually exclusive: each one redefines what a press on a
    // clip means, so two of them on at once has no meaning.
    setCutterMode: (cutterMode) =>
      set(
        cutterMode
          ? { cutterMode, splitToolMode: false, slipToolMode: false }
          : { cutterMode, cutMarks: [], cutTrackId: null }
      ),
    setSplitToolMode: (splitToolMode) =>
      set(splitToolMode ? { splitToolMode, cutterMode: false, slipToolMode: false } : { splitToolMode }),
    setSlipToolMode: (slipToolMode) =>
      set(slipToolMode ? { slipToolMode, cutterMode: false, splitToolMode: false } : { slipToolMode }),
    setMapPick: (mapPick) => set({ mapPick }),
    setScopeKind: (scopeKind) => set({ scopeKind }),

    setTime: (t) => {
      // The playhead can roam past the last clip into empty space (to position
      // where the next clip will land), up to a generous margin beyond the
      // content. An empty timeline still scrubs freely.
      const dur = projectDuration(get().project)
      const max = dur > 0 ? dur + 300 : 600
      set({ currentTime: Math.min(Math.max(0, t), max) })
    },
    setPlaying: (playing) => {
      const s = get()
      if (playing && !s.playing && !s.loopRange) {
        // Play with the playhead at (or past) the end starts again from the
        // top. Before, it stopped on the very next frame: Space did nothing.
        const end = projectDuration(s.project)
        if (end > 0 && s.currentTime >= end - 1e-3) {
          set({ playing, currentTime: 0 })
          return
        }
      }
      set({ playing })
    },
    selectClip: (id, additive = false) => {
      // One thing answers Delete / Ctrl+C at a time: picking a clip lets go
      // of a selected graphic.
      if (id !== null && get().templateSel) set({ templateSel: null })
      set((s) => {
        if (id === null) return { selectedClipIds: [] }
        // Grouped clips select as one block.
        const group = s.project.groups?.find((g) => g.clipIds.includes(id))
        const unit = group ? group.clipIds.filter((cid) => s.project.clips[cid]) : [id]
        if (additive) {
          const has = unit.every((u) => s.selectedClipIds.includes(u))
          return {
            selectedClipIds: has
              ? s.selectedClipIds.filter((x) => !unit.includes(x))
              : [...new Set([...s.selectedClipIds, ...unit])]
          }
        }
        return {
          selectedClipIds: unit.every((u) => s.selectedClipIds.includes(u)) ? s.selectedClipIds : unit
        }
      })
    },
    selectClips: (selectedClipIds) => set({ selectedClipIds }),
    selectAll: () => {
      const { project } = get()
      // Locked tracks are excluded: selecting a clip you can't move or trim
      // only means the next Delete takes it with everything else.
      const clipIds: string[] = []
      for (const track of project.tracks) {
        if (track.locked) continue
        for (const id of track.clipIds) if (project.clips[id]) clipIds.push(id)
      }
      set({
        selectedClipIds: clipIds,
        selectedCaptionIds: project.captions.map((c) => c.id)
      })
    },
    selectCaptions: (selectedCaptionIds) =>
      set((s) => ({
        selectedCaptionIds,
        ...(selectedCaptionIds.length > 0 ? { templateSel: null } : {})
      })),
    requestCaptionEdit: (captionEditRequest) => set({ captionEditRequest }),
    // Floor of 1 px/s, not 8: at 8 an 8-minute video is ~3800 px wide, so it
    // could never be zoomed out far enough to see in one screen.
    setPxPerSec: (pxPerSec) => set({ pxPerSec: Math.min(600, Math.max(1, pxPerSec)) }),
    setTimelineMagnet: (timelineMagnet) => set({ timelineMagnet }),
    // The transcription's lines come from the engine in English: shown in the
    // interface's language (phase 9b; nothing but the top bar and the
    // Subtitles tab reads them).
    setTranscribeStatus: (transcribeStatus) => set({ transcribeStatus: transcribeStatus === null ? null : localizeMessage(transcribeStatus) }),
    setTranscribeProgress: (transcribeProgress) => set({ transcribeProgress: transcribeProgress ? { ...transcribeProgress, label: localizeMessage(transcribeProgress.label) } : transcribeProgress }),
    setExportStatus: (exportStatus) => set({ exportStatus }),
    setMaskDrawMode: (maskDrawMode) => set({ maskDrawMode }),
    setSelectedTracker: (selectedTrackerId) => set({ selectedTrackerId }),
    selectTemplate: (templateSel) =>
      set(templateSel ? { templateSel, selectedClipIds: [], selectedCaptionIds: [] } : { templateSel }),
    toggleExportQueue: (segmentId) =>
      set((st) => ({
        exportQueue: st.exportQueue.includes(segmentId)
          ? st.exportQueue.filter((id) => id !== segmentId)
          : [...st.exportQueue, segmentId]
      })),
    clearExportQueue: () => set({ exportQueue: [] }),
    reorderExportQueue: (segmentId, delta) =>
      set((st) => {
        const i = st.exportQueue.indexOf(segmentId)
        const j = i + delta
        if (i < 0 || j < 0 || j >= st.exportQueue.length) return st
        const next = [...st.exportQueue]
        next.splice(j, 0, ...next.splice(i, 1))
        return { exportQueue: next }
      })
  }
}
