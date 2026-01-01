// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Subtitles in from an .srt (the page's file chooser answered by the test),
// their style changed with the Size slider, a text of one's own added from
// the preview toolbar, and Ctrl+Z taking it back.
import { SUBS } from '../media.mjs'
export const name = 'captions-add-and-style'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk] = await lib.seedAssets(app, c, [media.talk])
  await lib.seedTimeline(c, [talk.id])

  // (.srt in: the left panel's Captions page; the style: the Subtitles tab.)
  await lib.dockPage(c, 'captions')
  c.chooseFiles([media.srt])
  await c.click('subs.import-srt')
  const caps = await c.waitFor('four subtitles', async () => {
    const l = await c.st((s) => s.project.captions.map((x) => ({ id: x.id, start: x.start, end: x.end, text: x.text })))
    return l.length === 4 ? l : null
  })
  assert.deepEqual(caps.map((x) => x.text), SUBS.map((s) => s.text))
  caps.forEach((x, i) => assert.ok(lib.near(x.start, SUBS[i].start, 0.01) && lib.near(x.end, SUBS[i].end, 0.01), 'timing of line ' + i))
  assert.equal(c.choosersOpened.length, 1, 'one file chooser, answered')
  await c.waitId(`timeline.caption.${caps[0].id}`)

  // Style: the Size slider, clicked near its right end.
  await c.click('inspector.tab.subs')
  const before = await c.st((s) => s.project.captionStyle.fontSize)
  await c.click('subs.style.size', { fx: 0.8 })
  const after = await c.waitFor('a new size', async () => { const v = await c.st((s) => s.project.captionStyle.fontSize); return v !== before ? v : null })
  assert.ok(after > before, `bigger subtitles (${before} → ${after})`)

  // A text of one's own at 5 s.
  await lib.seek(c, 5)
  const n0 = await c.st((s) => s.project.captions.length)
  await lib.addText(c)
  const text = await c.waitFor('a manual text', async () => c.st((s) => s.project.captions.find((x) => x.manual && !x.shape) ?? null))
  assert.ok(lib.near(text.start, 5, 0.1), 'at the playhead')
  await c.waitId(`timeline.caption.${text.id}`)
  // The click left the text selected (its editor may hold the focus): Escape, then Ctrl+Z.
  await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
  await c.key('z', ['ctrl'])
  await c.waitFor('the text undone', async () => (await c.st((s) => s.project.captions.length)) === n0)
}
