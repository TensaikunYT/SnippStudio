// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What "Copy" puts on the clipboard (GONDER2-PLAN.md): what the user sent to
// the agent, as plain text to paste into the agent's own chat when it is not
// waiting for them. It stands on its own there: the notes' numbers, times,
// kinds and words, a task's words and selection, and at the end the project
// in the app. Never a key, a token, an address or a path. Pure: the words come
// through `t` (the interface's language, the user is the one writing).
import type { Project, WorkNote } from '../types'
import { noteSpan } from '../notes/model'
import { PRODUCT_NAME } from '../../../shared/product'
import type { Params, StringKey } from '../ui/strings'

type T = (key: StringKey, params?: Params) => string

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** One note as a line: "#3 · 0:12.4–0:15.0 · Fix · "shorter here"". */
export function noteLine(n: WorkNote, t: T): string {
  const parts = [`#${n.num}`, noteSpan(n), t(`notes.kind.${n.kind}` as StringKey)]
  const text = clean(n.text ?? '')
  if (text) parts.push(`"${text}"`)
  if (n.shapes?.length) parts.push(t('gonder2.paste.drawing'))
  return parts.join(' · ')
}

export type PasteWhat = { kind: 'notes'; notes: readonly string[] } | { kind: 'task'; text: string; selection?: string }

/** The text for the agent's chat; '' when there is nothing to say. */
export function pasteText(what: PasteWhat, project: Project, t: T): string {
  const lines: string[] = []
  if (what.kind === 'notes') {
    const by = new Map((project.notes ?? []).map((n) => [n.id, n]))
    const ns = what.notes.map((id) => by.get(id)).filter((n): n is WorkNote => !!n).sort((x, y) => x.start - y.start || x.num - y.num)
    if (!ns.length) return ''
    lines.push(t(ns.length === 1 ? 'gonder2.paste.notes.one' : 'gonder2.paste.notes.many', { n: ns.length, app: PRODUCT_NAME }))
    for (const n of ns) lines.push(noteLine(n, t))
  } else {
    const text = clean(what.text)
    if (!text) return ''
    lines.push(t('gonder2.paste.task', { app: PRODUCT_NAME, text }))
    if (what.selection) lines.push(t('gonder2.paste.selection', { what: what.selection }))
  }
  lines.push(t('gonder2.paste.where', { app: PRODUCT_NAME, name: project.name || t('gonder2.paste.untitled') }))
  return lines.join('\n')
}
