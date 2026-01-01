// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Media in through the Import button (the open dialog answered by the test),
// then onto the timeline with each file's ＋ and with "Add all".
export const name = 'import-media-to-timeline'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const since = Date.now()
  lib.answer(app, { kind: 'open', paths: [media.talk, media.other] })
  await c.click('media.import')
  const assets = await c.waitFor('two assets', async () => {
    const a = await c.st((s) => s.project.assets.map((x) => ({ id: x.id, name: x.name, duration: x.duration, hasAudio: x.hasAudio })))
    return a.length === 2 && a.every((x) => x.duration > 0) ? a : null
  })
  const asked = lib.dialogsAsked(app, since)
  assert.equal(asked.length, 1, 'one open dialog')
  assert.equal(asked[0].kind, 'open')
  const talk = assets.find((a) => a.name === 'talk.mp4')
  const other = assets.find((a) => a.name === 'other.mp4')
  assert.ok(lib.near(talk.duration, 12, 0.1) && talk.hasAudio, 'talk.mp4 probed: 12 s with sound')
  assert.ok(lib.near(other.duration, 6, 0.1), 'other.mp4 probed: 6 s')
  await c.waitId(`media.item.${talk.id}`)

  // ＋ on each item: appended at the playhead, in order.
  await c.click(`media.item.${talk.id}.add`)
  await c.waitFor('first clip', async () => (await lib.clipList(c)).length >= 1)
  await c.run(() => window.__store.getState().setTime(12))
  await c.click(`media.item.${other.id}.add`)
  const clips = await c.waitFor('clips of both', async () => {
    const l = await lib.clipList(c)
    return l.filter((k) => k.assetId === other.id).length >= 1 ? l : null
  })
  const vid = clips.filter((k) => k.trackId === clips.find((x) => x.assetId === talk.id).trackId)
  assert.deepEqual(vid.map((k) => [k.assetId, k.start, k.duration]), [[talk.id, 0, 12], [other.id, 12, 6]].map(([a, s, d]) => [a, s, +d.toFixed(3)]))
  for (const k of vid) await c.waitId(`timeline.clip.${k.id}`)

  // Ctrl+Z takes the last one back; "Add all" appends both again.
  await c.click('timeline.scroll', { fx: 0.9, fy: 0.95 })
  await c.key('z', ['ctrl'])
  await c.waitFor('undo of the second add', async () => (await lib.clipList(c)).every((k) => k.assetId !== other.id))
  await lib.dockPage(c, 'media')
  await c.click('media.add-all')
  await c.waitFor('add all', async () => (await lib.clipList(c)).filter((k) => k.assetId === talk.id).length >= 2)
  assert.equal(await c.st((s) => s.dirty), true, 'unsaved after editing')
}
