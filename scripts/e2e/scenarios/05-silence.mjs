// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The silence cutter: talk.mp4 is silent at 3–4.5 s and 8–9.5 s. Opened from
// the preview toolbar, it finds those two gaps (the red preview), and Remove
// cuts them in one undo step.
import { SPEECH } from '../media.mjs'
export const name = 'silence-cutter-preview-and-apply'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])
  const [clip] = await lib.clipList(c)
  await c.click(`timeline.clip.${clip.id}`)
  const depth0 = await lib.undoDepth(c)

  await c.click('preview.silence')
  await c.waitId('silence')
  const regions = await c.waitFor('the preview of two gaps', async () => {
    if ((await c.attr('silence.status', 'data-busy')) !== '0') return null
    const r = await c.st((s) => s.silencePreview)
    return r && r.length ? r : null
  }, 20000)
  const gaps = [[SPEECH[0][1], SPEECH[1][0]], [SPEECH[1][1], SPEECH[2][0]]]
  assert.equal(regions.length, 2, `two gaps (${JSON.stringify(regions.map((r) => [r.start, r.end]))})`)
  regions.forEach((r, i) => assert.ok(r.start >= gaps[i][0] - 0.05 && r.end <= gaps[i][1] + 0.05 && r.end - r.start > 0.8, `gap ${i} inside its silence (${r.start.toFixed(2)}–${r.end.toFixed(2)})`))
  // Nothing is cut until Remove.
  assert.equal((await lib.clipList(c)).length, 1)
  const removed = regions.reduce((n, r) => n + (r.end - r.start), 0)

  await c.click('silence.apply')
  await c.waitGone('silence')
  const total = await c.waitFor('the cut', async () => {
    const l = await lib.clipList(c)
    return l.length === 3 ? l.reduce((n, k) => n + k.duration, 0) : null
  })
  assert.ok(lib.near(total, 12 - removed, 0.02), `the gaps removed (${total.toFixed(3)} = 12 − ${removed.toFixed(3)})`)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')
  assert.equal(await c.st((s) => s.silencePreview), null, 'the preview cleared')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo', async () => (await lib.clipList(c)).length === 1)
}
