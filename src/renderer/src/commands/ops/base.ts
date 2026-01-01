// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Pure timeline helpers shared by the commands and the store (moved out of
// state/store.ts in SnippStudio phase 2A, unchanged): find, sort, pack, free
// rows, forget deleted clips.
import type { Asset, Clip, Project, ShortsKeyframe, Track } from '../../types'
import { uid } from '../../types'
import { nearestFreeStart } from '../../timeline/placement'
import { carryPartners, startsOf } from './links'

/** A new track's name: one more than the highest number its kind has
 *  (phase Ç2b.1, report L10: V1, V2, V3, delete V2, add → V3 twice). */
export function nextTrackName(project: Project, kind: Track['kind']): string {
  const letter = kind === 'video' ? 'V' : 'A'
  const top = Math.max(0, ...project.tracks.filter((t) => t.kind === kind).map((t) => {
    const m = new RegExp(`^${letter}(\\d+)$`).exec(t.name.trim())
    return m ? Number(m[1]) : 0
  }), project.tracks.filter((t) => t.kind === kind).length)
  return `${letter}${top + 1}`
}

export function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId)
}

/**
 * A track of `kind` with nothing between `start` and `end`: the clip's own
 * track if it is free there, otherwise the next one up, otherwise a new one.
 * Video tracks are stored top-first, so "up" means towards index 0.
 */
export function freeTrackAt(
  project: Project,
  kind: Track['kind'],
  home: Track | null,
  start: number,
  end: number
): Track {
  const eps = 1e-4
  const free = (t: Track): boolean =>
    !t.locked &&
    // A hidden lane draws nothing and a muted one plays nothing, so landing a
    // paste in either looks exactly like the paste having failed.
    !t.hidden &&
    !t.muted &&
    t.clipIds.every((id) => {
      const c = project.clips[id]
      return !c || c.start + c.duration <= start + eps || c.start >= end - eps
    })
  const sameKind = project.tracks.filter((t) => t.kind === kind)
  // Video tracks are stored top-first; audio stacks the other way. Reversing
  // audio means "towards index 0" is away from the picture for both.
  const order = kind === 'video' ? sameKind : [...sameKind].reverse()
  const from = Math.max(0, home ? order.indexOf(home) : 0)
  // The clip's own lane first, then outward in the preferred direction, then
  // everything else — so an empty lane is always reused before a new track is
  // made. Searching only one direction meant a paste from the outermost lane
  // added a track while an empty one sat right beside it.
  for (const t of [...order.slice(0, from + 1).reverse(), ...order.slice(from + 1)]) {
    if (free(t)) return t
  }
  // Everything from the clip's own lane upward is busy: give it a new one.
  const track: Track = { id: uid(), kind, name: nextTrackName(project, kind), clipIds: [] }
  if (kind === 'video') project.tracks.unshift(track)
  else project.tracks.push(track)
  return track
}

/** Keeps a track's clipIds sorted by clip start time. */
export function sortTrack(project: Project, track: Track): void {
  track.clipIds.sort((a, b) => (project.clips[a]?.start ?? 0) - (project.clips[b]?.start ?? 0))
}

export function clone<T>(v: T): T {
  return structuredClone(v)
}

/**
 * Where shorts-pan edits at `time` should land: the segment containing the
 * playhead (so each Short remembers its own crop), else the global pan.
 */
export function panTarget(p: Project, time: number): { baseX?: number; keyframes: ShortsKeyframe[] } {
  const seg = p.shortSegments?.find((s) => time >= s.start && time <= s.end)
  if (seg) return seg
  p.shorts = p.shorts ?? { baseX: p.settings.width / 2, keyframes: [] }
  return p.shorts
}

/** True for the original V1 — the last video track in the array. */
export function isMainVideoTrack(p: Project, track: Track): boolean {
  if (track.kind !== 'video') return false
  const videoTracks = p.tracks.filter((t) => t.kind === 'video')
  return videoTracks[videoTracks.length - 1]?.id === track.id
}

/**
 * Packs one track's clips back-to-back. On the main video track the run also
 * snaps to 0 so the first clip sits at the very start of the video; overlay
 * and audio tracks keep their first clip where the user put it.
 */
export function packTrackIn(p: Project, track: Track): void {
  const clips = track.clipIds
    .map((id) => p.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
  if (clips.length === 0) return
  let cursor = isMainVideoTrack(p, track) ? 0 : clips[0].start
  for (const clip of clips) {
    clip.start = cursor
    cursor += clip.duration
  }
  sortTrack(p, track)
}

/** Enforces auto-pack on every track that has it switched on; a clip the
 *  packing moves takes its linked partner along (phase Ç2b.1, P11). */
/**
 * The magnet pressed (the track header's, and track.setMagnet on): the whole
 * track gathered hard at 0, whatever kind it is, each clip against the one
 * before; what moved takes its linked partner along (P11). A locked track
 * stays as it is. (Body as it was in the store's packTrack.)
 */
export function gatherTrack(p: Project, track: Track): void {
  if (track.locked) return
  const clips = track.clipIds
    .map((id) => p.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
  const before = startsOf(p)
  let cursor = 0
  for (const clip of clips) {
    clip.start = cursor
    cursor += clip.duration
  }
  sortTrack(p, track)
  carryPartners(p, before)
}

export function applyAutoPack(p: Project): void {
  if (!p.tracks.some((t) => t.autoPack && !t.locked)) return
  const before = startsOf(p)
  for (const track of p.tracks) {
    if (track.autoPack && !track.locked) packTrackIn(p, track)
  }
  carryPartners(p, before)
}

/**
 * Removes every trace of deleted clips from the project. Deleting used to drop
 * the clip and stop there, leaving its id inside any group it belonged to — so
 * groups slowly filled with references to clips that no longer existed, and a
 * group whose members were all deleted stayed in the file for ever.
 */
/** A link joins two clips or more: one a removal (or a compound) left alone
 *  is linked to nothing, and lets go of it (phase Ç2a.1, model/check.ts
 *  'link-alone'). Clips in `gone` are counted as removed already. */
export function dropLoneLinks(p: Project, gone: ReadonlySet<string> = new Set()): void {
  const links = new Map<string, Clip[]>()
  for (const c of Object.values(p.clips)) if (c.linkId && !gone.has(c.id)) links.set(c.linkId, [...(links.get(c.linkId) ?? []), c])
  for (const list of links.values()) if (list.length === 1) delete list[0].linkId
}

export function forgetClips(p: Project, ids: Iterable<string>): void {
  const gone = new Set(ids)
  dropLoneLinks(p, gone)
  if (!p.groups) return
  p.groups = p.groups
    .map((g) => ({ ...g, clipIds: g.clipIds.filter((id) => !gone.has(id)) }))
    // A group needs at least two members to mean anything.
    .filter((g) => g.clipIds.length > 1)
  if (p.groups.length === 0) delete p.groups
}

/** Walks a track left→right pushing clips right so none overlap. */
export function cascadeTrack(p: Project, track: Track): void {
  const clips = track.clipIds
    .map((id) => p.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const clip of clips) {
    if (clip.start < cursor - 1e-6) clip.start = cursor
    cursor = Math.max(cursor, clip.start) + clip.duration
  }
  sortTrack(p, track)
}

/** Place a new/relocated clip without moving established clips when auto-pack is off. */
export function settleClipOnTrack(p: Project, track: Track, clip: Clip): void {
  if (track.autoPack) {
    sortTrack(p, track)
    cascadeTrack(p, track)
    applyAutoPack(p)
    return
  }
  const occupied = track.clipIds
    .filter((id) => id !== clip.id)
    .map((id) => p.clips[id])
    .filter(Boolean)
    .map((other) => ({ start: other.start, duration: other.duration }))
  clip.start = nearestFreeStart(clip.start, clip.duration, occupied)
  sortTrack(p, track)
}

/** Scale that fits the whole asset inside the frame (letterboxed if needed). */
export function containScale(p: Project, asset: { kind: string; width: number; height: number }): number {
  if (asset.kind === 'audio') return 1
  const { width, height } = p.settings
  return Math.min(width / Math.max(1, asset.width), height / Math.max(1, asset.height))
}

/** The assets of `assets` the project does not have yet: not the same file
 *  (path and kind) and not the same id, and each file once. */
export function newAssetsOf(project: Project, assets: readonly Asset[]): Asset[] {
  const out: Asset[] = []
  for (const a of assets) {
    const held = [...project.assets, ...out]
    if (held.some((x) => x.id === a.id)) continue
    if (a.path && held.some((x) => x.path === a.path && x.kind === a.kind)) continue
    out.push(a)
  }
  return out
}

/** Is the asset used by a clip inside a compound clip (at any depth)? Such
 *  an asset is not deleted (phase Ç2a.1, report P16): the compound would
 *  keep a child of media that no longer exists. */
export function assetInCompound(p: Project, assetId: string): boolean {
  const inside = (list: Clip[]): boolean => list.some((c) => c.assetId === assetId || (!!c.nested && inside(c.nested.clips)))
  return Object.values(p.clips).some((c) => !!c.nested && inside(c.nested.clips))
}
