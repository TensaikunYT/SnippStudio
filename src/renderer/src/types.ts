// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/** 'code': a code film — a folder whose index.html draws any second on its
 *  canvas (VideoHub's live contract; CODE-FILM-CLIP-PLAN.md). */
export type AssetKind = 'video' | 'image' | 'audio' | 'code'

import type { WhisperLanguage, WhisperModelChoice } from './subtitles/models'
import type { CodeEdit } from '../../shared/codeval/types'
import { partOf } from './timeline/media-time'

export interface Asset {
  id: string
  kind: AssetKind
  name: string
  /** Absolute path on disk (Electron). Persisted so projects can re-link media. */
  path?: string
  /** The same file relative to the project file's folder, written with each
   *  save (phase Ç2a.2, decision 3): a moved project folder finds its media
   *  through it. Absent when no relative path exists (another drive). */
  relPath?: string
  /** The file's last-modified time (ms, rounded) when it was last read: with
   *  `size`, its fingerprint (phase Ç2a.2, decision 2). A file whose
   *  fingerprint changed is read again on open. */
  mtime?: number
  /** Runtime URL: media:// (Electron) or blob: (plain browser fallback). */
  url: string
  size: number
  /** Seconds. 0 for still images. */
  duration: number
  width: number
  height: number
  hasAudio: boolean
  /** A video's frame rate as measured at import (its packets a second:
   *  29.97…, 25); unset for older files and for pictures. An empty project
   *  takes it when it is a listed rate (phase Ç3a, decision 4). */
  fps?: number
  /** Runtime-only extras (not persisted). */
  thumbnail?: string
  /** Horizontal filmstrip (N frames across the whole clip) as a data URL. */
  filmstrip?: string
  /** Number of frames in the filmstrip (for mapping media time → strip px). */
  filmstripCols?: number
  waveform?: number[]
  missing?: boolean
  /** This computer has no decoder for the video's pictures (an HEVC, ProRes
   *  or AV1 file without a system decoder): badged in the media panel, and
   *  the export refuses it (phase Ç3a, decision 6). Runtime only. */
  undecodable?: boolean
  /** An HDR video (HLG or PQ transfer): the export draws it through the 8-bit
   *  SDR canvas, converted by the browser in its own way, so the picture may
   *  differ from the file's (phase Ç3b, decision 7; report R22). Badged and
   *  said before an export; no conversion of our own. Runtime only. */
  hdr?: 'hlg' | 'pq'
  /** A video whose track carries an alpha channel (a VP9 WebM with alpha,
   *  phase 5b decision 4): its frames are decoded with it, so the tracks
   *  under it show through, paused, playing and exported. */
  alpha?: boolean
  /** Folder this was imported from, when a whole folder was brought in. The
   *  media bin groups by it so a shoot stays together instead of scattering
   *  through one long list. */
  folder?: string
  /** A code film's own settings (kind 'code' only). Its `path` is the film's
   *  FOLDER, its `url` snippfilm://<id>/ (made again each session). */
  code?: {
    fps: number
    /** The asset of its sound (audio/mix.wav), when it has one. */
    mixAssetId?: string
    /** Some of its frames let the tracks under it show through (phase 5b,
     *  decision 2): read from the frames sampled for its filmstrip. */
    hasAlpha?: boolean
    /** How its page is played (phase 5c, shared decision 1), chosen when it
     *  first ran and again when its code changes: 'fast' (it has its own
     *  renderOut), 'canvas' (the app's clock, its canvases copied), 'page'
     *  (it shows more than canvases: needs the whole page drawn, phase 5d). */
    mode?: 'fast' | 'canvas' | 'page'
    /** The values the user set for the parameters its page says it has
     *  (window.__params; phase 5f, decision 2), by key. Unset: the page's own. */
    params?: Record<string, string | number>
    /** The constants of its page the user changed by hand (cila K, "code
     *  values": colours, texts, fonts, times the app found in the code).
     *  Written into the page as it is served, never into its files; shared
     *  by every clip of the film, like `params`. Unset: none. */
    edits?: CodeEdit[]
  }
}

/** What can be shown as a picture: a still, a
 *  video, a code film. */
export function isPictureAsset(a: Asset | undefined | null): a is Asset {
  return !!a && (a.kind === 'image' || a.kind === 'video' || a.kind === 'code')
}

/** Is this clip a code film? (CODE-FILM-CLIP-PLAN.md, D9.) */
export function isCodeClip(p: { assets: Asset[] }, c: { assetId: string; nested?: unknown } | undefined | null): boolean {
  return !!c && !c.nested && p.assets.some((a) => a.id === c.assetId && a.kind === 'code')
}

/** Entrance / exit animations for a visual clip. */
export type ClipAnim =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'pop'
  | 'blur'
  | 'spin'
  | 'whip'
  | 'elastic'
  | 'ramp-right'
  | 'ramp-left'
  | 'ramp-down'
  | 'ramp-up'

export const CLIP_ANIMS: ClipAnim[] = [
  'none',
  'fade',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
  'pop',
  'blur',
  'spin',
  'whip',
  'elastic',
  'ramp-right',
  'ramp-left',
  'ramp-down',
  'ramp-up'
]

/** Analogue-era looks. Each is a complete treatment applied per pixel, and
 *  each is a pure function of the pixel and the time, so the export draws the
 *  frame the preview drew. */
export type VideoFxStyle = 'none' | 'crt' | 'vhs' | 'halftone' | 'posterize'

export const VIDEO_FX: [VideoFxStyle, string][] = [
  ['none', 'None'],
  ['crt', 'Retro TV'],
  ['vhs', 'VHS tape'],
  ['halftone', 'Halftone print'],
  ['posterize', 'Posterize']
]

/** Continuous "alive" motion while a clip is on screen. */
export type IdleStyle = 'none' | 'handheld' | 'float' | 'sway' | 'breathe'

export const IDLE_STYLES: IdleStyle[] = ['none', 'handheld', 'float', 'sway', 'breathe']

export interface MotionFx {
  enabled: boolean
  /** Ken Burns zoom factor at clip start / end. */
  zoomFrom: number
  zoomTo: number
  /** Total drift, in project pixels (of the whole chain when sliced). */
  panX: number
  panY: number
  /** Handheld shake amplitude in project pixels / degrees, and speed in Hz. */
  shakeAmp: number
  shakeRotAmp: number
  shakeSpeed: number
  seed: number
  /** 'linear' is used for slices of a continuous multi-clip motion chain. */
  ease?: 'smooth' | 'linear'
  /** Added to the shake clock so chained clips share one continuous shake. */
  timeOffset?: number
  /** Pan progress fractions covered by this clip (defaults: -0.5 → 0.5). */
  panFrom?: number
  panTo?: number
  /** A second, independent editorial pan layer. Gentle Pan writes only these
   *  fields so Cinematize can keep its own zoom, drift and handheld motion. */
  gentleZoom?: number
  gentlePanX?: number
  gentlePanY?: number
  gentlePanFrom?: number
  gentlePanTo?: number
}

/** Animated light treatments intended for still images. They are rendered as
 *  overlays, so they compose with motion, grading, masks and transitions. */
export type StillImageFxStyle = 'window-light' | 'golden-hour' | 'anamorphic' | 'haze' | 'dust' | 'light-glow' | 'light-leak' | 'shimmer'

/** Subtle frame ambience that also works on moving footage. */
export type AmbientFxStyle = 'living-frame' | 'edge-glow' | 'shadow-breathe' | 'soft-focus' | 'film-burn'
export const AMBIENT_FX: [AmbientFxStyle, string][] = [
  ['living-frame', 'Living frame · soft edges, breathing vignette, wandering light'],
  ['film-burn', 'Film burn · the frame flares and scorches now and then'],
  ['edge-glow', 'Ambient edge glow'],
  ['shadow-breathe', 'Breathing vignette'],
  ['soft-focus', 'Soft focus pulse']
]

export const STILL_IMAGE_FX: [StillImageFxStyle, string][] = [
  ['window-light', 'Window light · soft beams drifting'],
  ['golden-hour', 'Golden hour · low warm sun'],
  ['anamorphic', 'Anamorphic flare · a thin blue streak'],
  ['haze', 'Morning haze · slow fog below'],
  ['dust', 'Dust in the light · a beam, motes floating'],
  ['light-glow', 'Soft light glow (classic)'],
  ['light-leak', 'Moving light leak (classic)'],
  ['shimmer', 'Cinematic shimmer (classic)']
]

export interface ClipTransform {
  /** Center position in world (project-pixel) coordinates. */
  x: number
  y: number
  scale: number
  /** Radians. */
  rotation: number
}

/** Independently keyframable clip properties. */
export type KfChannel = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
export const KF_CHANNELS: KfChannel[] = ['x', 'y', 'scale', 'rotation', 'opacity']

/** Width of the timeline's sticky track-header column, in px. Clip and overlay
 *  x-positions all include it, so it must be ONE definition. */
export const TIMELINE_HEADER_W = 110

export interface PropKeyframe {
  id: string
  /** Clip-local time, seconds. */
  time: number
  value: number
  /** Easing INTO this keyframe (default smooth). */
  easing?: KfEasing
  /** The "Keyframe all" set it was written with (phase Ç2c.2, decision 2):
   *  the keys of one set share it. Optional, adds to what an older build
   *  reads (it keeps or ignores it). */
  group?: string
}

export type ClipChannels = Partial<Record<KfChannel, PropKeyframe[]>>

/** The effect amounts that can be keyed ("cila" part D): glow, halation,
 *  mosaic (its cell size) and colour isolate. */
export type FxKey = 'bloom' | 'halation' | 'mosaic' | 'isolate'
export const FX_KEYS: FxKey[] = ['bloom', 'halation', 'mosaic', 'isolate']

/** Exposure (stops), tint, highlights, shadows. */
export interface ClipTone {
  exposure: number
  tint: number
  highlights: number
  shadows: number
}
export const neutralTone = (): ClipTone => ({ exposure: 0, tint: 0, highlights: 0, shadows: 0 })
export const defaultBloom = (): NonNullable<Clip['bloom']> => ({ amount: 0, threshold: 0.6, radius: 0.4 })
export const defaultHalation = (): NonNullable<Clip['halation']> => ({ amount: 0, size: 0.5 })
export const defaultIsolate = (): NonNullable<Clip['isolate']> => ({ color: '#e02020', range: 0.08, amount: 1 })

/** A .cube LUT file the project uses: an asset of the project, as a media
 *  file is (its path, and with each save the same file relative to the
 *  project file). Clips name it by `name`. */
export interface ProjectLut {
  name: string
  path: string
  /** Written with each save (main/project-media.ts withRelativePaths). */
  relPath?: string
  size?: number
  mtime?: number
}

/** One point of a speed curve: at media second `m` (the clip's source time)
 *  the clip plays at `v` (0.1–100). */
export interface SpeedKey {
  m: number
  v: number
}

/** A clip's speed curve (timeline/speed-curve.ts): points by media second,
 *  ascending; between two, the speed eases from one to the other (in log
 *  speed), or runs straight (`linear`); before the first and after the last
 *  it holds. */
export interface SpeedCurve {
  keys: SpeedKey[]
  linear?: true
}

/** The six label colours of a clip (KOLAY-PLAN.md, item 3). */
export const CLIP_LABELS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type ClipLabel = (typeof CLIP_LABELS)[number]

export interface Clip {
  id: string
  assetId: string
  trackId: string
  /** Which piece of content this is (SnippStudio phase 4A.9): a clip cut in
   *  pieces (split, a ripple cut, a silence cut) gives every piece the id of
   *  the clip they came from; a clip made from an asset, pasted or
   *  duplicated has none and is its own (`instanceOf`). An agent's edit
   *  follows this, not the clip id, so it finds "the same footage" after the
   *  user cut it up, and never takes a copy for the original. Not the film:
   *  it never changes once a clip has it. */
  instance?: string
  /** Automation's numbered still is absent. This clip is a visible timeline
   *  placeholder only: it renders no picture until an image is chosen. */
  automationMissing?: { number: number; text: string; captionIds: string[] }
  /** Timeline position, seconds. */
  start: number
  /** Offset into the source media, seconds (0 for images). */
  inPoint: number
  duration: number
  transform: ClipTransform
  /** Per-property keyframe channels (x/y/scale/rotation/opacity), in
   *  clip-local seconds. A key may lie outside [0, duration] (off the clip:
   *  an edit moves the window, never the keys; phase Ç2c.1). Older files'
   *  one shared list (`keyframes`) becomes channels when the file is read
   *  (model/format.ts, format 5). */
  channels?: ClipChannels
  /** Volume automation (clip-local time → 0..1), linear between points. */
  volumeKeyframes?: { id: string; time: number; value: number }[]
  /** Auto-ducking remembers the pre-duck envelope so reapplying or removing it
   *  never destroys volume work that was already on the music clip. */
  autoDucking?: {
    sourceTrackId: string
    originalVolumeKeyframes?: { id: string; time: number; value: number }[]
    duckRatio: number
    attack: number
    hold: number
    release: number
  }
  /** Audio fades, seconds. */
  fadeIn?: number
  fadeOut?: number
  /** True after Extract Audio: this video clip contributes no sound. */
  audioExtracted?: boolean
  /** Clips sharing a linkId move together (video + its extracted audio). */
  linkId?: string
  /** Visual opacity, 0..1 (default 1). */
  opacity?: number
  motionFx?: MotionFx
  /** Animated overlay for still images (preview and export use the same path). */
  stillImageFx?: { style: StillImageFxStyle; amount: number; seed: number; timeOffset?: number }
  /** Optional, deterministic ambient treatment; separate from still light and motion. */
  ambientFx?: { style: AmbientFxStyle; amount: number; seed: number; timeOffset?: number }
  /** Transition into whatever follows, centered on the cut. `mix` = cross-
   *  dissolve, `fade` = dip to black, `slide` = horizontal push. */
  /**
   * Transition into the NEXT clip. `align` says where it sits relative to the
   * cut, because a transition has to be fed real footage from both sides:
   *   center — half before the cut, half after (the classic shape)
   *   start  — entirely after the cut (the incoming clip plays from frame one)
   *   end    — entirely before it
   *   auto (default) — centred when both clips have the footage for it,
   *          otherwise shifted to the side that does. Without this, a clip
   *          trimmed hard to the head of its media has nothing to show for the
   *          first half of the transition and holds its first frame.
   */
  transitionOut?: {
    type: 'mix' | 'fade' | 'slide' | 'wipe' | 'zoom' | 'flash' | 'whip' | 'blur' | 'iris' | 'push' |
      'ramp-right' | 'ramp-left' | 'ramp-down' | 'ramp-up' | 'speed-ramp' | 'light-leak' | 'film-burn'
    duration: number
    /** The clip it goes into (phase Ç2b.2, report G2): drawn only while that
     *  clip is the one right after this one on the track, and dropped at the
     *  end of the edit that ends that. `null`: a fade-out put there on
     *  purpose (a dissolve or a dip with nothing to go into). Unset only
     *  between an edit and its end (filled from the clip after it then). */
    to?: string | null
    align?: 'auto' | 'center' | 'start' | 'end'
    /** Target velocity at the cut, relative to normal playback (default 10×). */
    peakSpeed?: number
    /** Motion-blur direction for the cut; source footage itself is time-remapped. */
    direction?: 'right' | 'left' | 'up' | 'down'
    /** Its sound, against the project's transition sound level: 0 or
     *  unset silent (DENEME-3, V item 2: a transition makes no sound unless
     *  given one), 1 as set, up to 1.5 louder. Files of format 6 or older
     *  had unset = 1: their transitions get `sfx: 1` written in on opening
     *  (model/format.ts, conversion 7). */
    sfx?: number
  }
  volume: number
  /** Silences this clip without touching its volume, fades or keyframes — so
   *  unmuting restores exactly what was there. A keyframed clip can't be muted
   *  by dropping `volume` to 0, because keyframes replace the base value. */
  muted?: boolean
  /** Playback speed (1 = normal; 0.1–100, timeline/speed.ts). Timeline
   *  duration = media length / speed. */
  speed?: number
  /** Only ever `false`: the sound's pitch follows the speed (a tape played
   *  faster). Absent, a retimed clip keeps its pitch — in the preview and in
   *  the export alike (timeline/speed.ts keepsPitch). */
  keepPitch?: false
  /** A speed that changes along the clip (core polish C; timeline/speed-curve.ts).
   *  Absent: one speed. `speed` stays the clip's AVERAGE (media length /
   *  duration), so everything that reads `inPoint + duration * speed` is
   *  still right; the curve only bends time inside that window. */
  speedCurve?: SpeedCurve
  /** Color grade: 1 is neutral for the first three, 0 neutral warmth. */
  grade?: { brightness: number; contrast: number; saturation: number; warmth: number }
  /** Canvas composite mode against the layers below (undefined = normal). */
  blendMode?: BlendMode
  /** Entrance / exit animation, with durations in seconds. */
  anim?: { in?: ClipAnim; out?: ClipAnim; inDur?: number; outDur?: number }
  /** Continuous idle motion (handheld camera drift and friends). */
  idle?: { style: IdleStyle; amount: number; speed: number }
  /** Temporarily switched off: stays on the timeline but renders no picture
   *  and contributes no sound. For A/B comparisons without deleting anything. */
  disabled?: boolean
  /** The user locked it against agents (KAPSAM-AJAN-PLAN.md; project format
   *  8): an agent's op that would change it is not applied. Only `true`
   *  means locked. Not the film: the user's own edits are not affected. */
  agentLock?: true
  /** A coloured label of the user's (KOLAY-PLAN.md, item 3; format 8, an
   *  optional field): a line along the clip's top edge on the timeline, and
   *  the timeline search's filter. Not the film. */
  label?: ClipLabel
  /** Adjustment layer: carries no media, re-grades everything beneath it. */
  adjustment?: true
  /**
   * Compound clip: a group of clips rendered as one image. Child `start`
   * times are relative to this clip's own start, and children are listed
   * bottom layer first.
   */
  nested?: { clips: Clip[] }
  /** Gaussian blur, project pixels (0 = off). */
  blur?: number
  /** Extra look effects (0 = off unless noted). */
  sharpen?: number
  vignette?: number
  grain?: number
  glow?: number
  /** Chromatic aberration, media pixels. */
  chromaAb?: number
  /**
   * A whole look, rather than another dial: analogue television, tape, print.
   * One at a time — they are complete treatments, not ingredients — while the
   * dials above (grain, vignette, aberration) still stack on top of whichever
   * is chosen.
   */
  videoFx?: { style: VideoFxStyle; amount: number }
  /** Duotone map (shadows→dark, highlights→light); B&W = black→white. */
  duotone?: { dark: string; light: string } | null
  /** Shape mask (ellipse/rect/rounded/freehand path), keyframable. */
  mask?: ClipMask
  /** Follow a motion tracker: the clip rides the tracker's movement. */
  trackerId?: string
  /** Freeze frame: render this fixed media time for the whole clip (silent). */
  freeze?: number
  /** Play the media backwards (preview approximates; export is exact). */
  reversed?: boolean
  /** Mirroring. */
  flipH?: boolean
  flipV?: boolean
  /** Crop, as fractions of the media (0 = no crop from that side). */
  crop?: { l: number; t: number; r: number; b: number }
  /** Green screen keying. `method` unset: the first keyer (RGB distance), the
   *  one every project made before "cila" part D has, drawn as it always was.
   *  'chroma': the distance on the CbCr plane, and `spill` (0..1) of the key
   *  colour's cast taken off what stays. */
  chroma?: { enabled: boolean; color: string; similarity: number; smoothness: number; method?: 'chroma'; spill?: number }
  /** Its sound replaced by a cleaned copy: the asset it came from, and how
   *  hard it was cleaned (for going back, or cleaning again). */
  cleaned?: { from: string; noise: number; ess: number }
  /** Per-clip audio effects (applied in preview mix approximation + export). */
  audioFx?: {
    /** 3-band EQ gains in dB (-24..24). */
    eqLow: number
    eqMid: number
    eqHigh: number
    /** High-pass cutoff Hz (0 = off) — removes rumble. */
    highpass: number
    /** Low-pass cutoff Hz (0 = off) — removes hiss. */
    lowpass: number
    /** Compressor. */
    comp: { enabled: boolean; threshold: number; ratio: number }
    /** Noise gate: silences everything under `threshold` dB, so room tone, fan
     *  noise and keyboard hum disappear BETWEEN words instead of sitting under
     *  the whole track. Optional — projects saved before it existed have none. */
    gate?: { enabled: boolean; threshold: number; release: number }
  }
  /** The LUT to apply: one of the project's (`Project.luts`, by name), a
   *  built-in look (`preset:<id>`, luts.ts LUT_PRESETS), or the name of a .cube
   *  kept on this computer only (imports made before "cila" part D). */
  lut?: string
  /** How much of the LUT is mixed in, 0..1 (unset: all of it). */
  lutAmount?: number
  /** More colour, worked in the pixel pass before the LUT (0 = as it is):
   *  exposure in stops (−2..2), tint (+ magenta, − green), highlights and
   *  shadows (−1..1). `grade` above is drawn as it always was. */
  tone?: ClipTone
  /** Glow: the bright parts (above `threshold`, 0..1) blurred (`radius`,
   *  0..1 of its widest) and laid back on, `amount` 0..1. The older `glow`
   *  above is kept for the projects that have it. */
  bloom?: { amount: number; threshold: number; radius: number }
  /** Halation: a warm red halo around the highlights, `amount` and `size` 0..1. */
  halation?: { amount: number; size: number }
  /** Mosaic: the picture in cells of this many media pixels (unset: off). */
  mosaic?: number
  /** Colour isolate: `color`'s hue is kept (within `range`, 0..0.5 of a half
   *  turn), the rest goes towards black and white by `amount` (0..1). */
  isolate?: { color: string; range: number; amount: number }
  /** Keys on the amounts of the four effects above (clip-local seconds, as
   *  the transform's channels; they ride along with trims and splits). */
  fxKeys?: Partial<Record<FxKey, PropKeyframe[]>>
  /** An adjustment layer's camera look — a look layer: for as long as the
   *  layer lasts, over what `lookOver` says. */
  cameraLook?: import('./effects/look').CameraLook
  /** What a look layer lies over: the tracks below it (default), those and
   *  the graphics, or everything but the subtitles (the hands too). */
  lookOver?: 'below' | 'graphics' | 'all'
  /** A camera look on this clip's own picture only (film, vignette…). */
  look?: import('./effects/look').CameraLook
  /** Moves on the picture itself (enter, walk, hop, turn…), their times in
   *  seconds into the clip, and its own feel. */
  moves?: { actions: MoveAction[]; physics?: MovePhysics }
}

export const defaultAudioFx = (): NonNullable<Clip['audioFx']> => ({
  eqLow: 0,
  eqMid: 0,
  eqHigh: 0,
  highpass: 0,
  lowpass: 0,
  comp: { enabled: false, threshold: -24, ratio: 3 },
  gate: { enabled: false, threshold: -45, release: 120 }
})

/** A manually animated motion path other elements can follow. */
export interface Tracker {
  id: string
  name: string
  keyframes: { id: string; time: number; x: number; y: number }[]
}

/** Geometry of a mask at one moment (asset-local pixels, origin = media
 *  center — the mask rides the clip's transform automatically). */
/** Layer blend modes. Values are canvas `globalCompositeOperation` names. */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'lighter'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'lighter'
]

export interface MaskGeom {
  cx: number
  cy: number
  w: number
  h: number
  /** Radians, about the mask's own centre. Every other object in the editor
   *  can be turned; a mask could only ever sit square to the frame. */
  rot?: number
  /** Freehand shape: closed smooth curve through these points. */
  points?: { x: number; y: number }[]
}

export interface MaskKeyframe extends MaskGeom {
  id: string
  /** Clip-local seconds. */
  time: number
}

export interface ClipMask extends MaskGeom {
  enabled: boolean
  shape: 'ellipse' | 'rect' | 'round' | 'path'
  /** cut = transparency (default) · blur / pixelate = censor the region.
   *  Strength for blur/pixelate lives in `feather`. */
  mode?: 'cut' | 'blur' | 'pixelate'
  /** Soft edge, asset pixels. Edge softness ONLY — it used to double as the
   *  censor strength for blur/pixelate, which is why raising "Feather" in
   *  those modes appeared to smear the whole frame instead of its edge. */
  feather: number
  /** Blur/pixelate censor strength, asset pixels. Undefined on projects saved
   *  before the two were separated — those fall back to the old formula so
   *  they keep the look they were saved with. */
  strength?: number
  /** Hide the inside instead of the outside. */
  invert?: boolean
  /** Freehand corner rounding: 0 = exactly as drawn (default), 1 = fully curved. */
  smooth?: number
  keyframes?: MaskKeyframe[]
}

export const neutralGrade = (): NonNullable<Clip['grade']> => ({
  brightness: 1,
  contrast: 1,
  saturation: 1,
  warmth: 0
})

export interface Track {
  id: string
  kind: 'video' | 'audio'
  name: string
  clipIds: string[]
  /** Locked tracks can't be edited from the timeline. */
  locked?: boolean
  /** Hidden video tracks don't render. */
  hidden?: boolean
  /** Muted tracks produce no audio. */
  muted?: boolean
  /** Soloed: while ANY track is soloed, only soloed tracks are audible. */
  solo?: boolean
  /** Auto-pack: every clip added or moved on this track snaps back-to-back. */
  autoPack?: boolean
  /** Row height in px (overrides the default for the kind). */
  height?: number
  /** What the app made the track for: 'sfx', the sound effects' track (found
   *  by this, not by its name, which the user may change; phase Ç2b.1, L10;
   *  format 3). */
  role?: 'sfx'
}

/** Default timeline row height for a track kind, in px. */
export function defaultTrackHeight(kind: Track['kind']): number {
  return kind === 'audio' ? 60 : 72
}

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

/** Per-keyframe easing for clip keyframes ('smooth' = default ease-in-out). */
export type KfEasing = 'smooth' | 'linear' | 'easeIn' | 'easeOut' | 'hold'

export interface CaptionWord {
  text: string
  start: number
  end: number
  estimated?: boolean
}

export interface Caption {
  id: string
  start: number
  end: number
  text: string
  /** Word-level timings (from Whisper) enabling per-word pop-up animation. */
  words?: CaptionWord[]
  /** Manually added text (vs auto-transcribed) — shown yellow on the timeline. */
  manual?: boolean
  /** Key words: the words you chose to mark in this subtitle (word indices;
   *  empty = none), in place of the ones found for it. */
  marks?: number[]
  /** Timeline lane: 0 = subtitles, 1+ = text layers (parallel text is fine). */
  layer?: number
  /** A subtitle's sound clip (the voice it was heard in): when that clip is
   *  moved, trimmed, split, cut out or sped up, the subtitle and its word
   *  times go with it (subtitles/follow.ts). Found and kept on the first such
   *  edit; a hint, checked against where the subtitle really is. */
  soundClip?: string
  /** Manual text can follow a motion tracker too. */
  trackerId?: string
  /** Per-caption style override (manual text only), independent of the auto
   *  subtitle style. */
  style?: CaptionStyle
  /** This line only: where it sits (left, middle, right) and its font. */
  place?: 'left' | 'center' | 'right'
  font?: string
  /** Draw this as a SHAPE instead of text. Shapes are captions on purpose: they
   *  then get timeline chips, timing, layers, dragging in the preview, the
   *  entrance/exit animations, the style's colours and the motion keyframes
   *  without a second copy of any of it. */
  shape?: CaptionShape
  /** Static motion offsets (used when there are no keyframes). */
  motion?: CaptionMotion
  /** Keyframed motion, ordered by time. Two or more animate; one holds. */
  kfs?: CaptionKeyframe[]
  /** Manual text entrance/exit animation + idle motion. */
  anim?: {
    in?: TextAnim
    out?: TextAnim
    /** In/out durations, seconds (default 0.35). */
    inDur?: number
    outDur?: number
    /** Continuous motion while displayed. */
    idle?: TextIdle
    /** Idle intensity, 0..2 (default 1). */
    idleAmt?: number
    /** Run the entrance one CHARACTER at a time instead of moving the whole
     *  block: each letter animates with `charStagger` seconds between them. */
    perChar?: boolean
    /** Seconds between one character's entrance and the next (default 0.03). */
    charStagger?: number
  }
}

/**
 * Animatable offsets on top of a caption's static placement: x/y in project
 * pixels, a scale multiplier, extra rotation in radians and an opacity
 * multiplier. Entrance/exit animations move a text ON and OFF; this is what
 * moves it AROUND while it is there.
 */
export interface CaptionMotion {
  x: number
  y: number
  scale: number
  rot: number
  opacity: number
}

export const defaultCaptionMotion = (): CaptionMotion => ({ x: 0, y: 0, scale: 1, rot: 0, opacity: 1 })

/** One keyframe: a full snapshot of the motion at `time` (seconds from the
 *  caption's own start). Snapshots rather than per-channel curves — the same
 *  shape the UI writes and reads, with nothing to reconcile. */
export interface CaptionKeyframe extends CaptionMotion {
  id: string
  time: number
}

export type ShapeKind = 'rect' | 'marker' | 'circle' | 'line' | 'arrow'

export interface CaptionShape {
  kind: ShapeKind
  /** Size as a fraction of the frame. */
  w: number
  h: number
  /** Draw itself on over the entrance instead of just appearing — the
   *  highlighter stroke that sweeps in under a word. */
  reveal?: boolean
}

export type TextAnim = 'none' | 'fade' | 'slide' | 'zoom' | 'note' | 'pop' | 'blur' | 'drop' | 'spin' | 'grow'
export type TextIdle =
  | 'none'
  // The good ones: two frequencies laid over each other, so the cycle is long
  // enough that the eye never finds it.
  | 'breathe'
  | 'drift'
  | 'tilt'
  | 'bob'
  | 'glide'
  // The originals — a single sine each, which is exactly what they look like.
  | 'float'
  | 'sway'
  | 'pulse'

export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  /** Slanted (the face's italic, or the face leaned when it has none). Unset:
   *  upright, drawn exactly as before the field was there (YAZI2-PLAN.md, D3). */
  italic?: boolean
  color: string
  outlineColor: string
  outlineWidth: number
  bgColor: string
  bgOpacity: number
  /** Vertical anchor, 0 = top, 1 = bottom. */
  posY: number
  /** Horizontal anchor, 0 = left, 1 = right (default 0.5 = centered). */
  posX?: number
  maxLineChars: number
  uppercase: boolean
  /**
   * "Boiling": the wobble of hand-drawn animation, where every frame is drawn
   * again slightly differently. Each letter gets its own small offset, turn and
   * outline variation, and the whole thing JUMPS on a slow clock rather than
   * sliding — a smooth wobble reads as a wobble, while a jump reads as ink.
   *
   * Off unless asked for, and available on any font: it is at its best on the
   * handwritten ones, but a boiling Anton is a look too.
   */
  boil?: {
    enabled: boolean
    /** 0.2 = barely alive, 1 = default, 2 = restless. */
    amount: number
    /** Redraws per second. 8–12 is what hand-drawn animation actually uses. */
    fps: number
  }
  /** Word-by-word entrance animation. */
  popup: {
    enabled: boolean
    /** Seconds each word takes to appear. */
    duration: number
    /** 0 = plain fade, higher = bouncier scale overshoot (pop style only). */
    intensity: number
    /** Entrance style: bouncy pop, calm fade, cozy rise, a focus-pull blur,
     *  the minimalist soft / lift / ghost, or the always-moving fluid.
     *  ('focus' was called 'apple' — renamed to a plain cinematography term,
     *  and migrateProject rewrites the old value.) */
    style?:
      | 'pop'
      | 'fade'
      | 'rise'
      | 'focus'
      | 'soft'
      | 'lift'
      | 'ghost'
      | 'fluid'
      | 'plain'
      | 'bloom'
      | 'wave'
      | 'glide'
      | 'tilt'
      | 'drift'
      | 'type'
      | 'shimmer'
      | 'marker'
      | 'flip'
  }
  /** Subtitle grouping: positive = fixed word count, 0 = automatic,
   *  -1 = sentence/clause cues split at punctuation plus smart length limits,
   *  -2 = the same rules while also respecting pauses in word timings. */
  wordsPerCue?: number
  /** Pause-aware grouping sensitivity in seconds; 0/undefined adapts to pace. */
  pauseThreshold?: number
  /** Drop shadow / glow behind the text. */
  shadow?: { enabled: boolean; color: string; blur: number; dx: number; dy: number }
  /** Line height multiplier (default 1.25). */
  lineHeight?: number
  /** Extra letter spacing in px (default 0). */
  letterSpacing?: number
  /** Multi-line alignment (default center). */
  align?: 'left' | 'center' | 'right'
  /** Rotation in radians (default 0). Text could only be laid flat before —
   *  no corner label, no diagonal stamp, no tilted banner. */
  rotate?: number
  /** Background box shape. The box was a bare rectangle with hardcoded
   *  padding; these make it a real label — rounded, padded to taste, with an
   *  optional border. All optional, and the defaults are the old look. */
  bgRadius?: number
  /** Padding as a multiple of the font size (defaults 0.35 / 0.18). */
  bgPadX?: number
  bgPadY?: number
  bgBorder?: { color: string; width: number }
  /** Editorial highlighter behind selected whitespace-delimited words only.
   * This is visual metadata: it never changes cue or Whisper word timing. */
  marker?: { enabled: boolean; color: string; duration: number; words?: number[] }
  /** Key words: the subtitles mark a number, a name or a strong word on
   *  their own (at most one in a line, spaced out) with this highlighter.
   *  See subtitles/keywords. */
  keyMark?: { enabled: boolean; amount: 'few' | 'some' | 'more'; color: string; duration: number }
  /** Shrink the text until the widest line fits this fraction of the frame
   *  (0 / undefined = off). Long headlines overflowed the frame instead. */
  fitWidth?: number
  /** Gradient fill for the glyphs instead of a flat colour. Angle in degrees,
   *  0 = left→right. */
  gradient?: { enabled: boolean; from: string; to: string; angle: number }
  /** How the text composites onto the picture ('normal' = straight over it).
   *  Screen makes it glow through highlights, multiply sinks it into them. */
  blend?: 'normal' | 'screen' | 'multiply' | 'overlay' | 'difference' | 'lighten' | 'darken'
  /** Karaoke: the currently spoken word gets its own color and a size bump.
   *  `box` adds the TikTok-style filled pill behind that word, which glides
   *  smoothly from the previous word instead of jumping. */
  highlight?: {
    enabled: boolean
    color: string
    scale: number
    box?: boolean
    boxColor?: string
    /** Seconds the pill takes to slide between words (0 = instant). */
    boxGlide?: number
  }
  /** Optional emoji decoration: "money=💰, warning=⚠️" appends emojis to
   *  matching words. Off by default. */
  emoji?: { enabled: boolean; rules: string }
}

export interface SnapSettings {
  enabled: boolean
  /** Snap threshold in screen pixels. */
  distance: number
  snapEdges: boolean
  snapCenters: boolean
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
}

export interface ShortsKeyframe {
  id: string
  time: number
  /** Center X of the 9:16 window, in project pixels. */
  x: number
}

/** A marked stretch of the timeline that becomes one exported Short. */
export interface ShortSegment {
  id: string
  name: string
  start: number
  end: number
  /** Per-segment crop pan; when empty the global shorts pan applies. */
  baseX?: number
  keyframes: ShortsKeyframe[]
  /** Band tint on the timeline (List Detect assigns one per list item). */
  color?: string
  /** Locked segments can't be moved/resized (clips behind stay editable). */
  locked?: boolean
  /** Length is fixed: dragging either edge slides the whole band instead of
   *  resizing it, so a run of Shorts keeps exactly the same duration. */
  fixedDur?: boolean
}

// -- Picture moves -------------------------------------------------------------

/** The moves a picture can make (Clip.moves), each worked out by the motion
 *  model (motion/physics.ts): it enters, leaves, walks, dashes, steps closer
 *  or back, hops, turns, and the two it inherits from that model (point, a
 *  pose change) which a picture has no use for and never gets. */
export type MoveKind = 'enter' | 'exit' | 'move' | 'dash' | 'approach' | 'retreat' | 'point' | 'pose' | 'hop' | 'turn'

/** Where an entrance comes from / an exit goes to. */
export type MoveSide = 'left' | 'right' | 'bottom' | 'pop' | 'fade'

export interface MoveAction {
  id: string
  kind: MoveKind
  /** Project seconds the action starts (its wind-up included). */
  time: number
  /** Seconds until the move has covered most of its way — the block's width.
   *  The settle (overshoot, wobble) runs on after it. */
  dur: number
  /** Where the feet land, as frame fractions. Unset = the kind's default. */
  x?: number
  y?: number
  /** Approach/Retreat: size multiplier on whatever the size was before. */
  amount?: number
  /** Enter/Exit only. */
  side?: MoveSide
  /** Turn: which way to face. */
  dir?: 'left' | 'right' | 'up' | 'down'
  /** Pose/Point: which pose to show (unset = the default). */
  poseId?: string
  /** How a pose change is hidden: a fast whip, a short dissolve, or a cut. */
  swap?: 'whip' | 'fade' | 'cut'
}

/** One look of what moves: its image and how it stands in it. */
export interface MoverPose {
  id: string
  assetId: string
  /** Where the body stands inside the image, 0..1 across. */
  ax: number
  /** Extra size and vertical nudge to line this pose up with the others. */
  k?: number
  dy?: number
  /** Which way the drawing faces. Facing the other way mirrors it. */
  faces: 'left' | 'right'
}

/** Everything is 0..1 so the panel can be all sliders. */
export interface MovePhysics {
  /** Heavier: more wind-up, the upper body lags and carries on after a stop. */
  weight: number
  /** Springiness: overshoot and wobble when arriving. 0 = dead stop. */
  bounce: number
  /** Leaning into the movement. */
  lean: number
  /** Squash and stretch on hops, landings and fast moves. */
  squash: number
  /** Bob while travelling. */
  gait: number
  /** Motion blur: shutter length. */
  blur: number
  /** Breathing and a slow sway while standing. */
  idle: number
}

/** What the motion model moves: a picture standing on its feet
 *  (motion/picture-moves.ts builds one for a clip with moves). */
export interface Mover {
  id: string
  poses: MoverPose[]
  /** Pose shown when no action says otherwise. */
  restPoseId: string
  /** Pose the Point action uses. */
  pointPoseId?: string
  /** Where it starts, feet position as frame fractions. */
  x: number
  y: number
  /** Height as a fraction of the frame height. */
  size: number
  /** Start mirrored. */
  flip?: boolean
  physics: MovePhysics
  actions: MoveAction[]
}

// -- Templates (G lane) --------------------------------------------------------

/** Code-built motion graphics. Every one is parametric: its words, numbers,
 *  pictures, colours and timing are data, so it can be restyled or re-timed
 *  without redoing anything by hand. */
export type TemplateKind = 'steps' | 'ranking' | 'versus' | 'stat' | 'timeline' | 'gallery' | 'count' | 'focus' | 'home' | 'map' | 'terminal' | 'quote' | 'bars' | 'pie' | 'line' | 'cutout' | 'compare' | 'checklist' | 'post' | 'poll' | 'cards' | 'chess' | 'news' | 'atlas' | 'chapter' | 'list' | 'words' | 'player' | 'store' | 'boxes'
  | 'domino'

export interface TemplateItem {
  id: string
  /** Main line: a step, a ranked name, a side of the versus, an event. */
  title: string
  /** Second line: detail, a year, a unit. */
  note?: string
  /** A number: score, the left side's stat, the counter's target. */
  value?: number
  /** Versus: the right side's stat. */
  value2?: number
  /** A picture from the project's media. */
  assetId?: string
  /** Box to box: when this box lights up, seconds into the block (unset:
   *  spread by itself). */
  at?: number
}

export interface TemplateStyle {
  /** Highlight colour: numbers, underlines, the active item. */
  accent: string
  /** Text colour. */
  ink: string
  /** Card colour. */
  card: string
  /** Headline font. */
  font: string
  /** Made by hand: a little tilt, tape on the photos, marker strokes and a
   *  12 fps "boil" — the opposite of the glossy generated look. */
  hand: boolean
  /** What sits behind the graphic. */
  backdrop: 'none' | 'dim' | 'blur' | 'paper' | 'card'
}

export interface TemplateBlock {
  id: string
  kind: TemplateKind
  start: number
  duration: number
  /** Headline. */
  title: string
  items: TemplateItem[]
  style: TemplateStyle
  /** Seed for the hand-made jitter ("shuffle" picks a new one). */
  seed: number
  /** Verse / quote: the side its panel comes in from. */
  from?: 'left' | 'right' | 'top'
  /** Map: seconds of each flight to a place, and of its light spreading. */
  travel?: number
  spread?: number
  /** Home screen: which chapter it opens (0-based; by default the next one
   *  after the home screens before it). */
  open?: number
  /** Home screen: 'apps' (a phone's home), 'deck' (cards), 'timeline' (an
   *  editor with the chapters as clips). */
  design?: TemplateDesign
  /** Where the whole template sits: moved (fractions of the frame) and
   *  scaled round the middle — a title kept up top, a chart made small. The
   *  hands follow it there. */
  place?: { x: number; y: number; s: number }
  /** Verse / quote: how big its panel is (1 = the full side panel; less =
   *  a card as tall as its words). */
  size?: number
  /** Chess: the position the game starts from (FEN; unset: the usual start). */
  fen?: string
  /** Chess: the board seen from Black's side. */
  flip?: boolean
  /** Map: the video kept playing in a window at the bottom left while the
   *  map is on (unset: yes on the world map, no on your-camera map). */
  pip?: boolean
  /** Your-camera map: the camera's keyframes (block seconds; centre and
   *  zoom, 1 = the whole world across the frame). */
  cams?: MapKey[]
  /** Your-camera map: the camera flies to each place in turn by itself
   *  (the world map's way) instead of following the keyframes. */
  follow?: boolean
  /** List video: numbered down to one (10, 9 … 1) instead of up. */
  countdown?: boolean
  /** Big words: its own lines (the items) instead of the subtitles. */
  own?: boolean
  /** Big words: leave the subtitles showing under it too. */
  keepSubs?: boolean
  /** Video player: where its clock starts and the video's length, seconds
   *  (unset: the real time in this video, and its real length). */
  clock?: { start?: number; total?: number }
  /** Cut short (Ctrl+B), seconds into the block: from here it leaves (see
   *  `cutExit`). Its pace still comes from the whole length. */
  cut?: number
  /** How a cut template leaves: a hand pushes it down off the frame (the
   *  default), it fades, it slides away, or it is simply gone. */
  cutExit?: 'drop' | 'fade' | 'slide' | 'cut'
  /** Big words: how they are set (each left out is the style's own). */
  big?: WordsLook
  /** Chapter (revolver): how it turns. */
  rev?: RevolverLook
  /** Card deck: dealt face up (no turning over), and the card the hand
   *  picks up at the end and brings close (index; unset: none). */
  deal?: { up?: boolean; pick?: number }
}

/** A revolver chapter, set your way. */
export interface RevolverLook {
  /** How many chapters before it the drum clicks through (0…6; unset 3). */
  past?: number
  /** The pace of the clicks, times the usual (0.5…2). */
  speed?: number
  /** The drum of pictures: on the right (default), on the left, or none. */
  drum?: 'right' | 'left' | 'none'
  /** Chapter numbers as 01 02 (default) or I II. */
  roman?: boolean
  /** A solid click on each turn (on unless off) and how loud. */
  click?: boolean
  clickVol?: number
}

/** Big words, set your way — for a Shorts frame above all. */
export interface WordsLook {
  /** Words to a line (Stack, Apple, Karaoke). */
  per?: number
  /** The accent band behind the newest line / the word being said. */
  band?: boolean
  /** Size, times the style's own. */
  size?: number
  /** How much the other lines show: Stack's older lines up the screen,
   *  Karaoke's words not said yet (0..1). */
  dim?: number
  /** Where the words sit: 0 the top of the frame … 1 its bottom. */
  y?: number
  /** How they meet the picture behind: as they are, blended into it, or
   *  a window — the picture through the words, a veil round them. */
  blend?: 'normal' | 'overlay' | 'soft' | 'difference' | 'window'
  /** A solid click as each line comes up (on unless switched off), and how
   *  loud (0..1, unset 0.7). */
  click?: boolean
  clickVol?: number
}

/** A template cut short takes this long to leave (pushed off by a hand). */
export const CUT_EXIT = 0.6
/** How long a cut template takes to leave — less when its own end comes first. */
export const cutSpan = (b: Pick<TemplateBlock, 'duration' | 'cut' | 'cutExit'>): number =>
  b.cut === undefined ? 0 : b.cutExit === 'cut' ? 0.04 : Math.max(0.05, Math.min(CUT_EXIT, b.duration - b.cut))
/** Where a template is gone from the screen: its end, or its cut's exit done. */
export const templateEnd = (b: Pick<TemplateBlock, 'start' | 'duration' | 'cut' | 'cutExit'>): number =>
  b.start + (b.cut === undefined ? b.duration : b.cut + cutSpan(b))

export interface MapKey {
  t: number
  lon: number
  lat: number
  z: number
}

/** What a work note asks for. */
export type NoteKind = 'fix' | 'animate' | 'cut' | 'free'
export const NOTE_KINDS: NoteKind[] = ['fix', 'animate', 'cut', 'free']

/** Where a work note stands: open → agent (an agent took it) → ready (its
 *  answer is in) → approved, or still (the answer was not enough: it goes
 *  back to the agent with the open ones). */
export type NoteStatus = 'open' | 'agent' | 'ready' | 'approved' | 'still'
export const NOTE_STATUSES: NoteStatus[] = ['open', 'agent', 'ready', 'approved', 'still']

/** One stroke drawn on the frame, in 0..1 frame coordinates (x across, y
 *  down). A rect and an arrow are two points; a pen stroke is its path. */
export interface NoteShape {
  /** `pin`: one point (phase 11b), numbered by its place among the note's pins. */
  type: 'rect' | 'arrow' | 'pen' | 'pin'
  pts: [number, number][]
  color: string
}

/**
 * A work note (SnippStudio OZELLIKLER.md §0): a stretch of the timeline or one
 * frame, what the user wants there, and where the work on it stands. An agent
 * reads the open ones, does them and answers; the user then goes through what
 * changed. Saved with the project.
 */
export interface WorkNote {
  id: string
  /** #1, #2 … as the user and the agent say it. Never reused in a project. */
  num: number
  /** Timeline seconds. `end === start`: one frame. */
  start: number
  end: number
  /** The clip it sits on, and where in that clip's SOURCE its two ends are
   *  (`inPoint + (t - start) * speed`: a code clip's own second). The note
   *  rides the clip through every edit (notes/follow.ts). */
  clip?: { id: string; assetId: string; from: number; to: number }
  /** The frame the drawing is on (timeline seconds), when there is one. */
  at?: number
  shapes?: NoteShape[]
  /** That frame with the drawing on it, as the user saw it: a JPEG data URL.
   *  Set once, when the note is saved. */
  regionImage?: string
  kind: NoteKind
  text: string
  status: NoteStatus
  /** The agent's short answer. */
  reply?: string
  /** The stretches the agent changed for it (timeline seconds): what the
   *  review goes through. Unset: the note's own range. */
  touched?: [number, number][]
  /** The user limited the work on it (KAPSAM-AJAN-PLAN.md §2): while it is
   *  out with the agent, an agent's op that changes anything outside its
   *  stretch (and, with `clips`, any clip but these: their `instanceOf`)
   *  is not applied (agent/scope.ts). Goes with the note. */
  only?: { clips?: string[] }
  /** ISO time it was written. */
  created: string
}

/** A new project identity (Project.uid). */
export function newProjectUid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export interface Project {
  version: 1
  name: string
  /** This project's identity, kept in its file (phase 4A.10, E1): the
   *  agent's point "before the agent" belongs to it, not to a path (a file
   *  saved over another one is another project). Given when a project is
   *  made (New, the project a run starts with) or a file without one is
   *  read; a copy saved elsewhere keeps it. */
  uid?: string
  settings: ProjectSettings
  /** 'canvas' (a free board view with a camera flying over it) was removed —
   *  the camera survives as a range effect. Old projects load fine: the loader
   *  rewrites the value. */
  mode: 'frame' | 'shorts'
  tracks: Track[]
  clips: Record<string, Clip>
  assets: Asset[]
  captions: Caption[]
  captionStyle: CaptionStyle
  /** Saved per project; old projects remain English-only by default. */
  transcription?: { model: WhisperModelChoice; language: WhisperLanguage }
  /** Separate subtitle styling for Shorts exports (undefined = use main). */
  captionStyleShorts?: CaptionStyle
  /** Shorts mode: pan of the vertical crop window across the frame. */
  shorts?: { baseX: number; keyframes: ShortsKeyframe[] }
  /** Marked timeline stretches that export as individual Shorts. */
  shortSegments?: ShortSegment[]
  /** Timeline markers (M key): colored notes on the ruler. */
  markers?: { id: string; time: number; color: string; note: string; label?: string }[]
  /** Work notes (the N lane, the Notes tab): what the user asked for, where. */
  notes?: WorkNote[]
  /** The last note number given out (a deleted note's number is not reused). */
  noteSeq?: number
  /** Clip groups: selecting/moving one member acts on the whole group. */
  groups?: { id: string; clipIds: string[] }[]
  /** Motion trackers (manually keyframed paths media/text can follow). */
  trackers?: Tracker[]
  /** The .cube LUT files the project's clips use ("cila" part D). */
  luts?: ProjectLut[]
  /** Template graphics on the G lane: above the footage. */
  templates?: TemplateBlock[]
  /** Graphics of a kind this build does not know (a newer Snipp's file),
   *  exactly as the file had them: not drawn, written back into `templates`
   *  when the file is saved (phase Ç2a.1, media/projectio.ts). */
  unknownTemplates?: Record<string, unknown>[]
  /** The canvas behind everything (unset: plain black). */
  backdrop?: Backdrop
  /** How loud the transitions' own sounds are, 0..1 (unset: 0.5); a
   *  transition has one only when given it (`sfx`, DENEME-3 V item 2). */
  transitionSfx?: number
  /** A build-up (a riser) into every big moment — a big transition, a
   *  template landing — this loud, 0..1 (unset or 0: none). */
  risers?: number
  /** The camera look over the whole picture: film, a live vignette, bars. */
  cameraLook?: import('./effects/look').CameraLook
  /** The project look (phase 5f, decision 3): an accent colour and a font,
   *  set by the user; unset by default. Code pages may read it
   *  (window.__snippLook); the code templates do, falling back to their own. */
  look?: import('./media/codefilm-params').ProjectLook
  snap: SnapSettings
}

export type BackdropStyle = 'black' | 'velvet' | 'silk' | 'glass' | 'aurora' | 'mesh' | 'grid' | 'dots' | 'studio' | 'paper' | 'blueprint'

/** A designed, slowly moving canvas background. */
export interface Backdrop {
  style: BackdropStyle
  /** Its accent colour (each style has its own default). */
  tint?: string
  /** 0..1: how lively it drifts (default 0.5). */
  motion?: number
}

/** The content a clip is a piece of (see Clip.instance). */
export const instanceOf = (c: Clip): string => c.instance ?? c.id

/** Where new ids come from while a command runs (commands/core.ts): a
 *  batch with a seed makes the same ids every time. Unset: random. */
let idSource: (() => string) | null = null
export const uid = (): string => (idSource ? idSource() : crypto.randomUUID().slice(0, 13))

/** Runs `fn` with new ids taken from `gen` (synchronous only). */
export function withIds<T>(gen: (() => string) | undefined, fn: () => T): T {
  if (!gen) return fn()
  const prev = idSource
  idSource = gen
  try {
    return fn()
  } finally {
    idSource = prev
  }
}

/** Runs `fn` with `id` as the first new id made (then as before). */
export function withFirstId<T>(id: string | undefined, fn: () => T): T {
  if (!id) return fn()
  const prev = idSource
  let used = false
  return withIds(() => {
    if (!used) {
      used = true
      return id
    }
    return prev ? prev() : crypto.randomUUID().slice(0, 13)
  }, fn)
}

export const defaultCaptionStyle = (): CaptionStyle => ({
  fontFamily: 'Arial',
  fontSize: 64,
  fontWeight: 800,
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 6,
  bgColor: '#000000',
  bgOpacity: 0,
  posY: 0.86,
  maxLineChars: 28,
  uppercase: false,
  popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' },
  wordsPerCue: 0,
  pauseThreshold: 0
})

/** Aspect presets a new project can start in. */
export type AspectId = '16:9' | '9:16' | '1:1'

export const ASPECT_SIZES: Record<AspectId, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
}

/** A new project. `uiLang`: the interface language the user makes it in; its
 *  spoken language follows it (phase 9 audit patch D1: a Turkish interface
 *  makes a Turkish project, the Subtitles tab changes it). Without it (the
 *  defaults a loaded file is filled from) the spoken language is "auto",
 *  English for a project of this kind (subtitles/models.ts spokenLanguage). */
export const defaultProject = (aspect: AspectId = '16:9', uiLang?: 'en' | 'tr'): Project => ({
  version: 1,
  name: 'Untitled',
  settings: { ...ASPECT_SIZES[aspect], fps: 60 },
  mode: 'frame',
  tracks: [
    { id: uid(), kind: 'video', name: 'V1', clipIds: [] },
    { id: uid(), kind: 'audio', name: 'A1', clipIds: [] }
  ],
  clips: {},
  assets: [],
  captions: [],
  captionStyle: defaultCaptionStyle(),
  transcription: { model: 'english', language: uiLang === 'tr' ? 'turkish' : 'auto' },
  snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }
})

/** Total project duration = end of the last clip. */
/**
 * A mask's censor strength in asset pixels.
 *
 * `strength` is undefined on projects saved before it was split out of
 * `feather` — those get the old formula, which was frame-relative, so they
 * keep exactly the look they were saved with.
 */
export function maskStrength(mask: ClipMask, assetW: number, assetH: number): number {
  return Math.max(
    1,
    mask.strength ?? Math.max(8, (mask.feather || 20) * (Math.min(assetW, assetH) / 320))
  )
}

/** The keyframes of one property channel (none: undefined). */
export function channelKfs(clip: Clip, ch: KfChannel): PropKeyframe[] | undefined {
  const own = clip.channels?.[ch]
  return own && own.length > 0 ? own : undefined
}

/**
 * Is this caption a transcribed SUBTITLE — the thing Auto captions owns and is
 * allowed to replace?
 *
 * Everything else on the caption list is work the user made by hand: titles,
 * lower thirds, shapes. Transcribing used to swap the whole array, so running
 * Auto captions on a finished edit deleted every one of them. One predicate,
 * used everywhere subtitles are rewritten, so the rule can't drift apart
 * between the three places that need it.
 */
export function isSubtitle(caption: Caption): boolean {
  return !caption.shape && !caption.manual && (caption.layer ?? 0) === 0
}

export function projectDuration(project: Project): number {
  let end = 0
  // A loop over the keys, not Object.values: this runs several times a
  // frame (the transport, the stage) and the array was garbage every time.
  const clips = project.clips
  for (const id in clips) {
    const clip = clips[id]
    end = Math.max(end, clip.start + clip.duration)
  }
  // Captions count too. Without this a project holding nothing but titles has
  // a duration of 0, so pressing play stopped the transport on the same tick
  // and nothing ever moved.
  for (const c of project.captions ?? []) end = Math.max(end, c.end)
  // So do graphics: one that runs on after the last picture used to be cut
  // off — playback stopped and the export ended at the picture.
  for (const t of project.templates ?? []) end = Math.max(end, templateEnd(t))
  return end
}

export function clipsOfTrack(project: Project, track: Track): Clip[] {
  return track.clipIds.map((id) => project.clips[id]).filter(Boolean)
}

const flatScope = new WeakMap<Clip, Clip[]>()
/** A compound child as `flattenClips` gave it: the other children of its
 *  compound (itself included, on the outer clock); undefined for any other
 *  clip. */
export const flatSiblings = (clip: Clip): readonly Clip[] | undefined => flatScope.get(clip)

/**
 * Expands compound clips so their children appear as ordinary clips with
 * absolute timeline start times. Everything that walks the timeline for media
 * — the audio mixer, the preview engine's element sync and the exporter's
 * frame decoding — uses this, so nested content behaves like any other clip.
 * Child ids are preserved, which is what frame lookups key on.
 */
export function flattenClips(clips: Clip[], depth = 0): Clip[] {
  const out: Clip[] = []
  for (const c of clips) {
    if (c.nested && depth < 4) {
      // Flags that belong to the GROUP have to reach its children, or the
      // audio mix (which only ever sees the flattened list) would keep playing
      // a compound clip the user has switched off.
      //
      // Children are also CLIPPED to the compound's own window. The picture
      // already was — the renderer only draws a compound while the compound
      // itself is on screen — but the flattened list is what the audio mix and
      // the engine walk, so trimming a compound left its sound running past
      // the edge you had just trimmed to. A head trim moves the child's in
      // point with it, so what survives is the part you kept, not the part
      // shifted onto it.
      //
      // And children run on the COMPOUND's clock, as the renderer draws them:
      // compound-local time is `c.inPoint + (t - c.start) * c.speed`. The right
      // half of a split compound has an in point; ignoring it restarted the
      // compound's sound (and the elements the picture reads from) from its
      // beginning at the split.
      const parentEnd = c.start + c.duration
      // (Guarded as clipMediaAt guards it.)
      const cSpeed = Math.max(0.01, c.speed ?? 1)
      const cIn = c.inPoint || 0
      const shifted: Clip[] = []
      for (const child of c.nested.clips) {
        const cs = c.start + (child.start - cIn) / cSpeed
        const span = child.duration / cSpeed
        const ce = cs + span
        if (ce <= c.start + 1e-6 || cs >= parentEnd - 1e-6) continue
        const headCut = Math.max(0, c.start - cs)
        const tailCut = Math.max(0, ce - parentEnd)
        const duration = span - headCut - tailCut
        if (duration <= 1e-6) continue
        // Media seconds per timeline second: the child's own speed, times
        // the compound's.
        // (Along a child's speed curve, the part kept has its own average:
        // core polish C, timeline/media-time.ts partOf.)
        const part = child.speedCurve && (headCut > 0 || tailCut > 0) ? partOf(child, headCut * cSpeed, (headCut + duration) * cSpeed) : null
        const speed = (part?.speed ?? child.speed ?? 1) * cSpeed
        shifted.push({
          ...child,
          start: cs + headCut,
          duration,
          ...(child.speed !== undefined || cSpeed !== 1 || part ? { speed } : {}),
          inPoint: part ? part.inPoint : child.inPoint + headCut * speed,
          disabled: child.disabled || c.disabled,
          // A transition between children is timed on the compound's clock:
          // in timeline seconds it lasts that much less at a faster compound.
          ...(cSpeed !== 1 && child.transitionOut ? { transitionOut: { ...child.transitionOut, duration: child.transitionOut.duration / cSpeed } } : {})
        })
      }
      // Each child knows its siblings: the transitions between them are timed
      // against them, not against the outer tracks (Ç2b patch, item 5;
      // playback/draw/timing.ts scopeOf).
      for (const s of shifted) flatScope.set(s, shifted)
      out.push(...flattenClips(shifted, depth + 1))
    } else if (!c.nested) {
      out.push(c)
    }
  }
  return out
}

/**
 * Whether a track's audio should be heard. Solo wins over everything: as soon
 * as ANY track is soloed, the non-soloed ones fall silent. Preview and export
 * both call this so they can never disagree.
 */
export function trackAudible(project: Project, track: Track): boolean {
  if (track.muted) return false
  const anySolo = project.tracks.some((t) => t.solo)
  return !anySolo || !!track.solo
}

/** A track's clips with compound clips expanded (see `flattenClips`). */
export function flatClipsOfTrack(project: Project, track: Track): Clip[] {
  return flattenClips(clipsOfTrack(project, track))
}

export function assetById(project: Project, id: string): Asset | undefined {
  return project.assets.find((a) => a.id === id)
}
/** A template's look, for the kinds that have more than one: the home
 *  screen's, and the typing template's screen. */
export type TemplateDesign = 'apps' | 'deck' | 'timeline' | 'slider' | 'terminal' | 'browser' | 'chat' | 'notes' | 'search' | 'tour' | 'turkey' | 'territory' | 'quote' | 'verse' | 'apple' | 'stack' | 'punch' | 'karaoke' | 'scope' | 'reel' | 'hub' | 'flow' | 'chain' | 'revolver'
export const TEMPLATE_DESIGNS: readonly TemplateDesign[] = ['apps', 'deck', 'timeline', 'slider', 'terminal', 'browser', 'chat', 'notes', 'search', 'tour', 'turkey', 'territory', 'quote', 'verse', 'apple', 'stack', 'punch', 'karaoke', 'scope', 'reel', 'hub', 'flow', 'chain', 'revolver']
