// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A project file from the user's own Snipp can hold what this product does not
// have: the narrator hands and the cut-out characters, the Stage, the three
// templates whose drawing was the hands (Intro, Outro, Black hole outro), the
// hand transitions and the portal, a code film's "own hand" left out. Such a
// file opens as a copy (SnippStudio KAPSAM.md, "Eski projeler"): those parts
// are not in the copy, the file itself is never written (Save asks for a new
// name), and one line says so. A file with none of it opens and saves as
// before.
//
// A few settings that only ever acted on the hands are dropped quietly: the
// words reacting to snaps and hands (a caption style's `physics`), a
// transition's "a hand does it" and a code film's "hands in its light". They
// changed nothing without the hands, so a file that has only them is not a
// copy.
//
// Pure: no DOM, so the tests read it directly.

import type { Project } from '../types'

/** What a file held that the product leaves out, in words, for the line the
 *  user reads. Empty: nothing. */
export type LegacyPart = 'narrator hands and characters' | 'Stage' | 'Intro, Outro and Black hole templates' | 'hand transitions and portals' | "code film's own-hand setting"

const GONE_TEMPLATES = new Set(['intro', 'outro', 'blackhole'])
const GONE_TRANSITION = (type: unknown): boolean => type === 'portal' || (typeof type === 'string' && type.startsWith('hand-'))

type Loose = Record<string, unknown>
const obj = (v: unknown): v is Loose => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Takes out of `project` (in place) everything the product does not have, and
 * says what it was. Called on every opened file, before anything else reads it.
 */
export function stripLegacy(project: Project): LegacyPart[] {
  const p = project as unknown as Loose
  const found = new Set<LegacyPart>()
  // The narrator hands and the cut-out characters, and the pose pictures only
  // they used (a picture also on the timeline stays).
  if ('characters' in p) {
    if (Array.isArray(p.characters) && p.characters.length) found.add('narrator hands and characters')
    delete p.characters
  }
  if (Array.isArray(project.assets)) {
    const used = new Set(Object.values(obj(project.clips) ? project.clips : {}).map((c) => (obj(c) ? c.assetId : undefined)))
    const before = project.assets.length
    project.assets = project.assets.filter((a) => {
      // (An entry that is no object is the repair's to drop, after this: Faz 11b, DG2.)
      if (!obj(a)) return true
      const role = (a as unknown as Loose).role
      if (role !== 'character') return true
      found.add('narrator hands and characters')
      if (used.has(a.id)) {
        delete (a as unknown as Loose).role
        return true
      }
      return false
    })
    if (project.assets.length !== before) found.add('narrator hands and characters')
    for (const a of project.assets) {
      if (!obj(a)) continue
      const code = (a as unknown as Loose).code
      if (!obj(code)) continue
      if (code.hand === false) found.add("code film's own-hand setting")
      delete code.hand
      delete code.light
    }
  }
  // The Stage, its versions, and the credits line its terrains asked for.
  for (const k of ['stage', 'stageVersions', 'credits'] as const) {
    if (!(k in p)) continue
    if (k !== 'credits' || p.credits) found.add('Stage')
    delete p[k]
  }
  // The three templates that were the hands.
  if (Array.isArray(project.templates)) {
    const kept = project.templates.filter((b) => !GONE_TEMPLATES.has((b as unknown as Loose)?.kind as string))
    if (kept.length !== project.templates.length) found.add('Intro, Outro and Black hole templates')
    project.templates = kept
  }
  // The hand transitions and the portal: a straight cut in the copy.
  const clips: Loose[] = []
  const walk = (list: unknown[]): void => {
    for (const c of list) {
      if (!obj(c)) continue
      clips.push(c)
      const nested = c.nested
      if (obj(nested) && Array.isArray(nested.clips)) walk(nested.clips)
    }
  }
  walk(Object.values(obj(project.clips) ? project.clips : {}))
  for (const c of clips) {
    const tr = c.transitionOut
    if (!obj(tr)) continue
    if (GONE_TRANSITION(tr.type)) {
      found.add('hand transitions and portals')
      delete c.transitionOut
      continue
    }
    delete tr.hand
    delete tr.color
  }
  // The words reacting to snaps and hands.
  for (const style of [project.captionStyle, project.captionStyleShorts, ...(project.captions ?? []).map((c) => c?.style)]) {
    if (obj(style)) delete (style as Loose).physics
  }
  return [...found]
}

/** The one line shown when a file opened as a copy. */
export function copyNotice(parts: readonly LegacyPart[]): string {
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `Opened as a copy without its ${list}: they are not part of this app. The file itself is unchanged; Save asks for a new name.`
}
