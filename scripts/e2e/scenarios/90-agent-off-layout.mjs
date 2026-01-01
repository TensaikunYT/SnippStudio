// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 3c.Y, K2 (tarifler\FAZ3C-YERLESIM.md): with the top bar's switch off
// the Agent tab is gone and the command box is one 28 px line (empty, it is
// one line with the switch on too: audit G1), the Inspector that much
// taller; a click opens the box and its local work runs (a ready
// command: a draft, which brings the Agent tab back while it waits); the box
// folds again when the focus leaves it empty; its arrow keeps it open (kept
// over a reload); switched on: the tab and the full box; a draft waiting
// when the switch goes off keeps its card.
import { accessOn, status } from '../session.mjs'
export const name = 'agent-off-layout'

/** With the switch off, the Agent tab stays only while something waits:
 *  after a draft is rejected, a restore point keeps it (K2.4), else it goes. */
async function tabAfterReject(c, assert) {
  await c.sleep(300)
  const points = await c.ev('window.__agent.restorePoints().length')
  if (points > 0) assert.equal(await c.has('inspector.tab.agent'), true, `a restore point (${points}) keeps the tab`)
  else await c.waitGone('inspector.tab.agent')
  return points
}

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))
  const panel = () => c.byRole('tabpanel', 'Clip')
  await c.click('inspector.tab.clip')

  // On (as the run starts every scenario): the tab; the box one line while
  // empty (audit G1: on or off), full once opened.
  await c.waitFor('the agent on', async () => !!(await status(c)).server?.running && (await c.attr('agent.switch', 'aria-checked')) === 'true')
  await c.waitId('inspector.tab.agent')
  await c.waitFor('the box folded while empty', async () => (await c.attr('agent.box', 'data-folded')) === 'true')
  await lib.openBox(c)
  const full = (await c.box('agent.box')).h
  const panelOn = (await panel()).h

  // Off: no tab, one line, the Inspector gets the room.
  await lib.topBarSwitch(c)
  await c.waitFor('off', async () => (await c.attr('agent.switch', 'aria-checked')) === 'false')
  await c.waitGone('inspector.tab.agent')
  await c.waitFor('the box folded', async () => (await c.attr('agent.box', 'data-folded')) === 'true')
  const line = (await c.box('agent.box')).h
  // (One control's height, --ctl: 28 since DENEME-2; v3 had 32.)
  assert.ok(Math.abs(line - 28) <= 1, `the folded box is 28 px (${line})`)
  const panelOff = (await panel()).h
  assert.ok(Math.abs(panelOff - panelOn - (full - line)) <= 2, `the Inspector grew by what the box gave (${panelOn} → ${panelOff}, box ${full} → ${line})`)

  // A click opens it; the focus in its text (GONDER-PLAN.md); a ready command runs here.
  await c.click('agent.box.open')
  await c.waitFor('open', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
  assert.equal(await lib.focused(c), 'agent.box.text')
  assert.equal(await c.has('agent.box.collapse'), true)
  await c.click('agent.ready.silences')
  // A waiting draft brings the Agent tab back though the switch is off.
  await c.waitId('inspector.tab.agent', 15000)
  assert.equal(await c.attr('agent.box.status', 'data-state'), 'local')
  await c.click('inspector.tab.agent')
  await c.waitId('agent.draft', 15000)
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')
  const points1 = await tabAfterReject(c, assert)

  // The focus leaves it empty: one line again.
  await lib.seek(c, 1)
  await c.waitFor('folded again', async () => (await c.attr('agent.box', 'data-folded')) === 'true')

  // Its arrow keeps it open, over a reload; the fold button folds it.
  await c.click('agent.box.expand')
  await c.waitFor('kept open', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
  await lib.seek(c, 2)
  await c.sleep(200)
  assert.equal(await c.attr('agent.box', 'data-folded'), 'false', 'kept open when the focus leaves')
  await c.send('Page.reload', { ignoreCache: false })
  await c.sleep(300)
  await lib.ready(c)
  for (let i = 0; i < 10; i++) {
    if (await c.has('ask.recovery')) { await c.click('ask.recovery.discard'); break }
    await c.sleep(100)
  }
  await c.waitFor('still open after a reload', async () => (await c.attr('agent.box', 'data-folded')) === 'false')
  await c.click('agent.box.collapse')
  await c.waitFor('folded by its button', async () => (await c.attr('agent.box', 'data-folded')) === 'true')
  assert.equal(await c.run(() => localStorage.getItem('snipp-agent-box-open')), null)

  // On again (the top bar's switch; no chooser since TERMINAL-YOK-PLAN.md): the tab and the full box.
  const [talk2] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk2.id])
  await c.run(() => window.__agent.setMode('draft'))
  await accessOn(c)
  await c.waitId('inspector.tab.agent')
  assert.equal(await c.attr('agent.box', 'data-folded'), 'false')
  assert.equal(await c.has('agent.box.collapse'), true, 'its fold button with the agent on too (audit G1)')

  // A draft waits; the switch goes off: its card stays.
  await c.click('agent.ready.silences')
  await c.waitId('agent.draft', 15000)
  await lib.topBarSwitch(c)
  await c.waitFor('off', async () => (await c.attr('agent.switch', 'aria-checked')) === 'false')
  await c.sleep(300)
  assert.equal(await c.has('inspector.tab.agent'), true, 'the tab stays while a draft waits')
  assert.equal(await c.has('agent.draft'), true, 'the draft card stays')
  await c.click('agent.draft.reject')
  await c.waitGone('agent.draft')
  const points2 = await tabAfterReject(c, assert)
  console.log(`     box ${full} → ${line} px; Inspector ${panelOn} → ${panelOff} px; restore points after reject ${points1} / ${points2}`)
}
