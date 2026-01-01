// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-3, worker V (DENEME-3-PLAN-V.md), items 1, 3 and 4, through the
// window: a clip dragged a little over its neighbour does not trade places
// with it; while it is dragged it stays under the pointer and a ghost shows
// where it lands (and where the clips it pushes go); Escape takes the drag
// and its ghosts away; the release lands where the ghost was; Ctrl+Z takes
// it back and the clip stays selected.
export const name = 'den3-v-drag'

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.waitFor('two clips', async () => (await lib.clipList(c)).length >= 2)
  await c.ev(`(() => { window.__store.getState().setPxPerSec(60); return true })()`)
  const st = (fn, ...args) => c.st(fn, ...args)
  // The two pictures on the main video lane: a (12 s) then b (6 s).
  const [a, b] = await st((s) => Object.values(s.project.clips).filter((k) => s.project.tracks.find((t) => t.id === k.trackId)?.kind === 'video').sort((x, y) => x.start - y.start).map((k) => k.id))
  const clip = (id) => st((s, id) => { const k = s.project.clips[id]; return { start: +k.start.toFixed(3), trackId: k.trackId } }, id)
  const frame = () => c.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  const ghost = (id) => c.ev(`(() => { const e = document.querySelector('[data-testid="timeline.ghost.${id}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, shift: e.classList.contains('is-shift') } })()`)
  const ghosts = () => c.ev(`document.querySelectorAll('.tl-drop-ghost').length`)
  const past = () => st((s) => s.past.length)
  const box0 = await c.box(`timeline.clip.${b}`)
  const aBox = await c.box(`timeline.clip.${a}`)
  const x = box0.x + Math.min(40, box0.w / 2), y = box0.y + box0.h * 0.62
  const b0 = await clip(b)
  const a0 = await clip(a)
  await st((s, id) => { s.selectClips([id]); return true }, b)
  const p0 = await past()

  // ---- two seconds over a's tail: b stays after a; the ghost says so --------
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (const dx of [-10, -60, -120]) { await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] }); await frame() }
  const during = await c.box(`timeline.clip.${b}`)
  assert.ok(Math.abs(during.x - box0.x + 120) <= 1, `the clip is under the pointer: ${during.x - box0.x} px for -120`)
  const g = await ghost(b)
  assert.ok(g, 'a ghost where b lands')
  assert.ok(Math.abs(g.x - box0.x) <= 1.5, `it lands where it was, after a: ghost at ${g.x}, b at ${box0.x}`)
  assert.equal(g.shift, false)
  assert.equal(await ghost(a), null, 'a is not pushed: no ghost of its own')
  const aDuring = await c.box(`timeline.clip.${a}`)
  assert.ok(Math.abs(aDuring.x - aBox.x) <= 0.5, 'a does not move while b is dragged')
  await c.mouse('mouseReleased', x - 120, y, { mods: ['shift'] })
  await c.sleep(150)
  assert.deepEqual(await clip(b), b0, 'released: b is back after a')
  assert.deepEqual(await clip(a), a0)
  assert.equal(await ghosts(), 0, 'the ghosts go with the drag')
  assert.equal(await past(), p0, 'nothing changed, no undo step')

  // ---- Escape takes the drag and its ghosts away --------------------------
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (const dx of [-10, -300, -700]) { await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] }); await frame() }
  assert.ok((await ghosts()) > 0)
  await c.key('Escape')
  await frame()
  assert.equal(await ghosts(), 0, 'Escape: no ghost')
  await c.mouse('mouseReleased', x - 700, y)
  await c.sleep(150)
  assert.deepEqual(await clip(b), b0)
  assert.equal(await past(), p0)

  // ---- past a's middle: b goes in before a; a's ghost shows where it goes ---
  // b (6 s) to start 1 s: its middle at 4, before a's (6).
  const dx = (1 - b0.start) * 60
  await c.mouse('mouseMoved', x, y)
  await c.mouse('mousePressed', x, y)
  for (const d of [-10, dx / 2, dx]) { await c.mouse('mouseMoved', x + d, y, { down: true, mods: ['shift'] }); await frame() }
  const gb = await ghost(b), ga = await ghost(a)
  assert.ok(gb && ga, 'ghosts for b and for a, which it pushes')
  assert.equal(ga.shift, true, 'a pushed: the faint kind')
  const plan = await st((s, ids) => ids.map((id) => +s.dragPreview.positions[id].start.toFixed(3)), [a, b])
  assert.ok(plan[1] < plan[0], `b lands before a: ${plan}`)
  await c.mouse('mouseReleased', x + dx, y, { mods: ['shift'] })
  await c.sleep(200)
  assert.deepEqual([(await clip(a)).start, (await clip(b)).start], plan, 'the release lands where the ghosts were')
  assert.equal(await past(), p0 + 1, 'one undo step')
  assert.ok((await st((s) => s.selectedClipIds)).includes(b))

  // ---- Ctrl+Z: back, and b is still selected (item 1) ----------------------
  await c.key('z', ['ctrl'])
  await c.sleep(150)
  assert.deepEqual(await clip(b), b0)
  assert.deepEqual(await clip(a), a0)
  assert.ok((await st((s) => s.selectedClipIds)).includes(b), 'still selected after undo')
}
