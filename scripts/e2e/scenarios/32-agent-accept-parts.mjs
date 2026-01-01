// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (f), phase 4A.9: what the user can do with a waiting draft
// besides "all or nothing", and two calls sent side by side.
// - Two edits sent at once on one read: both land (the second needs no new
//   read; its seconds are still the read's).
// - One range taken out of a cut list: the others stay, the title after it
//   stays on its word.
// - Some calls accepted: ONE undo step; the rest still waits as the draft,
//   on the live project as it is now; then the rest accepted.
// - "You accept what you saw": the project changed after the card was
//   drawn, so nothing is adopted until the card is drawn again.
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent, versionOf } from '../agent-client.mjs'
export const name = 'agent-script-f-accept-parts'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); window.__agent.setMode('draft') }, captionsOf(WORDED))
  const ag = await connectAgent({ c, app, assert, client: 'script-f' })
  const v0 = versionOf((await ag.call('transcript', { words: true })).text)
  const len0 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))

  // Two calls side by side, both written on v0.
  const [a, b] = await Promise.all([
    ag.call('edit', { ops: [{ op: 'timeline.cutRanges', ranges: [[3.1, 4.4], [8.1, 9.4]] }], base: v0 }),
    ag.call('edit', { ops: [{ op: 'text.add', time: 'w3#3', text: 'Home', id: 'home000title' }, { op: 'marker.add', time: 'w2#0', note: 'then' }], base: v0 })
  ])
  assert.match(a.text, /^Draft/)
  assert.match(b.text, /^Draft/)
  assert.doesNotMatch(a.text + b.text, /Dropped/)
  const state = () => c.ev(`(() => { const d = window.__agent.draft(); const p = d.project; const len = Object.values(p.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0); return { seqs: d.entries.map((e) => e.seq), len, home: p.captions.find((k) => k.text === 'Home')?.start ?? null, w3: p.captions.find((k) => k.id === 'w3').words[3].start, dropped: d.outcomes.filter((o) => !o.applied).length } })()`)
  await ag.call('project')
  const s0 = await state()
  assert.equal(s0.seqs.length, 2)
  assert.ok(Math.abs(len0 - s0.len - 2.6) < 1e-6, `both ranges cut (${len0 - s0.len} s)`)
  assert.ok(Math.abs(s0.home - s0.w3) < 1e-6, 'the title is on "home" though it was sent beside the cut')

  // The user takes the second range out of the cut.
  const cutSeq = await c.ev(`window.__agent.draft().entries.find((e) => e.ops[0].name === 'timeline.cutRanges').seq`)
  assert.equal(await c.run((seq) => window.__agent.removeRange(seq, 0, 1), cutSeq), true)
  const s1 = await state()
  assert.ok(Math.abs(len0 - s1.len - 1.3) < 1e-6, 'one range left')
  assert.ok(Math.abs(s1.home - s1.w3) < 1e-6, 'the title still on "home"')
  assert.equal(s1.dropped, 0)

  // Only the titles' call accepted: one undo step; the cut still waits.
  const depth = await lib.undoDepth(c)
  const other = s1.seqs.find((x) => x !== cutSeq)
  await c.run((seq) => { const p = window.__agent.preview([seq]); return window.__agent.accept([seq], p.shown) }, other)
  assert.equal((await lib.undoDepth(c)) - depth, 1, 'one undo step')
  assert.equal(await c.st((s) => s.project.captions.filter((k) => k.text === 'Home').length), 1)
  assert.ok(Math.abs((await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))) - len0) < 1e-6, 'the live project is not cut')
  const s2 = await state()
  assert.deepEqual(s2.seqs, [cutSeq], 'the cut still waits')
  assert.equal(await c.ev('window.__agent.store.getState().outcome.kind'), 'partial')

  // The card is drawn; then the user cuts the very range away: accepting
  // with what the card showed adopts nothing.
  const card = await c.run(() => window.__agent.preview())
  assert.equal(card.all, true)
  await c.run(() => window.__store.getState().rippleDeleteMany([[3.0, 4.5]]))
  const v = await c.st((s) => s.projectVersion)
  const stale = await c.run((shown) => window.__agent.accept(undefined, shown), card.shown)
  assert.equal(stale.changed, true)
  assert.equal(stale.version, null)
  assert.equal(await c.st((s) => s.projectVersion), v, 'nothing adopted')
  assert.equal(await c.ev('window.__agent.store.getState().outcome.kind'), 'changed')
  // The card again: the range is gone ("already cut by the user").
  const again = await c.run(() => window.__agent.preview())
  assert.equal(again.apply.length, 0)
  assert.match(again.drop[0].reason, /already cut: its footage is no longer/)
  // Ctrl+Z: the footage is back, and so is the cut.
  await c.run(() => window.__store.getState().undo())
  const back = await c.run(() => { const p = window.__agent.preview(); return { all: p.all, r: window.__agent.accept(undefined, p.shown) } })
  assert.equal(back.all, true)
  assert.ok(Math.abs(len0 - (await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))) - 1.3) < 1e-6)
  assert.equal(await c.ev('window.__agent.draft()'), null)
  const home = await c.st((s) => s.project.captions.find((k) => k.text === 'Home').start)
  const w3 = await c.st((s) => s.project.captions.find((k) => k.id === 'w3').words[3].start)
  assert.ok(Math.abs(home - w3) < 1e-6, 'the title accepted before moved with the cut accepted after')
  console.log('     ' + ag.summary('script (f)').split('\n')[0])
}
