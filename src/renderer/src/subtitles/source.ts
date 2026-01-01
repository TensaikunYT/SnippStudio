// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the subtitles are made from (REF-AB, worker S, item 10; REF-AB-PLAN-S.md):
// all the sound of the timeline (as it always was), one track, or one clip.
// The speech model hears a copy of the project in which everything else is
// silent; for a track or a clip only its own stretch is mixed. What the user
// is told about muted, soloed-out and hidden tracks is worked out here too.
// Pure: the tests read it.
import { assetById, trackAudible, type Clip, type Project, type Track } from '../types'

export type CaptionSource = { kind: 'all' } | { kind: 'track'; trackId: string } | { kind: 'clip'; clipId: string }

export const ALL_SOUND: CaptionSource = { kind: 'all' }

/** Is it a source at all (a click event handed over by mistake is not). */
export function isCaptionSource(v: unknown): v is CaptionSource {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (o.kind === 'all') return true
  if (o.kind === 'track') return typeof o.trackId === 'string'
  if (o.kind === 'clip') return typeof o.clipId === 'string'
  return false
}

/** A clip that gives sound to the mix when its track is heard (the export's
 *  own rule: export/audio.ts mixSpan). Compound clips are left to their track. */
export function clipGivesSound(project: Project, clip: Clip): boolean {
  if (clip.nested) return false
  const a = assetById(project, clip.assetId)
  const silent = clip.muted || (clip.volume <= 0 && !(clip.volumeKeyframes && clip.volumeKeyframes.length > 0))
  return !!a && !a.missing && a.hasAudio && !silent && !clip.audioExtracted && clip.freeze === undefined && !clip.reversed && !clip.disabled
}

/** A clip that holds sound at all (muted or not): what may be chosen. */
function clipHoldsSound(project: Project, clip: Clip): boolean {
  if (clip.nested) return false
  const a = assetById(project, clip.assetId)
  return !!a && !a.missing && a.hasAudio && !clip.audioExtracted
}

const clipsOf = (project: Project, track: Track): Clip[] => track.clipIds.map((id) => project.clips[id]).filter((c): c is Clip => !!c)

/** Tracks with a clip that holds sound (a compound counts: its children may). */
function soundTracks(project: Project): Track[] {
  return project.tracks.filter((t) => clipsOf(project, t).some((c) => c.nested || clipHoldsSound(project, c)))
}

export interface SourceChoice {
  value: string
  source: CaptionSource
  /** The track's name, or the clip's (with its track and start). */
  track?: Track
  clip?: Clip
  name?: string
}

/** The value a source has in the select. */
export function sourceValue(s: CaptionSource): string {
  return s.kind === 'all' ? 'all' : s.kind === 'track' ? `track:${s.trackId}` : `clip:${s.clipId}`
}

/** What can be chosen: all the sound, each track with sound, each clip with sound. */
export function sourceChoices(project: Project): SourceChoice[] {
  const out: SourceChoice[] = [{ value: 'all', source: ALL_SOUND }]
  const tracks = soundTracks(project)
  for (const track of tracks) out.push({ value: `track:${track.id}`, source: { kind: 'track', trackId: track.id }, track })
  for (const track of tracks) {
    for (const clip of clipsOf(project, track).sort((a, b) => a.start - b.start)) {
      if (!clipHoldsSound(project, clip)) continue
      out.push({ value: `clip:${clip.id}`, source: { kind: 'clip', clipId: clip.id }, track, clip, name: assetById(project, clip.assetId)?.name ?? '' })
    }
  }
  return out
}

/** The source as it can be used now: a track or clip gone (deleted) is all the sound. */
export function liveSource(project: Project, s: CaptionSource): CaptionSource {
  if (s.kind === 'track') return project.tracks.some((t) => t.id === s.trackId) ? s : ALL_SOUND
  if (s.kind === 'clip') return project.clips[s.clipId] ? s : ALL_SOUND
  return ALL_SOUND
}

export interface SourceProject {
  /** The project the speech model hears. */
  project: Project
  /** Only this stretch is mixed (timeline seconds); null: the whole timeline. */
  span: [number, number] | null
}

/**
 * The project as the model should hear it from `source`: for a track, every
 * other track muted; for a clip, also the other clips of its track. Solo is a
 * listening aid and is taken off for a track or clip (the chosen one is what
 * is wanted); the chosen track's own mute is kept (a muted track gives no
 * sound, and the page says so). Returns the project itself for all the sound.
 */
export function sourceProject(project: Project, source: CaptionSource): SourceProject {
  const s = liveSource(project, source)
  if (s.kind === 'all') return { project, span: null }
  const p: Project = { ...project, tracks: project.tracks.map((t) => ({ ...t })), clips: { ...project.clips } }
  const keepTrack = s.kind === 'track' ? s.trackId : project.clips[s.clipId].trackId
  for (const t of p.tracks) {
    delete t.solo
    if (t.id !== keepTrack) t.muted = true
  }
  let span: [number, number] | null = null
  if (s.kind === 'clip') {
    const track = p.tracks.find((t) => t.id === keepTrack)
    for (const id of track?.clipIds ?? []) {
      const c = p.clips[id]
      if (c && id !== s.clipId) p.clips[id] = { ...c, muted: true }
    }
    const c = project.clips[s.clipId]
    span = [c.start, c.start + c.duration]
  } else {
    const track = p.tracks.find((t) => t.id === keepTrack)!
    const clips = clipsOf(p, track).filter((c) => c.nested || clipGivesSound(p, c))
    if (clips.length) span = [Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.duration))]
  }
  return { project: p, span }
}

export interface SourceWarnings {
  /** Tracks with sound that are muted (by their own switch). */
  muted: string[]
  /** Tracks with sound kept silent by another track's solo. */
  soloedOut: string[]
  /** Hidden tracks with sound: their picture is hidden, their sound is heard. */
  hidden: string[]
  /** Nothing in the chosen source is heard: the model would get silence. */
  silent: boolean
}

/** What to tell the user about the source before making the subtitles. */
export function sourceWarnings(project: Project, source: CaptionSource): SourceWarnings {
  const s = liveSource(project, source)
  const tracks = soundTracks(project)
  const inSource = (t: Track): boolean => s.kind === 'all' || (s.kind === 'track' ? t.id === s.trackId : t.id === project.clips[s.clipId]?.trackId)
  const muted = tracks.filter((t) => t.muted && inSource(t)).map((t) => t.name)
  const soloedOut = s.kind === 'all' ? tracks.filter((t) => !t.muted && !trackAudible(project, t)).map((t) => t.name) : []
  const hidden = tracks.filter((t) => t.hidden && !t.muted && inSource(t)).map((t) => t.name)
  const heard = sourceProject(project, s).project
  let silent = true
  for (const t of heard.tracks) {
    if (!trackAudible(heard, t)) continue
    for (const c of clipsOf(heard, t)) {
      if (c.nested || clipGivesSound(heard, c)) {
        silent = false
        break
      }
    }
    if (!silent) break
  }
  return { muted, soloedOut, hidden, silent }
}
