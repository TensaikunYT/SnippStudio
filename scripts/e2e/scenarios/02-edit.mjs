// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Split, move (to another track), trim, delete — with the mouse and keys on
// the timeline — and Ctrl+Z back to where it started, one step at a time.
export const name = 'edit-split-move-trim-delete-undo'

const xOf = (c, t) => lib0.timeX(c, t)
import * as lib0 from '../lib.mjs'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  const start = await lib.clipList(c)
  assert.equal(start.length, 2)
  const v1 = start[0].trackId
  const depth0 = await lib.undoDepth(c)

  // Seek on the ruler to 3 s, select the first clip, S splits it there.
  const ruler = await c.box('timeline.ruler')
  await c.clickAt(await xOf(c, 3), ruler.cy)
  const t = await c.st((s) => s.currentTime)
  assert.ok(lib.near(t, 3, 0.1), `playhead at 3 s (${t})`)
  await c.click(`timeline.clip.${start[0].id}`, { fx: 0.1 })
  await c.key('s')
  const afterSplit = await c.waitFor('a split', async () => { const l = await lib.clipList(c); return l.length === 3 ? l : null })
  const pieces = afterSplit.filter((k) => k.assetId === talk.id)
  assert.equal(pieces.length, 2)
  assert.ok(lib.near(pieces[0].duration + pieces[1].duration, 12, 0.01))
  const cut = pieces[1].start
  assert.ok(lib.near(cut, t, 0.05), 'split at the playhead')

  // A new video layer; the last clip dragged up onto it, later in time.
  await c.click('timeline.add-video-track')
  const v2 = await c.waitFor('a second video track', async () => {
    const tr = await c.st((s) => s.project.tracks.filter((x) => x.kind === 'video').map((x) => x.id))
    return tr.length === 2 ? tr.find((x) => x !== v1) : null
  })
  const otherClip = afterSplit.find((k) => k.assetId === other.id)
  const ob = await c.box(`timeline.clip.${otherClip.id}`)
  const row = await c.box(`timeline.track.${v2}`)
  await c.dragAt(ob.x + 30, ob.cy, ob.x + 30, row.cy, { steps: 10 })
  await c.waitFor('the clip on V2', async () => (await lib.clipList(c)).find((x) => x.id === otherClip.id)?.trackId === v2)
  // Then along V2 to about 5 s (Shift: no snapping).
  const ob2 = await c.box(`timeline.clip.${otherClip.id}`)
  await c.dragAt(ob2.x + 30, ob2.cy, (await xOf(c, 5)) + 30, ob2.cy, { steps: 14, mods: ['shift'] })
  const moved = await c.waitFor('the clip at about 5 s', async () => {
    const k = (await lib.clipList(c)).find((x) => x.id === otherClip.id)
    return k && k.start < 7 ? k : null
  })
  assert.equal(moved.trackId, v2)
  assert.ok(moved.start > 3 && moved.start < 7, `moved to about 5 s (${moved.start})`)

  // Trim the second piece's end back by about 2 s.
  const p2 = pieces[1]
  const px = await c.st((s) => s.pxPerSec)
  await c.drag(`timeline.clip.${p2.id}.trim-end`, -2 * px, 0, { steps: 10, mods: ['shift'] })
  const trimmed = await c.waitFor('a trim', async () => {
    const k = (await lib.clipList(c)).find((x) => x.id === p2.id)
    return k && k.duration < p2.duration - 1 ? k : null
  })
  assert.ok(lib.near(trimmed.duration, p2.duration - 2, 0.25), `trimmed by 2 s (${trimmed.duration})`)

  // Select the first piece, Delete.
  await c.click(`timeline.clip.${pieces[0].id}`, { fx: 0.5 })
  await c.key('Delete')
  await c.waitFor('the delete', async () => !(await lib.clipList(c)).some((k) => k.id === pieces[0].id))
  const depth = await lib.undoDepth(c)
  assert.ok(depth - depth0 >= 5, `five edits, five steps or more (${depth - depth0})`)

  // Ctrl+Z, one step at a time, until the project is the seeded one again.
  for (let i = 0; i < depth - depth0; i++) await c.key('z', ['ctrl'])
  await c.waitFor('back to the start', async () => JSON.stringify(await lib.clipList(c)) === JSON.stringify(start))
  assert.equal(await c.st((s) => s.project.tracks.filter((x) => x.kind === 'video').length), 1, 'the new track undone too')
  // And Ctrl+Shift+Z brings the split back.
  await c.key('z', ['ctrl', 'shift'])
  await c.waitFor('redo of the split', async () => (await lib.clipList(c)).length === 3)
}
