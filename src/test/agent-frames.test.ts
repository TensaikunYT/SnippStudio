// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (FAZ4A-YENIDEN.md A0–A3): an agent's seconds mean
// something only in the version it read. Every op is read there as content
// and applied where that content is now; what cannot be found is dropped
// with its reason, never applied "as it is". These tests look at WHICH
// material is left (the source seconds the clips still show, the word a title
// sits on), not at how many seconds went. (They replace the tests of the
// time-carrying of phase 4A.8.)
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { isSubtitle, type Project } from '../renderer/src/types'
import { editTool, runEdit } from '../renderer/src/agent/edit'
import { currentDraft, draftState, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import type { AnalysisResult, Item } from '../renderer/src/agent/answers'
import type { CommandCall } from '../renderer/src/commands'
import { flattenWords } from '../renderer/src/analysis/words'
import { findRepeats } from '../renderer/src/analysis/repeats'
import { haveTalk, talkProject, type Truth } from './talk-fixture'
import { ctxOf, kept, open, read, shown, talk } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

/** A result whose apply cuts its items' ranges, as analyze makes them: it
 *  keeps the project it was measured on. */
function cutResult(id: string, kind: string, ranges: [number, number][], token: string, project: Project): AnalysisResult {
  const items: Item[] = ranges.map((r) => ({ line: `${r[0]}-${r[1]}`, range: r, cut: r }))
  return { id, kind, token, project, head: '', items, apply: (chosen) => (chosen.length ? [{ name: 'timeline.cutRanges', params: { ranges: chosen.map((i) => i.cut!) } } as CommandCall] : []) }
}

// ---- base is required ---------------------------------------------------------

test('base is required: an edit without it, with a made-up one, or with one of a rejected draft is refused with a sentence', async () => {
  open(talk(20, true))
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }] }, ctxOf()), /base is required: the v of the read/)
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }], base: 'abcde-99' }, ctxOf()), /too old or not one you were given here: read again/)
  const v0 = read()
  await editTool({ ops: [{ op: 'marker.add', time: 1 }], base: v0 }, ctxOf())
  const d1 = read()
  assert.notEqual(d1, v0, 'a read now shows the draft')
  rejectDraft()
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 2 }], base: d1 }, ctxOf()), /belongs to a draft that was rejected/)
  // The live version it read before is still good.
  assert.match(await editTool({ ops: [{ op: 'marker.add', time: 2 }], base: v0 }, ctxOf()), /^Draft started/)
  rejectDraft()
})

test('the edit answer names no version (a base is the v of a READ); a refusal changes nothing', async () => {
  open(talk(20, true))
  const v0 = read()
  const ok = await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], base: v0 }, ctxOf())
  assert.doesNotMatch(ok, /\bv [0-9a-z]+-\d+/, ok)
  const before = draftState()!.version
  await assert.rejects(editTool({ ops: [{ op: 'no.such', x: 1 }], base: v0 }, ctxOf()), /nothing was applied/)
  assert.equal(draftState()!.version, before)
  assert.equal(draftState()!.entries.length, 1)
  rejectDraft()
})

test('only the last 8 versions a client was given are kept; an older base is "too old: read again"', async () => {
  open(talk(20, true), 'direct')
  const first = read()
  for (let i = 0; i < 8; i++) {
    S().runBatch([{ name: 'marker.add', params: { time: i + 1 } }])
    read()
  }
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 3 }], base: first }, ctxOf()), /too old or not one you were given here/)
  // A base that is used stays (it is the last to be forgotten).
  const mine = read()
  for (let i = 0; i < 6; i++) {
    S().runBatch([{ name: 'marker.add', params: { time: 10 + i } }])
    read()
    await editTool({ ops: [{ op: 'marker.add', time: 15, note: `n${i}` }], base: mine }, ctxOf())
  }
  assert.equal(S().project.markers?.filter((m) => m.note?.startsWith('n')).length, 6)
})

// ---- T1: several ops in ONE edit ------------------------------------------------

const have10 = haveTalk('ham-10dk-tr')

/** The rough cut of the 10-minute talk: the inserted silences (as the truth
 *  cuts them: 0.15 s left each side) and the finder's retakes. */
function roughCut(project: Project, truth: Truth, token: string): AnalysisResult[] {
  const sil = truth.segments.filter((s) => s.type === 'silence').map((s) => [+(s.start + 0.15).toFixed(3), +(s.end - 0.15).toFixed(3)] as [number, number]).filter(([a, b]) => b - a > 0.05)
  const words = flattenWords(project.captions.filter(isSubtitle))
  const rep = findRepeats(words).map((f) => f.cut)
  return [cutResult('r1', 'silences', sil, token, project), cutResult('r2', 'repeats', rep, token, project)]
}

/** Words of the truth that were cut (more than half of them gone) but should
 *  stay (not in a first take), and first-take words that stayed. */
function judge(p: Project, truth: Truth): { wronglyCut: string[]; leftInDroppedTake: number } {
  const k = kept(p)
  const dropTakes = truth.segments.filter((s) => s.type === 'repeat').map((s) => truth.segments[s.retakeOf!])
  const inDrop = (w: { start: number; end: number }): boolean => dropTakes.some((s) => w.start >= s.start - 1e-3 && w.end <= s.end + 1e-3)
  const wronglyCut: string[] = []
  let leftInDroppedTake = 0
  for (const w of truth.words) {
    const frac = shown(k, w.start, w.end) / Math.max(1e-6, w.end - w.start)
    if (inDrop(w)) {
      if (frac > 0.5) leftInDroppedTake++
    } else if (frac < 0.5) wronglyCut.push(`${w.text}@${w.start}`)
  }
  return { wronglyCut, leftInDroppedTake }
}

test('T1: [apply silences, apply repeats] in ONE edit cuts what separate edits cut, and only the right words', { skip: !have10 && 'no test material' }, async () => {
  const { project, truth } = talkProject('ham-10dk-tr')
  open(project)
  const v0 = read()
  const one = roughCut(S().project, truth, v0)
  await editTool({ ops: one.map((r) => ({ op: 'apply', result: r.id })), base: v0 }, ctxOf({ results: new Map(one.map((r) => [r.id, r])) }))
  const oneCall = kept(draftState()!.project)
  const j1 = judge(draftState()!.project, truth)
  // Separate calls, all with the version the numbers were read in.
  open(project)
  const w0 = read()
  const sep = roughCut(S().project, truth, w0)
  const ctx = ctxOf({ results: new Map(sep.map((r) => [r.id, r])) })
  for (const r of sep) await editTool({ ops: [{ op: 'apply', result: r.id }], base: w0 }, ctx)
  const separate = kept(draftState()!.project)
  rejectDraft()
  assert.deepEqual(j1.wronglyCut.slice(0, 10), [], `${j1.wronglyCut.length} words cut that should stay`)
  assert.equal(j1.leftInDroppedTake, 0, 'every word of a dropped take is gone')
  assert.equal(oneCall.length, separate.length, 'the same pieces')
  for (let i = 0; i < oneCall.length; i++) {
    assert.ok(Math.abs(oneCall[i][0] - separate[i][0]) < 1e-6 && Math.abs(oneCall[i][1] - separate[i][1]) < 1e-6, `piece ${i}: ${oneCall[i]} vs ${separate[i]}`)
  }
})

test('T1: [cutRanges, text.add on a word] in one edit puts the title on that word; a time inside the cut is dropped, said', async () => {
  open(talk(20, true))
  const v0 = read()
  const r = await runEdit({ ops: [{ op: 'timeline.cutRanges', ranges: [[1, 2]] }, { op: 'text.add', time: 'L2#1', text: 'Here' }, { op: 'marker.add', time: 1.5, note: 'gone' }], base: v0 }, ctxOf())
  const p = draftState()!.project
  const title = p.captions.find((c) => c.text === 'Here')!
  const go = p.captions.find((c) => c.id === 'L2')!.words![1]
  rejectDraft()
  assert.ok(Math.abs(title.start - go.start) < 1e-6, `title at ${title.start}, "go" at ${go.start}`)
  assert.deepEqual(r.outcomes.map((o) => o.applied), [true, true, false])
  assert.match(r.text, /Dropped \(the rest was applied\):\n#3 marker\.add: the footage at its time was cut by your own op #1 \(timeline\.cutRanges\): place it on the take that stays/)
})

test('two calls on one read: the second needs no new read (its seconds are still the first read\'s)', async () => {
  open(talk(20, true))
  const v0 = read()
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[3, 5]] }], base: v0 }, ctxOf())
  // 10–12 of what it READ: source 10–12, now at 8–10 of the draft.
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }, { op: 'text.add', time: 'L2#2', text: 'On' }], base: v0 }, ctxOf())
  const p = draftState()!.project
  rejectDraft()
  assert.deepEqual(kept(p), [[0, 3], [5, 10], [12, 20]])
  const on = p.captions.find((c) => c.id === 'L2')!.words![2]
  assert.ok(Math.abs(p.captions.find((c) => c.text === 'On')!.start - on.start) < 1e-6)
})

// ---- the user edits while a draft waits (D2) -----------------------------------

test('D2: the user takes back their own cut while a draft waits: the draft\'s cut stays on the material it named', async () => {
  open(talk(20, true))
  S().rippleDeleteMany([[3, 5]])
  const v1 = read()
  // 10–12 of the cut timeline: source 12–14.
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], base: v1 }, ctxOf())
  S().undo()
  const d = currentDraft()!
  assert.equal(d.outcomes[0].applied, true)
  assert.equal(shown(kept(d.project), 12, 14), 0, 'source 12–14 is cut')
  assert.equal(shown(kept(d.project), 3, 5), 2, 'what the user brought back is left alone')
  assert.equal(shown(kept(d.project), 10, 12), 2)
  rejectDraft()
})

test('D2: the user drags the clip while a draft waits: cut and title follow the footage (nothing is dropped)', async () => {
  open(talk(20, true))
  const v0 = read()
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }, { op: 'text.add', time: 6.5, text: 'Go', id: 'go' }], base: v0 }, ctxOf())
  S().runBatch([{ name: 'clip.move', params: { clipId: 'c1', start: 4 } }])
  const d = currentDraft()!
  assert.deepEqual(d.outcomes.map((o) => o.applied), [true, true])
  assert.deepEqual(kept(d.project), [[0, 10], [12, 20]])
  assert.ok(Math.abs(d.project.captions.find((c) => c.text === 'Go')!.start - 10.5) < 1e-6, 'the title is on source 6.5, now at 10.5')
  rejectDraft()
})

test('a cut whose footage the user deleted is dropped ("already cut"), and comes back when they undo', async () => {
  open(talk(20, true))
  const v0 = read()
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }, { op: 'marker.add', time: 2, note: 'm' }], base: v0 }, ctxOf())
  S().rippleDeleteMany([[9, 13]])
  let d = currentDraft()!
  assert.equal(d.outcomes[0].applied, false)
  assert.match(d.outcomes[0].reason!, /already cut: its footage is no longer on the timeline/)
  assert.equal(d.outcomes[1].applied, true, 'the marker stays')
  S().undo()
  d = currentDraft()!
  assert.equal(d.outcomes[0].applied, true, 'not dropped for good')
  assert.deepEqual(kept(d.project), [[0, 10], [12, 20]])
  rejectDraft()
})

// ---- an old base (D3, V-edit-frames-2, -5) ---------------------------------------

test('D3: an edit with an old base after the user dragged the clip is applied to the footage it named, not at the old seconds', async () => {
  open(talk(20, true), 'direct')
  const v0 = read()
  S().runBatch([{ name: 'clip.move', params: { clipId: 'c1', start: 5 } }])
  const r = await runEdit({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], base: v0 }, ctxOf())
  assert.equal(r.outcomes[0].applied, true)
  assert.deepEqual(kept(S().project), [[0, 10], [12, 20]])
})

test('V-edit-frames-2: a word number of an old base means the word it was there', async () => {
  open(talk(20, true), 'direct')
  const v0 = read()
  // The user cuts "we" out: L2 is "go on" now, and "#1" of today is "on".
  S().rippleDeleteMany([[5.95, 6.45]])
  await editTool({ ops: [{ op: 'text.add', time: 'L2#1>', text: 'Go!', id: 'g' }], base: v0 }, ctxOf())
  const p = S().project
  const go = p.captions.find((c) => c.id === 'L2')!.words!.find((w) => w.text === 'go')!
  assert.ok(Math.abs(p.captions.find((c) => c.text === 'Go!')!.start - go.end) < 1e-6, 'at the end of "go"')
})

test('V-edit-frames-5: a range of a word and a second is one range of the base: both ends follow', async () => {
  open(talk(20, true), 'direct')
  const v0 = read()
  S().rippleDeleteMany([[0.1, 0.9]])
  // ["L2#0", 7.5] of v0: source 6–7.5.
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [['L2#0', 7.5]] }], base: v0 }, ctxOf())
  assert.deepEqual(kept(S().project), [[0, 0.1], [0.9, 6], [7.5, 20]])
})

test('D3: an analyze result is read in the version it was measured on, whatever happened since', async () => {
  open(talk(20, true), 'direct')
  const v0 = read()
  const r1 = cutResult('r1', 'silences', [[10, 12]], v0, S().project)
  S().runBatch([{ name: 'clip.move', params: { clipId: 'c1', start: 3 } }])
  S().rippleDeleteMany([[4, 5]])
  const v2 = read()
  const r = await runEdit({ ops: [{ op: 'apply', result: 'r1' }], base: v2 }, ctxOf({ results: new Map([['r1', r1]]) }))
  assert.equal(r.outcomes[0].applied, true)
  assert.deepEqual(kept(S().project), [[0, 1], [2, 10], [12, 20]])
})
