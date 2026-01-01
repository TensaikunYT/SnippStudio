// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Media onto the timeline, retiming, a code film's sound (moved out of
// state/store.ts in phase 2A, unchanged).
import type { Asset, Clip, Project, SpeedCurve, Track } from '../../types'
import { uid } from '../../types'
import { NEW_AUDIO_TRACK, NEW_VIDEO_TRACK, planMediaDrop, type MediaDropItem } from '../../timeline/placement'
import { applyAutoPack, cascadeTrack, containScale, findTrack, freeTrackAt, nextTrackName, sortTrack } from './base'
import { automationOf, remapClipAutomation } from '../../timeline/slice'
import { minClipLength } from '../../timeline/speed'
import { localAtMedia, mediaAtLocal, takePart } from '../../timeline/media-time'

/**
 * A clip at a new speed, the same media range on screen (its timeline length
 * rescaled, its keys with it). Its neighbours: on a packed track the track is
 * packed again; on a loose one a clip that was butt-joined to the next one
 * moves everything after it along (the cut and its transition stay), and one
 * that was not stops at the next clip instead of running over it.
 *
 * `curve` (core polish C): undefined leaves the clip's speed curve as it is;
 * null takes it away (one speed from then on); a curve puts that one on —
 * `s` is then the average it gives the window (timeline/speed-curve.ts
 * curveDuration). With a curve before or after, the keys stay on their
 * frames through the media, not by the speed ratio.
 */
export function retimeClip(p: Project, clip: Clip, s: number, curve?: SpeedCurve | null): void {
  const old = clip.speed ?? 1
  const recurve = curve !== undefined && (curve !== null || !!clip.speedCurve)
  if (!recurve && Math.abs(old - s) < 1e-9) return
  const was: Pick<Clip, 'inPoint' | 'duration' | 'speed' | 'reversed' | 'freeze' | 'speedCurve'> = { inPoint: clip.inPoint, duration: clip.duration, speed: clip.speed, reversed: clip.reversed, freeze: clip.freeze, speedCurve: clip.speedCurve }
  if (curve) clip.speedCurve = curve
  else if (curve === null) delete clip.speedCurve
  const track = findTrack(p, clip.trackId)
  const oldEnd = clip.start + clip.duration
  const later = track
    // (After it: a clip shorter than the 0.06 s join allowance — 100x — had
    // the clip BEFORE it within the allowance too, and pushed it over its
    // neighbours; audit patch yama-c, found by the oracle's wild kind.)
    ? track.clipIds.map((id) => p.clips[id]).filter((c): c is Clip => !!c && c.id !== clip.id && c.start >= oldEnd - 0.06 && c.start > clip.start + 1e-9)
    : []
  const next = later.reduce<Clip | null>((m, c) => (!m || c.start < m.start ? c : m), null)
  const joined = !!next && Math.abs(next.start - oldEnd) < 0.06
  // Keep the same media range on screen: rescale the timeline duration.
  const mediaLen = clip.duration * old
  clip.speed = s
  const before = clip.duration
  // Never shorter than one frame of the film. (It was 0.1 s with the speed
  // written as asked: a short clip sped up then showed MORE media than
  // before, past its file's end at worst. The caller holds the speed where
  // one frame is reached — clip.setSpeed, timeline/speed.ts fastestFor — so
  // this floor only catches rounding.)
  const least = minClipLength(p.settings.fps)
  let duration = Math.max(least, mediaLen / s)
  const room = track && !track.autoPack && next && !joined ? Math.max(least, next.start - clip.start) : Infinity
  if (clip.speedCurve && duration > room) {
    // Along a curve the part that fits keeps the curve's speeds (its own
    // average), not the whole window squeezed in.
    clip.duration = duration
    takePart(clip, clip, 0, room)
    duration = room
  } else duration = Math.min(duration, room)
  clip.duration = duration
  if (was.speedCurve || clip.speedCurve) {
    // Each key stays on the frame it was put on, through the media.
    remapClipAutomation(clip, (t) => localAtMedia(clip, mediaAtLocal(was, t)), automationOf(clip), { moves: false })
  } else {
    // ...and its keys with the media, so a keyframe stays on the frame it was
    // put on rather than on the second it was put at: by the speed ratio
    // (phase Ç2c.1, decision 4; report K6: by the length ratio, a length held
    // by the next clip put every key on another frame). A backwards clip's
    // frames are counted from its end.
    const ratio = old / s
    const map = clip.reversed && clip.freeze === undefined ? (t: number) => duration - (before - t) * ratio : (t: number) => t * ratio
    remapClipAutomation(clip, map, automationOf(clip), { moves: false })
  }
  if (!track) return
  if (track.autoPack) cascadeTrack(p, track)
  else if (joined) {
    const delta = clip.start + clip.duration - oldEnd
    for (const c of later) c.start = Math.max(0, c.start + delta)
    sortTrack(p, track)
  }
}

/**
 * Lays dropped media on the timeline where the drop plan says
 * (`planMediaDrop`: at the pointer's time, on the row under it or the nearest
 * free one, else a new row; nothing already there moves). Returns the new
 * clips' ids. Missing or unknown assets are left out.
 */
export function applyMediaDrop(
  p: Project,
  assetIds: readonly string[],
  start: number,
  hoveredTrackId: string | null,
  newTrack: 'video' | 'audio' | null
): string[] {
  const assets = assetIds
    .map((id) => p.assets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a && !a.missing)
  const items: MediaDropItem[] = assets.map((asset) => ({
    assetId: asset.id,
    kind: asset.kind === 'audio' ? 'audio' : 'video',
    duration: asset.kind === 'image' ? 4 : asset.duration
  }))
  const plan = planMediaDrop(p, items, start, hoveredTrackId, newTrack)
  if (!plan) return []
  const made: Partial<Record<string, Track>> = {}
  for (const kind of plan.newTracks) {
    const track: Track = { id: uid(), kind, name: nextTrackName(p, kind), clipIds: [] }
    if (kind === 'video') p.tracks.unshift(track)
    else p.tracks.push(track)
    made[kind === 'video' ? NEW_VIDEO_TRACK : NEW_AUDIO_TRACK] = track
  }
  const { width, height } = p.settings
  const ids: string[] = []
  const touched = new Set<Track>()
  plan.placements.forEach((place, i) => {
    const asset = assets[i]
    const track = made[place.trackId] ?? findTrack(p, place.trackId)
    if (!track) return
    const clip: Clip = {
      id: uid(),
      assetId: asset.id,
      trackId: track.id,
      // A packed row orders its run by start and packs it: the drop's own
      // time goes in, the packed one comes out (as the plan has it).
      start: Math.max(0, track.autoPack ? plan.wanted[i] : place.start),
      inPoint: 0,
      duration: items[i].duration,
      transform: { x: width / 2, y: height / 2, scale: containScale(p, asset), rotation: 0 },
      volume: 1
    }
    p.clips[clip.id] = clip
    track.clipIds.push(clip.id)
    touched.add(track)
    ids.push(clip.id)
  })
  // A packed row takes the whole drop into its run at once, as the plan has it.
  for (const track of touched) {
    sortTrack(p, track)
    if (track.autoPack) {
      cascadeTrack(p, track)
      applyAutoPack(p)
    }
  }
  // A code film brings its sound under it, linked.
  for (const id of ids) attachCodeFilmSound(p, id)
  return ids
}

/** A code film's sound: its audio/mix.wav asset, when the project has it. */
export function codeFilmMix(p: Project, asset: Asset | undefined): Asset | undefined {
  if (!asset || asset.kind !== 'code') return undefined
  const id = asset.code?.mixAssetId
  const byId = id ? p.assets.find((a) => a.id === id && a.kind === 'audio') : undefined
  if (byId) return byId
  // (Either separator: the folder's path is Windows' or macOS / Linux's; phase 10a, P6.)
  const slash = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
  const want = asset.path ? `${slash(asset.path).replace(/\/+$/, '')}/audio/mix.wav` : ''
  return want ? p.assets.find((a) => a.kind === 'audio' && !!a.path && slash(a.path) === want) : undefined
}

/** A code film clip's sound laid under it: the same start, in-point, length
 *  and speed, one link (the shape Extract Audio makes), on an audio row free
 *  there (a new one if none is). */
export function attachCodeFilmSound(p: Project, clipId: string): void {
  const clip = p.clips[clipId]
  const asset = clip ? p.assets.find((a) => a.id === clip.assetId) : undefined
  const mix = clip ? codeFilmMix(p, asset) : undefined
  if (!clip || !mix || mix.missing) return
  const track = freeTrackAt(p, 'audio', null, clip.start, clip.start + clip.duration)
  const linkId = clip.linkId ?? uid()
  const sound: Clip = {
    id: uid(),
    assetId: mix.id,
    trackId: track.id,
    start: clip.start,
    inPoint: clip.inPoint,
    duration: clip.duration,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    volume: 1,
    linkId,
    ...(clip.speed !== undefined ? { speed: clip.speed } : {})
  }
  p.clips[sound.id] = sound
  track.clipIds.push(sound.id)
  sortTrack(p, track)
  clip.linkId = linkId
}

export function appendAssetToTimeline(p: Project, assetId: string, trackId?: string): void {
  const asset = p.assets.find((a) => a.id === assetId)
  if (!asset || asset.missing) return
  const kind = asset.kind === 'audio' ? 'audio' : 'video'
  const track = (trackId && findTrack(p, trackId)) || p.tracks.find((t) => t.kind === kind)
  if (!track || track.kind !== kind) return
  const clips = track.clipIds.map((id) => p.clips[id]).filter(Boolean)
  const end = clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const { width, height } = p.settings
  const clip: Clip = {
    id: uid(),
    assetId,
    trackId: track.id,
    start: end,
    inPoint: 0,
    duration: asset.kind === 'image' ? 4 : asset.duration,
    transform: { x: width / 2, y: height / 2, scale: containScale(p, asset), rotation: 0 },
    volume: 1
  }
  p.clips[clip.id] = clip
  track.clipIds.push(clip.id)
  attachCodeFilmSound(p, clip.id)
}
