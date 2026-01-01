// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The undo history: how many steps, the snapshot of a project and its
// restore, and what undo / redo / open reset in the editor's own state.
// Moved out of state/store.ts in SnippStudio phase 2B (no change).
//
// Phase Ç2a.1 (report D1, measured in FAZC2A-PLAN.md step 5): a snapshot is
// the project ITSELF, by reference. The store's projects never change once
// made (copy-on-write, state/cow.ts; frozen in development and test builds),
// so keeping the reference is keeping the state. It replaced a JSON string of
// the whole project per step: on a 2-hour, 500-clip, word-timed project that
// was 1.15 M characters and 10.6 ms per edit, and holding Ctrl+Z then Ctrl+Y
// through 60 steps left 266 MB more on the heap (every undo parsed a whole new
// project that shared nothing).
import type { Asset, Project, WorkNote } from '../types'
import type { EditorState } from './editor-state'

export const MAX_UNDO = 60

/** One step of the undo history: the project as it was. */
export type HistoryEntry = Project

/**
 * Asset fields that are DERIVED from the media file: the poster thumbnail, the
 * filmstrip (one wide JPEG as a data URL — a hundred kilobytes or more per
 * video), and the waveform peaks. They are made after the project is (a
 * thumbnail lands seconds after a file opens, without an edit of its own), so
 * a step kept from before has none, or older ones.
 *
 * The newest of each is kept here by asset id and put back when a step is
 * restored — including for an asset that was deleted and undone back into
 * existence, which is why this map is never pruned.
 */
export const RUNTIME_ASSET_KEYS = ['thumbnail', 'filmstrip', 'filmstripCols', 'waveform'] as const
export const runtimeExtras = new Map<string, Partial<Asset>>()
/** A work note's frame picture (a JPEG as a data URL, set once when the note
 *  is saved), kept by note id the same way. */
export const NOTE_IMAGE_KEY = 'regionImage'
export const noteImages = new Map<string, string>()

/** The step to keep for `p` (the project itself; its derived extras are
 *  remembered on the side). */
export function historySnapshot(p: Project): HistoryEntry {
  for (const a of p.assets) {
    let extras: Partial<Asset> | undefined = runtimeExtras.get(a.id)
    for (const k of RUNTIME_ASSET_KEYS) {
      if (a[k] !== undefined && extras?.[k] !== a[k]) {
        extras = { ...extras }
        ;(extras as Record<string, unknown>)[k] = a[k]
      }
    }
    if (extras) runtimeExtras.set(a.id, extras)
  }
  for (const n of p.notes ?? []) if (n.regionImage) noteImages.set(n.id, n.regionImage)
  return p
}

/** The project of a kept step, with the newest derived extras and note
 *  pictures put back (a new object only when one differs). */
export function restoreSnapshot(p: HistoryEntry): Project {
  let assets: Asset[] | null = null
  p.assets.forEach((a, i) => {
    const extras = runtimeExtras.get(a.id)
    if (!extras || !(Object.keys(extras) as (keyof Asset)[]).some((k) => a[k] !== extras[k])) return
    assets = assets ?? [...p.assets]
    assets[i] = { ...a, ...extras }
  })
  let notes: WorkNote[] | null = null
  ;(p.notes ?? []).forEach((n, i) => {
    const image = noteImages.get(n.id)
    if (!image || !n.shapes?.length || n.regionImage === image) return
    notes = notes ?? [...(p.notes ?? [])]
    notes[i] = { ...n, regionImage: image }
  })
  if (!assets && !notes) return p
  return { ...p, ...(assets ? { assets } : {}), ...(notes ? { notes } : {}) }
}

/**
 * The fields of the VIEW are not in the history (phase Ç2a.1, decision 4): a
 * row's height and the snapping are kept as they are now when a step is
 * undone or redone. Returns `restored` itself when nothing differs.
 */
export function carryView(now: Project, restored: Project): Project {
  const heights = new Map(now.tracks.map((t) => [t.id, t.height]))
  let tracks: Project['tracks'] | null = null
  restored.tracks.forEach((t, i) => {
    if (!heights.has(t.id) || heights.get(t.id) === t.height) return
    tracks = tracks ?? [...restored.tracks]
    const h = heights.get(t.id)
    const { height: _, ...rest } = t
    tracks[i] = h === undefined ? rest : { ...rest, height: h }
  })
  const snap = JSON.stringify(now.snap) === JSON.stringify(restored.snap) ? null : now.snap
  if (!tracks && !snap) return restored
  return { ...restored, ...(tracks ? { tracks } : {}), ...(snap ? { snap } : {}) }
}

/**
 * Where a media file lives and what was read from it (phase Ç2a.2, decision
 * 1; report P4): its URL, path (and the path beside the project file), the
 * missing flag, the file's fingerprint and the probed duration, size and
 * sound. They stay in the project (the engine, the scan, the export and the
 * timeline read them there) but are not the edit's: a relink, a re-probe, a
 * code film's own numbers are no undo step, so a jump must not move them.
 */
export const MEDIA_KEYS = ['url', 'path', 'relPath', 'missing', 'size', 'mtime', 'duration', 'width', 'height', 'hasAudio'] as const

/** `restored` with every asset that is in `now` too given `now`'s media
 *  fields (and a code film's fps). An asset `now` lacks (deleted, undone back)
 *  keeps the step's. Returns `restored` itself when nothing differs. */
export function carryMedia(now: Project, restored: Project): Project {
  const current = new Map(now.assets.map((a) => [a.id, a]))
  let assets: Asset[] | null = null
  restored.assets.forEach((a, i) => {
    const c = current.get(a.id)
    if (!c || c === a) return
    const differs = MEDIA_KEYS.some((k) => a[k] !== c[k]) || (a.code && c.code && a.code.fps !== c.code.fps)
    if (!differs) return
    const next: Asset = { ...a }
    for (const k of MEDIA_KEYS) {
      if (c[k] === undefined) delete next[k]
      else (next as unknown as Record<string, unknown>)[k] = c[k]
    }
    if (a.code && c.code && a.code.fps !== c.code.fps) next.code = { ...a.code, fps: c.code.fps }
    assets = assets ?? [...restored.assets]
    assets[i] = next
  })
  return assets ? { ...restored, assets } : restored
}

/**
 * References that a time-travelled project may no longer contain. Undo/redo
 * swap the whole project, so an id captured before the jump can point at a
 * segment or clip that isn't there any more.
 */
export function reconcileAfterTimeTravel(
  p: Project,
  s: {
    /** The project before the jump. */
    project: Project
    selectedClipIds: readonly string[]
    selectedCaptionIds: readonly string[]
    activeShortSegmentId: string | null
    selectedTrackerId: string | null
    templateSel: string | null
    noteSel: string | null
    noteReview: EditorState['noteReview']
  }
): {
  noteSel: string | null
  noteReview: EditorState['noteReview']
  selectedClipIds: string[]
  selectedCaptionIds: string[]
  activeShortSegmentId: string | null
  selectedTrackerId: string | null
  templateSel: string | null
  silencePreview: null
  dragPreview: null
  snapGuide: null
  rangePreview: null
} {
  const keepShort = (p.shortSegments ?? []).some((x) => x.id === s.activeShortSegmentId)
  const keepTracker = (p.trackers ?? []).some((x) => x.id === s.selectedTrackerId)
  const noteIds = new Set((p.notes ?? []).map((n) => n.id))
  const reviewIds = s.noteReview?.ids.filter((id) => noteIds.has(id)) ?? []
  return {
    // A note that the jump took away is no longer picked or under review.
    noteSel: s.noteSel && noteIds.has(s.noteSel) ? s.noteSel : null,
    noteReview: s.noteReview && reviewIds.length > 0 ? { ids: reviewIds, index: Math.min(s.noteReview.index, reviewIds.length - 1) } : null,
    // The selection is kept as far as the restored project allows (DENEME-3,
    // V item 1): selectionAfterTimeTravel below.
    ...selectionAfterTimeTravel(s.project, p, s.selectedClipIds, s.selectedCaptionIds),
    activeShortSegmentId: keepShort ? s.activeShortSegmentId : null,
    selectedTrackerId: keepTracker ? s.selectedTrackerId : null,
    templateSel: (p.templates ?? []).some((x) => x.id === s.templateSel) ? s.templateSel : null,
    // A pending silence preview describes clips that may have just changed.
    silencePreview: null,
    dragPreview: null,
    snapGuide: null,
    // Points at words that may not exist after a time jump.
    rangePreview: null
  }
}

/** Rule 3's ceiling (below): this many changed clips for each thing that was picked. */
const CHANGED_PER_PICK = 2

/**
 * The selection after an undo or a redo (DENEME-3, V item 1). The selection
 * is not in the history (selecting is no undo step: nothing of it is in
 * `past`), so a jump keeps it as far as the restored project allows:
 *  1. the selected clips and subtitles that are still there stay selected
 *     (a scale or a move taken back: the clip stays picked);
 *  2. none of them is left: what the jump brought back is picked (a delete
 *     taken back: the clips, else the subtitles, that came back);
 *  3. nothing came back either, but something was selected: the clips the
 *     jump changed (a split taken back while its right half was picked:
 *     the left half, which got its length back), when they are no more
 *     than two for each clip or line that was selected (a clip and its
 *     linked partner). More than that is not "what I had picked, back": a
 *     ripple taken back changes every clip after it, and with one stale
 *     pick the whole timeline came out selected (22 Nov, K10) — then
 *     nothing is;
 *  4. otherwise nothing.
 * Clips win over subtitles, as a click does (one kind is picked at a time).
 * Before this, every jump let go of the whole selection.
 */
export function selectionAfterTimeTravel(
  before: Project,
  after: Project,
  clipIds: readonly string[],
  captionIds: readonly string[]
): { selectedClipIds: string[]; selectedCaptionIds: string[] } {
  const keptClips = clipIds.filter((id) => !!after.clips[id])
  const afterCaptions = new Set(after.captions.map((c) => c.id))
  const keptCaptions = captionIds.filter((id) => afterCaptions.has(id))
  if (keptClips.length > 0) return { selectedClipIds: keptClips, selectedCaptionIds: [] }
  if (keptCaptions.length > 0) return { selectedClipIds: [], selectedCaptionIds: keptCaptions }
  const back = Object.keys(after.clips).filter((id) => !before.clips[id])
  if (back.length > 0) return { selectedClipIds: back, selectedCaptionIds: [] }
  const hadCaptions = new Set(before.captions.map((c) => c.id))
  const backCaptions = after.captions.filter((c) => !hadCaptions.has(c.id)).map((c) => c.id)
  if (backCaptions.length > 0) return { selectedClipIds: [], selectedCaptionIds: backCaptions }
  if (clipIds.length === 0 && captionIds.length === 0) return { selectedClipIds: [], selectedCaptionIds: [] }
  const changed = Object.keys(after.clips).filter((id) => before.clips[id] && before.clips[id] !== after.clips[id])
  if (changed.length > CHANGED_PER_PICK * (clipIds.length + captionIds.length)) return { selectedClipIds: [], selectedCaptionIds: [] }
  return { selectedClipIds: changed, selectedCaptionIds: [] }
}
