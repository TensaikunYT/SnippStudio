// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish T (CILA-T-PLAN.md K7, K10–K12): around the transitions.
//   - "Play the cut" plays from 1 s before the cut to 1 s after it, then stops;
//   - every transition's sound and the build-ups are in Project → Sound, and
//     the Inspector's "All transition sounds" goes there;
//   - the toolbar: no "SFX cuts", no add-track buttons in Tools (the + strips
//     do it); Compound, Group and Adjustment in a clip's right-click menu;
//     Auto Pack and the preview's "View" say what they are;
//   - a speed curve shows on its clip (a badge with its range, a line).
export const name = 'cila-t-tools'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id, talk.id])
  const [first, second, third] = await lib.clipList(c)
  const depth = () => lib.undoDepth(c)

  // ---- play the cut --------------------------------------------------------
  await c.click(`timeline.junction.${first.id}.add`, { force: true })
  await c.waitId('inspector.trans.play')
  const cut = await c.st((s, id) => s.project.clips[id].start + s.project.clips[id].duration, first.id)
  await c.click('inspector.trans.play')
  await c.waitFor('playing', () => c.st((s) => s.playing))
  const t0 = await c.st((s) => s.currentTime)
  assert.ok(t0 >= cut - 1.05 && t0 <= cut, `from about 1 s before the cut (${t0}, cut ${cut})`)
  await c.waitFor('stopped after the cut', async () => !(await c.st((s) => s.playing)), 6000)
  const t1 = await c.st((s) => s.currentTime)
  assert.ok(t1 >= cut + 0.95 && t1 <= cut + 1.3, `to about 1 s after it (${t1})`)

  // ---- the project's transition sounds -------------------------------------
  await c.click('inspector.trans.project-sound')
  await c.waitId('inspector.project.trans-sound')
  assert.ok(await c.has('inspector.project.trans-sound.all'), 'every transition\'s sound')
  assert.ok(await c.has('inspector.project.trans-sound.risers'), 'the build-ups')
  await c.click('inspector.tab.clip')

  // ---- the toolbar ---------------------------------------------------------
  assert.equal(await c.has('timeline.sfx.apply'), false, 'no SFX cuts on the toolbar')
  await c.click('timeline.tools-more')
  assert.equal(await c.has('timeline.tool.add-video-track'), false, 'no add-track in Tools (the + strips)')
  assert.ok(await c.has('timeline.tool.compound'), 'Compound stays in Tools')
  await c.click('timeline.tools-more')
  assert.ok(await c.has('timeline.add-video-track'), 'the + strip')
  // Compound and Group from a clip's right-click menu (two clips selected).
  await c.st((s, ids) => s.selectClips(ids), [second.id, third.id])
  const b = await c.box(`timeline.clip.${third.id}`)
  await c.clickAt(b.x + b.w / 2, b.y + b.h * 0.7, { button: 'right' })
  await c.waitId(`timeline.clip.${third.id}.menu.group`)
  assert.ok(await c.has(`timeline.clip.${third.id}.menu.compound`))
  assert.ok(await c.has(`timeline.clip.${third.id}.menu.adjustment`))
  let d0 = await depth()
  await c.click(`timeline.clip.${third.id}.menu.group`)
  await c.waitFor('grouped', async () => (await c.st((s) => (s.project.groups ?? []).length)) === 1)
  assert.equal((await depth()) - d0, 1)
  await c.key('z', ['ctrl'])
  await c.waitFor('ungrouped', async () => (await c.st((s) => (s.project.groups ?? []).length)) === 0)
  // Auto Pack and the preview's View say what they are.
  const v1 = await c.st((s) => s.project.tracks.find((t) => t.kind === 'video').id)
  assert.match(await c.attr(`timeline.track.${v1}.pack`, 'aria-label'), /gaps/i)
  assert.match(await c.run(() => document.querySelector('[data-testid="preview.more"]').textContent), /View|Görünüm/)

  // ---- a speed curve on its clip -------------------------------------------
  assert.equal(await c.has(`timeline.clip.${third.id}.curve-line`), false)
  await c.st((s, id) => s.setClipSpeedCurve(id, { points: [{ u: 0, v: 0.5 }, { u: 0.5, v: 4 }, { u: 1, v: 0.5 }] }), third.id)
  await c.waitId(`timeline.clip.${third.id}.curve-line`)
  const badge = await c.run((id) => document.querySelector(`[data-testid="timeline.clip.${id}.curve-badge"]`)?.textContent ?? '', third.id)
  assert.match(badge, /^0\.\d+–\d+(\.\d)?×$/, `the range (${badge})`)
  await c.key('z', ['ctrl'])
  await c.waitGone(`timeline.clip.${third.id}.curve-line`)
}
