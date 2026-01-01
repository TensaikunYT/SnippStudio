// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Tracks: add, delete, move. Bodies as they were in state/store.ts.
import { uid } from '../types'
import { findTrack, forgetClips, gatherTrack, nextTrackName } from './ops/base'
import { CommandError, defineCommand } from './core'
import { requireFreshId, requireTrack } from './require'
import { s } from './schema'

export const addTrack = defineCommand({
  name: 'track.add',
  summary: 'Add a track: a video track goes on top, an audio track at the bottom. Returns its id.',
  params: s.object({ kind: s.enum(['video', 'audio'] as const), id: s.optional(s.id('An id for the new track')) }),
  check(p, { id }) {
    requireFreshId(p, id, 'track.add')
  },
  apply(p, { kind, id }): string {
    const track = { id: id ?? uid(), kind, name: nextTrackName(p, kind), clipIds: [] as string[] }
    if (kind === 'video') p.tracks.unshift(track)
    else p.tracks.push(track)
    return track.id
  }
})

export const deleteTrack = defineCommand({
  name: 'track.delete',
  summary: 'Delete a track and its clips (the last track of a kind stays). Returns the deleted clip ids.',
  params: s.object({ trackId: s.id() }),
  check(p, { trackId }) {
    const t = requireTrack(p, trackId, 'track.delete')
    if (p.tracks.filter((x) => x.kind === t.kind).length <= 1) throw new CommandError('track.delete', `"${trackId}" is the last ${t.kind} track: it stays`)
    // A lock keeps a track's clips as they are (Ç2b patch, item 4).
    if (t.locked) throw new CommandError('track.delete', `"${trackId}" is locked: its clips stay (unlock it first)`)
  },
  apply(p, { trackId }): string[] {
    const doomed: string[] = []
    const track = findTrack(p, trackId)
    if (!track || track.locked) return doomed
    const sameKind = p.tracks.filter((t) => t.kind === track.kind)
    if (sameKind.length <= 1) return doomed // keep at least one of each kind
    for (const id of [...track.clipIds]) {
      doomed.push(id)
      delete p.clips[id]
    }
    forgetClips(p, doomed)
    p.tracks = p.tracks.filter((t) => t.id !== trackId)
    return doomed
  }
})

export const moveTrack = defineCommand({
  name: 'track.move',
  summary: 'Move a track one place up (-1) or down (1) among the tracks of its kind.',
  params: s.object({ trackId: s.id(), dir: s.enum([-1, 1] as const) }),
  check(p, { trackId, dir }) {
    const t = requireTrack(p, trackId, 'track.move')
    const j = p.tracks.indexOf(t) + dir
    if (j < 0 || j >= p.tracks.length || p.tracks[j].kind !== t.kind) throw new CommandError('track.move', `"${trackId}" cannot move ${dir < 0 ? 'up' : 'down'}: it is the ${dir < 0 ? 'top' : 'bottom'} ${t.kind} track`)
  },
  apply(p, { trackId, dir }): void {
    const i = p.tracks.findIndex((t) => t.id === trackId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= p.tracks.length) return
    // Only reorder within the same kind: video and audio lanes are grouped.
    if (p.tracks[i].kind !== p.tracks[j].kind) return
    const [moved] = p.tracks.splice(i, 1)
    p.tracks.splice(j, 0, moved)
  }
})

export const setMagnet = defineCommand({
  name: 'track.setMagnet',
  summary: "Switch a track's magnet on or off. On: its clips are gathered at once (the first at 0, no gaps, linked partners along) and stay joined, so switching it on again closes every gap made meanwhile. Off: nothing moves; the clips can then be moved apart.",
  params: s.object({ trackId: s.id(), on: s.boolean('true: joined, no gaps; false: free') }),
  check(p, { trackId }) {
    requireTrack(p, trackId, 'track.setMagnet')
  },
  // What the magnet button of a track's header does (it was the store's:
  // the flag, then the gathering; 22 Nov, so that an agent asked to "move
  // every clip 10 s later" on a track that keeps its clips joined can
  // switch that off itself, in the draft the user sees, instead of sending
  // the user to the header).
  apply(p, { trackId, on }): void {
    const track = findTrack(p, trackId)
    if (!track) return
    track.autoPack = on
    if (on) gatherTrack(p, track)
  }
})

export const renameTrack = defineCommand({
  name: 'track.rename',
  // The track header's (double-click the name); not offered to an agent.
  internal: true,
  summary: 'Give a track another name (shown in its header; at most 40 characters).',
  params: s.object({ trackId: s.id(), name: s.string({ min: 1, max: 40 }) }),
  check(p, { trackId, name }) {
    requireTrack(p, trackId, 'track.rename')
    if (!name.trim()) throw new CommandError('track.rename', 'a track needs a name')
  },
  apply(p, { trackId, name }): void {
    const track = findTrack(p, trackId)
    const clean = name.trim().slice(0, 40)
    if (track && clean) track.name = clean
  }
})
