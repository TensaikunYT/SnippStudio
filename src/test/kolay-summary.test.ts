// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent job's summary (KOLAY-PLAN.md, item 4): the review's own change
// kinds, in five groups; the length before and after; the project each call
// met, recorded as the call starts (before its edit runs).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { GROUP_OF, GROUPS, countChanges, projectMetBy, summaryOf, watchCalls } from '../renderer/src/components/agent/job-summary'
import { useAgentStore } from '../renderer/src/agent/store'
import { useStore } from '../renderer/src/state/store'
import { clipOf, talk } from './agent-kit'

test('summary: every change kind is in one of the five groups', () => {
  const kinds = ['gap', 'cut', 'move', 'track', 'add', 'remove', 'trim', 'slip', 'split', 'set', 'transition', 'title', 'line', 'lines', 'tracks', 'markers', 'other'] as const
  for (const k of kinds) assert.ok(GROUPS.includes(GROUP_OF[k]), k)
  assert.deepEqual(Object.keys(GROUP_OF).sort(), [...kinds].sort())
  // (A row with no sentence of its own, a linked partner, is not counted.)
  assert.deepEqual(countChanges([{ key: 'x', params: {}, at: 0, kind: 'move' }, { key: '', params: {}, at: 0, kind: 'move' }, { key: 'y', params: {}, at: 0, kind: 'split' }]), { cut: 1, move: 1, add: 0, remove: 0, set: 0 })
})

test('summary: a deleted clip, a moved one and a volume; the length before and after', () => {
  const before = talk(20)
  const v1 = before.tracks[0]
  const v2 = before.tracks.find((t) => t.kind === 'video' && t.id !== v1.id) ?? before.tracks[1]
  before.clips.c2 = clipOf('c2', 'a1', v1.id, 20, 0, 5)
  before.clips.c3 = clipOf('c3', 'a1', v2.id, 2, 0, 3)
  v1.clipIds = ['c1', 'c2']
  v2.clipIds = [...v2.clipIds, 'c3']
  const after = structuredClone(before)
  delete after.clips.c3
  after.tracks.find((t) => t.id === v2.id)!.clipIds = after.tracks.find((t) => t.id === v2.id)!.clipIds.filter((id) => id !== 'c3')
  after.clips.c2.start += 30
  after.clips.c1.volume = 0.5
  const s = summaryOf(before, after)
  assert.equal(s.counts.remove, 1)
  assert.equal(s.counts.move, 1)
  assert.equal(s.counts.set, 1)
  assert.equal(s.total, 3)
  assert.ok(s.after > s.before!, 'moved 30 s on: longer')
  assert.deepEqual(summaryOf(before, before).counts, { cut: 0, move: 0, add: 0, remove: 0, set: 0 })
  assert.equal(summaryOf(null, after).before, null)
})

test('summary: the project a call met is the one before its edit', () => {
  watchCalls()
  useStore.getState().loadProject(talk(20))
  const met = useStore.getState().project
  useAgentStore.getState().callStarted({ id: 'kolay-call-1', session: 's1', tool: 'edit', client: 'claude-code', defsChars: 0 } as never)
  const id = Object.keys(met.clips)[0]
  useStore.getState().runBatch([{ name: 'clip.setVolume', params: { clipId: id, volume: 0.25 } }] as never)
  assert.equal(projectMetBy('kolay-call-1'), met)
  assert.notEqual(useStore.getState().project, met)
  assert.equal(projectMetBy('nothing'), null)
})
