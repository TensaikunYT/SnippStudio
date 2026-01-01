// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.8 (FAZ4A-DUZELTME.md, E and parts of A, C, D): the
// tools' input schemas really enforced; the page decides whether an edit may
// still land before the deadline, and the server never says "nothing was
// applied" when it does not know; sessions ending and agent access going
// off reach the page; the frames sheet stays near 1.2 MP; one Whisper at a
// time; base required for seconds when the view moved on; another project's
// version an error; the restore points of a work period.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkArgs, handleRpc, type RpcContext } from '../main/agent-protocol'
import { ACCESS_OFF, AgentHost, NO_ANSWER } from '../main/agent-host'
import { agentTools } from '../renderer/src/agent/tools'
import { cellWidth } from '../renderer/src/agent/frames'
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import { editTool, type EditContext } from '../renderer/src/agent/edit'
import { acceptDraft, draftState, keptOf, rejectDraft, watchLive } from '../renderer/src/agent/drafts'
import { draftCalls, read } from './agent-kit'
import { useAgentStore } from '../renderer/src/agent/store'
import { ensureRestorePoint, restorePoints, restoreTo } from '../renderer/src/agent/restore'
import { claimWhisper, whisperRunning } from '../renderer/src/subtitles/whisper-lock'
import { analyzeKey } from '../renderer/src/agent/analyze'
import { commandByName } from '../renderer/src/commands'
import { hasTimes, resolveAddresses } from '../renderer/src/agent/address'

const S = useStore.getState
const unwatch = watchLive()
test.after(() => unwatch())

function small(): Project {
  const p = defaultProject()
  p.name = 'Small'
  const a: Asset = { id: 'a1', kind: 'video', name: 'talk.mp4', url: 'media://x', size: 1, duration: 60, width: 1920, height: 1080, hasAudio: true }
  p.assets = [a]
  const v1 = p.tracks[0]
  p.clips = { c1: { id: 'c1', assetId: 'a1', trackId: v1.id, start: 0, inPoint: 0, duration: 20, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1 } as Clip }
  v1.clipIds = ['c1']
  return p
}

function fresh(mode: 'draft' | 'direct' = 'draft'): void {
  rejectDraft()
  S().loadProject(small())
  useAgentStore.getState().setMode(mode)
}

const ctx = (extra: Partial<EditContext> = {}): EditContext => ({ session: 's1', client: 'test', results: new Map(), beforeFirstEdit: async () => undefined, told: () => undefined, ...extra })

// ---- G5: the schemas, enforced -----------------------------------------------

test('G5: every tool\'s input schema is enforced: unknown fields, kinds, enums, ranges, list lengths', async () => {
  const tools = agentTools()
  const schema = (name: string) => tools.find((t) => t.name === name)!.inputSchema
  assert.deepEqual(checkArgs(schema('project'), {}), [])
  assert.match(checkArgs(schema('project'), { trak: 'V1' }).join(), /trak: not a known field/)
  assert.match(checkArgs(schema('frames'), { times: [] }).join(), /times: needs at least 1 item/)
  assert.match(checkArgs(schema('frames'), { times: Array(13).fill(1) }).join(), /at most 12 items/)
  assert.match(checkArgs(schema('frames'), { times: [1], width: 5000 }).join(), /width: must be at most 1280/)
  assert.match(checkArgs(schema('analyze'), { kind: 'everything' }).join(), /kind: must be one of/)
  assert.match(checkArgs(schema('job'), { wait: 61 }).join(), /wait: must be at most 60/)
  // ops at most 500; notes.update at most 100.
  assert.match(checkArgs(schema('edit'), { ops: Array.from({ length: 501 }, () => ({ op: 'marker.add', time: 1 })) }).join(), /ops: at most 500 items \(got 501\)/)
  assert.deepEqual(checkArgs(schema('edit'), { ops: Array.from({ length: 500 }, () => ({ op: 'marker.add', time: 1 })), base: 'abcde-1' }), [])
  // base: required by the page for every op but help (phase 5e, decision 4;
  // was the schema's, phase 4A.9 A3): the schema lets a help call through.
  assert.deepEqual(checkArgs(schema('edit'), { ops: [{ op: 'help', names: ['clip.slip'] }] }), [])
  assert.match(checkArgs(schema('notes'), { update: Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })) }).join(), /update: at most 100 items/)
  assert.match(checkArgs(schema('notes'), { update: [{ id: 1, status: 'approved' }] }).join(), /status: must be one of/)
  // Through the protocol: refused before the page is asked.
  let asked = 0
  const c: RpcContext = { call: async () => (asked++, { content: [{ type: 'text', text: 'ok' }] }), serverInfo: { name: 's', title: 'S', version: '1' } }
  const r = (await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'edit', arguments: { ops: Array(600).fill({ op: 'x' }), base: 'abcde-1' } } }, c)) as { result: { isError: boolean; content: { text: string }[] } }
  assert.equal(r.result.isError, true)
  assert.match(r.result.content[0].text, /edit: nothing was done\.\nops: at most 500 items/)
  assert.equal(asked, 0)
})

// ---- G5: the deadline is the page's to judge ----------------------------------

test('G5: an edit with too little time left before the deadline is not applied, and the page says so', async () => {
  fresh('direct')
  const before = S().projectVersion
  const v0 = read()
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }], base: v0 }, ctx({ deadline: Date.now() + 2_000, margin: 10_000 })), /Too little time was left.*nothing was applied/)
  assert.equal(S().projectVersion, before)
  // With time: applied.
  const ok = await editTool({ ops: [{ op: 'marker.add', time: 1 }], base: v0 }, ctx({ deadline: Date.now() + 60_000, margin: 10_000 }))
  assert.match(ok, /^Applied/)
  // The server's own words when the page did not answer: look first.
  assert.match(NO_ANSWER(150), /no answer.*Read changes \(or project\) before retrying/)
  assert.doesNotMatch(NO_ANSWER(150), /nothing .*applied/)
  useAgentStore.getState().setMode('draft')
})

// ---- G7 / G9: the page is told -----------------------------------------------

test('G7/G9: a session ended or evicted, and agent access turned off, reach the page; calls in flight are cancelled there', async () => {
  const sent: [string, unknown][] = []
  const contents = { id: 7, isDestroyed: () => false, send: (ch: string, v: unknown) => void sent.push([ch, v]) }
  const win = { isDestroyed: () => false, webContents: contents } as never
  const host = new AgentHost({ userData: () => '.', port: 1, version: '1', name: 'snipp', forced: false, target: () => ({ win, projectPath: null }), timeoutMs: 400 })
  const call = (host as unknown as { call: (t: string, a: unknown, s: string) => Promise<{ content: { text: string }[]; isError?: boolean }> }).call.bind(host)
  const a = host.open('agent-a')
  void call('project', {}, a)
  assert.equal(sent[0][0], 'agent:call')
  const callId = (sent[0][1] as { id: string; budget: number }).id
  assert.equal((sent[0][1] as { budget: number }).budget, 400, 'the page knows the whole time')
  // DELETE: the page is told.
  host.end(a)
  assert.deepEqual(sent.at(-1), ['agent:session', { kind: 'ended', id: a }])
  // Off: the call in flight is cancelled in the page and the page told.
  const b = host.open('agent-b')
  const pending = call('edit', { ops: [] }, b)
  await (host as unknown as { stop: () => Promise<void> }).stop()
  const r = await pending
  assert.equal(r.isError, true)
  // (Exactly the text that says "it may or may not have been applied": phase
  // 4A.10, table#6 — the old "the call was cancelled" also matched /turned off/.)
  assert.equal(r.content[0].text, ACCESS_OFF)
  assert.ok(sent.some(([ch, v]) => ch === 'agent:cancel' && v !== callId))
  assert.deepEqual(sent.at(-1), ['agent:session', { kind: 'off' }])
  // 33 sessions, each of which worked and has its answer: the one silent
  // the longest is forgotten and its page told. (D22, K5: a session with a
  // call still waiting is never the one — src/test/d22-a-sessions.test.ts.)
  sent.length = 0
  const ids: string[] = []
  for (let i = 0; i < 32; i++) {
    ids.push(host.open(`c${i}`))
    const answered = call('project', {}, ids[i])
    host.answer(7, (sent.at(-1)![1] as { id: string }).id, { content: [{ type: 'text', text: 'ok' }] })
    await answered
  }
  const first = ids[0]
  host.open('c32')
  assert.equal(host.has(first), false)
  assert.ok(ids.slice(1).every((id) => host.has(id)))
  assert.ok(sent.some(([ch, v]) => ch === 'agent:session' && (v as { id?: string }).id === first))
})

test('G9/rule 23: a session that went away leaves its draft to one of the same program; another session is told plainly', () => {
  fresh('draft')
  draftCalls('old-session', 'claude-code', [{ name: 'marker.add', params: { time: 1 } }])
  const held = read('claude-code')
  // Another program while the session is still there: refused, plainly.
  assert.throws(() => draftCalls('other', 'codex', [{ name: 'marker.add', params: { time: 2 } }], () => true), /the user must accept or reject the waiting draft first/)
  // The same program, reconnected (the old session gone): it takes over,
  // and the versions the program was given are still its own (B10).
  const r = draftCalls('new-session', 'claude-code', [{ name: 'marker.add', params: { time: 3 } }], (id) => id !== 'old-session')
  assert.equal(keptOf('claude-code', held).draft > 0, true)
  assert.equal(r.took, true)
  assert.equal(draftState()!.session, 'new-session')
  assert.equal(draftState()!.entries.length, 2)
  // The same program while the old session is still alive: refused.
  assert.throws(() => draftCalls('third', 'claude-code', [{ name: 'marker.add', params: { time: 4 } }], () => true), /must accept or reject/)
  rejectDraft()
})

test('G6: "the same question" is keyed on the schema\'s fields only', () => {
  assert.equal(analyzeKey({ kind: 'silences', junk: 1, extra: 'x' }), analyzeKey({ kind: 'silences' }))
  assert.notEqual(analyzeKey({ kind: 'silences', min: 0.4 }), analyzeKey({ kind: 'silences' }))
})

test('T5: a trim edge is a time: a word address works', () => {
  const p = small()
  p.captions = [{ id: 'L1', start: 4, end: 6, text: 'here we go', words: [{ text: 'here', start: 4, end: 4.4 }, { text: 'we', start: 4.5, end: 4.8 }, { text: 'go', start: 4.9, end: 5.5 }] }]
  const schema = commandByName('clip.trimHead').params as never
  assert.equal(hasTimes(schema, { clipId: 'c1', edge: 3 }), true)
  assert.deepEqual(resolveAddresses(schema, { clipId: 'c1', edge: 'L1#1' }, p), { clipId: 'c1', edge: 4.5 })
})

// ---- T12 -----------------------------------------------------------------------

test('T12: the frames sheet stays near 1.2 MP whatever width is asked', () => {
  for (const n of [1, 2, 4, 9, 12]) {
    const w = cellWidth(n, 1280, 16 / 9, 1_200_000)
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4
    const rows = Math.ceil(n / cols)
    const px = cols * w * rows * (w / (16 / 9))
    assert.ok(px <= 1_200_000 * 1.01, `${n} frames: ${Math.round(px)} px`)
  }
  assert.equal(cellWidth(1, undefined, 16 / 9, 1_200_000), 512, 'the default one frame is untouched')
})

// ---- G4 ------------------------------------------------------------------------

test('G4: one Whisper at a time, claimed before anything is awaited', () => {
  const r1 = claimWhisper()
  assert.ok(r1)
  assert.equal(claimWhisper(), null, 'a second run (the user\'s button, another job) is refused at once')
  assert.equal(whisperRunning(), true)
  r1!()
  assert.equal(whisperRunning(), false)
  const r2 = claimWhisper()
  assert.ok(r2)
  r2!()
})

// ---- rule 7, D11, D10 ------------------------------------------------------------

test('A3: base is required for every edit, with or without seconds; a version of another project is said plainly', async () => {
  fresh('draft')
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }] }, ctx()), /base is required/)
  await assert.rejects(editTool({ ops: [{ op: 'clip.setVolume', clipId: 'c1', volume: 0.5 }] }, ctx()), /base is required/)
  const v0 = read()
  assert.match(await editTool({ ops: [{ op: 'marker.add', time: 1 }], base: v0 }, ctx()), /^Draft started: /)
  // A second call on the same read needs no new one.
  assert.match(await editTool({ ops: [{ op: 'marker.add', time: 2 }], base: v0 }, ctx()), /^Draft: /)
  rejectDraft()
  // D11: another project was opened: the number belongs to the one before.
  S().loadProject(small())
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1 }], base: v0 }, ctx()), /belongs to another project/)
  assert.throws(() => keptOf('test', v0), /belongs to another project/)
})

test('D6/G8: an edit waits for its restore point: a cut the user made meanwhile is followed; another project opened meanwhile refuses', async () => {
  fresh('direct')
  const v0 = read()
  // While the point is being written the user cuts 0–2 s: the agent's
  // marker (written at v0's 10 s) lands on that footage, now at 8 s.
  const late = ctx({ beforeFirstEdit: async () => void S().runBatch([{ name: 'timeline.cutRanges', params: { ranges: [[0, 2]] } }]) })
  await editTool({ ops: [{ op: 'marker.add', time: 10, note: 'here' }], base: v0 }, late)
  assert.equal(S().project.markers?.find((m) => m.note === 'here')?.time, 8)
  // Another project opened while it waited: nothing applied.
  fresh('direct')
  const w0 = read()
  const moved = ctx({ beforeFirstEdit: async () => void S().loadProject(small()) })
  await assert.rejects(editTool({ ops: [{ op: 'marker.add', time: 1, note: 'lost' }], base: w0 }, moved), /Another project was opened/)
  assert.equal(S().project.markers?.length ?? 0, 0)
  useAgentStore.getState().setMode('draft')
})

// ---- G1, G2, D9, T9: the restore points of a work period ------------------------

test('G1/T9/D9: the point before the agent is not rotated away by sessions; session points only after the user\'s changes; G2: another project\'s points are not listed', async () => {
  fresh('direct')
  const initial = S().project
  // 7 sessions, each with one edit (destructive or not): one point, the first state.
  for (let i = 0; i < 7; i++) {
    await ensureRestorePoint(`sess${i}`)
    await editTool({ ops: [{ op: 'timeline.cutRanges', ranges: [[0, 1]] }], base: read() }, ctx({ session: `sess${i}`, beforeFirstEdit: async () => void (await ensureRestorePoint(`sess${i}`)) }))
  }
  let pts = restorePoints()
  assert.equal(pts.length, 1)
  assert.equal(pts[0].kind, 'pre')
  assert.equal(pts[0].project, initial)
  // The user changes it: the next session gets a point of its own.
  S().runBatch([{ name: 'marker.add', params: { time: 3, note: 'mine' } }])
  await ensureRestorePoint('sess7')
  pts = restorePoints()
  assert.equal(pts.length, 2)
  assert.equal(pts[0].kind, 'pre', 'the point before the agent still first')
  // Another project: none of these are listed or applied.
  S().loadProject(small())
  assert.equal(restorePoints().length, 0)
  await assert.rejects(restoreTo(pts[0].name), /another project|not a restore point of this project/i)
  useAgentStore.getState().setMode('draft')
})

test('G1: in draft mode the point before the agent is the live project right before the accept (the user worked while it waited)', async () => {
  fresh('draft')
  await ensureRestorePoint('s1')
  draftCalls('s1', 'test', [{ name: 'marker.add', params: { time: 1, note: 'agent' } }])
  S().runBatch([{ name: 'marker.add', params: { time: 2, note: 'user' } }])
  const beforeAccept = S().project
  acceptDraft(undefined, 'now')
  const pre = restorePoints()[0]
  assert.equal(pre.kind, 'pre')
  assert.equal(pre.project, beforeAccept, 'the user\'s marker is in the point; the agent\'s is not')
  await restoreTo()
  assert.deepEqual((S().project.markers ?? []).map((m) => m.note), ['user'])
})
