// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio phase 4A.6 and 4A.3: the activity events and the token
// estimate (agent/store.ts, agent/tokens.ts), the restore points on disk
// (main/agent-restore.ts), and the image plan's even groups.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { answerSize, imageDims, imageTokens, textTokens, tokensOf } from '../renderer/src/agent/tokens'
import { sessionTokens, useAgentStore } from '../renderer/src/agent/store'
import { listRestorePoints, pruneList, readRestorePoint, RESTORE_KEEP, writeRestorePoint } from '../main/agent-restore'
import { evenGroupStarts } from '../renderer/src/agent/analyze'

// A 2×3 JPEG and a 4×5 PNG, base64 (just the headers matter).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x03, 0x00, 0x02, 0x03, 0x01, 0x22, 0x00]).toString('base64')
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 0, 4, 0, 0, 0, 5, 8, 2, 0, 0, 0])]).toString('base64')

test('tokens: text by characters / 3.6, a picture by width × height / 750', () => {
  assert.deepEqual(imageDims(JPEG), { width: 2, height: 3 })
  assert.deepEqual(imageDims(PNG), { width: 4, height: 5 })
  assert.equal(imageDims('bm90IGFuIGltYWdl'), null)
  assert.equal(textTokens(360), 100)
  assert.equal(imageTokens(512, 288), 196.608)
  const size = answerSize([{ type: 'text', text: 'x'.repeat(720) }, { type: 'image', data: JPEG, mimeType: 'image/jpeg' }])
  assert.deepEqual(size, { chars: 720, images: [{ width: 2, height: 3 }] })
  assert.equal(tokensOf({ chars: 720, images: [{ width: 750, height: 100 }] }), 300)
})

test('activity: each call a start and an end event, sessions summed, the connection idle after 120 s', () => {
  const st = useAgentStore.getState()
  st.callStarted({ id: 'k1', session: 's1', tool: 'analyze', kind: 'silences', range: [0, 60], client: 'claude-code', defsChars: 3600 })
  let e = useAgentStore.getState().events.find((x) => x.id === 'k1')!
  assert.equal(e.done, false)
  assert.equal(e.kind, 'silences')
  useAgentStore.getState().callFinished('k1', { size: { chars: 720, images: [] } })
  e = useAgentStore.getState().events.find((x) => x.id === 'k1')!
  assert.equal(e.done, true)
  assert.equal(e.tokens, 200)
  assert.ok((e.ms ?? -1) >= 0)
  st.callStarted({ id: 'k2', session: 's1', tool: 'frames', at: [1, 2], client: 'claude-code', defsChars: 3600 })
  useAgentStore.getState().callFinished('k2', { size: { chars: 36, images: [{ width: 750, height: 10 }] }, error: undefined })
  const s = useAgentStore.getState().sessions.s1
  assert.equal(s.calls, 2)
  assert.equal(s.tokens, 200 + 20)
  assert.equal(s.defsTokens, 1000)
  assert.equal(sessionTokens(s), 1220)
  assert.equal(s.client, 'claude-code')
  // An error is kept on the event.
  st.callStarted({ id: 'k3', session: 's1', tool: 'edit', client: '', defsChars: 0 })
  useAgentStore.getState().callFinished('k3', { size: { chars: 9, images: [] }, error: 'cancelled' })
  assert.equal(useAgentStore.getState().events.find((x) => x.id === 'k3')!.error, 'cancelled')
})

test('restore points: in the profile, per project its point before the agent and the last five, read back by name only (G1, G10, rule 15)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'snipp-restore-'))
  try {
    const t0 = 1_700_000_000_000
    const pre = (await writeRestorePoint(dir, '{"version":1,"pre":true}', 'pre-fabc12345-sess1', t0))!.name
    const names: string[] = []
    // Seven sessions' points of the same project, two in the same millisecond.
    for (let i = 0; i < 7; i++) names.push((await writeRestorePoint(dir, `{"version":1,"n":${i}}`, `pt-fabc12345-sess${i}`, t0 + 1 + Math.min(i, 5)))!.name)
    assert.notEqual(names[5], names[6], 'the same millisecond: two names')
    const kept = readdirSync(path.join(dir, 'agent-restore')).filter((f) => f.endsWith('.snipp'))
    assert.equal(kept.length, 1 + RESTORE_KEEP, 'its point before the agent and the last five')
    assert.ok(kept.includes(pre), 'the point before the agent is never rotated away by session points')
    assert.match(pre, /^1700000000000-pre-fabc12345-sess1-[a-z0-9]{6}\.snipp$/)
    assert.deepEqual(await readRestorePoint(dir, names[6]), { json: '{"version":1,"n":6}' })
    // Not a name this made: nothing (no path from the page is trusted).
    assert.equal(await readRestorePoint(dir, '..\\..\\secret.txt'), null)
    assert.equal(await readRestorePoint(dir, names[0]), null, 'the oldest session point went')
    assert.equal((await listRestorePoints(dir)).length, 6)
    assert.equal(await writeRestorePoint(dir, 42, 'x'), null)
    // A newer point before the agent of the same project replaces the old one.
    const pre2 = (await writeRestorePoint(dir, '{"version":1,"pre":2}', 'pre-fabc12345-sess9', t0 + 100))!.name
    const after = readdirSync(path.join(dir, 'agent-restore'))
    assert.ok(after.includes(pre2) && !after.includes(pre))
    // No temporary files left (written atomically).
    assert.deepEqual(after.filter((f) => !f.endsWith('.snipp')), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restore points: at most 40 files; past that only session points go, the oldest first — never a point before the agent (phase 4A.10, safety#5)', () => {
  const names: string[] = []
  // 9 projects × (pre + 5 pt) = 54 names; project k's files at time k*100+i.
  for (let k = 0; k < 9; k++) {
    names.push(`${1_700_000_000_000 + k * 100}-pre-f${String(k).padStart(8, '0')}-s-aaaaaa.snipp`)
    for (let i = 1; i <= 5; i++) names.push(`${1_700_000_000_000 + k * 100 + i}-pt-f${String(k).padStart(8, '0')}-s-aaaaa${i}.snipp`)
  }
  // The project being written is the OLDEST one (0): its files go last.
  const gone = new Set(pruneList(names, 'f00000000'))
  const left = names.filter((n) => !gone.has(n))
  assert.equal(left.length, 40)
  assert.equal(left.filter((n) => n.includes('-pre-')).length, 9, 'every point before the agent stays')
  assert.ok(!left.some((n) => n.includes('-pt-f00000001-')), "the oldest other project's session points went first")
  assert.equal(left.filter((n) => n.includes('-f00000000-')).length, 6, 'the project being written whole')
  assert.equal(left.filter((n) => n.includes('-f00000008-')).length, 6, 'the newest project whole')
  // Somebody else's file in the folder is never named.
  assert.deepEqual(pruneList(['notes.txt', 'x.snipp'], 'f1'), [])
})

test('image plan: fewer images than sentences, groups of about equal length', () => {
  const spans = Array.from({ length: 43 }, (_, i) => ({ captionIds: [`c${i}`], start: i * 3, end: i * 3 + 2.5 }))
  const starts = evenGroupStarts(spans, 20)
  assert.equal(starts.length, 20)
  assert.equal(starts[0], 'c0')
  assert.equal(new Set(starts).size, 20)
  // In order, never two groups on one sentence.
  const idx = starts.map((s) => Number(s.slice(1)))
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1])
  assert.ok(idx[19] <= 42)
})
