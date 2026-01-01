// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (A9 steps 1 and 5): what the draft core costs on long
// material. A 30-minute and a 2-hour made-up talk (linked picture and sound
// in pieces, a music bed, word-timed subtitles): a 150- and a 300-range cut,
// the draft made of them built again after a user's cut, and what keeping
// the last 8 versions' projects holds in memory. The numbers are printed
// (FAZ4A-PLAN.md 7.3 has them); the ceilings only catch a blow-up.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { applyBatch, type CommandCall } from '../renderer/src/commands'
import { MAX_OPS_PER_EDIT, MAX_RANGES_PER_EDIT } from '../renderer/src/agent/edit'
import type { Project } from '../renderer/src/types'
import { currentDraft, draftState, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { draftCalls } from './agent-kit'
import { useAgentStore } from '../renderer/src/agent/store'
import { longTalk } from './oracle/fixture'

const S = useStore.getState

/** `n` silence-like ranges spread over the talk (0.4–1.2 s each). */
function ranges(total: number, n: number): [number, number][] {
  const out: [number, number][] = []
  const gap = total / (n + 1)
  for (let i = 1; i <= n; i++) out.push([+(i * gap).toFixed(2), +(i * gap + 0.4 + (i % 5) * 0.2).toFixed(2)])
  return out
}

const ms = (fn: () => void): number => {
  const t = performance.now()
  fn()
  return Math.round((performance.now() - t) * 10) / 10
}

for (const [label, total, pieces, lines] of [['30 min', 1800, 125, 375], ['2 h', 7200, 250, 1500]] as const) {
  test(`scale: ${label} talk (${pieces * 2 + 1} clips, ${lines} lines, ${lines * 10} words)`, () => {
    const p = longTalk(total, pieces, lines)
    const out: Record<string, number> = {}
    for (const n of [150, 300]) {
      out[`cut${n}`] = ms(() => void applyBatch(p, [{ name: 'timeline.cutRanges', params: { ranges: ranges(total, n) } }]))
    }
    // The draft: a 150-range cut and five titles; then the user cuts once.
    const unwatch = watchLive()
    rejectDraft()
    S().loadProject(p)
    useAgentStore.getState().setMode('draft')
    out.draft150 = ms(() => void draftCalls('s1', 'scale', [{ name: 'timeline.cutRanges', params: { ranges: ranges(total, 150) } }]))
    draftCalls('s1', 'scale', [100, 300, 500, 700, 900].map((t) => ({ name: 'text.add', params: { time: t, text: 'Title' } })))
    S().rippleDeleteMany([[20, 21.5]])
    out.replay = ms(() => void currentDraft())
    assert.equal(draftState()?.entries.length, 2)
    assert.ok(draftState()!.outcomes.every((o) => o.applied), 'every op still applies after the user\'s cut')
    rejectDraft()
    unwatch()
    // Memory: the projects of 8 versions in a row (each a user cut), kept.
    const kept: Project[] = []
    const before = process.memoryUsage().heapUsed
    let cur = p
    for (let i = 0; i < 8; i++) {
      cur = applyBatch(cur, [{ name: 'timeline.cutRanges', params: { ranges: [[30 + i * 40, 31 + i * 40]] } }]).project
      kept.push(cur)
    }
    out.keep8MB = Math.round(((process.memoryUsage().heapUsed - before) / 1e6) * 10) / 10
    assert.equal(kept.length, 8)
    console.log(`SCALE ${label}`, JSON.stringify(out))
    assert.ok(out.cut300 < 20_000 && out.replay < 20_000, 'no blow-up')
  })
}

// Phase 4A.10 (A11, safety#4): one call's work is bounded — at most
// MAX_RANGES_PER_EDIT ranges and MAX_OPS_PER_EDIT ops. The heaviest calls
// those bounds allow, on the 2-hour talk: entering the draft, and the
// replay after a user's cut. (The numbers are in FAZ4A-PLAN.md 8.3; the
// ceiling here only catches a blow-up.)
test('scale: the heaviest call an edit may be (600 ranges in one op; 200 ops of 3 ranges) on the 2-hour talk', () => {
  const total = 7200
  const p = longTalk(total, 250, 1500)
  const all = ranges(total, MAX_RANGES_PER_EDIT)
  const out: Record<string, number> = {}
  const unwatch = watchLive()
  const shapes: [string, CommandCall[]][] = [
    ['one600', [{ name: 'timeline.cutRanges', params: { ranges: all } }]],
    ['ops200', Array.from({ length: MAX_OPS_PER_EDIT }, (_, i) => ({ name: 'timeline.cutRanges', params: { ranges: all.slice(i * 3, i * 3 + 3) } }))]
  ]
  for (const [name, calls] of shapes) {
    rejectDraft()
    S().loadProject(p)
    useAgentStore.getState().setMode('draft')
    out[name] = ms(() => void draftCalls('s1', 'scale', calls))
    assert.ok(draftState()!.outcomes.every((o) => o.applied), `${name}: every op applies`)
    S().rippleDeleteMany([[20, 21.5]])
    out[`${name}Replay`] = ms(() => void currentDraft())
    assert.ok(draftState()!.outcomes.every((o) => o.applied), `${name}: every op still applies after the user's cut`)
    rejectDraft()
  }
  unwatch()
  console.log('SCALE heaviest call', JSON.stringify(out))
  // (Measured: 1.8 s for the one op, 19 s for the 200. The server waits
  // 150 s for a call — agent-host.ts CALL_TIMEOUT_MS — 10 s of it margin.)
  for (const [k, v] of Object.entries(out)) assert.ok(v < 90_000, `${k}: ${v} ms (a call is given 150 s)`)
})
