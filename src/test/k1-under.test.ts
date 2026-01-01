// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase Ç2 (closing, mutation Q13): K1's "the value under the
// draft" rule as a plain scenario. A later call of the session rewrites a
// field its own waiting first call wrote; the user accepts only the later
// call. The first call's write is then not in force, the field holds the live
// value from under the draft, and that value is nobody else's change: the
// later call lands. (Until now only a short oracle run saw this rule.)
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { acceptDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { ctxOf, open, read, talk } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => {
  rejectDraft()
  unwatch()
})

const edit = (ops: Record<string, unknown>[], base: string): Promise<string> => editTool({ ops, base }, ctxOf())

test("K1 (mutation Q13): a delete written on the session's own waiting volume lands when only the delete is accepted", async () => {
  open(talk(20))
  await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.5 }], read())
  // (Read again: the draft's view, where the volume is the first call's 0.5.
  // At the accept the first call is not in force and the clip holds the live
  // 1 from under the draft: no one else's change is lost with the clip.)
  await edit([{ op: 'clip.delete', ids: ['c1'] }], read())
  const out = acceptDraft([2], 'now')
  assert.deepEqual(out.applied, ['2:0'], JSON.stringify(out.dropped))
  assert.equal(S().project.clips.c1, undefined)
  rejectDraft()
})

test('K1 (mutation Q13, the other side): under the same accept, a volume the USER set since is not deleted with the clip', async () => {
  open(talk(20))
  await edit([{ op: 'clip.setVolume', clipId: 'c1', volume: 0.5 }], read())
  await edit([{ op: 'clip.delete', ids: ['c1'] }], read())
  void S().runBatch([{ name: 'clip.setVolume', params: { clipId: 'c1', volume: 0.2 } }] as never)
  const out = acceptDraft([2], 'now')
  assert.deepEqual(out.applied, [], "the clip with the user's 0.2 stays")
  assert.equal(S().project.clips.c1.volume, 0.2)
  rejectDraft()
})
