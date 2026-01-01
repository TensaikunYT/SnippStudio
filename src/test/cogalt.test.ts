// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// cogalt (23 Nov 2026): an agent asked to copy a clip could not. clip.duplicate
// copies clips (with their linked partner); clip.add / clip.append take a
// clip id or a file name where a media id is asked; an id that names nothing
// says what to send.
import { fixture } from './undo-fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBatch, seededRandom, CommandError, type CommandEnv } from '../renderer/src/commands'
import { FAMILIES } from '../renderer/src/agent/families'
import { MARK_OF } from '../renderer/src/agent/marks'
import { editOperations } from '../renderer/src/agent/tools'

const env = (): CommandEnv => ({ random: seededRandom(1), now: () => new Date(0) })

test('clip.duplicate: right after the clip, every setting, the linked sound copied and linked to the copy', () => {
  const p = fixture()
  const { project: q, results } = applyBatch(p, [{ name: 'clip.duplicate', params: { clipId: 'ca' } }], env())
  const ids = results[0] as string[]
  assert.equal(ids.length, 2)
  const [pic, snd] = ids.map((id) => q.clips[id])
  assert.equal(pic.assetId, 'vid1')
  assert.equal(pic.trackId, 'v1')
  assert.equal(snd.trackId, 'a1')
  // (v1 is full after it: the copy goes to 24, and its sound with it.)
  assert.equal(pic.start, 24)
  assert.equal(snd.start, 24)
  assert.equal(pic.inPoint, p.clips.ca.inPoint)
  assert.equal(pic.audioExtracted, true)
  assert.equal(pic.transitionOut, undefined)
  assert.ok(pic.linkId && pic.linkId === snd.linkId && pic.linkId !== 'L1')
  assert.deepEqual(snd.transform, p.clips.sa.transform)
  // The original is untouched.
  assert.equal(q.clips.ca.linkId, 'L1')
  // linkAV false: the picture alone.
  const one = applyBatch(fixture(), [{ name: 'clip.duplicate', params: { clipId: 'ca', linkAV: false } }], env())
  assert.equal((one.results[0] as string[]).length, 1)
})

test('clip.duplicate at: the first copy there, the others keep their spacing', () => {
  const { project: q, results } = applyBatch(fixture(), [{ name: 'clip.duplicate', params: { clipIds: ['ov', 'cc'], at: 30 } }], env())
  const [a, b] = (results[0] as string[]).map((id) => q.clips[id])
  assert.equal(a.start, 30)
  assert.equal(b.start, 48)
  assert.deepEqual(a.transform, fixture().clips.ov.transform)
})

test('clip.duplicate refuses an unknown clip, a locked one, nothing named', () => {
  const no = (params: Record<string, unknown>, m: RegExp): void =>
    void assert.throws(() => applyBatch(fixture(), [{ name: 'clip.duplicate', params }], env()), (e: unknown) => e instanceof CommandError && m.test(e.message))
  no({ clipId: 'zz' }, /no clip "zz"/)
  no({ clipId: 'cl' }, /locked/)
  no({}, /clipId or clipIds/)
})

test('clip.add takes a clip id or a file name; an unknown one says what to send', () => {
  const p = structuredClone(fixture())
  p.assets.find((a) => a.id === 'img2')!.name = 'a.png'
  const byClip = applyBatch(p, [{ name: 'clip.add', params: { assetId: 'cc', trackId: 'v2', start: 30 } }], env())
  assert.equal(byClip.project.clips[(byClip.results[0] as string[])[0]].assetId, 'img2')
  const byName = applyBatch(p, [{ name: 'clip.add', params: { assetId: 'A.PNG', trackId: null, start: 30 } }], env())
  assert.equal(byName.project.clips[(byName.results[0] as string[])[0]].assetId, 'img2')
  const app = applyBatch(p, [{ name: 'clip.append', params: { assetId: 'a.png' } }], env())
  assert.equal(app.project.clips[app.results[0] as string].assetId, 'img2')
  assert.throws(() => applyBatch(p, [{ name: 'clip.add', params: { assetId: 'b.png', trackId: null, start: 0 } }], env()), /no media, clip or file name "b\.png".*project \{"track":"media"\}.*clip\.duplicate/)
  const two = structuredClone(fixture())
  for (const a of two.assets) if (a.id === 'img2' || a.id === 'img3') a.name = 'a.png'
  assert.throws(() => applyBatch(two, [{ name: 'clip.add', params: { assetId: 'a.png', trackId: null, start: 0 } }], env()), /2 media are named "a\.png": send one id of img2, img3/)
})

test('clip.duplicate is an agent op with its mark, listed by name', () => {
  assert.ok(FAMILIES['clip.duplicate'])
  assert.deepEqual(MARK_OF['clip.duplicate'], ['add'])
  assert.match(editOperations(), /clip\.\{[^}]*duplicate/)
  assert.match(editOperations(), /clip\.add\{[^\n]*clip id or file name/)
})

test('the Codex app\'s own codex.exe (%LOCALAPPDATA%\OpenAI\Codex\bin\<folder>) is found, and the wizard\'s lines use its full path', async () => {
  const { codexBinDirs, findAgents, codexAddLine, codexRegisterLine } = await import('../main/agent-connect')
  const w = (...parts: string[]): string => parts.join(String.fromCharCode(92))
  const local = w('C:', 'Users', 'me', 'AppData', 'Local')
  const bin = w(local, 'OpenAI', 'Codex', 'bin')
  const disk: Record<string, string[]> = { [bin]: ['0.160.0-a', '0.167.0-b', 'x/y'] }
  const listDir = (p: string): string[] => disk[p] ?? []
  assert.deepEqual(codexBinDirs({ LOCALAPPDATA: local }, listDir, 'win32'), [bin, w(bin, '0.167.0-b'), w(bin, '0.160.0-a')])
  assert.deepEqual(codexBinDirs({ LOCALAPPDATA: local }, listDir, 'linux'), [])
  assert.deepEqual(codexBinDirs({ LOCALAPPDATA: local }, () => [], 'win32'), [bin])
  const exe = w(bin, '0.160.0-a', 'codex.exe')
  const found = findAgents({ PATH: '', LOCALAPPDATA: local }, (p) => p === exe, 'win32', undefined, listDir)
  assert.deepEqual(found, [{ id: 'codex', path: exe }])
  // In PATH it wins (as before); with no folder there, nothing is found.
  const onPath = w('C:', 'tools', 'codex.exe')
  assert.equal(findAgents({ PATH: w('C:', 'tools'), LOCALAPPDATA: local }, (p) => p === onPath || p === exe, 'win32', undefined, listDir)[0].path, onPath)
  assert.deepEqual(findAgents({ PATH: '', LOCALAPPDATA: local }, () => false, 'win32', undefined, listDir), [])
  // The lines the wizard copies: the full path, quoted for PowerShell.
  const line = codexAddLine('http://127.0.0.1:47811/mcp', 'snippstudio', 'win32', exe)
  assert.ok(line.includes(`& '${exe}' mcp add snippstudio`), line)
  assert.ok(!/(^|; )codex mcp/.test(line))
  assert.ok(codexRegisterLine('C:\p\agent.json', 'http://127.0.0.1:47811/mcp', 'snippstudio', 'win32', exe).includes(`& '${exe}'`))
})

test('a copy is a new clip in the draft\'s words and marks (not taken for a piece of its original)', async () => {
  const { draftChanges } = await import('../renderer/src/agent/draft-words')
  const p = fixture()
  const r = applyBatch(p, [{ name: 'clip.duplicate', params: { clipIds: ['ca', 'ov'] } }], env())
  assert.deepEqual(draftChanges(p, r.project, []).map((c) => c.kind), ['add', 'add', 'add'])
  // A split's piece is still not "new".
  const s = applyBatch(p, [{ name: 'clip.split', params: { clipIds: ['cb'], time: 15 } }], env())
  assert.ok(!draftChanges(p, s.project, []).some((c) => c.kind === 'add'))
})
