// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What an agent's edit did, in the user's words (D22, the audit's A13). The
// toast after a change made straight on the timeline, the mark it leaves
// there and the Agent tab's Steps list said the command's name ("Agent:
// clip.move. Ctrl+Z undoes it.", "Edited: clip.move"): a name of the
// program's inside, not the user's. They say the draft card's sentences now
// (agent/draft-words.ts: one sentence per change): the first, and how many
// more.
import { getLang, t, type StringKey } from '../ui'
import type { Project } from '../types'
import { changeCount, draftChanges, type DraftChange, type Words } from './draft-words'

/** A length as draft-words.ts writes it ("0.8 s", "10 s") in the language
 *  shown: Turkish writes "0,8 sn" (the audit's A14: "8.7 s" in a Turkish
 *  sentence). */
const SPAN = /^(\d+)(?:\.(\d+))? s$/
function local(params: Record<string, string | number>): Record<string, string | number> {
  if (getLang() !== 'tr') return params
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params)) {
    const m = typeof v === 'string' ? SPAN.exec(v) : null
    out[k] = m ? `${m[1]}${m[2] ? `,${m[2]}` : ''} sn` : v
  }
  return out
}

/** A short label of a change (a badge on the timeline). "first": the key of
 *  the label it starts with (several settings at once). */
export function wordsText(w: Words): string {
  const params: Record<string, string | number> = local(w.params)
  if (typeof params.first === 'string') params.first = t(params.first as StringKey, params)
  return t(w.key as StringKey, params)
}

/** One change's sentence ('' for a linked partner's row, said with its clip). */
export function changeText(c: DraftChange): string {
  if (!c.key) return ''
  const params: Record<string, string | number> = local(c.params)
  if (c.kind === 'slip') params.way = t(params.way === 'later' ? 'den2t.change.slip.later' : 'den2t.change.slip.earlier')
  // (Several settings of a clip at once: the first said whole, the rest counted.)
  if (typeof params.first === 'string') params.first = t(params.first as StringKey, params)
  let s = t(c.key as StringKey, params)
  if (c.params.partner) s += t('den2t.change.withPartner')
  if (c.params.closes) s += t('d22c.change.closes')
  return s
}

/** Changes said as a count ("12 subtitle lines change"), not as what happened. */
const COUNTED = new Set<DraftChange['kind']>(['lines', 'other'])

/** The changes as one line: the first one's sentence, "and N more". The
 *  first that says what happened (a move, a cut, a title), before a count. */
export function saidOf(changes: readonly DraftChange[]): string {
  const told = changes.filter((c) => c.key)
  if (!told.length) return t('d22a.said.none')
  const first = changeText(told.find((c) => !COUNTED.has(c.kind)) ?? told[0])
  const more = changeCount(changes) - 1
  return more > 0 ? t('d22a.said.more', { first, n: more }) : first
}

/** What an edit made of `before` (the project it ran on) in `after`, as one
 *  line; `cuts`: the ranges it cut, in `before`'s seconds. */
export const editSaid = (before: Project, after: Project, cuts: readonly [number, number][]): string => saidOf(draftChanges(before, after, cuts))
