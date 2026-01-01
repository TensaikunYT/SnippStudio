// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's feel (phase 3c.T), through the window: a drag begins after
// 4 px and what is dragged stays under the pointer; Escape takes a drag back
// and leaves no undo step; a trim says where its edge is; Ctrl + wheel and
// the zoom slider keep their fixed point in place; "fit" shows the whole film;
// the three lane heights; grab areas of 8 px; the empty lanes let go of the
// selection.
export const name = 'timeline-feel'

const WHEEL = { alt: 1, ctrl: 2, shift: 8 }

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  const [talk, other] = await lib.seedAssets(app, c, [media.talk, media.other])
  await lib.seedTimeline(c, [talk.id, other.id])
  await c.waitFor('two clips', async () => (await lib.clipList(c)).length === 2)
  await c.ev(`(() => { window.__store.getState().setPxPerSec(60); window.__timelineView?.getState().setTrackScale('medium'); return true })()`)
  const [a, b] = await lib.clipList(c)
  const st = (fn, ...args) => c.st(fn, ...args)
  const clip = (id) => st((s, id) => { const k = s.project.clips[id]; return { start: k.start, duration: k.duration, inPoint: k.inPoint, trackId: k.trackId } }, id)
  const stacks = () => st((s) => ({ past: s.past.length, future: s.future.length, time: s.currentTime }))
  const preview = () => st((s) => (s.dragPreview ? { ids: s.dragPreview.ids, at: s.dragPreview.positions } : null))
  const bodyDragging = () => c.ev(`document.body.classList.contains('tl-dragging')`)
  const frame = () => c.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  /** A press on a clip's body, away from its edges and its small buttons. */
  const bodyPoint = async (id) => { const k = await c.box(`timeline.clip.${id}`); return [k.x + Math.min(60, k.w / 2), k.y + k.h * 0.62, k] }
  const wheel = (x, y, deltaY, mods = 0, deltaX = 0) => c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: mods, pointerType: 'mouse' })
  const scrollLeft = () => c.ev(`document.querySelector('[data-testid="timeline.scroll"]').scrollLeft`)

  // ---- a drag begins after 4 px; the clip stays under the pointer --------------
  {
    const [x, y, box0] = await bodyPoint(b.id)
    const before = await clip(b.id)
    const s0 = await stacks()
    await c.mouse('mouseMoved', x, y)
    await c.mouse('mousePressed', x, y)
    await c.mouse('mouseMoved', x + 3, y, { down: true })
    await frame()
    assert.equal(await preview(), null, 'three pixels of travel are not a drag')
    assert.equal(await bodyDragging(), false)
    // Shift: no snapping, so the ghost is exactly where the pointer took it.
    for (const dx of [6, 40, 120, 200]) await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] })
    await frame()
    assert.ok(await preview(), 'a drag after 4 px')
    assert.equal(await bodyDragging(), true, 'the page knows a drag is under way')
    const during = await c.box(`timeline.clip.${b.id}`)
    assert.ok(Math.abs(during.x - box0.x - 200) <= 1, `the clip is under the pointer: moved ${during.x - box0.x} px for 200`)
    assert.deepEqual(await clip(b.id), before, 'nothing is written while the ghost moves')

    // Escape: the drag never happened.
    await c.key('Escape')
    await frame()
    assert.equal(await preview(), null, 'Escape puts the ghost away')
    assert.equal(await bodyDragging(), false)
    await c.mouse('mouseReleased', x + 200, y)
    await c.sleep(200)
    assert.deepEqual(await clip(b.id), before, 'the clip is where it was')
    assert.deepEqual(await stacks(), s0, 'no undo step, no redo step, the playhead where it was')
    assert.deepEqual(await st((s) => s.selectedClipIds), [b.id], 'the pressed clip stays selected')
    const after = await c.box(`timeline.clip.${b.id}`)
    assert.ok(Math.abs(after.x - box0.x) <= 0.5, 'and drawn where it was')
  }

  // ---- a trim: its label, Escape, and a click on the edge that changes nothing ----
  {
    const before = await clip(a.id)
    const s0 = await stacks()
    const h = await c.box(`timeline.clip.${a.id}.trim-end`)
    assert.ok(h.w >= 8, `the trim edge is ${h.w} px wide`)
    const x = h.x + h.w / 2, y = h.y + h.h * 0.7
    // A click, and a click with a pixel or two of tremor: nothing.
    await c.mouse('mouseMoved', x, y)
    await c.mouse('mousePressed', x, y)
    await c.mouse('mouseMoved', x - 2, y, { down: true })
    await c.mouse('mouseReleased', x - 2, y)
    await c.sleep(150)
    assert.deepEqual(await clip(a.id), before, 'a click on the edge trims nothing')
    assert.equal((await stacks()).past, s0.past, 'and leaves no undo step')
    // The trim itself.
    await c.mouse('mouseMoved', x, y)
    await c.mouse('mousePressed', x, y)
    for (const dx of [-10, -40, -90, -120]) { await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] }); await frame() }
    const mid = await clip(a.id)
    assert.ok(lib.near(mid.duration, before.duration - 2, 0.05), `the edge follows the pointer: ${mid.duration} s of ${before.duration}`)
    const tip = await c.ev(`document.querySelector('.tl-trim-tip')?.textContent ?? null`)
    assert.match(String(tip), /^Out \d+:\d\d\.\d\d · −2\.0\d s · 10\.0\d s long$/, `the trim label: ${tip}`)
    await c.key('Escape')
    await frame()
    assert.deepEqual(await clip(a.id), before, 'Escape puts the edge back')
    assert.deepEqual(await stacks(), s0, 'no undo step, no redo step, the playhead back')
    assert.equal(await c.ev(`!!document.querySelector('.tl-trim-tip')`), false)
    await c.mouse('mouseReleased', x - 120, y)
    await c.sleep(150)
    assert.deepEqual(await clip(a.id), before)
    // A finished trim is one step, and Ctrl+Z takes it back.
    await c.mouse('mouseMoved', x, y)
    await c.mouse('mousePressed', x, y)
    for (const dx of [-20, -60]) { await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] }); await frame() }
    await c.mouse('mouseReleased', x - 60, y, { mods: ['shift'] })
    await c.sleep(200)
    assert.ok(lib.near((await clip(a.id)).duration, before.duration - 1, 0.05))
    assert.equal((await stacks()).past, s0.past + 1, 'one undo step')
    await c.key('z', ['ctrl'])
    assert.deepEqual(await clip(a.id), before)
  }

  // ---- a subtitle chip: an 8 px grab area at its edge; its drag and Escape -------
  {
    await lib.seek(c, 4)
    const capId = await c.run(() => { const s = window.__store.getState(); const id = s.addCaptionAtPlayhead('A line to drag'); s.setDirty(false); return id })
    await c.waitId(`timeline.caption.${capId}`)
    await st((s, id) => { s.updateCaption(id, { start: 4, end: 7 }); return true }, capId)
    await frame()
    const chip = await c.box(`timeline.caption.${capId}`)
    const hit = (dx) => c.run((x, y) => { const e = document.elementFromPoint(x, y); return e?.className ?? null }, chip.x + dx, chip.cy)
    assert.match(String(await hit(1.5)), /chip-handle l/)
    assert.match(String(await hit(7.5)), /chip-handle l/, 'the edge is grabbed 8 px in')
    assert.doesNotMatch(String(await hit(10.5)), /chip-handle/, 'and no further')
    const cap = () => st((s, id) => { const k = s.project.captions.find((x) => x.id === id); return { start: k.start, end: k.end } }, capId)
    const before = await cap()
    const s0 = await stacks()
    const x = chip.cx, y = chip.cy
    await c.mouse('mouseMoved', x, y)
    await c.mouse('mousePressed', x, y)
    for (const dx of [10, 50, 90]) { await c.mouse('mouseMoved', x + dx, y, { down: true, mods: ['shift'] }); await frame() }
    assert.ok(lib.near((await cap()).start, before.start + 1.5, 0.05), 'the chip follows the pointer')
    await c.key('Escape')
    await frame()
    assert.deepEqual(await cap(), before, 'Escape puts the chip back')
    assert.deepEqual(await stacks(), s0, 'no undo step')
    await c.mouse('mouseReleased', x + 90, y)
    await c.sleep(150)
    assert.deepEqual(await cap(), before)
  }

  // ---- zoom: the time under the pointer stays there (±1 px); the slider keeps the playhead ----
  {
    const area = await c.box('timeline.scroll')
    const x = area.x + 700, y = area.y + 120
    await c.mouse('mouseMoved', x, y)
    for (const delta of [-100, -100, -100, 100, -300, 200]) {
      const before = await st((s) => s.pxPerSec)
      const time = (x - area.x + (await scrollLeft()) - 110) / before
      await wheel(x, y, delta, WHEEL.ctrl)
      await frame()
      const px = await st((s) => s.pxPerSec)
      assert.notEqual(px, before, 'Ctrl + wheel zooms')
      const at = area.x + 110 + time * px - (await scrollLeft())
      assert.ok(Math.abs(at - x) <= 1, `the time under the pointer stayed (${(at - x).toFixed(2)} px) at ${px.toFixed(1)} px/s`)
    }
    // The slider's number: the playhead stays where it is on screen.
    await st((s) => { s.setPxPerSec(60); return true })
    await frame()
    await lib.seek(c, 6)
    const headX = async () => area.x + 110 + (await st((s) => s.currentTime * s.pxPerSec)) - (await scrollLeft())
    const x0 = await headX()
    await c.fill('timeline.zoom.value', '150', { enter: true })
    await frame()
    assert.equal(await st((s) => s.pxPerSec), 150)
    assert.ok(Math.abs((await headX()) - x0) <= 1, `the playhead stayed (${((await headX()) - x0).toFixed(2)} px)`)
    // The same ends for the number as for the wheel.
    await c.fill('timeline.zoom.value', '9000', { enter: true })
    assert.equal(await st((s) => s.pxPerSec), 600)
    // Fit: the whole film in view, from its first frame, within a short moment.
    await c.click('timeline.zoom.fit')
    await c.waitFor('the film to fit', async () => {
      const r = await st((s) => { let end = 0; for (const k of Object.values(s.project.clips)) end = Math.max(end, k.start + k.duration); for (const k of s.project.captions) end = Math.max(end, k.end); return { end, px: s.pxPerSec } })
      const width = await c.ev(`document.querySelector('[data-testid="timeline.scroll"]').clientWidth`)
      return (await scrollLeft()) === 0 && Math.abs(r.end * r.px - (width - 110 - 24)) < 2
    }, 2000, 40)
    await st((s) => { s.setPxPerSec(60); return true })
    await frame()
  }

  // ---- the three lane heights ----------------------------------------------------
  {
    const audio = await st((s) => s.project.tracks.find((t) => t.kind === 'audio').id)
    const want = { small: [42, 34], medium: [72, 60], large: [108, 84] } // v3 (UI-YENI): medium 72 / 60, was 58 / 48
    for (const step of ['large', 'small', 'medium']) {
      // (Settings → General since DENEME-3; the view's own setter here.)
      await c.run((s) => { window.__timelineView.getState().setTrackScale(s); return true }, step)
      await frame()
      assert.equal(await c.ev('window.__timelineView.getState().trackScale'), step)
      assert.equal(await c.ev(`localStorage.getItem('snipp-track-scale')`), step, 'kept with the profile')
      const lane = await c.box(`timeline.track.${a.trackId}`)
      const sound = await c.box(`timeline.track.${audio}`)
      assert.equal(lane.h, want[step][0], `${step}: the video lane`)
      assert.equal(sound.h, want[step][1], `${step}: the sound lane`)
      const box = await c.box(`timeline.clip.${b.id}`)
      // (The clip's box: the lane less its line and 4 px above and below.)
      assert.equal(box.h, want[step][0] - 9, `${step}: the clip's box`)
      // A film strip or a sound drawing is as tall as its clip.
      const canvas = await c.run((id) => { const k = document.querySelector(`[data-testid="timeline.clip.${id}"] canvas`); return k ? { css: k.getBoundingClientRect().height, bitmap: k.height } : null }, a.id)
      if (canvas) assert.ok(Math.abs(canvas.bitmap - Math.round(canvas.css * (await c.ev('window.devicePixelRatio')))) <= 1, `${step}: the drawing is made for its height (${JSON.stringify(canvas)})`)

      // Drag, snap and trim work at this height.
      const before = await clip(b.id)
      const depth = await lib.undoDepth(c)
      const [x, y] = await bodyPoint(b.id)
      // To the playhead, parked 3 s after the clip: within 8 px it snaps.
      const target = before.start + before.duration + 3
      await st((s, t) => { s.setTime(t); return true }, target)
      const dx = (target - before.start) * 60 + 5
      await c.mouse('mouseMoved', x, y)
      await c.mouse('mousePressed', x, y)
      for (const f of [0.1, 0.5, 0.9, 1]) { await c.mouse('mouseMoved', x + dx * f, y, { down: true }); await frame() }
      assert.ok(lib.near(await st((s) => s.snapGuide ?? -1), target, 1e-6), `${step}: the snap line is on the playhead`)
      assert.equal(await c.ev(`!!document.querySelector('.tl-snapguide:not(.is-off)')`), true)
      await c.mouse('mouseReleased', x + dx, y)
      await c.sleep(200)
      assert.ok(lib.near((await clip(b.id)).start, target, 1e-6), `${step}: dropped on the snap`)
      assert.equal(await lib.undoDepth(c), depth + 1, `${step}: one undo step`)
      await c.key('z', ['ctrl'])
      assert.deepEqual(await clip(b.id), before)
      const h = await c.box(`timeline.clip.${b.id}.trim-end`)
      await c.mouse('mouseMoved', h.cx, h.y + h.h * 0.7)
      await c.mouse('mousePressed', h.cx, h.y + h.h * 0.7)
      for (const d of [-12, -30]) { await c.mouse('mouseMoved', h.cx + d, h.y + h.h * 0.7, { down: true, mods: ['shift'] }); await frame() }
      await c.mouse('mouseReleased', h.cx - 30, h.y + h.h * 0.7, { mods: ['shift'] })
      await c.sleep(200)
      assert.ok(lib.near((await clip(b.id)).duration, before.duration - 0.5, 0.05), `${step}: trimmed`)
      await c.key('z', ['ctrl'])
      assert.deepEqual(await clip(b.id), before)
    }
    // Alt + wheel: a step up, a step down.
    const area = await c.box('timeline.scroll')
    await wheel(area.x + 600, area.y + 100, -100, WHEEL.alt)
    await frame()
    assert.equal(await c.ev('window.__timelineView.getState().trackScale'), 'large', 'Alt + wheel up: taller lanes')
    await wheel(area.x + 600, area.y + 100, 100, WHEEL.alt)
    await frame()
    assert.equal(await c.ev('window.__timelineView.getState().trackScale'), 'medium', 'Alt + wheel down: back')
  }

  // ---- the playhead under the pointer; the empty lanes let go of the selection ----
  {
    await c.ev(`(() => { document.querySelector('[data-testid="timeline.scroll"]').scrollLeft = 0; return true })()`)
    await frame()
    const ruler = await c.box('timeline.ruler')
    const x0 = ruler.x + 110 + 200
    await c.mouse('mouseMoved', x0, ruler.cy)
    await c.mouse('mousePressed', x0, ruler.cy, { mods: ['shift'] })
    for (const dx of [30, 111, 240]) {
      await c.mouse('mouseMoved', x0 + dx, ruler.cy, { down: true, mods: ['shift'] })
      await frame()
      const t = await st((s) => s.currentTime)
      assert.ok(Math.abs(t * 60 - (200 + dx)) <= 1, `the playhead is under the pointer (${(t * 60 - 200 - dx).toFixed(2)} px)`)
    }
    await c.mouse('mouseReleased', x0 + 240, ruler.cy, { mods: ['shift'] })
    await c.click(`timeline.clip.${a.id}`, { fx: 0.3, fy: 0.62 })
    assert.deepEqual(await st((s) => s.selectedClipIds), [a.id])
    const area = await c.box('timeline.scroll')
    await c.clickAt(area.x + area.w - 200, area.y + area.h - 20)
    assert.deepEqual(await st((s) => s.selectedClipIds), [], 'a click on the empty lanes lets go of the selection')
  }
  await st((s) => { s.setDirty(false); return true })
}
