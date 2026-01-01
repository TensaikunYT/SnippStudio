// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.9 (FAZ4A-YENIDEN.md, part B: jobs, limits, sessions).
// Each test names the finding of haritalar/_faz4a-dogrulama.md it would fail
// for if the bug came back.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkArgs } from '../main/agent-protocol'
import { ACCESS_OFF } from '../main/agent-host'
import { agentTools } from '../renderer/src/agent/tools'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import { editTool } from '../renderer/src/agent/edit'
import { acceptDraft, changesFor, currentDraft, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { useAgentStore } from '../renderer/src/agent/store'
import { markStep, startJob, startTranscribeChecked, undoStep, jobText, type Job } from '../renderer/src/agent/jobs'
import { createQueue } from '../renderer/src/agent/queue'
import { analyze } from '../renderer/src/agent/analyze'
import { contactSheet, FRAMES_MAX_PIXELS } from '../renderer/src/agent/frames'
import { clipLoudnessDb, setLoudnessReader, ANALYSIS_WINDOW } from '../renderer/src/audio/silence'
import { readFileSync } from 'node:fs'
import { whisperRunning, withWhisper } from '../renderer/src/subtitles/whisper-lock'
import { ctxOf, kept, open as openKit, read, shown, talk } from './agent-kit'
import { PRODUCT_NAME } from '../shared/product'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

function small(name = 'Small', lines = 0): Project {
  const p = defaultProject()
  p.name = name
  const a: Asset = { id: 'a1', kind: 'video', name: 'talk.mp4', url: 'media://x', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true }
  p.assets = [a]
  const v1 = p.tracks[0]
  p.clips = { c1: { id: 'c1', assetId: 'a1', trackId: v1.id, start: 0, inPoint: 0, duration: 20, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  p.captions = Array.from({ length: lines }, (_, i) => ({ id: `L${i}`, start: i * 2, end: i * 2 + 1.5, text: `line ${i}`, words: [{ text: 'line', start: i * 2, end: i * 2 + 0.5 }, { text: String(i), start: i * 2 + 0.6, end: i * 2 + 1.5 }] }))
  return p
}
const open = (p: Project, mode: 'draft' | 'direct' = 'direct'): void => {
  rejectDraft()
  S().loadProject(p)
  useAgentStore.getState().setMode(mode)
}
const fakeJob = (): Job => ({ id: 'j0', what: 'transcribe', started: 0, done: false, promise: Promise.resolve() })

// ---- V-restore-transcribe-2, V-limits-sessions-1, G3, T8, G7 (1) ----------------

test('job transcribe: project, cancel and "replace" are checked again AFTER the restore point was written', async () => {
  // (1) Another project opens during the write: B's 200 hand-corrected lines
  // are not replaced; nothing starts.
  open(small('A'))
  let started = 0
  const start = (): Job => {
    started++
    return fakeJob()
  }
  await assert.rejects(
    startTranscribeChecked({ replace: false, cancelled: () => false, ensurePoint: async () => void S().loadProject(small('B', 200)), start }),
    new RegExp(`Another project was opened in ${PRODUCT_NAME} while this waited; no transcription was started`)
  )
  assert.equal(started, 0)
  assert.equal(S().project.captions.length, 200, 'B keeps its lines')

  // (2) Agent access goes off during the write: nothing starts afterwards.
  open(small('A'))
  let off = false
  await assert.rejects(startTranscribeChecked({ replace: false, cancelled: () => off, ensurePoint: async () => void (off = true), start }), /cancelled: .* no transcription was started/)
  assert.equal(started, 0)

  // (3) Lines appear in the same project during the write (the user's own
  // transcription landed): without replace:true they are not replaced.
  open(small('A'))
  await assert.rejects(startTranscribeChecked({ replace: false, cancelled: () => false, ensurePoint: async () => void S().setSubtitles(small('x', 3).captions), start }), /has 3 subtitle lines; transcribe replaces ALL of them/)
  assert.equal(started, 0)
  // …and a Whisper run that started meanwhile refuses it too.
  open(small('A'))
  let running = false
  await assert.rejects(startTranscribeChecked({ replace: true, cancelled: () => false, ensurePoint: async () => void (running = true), start, running: () => running }), /already running/)
  assert.equal(started, 0)

  // Nothing in the way: it starts once, after the point.
  open(small('A', 2))
  const order: string[] = []
  const job = await startTranscribeChecked({ replace: true, cancelled: () => false, ensurePoint: async () => void order.push('point'), start: () => { order.push('start'); return fakeJob() } })
  assert.equal(job.id, 'j0')
  assert.deepEqual(order, ['point', 'start'])
})

// ---- V-restore-transcribe-3 -------------------------------------------------------

test('the notice\'s "Undo" undoes THAT step only: after anything else was done it undoes nothing', () => {
  open(small('A', 3))
  const before = S().project.captions.map((c) => c.text)
  // The agent's transcription lands: every line replaced.
  S().setSubtitles([{ id: 'n1', start: 0, end: 1, text: 'new' }])
  const mark = markStep()
  // Pressed at once: the step is taken back.
  assert.equal(undoStep(mark), true)
  assert.deepEqual(S().project.captions.map((c) => c.text), before)

  // Again; then the agent (direct mode) or the user does something else.
  S().setSubtitles([{ id: 'n1', start: 0, end: 1, text: 'new' }])
  const mark2 = markStep()
  S().runBatch([{ name: 'marker.add', params: { time: 3, note: 'later' } }])
  assert.equal(undoStep(mark2), false, 'the step is not the newest: nothing is undone')
  assert.equal((S().project.markers ?? []).length, 1, 'the later change is NOT what got undone')
  assert.deepEqual(S().project.captions.map((c) => c.text), ['new'])
  assert.equal(undoStep(null), false)
})

// ---- V-limits-sessions-2 / -3, G6, G7 (2, 3) ----------------------------------------

test('analyses queue: a cancelled entry does not hold a place and is settled at once; emptying the queue settles what waits (no job stays "running")', async () => {
  const q = createQueue(8, (max) => `${max} analyses are already waiting`)
  let release!: () => void
  const head = q.add(() => new Promise<string>((r) => (release = () => r('head'))), { cancelled: () => false })
  // Eight wait behind it; then their project is closed (their signal is cancelled).
  let dead = false
  const waiting = Array.from({ length: 8 }, (_, i) => q.add(async () => `w${i}`, { cancelled: () => dead }))
  const settled: string[] = []
  waiting.forEach((p, i) => void p.then(() => settled.push(`ok${i}`), (e: Error) => settled.push(e.message)))
  assert.throws(() => q.add(async () => 'ninth', { cancelled: () => false }), /8 analyses are already waiting/)
  dead = true
  // The new project's analysis is taken although the head still runs.
  const fresh = q.add(async () => 'fresh', { cancelled: () => false })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(settled.length, 8, 'the dead ones ended now, not when the head ends')
  assert.ok(settled.every((m) => m === 'cancelled'))
  assert.equal(q.waiting(), 1)

  // Access off: what waits ends; a job made of a waiting analysis is done.
  const job = startJob('analyze silences', () => fresh)
  assert.equal(q.clear('cancelled: agent access was turned off'), 1)
  await job.promise
  assert.equal(job.done, true)
  assert.match(jobText(job), /failed: cancelled: agent access was turned off/)
  release()
  assert.equal(await head, 'head')
  assert.equal(q.waiting(), 0)
})

test('analyze audio stops at the cancel signal between clips (it ran to its end and held the one slot)', async () => {
  const p = small()
  const v1 = p.tracks[0]
  for (let i = 0; i < 20; i++) {
    p.clips[`k${i}`] = { ...p.clips.c1, id: `k${i}`, start: 20 + i * 2, duration: 2 } as Clip
    v1.clipIds.push(`k${i}`)
  }
  let measured = 0
  let mixed = 0
  let cancel = false
  const deps = {
    measureClip: async () => {
      if (++measured === 3) cancel = true
      return { lufs: -16, peakDb: -3 }
    },
    measureProject: async () => {
      mixed++
      return { lufs: -16, peakDb: -3 }
    }
  }
  await assert.rejects(analyze(p, { kind: 'audio' } as never, 'r1', 'v-1', { cancelled: () => cancel }, deps), /cancelled/)
  assert.equal(measured, 3, 'no clip measured after the cancel')
  assert.equal(mixed, 0, 'the whole mix not started')
  cancel = false
  measured = 0
  const r = await analyze(p, { kind: 'audio' } as never, 'r2', 'v-1', { cancelled: () => false }, deps)
  assert.equal(r.items.length, 20)
  assert.equal(mixed, 1)
})

// ---- V-limits-sessions-4 ------------------------------------------------------------

test('the loudness read is kept across analyses of a cut-up talk: 80 pieces, three passes, 80 reads', async () => {
  const p = small()
  const v1 = p.tracks[0]
  p.clips = {}
  v1.clipIds = []
  for (let i = 0; i < 80; i++) {
    p.clips[`k${i}`] = { id: `k${i}`, assetId: 'a1', trackId: v1.id, start: i * 0.5, inPoint: i * 0.7, duration: 0.5, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip
    v1.clipIds.push(`k${i}`)
  }
  let reads = 0
  const undo = setLoudnessReader(async (_p, clip, win) => {
    reads++
    return new Array(Math.ceil(clip.duration / win)).fill(-30)
  })
  try {
    // silences / fillers / repeats / preflight all read at ANALYSIS_WINDOW.
    for (let pass = 0; pass < 3; pass++) for (const c of Object.values(p.clips)) await clipLoudnessDb(p, c, ANALYSIS_WINDOW)
    assert.equal(reads, 80, 'each piece read once, whatever the number of analyses')
    // Preflight in the analysis itself: the same window, so no read of its own.
    await analyze(p, { kind: 'preflight' } as never, 'r1', 'v-1', { cancelled: () => false })
    assert.equal(reads, 80, 'preflight shares what was read')
  } finally {
    undo()
  }
})

// ---- T12 ------------------------------------------------------------------------------

test('T12: the frames sheet itself holds the 1.2 MP cap (no caller has to pass it)', async () => {
  const asked: number[] = []
  const picture = (async (_p: Project, _t: number, o: { maxWidth?: number }) => {
    asked.push(o.maxWidth!)
    return { data: '', width: o.maxWidth!, height: 1 }
  }) as never
  // A portrait project, one frame asked at 1280: 1280 × 2276 would be 2.9 MP.
  const p = small()
  p.settings = { ...p.settings, width: 1080, height: 1920 }
  const sheet = await contactSheet(p, [1], { width: 1280, picture })
  assert.ok(sheet)
  const w = asked[0]
  assert.ok(w * (w * 1920 / 1080) <= FRAMES_MAX_PIXELS * 1.01, `${w} px wide: ${Math.round(w * w * 1920 / 1080)} px`)
  assert.equal(w, 821)
  // Landscape, one frame at 1280: under the cap as asked.
  asked.length = 0
  await contactSheet(small(), [1], { width: 1280, picture })
  assert.equal(asked[0], 1280)
})

// ---- V-limits-sessions-6 / -7 ----------------------------------------------------------

test('access off: the answer does not say "cancelled" for an edit that may have landed; checkArgs knows only the schema\'s own fields', () => {
  assert.match(ACCESS_OFF, /may or may not have been applied/)
  assert.match(ACCESS_OFF, /read changes \(or project\) before sending it again/)
  assert.doesNotMatch(ACCESS_OFF, /the call was cancelled/)
  const schema = (name: string) => agentTools().find((t) => t.name === name)!.inputSchema
  for (const k of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.match(checkArgs(schema('analyze'), { kind: 'silences', [k]: 1 }).join(), new RegExp(`${k}: not a known field`), k)
  }
  // An own "__proto__" key, as JSON.parse makes it.
  const evil = JSON.parse('{"kind":"silences","__proto__":{"x":1}}') as Record<string, unknown>
  assert.match(checkArgs(schema('analyze'), evil).join(), /__proto__: not a known field/)
  assert.match(checkArgs(schema('edit'), { ops: [{ op: 'marker.add', time: 1 }], base: 'a-1', toString: 'x' }).join(), /toString: not a known field/)
  assert.deepEqual(checkArgs(schema('analyze'), { kind: 'silences' }), [])
})

// ---- G4 -----------------------------------------------------------------------------------

test('G4: a transcription claims Whisper before its first wait: a second one started in the same tick is refused', async () => {
  open(small())
  let end!: () => void
  const order: string[] = []
  const first = withWhisper(async () => {
    order.push('first runs')
    await new Promise<void>((r) => (end = r))
    return 'done'
  }, 'busy')
  assert.equal(whisperRunning(), true, 'claimed synchronously')
  const second = await withWhisper(async () => {
    order.push('second runs')
    return 'done'
  }, 'busy')
  assert.equal(second, 'busy')
  assert.deepEqual(order, ['first runs'])
  end()
  assert.equal(await first, 'done')
  assert.equal(whisperRunning(), false, 'released when it ended')
  // A run that throws releases too.
  await assert.rejects(withWhisper(async () => { throw new Error('x') }, 'busy'))
  assert.equal(whisperRunning(), false)
  // The app's own run goes through it, with nothing awaited before the claim.
  const src = readFileSync('src/renderer/src/subtitles/run.ts', 'utf8')
  const body = src.slice(src.indexOf('export function transcribeIntoProject'), src.indexOf('async function transcribeClaimed'))
  assert.match(body, /return withWhisper</)
  assert.doesNotMatch(body, /\bawait\b/, 'nothing is awaited before the claim')
})

// ---- G8, V-edit-frames-4 -----------------------------------------------------------------

test('G8 / V-edit-frames-4: an edit that starts after another project was opened is refused by its base, whatever its ops', async () => {
  open(small('A'))
  const base = read()
  // (It waited behind another edit; meanwhile the user opened B.)
  S().loadProject(small('B'))
  const b = S().project
  await assert.rejects(editTool({ ops: [{ op: 'track.add', kind: 'audio' }], base }, ctxOf()), /belongs to another project/)
  await assert.rejects(editTool({ ops: [{ op: 'caption.setStyle', patch: { size: 60 } }], base }, ctxOf()), /belongs to another project/)
  assert.equal(S().project, b, 'B is untouched')
  // No base at all: refused as well (it was accepted from a session that never read).
  await assert.rejects(editTool({ ops: [{ op: 'track.add', kind: 'audio' }] }, ctxOf()), /base is required/)
})

// ---- the frame and rebuild findings the model took away: one test each ---------------

test('D11: changes with a version of another project (a live one, an ended draft\'s) is an error, not a diff of two projects', async () => {
  openKit(talk(20, true))
  const live = read()
  await editTool({ ops: [{ op: 'marker.add', time: 2, note: 'm' }], base: live }, ctxOf())
  const inDraft = read()
  acceptDraft(undefined, 'now')
  S().loadProject(small('B'))
  assert.throws(() => changesFor('test', live), /belongs to another project/)
  assert.throws(() => changesFor('test', inDraft), /belongs to another project/)
  assert.throws(() => changesFor('test', 'zzzzz-1'), /too old or not one you were given/)
})

test('V-edit-frames-3: a range the user already cut away drops ITS op ("already cut"); the other ops of the call are applied', async () => {
  openKit(talk(40, true), 'direct')
  const v0 = read()
  S().rippleDeleteMany([[10, 20]])
  const out = await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[12, 14]] }, { op: 'marker.add', time: 30, note: 'kept' }], base: v0 }, ctxOf())
  assert.match(out, /^Applied \(one undo step\): marker\.add/)
  assert.match(out, /#1 timeline\.cutRanges: already cut: its footage is no longer on the timeline/)
  assert.doesNotMatch(out, /needs at least 1 item/)
  const m = S().project.markers!.find((x) => x.note === 'kept')!
  assert.ok(Math.abs(m.time - 20) < 1e-6, `the marker is on the footage it named (source 30, now at ${m.time})`)
  // One range of two gone: the other is cut, the gone one said.
  const v1 = read()
  S().rippleDeleteMany([[2, 4]])
  const two = await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[2.5, 3.5], [6, 7]] }], base: v1 }, ctxOf())
  assert.match(two, /^Applied/)
  assert.equal(shown(kept(S().project), 6, 7), 0, 'the range still there is cut, by its footage (source 6-7)')
})

test('V-rebuild-2: a razor split, a trim elsewhere or a subtitle nudge by the user drops nothing of a waiting cut list', async () => {
  openKit(talk(40, true))
  const v0 = read()
  const ranges = Array.from({ length: 12 }, (_, i) => [3 * i + 1, 3 * i + 1.5])
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges }], base: v0 }, ctxOf())
  const applied = (): boolean[] => currentDraft()!.outcomes.map((o) => o.applied && !(o.left?.length))
  S().runBatch([{ name: 'clip.split', params: { clipIds: ['c1'], time: 15 } }])
  assert.deepEqual(applied(), [true], 'after a split')
  const line = S().project.captions.find((c) => !c.manual && c.words?.length)!
  S().runBatch([{ name: 'caption.editLine', params: { id: line.id, end: line.end + 0.2 } }])
  assert.deepEqual(applied(), [true], 'after a subtitle\'s end was nudged')
  const last = Object.values(S().project.clips).sort((x, y) => y.start - x.start)[0]
  S().runBatch([{ name: 'clip.trimEnd', params: { clipId: last.id, delta: -1 } }])
  assert.deepEqual(applied(), [true], 'after a trim of the tail')
  const d = currentDraft()!.project
  for (const [a, b] of ranges) assert.ok(shown(kept(d), a, b) < 1e-6, `source ${a}-${b} is cut`)
  rejectDraft()
})

test('V-rebuild-3: undo, a replay, then redo (or a second undo): the waiting cut is on its footage every time', async () => {
  openKit(talk(40, true))
  S().rippleDeleteMany([[3, 8]])
  const v2 = read()
  // 10-12 of the cut timeline: source 15-17.
  await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[10, 12]] }], base: v2 }, ctxOf())
  const ok = (what: string): void => {
    const d = currentDraft()! // (reading the draft replays it)
    assert.equal(d.outcomes[0].applied, true, what)
    assert.ok(shown(kept(d.project), 15, 17) < 1e-6, `${what}: source 15-17 is cut`)
  }
  S().undo()
  ok('after undo')
  S().redo()
  ok('after redo (the film the agent wrote against)')
  // Two user cuts, undone one by one with a replay between.
  S().rippleDeleteMany([[20, 21]])
  ok('after another cut')
  S().undo()
  ok('first undo')
  S().undo()
  ok('second undo')
  rejectDraft()
})
