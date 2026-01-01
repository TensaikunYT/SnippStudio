// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Project, Track } from '../types'
import { EPS, KEY_EPS } from './eps'

export const NEW_VIDEO_TRACK = '__timeline_new_video__'
export const NEW_AUDIO_TRACK = '__timeline_new_audio__'

export interface TimelinePlacement {
  positions: Record<string, { start: number; trackId: string }>
  trackClipIds: Record<string, string[]>
  movedIds: string[]
  anchorStart: number
  anchorTrackId: string
  newTrack: 'video' | 'audio' | null
  changed: boolean
}

interface TimeRange { start: number; duration: number }

/** Nearest space on a non-packed track; clips already there never move. */
export function nearestFreeStart(wanted: number, duration: number, occupied: readonly TimeRange[]): number {
  const sorted = [...occupied].sort((a, b) => a.start - b.start)
  let edge = 0
  let best = Math.max(0, wanted)
  let distance = Infinity
  for (const item of [...sorted, { start: Infinity, duration: 0 }]) {
    const lastStart = item.start - duration
    if (lastStart >= edge - EPS) {
      const candidate = Math.max(edge, Math.min(wanted, lastStart))
      const delta = Math.abs(candidate - wanted)
      if (delta < distance - EPS || (Math.abs(delta - distance) <= EPS && candidate > best)) {
        best = candidate
        distance = delta
      }
    }
    edge = Math.max(edge, item.start + item.duration)
  }
  return best
}

/** One piece of media dropped on the timeline (from the media bin or the
 *  file manager): what it is and how long its clip will be. */
export interface MediaDropItem {
  assetId: string
  kind: 'video' | 'audio'
  duration: number
}

export interface MediaDropPlan {
  /** Each item's clip: where it starts and on which track (a NEW_* id is a
   *  track the drop makes, one per kind at most). */
  placements: { assetId: string; start: number; trackId: string }[]
  /** The kinds of the tracks the drop makes. */
  newTracks: ('video' | 'audio')[]
  /** Each item's start before an auto-packed row packs it: the order it
   *  takes in that row's run. */
  wanted: number[]
  /** Where the first item lands: what the drop indicator shows. */
  anchorStart: number
  anchorTrackId: string
}

/** Where a clip whose `wanted` start is given lands on an auto-packed track:
 *  the clips there keep their order by start and close up behind each other
 *  (from 0 on the main video track, else from the first clip's start). */
function packedStarts(
  project: Project,
  track: Track,
  incoming: readonly { start: number; duration: number }[],
  isMain: boolean
): number[] {
  const rows = [
    ...track.clipIds
      .map((id) => project.clips[id])
      .filter(Boolean)
      .map((clip) => ({ start: clip.start, duration: clip.duration, index: -1 })),
    ...incoming.map((item, index) => ({ ...item, index }))
  ]
  // Stable: a new clip at the same start as an old one goes after it, as the
  // store's sort (the new clip pushed last) does.
  rows.sort((a, b) => a.start - b.start)
  const out: number[] = []
  let cursor = isMain ? 0 : rows[0]?.start ?? 0
  for (const row of rows) {
    if (row.index >= 0) out[row.index] = cursor
    cursor += row.duration
  }
  return out
}

/**
 * Where a drop of media lands. Exactly at the pointer's time (the caller
 * snaps it first), on the row under the pointer when that row is the right
 * kind, not locked, and free for the clips' whole length. Otherwise on the
 * nearest free row of that kind (the paste rule: outward from that row, past
 * hidden, muted and locked rows), otherwise on a new row. Clips already on the
 * timeline never move to make room. An auto-packed row under the pointer takes
 * the clip into its run where it was dropped (a packed row has no free time),
 * so there the time is the run's.
 *
 * Several items are laid back to back from `start`; each kind keeps to one row.
 * `newTrack`: the drop was on that kind's "+" strip, so its items get a new row.
 * Pure: the drop indicator while dragging and the edit on release use it.
 */
export function planMediaDrop(
  project: Project,
  items: readonly MediaDropItem[],
  start: number,
  hoveredTrackId: string | null,
  newTrack: 'video' | 'audio' | null
): MediaDropPlan | null {
  if (items.length === 0) return null
  const eps = KEY_EPS
  const spans: { start: number; duration: number }[] = []
  let cursor = Math.max(0, start)
  for (const item of items) {
    const duration = Math.max(0.01, Number.isFinite(item.duration) ? item.duration : 0)
    spans.push({ start: cursor, duration })
    cursor += duration
  }
  const hovered = hoveredTrackId ? project.tracks.find((track) => track.id === hoveredTrackId) : undefined
  const videoTracks = project.tracks.filter((track) => track.kind === 'video')
  const mainVideoId = videoTracks.at(-1)?.id
  const laneFor: Partial<Record<'video' | 'audio', { trackId: string; packed: boolean }>> = {}
  const newTracks: ('video' | 'audio')[] = []
  for (const kind of ['video', 'audio'] as const) {
    const mine = items.map((item, index) => ({ item, index })).filter(({ item }) => item.kind === kind)
    if (mine.length === 0) continue
    if (newTrack === kind) {
      laneFor[kind] = { trackId: kind === 'video' ? NEW_VIDEO_TRACK : NEW_AUDIO_TRACK, packed: false }
      newTracks.push(kind)
      continue
    }
    const sameKind = project.tracks.filter((track) => track.kind === kind)
    const home = hovered && hovered.kind === kind ? hovered : sameKind[0]
    if (home && !home.locked && home.autoPack) {
      laneFor[kind] = { trackId: home.id, packed: true }
      continue
    }
    const free = (track: Track): boolean =>
      mine.every(({ index }) => {
        const a = spans[index].start
        const b = a + spans[index].duration
        return track.clipIds.every((id) => {
          const clip = project.clips[id]
          return !clip || clip.start + clip.duration <= a + eps || clip.start >= b - eps
        })
      })
    // Video tracks are stored top-first, audio the other way: reversing audio
    // makes "towards index 0" away from the picture for both.
    const order = kind === 'video' ? sameKind : [...sameKind].reverse()
    const from = Math.max(0, home ? order.indexOf(home) : 0)
    const search = [...order.slice(0, from + 1).reverse(), ...order.slice(from + 1)]
    const lane = search.find((track) =>
      track === home
        ? !track.locked && free(track)
        // Somewhere else only where it shows and plays: landing on a hidden
        // or muted row looks exactly like the drop having failed.
        : !track.locked && !track.hidden && !track.muted && !track.autoPack && free(track)
    )
    if (lane) laneFor[kind] = { trackId: lane.id, packed: false }
    else {
      laneFor[kind] = { trackId: kind === 'video' ? NEW_VIDEO_TRACK : NEW_AUDIO_TRACK, packed: false }
      newTracks.push(kind)
    }
  }
  const starts = spans.map((span) => span.start)
  for (const kind of ['video', 'audio'] as const) {
    const lane = laneFor[kind]
    if (!lane?.packed) continue
    const track = project.tracks.find((candidate) => candidate.id === lane.trackId)!
    const indices = items.map((item, index) => (item.kind === kind ? index : -1)).filter((index) => index >= 0)
    const packed = packedStarts(project, track, indices.map((index) => spans[index]), track.id === mainVideoId)
    indices.forEach((index, i) => (starts[index] = packed[i]))
  }
  const placements = items.map((item, index) => ({
    assetId: item.assetId,
    start: starts[index],
    trackId: laneFor[item.kind]!.trackId
  }))
  return {
    placements,
    newTracks,
    wanted: spans.map((span) => span.start),
    anchorStart: placements[0].start,
    anchorTrackId: placements[0].trackId
  }
}

/** How a moved clip finds its place among the clips that stay. */
export interface PlacementOptions {
  /**
   * 'start' (the default; the commands, an agent's clip.move): it goes in
   * before the first clip whose end is after its start (a start asked for
   * is the start it gets).
   *
   * 'middle' (the timeline's drag, DENEME-3 V item 3; CapCut's and
   * Premiere's rule): it goes in before a clip only once its middle has
   * passed that clip's middle (or it starts where that clip starts or
   * earlier), so a clip dragged a little over its neighbour no longer trades
   * places with it. Less than that, it does not cover the neighbour: on an
   * auto-packed track (the magnet) it joins up against it; on a free track it
   * is pushed to where it covers nothing (against the clip before it, or
   * pulled back against the clip after it when the gap holds it). Only a
   * clip that does not fit there pushes the clips after it, as before.
   */
  insert?: 'start' | 'middle'
}

/**
 * The timeline preview and the committed edit use this exact plan. On an
 * auto-packed track, clips remain butt-joined. With auto-pack off, existing
 * gaps stay put unless an inserted clip overlaps a neighbour; only then do
 * the following clips ripple right to make room for the drop (with
 * `insert: 'middle'`, only when it cannot land without covering one).
 */
export function planTimelinePlacement(
  project: Project,
  anchorId: string,
  selectedIds: readonly string[],
  requestedDelta: number,
  targetTrackId: string | null,
  newTrack: 'video' | 'audio' | null,
  linkAV: boolean,
  options: PlacementOptions = {}
): TimelinePlacement | null {
  const byMiddle = options.insert === 'middle'
  const anchor = project.clips[anchorId]
  const anchorTrack = anchor && project.tracks.find((track) => track.id === anchor.trackId)
  if (!anchor || !anchorTrack || anchorTrack.locked) return null

  const selected = [...new Set(selectedIds)].filter((id) => {
    const clip = project.clips[id]
    return !!clip && !project.tracks.find((track) => track.id === clip.trackId)?.locked
  })
  if (!selected.includes(anchorId)) selected.unshift(anchorId)
  const selectedSet = new Set(selected)
  const movedSet = new Set(selected)
  const lockedRow = (id: string): boolean => !!project.tracks.find((track) => track.id === project.clips[id]?.trackId)?.locked
  const linkOf = (id: string): string[] => {
    const link = project.clips[id]?.linkId
    return link ? Object.values(project.clips).filter((c) => c.id !== id && c.linkId === link).map((c) => c.id) : []
  }
  /** The linked partners of a clip (the link on). */
  const partners = (id: string): string[] => (linkAV ? linkOf(id) : [])
  /** The partners a placed clip takes along: a clip the move pushes always
   *  (Ç2b patch, item 8: with the link off — an agent's clip.move by default
   *  — a pushed picture left its sound behind); a clip of the selection only
   *  with the link on (off, the user moves it alone). */
  const carried = (id: string): string[] => (linkAV ? linkOf(id) : selectedSet.has(id) ? [] : linkOf(id).filter((o) => !selectedSet.has(o)))
  for (const id of selected) {
    for (const other of partners(id)) {
      // A partner a lock holds stops the move (phase Ç2b.1, decision 3):
      // moved alone, the picture and its sound part.
      if (lockedRow(other)) return null
      movedSet.add(other)
    }
  }

  const target = targetTrackId ? project.tracks.find((track) => track.id === targetTrackId) : null
  const validTarget = target && !target.locked && target.kind === anchorTrack.kind ? target : null
  const validNewTrack = newTrack === anchorTrack.kind && selected.length === 1 ? newTrack : null
  const newTrackId = validNewTrack === 'video' ? NEW_VIDEO_TRACK : validNewTrack === 'audio' ? NEW_AUDIO_TRACK : null
  const minimumStart = Math.min(...[...movedSet].map((id) => project.clips[id].start))
  const delta = Math.max(-minimumStart, requestedDelta)

  // Dropped on another row, a selection keeps its layering: every clip moves
  // by as many rows as the one held (all of them sent to the hovered row
  // used to stack background and overlay one after the other there). A clip
  // whose row would be off the end, or locked, stays on its own.
  const sameKind = project.tracks.filter((track) => track.kind === anchorTrack.kind)
  let rowOffset = validTarget ? sameKind.indexOf(validTarget) - sameKind.indexOf(anchorTrack) : 0
  // A selected clip whose row would be off the end, or locked, keeps the
  // whole selection on its rows (phase Ç2b.1, report L5: it used to stay
  // alone and the rest piled onto its row, one after the other).
  if (rowOffset !== 0 && selected.some((id) => {
    const at = sameKind.findIndex((track) => track.id === project.clips[id].trackId)
    if (at < 0) return false
    const to = sameKind[at + rowOffset]
    return !to || !!to.locked
  })) rowOffset = 0
  const shiftedRow = (trackId: string): string => {
    const at = sameKind.findIndex((track) => track.id === trackId)
    const to = at < 0 ? undefined : sameKind[at + rowOffset]
    return to && !to.locked ? to.id : trackId
  }
  const destinations = new Map<string, string>()
  const desiredStarts = new Map<string, number>()
  for (const id of movedSet) {
    const clip = project.clips[id]
    const source = project.tracks.find((track) => track.id === clip.trackId)
    const destination = selectedSet.has(id) && source?.kind === anchorTrack.kind
      ? (newTrackId ?? (validTarget ? shiftedRow(clip.trackId) : clip.trackId))
      : clip.trackId
    destinations.set(id, destination)
    desiredStarts.set(id, Math.max(0, clip.start + delta))
  }

  const affected = new Set<string>()
  for (const id of movedSet) {
    affected.add(project.clips[id].trackId)
    affected.add(destinations.get(id)!)
  }
  const positions: TimelinePlacement['positions'] = {}
  const trackClipIds: TimelinePlacement['trackClipIds'] = {}
  const tracks: Track[] = [
    ...project.tracks,
    ...(newTrackId ? [{ id: newTrackId, kind: validNewTrack!, autoPack: false, clipIds: [], name: 'New track' }] : [])
  ]
  const layout = (): void => {
    for (const track of tracks) {
      if (!affected.has(track.id)) continue
      const stationary = track.id === newTrackId ? [] : track.clipIds
        .filter((id) => !!project.clips[id] && !movedSet.has(id))
        .map((id) => ({ id, wanted: project.clips[id].start, duration: project.clips[id].duration, moved: false }))
        .sort((left, right) => left.wanted - right.wanted)
      const incoming = [...movedSet]
        .filter((id) => destinations.get(id) === track.id)
        .map((id) => ({ id, wanted: desiredStarts.get(id)!, duration: project.clips[id].duration, moved: true }))
        .sort((left, right) => left.wanted - right.wanted)
      const order = [...stationary]
      // Before a clip that stays: at once when its start is inside it
      // ('start'), or once its middle has passed that clip's ('middle').
      const before = (item: { wanted: number; duration: number }, other: { wanted: number; duration: number }): boolean => byMiddle
        ? item.wanted <= other.wanted + EPS || item.wanted + item.duration / 2 < other.wanted + other.duration / 2 - EPS
        : other.wanted + other.duration > item.wanted + EPS
      for (const item of incoming) {
        const index = order.findIndex((other) => other.moved
          ? other.wanted > item.wanted + EPS
          : before(item, other))
        order.splice(index < 0 ? order.length : index, 0, item)
      }
      // One clip moved onto a free track ('middle'): it may be pulled back
      // against the clip after it rather than push it (see PlacementOptions).
      const pullBack = byMiddle && !track.autoPack && incoming.length === 1
      const isMainVideo = track.kind === 'video' &&
        project.tracks.filter((candidate) => candidate.kind === 'video').at(-1)?.id === track.id
      let cursor = 0
      if (track.autoPack && !isMainVideo && order.length > 0) cursor = order[0].wanted
      order.forEach((item, i) => {
        let start = track.autoPack ? cursor : Math.max(item.wanted, cursor)
        const next = order[i + 1]
        if (pullBack && item.moved && next && start + item.duration > next.wanted + EPS && next.wanted - item.duration >= cursor - EPS) {
          start = next.wanted - item.duration
        }
        positions[item.id] = { start, trackId: track.id }
        cursor = start + item.duration
      })
      trackClipIds[track.id] = order.map((item) => item.id)
    }
  }
  layout()
  // A clip the drop pushes along its track takes its linked partner the same
  // distance (phase Ç2b.1, decision 1; report P11), which may push in its
  // turn: the partners join the move until nothing new is pushed. (With the
  // link off too, for the clips it pushes: `carried`.)
  {
    for (let round = 0; round < 12; round++) {
      let grew = false
      for (const [id, position] of Object.entries(positions)) {
        // (A clip where its track put it — pushed, or packed into a run —
        // and its partner the same distance.)
        const dx = position.start - project.clips[id].start
        if (Math.abs(dx) < EPS && !movedSet.has(id)) continue
        for (const other of carried(id)) {
          if (lockedRow(other)) return null
          const want = Math.max(0, project.clips[other].start + dx)
          if (positions[other] && Math.abs(positions[other].start - want) < EPS) continue
          if (movedSet.has(other)) {
            if (Math.abs(desiredStarts.get(other)! - want) < EPS) continue
            desiredStarts.set(other, want)
          } else {
            movedSet.add(other)
            destinations.set(other, project.clips[other].trackId)
            desiredStarts.set(other, want)
            affected.add(project.clips[other].trackId)
          }
          grew = true
        }
      }
      if (!grew) break
      layout()
    }
    // Every pair lands together: a partner held back (by another clip of the
    // move before it, or a packed track) refuses the whole move.
    for (const id of movedSet) {
      const delta = positions[id] ? positions[id].start - project.clips[id].start : 0
      for (const other of carried(id)) {
        if (!positions[other]) return null
        if (Math.abs(positions[other].start - project.clips[other].start - delta) > EPS) return null
      }
    }
  }

  const anchorPosition = positions[anchorId]
  if (!anchorPosition) return null
  const changed = Object.entries(positions).some(([id, position]) => {
    const clip = project.clips[id]
    return position.trackId !== clip.trackId || Math.abs(position.start - clip.start) > EPS
  })
  return {
    positions,
    trackClipIds,
    movedIds: [...movedSet],
    anchorStart: anchorPosition.start,
    anchorTrackId: anchorPosition.trackId,
    newTrack: validNewTrack,
    changed
  }
}
