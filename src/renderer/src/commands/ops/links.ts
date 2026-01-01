// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Linked picture and sound are one unit; a locked track is never changed
// (phase Ç2b.1, decisions 2 and 3; report L2, L6, L7). Pure: every edit asks
// here which clips it takes with a clip, and whether a lock stops it.
import type { Clip, Project } from '../../types'
import { uid } from '../../types'
import { EPS } from '../../timeline/eps'

/** The other clips of a clip's link (a picture's sound, a sound's picture). */
export function partnersOf(p: Project, clip: Clip): Clip[] {
  if (!clip.linkId) return []
  return Object.values(p.clips).filter((o) => o.id !== clip.id && o.linkId === clip.linkId)
}

/** `ids` and, with the link on (the default), their linked partners: each
 *  once, the asked ones first. Ids the project lacks are dropped. */
export function withPartners(p: Project, ids: readonly string[], link = true): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (id: string): void => {
    if (seen.has(id) || !p.clips[id]) return
    seen.add(id)
    out.push(id)
  }
  for (const id of ids) add(id)
  if (link) for (const id of ids) if (p.clips[id]) for (const o of partnersOf(p, p.clips[id])) add(o.id)
  return out
}

export const onLockedTrack = (p: Project, clip: Clip): boolean => !!p.tracks.find((t) => t.id === clip.trackId)?.locked

/** The clips of `ids` an edit may change: they exist and no lock holds them. */
export function editableClips(p: Project, ids: readonly string[]): string[] {
  return ids.filter((id) => !!p.clips[id] && !onLockedTrack(p, p.clips[id]))
}

/** A clip of `ids` (unlocked itself) whose linked partner is on a locked
 *  track: with the link on, an edit of that clip is refused and said
 *  (decision 3) — moving or cutting the one would leave the other behind. */
export function lockedPartner(p: Project, ids: readonly string[], link = true): { clip: Clip; partner: Clip; track: string } | undefined {
  if (!link) return undefined
  for (const id of ids) {
    const clip = p.clips[id]
    if (!clip || onLockedTrack(p, clip)) continue
    const partner = partnersOf(p, clip).find((o) => onLockedTrack(p, o))
    if (partner) return { clip, partner, track: p.tracks.find((t) => t.id === partner.trackId)?.name ?? partner.trackId }
  }
  return undefined
}

/** The clips of `ids`, with their partners, an edit takes: those whose pair
 *  a lock does not hold (a clip on a locked track, or one whose partner is
 *  on one, stays with its partners). */
export function freePairs(p: Project, ids: readonly string[], link = true): string[] {
  const all = withPartners(p, ids, link)
  const held = new Set<string>()
  for (const id of all) {
    const c = p.clips[id]
    if (!onLockedTrack(p, c) && !(link && partnersOf(p, c).some((o) => onLockedTrack(p, o)))) continue
    held.add(id)
    if (link) for (const o of partnersOf(p, c)) held.add(o.id)
  }
  return all.filter((id) => !held.has(id))
}

/** Where every clip starts now (to see afterwards what an edit moved). */
export const startsOf = (p: Project): Map<string, number> => new Map(Object.values(p.clips).map((c) => [c.id, c.start]))

/**
 * A clip an edit moved along its own track (a speed change pushing what
 * follows, a magnet, a packed track closing up) takes its linked partner the
 * same distance (phase Ç2b.1, decision 1; report P11), and the partner takes
 * what follows it on its own track — unless that would run into the clip
 * before it, or the partner's track is locked: then it stays (nothing is
 * laid over anything). `before`: the starts before the edit; `own`: clips
 * the edit placed itself (their partners were handled with them).
 */
export function carryPartners(p: Project, before: ReadonlyMap<string, number>, own: ReadonlySet<string> = new Set()): void {
  const done = new Set<string>(own)
  for (let round = 0; round < 6; round++) {
    let changed = false
    for (const c of Object.values(p.clips)) {
      const was = before.get(c.id)
      if (was === undefined || done.has(c.id)) continue
      const dx = c.start - was
      if (Math.abs(dx) < 1e-9) continue
      done.add(c.id)
      for (const o of partnersOf(p, c)) {
        const oWas = before.get(o.id)
        if (oWas === undefined || done.has(o.id) || onLockedTrack(p, o)) continue
        if (Math.abs(o.start - oWas - dx) < EPS) continue
        const track = p.tracks.find((t) => t.id === o.trackId)
        if (!track) continue
        const list = track.clipIds.map((id) => p.clips[id]).filter((x): x is Clip => !!x)
        const from = o.start
        const by = oWas + dx - from
        const followers = list.filter((x) => x.start >= from - EPS)
        // (A clip the edit placed itself is not pushed along: then it stays.)
        if (followers.some((x) => own.has(x.id))) continue
        const prevEnd = Math.max(0, ...list.filter((x) => x.start < from - EPS).map((x) => x.start + x.duration))
        if (from + by < prevEnd - EPS) continue
        for (const x of followers) x.start += by
        changed = true
      }
    }
    if (!changed) break
  }
}

/** The copy `c` of a clip of `ids` keeps a link to the copies of its
 *  partners (a fresh link per pair); a link to a clip not copied goes. */
export function relink(c: Clip, links: Map<string, string>, ids: readonly string[], p: Project): void {
  const link = c.linkId
  delete c.linkId
  if (!link) return
  const together = ids.filter((id) => p.clips[id]?.linkId === link)
  if (together.length < 2) return
  if (!links.has(link)) links.set(link, uid())
  c.linkId = links.get(link)
}

/** Copies placed one by one (Ctrl+D) may have landed apart: a pair whose
 *  copies did not land as far apart as its originals lets go of its link.
 *  `made`: [copy, original]. */
export function keepPairsTogether(p: Project, made: readonly [string, string][]): void {
  const byLink = new Map<string, [Clip, Clip][]>()
  for (const [copy, orig] of made) {
    const c = p.clips[copy]
    if (c?.linkId && p.clips[orig]) byLink.set(c.linkId, [...(byLink.get(c.linkId) ?? []), [c, p.clips[orig]]])
  }
  for (const list of byLink.values()) {
    const shift = list[0][0].start - list[0][1].start
    if (list.some(([c, o]) => Math.abs(c.start - o.start - shift) > EPS)) for (const [c] of list) delete c.linkId
  }
}
