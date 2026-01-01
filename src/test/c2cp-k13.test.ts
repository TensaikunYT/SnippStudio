// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 8 (auditors' probes "K13 direct", "K13 via agent"): the
// refusal of a static value on a keyframed channel tells the agent what to do
// (the channel is keyframed, the change was not applied, it can leave it to
// the user), and `clip.set` applies its other fields, refusing only the keyed
// channel and saying which — on its first run and when the draft is played
// again after the user keyed that channel.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { type Asset, type Project } from '../renderer/src/types'
import { CommandError, commandByName, runCommand } from '../renderer/src/commands'
import { currentDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool, runEdit } from '../renderer/src/agent/edit'
import { clipOf, ctxOf, open, read, talk, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => { rejectDraft(); unwatch() })
const edit = (ops: Record<string, unknown>[], base: string): Promise<string> => editTool({ ops, base }, ctxOf())

function withB(keyed: boolean): Project {
  const p = talk(30, true)
  p.assets.push({ ...videoAsset('b', 30), hasAudio: true } as Asset)
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'b', 'V2', 8, 0, 6)
  if (keyed) p.clips.b1.channels = { rotation: [{ id: 'r1', time: 0.5, value: 0 }, { id: 'r2', time: 3, value: 1 }] }
  return p
}
const SAYS = /rotation is keyframed.*not applied.*leave it to the user/

test('item 8: the refusal says the channel is keyframed, that nothing was applied and that it can be left to the user', () => {
  const p = withB(true)
  assert.throws(() => runCommand(p, commandByName('clip.setTransform'), { clipId: 'b1', transform: { rotation: 0.3 } }), (e: unknown) => e instanceof CommandError && SAYS.test(e.message))
  assert.throws(() => runCommand(p, commandByName('clip.set'), { clipId: 'b1', transform: { rotation: 0.3 } }), (e: unknown) => e instanceof CommandError && SAYS.test(e.message))
})

test('item 8: clip.set by name applies its other fields and leaves the keyed channel', () => {
  const p = withB(true)
  const q = runCommand(p, commandByName('clip.set'), { clipId: 'b1', transform: { rotation: 0.3, x: 50 }, volume: 0.5 }).project
  assert.equal(q.clips.b1.volume, 0.5)
  assert.equal(q.clips.b1.transform.x, 50, 'an unkeyed channel of the same transform is set')
  assert.equal(q.clips.b1.transform.rotation, 0, 'the keyed one is not')
})

test('item 8: the agent\'s clip.set on a keyed clip is applied but for the keyed channel, and says which', async () => {
  open(withB(true))
  await edit([{ op: 'clip.set', clipId: 'b1', transform: { rotation: 0.3 }, volume: 0.5 }], read())
  const o = currentDraft()!.outcomes[0]
  assert.equal(o.applied, true, o.reason ?? '')
  assert.equal(currentDraft()!.project.clips.b1.volume, 0.5)
  assert.match((o.notes ?? []).join(' '), SAYS)
  rejectDraft()
})

test('item 8 (probe "K13 via agent"): a clip.set the user keyed a channel of since keeps its other fields', async () => {
  open(withB(false))
  await edit([{ op: 'clip.set', clipId: 'b1', transform: { rotation: 0.3 }, volume: 0.5 }], read())
  assert.equal(currentDraft()!.outcomes[0].applied, true)
  S().setTime(9)
  S().addPropKeyframe('b1', 'rotation')
  const o = currentDraft()!.outcomes[0]
  const b = currentDraft()!.project.clips.b1
  assert.equal(o.applied, true, o.reason ?? '')
  assert.equal(b.volume, 0.5, 'the volume is still set')
  assert.ok(b.channels?.rotation?.length, 'the user\'s key is there')
  assert.match((o.notes ?? []).join(' '), SAYS)
  rejectDraft()
})

test('item 8 (probe "K13 direct"): a refused setTransform is dropped with the words', async () => {
  open(withB(true))
  const r = await runEdit({ ops: [{ op: 'clip.setTransform', clipId: 'b1', transform: { rotation: 0.3 } }], base: read() }, ctxOf())
  assert.equal(r.outcomes[0].applied, false)
  assert.match(r.outcomes[0].reason ?? '', SAYS)
  rejectDraft()
})
