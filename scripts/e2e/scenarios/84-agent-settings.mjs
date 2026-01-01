// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 7's frame width setting, read by a scripted agent from outside; then
// agent access off (since TERMINAL-YOK-PLAN.md there is no agent process of
// the app's to end: the port closes and the Agent tab goes).
import { connectAgent } from '../agent-client.mjs'
import { accessOn, listening } from '../session.mjs'

export const name = 'agent-settings-frames-and-change'

export async function run({ relaunch, media, lib }) {
  const { assert } = lib
  const app = await relaunch({})
  const c = app.cdp
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await accessOn(c)
  assert.equal(await c.attr('agent.frame.width.512', 'aria-checked'), 'true')

  const ag = await connectAgent({ c, app, assert, client: 'phase7-frame-width' })
  assert.ok(ag.defsChars <= 12_000, `definitions: ${ag.defsChars} characters`)
  const baseline = await ag.call('frames', { times: [1] })
  assert.equal(baseline.images[0].width, 512)
  // (Audit patch S1: the setting is one frame's width; a grid keeps its own
  // smaller cells, so at 512 every grid is the size it was before phase 7.)
  const sheetW = (cols, cell) => cols * cell + (cols - 1) * 2
  const grid2 = await ag.call('frames', { times: [1, 2] })
  assert.equal(grid2.images[0].width, sheetW(2, 384), `2 frames at 512: ${grid2.images[0].width}`)
  const grid12 = await ag.call('frames', { times: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5] })
  assert.equal(grid12.images[0].width, sheetW(4, 224), `12 frames at 512: ${grid12.images[0].width}`)
  await c.click('agent.frame.width.384')
  const selected = await ag.call('frames', { times: [1] })
  assert.equal(selected.images[0].width, 384)
  assert.match(selected.text, /384x\d+/)
  const grid4 = await ag.call('frames', { times: [1, 2, 3, 4] })
  assert.equal(grid4.images[0].width, sheetW(2, 240), `4 frames at 384: ${grid4.images[0].width}`)
  const override = await ag.call('frames', { times: [1], width: 768 })
  assert.equal(override.images[0].width, 768)

  await c.click('agent.tab.switch')
  await c.waitFor('the port closed', async () => !(await listening(app.agentPort)), 8_000)
  // (Phase 3c.Y, K2: with the agent off, the Agent tab and
  // its settings are gone; the width is put back to 512 for the next
  // scenarios through the store.)
  await c.waitGone('inspector.tab.agent')
  await c.run(() => { window.__agent.store.getState().setFrameWidth('512'); return true })
  console.log(`     MCP JPEG widths 512 / 384 / 768 (explicit override), grids ${grid2.images[0].width} (2) / ${grid12.images[0].width} (12) at 512 and ${grid4.images[0].width} (4) at 384, definitions ${ag.defsChars} chars, access off`)
}
