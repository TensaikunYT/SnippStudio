// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Scripted agent (d), phase 4A.7: "apply directly" — 100 edit calls, each
// its own undo step on the live project; before the first one the project
// was written to the profile (agent-restore\); one call puts it back, and
// the project is then byte for byte that file.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { WORDED, captionsOf } from './04-text-edit.mjs'
import { connectAgent } from '../agent-client.mjs'
export const name = 'agent-script-d-direct-100-restore'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.waitFor('the agent host', () => c.ev('!!window.__agent'))
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  await c.run((caps) => { const s = window.__store.getState(); s.setSubtitles(caps); s.setDirty(false); window.__agent.setMode('direct') }, captionsOf(WORDED))
  const before = await c.run(() => window.__agent.serialize())
  const ag = await connectAgent({ c, app, assert, client: 'script-d' })
  const depth0 = await lib.undoDepth(c)
  // 100 changes: markers, titles, the clip's volume and opacity, a split, cuts.
  for (let i = 0; i < 100; i++) {
    // A cut may have replaced the clip: the longest piece there now.
    const clip = await c.st((s) => Object.values(s.project.clips).sort((a, b) => b.duration - a.duration)[0].id)
    const op = [
      { op: 'marker.add', time: (i % 11) + 0.25, note: `m${i}` },
      { op: 'text.add', time: (i % 9) + 0.5, text: `t${i}` },
      { op: 'clip.setVolume', clipId: clip, volume: 0.5 + (i % 7) / 10 },
      { op: 'clip.setOpacity', clipId: clip, opacity: 0.6 + (i % 4) / 10 },
      { op: 'timeline.cutRanges', ranges: [[0.02 * (i % 7), 0.02 * (i % 7) + 0.03]] }
    ][i % 5]
    // Each edit on a fresh read (phase 4A.9: base is required).
    const base = /\bv ([0-9a-z]+-\d+)/.exec((await ag.call('project')).text)?.[1]
    const r = await ag.call('edit', { ops: [op], base })
    assert.match(r.text, /^Applied \(one undo step\)/)
  }
  // Each its own undo step: the history (60 steps) is full long before 100 —
  // which is why the point before the agent exists.
  assert.ok((await lib.undoDepth(c)) >= Math.min(depth0 + 100, 60), 'one undo step each, up to the 60 the history keeps')
  const after100 = await c.run(() => window.__agent.serialize())
  // The point before the agent was written before the first change: in the
  // profile, a file named for this project (phase 4A.8: kept apart from the
  // session points, never rotated away by them).
  const dir = join(app.profile, 'agent-restore')
  const points = await c.run(() => window.__agent.restorePoints())
  assert.equal(points[0].kind, 'pre', 'the point before the agent comes first')
  assert.equal(points.length, 1, 'one session, no change of the user\'s: one point')
  const newest = points[0].name
  assert.ok(readdirSync(dir).includes(newest), 'its file is in the profile')
  const onDisk = readFileSync(join(dir, newest), 'utf8')
  assert.equal(onDisk, before, 'the point is the project as it was')
  const r = await c.run(() => window.__agent.restore())
  assert.equal(r.same, true, 'byte for byte')
  assert.equal(await c.run(() => window.__agent.serialize()), onDisk, 'the project now is the file')
  // And the restore itself is one undo step: Ctrl+Z gives the 100 edits back.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('Ctrl+Z undid the restore', async () => (await c.run(() => window.__agent.serialize())) === after100)
  await c.run(() => window.__agent.setMode('draft'))
  console.log(`     restore point ${newest} (${onDisk.length} bytes): same after 100 direct edits`)
}
