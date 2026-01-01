// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline and the preview on the building blocks (phase 3c.2): the
// controls that became Button / IconButton / Slider / Menu still do what the
// old ones did, through the window. A tool's state is its pressed state, the
// clip's and the track's menus are the one menu surface, the zoom's number is
// typed, the history arrow opens its list; and the toolbar keeps its height
// (the lanes under it must not move: scripts/qa/timeline-geometry.mjs).
export const name = 'timeline-blocks'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.waitFor('two clips', async () => (await lib.clipList(c)).length === 2)
  const [first] = await lib.clipList(c)
  const pressed = (id) => c.attr(id, 'aria-pressed')

  // The toolbar: 48 px (v3, its tools with their words; it was 30 and its
  // line); the lanes start right under it.
  const bar = await c.ev(`(() => { const r = document.querySelector('.tl-toolbar').getBoundingClientRect(); const s = document.querySelector('[data-testid="timeline.scroll"]').getBoundingClientRect(); return { h: r.height, gap: s.y - r.y } })()`)
  assert.equal(bar.h, 48, 'the toolbar is 48 px')
  assert.equal(bar.gap, 48, 'the lanes start under it')

  // A tool that is on says so (aria-pressed), and the store agrees.
  const snap0 = await c.st((s) => s.playheadSnap)
  assert.equal(await pressed('timeline.tool.snap'), String(snap0))
  await c.click('timeline.tool.snap')
  assert.equal(await c.st((s) => s.playheadSnap), !snap0)
  assert.equal(await pressed('timeline.tool.snap'), String(!snap0))
  await c.click('timeline.tool.snap')

  // Split at the playhead from the toolbar: one step.
  await lib.seek(c, 2)
  const depth0 = await lib.undoDepth(c)
  await c.click(`timeline.clip.${first.id}`, { fx: 0.8 })
  await c.click('timeline.tool.split')
  await c.waitFor('three clips', async () => (await lib.clipList(c)).length === 3)
  assert.equal((await lib.undoDepth(c)) - depth0, 1, 'one undo step')

  // The clip's menu (right-click): the one menu surface; "Disable clip" works and closes it.
  const [a] = await lib.clipList(c)
  const box = await c.box(`timeline.clip.${a.id}`)
  await c.clickAt(box.cx, box.cy, { button: 'right' })
  await c.waitId(`timeline.clip.${a.id}.menu`)
  assert.equal(await c.attr(`timeline.clip.${a.id}.menu`, 'role'), 'menu')
  await c.click(`timeline.clip.${a.id}.menu.disable`)
  await c.waitGone(`timeline.clip.${a.id}.menu`)
  assert.equal(await c.st((s, id) => !!s.project.clips[id].disabled, a.id), true, 'the clip is off')
  await c.key('z', ['ctrl'])
  assert.equal(await c.st((s, id) => !!s.project.clips[id].disabled, a.id), false, 'undone')
  // Escape closes it and changes nothing.
  await c.clickAt(box.cx, box.cy, { button: 'right' })
  await c.waitId(`timeline.clip.${a.id}.menu`)
  await c.key('Escape')
  await c.waitGone(`timeline.clip.${a.id}.menu`)

  // A track's head: mute is a pressed button; the menu behind the dots locks the track.
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  await c.click(`timeline.track.${v1}.mute`)
  assert.equal(await c.st((s, id) => !!s.project.tracks.find((t) => t.id === id).muted, v1), true)
  assert.equal(await pressed(`timeline.track.${v1}.mute`), 'true')
  await c.click(`timeline.track.${v1}.mute`)
  await c.click(`timeline.track.${v1}.more`)
  await c.waitId(`timeline.track.${v1}.menu`)
  await c.click(`timeline.track.${v1}.menu.lock`)
  await c.waitGone(`timeline.track.${v1}.menu`)
  assert.equal(await c.st((s, id) => !!s.project.tracks.find((t) => t.id === id).locked, v1), true, 'locked')
  await c.click(`timeline.track.${v1}.more`)
  await c.click(`timeline.track.${v1}.menu.lock`)
  assert.equal(await c.st((s, id) => !!s.project.tracks.find((t) => t.id === id).locked, v1), false, 'unlocked')

  // The zoom: its number is typed (Enter takes it), kept inside 1–600 (phase
  // 3c.T: the same ends as the wheel's; the slider used to stop at 400).
  await c.click('timeline.zoom.value')
  await c.key('a', ['ctrl'])
  await c.type('120')
  await c.key('Enter')
  assert.equal(await c.st((s) => s.pxPerSec), 120)
  await c.click('timeline.zoom.value')
  await c.key('a', ['ctrl'])
  await c.type('9000')
  await c.key('Enter')
  assert.equal(await c.st((s) => s.pxPerSec), 600)

  // Under the preview: the arrow beside Undo lists the steps; one of them goes back that far.
  const depth1 = await lib.undoDepth(c)
  assert.ok(depth1 >= 1)
  await c.click('transport.history')
  await c.waitId('transport.history.menu')
  await c.key('Escape')
  await c.waitGone('transport.history.menu')
  await c.click('transport.undo')
  assert.equal(await lib.undoDepth(c), depth1 - 1, 'Undo took one step')
  await c.click('transport.redo')
  assert.equal(await lib.undoDepth(c), depth1)

  // The preview toolbar: "More" holds Shorts mode; it is a pressed tool once on.
  await c.click('preview.more')
  await c.click('preview.shorts-mode')
  assert.equal(await c.st((s) => s.project.mode), 'shorts')
  await c.click('preview.more')
  assert.equal(await pressed('preview.shorts-mode'), 'true')
  await c.click('preview.shorts-mode')
  assert.equal(await c.st((s) => s.project.mode), 'frame')
}
