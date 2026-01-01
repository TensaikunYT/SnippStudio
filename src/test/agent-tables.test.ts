// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.10, part II (FAZ4A-PLAN.md 9, G): the tests the
// verification found blind (haritalar\_faz4a9-dogrulama.md, table#1–#7),
// made to break when the bug they name comes back, and the answer texts
// that sent the agent the wrong way (contract#11, liveness#6).
import './dom-stub'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { writeRestorePoint } from '../main/agent-restore'
import { useStore } from '../renderer/src/state/store'
import type { Caption, Clip } from '../renderer/src/types'
import { analyze, chosenItems } from '../renderer/src/agent/analyze'
import { changesFor, currentDraft, keptOf, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { editTool, runEdit } from '../renderer/src/agent/edit'
import { transcriptText } from '../renderer/src/agent/format'
import { dropLines } from '../renderer/src/agent/answers'
import { notesListText, touchedToLive } from '../renderer/src/agent/notes-tool'
import { planNoteUpdate } from '../renderer/src/notes/agent'
import { addNote } from '../renderer/src/notes/model'
import { ANALYSIS_WINDOW, setLoudnessReader } from '../renderer/src/audio/silence'
import { commandByName } from '../renderer/src/commands'
import { writeLinesOwnStep } from '../renderer/src/subtitles/write'
import { markStep, undoStep, type StepMark } from '../renderer/src/agent/jobs'
import { clipOf, ctxOf, draftCalls, open, read, talk } from './agent-kit'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())
const NEVER = { cancelled: () => false }
const r2 = (rs: readonly (readonly [number, number])[] | undefined): number[][] => (rs ?? []).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100])

// ---- table#1 --------------------------------------------------------------------

test('table#1 (D2 / V-rebuild-1): a line is found by its words — the user splits the line the agent deleted or coloured: dropped, never half of it', async () => {
  for (const op of [{ op: 'caption.delete', ids: ['L2'] }, { op: 'caption.setOwnStyle', id: 'L2', patch: { color: '#ff0000' } }]) {
    open(talk(20, true))
    await editTool({ ops: [op], base: read() }, ctxOf())
    S().splitCaptionAtCursor('L2', 'we go on', 3)
    const d = currentDraft()!
    assert.equal(d.outcomes[0].applied, false, `${op.op}: ${JSON.stringify(d.outcomes)}`)
    assert.match(d.outcomes[0].reason ?? '', /is not as you read it/)
    assert.ok(d.project.captions.some((c) => c.text === 'go on' && !c.style?.color), 'the other half untouched')
    rejectDraft()
  }
})

// ---- table#2, table#5 ---------------------------------------------------------------

test('table#2 / table#5: with a draft waiting, the notes tool lists note times in the draft\'s seconds and reads touched ranges in the same seconds', () => {
  const p = talk(30)
  addNote(p, { start: 20, end: 21, kind: 'free', text: 'fix this' }, new Date())
  open(p)
  draftCalls('s1', 'test', [{ name: 'timeline.cutRanges', params: { ranges: [[2, 4]] } }])
  const live = S().project
  const draft = currentDraft()!.project
  // The list: where the agent sees the note in what it reads.
  const listed = notesListText(live, draft, null, 'all')
  assert.match(listed, /#1 \[open\] 18\.00–19\.00 s/, listed)
  assert.match(listed, /timeline seconds of your draft/)
  assert.match(notesListText(live, live, null, 'all'), /#1 \[open\] 20\.00–21\.00 s/)
  // The agent answers in the seconds it was shown: the touched range lands
  // on the live note's material (20–21 live), not 2 s after it.
  const plan = planNoteUpdate(draft, { id: 1, status: 'ready', reply: 'done', touched: [[18, 19]] })
  touchedToLive(plan, draft, live)
  assert.deepEqual(r2(plan.touched), [[20, 21]])
  rejectDraft()
})

// ---- table#3 --------------------------------------------------------------------

test('table#3 (V-restore-transcribe-4): a delete that fails while the folder is pruned does not fail the write of the point', async () => {
  const userData = path.join(process.cwd(), 'out-test', 'restore-folders', `t3-${process.pid}-${Date.now()}`)
  let tried = 0
  const rm = async (): Promise<void> => {
    tried++
    throw Object.assign(new Error('EBUSY: held by a scanner'), { code: 'EBUSY' })
  }
  try {
    const names: string[] = []
    for (let i = 0; i < 8; i++) {
      const w = await writeRestorePoint(userData, `{"n":${i}}`, 'pt-fabc12345-s1', 1_700_000_000_000 + i, rm)
      assert.ok(w, `write ${i} succeeded although old points could not be deleted`)
      names.push(w!.name)
    }
    assert.ok(tried > 0, 'the pruning really tried to delete')
    const files = await fs.readdir(path.join(userData, 'agent-restore'))
    for (const n of names) assert.ok(files.includes(n))
  } finally {
    await fs.rm(userData, { recursive: true, force: true })
  }
})

// ---- table#4 --------------------------------------------------------------------

test('table#4 (V-analysis-tools-tests-3): speech with no words written, found by analyze itself, is uncertain — out of a plain apply, in with include', async () => {
  // "Saniyeler içinde patlamalar oldu." 1.0–3.0 s, then 3.5–5.4 s of speech
  // with no words, a pause, the next sentence at 7 s.
  const p = talk(12)
  const w = (text: string, start: number, end: number): { text: string; start: number; end: number } => ({ text, start, end })
  p.captions = [
    { id: 'c0', start: 1, end: 3, text: 'Saniyeler içinde patlamalar oldu.', words: [w('Saniyeler', 1, 1.5), w('içinde', 1.6, 2), w('patlamalar', 2.1, 2.6), w('oldu.', 2.7, 3)], soundClip: 'c1' },
    { id: 'c1x', start: 7, end: 8, text: 'Sonra bitti.', words: [w('Sonra', 7, 7.4), w('bitti.', 7.5, 8)], soundClip: 'c1' }
  ]
  const win = ANALYSIS_WINDOW
  const dbs = new Array(Math.ceil(12 / win)).fill(-60)
  const loud = (a: number, b: number): void => { for (let i = Math.round(a / win); i < Math.round(b / win); i++) dbs[i] = -20 }
  for (const c of p.captions) for (const x of c.words!) loud(x.start, x.end)
  loud(3.5, 5.4)
  const r = await analyze(p, { kind: 'repeats' }, 'r1', 'v-1', NEVER, { loudness: async (_p, clip) => (clip.id === 'c1' ? [...dbs] : null) })
  const n = r.items.findIndex((i) => /speech, no words/.test(i.line))
  assert.ok(n >= 0, r.items.map((i) => i.line).join('\n'))
  assert.equal(r.items[n].uncertain, true)
  assert.equal(chosenItems(r).length, 0, 'not in a plain apply')
  assert.equal(chosenItems(r, undefined, undefined, [n + 1]).length, 1, 'in with include')
})

// ---- table#7 --------------------------------------------------------------------

test('table#7 (V-limits-sessions-4): silences, fillers, repeats and preflight read a cut-up talk at ONE window: 80 pieces, 80 reads', async () => {
  const p = talk(60)
  const v1 = p.tracks[0]
  p.clips = {}
  v1.clipIds = []
  for (let i = 0; i < 80; i++) {
    p.clips[`k${i}`] = clipOf(`k${i}`, 'a1', v1.id, i * 0.5, i * 0.7, 0.5) as Clip
    v1.clipIds.push(`k${i}`)
  }
  const windows = new Map<number, number>()
  const undo = setLoudnessReader(async (_p, clip, win) => {
    windows.set(win, (windows.get(win) ?? 0) + 1)
    return new Array(Math.ceil(clip.duration / win)).fill(-30)
  })
  try {
    for (const kind of ['silences', 'fillers', 'repeats', 'preflight'] as const) await analyze(p, { kind, ...(kind === 'fillers' ? { words: 'well' } : {}) }, `r-${kind}`, 'v-1', NEVER)
    assert.deepEqual([...windows], [[ANALYSIS_WINDOW, 80]], 'each piece read once, at one window')
  } finally {
    undo()
  }
})

// ---- contract#11 ------------------------------------------------------------------

test('contract#11: errors name the right fix — "v " pasted with the base, the changes tool\'s own words, no note.* in the edit\'s list, one command name, a bad transcript range said as such', async () => {
  open(talk(20, true), 'direct')
  const token = read()
  // (1) The v pasted as the read prints it.
  assert.ok(keptOf('test', `v ${token}`))
  // A base that is no version: said so, with the agent's own last read as the example.
  assert.throws(() => keptOf('test', 'v5'), (e: Error) => e.message.includes(`"v5" is not a version`) && e.message.includes(token) && !/is required/.test(e.message))
  // (2) changes: about "since" and calling changes again, not about edit's base.
  assert.throws(() => changesFor('test', 'zzzzz-1'), (e: Error) => /call changes again/.test(e.message) && !/send the edit|base/.test(e.message))
  assert.throws(() => changesFor('test', 'nonsense'), (e: Error) => /^since "nonsense" is not a version/.test(e.message))
  // (3) An unknown op: the list holds what edit takes (notes: the notes tool).
  assert.throws(() => commandByName('marker.move'), (e: Error) => !/note\.add/.test(e.message))
  // (4) The command's name once.
  const bad = await editTool({ ops: [{ op: 'clip.setVolume', clipId: 'nope', volume: 0.5 }, { op: 'marker.add', time: 1 }], base: read() }, ctxOf())
  assert.doesNotMatch(bad, /clip\.setVolume: clip\.setVolume/, bad)
  // (Whatever path a reason comes by: one that starts with the name.)
  assert.deepEqual(dropLines([{ index: 2, name: 'clip.setTransition', command: 'clip.setTransition', applied: false, reason: 'clip.setTransition: there is no clip zz in the version you read' }]), ['#3 clip.setTransition: there is no clip zz in the version you read'])
  // (5) An apply that chooses nothing says which op and why.
  const r = await analyze(S().project, { kind: 'keywords' }, 'r1', read(), NEVER)
  const none = await runEdit({ base: read(), ops: [{ op: 'apply', result: 'r1', only: [] }] }, ctxOf({ results: new Map([['r1', r]]) })).catch((e: Error) => e.message)
  assert.match(typeof none === 'string' ? none : none.text, /#1 apply r1: .*(no item|only)/)
  // (6) A transcript range that is no stretch of the timeline is said so.
  assert.throws(() => transcriptText(S().project, token, { start: 25, end: 5 }), /0\.00–20\.00/)
  assert.throws(() => transcriptText(S().project, token, { start: 1000 }), /0\.00–20\.00/)
  rejectDraft()
})

// ---- liveness#6 --------------------------------------------------------------------

test('liveness#6: a structural op dropped because an earlier op of the call moved what it names says which op that was', async () => {
  open(talk(20, true), 'direct')
  const out = await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[2, 4]] }, { op: 'clip.move', clipId: 'c1', start: 3 }], base: read() }, ctxOf())
  assert.match(out, /#2 clip\.move: .*\(#1 timeline\.cutRanges of this call\)/, out)
})

// ---- E3 (safety#6) -------------------------------------------------------------

test('E3 (safety#6): a transcription\'s lines wait for a drag to end and are an undo step of their own; the notice\'s Undo takes back only them', async () => {
  open(talk(20, true), 'direct')
  const before = S().project.captions.map((c) => c.text).join('|')
  const depth0 = S().past.length
  S().beginGesture()
  S().moveClip('c1', 2)
  let mark: StepMark | null = null
  const lines = [{ id: 'n1', start: 3, end: 5, text: 'new words here', soundClip: 'c1' } as Caption]
  const writing = writeLinesOwnStep(() => lines, { afterWrite: () => void (mark = markStep()) }, 5)
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(mark, null, 'not written while the drag goes on')
  S().endGesture()
  await writing
  assert.equal(S().project.captions.map((c) => c.text).join('|'), 'new words here')
  assert.equal(S().past.length, depth0 + 2, 'the drag and the lines: two steps')
  assert.equal(undoStep(mark), true)
  assert.equal(S().project.clips.c1.start, 2, 'the user\'s drag stays')
  assert.equal(S().project.captions.map((c) => c.text).join('|'), before)
  // A drag that never ends (a pointer-up that never came): written after
  // the wait anyway, still its own step.
  open(talk(20, true), 'direct')
  S().beginGesture()
  S().moveClip('c1', 2)
  mark = null
  await writeLinesOwnStep(() => lines, { afterWrite: () => void (mark = markStep()) }, 5, 30)
  assert.equal(undoStep(mark), true)
  assert.equal(S().project.clips.c1.start, 2, 'the drag is not undone with the lines')
  S().endGesture()
})
