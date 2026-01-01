// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (c), phase 4A.9: the user edits the live project while the
// agent's draft waits. The draft is its calls replayed on the live project:
// the agent's cuts and its title follow their footage when the user drags
// the clip and cuts; an op whose content the user took away or changed is
// dropped with its reason (the agent is told once, the user sees it in the
// draft summary) and comes back when the user takes the change back;
// accepting gives what the draft showed.
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent, resultOf, versionOf } from '../agent-client.mjs'
export const name = 'agent-script-c-draft-rebuilt'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); window.__agent.setMode('draft') }, captionsOf(WORDED))
  const ag = await connectAgent({ c, app, assert, client: 'script-c' })
  const v0 = versionOf((await ag.call('project')).text)
  // The agent, all on the one read: the two pauses out (3–4.5, 8–9.5 s), a
  // title on "home", and a change of line w1's text.
  const sil = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }], base: v0 })
  await ag.call('edit', { ops: [{ op: 'text.add', time: 'w3#3', text: 'Home' }], base: v0 })
  await ag.call('edit', { ops: [{ op: 'caption.editLine', id: 'w1', text: 'The cat sat by the big window' }], base: v0 })
  const draft = () => c.ev(`(() => { const d = window.__agent.store.getState().draft; const p = window.__agent.draft().project; return { calls: d.calls.length, dropped: d.dropped, home: p.captions.find((k) => k.text === 'Home')?.start ?? null, w3: p.captions.find((k) => k.id === 'w3')?.words[3].start ?? null, pieces: Object.keys(p.clips).length } })()`)
  // (The agent reads: the draft is replayed at once, not after the 400 ms.)
  const settle = () => ag.call('project')
  await settle()
  const d0 = await draft()
  assert.equal(d0.calls, 3)
  assert.ok(Math.abs(d0.home - d0.w3) < 1e-6, 'the title is on "home"')

  // The user, meanwhile: drags the clip 2 s later. Every op follows its
  // footage: nothing is dropped.
  const clip = await c.st((s) => s.project.tracks[0].clipIds[0])
  await c.run((id) => window.__store.getState().runBatch([{ name: 'clip.move', params: { clipId: id, start: 2 } }]), clip)
  assert.doesNotMatch((await settle()).text, /Draft: dropped/)
  const d1 = await draft()
  assert.deepEqual(d1.dropped, [], `cuts, title and text follow the footage: ${JSON.stringify(d1.dropped)}`)
  assert.ok(Math.abs(d1.home - d1.w3) < 1e-6, `the title still on "home" (${d1.home} vs ${d1.w3})`)
  assert.ok(Math.abs(d1.home - (d0.home + 2)) < 1e-6, 'moved with the clip')

  // Then the user cuts 0.5 s out of the first line (w1, which the agent
  // retyped): the cuts and the title stay (0.5 s earlier); the new text for
  // w1 is dropped: its words are not the ones the agent read any more.
  await c.run(() => window.__store.getState().rippleDeleteMany([[2.5, 3.0]]))
  const told = (await settle()).text
  assert.match(told, /Draft: dropped call #\d+ op #\d+ caption\.editLine: line w1 is not as you read it/)
  const d2 = await draft()
  assert.equal(d2.dropped.length, 1)
  assert.equal(d2.dropped[0].label, 'caption.editLine')
  assert.ok(Math.abs(d2.home - d2.w3) < 1e-6)
  assert.ok(Math.abs(d2.home - (d1.home - 0.5)) < 1e-6, 'the title moved by the cut of the user')
  assert.equal(await c.ev('window.__agent.store.getState().draft.summary.dropped'), 1, 'the user sees it in the draft summary')
  // Told once: the next answer does not repeat it.
  assert.doesNotMatch((await settle()).text, /Draft: dropped/)
  // Ctrl+Z (the cut is taken back): the op is back in the draft by itself.
  await c.run(() => window.__store.getState().undo())
  assert.match((await settle()).text, /Draft: back in the draft: 1 op or range dropped before/)
  assert.deepEqual((await draft()).dropped, [])

  // Accepted: exactly what the draft showed, as one undo step.
  const depth = await lib.undoDepth(c)
  const shown = await c.ev('JSON.stringify(window.__agent.draft().project.captions.map((k) => [k.id, k.text, +k.start.toFixed(3)]))')
  await c.run(() => { const p = window.__agent.preview(); return window.__agent.accept(undefined, p.shown) })
  assert.equal((await lib.undoDepth(c)) - depth, 1)
  const live = await c.st((s) => JSON.stringify(s.project.captions.map((k) => [k.id, k.text, +k.start.toFixed(3)])))
  assert.equal(live, shown)
  assert.equal(await c.st((s) => s.project.captions.find((k) => k.id === 'w1').text), 'The cat sat by the big window')
  console.log('     ' + ag.summary('script (c)').split('\n')[0])
}
