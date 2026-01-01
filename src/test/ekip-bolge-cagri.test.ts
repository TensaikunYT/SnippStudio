// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The team mode, step 3 (EKIP-3-PLAN.md §2): taking a region is an op of the
// edit tool. Through the tool itself (the store, the draft): a claim, a
// refused one, two workers writing on the same version, and a session that
// takes no region answering the very bytes it answered before.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Project } from '../renderer/src/types'
import { contextFor, currentDraft, rejectDraft } from '../renderer/src/agent/drafts'
import { editTool, regionOps } from '../renderer/src/agent/edit'
import { forgetRegions, regionsFor } from '../renderer/src/agent/region-state'
import { placedIn } from '../renderer/src/agent/regions'
import { useAgentStore } from '../renderer/src/agent/store'
import { clipOf, ctxOf, open, read, videoAsset } from './agent-kit'

test.after(() => rejectDraft())

/** Four clips of talk (5 s each) and three pictures over them. */
function film(): Project {
  const p = defaultProject()
  p.assets = [videoAsset('a1', 600), { ...videoAsset('a2', 60), hasAudio: false }]
  const v1 = p.tracks[0]
  p.tracks.unshift({ id: 'V2', kind: 'video', name: 'V2', clipIds: ['b0', 'b2', 'b3'] })
  for (let i = 0; i < 4; i++) {
    p.clips[`v${i}`] = clipOf(`v${i}`, 'a1', v1.id, i * 5, i * 5 + i, 5)
    v1.clipIds.push(`v${i}`)
  }
  p.clips.b0 = clipOf('b0', 'a2', 'V2', 1, 0, 1, { volume: 0 })
  p.clips.b2 = clipOf('b2', 'a2', 'V2', 11, 0, 1, { volume: 0 })
  p.clips.b3 = clipOf('b3', 'a2', 'V2', 16, 0, 1, { volume: 0 })
  return p
}
const as = (name?: string): ReturnType<typeof ctxOf> => ctxOf(name ? { as: name } : {})
const clear = (): void => {
  forgetRegions('s1')
  useAgentStore.getState().setRegions('test', [])
}

test('a call with no region op is not a region call; a session that took none has none in its replay', () => {
  assert.equal(regionOps([{ op: 'timeline.cutRanges', ranges: [[1, 2]] }, { op: 'apply', result: 'r1' }]), null)
  assert.equal(regionOps(undefined), null)
  assert.equal(regionOps([{ op: 'help', names: ['clip.slip'] }]), null)
  open(film())
  clear()
  assert.equal('regions' in contextFor('s1', 'test'), false)
})

test('claim, refused claim, release', async () => {
  open(film())
  clear()
  const v = read()
  const took = await editTool({ ops: [{ op: 'region.claim', range: [0, 10] }], base: v }, as('kesim'))
  assert.equal(took, 'Region 0.00–10.00 s is "kesim"\'s: only its ops change what is inside, and they hold while other workers cut or add elsewhere.')
  assert.equal(currentDraft(), null, 'a claim alone makes no draft')
  assert.equal(regionsFor('test').length, 1)
  // Another worker's stretch: refused whole, and whose it is.
  await assert.rejects(editTool({ ops: [{ op: 'region.claim', range: [8, 12] }, { op: 'clip.setVolume', clipId: 'b2', volume: 0.5 }], base: v }, as('altyazi')), /^Error: region\.claim: 8\.00–12\.00 s is taken: worker "kesim" has 0\.00–10\.00 s; nothing was applied\. Take a stretch outside it\.$/)
  assert.equal(regionsFor('test').length, 1)
  assert.equal(currentDraft(), null)
  // A region belongs to a worker; the stretch must be one.
  await assert.rejects(editTool({ ops: [{ op: 'region.claim', range: [10, 20] }], base: v }, as()), /a region belongs to a worker: send the call with as:"<name>"/)
  await assert.rejects(editTool({ ops: [{ op: 'region.claim', range: [12, 10] }], base: v }, as('altyazi')), /"range": \[start, end\]/)
  await assert.rejects(editTool({ ops: [{ op: 'region.claim', range: [10, 20], tracks: ['V9'] }], base: v }, as('altyazi')), /there is no track "V9"/)
  // On other tracks the same seconds are free; by name or id.
  assert.match(await editTool({ ops: [{ op: 'region.claim', range: [10, 20], tracks: ['V2'] }], base: v }, as('altyazi')), /^Region 10\.00–20\.00 s on tracks V2 is "altyazi"'s/)
  // A new claim replaces the worker's own; release gives it back.
  assert.match(await editTool({ ops: [{ op: 'region.claim', range: [10, 20] }], base: v }, as('altyazi')), /^Region 10\.00–20\.00 s is "altyazi"'s/)
  assert.equal(regionsFor('test').length, 2)
  assert.equal(await editTool({ ops: [{ op: 'region.release' }], base: v }, as('altyazi')), 'Region released ("altyazi").')
  assert.equal(await editTool({ ops: [{ op: 'region.release' }], base: v }, as('altyazi')), '"altyazi" had no region.')
  assert.deepEqual(regionsFor('test').map((r) => r.as), ['kesim'])
  // The session ends: its regions go.
  forgetRegions('s1')
  assert.equal(regionsFor('test').length, 0)
})

test('two workers write on the same version: both apply; one writing in the other\'s region is told whose it is', async () => {
  open(film())
  clear()
  const v = read()
  // (A claim and ops in one call: the region first.)
  const a = await editTool({ ops: [{ op: 'region.claim', range: [0, 10] }, { op: 'timeline.cutRanges', ranges: [[3, 4.5]] }], base: v }, as('kesim'))
  assert.match(a, /^Region 0\.00–10\.00 s is "kesim"'s[^\n]*\n/)
  await editTool({ ops: [{ op: 'region.claim', range: [10, 20] }], base: v }, as('altyazi'))
  // altyazi's move is written on v, before kesim's cut: its region moved whole.
  const b = await editTool({ ops: [{ op: 'clip.move', clipId: 'b2', start: 13 }], base: v }, as('altyazi'))
  assert.doesNotMatch(b, /dropped|not applied|Nothing applied/i, b)
  assert.equal(currentDraft()!.project.clips.b2.start, 11.5)
  assert.equal(currentDraft()!.outcomes.every((o) => o.applied), true)
  // The regions were carried to the draft as it is now.
  assert.deepEqual(regionsFor('test').map((r) => [r.as, placedIn(r, currentDraft()!.project)]), [['kesim', [0, 8.5]], ['altyazi', [8.5, 18.5]]])
  // kesim writes into altyazi's region: not applied, and whose region.
  const c = await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'b3', volume: 0.4 }], base: v }, as('kesim'))
  assert.match(c, /it changes what is inside the region of worker "altyazi" \(8\.50–18\.50 s\): not applied\. Only that worker writes there/)
  assert.equal(currentDraft()!.project.clips.b3.volume, 0)
  rejectDraft()
  clear()
})

test('a session that takes no region: the answers are the bytes they were', async () => {
  // The same calls, labelled, (1) with no region anywhere and (2) while
  // ANOTHER program holds regions: nothing of a region reaches them.
  const calls = async (): Promise<string[]> => {
    open(film())
    const v = read()
    const out: string[] = []
    out.push(await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[3, 4.5]] }], base: v }, as('kesim')))
    out.push(await editTool({ ops: [{ op: 'clip.move', clipId: 'b2', start: 13 }], base: v }, as('altyazi')))
    out.push(await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'b3', volume: 0.4 }, { op: 'marker.add', time: 2 }], base: v }, as('kesim')))
    rejectDraft()
    // (A new marker's id is made from the draft's own salt: not compared.)
    return out.map((x) => x.replace(/[0-9a-f]{8}-[0-9a-f]{4}/g, 'ID'))
  }
  clear()
  const plain = await calls()
  // (The rule that was: the move written before the cut drops.)
  assert.match(plain[1], /its ids and times are of the version you read/)
  useAgentStore.getState().setRegions('other', [{ as: 'x', start: 0, end: 20, on: useStore.getState().project, session: 'o1', ps: -1 }])
  assert.deepEqual(await calls(), plain)
  useAgentStore.getState().setRegions('other', [])
})
