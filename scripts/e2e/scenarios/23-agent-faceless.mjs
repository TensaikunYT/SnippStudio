// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (b), phase 4A.7: the faceless-channel project (the test material's\
// voice-over, media.mjs VOICEOVER: a voice-over, its 43 sentences with word times, 20 numbered
// pictures). analyze image_plan → edit (apply) → ONE draft → accepted as
// one undo step → Ctrl+Z.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectAgent, itemsOf, resultOf } from '../agent-client.mjs'
import { VOICEOVER } from '../media.mjs'
export const name = 'agent-script-b-faceless-images'

export async function run({ c, app, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const dir = VOICEOVER
  const images = Array.from({ length: 20 }, (_, i) => join(dir, `${i + 1}.jpg`))
  const [vo] = await lib.seedAssets(app, c, [join(dir, 'vo.wav'), ...images])
  await lib.seedTimeline(c, [vo.id])
  const project = JSON.parse(readFileSync(join(dir, 'proje.snipp'), 'utf8'))
  await c.run((caps) => {
    const s = window.__store.getState()
    s.setSubtitles(caps)
    s.setDirty(false)
    window.__agent.setMode('draft')
  }, project.captions)
  const ag = await connectAgent({ c, app, assert, client: 'script-b' })
  const v0 = /\bv ([0-9a-z]+-\d+)/.exec((await ag.call('project')).text)?.[1]
  const plan = await ag.call('analyze', { kind: 'image_plan' })
  assert.match(plan.text, /20 images on groups of sentences \(43 sentences\)/, plan.text)
  assert.equal(itemsOf(plan.text).length, 20)
  const depth0 = await lib.undoDepth(c)
  const e = await ag.call('edit', { ops: [{ op: 'apply', result: resultOf(plan.text) }], base: v0 })
  assert.match(e.text, /^Draft started: automation\.placeImages/)
  assert.equal(await c.ev('window.__agent.store.getState().draft.summary.calls'), 1, 'one draft call')
  assert.equal(await c.ev('window.__agent.store.getState().draft.summary.addedClips'), 20, 'twenty pictures in the draft')
  assert.equal(await lib.undoDepth(c), depth0, 'nothing on the live project yet')
  await c.run(() => window.__agent.accept())
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  const placed = await c.st((s) => Object.values(s.project.clips).filter((k) => s.project.assets.find((a) => a.id === k.assetId)?.kind === 'image').map((k) => [k.start, k.duration]))
  assert.equal(placed.length, 20)
  // In order, each until the next, covering the voice.
  placed.sort((x, y) => x[0] - y[0])
  for (let i = 1; i < placed.length; i++) assert.ok(Math.abs(placed[i - 1][0] + placed[i - 1][1] - placed[i][0]) < 0.01, `#${i} follows #${i - 1}`)
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z took the pictures back', async () => (await c.st((s) => Object.keys(s.project.clips).length)) === 1)
  console.log('     ' + ag.summary('script (b)').split('\n')[0])
}
