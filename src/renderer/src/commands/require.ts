// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a command called by name checks before it runs (SnippStudio phase
// 2A.5 C): the things it names exist, a clip it edits is not on a locked
// track, an id it is given for a new thing is free. The store's own buttons
// call the commands' apply directly and keep their silent behaviour.
import type { Caption, Clip, Project, Track } from '../types'
import { CommandError } from './core'

export function requireTrack(p: Project, id: string, cmd: string, opts: { edit?: boolean; kind?: Track['kind'] } = {}): Track {
  const t = p.tracks.find((x) => x.id === id)
  if (!t) throw new CommandError(cmd, `there is no track "${id}" (tracks: ${p.tracks.map((x) => `${x.id} ${x.name}`).join(', ')})`)
  if (opts.kind && t.kind !== opts.kind) throw new CommandError(cmd, `track "${id}" is a ${t.kind} track, not ${opts.kind}`)
  if (opts.edit && t.locked) throw new CommandError(cmd, `track "${id}" (${t.name}) is locked`)
  return t
}

export function requireClip(p: Project, id: string, cmd: string, opts: { edit?: boolean } = { edit: true }): Clip {
  const c = p.clips[id]
  if (!c) throw new CommandError(cmd, `there is no clip "${id}"`)
  if (opts.edit !== false) {
    const t = p.tracks.find((x) => x.id === c.trackId)
    if (t?.locked) throw new CommandError(cmd, `clip "${id}" is on a locked track (${t.name})`)
  }
  return c
}

/** What to send instead of an id that names no media (23 Nov: an agent
 *  asked to copy a clip tried a file name, then a clip id, and was told only
 *  "there is no media"). */
const MEDIA_HINT = 'send a media id from project {"track":"media"}, the id of a clip showing it, or its file name; to copy a clip use clip.duplicate'

export function requireAsset(p: Project, id: string, cmd: string): void {
  const a = p.assets.find((x) => x.id === id)
  if (!a) throw new CommandError(cmd, `there is no media "${id}": ${MEDIA_HINT}`)
  if (a.missing) throw new CommandError(cmd, `media "${id}" (${a.name}) is missing on disk`)
}

/** The media an add names (clip.add, clip.append): a media id; else the id
 *  of a clip on the timeline (its media); else a file name, when one media
 *  has it (case aside). Two of that name: the error lists their ids. */
export function assetRef(p: Project, ref: string, cmd: string): string {
  if (p.assets.some((x) => x.id === ref)) {
    requireAsset(p, ref, cmd)
    return ref
  }
  const clip = Object.prototype.hasOwnProperty.call(p.clips, ref) ? p.clips[ref] : undefined
  if (clip) {
    if (!clip.assetId || !p.assets.some((x) => x.id === clip.assetId)) throw new CommandError(cmd, `clip "${ref}" shows no media file (a compound, a layer): copy it with clip.duplicate`)
    requireAsset(p, clip.assetId, cmd)
    return clip.assetId
  }
  const named = p.assets.filter((x) => x.name.toLowerCase() === ref.toLowerCase())
  if (named.length > 1) throw new CommandError(cmd, `${named.length} media are named "${ref}": send one id of ${named.map((x) => x.id).join(', ')}`)
  if (named.length === 1) {
    requireAsset(p, named[0].id, cmd)
    return named[0].id
  }
  throw new CommandError(cmd, `there is no media, clip or file name "${ref}": ${MEDIA_HINT}`)
}

export function requireCaption(p: Project, id: string, cmd: string, opts: { shape?: boolean } = {}): Caption {
  const c = p.captions.find((x) => x.id === id)
  if (!c) throw new CommandError(cmd, `there is no subtitle, title or shape "${id}"`)
  if (opts.shape && !c.shape) throw new CommandError(cmd, `"${id}" is not a shape`)
  return c
}

export function requireMarker(p: Project, id: string, cmd: string): void {
  if (!p.markers?.some((m) => m.id === id)) throw new CommandError(cmd, `there is no marker "${id}"`)
}

/** Every id in the project, of every kind (a given id must be new to all). */
function idsOf(p: Project): Set<string> {
  const ids = new Set<string>([...Object.keys(p.clips), ...p.tracks.map((t) => t.id), ...p.captions.map((c) => c.id)])
  for (const m of p.markers ?? []) ids.add(m.id)
  for (const t of p.templates ?? []) ids.add(t.id)
  for (const n of p.notes ?? []) ids.add(n.id)
  for (const a of p.assets) ids.add(a.id)
  return ids
}

export function requireFreshId(p: Project, id: string | undefined, cmd: string): void {
  if (id === undefined) return
  // (An id is a key of the project's maps: never a name every object has.)
  if (id in Object.prototype || id === 'prototype') throw new CommandError(cmd, `"${id}" cannot be an id`)
  if (idsOf(p).has(id)) throw new CommandError(cmd, `id "${id}" is taken`)
}
