// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The code templates in the editor (phase 5f, decision 1): the user's tool.
// One added from the Templates panel is copied by the main process into
// `anim\<id>[-n]\` beside the saved project (main/code-templates.ts), comes
// in as a code film of the project's size, and a clip of it goes on a new
// track over the picture at the playhead (one undo step). Its values are then
// set in the Inspector's Parameters section (its code stays as it is).
import { api } from '../platform'
import { useStore } from '../state/store'
import { saveProject } from './projectio'
import { codeFilmImport } from './import'
import { notify, t, type StringKey } from '../ui'
import type { Asset } from '../types'

export const CODE_TEMPLATES = ['blank', 'lower-third', 'bar-chart', 'counter', 'arrow', 'title-card'] as const
export type CodeTemplate = (typeof CODE_TEMPLATES)[number]

/** Each template's own length (its `duration` parameter's default): the
 *  clip's length before its page has said it. */
export const CODE_TEMPLATE_LENGTH: Record<CodeTemplate, number> = { blank: 4, 'lower-third': 5, 'bar-chart': 6, counter: 4, arrow: 4, 'title-card': 4 }

export const CODE_TEMPLATE_NAME: Record<CodeTemplate, StringKey> = {
  blank: 'codeTpl.blank',
  'lower-third': 'codeTpl.lowerThird',
  'bar-chart': 'codeTpl.barChart',
  counter: 'codeTpl.counter',
  arrow: 'codeTpl.arrow',
  'title-card': 'codeTpl.titleCard'
}

/** Adds template `id` at the playhead. Answers the new clip's id (null: not
 *  added, the user was told why). */
export async function addCodeTemplate(id: CodeTemplate): Promise<string | null> {
  if (!api?.codeFilm.addTemplate) return null
  const r = await api.codeFilm.addTemplate(id)
  if (!r.ok || !r.folder) {
    if (r.error === 'save the project first') notify({ text: t('codeTpl.saveFirst'), action: { label: t('codeFilm.saveProject'), run: () => void saveProject(useStore.getState().project) } })
    else notify({ text: t('codeTpl.failed', { why: r.error ?? '' }), kind: 'error' })
    return null
  }
  const info = await api.codeFilm.register(r.folder)
  if (!info) {
    notify({ text: t('codeTpl.failed', { why: r.folder }), kind: 'error' })
    return null
  }
  const imp = await codeFilmImport(info)
  const code = imp.assets.find((a) => a.kind === 'code')!
  const st = useStore.getState()
  const ps = st.project.settings
  // The project's size (its page draws at the size it is opened at) and the
  // template's own length until its page says it.
  const film: Asset = { ...code, duration: CODE_TEMPLATE_LENGTH[id], width: ps.width > 0 ? ps.width : 1920, height: ps.height > 0 ? ps.height : 1080 }
  const out = st.addClipsAt([film.id], null, st.currentTime, { assets: [film], newTrack: 'video' })
  const clipId = out.clipIds[0] ?? null
  if (clipId) useStore.getState().selectClips([clipId])
  return clipId
}
