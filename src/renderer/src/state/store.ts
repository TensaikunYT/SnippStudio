// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { create } from 'zustand'


import { applyAnimation, applyKeyframeStamp, readKeyframeStamp, snapshotAnimation, type AnimationSnapshot, type KeyframeStamp } from './animclip'
import { keyLocalAt } from '../timeline/key-grid'
import { setScrubAdaptive } from '../playback/scrub'


import { produce } from './cow'
import { afterEdit } from '../model/check-hook'
import { settleTransitions } from '../timeline/transition-links'


import { followClipEdits } from '../subtitles/follow'
import { withPartners } from '../commands/ops/links'
import { followNotes } from '../notes/follow'
import { NOTE_COLORS } from '../notes/model'
import type { Caption, CaptionStyle, Clip, Project, ShortSegment } from '../types'
import { defaultProject, newProjectUid, uid } from '../types'
import { withSpokenDefault } from '../subtitles/spoken-default'

import { clone, findTrack } from '../commands/ops/base'


import { codeFilmMix } from '../commands/ops/media'


import { clipTimingChanged, filmChanged, sameValue } from '../history/equal'
import { candidate } from '../playback/candidate'


import type { EditorState } from './editor-state'
import { MAX_UNDO, runtimeExtras, noteImages, historySnapshot, restoreSnapshot, reconcileAfterTimeTravel, carryView, carryMedia } from './history'
import { clock, filmGate, versions, lockedTracksAfter } from './shared'
import { viewActions } from './slices/view'
import { langOf, setLang } from '../ui/strings'
import { versionActions } from './slices/versions'
import { projectActions } from './slices/project'
import { placingActions } from './slices/placing'
import { cuttingActions } from './slices/cutting'
import { keyframeActions } from './slices/keyframes'
import { clipActions } from './slices/clip'
import { effectActions } from './slices/effects'
import { captionActions } from './slices/captions'
import { noteActions } from './slices/notes'
import { shortsActions } from './slices/shorts'
import { clearExportMarks } from '../export/marks'
import { captionFontDefault } from '../os-platform'

/** A new project's subtitle font as this computer has it (phase 10a.6, F2):
 *  Arial on Windows as always; elsewhere Arial if there, else the bundled
 *  Inter. Only new projects: a loaded one keeps its own. */
function withLocalCaptionFont<P extends { captionStyle: { fontFamily: string } }>(p: P): P {
  const family = captionFontDefault()
  if (family !== p.captionStyle.fontFamily) p.captionStyle = { ...p.captionStyle, fontFamily: family }
  return p
}
/** A new project's main picture lane (V1, the last video track) closes its
 *  gaps by itself: the lane magnet is on (22 November, L11; the user's list:
 *  "main track magnet"). It worked, but a new project started with it off,
 *  so deleting a clip left a hole. Only new projects: a loaded one keeps its
 *  own lanes as they were saved; the lane's magnet button turns it off. */
export function withMainMagnet<P extends { tracks: { kind: string; autoPack?: boolean }[] }>(p: P): P {
  const main = [...p.tracks].reverse().find((t) => t.kind === 'video')
  if (main) main.autoPack = true
  return p
}
export { SEGMENT_COLORS } from './shared'
export type { AutomationPlacementResult, NoteDraft, EditorState } from './editor-state'
export { codeFilmMix }

/**
 * Session state that must NOT survive swapping the project. Every id here
 * points into the old timeline — a loop range from another edit, a "selected"
 * segment that no longer exists — so both New and Open reset through this one
 * helper rather than each keeping their own (previously diverging) list.
 */
function freshSessionState(): {
  currentTime: number
  playing: boolean
  selectedClipIds: string[]
  selectedCaptionIds: string[]
  activeShortSegmentId: string | null
  selectedTrackerId: string | null
  templateSel: null
  loopRange: [number, number] | null
  cutMarks: number[]
  cutTrackId: null
  exportQueue: string[]
  silencePreview: null
  dragPreview: null
  snapGuide: null
  rangePreview: null
  noteSel: null
  noteDraft: null
  noteTool: null
  noteReview: null
  /** The undo history: the projects as they were (state/history.ts). */
  past: Project[]
  future: Project[]
  dirty: boolean
} {
  // An armed undo snapshot points at the OUTGOING project, so it has to go too.
  armedProject = null
  gestureOpen = false
  gestureRecorded = false
  windowBase = null
  // The export's in and out points were the outgoing project's (phase Ç3
  // patch, R-3: a window opened in "In–Out" with another project's range).
  clearExportMarks()
  return {
    currentTime: 0,
    playing: false,
    // Segment ids from the outgoing project mean nothing in the new one.
    exportQueue: [],
    selectedClipIds: [],
    selectedCaptionIds: [],
    activeShortSegmentId: null,
    selectedTrackerId: null,
    templateSel: null,
    loopRange: null,
    cutMarks: [],
    cutTrackId: null,
    silencePreview: null,
    // Pointers into the outgoing project: a drag's ghost, the snap line, a
    // pending range.
    dragPreview: null,
    snapGuide: null,
    rangePreview: null,
    // Notes of the outgoing project: the one picked, the one half written.
    noteSel: null,
    noteDraft: null,
    noteTool: null,
    noteReview: null,
    past: [],
    future: [],
    dirty: false
  }
}

/** Clipboard for "copy animation" — deliberately outside the project so it
 *  survives undo/redo and project loads, like a real app clipboard. */
/** Which clipboard was filled last, so one Ctrl+V can serve both without
 *  asking the user to remember a second shortcut. */
/** What Ctrl+C last put on a clipboard, and therefore what Ctrl+V means. */
let lastCopy: 'clips' | 'captions' | 'animation' | 'keyframe' = 'clips'

/** Read once, and pushed into the decoder before the first frame is asked for
 *  — otherwise the very first scrub of a session uses whichever tier the
 *  module happened to start with. */
const adaptiveQualityAtStart = localStorage.getItem('snipp-adaptive-quality') === 'on'
setScrubAdaptive(adaptiveQualityAtStart)

/** The interface's language (ui/strings.ts), as the user last chose it. */
const uiLangAtStart = langOf(localStorage.getItem('snipp-ui-lang'))
setLang(uiLangAtStart)

let copiedAnimation: AnimationSnapshot | null = null
/** One copied keyframe group, pasted at the playhead. See KeyframeStamp. */
let copiedKeyframe: KeyframeStamp | null = null
/** Copied text/shape captions — Ctrl+C with a title selected. */
let copiedCaptions: Caption[] | null = null

/** Clipboard for a copied Shorts segment — same reasoning as copiedAnimation. */
let copiedSegment: ShortSegment | null = null

/**
 * Undo snapshot armed by a UI gesture but not yet spent.
 *
 * A slider fires `change` on every pixel, so its store action must not snapshot
 * per change — but something has to, or the edit isn't undoable at all. The
 * control arms this on pointer-down and the first project mutation spends it.
 * Arming rather than pushing matters: the same Slider component is also used for
 * things that only touch local UI state (the silence-cut dialog, the gradient
 * builder), and pushing up front left those with an undo step that undid nothing.
 */
let armedProject: Project | null = null

/** Text look on an app-level clipboard (survives undo and project loads). */
let copiedCaptionStyle: CaptionStyle | null = null

/**
 * …and the same gesture must stay ONE undo step even when the action behind the
 * control does snapshot by default. Position X/Y, Rotate, Opacity and the mask
 * sliders all ran through actions that record on every `change`, so a two-second
 * drag buried the undo stack under a hundred entries and Ctrl+Z crawled back
 * through the drag a pixel at a time instead of undoing it. While the window is
 * open the first mutation records (spending the armed snapshot) and the rest
 * ride on it, whatever the action asked for.
 *
 * The window closes on pointer-up / key-up / blur, and — belt and braces, since
 * a missed close would silently glue every later edit onto that one step — after
 * GESTURE_IDLE_MS with no further change.
 */
let gestureOpen = false
let gestureRecorded = false
let gestureAt = 0
const GESTURE_IDLE_MS = 1500
/** Is a UI drag (or a held control) under way: an open gesture window that
 *  is not left idle. A job's result waits for its end (phase 4A.10, E3). */
export function dragInProgress(): boolean {
  return gestureOpen && !(gestureRecorded && clock.now() - gestureAt > GESTURE_IDLE_MS)
}

/** How deep inside `undoable` / `runBatch` we are. A code window is one step
 *  however long it runs and however it nests: the idle timer is for UI
 *  gestures only, and an inner window neither re-arms nor closes it. */
let batchDepth = 0

/** Bumped when another project is opened or a new one started: a job that
 *  takes minutes (a transcription) checks it before it writes its result,
 *  so the result never lands in a project it was not made for. */
let projectSessionSeq = 0
export const projectSession = (): number => projectSessionSeq

/** The project before the first change of the open edit window (a drag, a
 *  code window): the model check runs on the window's edits as one when it
 *  closes (phase Ç2a.1). */
let windowBase: Project | null = null
function checkWindow(now: Project): void {
  const base = windowBase
  windowBase = null
  if (base) afterEdit(base, now, 'an edit window')
}

/** Continuation window for merging repeated edits into one undo step. */
const MERGE_MS = 1200
let lastMergeKey = ''
let lastMergeAt = 0

/** Closes every open edit window (a drag's, a run of same-key edits): the
 *  next edit is a step of its own, whatever the clock says. For a sequence
 *  of steps run faster than a person makes them (phase 4A.9, A8). */
export function closeEditWindows(): void {
  if (batchDepth > 0) return
  gestureOpen = false
  gestureRecorded = false
  armedProject = null
  lastMergeKey = ''
  lastMergeAt = 0
  checkWindow(useStore.getState().project)
}

export const useStore = create<EditorState>((set, get) => {
  /**
   * Snapshot the project for undo, then apply a mutation to a fresh copy.
   *
   * `mergeKey` collapses a run of the same edit into ONE undo step: an
   * `onChange` text field writes to the store on every keystroke, so typing a
   * forty-character caption used to push forty snapshots and shove everything
   * else off the end of the history. Repeats of the same key inside a short
   * window ride on the first snapshot; anything else breaks the run, so two
   * genuinely different edits are never merged.
   */
  const mutate = (
    fn: (p: Project) => void,
    snapshot: boolean | 'outside' = true,
    mergeKey?: string,
    meta?: { cuts?: [number, number][][]; next?: Project; media?: boolean; fixed?: readonly string[] }
  ): void => {
    const state = get()
    // Copy-on-write (state/cow.ts): the edit works on a draft, and the new
    // project shares every part it did not touch with the old one. It used
    // to structuredClone the whole project on every edit — every slider
    // tick and every pointer move of a trim — and gave every part a new
    // identity, so nothing could tell an untouched part from a changed one.
    // A project made already (a batch run call by call, an adopted
    // candidate) is written as it is; its follow passes have run.
    // A transition whose clip is no longer the one after it goes, one set
    // just now takes the clip after it (phase Ç2b.2, decision 1).
    const next = settleTransitions(meta?.next ?? produce(state.project, (d) => {
      fn(d)
      // Subtitles go where their voice clip went (moved, trimmed, split, cut
      // out, sped up): every clip edit passes through here.
      followClipEdits(state.project, d)
      // And the work notes stay on the picture they were written about.
      followNotes(state.project, d)
    }), state.project)
    // An edit that changed nothing is no edit: no undo step, not unsaved, and
    // an armed gesture keeps its snapshot for the change it was armed for.
    if (next === state.project || sameValue(state.project, next)) {
      // A drag held on a snap or against a stop changes nothing for a while:
      // it is still the same drag, so its window stays open.
      if (gestureOpen && gestureRecorded) gestureAt = clock.now()
      return
    }
    // "After" (an agent's draft on the timeline) is read-only: an edit of the
    // film made there is not made, and the user is told (state/shared.ts).
    // (What is on the timeline — clips, lanes, lines, markers, graphics —
    // not the media list: a film an agent's code clip brings in still lands.)
    if (filmGate.refuses) {
      const was = state.project
      const onTimeline = next.clips !== was.clips || next.tracks !== was.tracks || next.captions !== was.captions || next.markers !== was.markers || next.templates !== was.templates
      if (onTimeline && filmChanged(was, next) && filmGate.refuses()) return
    }
    // A pending silence-cut preview names clips and times: stale once the
    // clips' timing changed, whichever path the edit took.
    const sp = clipTimingChanged(state.project, next) ? { silencePreview: null } : {}
    // A change of the film is a new version (history/versions.ts); a note's
    // text or status, or a row's height, is not. A whole-timeline cut says
    // which ranges, so older times can be moved to the new ones.
    const vp = filmChanged(state.project, next)
      ? { projectVersion: versions.record(meta?.cuts ? 'cut' : 'edit', next, meta?.cuts, meta?.cuts ? lockedTracksAfter(state.project, meta.cuts, meta.fixed) : undefined) }
      : {}
    // Inside a control gesture (slider drag, held arrow key): one step for the
    // whole thing, no matter what the individual action asked for.
    // Only a gesture that has recorded its step closes on the idle timer: a
    // drag held still for a while before its first change (a clip dragged
    // and dropped after two seconds) still gets its own undo step. The
    // pointer-up / key-up handlers always close it.
    if (gestureOpen && gestureRecorded && batchDepth === 0 && clock.now() - gestureAt > GESTURE_IDLE_MS) {
      gestureOpen = false
      gestureRecorded = false
      armedProject = null
      checkWindow(state.project)
    }
    // The model's rules (model/check.ts), when a test or a development build
    // installed the check (phase Ç2a.1): an edit outside any window now; the
    // edits of an open window (a drag, a code window) as ONE edit when it
    // closes. A drag's moves in between may pass through a state that is no
    // edit (an Alt-drag's copy sits on its original until the drop).
    if (gestureOpen) windowBase = windowBase ?? state.project
    else if (!meta?.media) afterEdit(state.project, next, 'an edit')
    if (gestureOpen) {
      gestureAt = clock.now()
      if (gestureRecorded) {
        set({ project: next, ...vp,
        ...sp, dirty: true, editSeq: state.editSeq + 1, ...(state.future.length ? { future: [] } : {}) })
        return
      }
      const armed = armedProject ?? state.project
      armedProject = null
      gestureRecorded = true
      lastMergeKey = ''
      set({
        project: next,
        ...vp,
        ...sp,
        dirty: true,
        editSeq: state.editSeq + 1,
        past: [...state.past.slice(-MAX_UNDO), historySnapshot(armed)],
        future: []
      })
      return
    }
    // No window is open. A change outside the history (a row's height, the
    // snapping, a note's status, where a file lives): no step of its own, the
    // redo stack kept; undo and redo carry the view fields over (viewOf).
    if (snapshot === 'outside') {
      set({ project: next, ...vp, ...sp, dirty: true, editSeq: state.editSeq + 1 })
      return
    }
    // Every other change is an undo step of its own (phase Ç2a.1, report D2 /
    // P1): `snapshot = false` only means "join the open window", and with none
    // open the change is recorded all the same. Before, such a change (a track
    // mute, a subtitle style box) had no step: it was undone together with the
    // edit before it, and it left the redo stack in place. A run of the same
    // `mergeKey` (typing, a colour being picked) is one step.
    if (mergeKey) {
      const now = clock.now()
      const merge = mergeKey === lastMergeKey && now - lastMergeAt < MERGE_MS
      lastMergeKey = mergeKey
      lastMergeAt = now
      if (merge) {
        set({ project: next, ...vp,
        ...sp, dirty: true, editSeq: state.editSeq + 1, ...(state.future.length ? { future: [] } : {}) })
        return
      }
    } else {
      lastMergeKey = ''
    }
    const base = armedProject ?? state.project
    armedProject = null
    set({
      project: next,
      ...vp,
      ...sp,
      dirty: true,
      editSeq: state.editSeq + 1,
      past: [...state.past.slice(-MAX_UNDO), historySnapshot(base)],
      future: []
    })
  }

  const initialProject = withMainMagnet(withSpokenDefault(withLocalCaptionFont(defaultProject('16:9', uiLangAtStart))))
  // (The project a run starts with is a new project: it has an identity.)
  initialProject.uid = newProjectUid()
  return {
    project: initialProject,
    projectVersion: versions.record('load', initialProject),
    versionEpoch: versions.epoch,
    currentTime: 0,
    playing: false,
    selectedClipIds: [],
    pxPerSec: 60,
    timelineMagnet: true,
    previewQuality: 1,
    adaptiveQuality: adaptiveQualityAtStart,
    previewView: { zoom: 1, x: 0, y: 0 },
    transcribeStatus: null,
    transcribeProgress: null,
    exportStatus: null,
    silencePreview: null,
    past: [],
    future: [],

    audioDrift: 0,

    inspectorFocus: null,

    dirty: false,
    savedProject: initialProject,
    editSeq: 0,

    beginGesture: () => {
      // Inside a code window the window's own step covers it.
      if (batchDepth > 0) return
      const state = get()
      armedProject = null
      gestureOpen = false
      checkWindow(state.project)
      set({
        past: [...state.past.slice(-MAX_UNDO), historySnapshot(state.project)],
        future: []
      })
      // The drag that follows is an open, recorded window (closed by the
      // pointer-up, App.tsx): its silent moves ride on this step, and a code
      // window coming in the middle of it knows a drag is going on.
      gestureOpen = true
      gestureRecorded = true
      gestureAt = clock.now()
    },

    /** Arm a snapshot to be spent by this gesture's first project change. */
    armGesture: () => {
      if (batchDepth > 0) return
      checkWindow(get().project)
      armedProject = get().project
      gestureOpen = true
      gestureRecorded = false
      gestureAt = clock.now()
    },

    /** Closes the window opened by `armGesture` (pointer up, key up, blur). */
    endGesture: () => {
      if (batchDepth > 0) return
      gestureOpen = false
      gestureRecorded = false
      armedProject = null
      checkWindow(get().project)
    },

    undoable: (fn) => {
      // Nested: part of the window already open.
      if (batchDepth > 0) {
        batchDepth++
        try {
          fn()
        } finally {
          batchDepth--
        }
        return
      }
      // A UI drag in progress keeps the step it made so far; this window
      // makes its own, and the drag goes on afterwards as a new step. Before,
      // the window took over the drag's step (and the drag's end closed it).
      // A window left open and idle is no drag any more: it just closes.
      const now = clock.now()
      const dragging = gestureOpen && !(gestureRecorded && now - gestureAt > GESTURE_IDLE_MS)
      const drag = { armed: armedProject, recorded: gestureRecorded, at: gestureAt }
      // A drag's own check waits for the drag's end; a window left idle is
      // over (its check is made now).
      const dragBase = dragging ? windowBase : null
      if (dragging) windowBase = null
      else checkWindow(get().project)
      armedProject = get().project
      gestureOpen = true
      gestureRecorded = false
      gestureAt = clock.now()
      batchDepth = 1
      try {
        fn()
      } finally {
        const applied = gestureRecorded
        batchDepth = 0
        gestureOpen = false
        gestureRecorded = false
        armedProject = null
        if (dragging && applied) {
          // The drag goes on as a step of its own after this one.
          armedProject = get().project
          gestureOpen = true
          gestureAt = clock.now()
        } else if (dragging) {
          // Nothing was applied: the drag's window is as it was.
          armedProject = drag.armed
          gestureOpen = true
          gestureRecorded = drag.recorded
          gestureAt = drag.at
        }
        // This window's edits, as one; the drag's window goes on with its own.
        checkWindow(get().project)
        windowBase = dragBase
      }
    },

    undo: () => {
      const state = get()
      const { past, future, project } = state
      // Time travel invalidates anything a control armed before it (and a
      // window's edits that it takes back are no edit to check).
      armedProject = null
      gestureOpen = false
      gestureRecorded = false
      windowBase = null
      if (past.length === 0) return
      const entry = past[past.length - 1]
      // (The media fields are the current project's: phase Ç2a.2, P4.)
      const step = carryView(project, restoreSnapshot(entry))
      const restored = carryMedia(project, step)
      // Back to the project as it was saved, the project is saved again
      // (phase Ç2a.1, report P13) — unless a media field it carries over
      // differs from the file (a relink since); anything else has to be saved
      // (and is autosaved and recovered).
      const saved = entry === state.savedProject && restored === step
      set({
        project: restored,
        projectVersion: filmChanged(project, restored) ? versions.record('undo', restored) : state.projectVersion,
        past: past.slice(0, -1),
        future: [...future, historySnapshot(project)],
        dirty: !saved,
        ...(saved ? { savedProject: restored } : {}),
        editSeq: state.editSeq + 1,
        ...reconcileAfterTimeTravel(restored, state)
      })
      lastMergeKey = ''
      lastMergeAt = 0
    },
    redo: () => {
      const state = get()
      const { past, future, project } = state
      armedProject = null
      gestureOpen = false
      gestureRecorded = false
      windowBase = null
      if (future.length === 0) return
      const entry = future[future.length - 1]
      const step = carryView(project, restoreSnapshot(entry))
      const restored = carryMedia(project, step)
      const saved = entry === state.savedProject && restored === step
      set({
        project: restored,
        projectVersion: filmChanged(project, restored) ? versions.record('redo', restored) : state.projectVersion,
        future: future.slice(0, -1),
        past: [...past, historySnapshot(project)],
        dirty: !saved,
        ...(saved ? { savedProject: restored } : {}),
        editSeq: state.editSeq + 1,
        ...reconcileAfterTimeTravel(restored, state)
      })
      lastMergeKey = ''
      lastMergeAt = 0
    },

    newProject: (aspect) => {
      projectSessionSeq++
      runtimeExtras.clear()
      noteImages.clear()
      // (Its spoken language follows the interface's: phase 9 audit patch D1;
      // unless Settings → General names one: subtitles/spoken-default.ts.)
      const project = withMainMagnet(withSpokenDefault(withLocalCaptionFont(defaultProject(aspect, get().uiLang))))
      project.uid = newProjectUid()
      // A candidate was made from the outgoing project.
      candidate.clear()
      set((s) => ({ project, savedProject: project, projectVersion: versions.record('load', project), ...freshSessionState(), editSeq: s.editSeq + 1 }))
    },

    loadProject: (p) => {
      projectSessionSeq++
      runtimeExtras.clear()
      noteImages.clear()
      candidate.clear()
      set((s) => ({ project: p, savedProject: p, projectVersion: versions.record('load', p), ...freshSessionState(), editSeq: s.editSeq + 1 }))
    },

    copyClipAnimation: (clipId) => {
      const clip = get().project.clips[clipId]
      if (!clip) return
      const snap = snapshotAnimation(clip)
      // Nothing to copy? Leave the clipboard alone rather than arming an empty
      // one — pasting an empty snapshot used to wipe the target's keyframes.
      if (!snap) return
      lastCopy = 'animation'
      copiedAnimation = snap
    },

    pasteClipAnimation: (clipIds, opts = {}) =>
      mutate((p) => {
        if (!copiedAnimation) return
        for (const id of clipIds) {
          const clip = p.clips[id]
          // Not onto a locked track (phase Ç2c.2, report K20).
          if (clip && !findTrack(p, clip.trackId)?.locked) applyAnimation(clip, copiedAnimation, uid, opts)
        }
      }),

    hasCopiedAnimation: () => copiedAnimation !== null,

    copyKeyframeStamp: (clipId, localTime) => {
      const clip = get().project.clips[clipId]
      if (!clip) return false
      const stamp = readKeyframeStamp(clip, localTime, get().project.settings.fps)
      if (!stamp) return false
      copiedKeyframe = stamp
      lastCopy = 'keyframe'
      return true
    },

    hasCopiedKeyframe: () => copiedKeyframe !== null,

    pasteKeyframeAtPlayhead: (clipIds) => {
      const s = get()
      const stamp = copiedKeyframe
      const ids = clipIds ?? s.selectedClipIds
      if (!stamp || ids.length === 0) return 0
      // Work out the targets BEFORE mutating: a paste that lands on nothing
      // must not push an undo step that undoes nothing. The playhead has to be
      // over the clip — a keyframe outside a clip's own span is unreachable,
      // undeletable and invisible, which is the bug the clamped diamonds came
      // from in the first place.
      const targets: { id: string; local: number }[] = []
      for (const id of ids) {
        const clip = s.project.clips[id]
        if (!clip) continue
        if (findTrack(s.project, clip.trackId)?.locked) continue
        // On the frame grid (phase Ç2c.2, decision 1).
        const local = keyLocalAt(clip, s.currentTime, s.project.settings.fps)
        if (local === null) continue
        targets.push({ id, local })
      }
      if (targets.length === 0) return 0
      mutate((p) => {
        for (const t of targets) {
          const clip = p.clips[t.id]
          if (!clip) continue
          applyKeyframeStamp(clip, t.local, stamp, p.settings.fps)
        }
      })
      return targets.length
    },

    proxiesEnabled: false,

    clipboard: null,
    clipboardAssets: [],

    copySelection: () => {
      const s = get()
      // A selected title or shape is what Ctrl+C is about when there is one:
      // captions were simply not in this function, so copying a text quietly
      // copied whatever clip happened to be selected underneath — or nothing.
      const caps = s.project.captions.filter((c) => s.selectedCaptionIds.includes(c.id))
      if (caps.length > 0) {
        lastCopy = 'captions'
        copiedCaptions = caps.map((c) => clone(c))
        return
      }
      // With the link on, a linked partner is copied with its clip (phase
      // Ç2b.1, decision 2); the paste links the copies to each other.
      const clips = withPartners(s.project, s.selectedClipIds, s.linkAV).map((id) => s.project.clips[id])
      if (clips.length > 0) {
        lastCopy = 'clips'
        // The media they show go with them (P5: a paste into another project).
        const used = new Set<string>()
        const walk = (list: Clip[]): void => {
          for (const c of list) {
            used.add(c.assetId)
            if (c.cleaned) used.add(c.cleaned.from)
            if (c.nested) walk(c.nested.clips)
          }
        }
        walk(clips)
        set({ clipboard: clips.map((c) => clone(c)), clipboardAssets: s.project.assets.filter((a) => used.has(a.id)).map((a) => clone(a)) })
      }
    },

    pasteCaptionsAtPlayhead: () => {
      const s = get()
      const caps = copiedCaptions
      if (!caps || caps.length === 0) return
      const t0 = Math.min(...caps.map((c) => c.start))
      const at = s.currentTime
      const newIds: string[] = []
      mutate((p) => {
        for (const src of caps) {
          const start = at + (src.start - t0)
          const copy: Caption = {
            ...clone(src),
            id: uid(),
            start,
            end: start + (src.end - src.start)
          }
          // Word timings are absolute too, so they have to travel with it or
          // the karaoke highlight lights up somewhere else entirely.
          if (copy.words) copy.words = copy.words.map((w) => ({ ...w, start: w.start + (start - src.start), end: w.end + (start - src.start) }))
          p.captions.push(copy)
          newIds.push(copy.id)
        }
        p.captions.sort((a, b) => a.start - b.start)
      })
      set({ selectedCaptionIds: newIds, selectedClipIds: [] })
    },

    /**
     * Ctrl+V. Four things can be on a clipboard at once, so this is a list of
     * candidates in the order the last copy asked for — and each one is tried
     * only if it can actually do something. Ctrl+V doing NOTHING while a
     * clipboard is full is the failure mode worth engineering against: it
     * looks exactly like the feature being broken.
     */
    pasteClipboard: () => {
      const s = get()
      const attempt = {
        keyframe: (): boolean => copiedKeyframe !== null && s.pasteKeyframeAtPlayhead() > 0,
        animation: (): boolean => {
          if (!copiedAnimation || s.selectedClipIds.length === 0) return false
          s.pasteClipAnimation(s.selectedClipIds)
          return true
        },
        captions: (): boolean => {
          if (!copiedCaptions || copiedCaptions.length === 0) return false
          s.pasteCaptionsAtPlayhead()
          return true
        },
        clips: (): boolean => {
          if (!s.clipboard || s.clipboard.length === 0) return false
          s.pasteAtPlayhead()
          return true
        }
      }
      const filled: Record<keyof typeof attempt, boolean> = {
        keyframe: copiedKeyframe !== null,
        animation: copiedAnimation !== null,
        captions: (copiedCaptions?.length ?? 0) > 0,
        clips: (s.clipboard?.length ?? 0) > 0
      }
      // What was copied last is what Ctrl+V means, full stop — even when it
      // can't apply right now. Falling through in that case was a mistake:
      // copy a keyframe, park the playhead off the clip, press Ctrl+V, and the
      // "helpful" next candidate was Paste-all-keyframes, which REPLACES the
      // animation on every selected clip. A paste that quietly does something
      // destructive you didn't ask for is worse than a paste that does nothing.
      if (filled[lastCopy]) {
        attempt[lastCopy]()
        return
      }
      // Only when that clipboard is empty is another one what you must have
      // meant — otherwise Ctrl+V would do nothing at all while something sits
      // copied and ready.
      for (const kind of ['keyframe', 'animation', 'captions', 'clips'] as const) {
        if (filled[kind] && attempt[kind]()) return
      }
    },

    eyedropperClip: null,

    maskOverlay: 'auto',

    clipTabActive: false,

    loopRange: null,

    // -- work notes ---------------------------------------------------------
    noteSel: null,
    noteDraft: null,
    noteTool: null,
    noteColor: NOTE_COLORS[0],
    noteReview: null,

    maskDrawMode: false,

    selectedTrackerId: null,

    templateSel: null,

    dragPreview: null,

    snapGuide: null,
    rangePreview: null,

    // On unless the user turned it OFF. Snapping the playhead to cuts and
    // keyframes is what makes "put it exactly there" possible with a mouse, and
    // it was hidden behind a button nobody found.
    playheadSnap: localStorage.getItem('autocut-playhead-snap') !== 'off',
    // Linked picture and sound are one unit unless the user turned the link
    // OFF (phase Ç2b.1, decision 2; it was off unless turned on).
    linkAV: localStorage.getItem('autocut-link-av') !== 'off',
    showGuideOverlay: localStorage.getItem('autocut-guides') === 'on',
    uiLang: uiLangAtStart,

    activeShortSegmentId: null,

    copyShortSegment: (id) => {
      const seg = get().project.shortSegments?.find((s) => s.id === id)
      if (!seg) return
      copiedSegment = clone(seg)
    },

    /**
     * Drops the copied segment at the playhead, keeping its length, colour and
     * pan keyframes (retimed to the new start). Falls in the first free spot at
     * or after the playhead, so pasting repeatedly lays out a run of Shorts
     * without any of them landing on top of each other.
     */
    pasteShortSegment: () => {
      const src = copiedSegment
      if (!src) return null
      const id = uid()
      const { currentTime } = get()
      const dur = Math.max(0.5, src.end - src.start)
      mutate((p) => {
        p.shortSegments = p.shortSegments ?? []
        let start = Math.max(0, currentTime)
        // Slide past any segment already occupying the spot.
        const occupied = [...p.shortSegments].sort((a, b) => a.start - b.start)
        for (const other of occupied) {
          if (start < other.end && start + dur > other.start) start = other.end
        }
        p.shortSegments.push({
          ...clone(src),
          id,
          name: `${src.name} copy`,
          start,
          end: start + dur,
          // Keyframe times are absolute, so they move with the segment.
          keyframes: (src.keyframes ?? []).map((k) => ({
            ...k,
            id: uid(),
            time: k.time - src.start + start
          }))
        })
        p.shortSegments.sort((a, b) => a.start - b.start)
      })
      set({ activeShortSegmentId: id })
      return id
    },

    copyCaptionStyle: (id) => {
      const cap = get().project.captions.find((c) => c.id === id)
      if (!cap) return
      copiedCaptionStyle = clone(cap.style ?? get().project.captionStyle)
    },
    hasCopiedCaptionStyle: () => copiedCaptionStyle !== null,
    pasteCaptionStyle: (ids) => {
      if (!copiedCaptionStyle) return
      mutate((p) => {
        for (const id of ids) {
          const cap = p.captions.find((c) => c.id === id)
          if (!cap) continue
          // Position stays put — pasting a LOOK must not move the text. The
          // position kept is the one the text is actually drawn at, which for a
          // caption with no style of its own comes from the project's.
          const keepX = cap.style?.posX ?? p.captionStyle.posX ?? 0.5
          const keepY = cap.style?.posY ?? p.captionStyle.posY
          cap.style = { ...clone(copiedCaptionStyle!), posX: keepX, posY: keepY }
        }
      })
    },

    cutterMode: false,

    splitToolMode: false,

    slipToolMode: false,

    mapPick: null,

    scopeKind: null,

    exportQueue: [],
    cutMarks: [],
    cutTrackId: null,
    selectedCaptionIds: [],

    captionEditRequest: null,
    ...viewActions(set, get, mutate),
    ...versionActions(set, get, mutate),
    ...projectActions(set, get, mutate),
    ...placingActions(set, get, mutate),
    ...cuttingActions(set, get, mutate),
    ...keyframeActions(set, get, mutate),
    ...clipActions(set, get, mutate),
    ...effectActions(set, get, mutate),
    ...captionActions(set, get, mutate),
    ...noteActions(set, get, mutate),
    ...shortsActions(set, get, mutate)
  }
})

/**
 * Playhead time for DISPLAY. While playing, `currentTime` is written on every
 * animation frame, so any component subscribing to it re-renders 60×/second —
 * that was making the whole inspector rebuild during playback and showed up as
 * preview stutter. This quantises the value while playing (paused stays exact),
 * so panels update a few times a second instead of every frame.
 */
export function useDisplayTime(step = 0.25): number {
  return useStore((s) => (s.playing ? Math.round(s.currentTime / step) * step : s.currentTime))
}
