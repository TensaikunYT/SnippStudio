// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's second try-out, worker T (DENEME-2-PLAN-T.md): clip.move's
// shift (`by`), what an edit answer says it moved, the draft in the user's
// words (a gap is not a cut through clips), the length warning and when the
// preview's light is on.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip, type Project } from '../renderer/src/types'
import { commandByName, runCommand } from '../renderer/src/commands'
import { draftChanges, mmss, span, toDraft, toLive } from '../renderer/src/agent/draft-words'
import { bigJump, editAnswer, moveLines } from '../renderer/src/agent/answers'
import { glowState, GLOW_GAP_MS } from '../renderer/src/components/agent/AgentLayers'

const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }
function base(): Project {
  const p = defaultProject()
  p.tracks = [
    { id: 'V2', kind: 'video', name: 'V2', clipIds: [] },
    { id: 'V1', kind: 'video', name: 'V1', clipIds: [] },
    { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
  ]
  const a = (id: string, kind: 'video' | 'audio') => ({ id, kind, name: `${id}.mp4`, url: `media://${id}`, size: 1, duration: 100, width: 1920, height: 1080, hasAudio: true }) as never
  p.assets = [a('talk', 'video'), a('broll', 'video')]
  p.captions = []
  return p
}
function put(p: Project, id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): void {
  p.clips[id] = { id, assetId, trackId, start, inPoint: 0, duration, transform: { ...T0 }, volume: 1, ...extra }
  p.tracks.find((t) => t.id === trackId)!.clipIds.push(id)
}

test('clip.move: start is a time, by a shift; exactly one of them', () => {
  const p = base()
  put(p, 'a', 'talk', 'V1', 5, 10)
  const move = commandByName('clip.move')!
  assert.equal(runCommand(p, move, { clipId: 'a', by: 10 }).project.clips.a.start, 15, '10 s later')
  assert.equal(runCommand(p, move, { clipId: 'a', by: -3 }).project.clips.a.start, 2, '3 s earlier')
  assert.equal(runCommand(p, move, { clipId: 'a', by: -30 }).project.clips.a.start, 0, 'not before 0')
  assert.equal(runCommand(p, move, { clipId: 'a', start: 10 }).project.clips.a.start, 10, 'start is where it goes')
  assert.throws(() => runCommand(p, move, { clipId: 'a', start: 1, by: 1 }), /give one of start/)
  // With linkAV its partner comes along by the same shift.
  const q = base()
  put(q, 'v', 'talk', 'V1', 0, 12, { linkId: 'L', audioExtracted: true })
  put(q, 's', 'talk', 'A1', 0, 12, { linkId: 'L' })
  const r = runCommand(q, move, { clipId: 'v', by: 10, linkAV: true }).project
  assert.deepEqual([r.clips.v.start, r.clips.s.start], [10, 10])
})

test('an edit answer says where each clip went, a partner left behind, and a big jump', () => {
  const p = base()
  put(p, 'v', 'talk', 'V1', 0, 12, { linkId: 'L', audioExtracted: true })
  put(p, 's', 'talk', 'A1', 0, 12, { linkId: 'L' })
  const q = runCommand(p, commandByName('clip.move')!, { clipId: 'v', start: 200 }).project
  const lines = moveLines(p, q)
  assert.equal(lines[0], 'Moved: v 0.00→200.00 (+200.00 s)')
  assert.match(lines[1], /^Linked partner\(s\) left in place, out of step now: s \(linkAV false was sent; without it they move together\)/)
  assert.ok(bigJump(12, 212))
  assert.ok(!bigJump(12, 22), '10 s on a 12 s film is not a jump worth a warning (under 30 s)')
  const text = editAnswer({ draft: true, created: true, label: 'clip.move', pending: 1, length: 212, before: 12, outcomes: [{ applied: true, index: 0, seq: 1, name: 'clip.move', result: undefined } as never], changes: lines })
  assert.match(text, /This is a draft: nothing changed on the timeline yet; the user accepts it in /)
  assert.match(text, /Warning: this edit makes the film longer by 200\.00 s \(0:12\.0 → 3:32\.0\)/)
  assert.match(text, /Moved: v 0\.00→200\.00/)
})

test('the draft in the user\'s words: an empty stretch, a cut through a clip, a move with its sound, an added clip', () => {
  const live = base()
  put(live, 'v', 'talk', 'V1', 200, 12, { linkId: 'L', audioExtracted: true })
  put(live, 's', 'talk', 'A1', 200, 12, { linkId: 'L' })
  put(live, 'b', 'broll', 'V2', 0, 6)
  // The draft: the gap 6–200 removed; b moved 2 s later; a new clip on V2.
  const removed: [number, number][] = [[6, 200]]
  const draft = structuredClone(live)
  draft.clips.v.start = 6
  draft.clips.s.start = 6
  draft.clips.b.start = 2
  put(draft, 'n', 'broll', 'V2', 20, 4, { inPoint: 50 })
  const ch = draftChanges(live, draft, removed)
  const byKind = Object.fromEntries(ch.map((c) => [c.kind, c]))
  assert.equal(byKind.gap.key, 'den2t.change.gap', 'nothing lay at 0:06–3:20: a gap, not a cut')
  assert.deepEqual(byKind.gap.params, { from: '0:06', to: '3:20', d: '3:14' })
  assert.equal(ch.filter((c) => c.kind === 'move' && c.key).length, 1, 'v and s carried by the cut are not "moved"; b is')
  assert.equal(byKind.move.key, 'den2t.change.moveLater')
  assert.equal(byKind.move.params.d, '2 s')
  assert.equal(byKind.add.params.name, 'broll.mp4')
  assert.equal(byKind.add.to, toLive(20, removed))
  // A cut through footage says which.
  const cut = draftChanges(live, structuredClone(live), [[201, 203]])
  assert.equal(cut[0].key, 'den2t.change.cut')
  assert.equal(cut[0].params.names, 'talk.mp4')
  // A clip moved with its linked sound: one sentence, "with its sound".
  const d2 = structuredClone(live)
  d2.clips.v.start = 210
  d2.clips.s.start = 210
  const two = draftChanges(live, d2, [])
  assert.equal(two.filter((c) => c.key).length, 1)
  assert.equal(two[0].params.partner, 1)
  assert.equal(two.filter((c) => c.kind === 'move').length, 2, 'both get a ghost')
})

test('times: live and draft seconds, the user\'s clock', () => {
  const cuts: [number, number][] = [[2, 4], [10, 11]]
  assert.equal(toDraft(5, cuts), 3)
  assert.equal(toDraft(3, cuts), 2)
  assert.equal(toLive(3, cuts), 5)
  assert.equal(mmss(200), '3:20')
  assert.equal(mmss(3725), '1:02:05')
  assert.equal(span(-10), '10 s')
  assert.equal(span(4.25), '4.3 s')
  assert.equal(span(194), '3:14')
})

test('the preview\'s light: on while a call runs and a moment after, never while the agent waits', () => {
  const ev = (started: number, ms: number | undefined, done: boolean) => ({ id: String(started), session: 's', tool: 'edit', started, ...(ms !== undefined ? { ms } : {}), done })
  assert.deepEqual(glowState([ev(0, undefined, false)], false, 5), { on: true, until: null })
  assert.deepEqual(glowState([ev(0, 100, true)], false, 1000), { on: true, until: 100 + GLOW_GAP_MS })
  assert.equal(glowState([ev(0, 100, true)], false, 100 + GLOW_GAP_MS + 1).on, false)
  assert.equal(glowState([ev(0, undefined, false)], true, 5).on, false, 'waiting for the user: no light')
  assert.equal(glowState([], false, 5).on, false)
})

test('one agent at a time: the holder, a refused second program, the hand-over, the old session told', async () => {
  const { checkWriter, checkHandedOff, handTo, forgetHolderSession, useHolder, agentDisplayName } = await import('../renderer/src/agent/holder')
  useHolder.setState({ holder: null, asked: [], handedOff: {} })
  const alive = new Set(['s-claude', 's-codex'])
  const live = (id: string): boolean => alive.has(id)
  checkWriter('s-claude', 'claude-code', live)
  assert.deepEqual(useHolder.getState().holder, { client: 'claude-code', session: 's-claude' })
  assert.throws(() => checkWriter('s-codex', 'codex-mcp-client', live), /Another agent \(Claude Code\) is changing this project/)
  assert.deepEqual(useHolder.getState().asked.map((a) => a.client), ['codex-mcp-client'])
  // The same program again (a reconnect): the same agent.
  checkWriter('s-claude-2', 'claude-code', live)
  assert.equal(useHolder.getState().holder?.session, 's-claude-2')
  checkWriter('s-claude', 'claude-code', live)
  // Handed over: Codex holds it, Claude's session is told.
  assert.ok(handTo('codex-mcp-client'))
  assert.equal(useHolder.getState().holder?.client, 'codex-mcp-client')
  assert.throws(() => checkHandedOff('s-claude'), /handed the project to another agent \(Codex\)/)
  checkWriter('s-codex', 'codex-mcp-client', live)
  // A holder whose session ended frees the project.
  alive.delete('s-codex')
  checkWriter('s-other', 'opencode', live)
  assert.equal(useHolder.getState().holder?.client, 'opencode')
  forgetHolderSession('s-other')
  assert.equal(useHolder.getState().holder, null)
  assert.equal(agentDisplayName('claude-code'), 'Claude Code')
  assert.equal(agentDisplayName('codex-mcp-client'), 'Codex')
})

test('Codex: its desktop app\'s codex.exe found through the app\'s aliases; the permanent key line; the yes/no query', async () => {
  const { codexAppDirs, codexPersistLine, codexEnvQueryArgs, findAgents } = await import('../main/agent-connect')
  const w = (...parts: string[]): string => parts.join(String.fromCharCode(92))
  const local = w('C:', 'Users', 'me', 'AppData', 'Local')
  const pkg = w('C:', 'Program Files', 'WindowsApps', 'OpenAI.Codex_26.1117.4957.0_x64__2p2nqsd0c76g0')
  const links: Record<string, string> = { [w(local, 'Microsoft', 'WindowsApps', 'codex-core-command-runner.exe')]: w(pkg, 'app', 'resources', 'codex-command-runner.exe') }
  const readlink = (p: string): string | null => links[p] ?? null
  assert.deepEqual(codexAppDirs({ LOCALAPPDATA: local }, readlink, 'win32'), [w(pkg, 'app', 'resources')])
  const exe = w(pkg, 'app', 'resources', 'codex.exe')
  assert.deepEqual(findAgents({ PATH: '', LOCALAPPDATA: local }, (p) => p === exe, 'win32', readlink), [{ id: 'codex', path: exe }])
  assert.deepEqual(findAgents({ PATH: '', LOCALAPPDATA: local }, (p) => p === exe, 'win32'), [], 'without a link reader as before')
  const file = w('C:', 'Users', 'me', 'AppData', 'Roaming', 'Snipp Dev', 'agent.json')
  const line = codexPersistLine(file, 'snippstudio', 'win32')
  assert.equal(line, `[Environment]::SetEnvironmentVariable('SNIPPSTUDIO_TOKEN', (Get-Content -LiteralPath '${file}' -Raw | ConvertFrom-Json).token, 'User')`)
  assert.equal(codexPersistLine(file, 'snippstudio', 'linux'), undefined)
  // (Since SIHIRBAZ-PLAN.md: compared with the file's key inside PowerShell; tested in sihirbaz.test.ts.)
  assert.match(codexEnvQueryArgs('snippstudio', file).at(-1) ?? '', /^\$v = \[Environment\]::GetEnvironmentVariable\('SNIPPSTUDIO_TOKEN', 'User'\)/)
})
