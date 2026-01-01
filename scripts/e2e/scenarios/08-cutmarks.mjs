// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Cut marks: the Cutter tool (C) puts two marks on the clip, the range
// between them is deleted from that lane and the gap closed — one step.
export const name = 'cut-marks-delete'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  const [clip] = await lib.clipList(c)
  const depth0 = await lib.undoDepth(c)

  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('c')
  await c.waitFor('the cutter on', () => c.st((s) => s.cutterMode))
  const box = await c.box(`timeline.clip.${clip.id}`)
  await c.clickAt(await lib.timeX(c, 2), box.cy, { mods: ['shift'] })
  await c.clickAt(await lib.timeX(c, 5), box.cy, { mods: ['shift'] })
  const marks = await c.waitFor('two marks', async () => { const m = await c.st((s) => s.cutMarks); return m.length === 2 ? m : null })
  assert.ok(lib.near(marks[0], 2, 0.05) && lib.near(marks[1], 5, 0.05), `marks at 2 and 5 s (${marks})`)
  await c.waitId('timeline.cutmark.1')
  await c.waitId('timeline.cutrange')

  await c.click('timeline.tool.cut-delete')
  const total = await c.waitFor('the range gone', async () => {
    const l = await lib.clipList(c)
    return l.length === 2 ? l.reduce((n, k) => n + k.duration, 0) : null
  })
  assert.ok(lib.near(total, 12 - (marks[1] - marks[0]), 0.01), `3 s shorter (${total})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one step')
  assert.deepEqual(await c.st((s) => s.cutMarks), [], 'the marks cleared')
  await c.key('Escape')
}
