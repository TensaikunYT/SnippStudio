// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 4B.5 (a) and (f), with a scripted agent from outside (since
// TERMINAL-YOK-PLAN.md the app starts no agent; what the box sends reaches
// the agent through its wait call: GONDER-PLAN.md, scenario gonder-wait): a file picked in the media
// panel and a region drawn on the frame stand over the box as tags; the
// agent's `project` call reads them as ONE selection line (ids only); its
// calls come back as a draft card; accept; one Ctrl+Z undoes it all. Then two
// calls in the draft, only the first chosen: "Accept selected" applies that
// one, the other still waits. Notes' "Send to agent" puts them in line for
// the agent (nobody waits here); its notes call reads them as before.
import { resultOf, versionOf } from '../agent-client.mjs'
import { outsideAgent, textOf } from '../session.mjs'
export const name = 'agent-box-send-draft-accept'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  const ag = await outsideAgent({ c, app, assert, client: 'box-send' })

  // The box: a job for the agent or a ready one.
  assert.equal(await textOf(c, 'agent.box.hint'), 'Ready jobs are done here (0 tokens); anything else you write goes to the agent.')

  // What the user points at: the file in the media panel, a region.
  await c.click(`media.item.${talk.id}`)
  await c.waitId('agent.box.tag.media')
  await c.click('agent.box.region')
  const pv = await c.box('agent.preview')
  await c.dragAt(pv.x + pv.w * 0.3, pv.y + pv.h * 0.3, pv.x + pv.w * 0.6, pv.y + pv.h * 0.7, { steps: 6 })
  await c.waitId('agent.box.tag.region')
  assert.ok(await c.has('agent.region'), 'the region on the frame')

  // The agent reads them in its project call: one line, ids only.
  const depth0 = await lib.undoDepth(c)
  const p = await ag.call('project')
  const line = p.text.split('\n').find((l) => l.startsWith('Selected: '))
  assert.match(line ?? '', new RegExp(`^Selected: media ${talk.id}; region \\d+,\\d+,\\d+,\\d+%$`), p.text)
  assert.doesNotMatch(line, /talk\.mp4/, 'ids only, no content')
  // Its calls: the silences, applied (a draft).
  const sil = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }], base: versionOf(sil.text) ?? versionOf(p.text) })
  await c.waitId('agent.draft')
  // (D22, worker C: the draft is reviewed in the strip over the timeline;
  // its one item, the silences cut, says what it does.)
  assert.match(await textOf(c, 'agent.draft.sentence'), /is cut out of talk\.mp4 .*, and \d+ more$/)
  assert.ok((await c.ev(`document.querySelectorAll('[data-testid="agent.mark"][data-kind="cut"]').length`)) >= 2, 'the cuts hatched on the timeline')
  assert.equal(await lib.undoDepth(c), depth0, 'nothing on the live project yet')
  const len0 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))
  // Before / after in the preview.
  await c.click('agent.draft.view.candidate')
  await c.waitId('agent.after')
  // The three comparisons, from the strip's menu (ONIZLEME-UYGULA-PLAN.md, K8).
  for (const m of ['side', 'wipe', 'diff']) {
    await c.click('agent.draft.more')
    await c.click(`agent.draft.view.${m}`)
    await c.waitFor(`compared: ${m}`, async () => (await c.attr('compare.layer', 'data-mode')) === m)
  }
  await c.click('agent.draft.view.live')
  await c.waitGone('agent.after')
  await c.waitGone('compare.layer')
  await c.click('agent.draft.acceptAll')
  await c.waitGone('agent.draft', 8000)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'accepted as one undo step')
  const len1 = await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))
  assert.ok(len0 - len1 > 1.5, `cut ${len0 - len1} s`)
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('one Ctrl+Z took it back', async () => Math.abs((await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))) - len0) < 0.01)

  // (f) Two calls; only the first chosen.
  await c.click('agent.box.tag.region.remove')
  await c.waitGone('agent.box.tag.region')
  const p2 = await ag.call('project')
  assert.equal(p2.text.split('\n').find((l) => l.startsWith('Selected: ')), `Selected: media ${talk.id}`, 'the region tag removed: gone from the line')
  await ag.call('edit', { ops: [{ op: 'text.add', time: 0.5, text: 'Agent title' }], base: versionOf(p2.text) })
  const sil2 = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil2.text) }], base: versionOf(sil2.text) ?? versionOf(p2.text) })
  // (D22, worker C: one by one in the review strip. The first item is the title.)
  await c.waitFor('two items in the draft', async () => (await c.attr('agent.draft', 'data-items')) === '2')
  assert.match(await textOf(c, 'agent.draft.sentence'), /^A title "Agent title" is added at 0:00\.5$/)
  await c.waitFor('accept one is on', async () => (await c.attr('agent.draft.acceptOne', 'disabled')) === null)
  const depth1 = await lib.undoDepth(c)
  await c.click('agent.draft.acceptOne')
  await c.waitFor('one item left in the draft', async () => (await c.attr('agent.draft', 'data-items')) === '1')
  assert.equal((await lib.undoDepth(c)) - depth1, 1)
  assert.equal(await c.st((s) => s.project.captions.filter((k) => k.text === 'Agent title').length), 1, 'the chosen call (the title) applied')
  assert.equal(Math.abs((await c.st((s) => Object.values(s.project.clips).reduce((m, k) => Math.max(m, k.start + k.duration), 0))) - len0) < 0.01, true, 'the other call (the cuts) not applied')
  assert.match(await textOf(c, 'agent.draft.sentence'), /is cut out of talk\.mp4/, 'it still waits')
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')

  // Notes: "Send to agent" with nobody waiting: in line.
  await c.run(() => {
    const s = window.__store.getState()
    s.startNoteDraft({ start: 1, end: 2 })
    s.patchNoteDraft({ text: 'shorter here', kind: 'fix' })
    s.saveNoteDraft()
  })
  await c.click('inspector.tab.notes')
  assert.equal(await textOf(c, 'notes.send'), 'Send to agent (1)')
  await c.click('notes.send')
  await c.waitFor('in line for the agent', async () => (await textOf(c, 'notes.send')) === 'In line for the agent (1)')
  // The agent reads the waiting note in its next notes call.
  const n = await ag.call('notes')
  assert.match(n.text, /shorter here/)
}
