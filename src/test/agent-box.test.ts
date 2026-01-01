// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4B.2 / 4B.4: the command box's one selection line (the
// typed request went with the embedded session: TERMINAL-YOK-PLAN.md), the
// chip's working spell, the timeline's activity pictures and their timings,
// and the draft's marks in live seconds.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { clock, selectionText } from '../renderer/src/agent/command'
import { activityAt, FOUND_MS, LOOK_MS, READ_MIN_MS } from '../renderer/src/components/agent/AgentLayers'
import { marksOf } from '../renderer/src/agent/drafts'
import type { ToolEvent } from '../renderer/src/agent/store'
import type { Project } from '../renderer/src/types'

test('the selection is one line of ids, never content', () => {
  assert.equal(selectionText({ clips: ['c12', 'c13'], media: ['m3'], range: [40, 70.24], region: [10, 20.4, 40, 30] }), 'clips c12,c13; range 40.0-70.2s; media m3; region 10,20,40,30%')
  assert.equal(selectionText({ clips: [], media: [] }), '')
  const many = selectionText({ clips: Array.from({ length: 25 }, (_, i) => `c${i}`), media: [] })
  assert.match(many, /c19 \+5$/)
})

test('the clock on the chip', () => {
  assert.equal(clock(65_000), '01:05')
})

const ev = (o: Partial<ToolEvent> & { id: string; tool: string; started: number }): ToolEvent => ({ session: 's', done: false, ...o })

test('activity pictures: reading at least 600 ms, looking 1.5 s, found ranges for a while', () => {
  const t0 = 1_000
  const read = ev({ id: 'r', tool: 'transcript', started: t0, done: true, ms: 50, range: [1, 2] })
  assert.equal(activityAt([read], t0 + 100).reads.length, 1, 'a quick read still shows')
  assert.equal(activityAt([read], t0 + READ_MIN_MS - 1).reads.length, 1)
  assert.equal(activityAt([read], t0 + READ_MIN_MS + 1).reads.length, 0)
  assert.equal(activityAt([read], t0 + 100).next, t0 + READ_MIN_MS)
  const running = ev({ id: 'r2', tool: 'analyze', started: t0, done: false })
  assert.equal(activityAt([running], t0 + 99_999).reads.length, 1, 'shown while it runs')
  const look = ev({ id: 'f', tool: 'frames', started: t0, done: true, ms: 200, at: [3, 4] })
  assert.equal(activityAt([look], t0 + 200 + LOOK_MS - 1).looks.length, 1)
  assert.equal(activityAt([look], t0 + 200 + LOOK_MS + 1).looks.length, 0)
  const found = ev({ id: 'a', tool: 'analyze', started: t0, done: true, ms: 700, found: [[1, 2], [3, 4]] })
  assert.equal(activityAt([found], t0 + 700 + FOUND_MS).found.length, 1)
  assert.equal(activityAt([found], t0 + 700 + FOUND_MS + 200).found.length, 0)
})

test("the draft's marks are in live seconds: a later cut lies after the earlier ones put back", () => {
  const clip = (id: string, start: number, duration: number, inPoint = start): Project['clips'][string] => ({ id, trackId: 'v1', assetId: 'a1', start, duration, inPoint } as unknown as Project['clips'][string])
  const on = { clips: { k1: clip('k1', 0, 20) } } as unknown as Project
  // Two cut ops: 2–4 (live), then 6–7 in the project the first left (= 8–9 live).
  const outcomes = [{ seq: 1, index: 0, name: 'cut', command: 'timeline.cutRanges', applied: true, cuts: [[2, 4]] }, { seq: 2, index: 0, name: 'cut', command: 'timeline.cutRanges', applied: true, cuts: [[6, 7]] }] as never
  // The draft: two pieces of k1 (not "added") and one new picture.
  const project = { clips: { p1: clip('p1', 0, 2, 0), p2: clip('p2', 2, 15, 4), img: { id: 'img', trackId: 'v2', assetId: 'pic', start: 7, duration: 1, inPoint: 0 } }, assets: [{ id: 'pic', name: 'pic.png' }] } as unknown as Project
  const m = marksOf({ outcomes, project, on })
  assert.deepEqual(m.cuts, [[2, 4], [8, 9]])
  assert.deepEqual(m.ghosts.map((g) => [g.id, g.start, g.name]), [['img', 10, 'pic.png']])
})
