// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The editor store's shape: every field and action of useStore (state/store.ts),
// a note being written, an automation's result. Moved out of state/store.ts in
// SnippStudio phase 2B (no change).
import { type DuckingOptions } from '../audio/ducking'
import type { Lang } from '../ui/strings'
import type { TrimBase } from '../commands/clips'
import type { CodeEdit } from '../../../shared/codeval/types'
import type { SilenceRegion } from '../audio/silence'
import { type GentlePanDirection } from '../effects/cinematic'
import type { SubtitleImageMissingSlot, SubtitleImagePlacement } from '../subtitles/automation'
import { type TimelinePlacement } from '../timeline/placement'
import type { DragSnapTarget } from '../timeline/snapping'
import type { KeyDrag, KeyRef } from '../timeline/key-drag'
import type { Backdrop, Asset, AspectId, BlendMode, Caption, CaptionMotion, CaptionShape, CaptionStyle, Clip, ClipAnim, ClipLabel, ClipMask, ClipTone, ClipTransform, FxKey, KfChannel, KfEasing, MaskGeom, MotionFx, NoteKind, NoteShape, Project, ProjectLut, ProjectSettings, ShapeKind, ShortSegment, SnapSettings, StillImageFxStyle, AmbientFxStyle, Track } from '../types'
import { type CommandCall } from '../commands'
import { VersionLog } from '../history/versions'
import { type AutomationFinish } from '../commands/automation'

export interface AutomationPlacementResult {
  trackId: string
  trackName: string
  clipIds: string[]
}

/** A work note while it is being written (the Notes tab's composer, the N
 *  lane's dashed block, the drawing on the preview). */
export interface NoteDraft {
  start: number
  end: number
  kind: NoteKind
  text: string
  /** The frame the drawing is on (set by the first stroke). */
  at?: number
  shapes: NoteShape[]
}

/** What a whole-timeline cut leaves alone (commands/timeline.ts KeepParams). */
export type CutScope = { keepTracks?: string[]; endBeds?: boolean }

export interface EditorState {
  project: Project
  /**
   * The film's version: +1 on every edit of it (and on undo, redo, opening a
   * project). Session only, never saved, never goes back. A note's text or
   * status, the selection, the playhead and the view do not change it.
   */
  projectVersion: number
  /** Old times (of `fromVersion`) to today's, when only whole-timeline cuts
   *  happened since; else null and why (history/versions.ts). */
  shiftTable: (fromVersion: number, epoch?: string) => ReturnType<VersionLog['shiftTable']>
  /** What changed since `fromVersion`, by id (and the cuts, when only cuts). */
  changesSince: (fromVersion: number, epoch?: string) => ReturnType<VersionLog['changesSince']>
  /** Keep that version's project for a later changesSince (a reader holds it). */
  pinVersion: (version: number) => void
  /** This session's version log: a number from another epoch (the page
   *  reloaded) means nothing here. */
  versionEpoch: string
  /**
   * Writes a project computed from the live one (a candidate: applyBatch on
   * the version `baseVersion`) as ONE undo step, without running its calls
   * again (same ids, same template seeds, what was previewed). Refused when
   * the live project changed since, or the epoch is another session's.
   * Returns the new version.
   */
  adoptCandidate: (project: Project, from: { baseVersion: number; epoch?: string; cuts?: [number, number][][] }) => number
  currentTime: number
  playing: boolean
  selectedClipIds: string[]
  pxPerSec: number
  /** Timeline magnet: clips snap to each other while dragging when on. */
  timelineMagnet: boolean
  /** Preview render scale (1 = full). Never affects export. */
  previewQuality: number
  /** Let the preview drop its own resolution when a frame costs too much.
   *  OFF by default: a machine that can keep up shouldn't be handed a softer
   *  picture, and a picture that changes sharpness while you scrub is worse
   *  than one that is simply a little slower. */
  adaptiveQuality: boolean
  setAdaptiveQuality: (on: boolean) => void
  setPreviewQuality: (q: number) => void
  /** Frame-mode preview zoom/pan (1 = fit). */
  previewView: { zoom: number; x: number; y: number }
  setPreviewView: (v: Partial<{ zoom: number; x: number; y: number }>) => void
  setTrackFlags: (
    trackId: string,
    patch: Partial<Pick<Track, 'locked' | 'hidden' | 'muted' | 'autoPack' | 'solo'>>
  ) => void
  setTrackHeight: (trackId: string, height: number | undefined) => void
  transcribeStatus: string | null
  /** Live transcription progress for the progress bar + ETA. */
  transcribeProgress: { phase: 'download' | 'transcribe' | 'prep'; fraction: number; etaSec: number | null; label: string } | null
  /**
   * The current (or just-finished) export. It stays set after the render ends
   * so the panel can say what was written, how big it is and where it went —
   * an export that vanishes into a toast leaves you hunting through Explorer
   * for a file whose name and folder you half-remember.
   */
  exportStatus: {
    progress: number
    label: string
    /** performance.now() when the job started — drives elapsed + ETA. */
    startedAt?: number
    /** "1920 × 1080 · 60 fps · MP4 (H.264) · High" */
    detail?: string
    /** File name, or "N files → folder" for a batch. */
    target?: string
    /** Set when the job is over; the panel then shows the result actions. */
    done?: boolean
    /** Full path of the written file (single-file exports). */
    path?: string
    /** Folder a batch went into. */
    folder?: string
    bytes?: number
    error?: string
    /** What is being exported: the progress window's title follows it. */
    kind?: 'video' | 'sound' | 'shorts' | 'frame' | 'srt' | 'voiceset'
    /** Stopped with Cancel (done, but neither a failure nor a file). */
    cancelled?: boolean
    /** performance.now() when it ended (the window's "took …"). */
    endedAt?: number
  } | null
  /** Detected-but-not-yet-applied silence cuts, highlighted red on the timeline. */
  silencePreview: SilenceRegion[] | null
  setSilencePreview: (regions: SilenceRegion[] | null) => void
  /** Seconds the preview audio is running away from the playhead (0 = in sync).
   *  Reported so an out-of-sync preview is visible instead of being something
   *  you only half-notice while listening. */
  audioDrift: number
  setAudioDrift: (seconds: number) => void
  /** Ripple-removes only each region's named clip; later clips on its track
   *  move left by the time removed from that track. */
  applySilenceCuts: (
    regions: SilenceRegion[],
    /** `picked`: every clip analysed (one with no region is loud all through).
     *  `keepTracks`: tracks left as they are (the music bed); `endBeds`: their
     *  clips end with the rest of the film (commands/timeline.ts KeepParams). */
    opts?: { crossfade?: boolean; picked?: string[] } & CutScope
  ) => void
  /** Markers left at the given times, as one undo step (the silence
   *  window's "only mark", the transcript's "marker here"). */
  markTimes: (marks: readonly { time: number; label?: string; note?: string }[]) => void
  /** Asks the inspector to open the Clip tab and scroll to a section (e.g.
   *  'motion'), so timeline shortcuts can jump straight to the right controls.
   *  Bumped with a nonce so requesting the same section twice still fires. */
  inspectorFocus: { section: string; nonce: number } | null
  focusInspector: (section: string) => void
  /** The undo history: the projects as they were (state/history.ts). */
  past: Project[]
  future: Project[]

  // -- work notes (notes/model.ts; SnippStudio phase 1) --------------------
  /** The note picked on the N lane or in the Notes tab. */
  noteSel: string | null
  selectNote: (id: string | null) => void
  /** The note being written: not in the project until it is saved. */
  noteDraft: NoteDraft | null
  /** Starts a note at the playhead, or over `range`. With one already being
   *  written, only its range changes. */
  startNoteDraft: (range?: { start: number; end: number }) => void
  patchNoteDraft: (patch: Partial<NoteDraft>) => void
  cancelNoteDraft: () => void
  /** The draft becomes a note (one undo step). Returns its id; null when the
   *  draft says nothing (no text and no drawing). */
  saveNoteDraft: () => string | null
  /** The shape the pointer draws on the preview (null: not drawing). */
  noteTool: NoteShape['type'] | null
  setNoteTool: (tool: NoteShape['type'] | null) => void
  noteColor: string
  setNoteColor: (color: string) => void
  /** An edit of the notes. `commit` false: no undo step (a status, an
   *  agent's answer). */
  editNotes: (fn: (p: Project) => void, commit?: boolean, mergeKey?: string) => void
  /** A saved note's frame picture, once it is drawn (never an undo step). */
  setNoteImage: (id: string, image: string) => void
  /** Going through what the agent changed: the notes in order, and which
   *  one is being looked at. */
  noteReview: { ids: string[]; index: number } | null
  setNoteReview: (review: { ids: string[]; index: number } | null) => void

  // -- history ----------------------------------------------------------
  undo: () => void
  redo: () => void
  /** Pushes an undo snapshot; call once at the start of a drag gesture. */
  beginGesture: () => void
  /** True when the project has changes not yet written to disk. */
  dirty: boolean
  /** The project as the file has it (the last save, or the open): an undo or
   *  redo back to it is not unsaved (phase Ç2a.1, P13). Null: no such project
   *  (a recovered or repaired one, a copy). */
  savedProject: Project | null
  setDirty: (dirty: boolean) => void
  /**
   * Counts the edits: one more every time `dirty` becomes (or stays) true,
   * and on every open / new project. A save takes it before it writes and
   * clears `dirty` afterwards only if it is unchanged — an edit made while the
   * file was being written is not marked as saved. (Project identity can't be
   * the test: a thumbnail arriving changes the project without an edit.)
   */
  editSeq: number

  // -- project ----------------------------------------------------------
  newProject: (aspect?: AspectId) => void
  loadProject: (p: Project) => void
  setSettings: (patch: Partial<ProjectSettings>) => void
  setMode: (mode: Project['mode']) => void
  setProjectName: (name: string) => void
  /** A code film page's parameter values (phase 5f; null: the page's own). */
  setCodeParams: (assetId: string, values: Record<string, string | number | null>) => void
  /** Cila K: hand-made changes of the constants found in a code clip's page
   *  (`put`: set or replace; `drop`: remove, by editId). Typing in one field
   *  is one undo step (`run` names the field). */
  setCodeEdits: (assetId: string, put: CodeEdit[], drop?: string[], run?: string) => void
  /** The project look (phase 5f): accent colour and font ('' or null: unset). */
  setProjectLook: (look: { accent?: string | null; font?: string | null }) => void

  // -- assets / clips ---------------------------------------------------
  /** Adds assets, skipping files already in the project. Returns the ones that
   *  were actually added, so the caller doesn't do follow-up work on a skipped
   *  duplicate (or claim it imported something it didn't). */
  addAssets: (assets: Asset[]) => Asset[]
  /** Swaps an image clip's source while preserving every clip/timeline setting. */
  replaceImageClip: (clipId: string, replacement: Asset) => boolean
  updateAsset: (id: string, patch: Partial<Asset>) => void
  /** Writes data the app DERIVED from the media itself — poster thumbnail,
   *  filmstrip, peaks. Never an edit: it takes no undo step and, unlike every
   *  other write, does not mark the project unsaved. */
  setAssetDerived: (id: string, patch: Partial<Asset>) => void
  /** Removes an asset from the bin AND every clip that uses it. False (and
   *  nothing removed) when a clip inside a compound uses it (phase Ç2a.1, P16). */
  deleteAsset: (id: string, outside?: boolean) => boolean
  addToTimeline: (assetId: string, trackId?: string) => void
  /** Appends every (non-missing) asset in the bin to the timeline in order. */
  addAllToTimeline: () => void
  addVideoTrack: () => void
  addAudioTrack: () => void
  moveClip: (clipId: string, newStart: number, commit?: boolean) => void
  /** Commits the exact positions shown by the timeline drag preview. */
  applyTimelinePlacement: (plan: TimelinePlacement) => void
  /** Moves the selected clips by `delta` seconds as a drag would (the same
   *  plan: groups, the A/V link, neighbours), as one undo step. */
  nudgeSelection: (delta: number) => void
  /** Moves a clip to another track of the same kind. */
  moveClipToTrack: (clipId: string, trackId: string) => void
  /** Drops an asset onto a specific track/time (bin → timeline drag). */
  addClipAt: (assetId: string, trackId: string | null, start: number, commit?: boolean) => void
  /** Drops several assets back-to-back starting at `start`, as one undo step
   *  (`planMediaDrop` says where they land). `opts.assets`: files the drop
   *  brought in, added in the same step (one the project has is reused);
   *  `opts.newTrack`: the drop was on that kind's "+" strip. */
  addClipsAt: (
    assetIds: string[],
    trackId: string | null,
    start: number,
    opts?: { assets?: Asset[]; newTrack?: 'video' | 'audio' | null }
  ) => { added: Asset[]; clipIds: string[] }
  /** Places a library SFX at chosen times on separate audio layers, never
   * shifting existing narration or picture. One batch = one undo step. */
  placeSoundEffect: (assetId: string, times: readonly number[], lead: number, volume: number) => number
  /** Places still images at subtitle-derived times as one undoable edit. A new
   *  AUTO track is created when requested; an existing target must be an
   *  unlocked video track. */
  placeAutomationImages: (
    placements: readonly SubtitleImagePlacement[],
    target: string | 'new',
    opts?: {
      replaceOverlaps?: boolean
      captionTextEdits?: Readonly<Record<string, string>>
      missingSlots?: readonly SubtitleImageMissingSlot[]
      /** The finishing touches (motion, transitions, glow, sound, kept
       *  template suggestions), in the same undo step. */
      finish?: AutomationFinish
    }
  ) => AutomationPlacementResult | null
  /** Fills a numbered automation placeholder without changing its timing. */
  fillAutomationMissingImage: (clipId: string, image: Asset) => boolean
  /** Reveals earlier media: inPoint moves back, right edge extends right. */
  revealEarlier: (clipId: string, seconds: number) => void
  /** Arms an undo snapshot spent by this gesture's first project change (used
   *  by sliders, whose store actions deliberately don't snapshot). */
  armGesture: () => void
  /** Ends the armed window — every mutation until then is one undo step. */
  endGesture: () => void
  /**
   * Runs a ONE-SHOT edit built from non-snapshotting actions as a single undo
   * step — and as no step at all if nothing actually changed.
   *
   * Actions that a slider drives don't snapshot per call (a range input fires
   * on every pixel), and the slider arms the undo step around the drag. But the
   * same actions are also reached from buttons, checkboxes, selects and
   * double-clicks — removing a fade, picking a transition, toggling auto-pack,
   * the eyedropper — and nothing was arming those, so they were silently
   * un-undoable. Wrap those call sites in this.
   */
  undoable: (fn: () => void) => void
  /**
   * Commands by name (commands/index.ts) as ONE undo step: every call is
   * checked first, then all run on one draft; if any fails nothing is
   * applied (a CommandError says why). Inside another undoable it joins that
   * step; during a UI drag it gets a step of its own. `seed` makes random
   * choices repeatable. Returns each command's result, in order.
   */
  runBatch: (calls: readonly CommandCall[], opts?: { seed?: number }) => unknown[]
  /** Groups the current multi-selection: members select/move as one block. */
  groupSelection: () => void
  ungroupSelection: () => void
  /** Head trim by absolute edge position; `base` is the clip at drag start. */
  /**
   * Slip: slides the MEDIA inside a clip while the clip itself stays exactly
   * where it is — same position on the timeline, same length, different frames.
   * Once the cuts are timed to the speech or the music, it is the only way to
   * fix "right length, wrong moment" without pushing everything after it.
   * Driven from a baseline in-point so a blocked slip can't creep.
   */
  slipClip: (clipId: string, deltaSec: number, baseInPoint: number) => void
  setClipHead: (
    clipId: string,
    edgeSec: number,
    /** The clip when the drag began; `automation` (timeline/slice.ts
     *  automationOf) is its keyframes then, so every frame of the drag cuts
     *  them from the original and dragging back restores them. */
    base: TrimBase,
    /** Alt held: this clip alone, not its linked partner (phase Ç2b.1). */
    alone?: boolean
  ) => void
  trimClipEnd: (clipId: string, deltaSec: number, alone?: boolean) => void
  /** Picture and sound no longer linked: each is edited on its own (phase
   *  Ç2b.1, decision 2: the explicit way out of the link). */
  unlinkClips: (clipIds: string[]) => void
  /** A track's name (phase Ç2b.1, report L10). */
  renameTrack: (trackId: string, name: string) => void
  deleteClip: (clipId: string, ripple: boolean) => void
  /** `onlyItsTrack` (Alt): a ripple closes the gap on each clip's own track only. */
  deleteClips: (clipIds: string[], ripple: boolean, onlyItsTrack?: boolean) => void
  splitAtPlayhead: () => void
  /** Splits one clip at an absolute timeline time (the split tool). */
  splitClipAt: (clipId: string, time: number) => void
  /** From `time` on, the clip plays `seconds` further into its media (a
   *  skip): split there, the right part starting later in the media. */
  skipAhead: (clipId: string, time: number, seconds: number) => void
  /** Ctrl+B: splits the target clip (selected-under-playhead, else topmost
   *  under playhead) at the playhead. */
  splitTargetAtPlayhead: () => void
  /** Q / W: ripple-deletes the target clip's part left/right of the playhead
   *  (the selected clip under it, else the topmost one), closing the gap on
   *  its track and its linked partner's track only; `everyTrack` (Alt): the
   *  time goes out of every unlocked track. */
  rippleTrimToPlayhead: (side: 'left' | 'right', everyTrack?: boolean) => void
  /** Ripple-close the gap under the playhead (shifts later clips left). */
  closeGapAtPlayhead: (onlyItsTrack?: boolean) => void
  setClipTransform: (clipId: string, patch: Partial<ClipTransform>, commit?: boolean) => void
  /** Adds a keyframe on EVERY property channel at the playhead (bulk). */
  addClipKeyframe: (clipId: string) => void
  /** "◆ Keyframe" over a selection (phase Ç2c.2, report K19): every clip the
   *  playhead is on, not on a locked track, gets a key (volume on an audio
   *  track, "Keyframe all" else), in one undo step. How many took one. */
  keyframeClips: (clipIds: string[]) => number
  /** A key at the playhead on the selected clips and titles, or off them
   *  when one is on that frame (phase Ç2c.2, decision 5). One undo step;
   *  how many were keyed (negative: how many lost their key). */
  toggleKeyframeAtPlayhead: () => number
  /** Adds a keyframe on ONE property channel at the playhead. */
  addPropKeyframe: (clipId: string, ch: KfChannel) => void
  /** Sets a property value: upserts a keyframe if that channel is keyed,
   *  otherwise edits the static base. Used by sliders + preview drags. */
  setPropValue: (clipId: string, ch: KfChannel, value: number, commit?: boolean) => void
  /** Several channels as ONE change, each the way setPropValue writes it
   *  (cila A: a preview move is x and y, a corner pull x, y and scale).
   *  `mergeKey`: repeats within a moment are one undo step (an arrow nudge). */
  setPropValues: (clipId: string, patch: Partial<Record<KfChannel, number>>, commit?: boolean, mergeKey?: string) => void
  /** Upserts keyframes at the playhead for each property in the patch. */
  dragClipKeyframe: (clipId: string, patch: Partial<ClipTransform> & { opacity?: number }) => void
  deleteClipKeyframe: (clipId: string, ch: KfChannel, keyframeId: string) => void
  /** Retimes a keyframe (dragging its diamond on the clip block). */
  moveClipKeyframe: (clipId: string, ch: KfChannel, keyframeId: string, time: number) => void
  /** Retimes EVERY channel keyframe sitting at `fromTime` (a "Keyframe all"
   *  group) in one go — dragging one diamond must not leave the rest behind.
   *  By id (phase Ç2c.2, decision 2): a key of its channel at `toTime` gives
   *  way to it. */
  moveKeyframeGroup: (clipId: string, fromTime: number, toTime: number) => void
  /** One step of a diamond drag (phase Ç2c.2, decision 2; report K3): the
   *  keys the press took, by id, to clip-local `toTime`, worked out from the
   *  keys as the drag began (timeline/key-drag.ts). Joins the open gesture. */
  dragKeyframes: (clipId: string, drag: KeyDrag, toTime: number) => void
  /** Deletes these keys (a diamond's, by id). */
  deleteKeyframes: (clipId: string, keys: KeyRef[]) => void
  /** Deletes every channel keyframe at `time` (the whole group). */
  deleteKeyframeGroup: (clipId: string, time: number) => void
  /** Reads the value of every channel keyframed at `time` (Alt+drag snapshot). */
  readKeyframeGroup: (clipId: string, time: number) => Partial<Record<KfChannel, number>>
  /** Writes a keyframe per entry at `time` — used to leave a copy behind after
   *  an Alt+drag, which is the only way to duplicate a group: keyframes are
   *  addressed by time, so two groups sharing one instant are indistinguishable
   *  and would move together. */
  insertKeyframeGroup: (clipId: string, time: number, values: Partial<Record<KfChannel, number>>) => void
  /** Ctrl+drag: shifts the group at `fromTime` AND everything after it by
   *  `delta`, so the animation's later rhythm is preserved. */
  rippleKeyframes: (clipId: string, fromTime: number, delta: number) => void
  /** Copy/paste a whole clip's animation (channels + motion) onto another. */
  copyClipAnimation: (clipId: string) => void
  /** `scaled`: the key times stretched to each clip's length (phase Ç2c.2,
   *  report K20). A clip on a locked track is left as it is. */
  pasteClipAnimation: (clipIds: string[], opts?: { scaled?: boolean }) => void
  hasCopiedAnimation: () => boolean
  /** Copies ONE keyframe group — the pose at that instant on that clip. */
  copyKeyframeStamp: (clipId: string, localTime: number) => boolean
  hasCopiedKeyframe: () => boolean
  /** Stamps the copied pose onto clips at the PLAYHEAD, adding to whatever
   *  animation they already have. Returns how many clips took it. */
  pasteKeyframeAtPlayhead: (clipIds?: string[]) => number
  clearClipKeyframes: (clipId: string) => void
  /** Changes playback speed; timeline duration rescales to keep media range. */
  setClipSpeed: (clipId: string, speed: number) => void
  /** Whether a retimed clip's sound keeps its pitch (on, the default) or
   *  follows the speed (off). One undo step. */
  setClipKeepPitch: (clipId: string, keep: boolean) => void
  /** A speed that changes along the clip (points: `u` 0..1 along the clip as
   *  it plays, `v` the speed), or one speed again (null). A run of it (a
   *  drag) is one undo step (core polish C). */
  setClipSpeedCurve: (clipId: string, curve: { points: { u: number; v: number }[]; linear?: boolean } | null) => void
  setClipGrade: (clipId: string, patch: Partial<NonNullable<Clip['grade']>> | null) => void
  /** Preview uses low-res proxies where generated (export = originals). */
  proxiesEnabled: boolean
  setProxiesEnabled: (on: boolean) => void
  // -- clipboard / QoL ---------------------------------------------------
  /** Copied clips (Ctrl+C); pasted at the playhead (Ctrl+V). */
  clipboard: Clip[] | null
  /** The media the copied clips show (phase Ç2a.1, P5): a paste into another
   *  project brings them along. */
  clipboardAssets: Asset[]
  copySelection: () => void
  pasteAtPlayhead: () => void
  /** Pastes copied captions (text/shapes) starting at the playhead. */
  pasteCaptionsAtPlayhead: () => void
  /** Ctrl+V. Pastes whatever was copied LAST: clips at the playhead, or — if
   *  the last copy was a clip's keyframes — that animation onto the selection. */
  pasteClipboard: () => void
  duplicateSelection: () => void
  /** Clones clips at the SAME position/track (for Alt+drag). Returns new ids
   *  in the same order as the input. */
  duplicateClipsInPlace: (ids: string[]) => string[]
  /** Applies the copied clip's LOOK to the selection: grade, effects, mask,
   *  crop, flips, chroma key, LUT, blend and transition. Not speed — that
   *  would change how long the clip is, which is not a look. */
  pasteAttributes: () => void
  /** Inserts a freeze-frame hold at the playhead inside the selected clip. */
  insertFreezeFrame: (holdSec?: number) => void
  toggleReverse: (clipId: string) => void
  setClipFlip: (clipId: string, patch: { h?: boolean; v?: boolean }) => void
  rotate90: (clipId: string) => void
  setClipCrop: (clipId: string, patch: Partial<NonNullable<Clip['crop']>> | null) => void
  setClipChroma: (clipId: string, patch: Partial<NonNullable<Clip['chroma']>> | null) => void
  setClipAudioFx: (clipId: string, patch: Partial<NonNullable<Clip['audioFx']>> | null) => void
  setClipLut: (clipId: string, lut: string | null) => void
  /** How much of the clip's LUT is mixed in, 0..1 ("cila" part D). */
  setClipLutAmount: (clipId: string, amount: number) => void
  /** Exposure, tint, highlights, shadows (null: as the picture is). */
  setClipTone: (clipId: string, patch: Partial<ClipTone> | null) => void
  /** Glow, halation, mosaic, colour isolate (null: off). An amount that has
   *  keys is written onto its key at the playhead (a new one if none is there). */
  setClipFx: (
    clipId: string,
    patch: {
      bloom?: Partial<NonNullable<Clip['bloom']>> | null
      halation?: Partial<NonNullable<Clip['halation']>> | null
      mosaic?: number | null
      isolate?: Partial<NonNullable<Clip['isolate']>> | null
    }
  ) => void
  /** A key on an effect's amount at the playhead: written, or, when one is
   *  there, taken away (the last one leaves its value as the amount). */
  toggleFxKey: (clipId: string, key: FxKey) => void
  /** A .cube file becomes one of the project's LUTs and, with `clipId`, that
   *  clip's LUT: one undo step. */
  addProjectLut: (lut: ProjectLut, clipId?: string) => void
  /** Where a project LUT's file lives now (found beside a moved project): no
   *  edit, no undo step. */
  updateProjectLut: (name: string, patch: Partial<ProjectLut>) => void
  setClipBlur: (clipId: string, blur: number) => void
  setClipBlendMode: (clipId: string, mode: BlendMode) => void
  /** Scales + centres a clip so it fully covers the frame (crops the overflow). */
  fillFrame: (clipId: string) => void
  /** Scales + centres a clip so it fits entirely inside the frame. */
  fitFrame: (clipId: string) => void
  /** Moves a clip to the exact frame centre (keeps its scale). */
  centerClip: (clipId: string) => void
  /** Entrance / exit animation for a visual clip. */
  setClipAnim: (clipId: string, patch: Partial<NonNullable<Clip['anim']>>) => void
  /** Continuous idle motion (handheld drift etc.). */
  setClipIdle: (clipId: string, patch: Partial<NonNullable<Clip['idle']>>) => void
  /** Adds an adjustment layer at the playhead on the topmost video track. */
  addAdjustmentLayer: () => void
  /** Collapses the selected clips into one compound clip. */
  compoundSelection: () => void
  /** Expands a compound clip back into its individual clips. */
  uncompoundClip: (clipId: string) => void
  /** Patches the extra look effects (sharpen/vignette/grain/glow/…). */
  setClipEffect: (
    clipId: string,
    patch: Partial<Pick<Clip, 'sharpen' | 'vignette' | 'grain' | 'glow' | 'chromaAb' | 'duotone' | 'videoFx'>> & {
      stillImageFx?: Clip['stillImageFx'] | null
      ambientFx?: Clip['ambientFx'] | null
    }
  ) => void
  /** Removes a track and its clips (keeps ≥1 video + ≥1 audio). */
  deleteTrack: (trackId: string) => void
  /** Green-screen eyedropper: the clip awaiting a picked colour, or null. */
  eyedropperClip: string | null
  setEyedropper: (clipId: string | null) => void
  /** Mask outline overlay visibility: auto (only on Clip tab), on, or off. */
  maskOverlay: 'auto' | 'on' | 'off'
  setMaskOverlay: (v: 'auto' | 'on' | 'off') => void
  /** Whether the inspector Clip tab is currently open (for auto overlay). */
  clipTabActive: boolean
  setClipTabActive: (v: boolean) => void
  setKeyframeEasing: (clipId: string, ch: KfChannel, kfId: string, easing: KfEasing) => void
  setVolumeKeyframes: (clipId: string, kfs: { time: number; value: number }[]) => void
  /** Applies sidechain-style music ducking to one complete track in one undo step. */
  applyAutoDucking: (
    sourceTrackId: string,
    targetTrackId: string,
    activity: readonly boolean[],
    options: DuckingOptions
  ) => number
  /** Restores the volume envelopes captured before automatic ducking. */
  clearAutoDucking: (targetTrackId: string) => number
  // -- markers -----------------------------------------------------------
  addMarkerAtPlayhead: () => void
  /** Switches clips off without deleting them (A/B comparisons). */
  setClipsDisabled: (clipIds: string[], disabled: boolean) => void
  /** Locks clips against agents, or takes the lock off (one undo step;
   *  KAPSAM-AJAN-PLAN.md). */
  setClipsAgentLock: (clipIds: string[], locked: boolean) => void
  /** A coloured label on clips, or none (KOLAY-PLAN.md, item 3): one undo step. */
  setClipsLabel: (clipIds: string[], label: ClipLabel | null) => void
  /** Moves a track up/down the stacking order (layer order = render order). */
  moveTrack: (trackId: string, dir: -1 | 1) => void
  /** Loop region for playback: playback wraps back to `a` on reaching `b`. */
  loopRange: [number, number] | null
  setLoopRange: (range: [number, number] | null) => void
  updateMarker: (id: string, patch: { time?: number; color?: string; note?: string; label?: string }) => void
  deleteMarker: (id: string) => void
  /** Jumps back `steps` undo snapshots at once (history panel). */
  undoTo: (steps: number) => void
  /** Enables/edits the clip mask; null removes it. */
  setClipMask: (clipId: string, patch: Partial<ClipMask> | null) => void
  /** Mask geometry edit — routes into the keyframe at the playhead when
   *  mask keyframes exist. */
  editMaskGeom: (clipId: string, patch: Partial<MaskGeom>) => void
  addMaskKeyframe: (clipId: string) => void
  deleteMaskKeyframe: (clipId: string, kfId: string) => void
  /** True while the user is clicking points to draw a freehand mask. */
  maskDrawMode: boolean
  setMaskDrawMode: (on: boolean) => void
  /** Appends a point (asset-local coords) to the drawing mask. */
  addMaskPoint: (clipId: string, x: number, y: number) => void
  // -- motion trackers ---------------------------------------------------
  selectedTrackerId: string | null
  setSelectedTracker: (id: string | null) => void
  /** Selected template block on the G lane. */
  templateSel: string | null
  selectTemplate: (id: string | null) => void
  /** A template of `kind` at the playhead (a home screen over the nearest
   *  cut); returns its id. The Templates panel's Insert button. */
  insertTemplate: (kind: import('../types').TemplateKind) => string
  /** Template edits (plain functions in templates/model.ts) go through here. */
  editTemplates: (fn: (p: Project) => void, commit?: boolean, mergeKey?: string) => void
  addTracker: () => string
  renameTracker: (id: string, name: string) => void
  deleteTracker: (id: string) => void
  /** Upserts a position keyframe at `time` (dragging the crosshair). */
  dragTracker: (id: string, time: number, x: number, y: number) => void
  deleteTrackerKeyframe: (trackerId: string, kfId: string) => void
  setClipTracker: (clipId: string, trackerId: string | null) => void
  setClipVolume: (clipId: string, volume: number) => void
  /** Silences one clip, keeping its volume/fades/keyframes intact. */
  toggleClipMute: (clipId: string) => void
  setClipOpacity: (clipId: string, opacity: number) => void
  setClipFades: (clipId: string, patch: { fadeIn?: number; fadeOut?: number }) => void
  addVolumeKeyframe: (clipId: string) => void
  dragVolumeKeyframe: (clipId: string, value: number) => void
  deleteVolumeKeyframe: (clipId: string, keyframeId: string) => void
  clearVolumeKeyframes: (clipId: string) => void
  /** Pulls a video clip's audio out onto the audio track as its own clip. */
  extractAudio: (clipId: string) => void
  /** A clip's sound replaced by its cleaned copy (a new asset); the original
   *  is kept to go back to. */
  applyCleanedAudio: (clipId: string, file: { path: string; name: string; size: number; url: string }, settings: { noise: number; ess: number }) => void
  /** Back to the clip's sound as it was recorded. */
  restoreOriginalAudio: (clipId: string) => void
  /** Magnet ON: packs the main video track left with zero gaps. */
  packMainTrack: () => void
  /** Packs ONE track's clips back-to-back (keeps the first clip's position). */
  packTrack: (trackId: string) => void
  /** A track's magnet on or off (commands/tracks.ts track.setMagnet): on
   *  gathers its clips at 0 with no gaps and keeps them joined. One undo step. */
  setTrackMagnet: (trackId: string, on: boolean) => void
  /** Cascades clips right so nothing on a track ever overlaps. */
  resolveTrackOverlaps: (trackId?: string) => void
  /** Live drag ghost: previewed offset/track before a move is committed.
   *  `dropSec` is where the clip's left edge will actually land (insertion
   *  indicator); `dropTrackId` is the track it will land on. */
  dragPreview: {
    ids: string[]
    /** Clips that will follow because they are A/V-linked to a dragged one.
     *  They ride the same ghost so you can SEE where the pair is going —
     *  previously only the clip under the pointer moved and its partner caught
     *  up after the drop. Kept apart from `ids` because the commit path moves
     *  linked partners itself; these are for the preview only. */
    linked?: string[]
    /** Where the pointer has the dragged clips and their partners (start,
     *  s): what is drawn moving. `positions` is where everything lands
     *  (drawn as ghosts, components/timeline/drop-ghost.tsx; DENEME-3, V 4). */
    follow?: Record<string, number>
    targetTrackId: string | null
    dropSec: number
    dropTrackId: string | null
    /** Final clip positions, including neighbours displaced by an insertion. */
    positions: TimelinePlacement['positions']
    verticalOffsets: Record<string, number>
    placement: TimelinePlacement
    /** Dragging above/below all tracks → a new track will be created on drop. */
    newTrack?: 'video' | 'audio' | null
    /** Actual source of a live edge snap, if the planned landing still honours it. */
    snapTarget?: DragSnapTarget | null
    /** A collision or wrong layer prevents committing this preview. */
    invalidReason?: string | null
    /** Badge positions inside the vertically scrollable timeline content. */
    dropLabelTop?: number
    snapLabelTop?: number
  } | null
  setDragPreview: (p: EditorState['dragPreview']) => void
  /** Timeline time a drag/trim is currently snapped to (null = not snapped). */
  snapGuide: number | null
  setSnapGuide: (t: number | null) => void
  /** A time range some panel is about to act on, drawn on the timeline as a
   *  band. Right now the transcript selection, so deleting words shows WHERE
   *  the cut will land before you commit to it. */
  rangePreview: { start: number; end: number; label?: string } | null
  setRangePreview: (r: { start: number; end: number; label?: string } | null) => void
  /** Playhead snapping to clip/caption edges while scrubbing (off by default). */
  playheadSnap: boolean
  setPlayheadSnap: (on: boolean) => void
  /** Link video + its extracted audio so they move together (off by default). */
  linkAV: boolean
  setLinkAV: (on: boolean) => void
  /** The interface's language (ui/strings.ts): English unless chosen. Kept in localStorage. */
  uiLang: Lang
  setUiLang: (lang: Lang) => void
  /** Center + rule-of-thirds guide overlay in the preview (view-only). */
  showGuideOverlay: boolean
  setShowGuideOverlay: (on: boolean) => void
  /** Swaps the captions inside [a, b] for freshly transcribed ones. */
  replaceCaptionsInRange: (a: number, b: number, caps: Caption[]) => void
  /** Fills gaps between subtitles: each cue extends right to the next one. */
  compactCaptions: () => void
  // shorts mode
  setShortsBase: (x: number) => void
  addShortsKeyframe: () => void
  dragShorts: (x: number) => void
  deleteShortsKeyframe: (id: string) => void
  // shorts segments: marked stretches that export as individual Shorts
  activeShortSegmentId: string | null
  setActiveShortSegment: (id: string | null) => void
  /** Creates a segment starting at the playhead and makes it active. */
  addShortSegment: () => string
  /** `commit: false` folds the change into the caller's own undo snapshot —
   *  what a drag must use, or every mouse move becomes its own undo step. */
  updateShortSegment: (
    id: string,
    patch: Partial<Omit<ShortSegment, 'id' | 'keyframes'>>,
    commit?: boolean
  ) => void
  deleteShortSegment: (id: string) => void
  /** Copy a segment to an app-level clipboard (survives undo and project loads). */
  copyShortSegment: (id: string) => void
  /** Paste it at the playhead, keeping its length; returns the new id. */
  pasteShortSegment: () => string | null
  /** Sets the active segment's in or out point to the playhead (creating a
   *  segment if none is active). */
  markShortBound: (which: 'in' | 'out') => void
  /** Proposes up to 3 segments over the most speech-dense stretches of the
   *  transcript. Returns how many were added (0 = no transcript / no speech). */
  suggestShortSegments: () => number

  // -- effects ----------------------------------------------------------
  /** Adds a mix (cross-dissolve) into the next clip, on every video clip that has one. */
  applyMixTransitions: (duration: number, trackId?: string) => void
  applyTransitionPreset: (type: NonNullable<Clip['transitionOut']>['type'], duration: number, trackId?: string) => void
  applyRampInOut: (direction: Extract<ClipAnim, `ramp-${string}`>, duration: number, trackId?: string) => void
  clearTransitions: () => void
  setTransitionOut: (clipId: string, transition: Clip['transitionOut'] | null) => void
  cinematizeAll: (intensity: number, trackId?: string) => void
  applyGentlePan: (direction: GentlePanDirection, amountPercent: number, trackId?: string) => void
  /** `only`: just these clips (the selection), not every clip. */
  applyStillImageFx: (style: StillImageFxStyle, amount: number, trackId?: string, only?: string[]) => void
  clearStillImageFx: (trackId?: string, only?: string[]) => void
  applyAmbientFx: (style: AmbientFxStyle, amount: number, trackId?: string, mediaKind?: 'image' | 'video', only?: string[]) => void
  clearAmbientFx: (trackId?: string, mediaKind?: 'image' | 'video', style?: AmbientFxStyle, only?: string[]) => void
  /** A clip's moves, edited in place. */
  editClipMoves: (clipId: string, fn: (moves: NonNullable<Clip['moves']>) => void, commit?: boolean) => void
  /** A camera look on these clips only (null: take it off them). */
  setClipLook: (ids: string[], look: import('../effects/look').CameraLook | null) => void
  clearAllMotionFx: () => void
  setMotionFx: (clipId: string, patch: Partial<MotionFx> | null) => void
  removeClipMotionLayer: (clipId: string, layer: 'cinematic' | 'gentle') => void
  rerollMotionFx: (clipId: string) => void

  // -- captions ---------------------------------------------------------
  setCaptions: (captions: Caption[]) => void
  /** Replaces the SUBTITLE lane only — manual text and shapes are left alone.
   *  What a transcription run must use. */
  setSubtitles: (captions: Caption[]) => void
  /** Adds one manual text caption at the playhead and selects it. Returns its id. */
  addCaptionAtPlayhead: (text?: string) => string
  /** Adds a SHAPE at the playhead (a caption that draws geometry). */
  addShapeAtPlayhead: (kind: ShapeKind, highlightCaptionId?: string) => string
  setCaptionShape: (id: string, patch: Partial<CaptionShape>) => void
  /** Edits a single caption's own style override (manual text). */
  setCaptionOwnStyle: (id: string, patch: Partial<CaptionStyle>) => void
  /** Copies a text's whole look to an app-level clipboard, and stamps it onto
   *  others. Styling five lower-thirds by hand, five times, is not editing. */
  /** Text motion: the static offsets, or a keyframe at the playhead when the
   *  caption has keyframes (the same rule clip properties follow). */
  setCaptionMotion: (id: string, patch: Partial<CaptionMotion>, commit?: boolean) => void
  addCaptionKeyframe: (id: string) => void
  deleteCaptionKeyframe: (id: string, kfId: string) => void
  clearCaptionKeyframes: (id: string) => void
  copyCaptionStyle: (id: string) => void
  pasteCaptionStyle: (ids: string[]) => void
  hasCopiedCaptionStyle: () => boolean
  updateCaption: (id: string, patch: Partial<Caption>, commit?: boolean) => void
  /** Adjusts one karaoke word onset; other word timings remain untouched. */
  setCaptionWordStart: (id: string, index: number, start: number) => void
  setCaptionWordEnd: (id: string, index: number, end: number) => void
  /** Splits a text/subtitle at the word gap nearest the editor cursor. Returns
   *  the new right-hand caption id, or null when no valid split is possible. */
  splitCaptionAtCursor: (id: string, text: string, cursor: number) => string | null
  deleteCaption: (id: string) => void
  setCaptionStyle: (patch: Partial<CaptionStyle>) => void
  setTranscription: (patch: Partial<NonNullable<Project['transcription']>>) => void
  /** Edits the Shorts-specific caption style; pass null to remove it. */
  setCaptionStyleShorts: (patch: Partial<CaptionStyle> | null) => void

  // -- precise cutting (B key) -------------------------------------------
  /** Cutter tool (C): clicks on the timeline place cut marks. */
  cutterMode: boolean
  setCutterMode: (on: boolean) => void
  /** Split tool (B): clicking a clip splits it at the clicked point. */
  splitToolMode: boolean
  setSplitToolMode: (on: boolean) => void
  /** Slip tool: dragging a clip body slides the media inside it. */
  slipToolMode: boolean
  setSlipToolMode: (on: boolean) => void
  /** Picking a map's place by clicking the preview: which block, and which
   *  place (null: each click adds a new one). */
  mapPick: { tplId: string; itemId: string | null } | null
  setMapPick: (v: { tplId: string; itemId: string | null } | null) => void
  /** The canvas background (null: plain black). */
  setBackdrop: (backdrop: Backdrop | null, commit?: boolean) => void
  /** An audio track's level: every clip on it, keeping how they sit to one
   *  another (the loudest gets `level`). */
  setTrackLevel: (trackId: string, level: number, commit?: boolean) => void
  /** The project's transition sound level, 0..1. */
  setTransitionSfx: (level: number, commit?: boolean) => void
  /** How loud the build-ups into big moments are (0: none). */
  setRisers: (level: number, commit?: boolean) => void
  /** The camera look over the whole picture (null: none). */
  setCameraLook: (look: import('../effects/look').CameraLook | null, commit?: boolean) => void
  /** A look layer's look (an adjustment layer's camera look). */
  setLayerLook: (clipId: string, look: import('../effects/look').CameraLook | null, commit?: boolean) => void
  /** What a look layer lies over. */
  setLookOver: (clipId: string, over: 'below' | 'graphics' | 'all') => void
  /** A new look layer: on top of the video tracks, over [start, end) — a free
   *  stretch of the top track, else a new track of its own. Returns its id. */
  addLookLayer: (look: import('../effects/look').CameraLook | null, start: number, end: number, over?: 'below' | 'graphics' | 'all') => string
  /**
   * Shorts segments queued for one batch render, in the order they were added.
   * Deliberately NOT part of the project: it is a list of what you're about to
   * do, not part of the edit, and it shouldn't come back three days later when
   * you reopen the file.
   */
  exportQueue: string[]
  toggleExportQueue: (segmentId: string) => void
  clearExportQueue: () => void
  /** Moves a queued segment earlier (-1) or later (+1) in the render order. */
  reorderExportQueue: (segmentId: string, delta: number) => void
  /** Which video scope overlays the preview (null = none). Lives here so the
   *  control can sit in the Effects tab, next to grading, while the overlay
   *  itself is drawn over the picture. */
  scopeKind: 'waveform' | 'parade' | 'histogram' | null
  setScopeKind: (kind: 'waveform' | 'parade' | 'histogram' | null) => void
  /** Pending cut positions shown as dashed lines; nothing is split yet. */
  cutMarks: number[]
  /** Which lane the marks belong to — cutting only affects this one.
   *  A track id, or 'captions' for the subtitle lane. */
  cutTrackId: string | 'captions' | null
  addCutMark: (time: number, trackId: string | 'captions' | null) => void
  clearCutMarks: () => void
  /** Removes everything between the two outermost cut marks, on the marked
   *  lane only (ripple). */
  deleteBetweenCuts: (onlyItsTrack?: boolean) => void
  /** Inverse cut: trims ONE clip down to just [a, b] — everything of that
   *  clip outside the range is discarded; other clips/tracks untouched. */
  keepOnlyRange: (clipId: string, a: number, b: number) => void
  /** Removes [a, b] seconds from the whole timeline (clips + captions) and
   *  closes the gap — used by the transcript editor. */
  rippleDelete: (a: number, b: number, scope?: CutScope) => void
  /** Ripple-deletes several ranges as ONE undo step (filler-word cleanup). */
  rippleDeleteMany: (ranges: [number, number][], scope?: CutScope) => void

  // -- snapping ---------------------------------------------------------
  setSnap: (patch: Partial<SnapSettings>) => void

  // -- transport / ui ---------------------------------------------------
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  selectClip: (id: string | null, additive?: boolean) => void
  selectClips: (ids: string[]) => void
  /** Ctrl+A: every clip on every unlocked track, plus every caption. */
  selectAll: () => void
  selectedCaptionIds: string[]
  selectCaptions: (ids: string[]) => void
  deleteCaptions: (ids: string[]) => void
  /** A caption whose text the user asked to edit (double-click on its chip).
   *  The preview owns the in-place editor, so the timeline asks for it here
   *  rather than reaching across into another component's state. */
  captionEditRequest: string | null
  requestCaptionEdit: (id: string | null) => void
  setPxPerSec: (v: number) => void
  setTimelineMagnet: (v: boolean) => void
  setTranscribeStatus: (s: string | null) => void
  setTranscribeProgress: (p: EditorState['transcribeProgress']) => void
  setExportStatus: (s: EditorState['exportStatus']) => void
}
