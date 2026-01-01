// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Code film settings the user makes (phase 5f): a page's parameter values
// (decision 2) and the project look (decision 3). Both internal: the store's
// Inspector edits them; no agent tool names them (the definitions say nothing
// of parameters or a look: ANA-PLAN principle 6).
import { cleanLook, TEXT_MAX } from '../media/codefilm-params'
import { cleanEdits, editId } from '../../../shared/codeval/edits'
import { CommandError, defineCommand } from './core'
import { s } from './schema'

export const setCodeParams = defineCommand({
  name: 'code.setParams',
  summary: 'Set the values of a code clip page\'s own parameters (null: back to the page\'s own value).',
  internal: true,
  params: s.object({ assetId: s.id(), values: s.object_any('key → value (text, colour or number), or null to remove') }),
  check(p, { assetId }) {
    const a = p.assets.find((x) => x.id === assetId)
    if (!a || a.kind !== 'code') throw new CommandError('code.setParams', `there is no code film "${assetId}"`)
  },
  apply(p, { assetId, values }): void {
    const a = p.assets.find((x) => x.id === assetId)
    if (!a || a.kind !== 'code' || !a.code) return
    const next: Record<string, string | number> = { ...(a.code.params ?? {}) }
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined) delete next[k]
      // (A text is cut at TEXT_MAX, what a page can be given: audit O2.)
      else if (typeof v === 'string') next[k] = v.slice(0, TEXT_MAX)
      else if (typeof v === 'number' && Number.isFinite(v)) next[k] = v
    }
    const code = { ...a.code }
    if (Object.keys(next).length) code.params = next
    else delete code.params
    a.code = code
  }
})

/** Cila K, "code values": the constants of a code clip's page changed by
 *  hand (shared/codeval). Internal, like the parameters: the panel's own;
 *  no agent tool names it and nothing about it is said to an agent. */
export const setCodeEdits = defineCommand({
  name: 'code.setEdits',
  summary: 'Set or remove hand-made changes of the constants found in a code clip page.',
  internal: true,
  params: s.object({
    assetId: s.id(),
    put: s.array(s.object_any('{ kind, orig, value, file?, pos?, n?, of? }'), { max: 2000 }),
    drop: s.array(s.string({ max: 5000 }), { max: 2000, description: 'the names of changes to remove' })
  }),
  check(p, { assetId }) {
    const a = p.assets.find((x) => x.id === assetId)
    if (!a || a.kind !== 'code') throw new CommandError('code.setEdits', `there is no code film "${assetId}"`)
  },
  apply(p, { assetId, put, drop }): void {
    const a = p.assets.find((x) => x.id === assetId)
    if (!a || a.kind !== 'code' || !a.code) return
    const gone = new Set(drop)
    // (Each change clean, one per place or value, the last said wins.)
    const next = cleanEdits([...(a.code.edits ?? []).filter((e) => !gone.has(editId(e))), ...put])
    const code = { ...a.code }
    if (next.length) code.edits = next
    else delete code.edits
    a.code = code
  }
})

export const setProjectLook = defineCommand({
  name: 'project.setLook',
  summary: 'Set the project look: an accent colour and a font (empty: none).',
  internal: true,
  params: s.object({ look: s.object_any('{ accent?: "#rrggbb", font?: "name" }') }),
  apply(p, { look }): void {
    const merged = { ...(p.look ?? {}), ...look } as Record<string, unknown>
    for (const k of Object.keys(look)) if (look[k] === null || look[k] === '') delete merged[k]
    const l = cleanLook(merged)
    if (l) p.look = l
    else delete p.look
  }
})
