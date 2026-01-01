// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Screenshots of phase 4B (for a person to look at; the scenario checks only
// that each view is there): the command box empty and with tags, the Agent
// tab without and with a draft, the draft on the timeline (hatched cuts, a
// dashed ghost), a moment of activity (reading sweep, "looked" badge), and
// the Settings window's agent connection page (the terminal it once showed
// went: TERMINAL-YOK-PLAN.md). Written to tasarim\ekranlar\4b\ when SNIPP_SCREENS_4B is
// set, else to testdata\e2e-sonuc\ekranlar-4b.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR } from '../app.mjs'
import { connectAgent, resultOf, versionOf } from '../agent-client.mjs'
import { accessOn } from '../session.mjs'
export const name = 'agent-screens'

export async function run({ c, app, media, lib, out }) {
  const { assert } = lib
  const dir = process.env.SNIPP_SCREENS_4B ? join(APP_DIR, '..', 'tasarim', 'ekranlar', '4b') : join(out, 'ekranlar-4b')
  mkdirSync(dir, { recursive: true })
  const shot = async (n, wait = 350) => {
    await c.sleep(wait)
    await c.shot(join(dir, n))
  }
  const [talk, pic] = await lib.seedAssets(app, c, [media.talk, media.numbered[0]])
  await lib.seedTimeline(c, [talk.id])
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  await c.run(() => window.__agent.setMode('draft'))

  // 1. The command box, empty (Agent tab, no session).
  await c.click('inspector.tab.agent')
  await c.waitId('agent.box')
  // (Kept open: empty, it is one line, agent on or off: audit G1.)
  await lib.keepBoxOpen(c)
  await shot('01-komut-kutusu-bos.png')

  // 2. With tags: a clip, a range, a region (the agent reads them in its project call).
  await c.st((s) => {
    s.selectClips([Object.keys(s.project.clips)[0]])
    s.addCutMark(2)
    s.addCutMark(7.5)
  })
  await c.click('agent.box.region')
  const pv = await c.box('agent.preview')
  await c.dragAt(pv.x + pv.w * 0.55, pv.y + pv.h * 0.2, pv.x + pv.w * 0.85, pv.y + pv.h * 0.55, { steps: 5 })
  await c.waitId('agent.box.tag.region')
  assert.ok(await c.has('agent.box.tag.range'))
  await shot('02-komut-kutusu-etiketli.png')

  // 3. The Agent tab with access on, no agent yet.
  await c.click('agent.box.tag.region.remove')
  await c.st((s) => {
    s.selectClips([])
    s.clearCutMarks()
  })
  await accessOn(c)
  await shot('03-ajan-sekmesi-bos.png')

  // 4–5. A draft: the pauses cut and a picture added (a scripted agent).
  const ag = await connectAgent({ c, app, assert, client: 'screens' })
  const p = await ag.call('project')
  const sil = await ag.call('analyze', { kind: 'silences' })
  await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(sil.text) }], base: versionOf(sil.text) ?? versionOf(p.text) })
  // (The picture in a call of its own, on the draft as the agent reads it.)
  const p2 = await ag.call('project')
  await ag.call('edit', { ops: [{ op: 'clip.add', assetId: pic.id, trackId: null, start: 5 }], base: versionOf(p2.text) })
  await c.waitId('agent.draft')
  assert.ok((await c.ev(`document.querySelectorAll('[data-testid="agent.mark"][data-kind="cut"]').length`)) >= 2)
  await c.waitFor('the added picture is marked', () => c.ev(`!!document.querySelector('[data-testid="agent.mark"][data-kind="add"]')`))
  await shot('04-ajan-sekmesi-taslakli.png', 800)
  await shot('05-cizelgede-taslak.png', 50)

  // 6. A moment of activity: reading (sweep) and looking (eye, badge).
  await ag.call('transcript')
  await ag.call('frames', { times: [3, 6] })
  await c.waitId('agent.looked')
  await shot('06-etkinlik-ani.png', 60)

  // 7. Settings → Agent connection.
  await c.run(() => window.__agent.reject())
  await c.click('topbar.settings')
  await c.click('settings.nav.agent')
  await c.waitId('settings.agent.wizard')
  await shot('07-ayarlar-ajan-baglantisi.png', 600)
  await c.click('settings.close')
  await c.waitGone('settings')
  console.log(`     screenshots: ${dir}`)
}
