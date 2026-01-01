// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Ç2c patch, item 3 (auditors' probe "GONE WHOLE … rotate90-off"): with the
// lossless keys every piece of a clip carries its whole key list, so a user's
// edit that changes only keys outside a piece's window (rotate 90 turns every
// rotation key) is a change of that piece. The agent's K1 check compared only
// the keys inside the window both pieces show, saw nothing, and the agent's
// shortening deleted the piece the user had just restyled. It must be dropped
// with its reason instead.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { type Asset, type Clip, type Project } from '../renderer/src/types'
import { currentDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool } from '../renderer/src/agent/edit'
import { clipDiffers } from '../renderer/src/agent/replay'
import { clipOf, ctxOf, open, read, talk, videoAsset } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => { rejectDraft(); unwatch() })
const user = (name: string, params: unknown): void => void S().runBatch([{ name, params }] as never)
const edit = (ops: Record<string, unknown>[], base: string): Promise<string> => editTool({ ops, base }, ctxOf())

function withB(keys: 'off' | 'in'): Project {
  const p = talk(30, true)
  p.assets.push({ ...videoAsset('b', 30), hasAudio: false } as Asset)
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b1'] })
  p.clips.b1 = clipOf('b1', 'b', 'V2', 8, 0, 6)
  p.clips.b1.channels = (keys === 'off'
    ? { rotation: [{ id: 'r1', time: 0.5, value: 0 }, { id: 'r2', time: 5.5, value: 1 }] }
    : { rotation: [{ id: 'r1', time: 0.5, value: 0 }, { id: 'r2', time: 3, value: 1 }, { id: 'r3', time: 5.5, value: 0 }] }) as never
  return p
}
const mid = (): string => Object.values(S().project.clips).find((c) => c.assetId === 'b' && Math.abs(c.start - 10) < 1e-6)!.id

for (const how of ['grade', 'rotate90-off', 'rotate90-in'] as const) {
  test(`item 3: the agent's trimEnd does not delete the middle piece the user restyled (${how})`, async () => {
    open(withB(how === 'rotate90-in' ? 'in' : 'off'))
    await edit([{ op: 'clip.trimEnd', clipId: 'b1', delta: -5 }], read())
    user('clip.split', { clipIds: ['b1'], time: 10 })
    const right = Object.values(S().project.clips).find((c) => c.assetId === 'b' && c.id !== 'b1')!.id
    user('clip.split', { clipIds: [right], time: 12 })
    const m = mid()
    if (how === 'grade') S().setClipGrade(m, { brightness: 0, contrast: 0, saturation: -1, warmth: 0 })
    else S().rotate90(m)
    const o = currentDraft()!.outcomes[0]
    const d = currentDraft()!.project
    assert.ok(d.clips[m], 'the piece the user changed is still in the draft')
    assert.equal(o.applied, false, 'the agent op is dropped')
    assert.ok((o.reason ?? '').length > 0, 'with its reason')
    rejectDraft()
  })
}

test('item 3: clipDiffers sees keys changed outside the window both pieces show', () => {
  const a = clipOf('a', 'b', 'V2', 10, 2, 2) as Clip
  a.channels = { rotation: [{ id: 'r1', time: -1.5, value: 0 }, { id: 'r2', time: 3.5, value: 1 }] }
  const b = structuredClone(a)
  assert.deepEqual(clipDiffers(a, b, true), [], 'the same keys: no difference')
  const piece = structuredClone(a)
  piece.id = 'p'
  piece.start = 11
  piece.inPoint = 3
  piece.duration = 1
  piece.channels = { rotation: [{ id: 'x1', time: -2.5, value: 0 }, { id: 'x2', time: 2.5, value: 1 }] }
  assert.deepEqual(clipDiffers(a, piece, true), [], 'a cut piece carries the same list at the same source seconds')
  b.channels!.rotation![1].value = 1 + Math.PI / 2
  assert.deepEqual(clipDiffers(a, b, true), ['channels'], 'a key off the window changed')
  piece.channels!.rotation![0].value = 2
  assert.deepEqual(clipDiffers(a, piece, true), ['channels'], 'a key off both windows changed')
})
