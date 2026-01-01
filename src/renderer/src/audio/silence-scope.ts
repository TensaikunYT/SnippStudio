// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What "Remove silence" listens to, and one scan of it (çekirdek cila S,
// decisions 1 and 5). The window and its tests call these; the finder itself
// is the agent's (agent/analyze.ts findSilences), so both read pauses alike.
import { findSilences, speechClips, type ReadLoudness, type SilenceFind } from '../agent/analyze'
import { flattenWords } from '../analysis/words'
import { bedTracks } from '../commands/timeline'
import type { Clip, Project } from '../types'
import { isSubtitle } from '../types'
import { clipLoudnessDb, resolveSilenceSelection, type Cancel, type SilencePace, type SilenceSensitivity } from './silence'

export interface SilenceScope {
  /** Where the sources came from: the clips picked, or (nothing picked) the
   *  speech as the agent finds it. */
  from: 'selection' | 'speech'
  /** The clips listened to. */
  sources: Clip[]
  /** Pictures picked with their extracted sound: cut at its cut points (they
   *  are cut anyway, as every unlocked track is; named in the window). */
  pictures: string[]
}

/**
 * Decision 1, the sources. Clips picked: each one that sounds, and for a
 * picture whose sound was extracted, the linked sound under it
 * (resolveSilenceSelection). Nothing picked: the clips the speech is in
 * (the track that is loud while the subtitles' words are said; without
 * subtitles the talking picture's track). Null: nothing to listen to (the
 * pick has no sound, or no clip is known to be the speech).
 */
export async function silenceScope(project: Project, selectedIds: readonly string[], loudness: ReadLoudness = clipLoudnessDb, signal?: Cancel): Promise<SilenceScope | null> {
  if (selectedIds.some((id) => project.clips[id])) {
    const picked = resolveSilenceSelection(project, selectedIds)
    if (!picked) return null
    const sources = new Set(picked.sources.map((c) => c.id))
    return { from: 'selection', sources: picked.sources, pictures: [...new Set(Object.values(picked.targetsBySource).flat())].filter((id) => !sources.has(id)) }
  }
  const words = flattenWords(project.captions.filter(isSubtitle))
  const failed: string[] = []
  const speech = await speechClips(project, words, loudness, signal, failed)
  // (A clip of the speech that cannot be read is still one of its clips: the
  // finder reports it and the cut takes it for loud all through.)
  const sources = [...speech.map((x) => x.clip), ...failed.map((id) => project.clips[id]).filter((c): c is Clip => !!c)].sort((a, b) => a.start - b.start)
  return sources.length ? { from: 'speech', sources, pictures: [] } : null
}

export interface SilenceSettings {
  sensitivity: SilenceSensitivity
  /** A threshold given by hand (dBFS), or undefined for each clip's own. */
  thresholdDb?: number
  minDuration: number
  pad: number
  pace: SilencePace
}

/** One scan of the scope: where every source is quiet, kept to `limit`, the
 *  not-sure pauses apart (the agent's rules). */
export function scanSilence(
  project: Project,
  scope: SilenceScope,
  settings: SilenceSettings,
  o: { limit?: readonly [number, number] | null; keepMusic: boolean },
  loudness: ReadLoudness = clipLoudnessDb,
  signal?: Cancel
): Promise<SilenceFind> {
  return findSilences(project, { ...settings, sources: scope.sources, everyQuiet: true, limit: o.limit ?? null, keepMusic: o.keepMusic }, loudness, signal)
}

const beds = new WeakMap<Project, Promise<string[]>>()

/**
 * The tracks a cut made for the SPEECH leaves alone (decision 12: deleting
 * words in the transcript treats the music as the silence cut does): the
 * bed tracks of the clips the speech is in. Empty when no clip is known to
 * be the speech (every unlocked track is then cut, as before). Kept per
 * project object, so the panel can ask before each cut.
 */
export function speechBeds(project: Project, loudness: ReadLoudness = clipLoudnessDb): Promise<string[]> {
  let known = beds.get(project)
  if (!known) {
    known = silenceScope(project, [], loudness)
      .then((scope) => (scope ? bedTracks(project, scope.sources.map((c) => c.id)) : []))
      .catch(() => [])
    beds.set(project, known)
  }
  return known
}
